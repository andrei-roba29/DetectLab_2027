/*!
 * DetectLab — Next-Gen APM · orchestration (main thread; heavy maths in the worker).
 *
 *   MANUAL  search window → DEM (provider chain) → water (provider chain) → worker.setAnalysis → worker.score
 *   TRAIN   known sites (50 km) → period filter → background sample → DEM tiles → worker.sampleTile
 *           → buildSampleSet → worker.train → prediction window → worker.score (TRAIN thresholds)
 *
 * Re-scoring with new weights/curves reuses the analysis already loaded in the worker
 * (no refetch, no terrain recompute): see `session.analysisKey`.
 */
(function (root, factory) {
    var deps = typeof module === 'object' && module.exports
        ? { core: require('./apm-core.js'), raster: require('./apm-raster.js'), sites: require('./apm-sites.js'), prov: require('./apm-providers.js') }
        : { core: root.DetectLabApmCore, raster: root.DetectLabApmRaster, sites: root.DetectLabApmSites, prov: root.DetectLabApmProviders };
    var api = factory(deps.core, deps.raster, deps.sites, deps.prov, root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DetectLabApmPipeline = api;
})(typeof self !== 'undefined' ? self : this, function (core, raster, sites, prov, root) {
    'use strict';

    var hoardConfig = typeof module === 'object' && module.exports ? require('./hoards.config.js') : root.DetectLabHoardConfig;
    var hoards = typeof module === 'object' && module.exports ? require('./apm-hoards.js') : root.DetectLabApmHoards;
    var hoardProvider = typeof module === 'object' && module.exports ? require('./apm-hoard-provider.js') : root.DetectLabHoardProvider;
    var hoardScale = typeof module === 'object' && module.exports ? require('./apm-hoard-scale.js') : root.DetectLabHoardScale;

    var cacheModule = typeof module === 'object' && module.exports ? require('./apm-train-cache.js') : root.DetectLabTrainCache;
    var trainInputs = cacheModule ? cacheModule.create(root.indexedDB ? { indexedDB: root.indexedDB } : {}) : null;

    // Preserve pixel grids/model; only the streaming block size changes.
    function mobileTrainProfile() {
        var nav = root.navigator || {};
        return !!((nav.userAgentData && nav.userAgentData.mobile) || (nav.deviceMemory && nav.deviceMemory <= 4) ||
            (root.matchMedia && root.matchMedia('(pointer: coarse)').matches));
    }

    var BUFFER_M = 3000;          // context beyond the search circle (water decay band, Horn edges)
    var TRAIN_AREA_KM = 50;
    var BG_EXCLUDE_M = 500;       // no background point within 500 m of a site
    var TRAIN_ROBUST_CONFIG = core.robustTrainConfig;
    var CANCELLED = 'cancelled';

    function cancelledError() { var e = new Error('Cancelled'); e.code = CANCELLED; return e; }
    function isCancelled(e) { return e && e.code === CANCELLED; }

    /** Both prediction modes must pass through the same protection mask.
     * `analysis._exclusionResult`, when present, is an already-settled { mask, stats }
     * that the caller started fetching in parallel with the DEM/water requests
     * (the UAT exclusion mask does not depend on either, so there is no reason to
     * wait for them before starting it — see runManual/runTrain). When absent,
     * the mask is requested here exactly as before (used directly by callers/tests
     * that have not pre-started it). */
    function setPredictionAnalysis(session, analysis, params, warnings) {
        checkToken(params.token);
        var exclusionPromise;
        if (analysis._exclusionResult) {
            exclusionPromise = Promise.resolve(analysis._exclusionResult);
        } else if (typeof root.computeArcheoExclusionMask !== 'function') {
            exclusionPromise = Promise.reject(new Error('Spatial exclusion service is unavailable. Please reload and try again.'));
        } else {
            exclusionPromise = root.computeArcheoExclusionMask(analysis.grid, analysis.circle.lat, analysis.circle.lon,
                analysis.circle.radiusM, { isCancelled: function () { return !!(params.token && params.token.cancelled); },
                    siteRecords: params.records ? (params.records._protectionRecords || params.records) : undefined });
        }
        return exclusionPromise
            .then(function (result) {
                checkToken(params.token);
                if (!result || !result.mask || result.mask.length !== analysis.grid.w * analysis.grid.h) {
                    throw new Error('Invalid spatial exclusion mask');
                }
                analysis.exclusionMask = result.mask;
                session.exclusionStats = result.stats;
                if (result.stats.unknown) warnings.push(core.msg('warn.exclusionUnknown', { n: result.stats.unknown },
                    'Cells with unavailable UAT exclusion data were left unscored.'));
                var transfer = [];
                [analysis.elev,analysis.exclusionMask].concat(Object.keys(analysis.waterMasks || {}).map(function(c){return analysis.waterMasks[c];})).forEach(function(values){
                    if(values && values.buffer && transfer.indexOf(values.buffer)<0)transfer.push(values.buffer);
                });
                return session.worker.call('setAnalysis', analysis, transfer).then(function (prepared) {
                    if (prepared.stats && prepared.stats.valid === 0) {
                        var unknown = result.stats.unknown > 0;
                        throw core.keyedError(unknown ? 'err.noPredictionUat' : 'err.noPredictionCells', {},
                            unknown ? 'No prediction cells could be verified. Built-up area data may be unavailable; retry when it is accessible.' :
                                'No valid prediction cells remain after terrain and spatial exclusions.');
                    }
                    return prepared;
                });
            });
    }

    /** Starts the UAT protection-mask request right away, exactly as setPredictionAnalysis
     * would, so the caller can run it alongside the DEM/water fetches instead of after them. */
    function startExclusionMask(grid, lat, lon, radiusM, params) {
        if (typeof root.computeArcheoExclusionMask !== 'function') {
            return Promise.reject(new Error('Spatial exclusion service is unavailable. Please reload and try again.'));
        }
        return root.computeArcheoExclusionMask(grid, lat, lon, radiusM,
            { isCancelled: function () { return !!(params.token && params.token.cancelled); },
                siteRecords: params.records ? (params.records._protectionRecords || params.records) : undefined });
    }

    function requireScores(res) {
        if (res.scoreStats && res.scoreStats.cells === 0) throw core.keyedError('err.noScores', {},
            'The model could not score any prediction cells. Try another area or training dataset.');
        return res;
    }

    /* ── Worker client ─────────────────────────────────────────────────────── */
    /**
     * @param url  worker script URL. Each call resolves with the worker reply (ok === true) or rejects.
     */
    function createWorkerClient(url) {
        var worker = new Worker(url);
        var seq = 0, pending = {};
        worker.onmessage = function (ev) {
            var m = ev.data || {};
            var p = pending[m.id];
            if (!p) return;
            delete pending[m.id];
            if (m.ok) p.resolve(m); else p.reject(new Error(m.error || 'Worker error'));
        };
        worker.onerror = function (ev) {
            Object.keys(pending).forEach(function (k) { pending[k].reject(new Error('Worker failed: ' + (ev.message || 'unknown'))); delete pending[k]; });
        };
        return {
            call: function (op, payload, transfer) {
                var id = ++seq;
                return new Promise(function (resolve, reject) {
                    pending[id] = { resolve: resolve, reject: reject };
                    var msg = Object.assign({ op: op, id: id }, payload);
                    worker.postMessage(msg, transfer || []);
                });
            },
            terminate: function () {
                worker.terminate();
                Object.keys(pending).forEach(function (k) { pending[k].reject(cancelledError()); delete pending[k]; });
            }
        };
    }

    /* ── Helpers ───────────────────────────────────────────────────────────── */
    function checkToken(token) { if (token && token.cancelled) throw cancelledError(); }

    /** Rasterise provider water (lines + polygons) into per-class masks on a grid. */
    function rasteriseWater(water, grid) {
        var masks = {};
        function mask(c) { return masks[c] || (masks[c] = new Uint8Array(grid.w * grid.h)); }
        (water.lines || []).forEach(function (l) { raster.rasteriseLines([l.coords], grid, mask(l.cls)); });
        (water.polygons || []).forEach(function (p) { raster.rasterisePolygons(p.rings, grid, mask(p.cls)); });
        return masks;
    }

    /** Flat [lon1,lat1,lon2,lat2,…] segments per class, for the worker's rbush index (TRAIN). */
    function waterSegments(water) {
        var out = {};
        function push(c, a, b) {
            var arr = out[c] || (out[c] = []);
            arr.push(a[0], a[1], b[0], b[1]);
        }
        (water.lines || []).forEach(function (l) {
            for (var i = 0; i + 1 < l.coords.length; i++) push(l.cls, l.coords[i], l.coords[i + 1]);
        });
        (water.polygons || []).forEach(function (p) {
            p.rings.forEach(function (ring) {
                for (var i = 0; i + 1 < ring.length; i++) push(p.cls, ring[i], ring[i + 1]);
            });
        });
        Object.keys(out).forEach(function (c) { out[c] = Float64Array.from(out[c]); });
        return out;
    }

    /** Fraction of valid DEM cells, to reject all-nodata responses (e.g. open sea). */
    function validFraction(elev) {
        var n = 0;
        for (var i = 0; i < elev.length; i++) if (raster.isValidElev(elev[i])) n++;
        return elev.length ? n / elev.length : 0;
    }

    /** Keyed message helper (translated by the UI; `text` is the English fallback). */
    var M = core.msg;

    /** Build a step-log record for a source decision and write it to the diagnostics log. */
    function stepRecord(step, item, outcome, reason, ms) {
        var rec = {
            step: step, provider: item.provider.id, label: item.provider.label,
            endpoint: item.provider.endpoint || null, outcome: outcome,
            reason: reason || null, ms: ms == null ? null : ms
        };
        if (item.provider.version) rec.version = item.provider.version;
        prov.logStep(rec);
        return rec;
    }

    /**
     * Pick the first DEM provider in the plan that returns real terrain at the centre.
     * Probes a small window so an unavailable service fails fast. Resolves { provider, decision }.
     * Warnings (fallbacks, Terrarium, older version) are pushed into `warnings` as keyed messages.
     */
    function pickDemProvider(centre, token, warnings) {
        var plan = prov.demPlan(centre.lat, centre.lon);
        var attempts = [];
        return plan.reduce(function (p, item) {
            return p.then(function (found) {
                if (found) { attempts.push(stepRecord('dem', item, 'skipped', M('skip.earlierUsed', {}, 'an earlier source was used'))); return found; }
                if (!item.use) { attempts.push(stepRecord('dem', item, 'skipped', item.skipReason)); return null; }
                checkToken(token);
                var bb = core.circleBBox(centre.lat, centre.lon, 300);
                var g = raster.gridForBBox(bb, item.provider.nominalResM);
                var t0 = Date.now();
                return item.provider.fetchBlock(g).then(function (elev) {
                    var f = validFraction(elev);
                    if (f < 0.5) throw prov.failure('reason.noData', {}, 'mostly no-data at this location');
                    attempts.push(stepRecord('dem', item, 'used', null, Date.now() - t0));
                    return { provider: item.provider };
                }).catch(function (e) {
                    if (isCancelled(e)) throw e;
                    var reason = (e && e.reason) || M('reason.error', { msg: e && e.message }, String(e && e.message));
                    attempts.push(stepRecord('dem', item, 'failed', reason, Date.now() - t0));
                    return null;
                });
            });
        }, Promise.resolve(null)).then(function (found) {
            if (!found) {
                var tried = attempts.filter(function (a) { return a.outcome === 'failed'; })
                    .map(function (a) { return a.label + ' (' + a.reason.key + ')'; }).join('; ') || 'none';
                throw core.keyedError('err.noDem', { tried: tried },
                    'No elevation source responded for this location. Tried: ' + tried + '.');
            }
            var dem = found.provider;
            var failed = attempts.filter(function (a) { return a.outcome === 'failed'; });
            var decision = { chosen: { id: dem.id, label: dem.label, version: dem.version || null, tier: dem.tier, resM: dem.nominalResM, endpoint: dem.endpoint }, attempts: attempts };
            if (failed.length) {
                // Name the first failed source, its reason, and what was used instead.
                var first = failed[0];
                warnings.push(M('warn.demFallback', { from: first.label, reason: first.reason, to: dem.label },
                    'Elevation source "' + first.label + '" failed; used ' + dem.label + ' instead.'));
            }
            if (dem.tier === 'fallback') {
                // Terrarium as the only possible source (outside EU-DEM coverage) is information, not a warning.
                // Terrarium after an EU-DEM candidate failed inside Europe is still a warning.
                var euDemPossible = plan.some(function (x) { return x.use && x.provider.id !== 'terrarium'; });
                if (euDemPossible) warnings.push(M('warn.demTerrarium', { res: dem.nominalResM }, 'Elevation is Terrarium.'));
                else warnings.push(M('info.demTerrariumOnly', { res: dem.nominalResM }, 'Terrarium is the only elevation source here.'));
            }
            if (dem.version === '1.0') warnings.push(M('warn.demOlder', {}, 'Elevation is EU-DEM v1.0.'));
            return { provider: dem, decision: decision };
        });
    }

    /** Water options passed to every water provider (Strahler map, drainage switch). */
    function waterOptions(params) {
        return { strahlerMap: params.strahlerMap || prov.defaultStrahlerMap(), includeDrainage: !!params.includeDrainage };
    }

    // Conservative payload estimate without allocating a second, huge JSON string.
    function waterCacheBytes(value) {
        var bytes=0,limit=32*1024*1024;
        function count(v) {
            if(bytes>limit)return;
            if(v===null||typeof v!=='object'){bytes+=typeof v==='string'?24+v.length*2:8;return;}
            bytes+=32;
            if(Array.isArray(v)){bytes+=v.length*8;for(var i=0;i<v.length&&bytes<=limit;i++)count(v[i]);return;}
            Object.keys(v).some(function(k){bytes+=16+k.length*2;count(v[k]);return bytes>limit;});
        }
        count(value);return bytes;
    }

    /**
     * Water for a bbox: first available provider in the plan. A failure is non-fatal: the next provider is
     * tried and the failures are reported as warnings. Resolves { water, provider, attempts }.
     */
    function fetchWaterChain(centre, bbox, token, warnings, opts) {
        var plan = prov.waterPlan(centre.lat, centre.lon);
        var attempts = [], failed = [];
        return plan.reduce(function (p, item) {
            return p.then(function (found) {
                if (found) { attempts.push(stepRecord('water', item, 'skipped', M('skip.earlierUsed', {}, 'an earlier source was used'))); return found; }
                if (!item.use) { attempts.push(stepRecord('water', item, 'skipped', item.skipReason)); return null; }
                checkToken(token);
                var t0 = Date.now();
                var cache = opts && opts.trainInputCache;
                var waterOpts = Object.assign({},opts || {});
                delete waterOpts.trainInputCache; delete waterOpts.cacheMetrics;
                var cacheKey = 'water-mobile-v1|' + JSON.stringify([item.provider.id,item.provider.endpoint,prov.CONFIG.euHydro,prov.CONFIG.overpass,bbox,waterOpts]);
                var request = (cache ? cache.get(cacheKey) : Promise.resolve()).then(function(cached){
                    checkToken(token);
                    if (cached) { if(opts.cacheMetrics)opts.cacheMetrics.waterCacheHits++; return cached; }
                    return item.provider.fetchWater(bbox,waterOpts).then(function(res){
                        checkToken(token);
                        if (!cache || (res.meta && res.meta.incompleteTiles)) return res;
                        return cache.put(cacheKey,res,waterCacheBytes(res)).then(function(){return res;});
                    });
                });
                return request.then(function (res) {
                    attempts.push(stepRecord('water', item, 'used', null, Date.now() - t0));
                    return { water: res, provider: item.provider };
                }).catch(function (e) {
                    if (isCancelled(e)) throw e;
                    var reason = (e && e.reason) || M('reason.error', { msg: e && e.message }, String(e && e.message));
                    attempts.push(stepRecord('water', item, 'failed', reason, Date.now() - t0));
                    failed.push({ label: item.provider.label, reason: reason });
                    return null;
                });
            });
        }, Promise.resolve(null)).then(function (found) {
            if (!found) {
                failed.forEach(function (f) { warnings.push(M('warn.waterUnavailable', { src: f.label, reason: f.reason }, 'Water source unavailable.')); });
                warnings.push(M('warn.noWater', {}, 'No water data: the water weight has no effect.'));
                return { water: { lines: [], polygons: [] }, provider: null, attempts: attempts };
            }
            if (failed.length) {
                warnings.push(M('warn.waterFallback', { from: failed[0].label, reason: failed[0].reason, to: found.provider.label }, 'Water source fallback.'));
            }
            if (found.water.meta && found.water.meta.drainage) warnings.push(M('warn.drainageIncluded', {}, 'Drainage network included.'));
            found.attempts = attempts;
            return found;
        });
    }

    function provenanceFor(dem, grid, water, waterProvider, decision) {
        var resM = prov.gridResM(grid);
        return {
            dem: {
                id: dem.id, label: dem.label, source: dem.source, version: dem.version || null, tier: dem.tier,
                nominalResM: dem.nominalResM, cellM: Math.round(resM * 10) / 10, endpoint: dem.endpoint || null,
                resampledForPrediction: resM > dem.nominalResM * 1.05,
                predictionCells: grid.w * grid.h
            },
            demDecision: decision || null,
            water: waterProvider ? { id: waterProvider.id, label: waterProvider.label, source: waterProvider.source, endpoint: waterProvider.endpoint || null } : null
        };
    }

    /** Prediction grid at the DEM resolution, coarsened only when the window is
     * too large to score safely. TRAIN's fixed 50 km window otherwise needs
     * ~18 million 25 m cells and crashes the worker at the heatmap step. */
    function predictionGridFor(bbox, dem, warnings) {
        var nominal = raster.gridForBBox(bbox, dem.nominalResM);
        var grid = raster.boundedGridForBBox(bbox, dem.nominalResM, raster.MAX_PREDICTION_CELLS);
        // A few percent of coarsening at MANUAL's largest radius is not a
        // meaningful resolution change; only report a real trade-off.
        if (grid.w * grid.h < nominal.w * nominal.h && prov.gridResM(grid) > dem.nominalResM * 1.25) {
            warnings.push(M('info.coarsePrediction', { res: Math.round(prov.gridResM(grid)), native: dem.nominalResM },
                'Large prediction window: scored at about ' + Math.round(prov.gridResM(grid)) +
                ' m cells instead of the ' + dem.nominalResM + ' m DEM resolution to keep the heatmap responsive.'));
        }
        return grid;
    }

    /* ── MANUAL ────────────────────────────────────────────────────────────── */
    /**
     * session: { worker, analysisKey, dem, water (rasters) } — kept between runs.
     * params:  { centre, radiusKm, curves, weights, minSlopeDeg, smoothDem, waterClasses,
     *            thresholds, minAreaM2, onProgress, token }
     */
    function runManual(session, params) {
        var warnings = [];
        var radiusM = params.radiusKm * 1000;
        var key = [params.centre.lat.toFixed(5), params.centre.lon.toFixed(5), params.radiusKm, params.smoothDem ? 's' : 'r',
            params.includeDrainage ? 'd' : '-', JSON.stringify(params.strahlerMap || null)].join('|');
        var progress = params.onProgress || function () {};
        var prepare = Promise.resolve();

        if (session.analysisKey !== key || !session.worker) {
            prepare = (function () {
                progress('prog.chooseDem', 5);
                return pickDemProvider(params.centre, params.token, warnings).then(function (pick) {
                    var dem = pick.provider;
                    checkToken(params.token);
                    var bbox = core.circleBBox(params.centre.lat, params.centre.lon, radiusM + BUFFER_M);
                    var grid = predictionGridFor(bbox, dem, warnings);
                    progress('prog.downloadDem', 15, { label: dem.label });
                    // The DEM raster, the water geometry and the UAT protection mask are
                    // three independent network fetches — none needs another's result —
                    // so they run together instead of one after another. That is what
                    // keeps MANUAL/TRAIN from feeling like they "load forever": fetching
                    // them in sequence added their times instead of taking the longest.
                    var demP = prov.loadDemGrid(dem, grid, dem.tilePx || 1000);
                    var waterP = fetchWaterChain(params.centre, bbox, params.token, warnings, waterOptions(params));
                    var exclusionP = startExclusionMask(grid, params.centre.lat, params.centre.lon, radiusM, params);
                    return Promise.all([demP, waterP, exclusionP]).then(function (r) {
                        var elev = r[0], wr = r[1], exclusionResult = r[2];
                        checkToken(params.token);
                        progress('prog.terrain', 60);
                        var masks = rasteriseWater(wr.water, grid);
                        if (session.worker) session.worker.terminate();
                        session.worker = createWorkerClient(params.workerUrl);
                        session.analysisKey = null;
                        return setPredictionAnalysis(session, {
                            grid: grid, elev: elev, smooth: !!params.smoothDem, nodata: undefined,
                            circle: { lat: params.centre.lat, lon: params.centre.lon, radiusM: radiusM },
                            waterMasks: masks, altRef: null, soilRef: null, _exclusionResult: exclusionResult
                        }, params, warnings).then(function (res) {
                            session.analysisKey = session.exclusionStats.unknown ? null : key;
                            session.provenance = provenanceFor(dem, grid, wr.water, wr.provider, pick.decision);
                            session.stats = res.stats;
                            session.waterClasses = Object.keys(masks);
                        });
                    });
                });
            })();
        }

        return prepare.then(function () {
            checkToken(params.token);
            progress('prog.scoring', 85);
            var enabled = params.waterClasses.filter(function (c) { return session.waterClasses.indexOf(c) >= 0; });
            return session.worker.call('score', {
                mode: 'manual',
                curves: params.curves,
                weights: params.weights,
                minSlopeDeg: params.minSlopeDeg,
                preferredAspectDeg: core.preferredAspectDeg(params.centre.lat),
                waterClasses: enabled,
                thresholds: params.thresholds,
                minAreaM2: params.minAreaM2,
                smoothIters: 1
            }).then(function (res) {
                requireScores(res);
                progress('prog.done', 100);
                return {
                    geojson: res.geojson,
                    heatmap: res.heatmap,
                    thresholds: res.thresholds,
                    areaKm2: res.areaKm2,
                    scoreStats: res.scoreStats,
                    provenance: session.provenance,
                    warnings: warnings.slice(),
                    mode: 'manual'
                };
            });
        });
    }

    /* ── TRAIN: background sampling and sample-set assembly (pure) ────────── */
    /** Uniform random points in a disc (metres), excluding a buffer around the given sites. */
    function sampleBackground(centre, radiusM, count, siteList, excludeM, rnd, allowed) {
        rnd = rnd || Math.random;
        var out = [], tries = 0, mpd = core.metresPerDegree(centre.lat);
        var maxTries = count * 20;
        while (out.length < count && tries < maxTries) {
            tries++;
            var r = radiusM * Math.sqrt(rnd()), th = rnd() * 2 * Math.PI;
            var x = r * Math.cos(th), y = r * Math.sin(th);
            var lat = centre.lat + y / mpd.lat, lon = centre.lon + x / mpd.lon;
            var ok = !allowed || allowed(lat, lon);
            for (var s = 0; ok && s < siteList.length; s++) {
                if (core.haversineM(lat, lon, siteList[s].lat, siteList[s].lon) < excludeM) { ok = false; break; }
            }
            if (ok) out.push({ lat: lat, lon: lon, x: x, y: y });
        }
        return out;
    }

    function pointInRing(lon, lat, ring) {
        var inside = false;
        for (var i=0,j=ring.length-1;i<ring.length;j=i++) {
            var a=ring[i],b=ring[j];
            if (((a[1]>lat)!==(b[1]>lat)) && lon < (b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
        }
        return inside;
    }
    function polygonAreaM2(rings, atLat) {
        if (!rings || !rings.length || !rings[0].length) return 0;
        var sx=111320*Math.cos((atLat||0)*Math.PI/180), sy=110574, ring=rings[0],sum=0;
        for(var i=0;i<ring.length;i++){var a=ring[i],b=ring[(i+1)%ring.length];sum+=(a[0]*sx)*(b[1]*sy)-(b[0]*sx)*(a[1]*sy);}
        return Math.abs(sum/2);
    }
    function waterReason(lon,lat,water,cfg) {
        for(var i=0;i<(water.polygons||[]).length;i++){
            var p=water.polygons[i],rings=p.rings||[],label=String(p.name||'')+' '+String(p.type||'')+' '+String(p.water||'');
            var explicitlyWater=/water|lake|sea|ocean/i.test(label);
            if(!explicitlyWater&&polygonAreaM2(rings,lat)<cfg.waterPolygonMinAreaM2)continue;
            if(!rings.length||!pointInRing(lon,lat,rings[0]))continue;
            var inHole=false;for(var h=1;h<rings.length;h++)if(pointInRing(lon,lat,rings[h])){inHole=true;break;}
            if(inHole)continue;
            var marine=/sea|ocean|marine/i.test(String(p.name||p.type||p.water||''));
            return marine?'sea':'large-water-polygon';
        }
        return null;
    }
    function filterTrainingSites(pts, water, grid, cfg) {
        cfg=Object.assign({},TRAIN_ROBUST_CONFIG,cfg||{});
        var seen=Object.create(null),kept=[],excluded={sea:0,largeWaterPolygon:0,outsideDem:0,noData:0,duplicate:0},details=[];
        (pts||[]).forEach(function(p){
            if(!p.isSite){kept.push(p);return;}
            var reason=null,cell=raster.cellOf(grid,p.lon,p.lat);
            if(cell<0)reason='outside-dem';
            else {
                var wr=waterReason(p.lon,p.lat,water||{},cfg);
                if(wr)reason=wr;
                else if(!p.valid)reason='no-data';
                else {var key=Number(p.lat).toFixed(8)+','+Number(p.lon).toFixed(8)+'|'+String(p.name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();if(seen[key])reason='duplicate';else seen[key]=true;}
            }
            if(!reason){kept.push(p);return;}
            var k=reason==='outside-dem'?'outsideDem':reason==='no-data'?'noData':reason==='large-water-polygon'?'largeWaterPolygon':reason;
            excluded[k]++;details.push({id:p.id||null,lat:p.lat,lon:p.lon,reason:reason});
        });
        return {points:kept,excluded:excluded,details:details,total:Object.keys(excluded).reduce(function(a,k){return a+excluded[k];},0)};
    }

    /**
     * Assemble the sample set used by core.trainModelFromSamples.
     * pts: [{ lat, lon, x, y, isSite, elev, slope, aspect, curv, valid, water:{class: metres} }]
     * Altitude and soil become percentiles relative to the BACKGROUND distribution (reference window).
     */
    function buildSampleSet(pts, opts) {
        var minSlope = opts.minSlopeDeg == null ? 0.5 : opts.minSlopeDeg;
        var waterClasses = opts.waterClasses || [];
        var keep = pts.filter(function (p) {
            return p.valid && isFinite(p.elev) && isFinite(p.slope) && isFinite(p.curv);
        });
        var bg = keep.filter(function (p) { return !p.isSite; });
        var altRef = raster.sortedFinite(bg.map(function (p) { return p.elev; }));
        var soilRef = raster.sortedFinite(bg.map(function (p) { return p.curv; }));
        var n = keep.length;
        var S = { n: n, y: new Uint8Array(n), fold: new Uint8Array(n), vals: {} };
        ['altitude', 'slope', 'aspect', 'soil'].forEach(function (k) { S.vals[k] = new Float64Array(n); });
        waterClasses.forEach(function (c) { S.vals['water_' + c] = new Float64Array(n); });
        for (var i = 0; i < n; i++) {
            var p = keep[i];
            S.y[i] = p.isSite ? 1 : 0;
            S.fold[i] = core.spatialFold(p.x, p.y, opts.radiusM, opts.folds || 5, 4);
            S.vals.altitude[i] = raster.percentileOf(altRef, p.elev);
            S.vals.slope[i] = p.slope;
            S.vals.aspect[i] = p.slope >= minSlope ? p.aspect : NaN;   // aspect undefined on flat ground
            S.vals.soil[i] = raster.percentileOf(soilRef, p.curv);
            waterClasses.forEach(function (c) {
                var d = p.water ? p.water[c] : NaN;
                S.vals['water_' + c][i] = d == null ? NaN : d;
            });
        }
        var sitesN = 0;
        for (i = 0; i < n; i++) if (S.y[i]) sitesN++;
        return { S: S, samples: keep, altRef: altRef, soilRef: soilRef, waterClasses: waterClasses.slice(), counts: { sites: sitesN, background: n - sitesN } };
    }

    /* ── TRAIN ─────────────────────────────────────────────────────────────── */
    /**
     * Settlement pool for a centre: filters positions and types, retaining individual occupation phases.
     * Returns { pool, periods, dropped } — periods are offered to the user.
     */
    function sitePool(records, centre) {
        var pool = sites.filterSites(records, { center: centre, radiusKm: TRAIN_AREA_KM, period: null, dedupeM: records._meta && !records._meta.outsideRomania ? -1 : 50 });
        return { pool: pool.sites, periods: sites.groupPeriods(pool.sites), dropped: pool.dropped };
    }

    /**
     * Site-count status for TRAIN: 'block' below minSites (run refused), 'warn' below warnSites, else 'ok'.
     * Shared by the UI and the tests so the thresholds live in one place.
     */
    function trainSiteStatus(n, minSites, warnSites) {
        minSites = minSites == null ? 10 : minSites;
        warnSites = warnSites == null ? 30 : warnSites;
        if (!(n >= minSites)) return { status: 'block', n: n, min: minSites, rec: warnSites };
        if (n < warnSites) return { status: 'warn', n: n, min: minSites, rec: warnSites };
        return { status: 'ok', n: n, min: minSites, rec: warnSites };
    }

    /**
     * params: { centre, records, period:{key,label,start,end}|null, radiusKm, curves?, waterClasses,
     *           bgCount=5000, minSlopeDeg, smoothDem, thresholds? , minAreaM2, minSites=10, warnSites=30,
     *           onProgress, token, workerUrl, rnd }
     */
    function runTrain(session, params) {
        var isHoard = params.category === 'hoards';
        if (isHoard && !hoards.trainingAllowed()) return Promise.reject(core.keyedError('hoard.pending', {}, 'Hoard source review and live performance validation are pending.'));
        if (isHoard && !(params.radiusKm >= 1 && params.radiusKm <= 10)) return Promise.reject(new Error('Hoard prediction radius must be 1–10 km'));
        var warnings = [];
        // An operator override is never silent: it travels with the result.
        if (isHoard && hoards.overridden()) warnings.push(M('warn.hoardOverride', { reviews: hoards.openReviews().length },
            'Operator override: this hoard model ran while ' + hoards.openReviews().length + ' of 4 reviews are open. Treat it as provisional.'));
        var progress = params.onProgress || function () {};
        var centre = params.centre;
        var siteMeta = params.records && params.records._meta;
        if (siteMeta && siteMeta.areaCrossesBorder) warnings.push(M('warn.romaniaBorder', {}, 'The 50 km training area crosses Romania’s border; background samples are restricted to Romania and sites outside the dataset are unavailable.'));
        if (siteMeta && siteMeta.truncated) warnings.push(M('train.truncated', {}, 'The server returned a truncated site subset.'));
        if (siteMeta && siteMeta.includeEmptyCoord) warnings.push(M('train.emptyIncluded', {}, 'Unknown-position records are opted in.'));
        var radiusM = params.radiusKm * 1000;
        var areaM = (isHoard ? hoardConfig.trainingRadiusKm : TRAIN_AREA_KM) * 1000;
        var sel = isHoard ? hoardProvider.filter(params.records, centre, params.period) : sites.filterSites(params.records, { center: centre, radiusKm: TRAIN_AREA_KM, period: params.period, dedupeM: -1 });
        var nSites = sel.sites.length;
        var minSites = params.minSites || 10, warnSites = params.warnSites || 30;
        if (trainSiteStatus(nSites, minSites, warnSites).status === 'block') {
            var err = core.keyedError('err.tooFewSites', { n: nSites, min: minSites },
                'Only ' + nSites + ' usable known sites for this period (minimum ' + minSites + ').');
            err.code = 'too_few_sites';
            return Promise.reject(err);
        }
        if (nSites < warnSites) warnings.push(M('warn.fewSites', { n: nSites, rec: warnSites }, 'Only ' + nSites + ' sites.'));
        checkToken(params.token);
        if (session.worker) { session.worker.terminate(); session.worker = null; }
        session.analysisKey = null; session.trainCache = null;
        var trainWorker;
        var mobile = params.mobileProfile == null ? mobileTrainProfile() : !!params.mobileProfile;
        var metrics = { mobile: mobile, demCacheHits: 0, demDownloads: 0, waterCacheHits: 0, maxSampleTileCells: 0, sampleTilePx: 0 };
        var inputCache = !isHoard && params.cacheInputs !== false ? trainInputs : null;

        var bg;
        if (isHoard && params.backgroundType === 'known-sites') {
            if (!params.knownSites || params.knownSites.truncated || !params.knownSites.rows.length) return Promise.reject(core.keyedError('hoard.noBackground', {}, 'Complete known-site comparison data is unavailable. Choose random backgrounds.'));
            var mp = core.metresPerDegree(centre.lat);
            bg = params.knownSites.rows.filter(function(p){return core.haversineM(centre.lat,centre.lon,p.lat,p.lon)<=areaM && !sel.sites.some(function(q){return core.haversineM(p.lat,p.lon,q.lat,q.lon)<BG_EXCLUDE_M;});}).map(function(p){return {lat:p.lat,lon:p.lon,x:(p.lon-centre.lon)*mp.lon,y:(p.lat-centre.lat)*mp.lat};});
        } else {
            // The Romania-only background predicate answers "is this point inside the
            // national repertory's territory?". It is correct while that repertory is the
            // site source. Outside Romania the training box is, by definition, outside it,
            // so applying the predicate rejects every candidate: the model then had zero
            // background samples and died with the internal "Logistic fit needs both site
            // and background samples." That is a bug, not a data problem. Backgrounds
            // outside Romania are terrain samples from the same 50 km box.
            var outsideRomania = !!(siteMeta && siteMeta.region === 'outside-romania');
            if (outsideRomania) warnings.push(M('warn.outsideBackground', {},
                'Sites came from the external catalogues queried for this area. Background points are terrain samples from the same 50 km box, not a national repertory.'));
            bg = sampleBackground(centre, areaM, params.bgCount || 5000, sel.sites, BG_EXCLUDE_M, params.rnd,
                outsideRomania ? null : params.backgroundAllowed);
        }
        if (!bg.length) return Promise.reject(core.keyedError('err.noBackground', {},
            'No background samples could be placed inside the 50 km training area.'));
        var pts = sel.sites.map(function (s) {
            var mpd = core.metresPerDegree(centre.lat);
            return { id: s.id, name: s.name, lat: s.lat, lon: s.lon, x: (s.lon - centre.lon) * mpd.lon, y: (s.lat - centre.lat) * mpd.lat, isSite: true, positionAccuracy: s.positionAccuracy };
        }).concat(bg.map(function (b) { return { lat: b.lat, lon: b.lon, x: b.x, y: b.y, isSite: false }; }));

        // Optional read-only, bounded loading preview. Observer errors never fail TRAIN.
        var previewCount = !isHoard && typeof params.onPreview === 'function' ? Math.min(4, nSites) : 0;
        function preview(event) {
            if (!previewCount || typeof params.onPreview !== 'function') return;
            try { params.onPreview(event); } catch (ignore) { params.onPreview = null; }
        }
        if (previewCount) preview({ type: 'start', total: nSites, limit: previewCount });

        var bbox = core.circleBBox(centre.lat, centre.lon, areaM + 1000);
        var dem, cachedDem, demCoverage = null, demDecision = null, grid, water = { water: null, provider: null }, classes = [];
        function fetchTrainBlock(g) {
            var key = 'dem-mobile-v1|' + JSON.stringify([dem.id,dem.version,dem.endpoint,demCoverage,dem.nominalResM,g]);
            return (inputCache ? inputCache.get(key) : Promise.resolve()).then(function(buf){
                checkToken(params.token);
                if (buf && buf.byteLength === g.w*g.h*4) { metrics.demCacheHits++; return new Float32Array(buf); }
                metrics.demDownloads++;
                return dem.fetchBlock(g).then(function(elev){
                    checkToken(params.token);
                    return (inputCache ? inputCache.put(key,elev.buffer,elev.byteLength) : Promise.resolve()).then(function(){return elev;});
                });
            });
        }
        return pickDemProvider(centre, params.token, warnings).then(function (pick) {
            checkToken(params.token);
            dem = pick.provider;
            cachedDem = {fetchBlock: fetchTrainBlock};
            demDecision = pick.decision;
            // Site/background sampling stays close to the DEM resolution, but the
            // 50 km tile grid is bounded so it does not fan out into dozens of
            // full-size WCS tiles (one per 1000x1000 block).
            grid = isHoard ? hoardScale.grid(bbox, centre, hoardConfig.resolutionM) : raster.boundedGridForBBox(bbox, dem.nominalResM, raster.MAX_SAMPLING_CELLS);
            progress(isHoard ? 'hoard.waterTrain' : 'prog.waterTrain', 8);
            var options = waterOptions(params);
            options.trainInputCache = inputCache; options.cacheMetrics = metrics;
            return Promise.resolve(typeof dem.discover==='function'?dem.discover():null).then(function(coverage){
                checkToken(params.token);demCoverage=coverage&&coverage.id;
                return fetchWaterChain(centre, bbox, params.token, warnings, options);
            });
        }).then(function (wr) {
            checkToken(params.token);
            water = wr;
            var segs = waterSegments(wr.water);
            classes = Object.keys(segs);
            if (session.worker) session.worker.terminate();
            session.worker = trainWorker = createWorkerClient(params.workerUrl);
            session.analysisKey = null;
            return trainWorker.call('setWater', { classes: segs }, Object.keys(segs).map(function(c){return segs[c].buffer;}));
        }).then(function () {
            // Map every point to its DEM tile (1000 px cores), then sample tile by tile.
            var tilePx = isHoard ? 128 : Math.min(dem.tilePx || 1000, mobile ? 512 : 1000);
            metrics.sampleTilePx = tilePx;
            var tileOf = new Map();
            pts.forEach(function (p, idx) {
                var c = raster.cellOf(grid, p.lon, p.lat);
                if (c < 0) return;
                var i = c % grid.w, j = Math.floor(c / grid.w);
                var key = Math.floor(j / tilePx) + ',' + Math.floor(i / tilePx);
                if (!tileOf.has(key)) tileOf.set(key, []);
                tileOf.get(key).push(idx);
            });
            var results = new Array(pts.length);
            var keys = Array.from(tileOf.keys());
            var done = 0;
            progress('prog.sampling', 15, { pct: 0 });
            return keys.reduce(function (pr, key) {
                return pr.then(function () {
                    checkToken(params.token);
                    var parts = key.split(',').map(Number);
                    var j0 = parts[0] * tilePx, i0 = parts[1] * tilePx;
                    var cw = Math.min(grid.w - i0, tilePx), ch = Math.min(grid.h - j0, tilePx);
                    var spacing = isHoard ? hoardScale.spacing(grid) : raster.gridSpacingM(grid);
                    var ids = tileOf.get(key), radius = isHoard ? Math.max.apply(null, ids.map(function(pi){return hoardScale.pointRadius(pts[pi],60);}).concat([BUFFER_M])) : TRAIN_ROBUST_CONFIG.positionRadiusM;
                    var pad = Math.max(1, Math.ceil(radius / Math.min(spacing.dx, spacing.dy))) + (isHoard ? 2 : (params.smoothDem ? 2 : 1));
                    var hg = prov.subGrid(grid, i0 - pad, j0 - pad, cw + 2 * pad, ch + 2 * pad);
                    var cacheKey = 'hoard-dem-v1|' + dem.id + '|' + JSON.stringify(hg);
                    metrics.maxSampleTileCells = Math.max(metrics.maxSampleTileCells,hg.w*hg.h);
                    var download = isHoard ? prov.cacheGet(cacheKey).then(function(cached){return cached ? new Float32Array(cached.value || cached) : dem.fetchBlock(hg).then(function(e){return prov.cacheSet(cacheKey,e.buffer.slice(0)).then(function(){return e;});});}) : fetchTrainBlock(hg);
                    return download.then(function (elev) {
                        checkToken(params.token);
                        var idxs = tileOf.get(key);
                        var flat = new Float64Array(idxs.length * 2), siteMask = new Uint8Array(idxs.length);
                        idxs.forEach(function (pi, k) { flat[2 * k] = pts[pi].lon; flat[2 * k + 1] = pts[pi].lat; siteMask[k] = pts[pi].isSite ? 1 : 0; });
                        var tileWater = isHoard ? rasteriseWater(water.water,hg) : null;
                        var transfer = [elev.buffer,flat.buffer,siteMask.buffer];
                        Object.keys(tileWater || {}).forEach(function(c){transfer.push(tileWater[c].buffer);});
                        return trainWorker.call('sampleTile', {
                            elev: elev, w: hg.w, h: hg.h, dxM: spacing.dx, dyM: spacing.dy, positionRadiusM: TRAIN_ROBUST_CONFIG.positionRadiusM, siteMask: siteMask,
                            tile: { west: hg.west, north: hg.north, dLon: hg.dLon, dLat: hg.dLat },
                            smooth: !!params.smoothDem, nodata: undefined, points: flat,
                            positionRadii: isHoard ? idxs.map(function(pi){return hoardScale.pointRadius(pts[pi],60);}) : null,
                            waterMasks: tileWater,
                            previewIndices: previewCount && typeof params.onPreview === 'function' ? idxs.reduce(function(a, pi, k) { if (pi < previewCount) a.push(k); return a; }, []) : undefined,
                            previewWaterClasses: previewCount ? params.waterClasses : undefined
                        }, transfer).then(function (r) {
                            idxs.forEach(function (pi, k) {
                                var o = k * 5;
                                var water = {};
                                r.classes.forEach(function (c) { water[c] = r.water[c][k]; });
                                results[pi] = {
                                    elev: r.values[o], slope: r.values[o + 1], aspect: r.values[o + 2],
                                    curv: r.values[o + 3], valid: r.inside[k] && r.values[o + 4] === 1, water: water
                                };
                            });
                            if (previewCount && typeof params.onPreview === 'function') (r.previews || []).forEach(function (sample) {
                                var pi = idxs[sample.index], point = pts[pi];
                                if (pi < previewCount && point) preview(Object.assign({}, sample, { type: 'sample', index: pi, id: point.id,
                                    name: point.name, lat: point.lat, lon: point.lon, minSlopeDeg: params.minSlopeDeg }));
                            });
                            done += idxs.length;
                            progress('prog.sampling', 15 + Math.round(45 * done / pts.length), { pct: Math.round(100 * done / pts.length) });
                        });
                    });
                });
            }, Promise.resolve()).then(function () {
                var merged = pts.map(function (p, i) {
                    var r = results[i] || { valid: false };
                    return Object.assign({}, p, r);
                });
                var hard = filterTrainingSites(merged, water.water, grid, TRAIN_ROBUST_CONFIG);
                var built = buildSampleSet(hard.points, {
                    minSlopeDeg: params.minSlopeDeg, radiusM: areaM, folds: 5, waterClasses: params.waterClasses.filter(function (c) { return classes.indexOf(c) >= 0; })
                });
                if (previewCount && typeof params.onPreview === 'function') for (var pi = 0; pi < previewCount; pi++) {
                    var sampleIndex = built.samples.indexOf(merged[pi]);
                    preview({ type: 'reference', index: pi, included: sampleIndex >= 0,
                        soilPercentile: sampleIndex >= 0 ? built.S.vals.soil[sampleIndex] : null,
                        altitudePercentile: sampleIndex >= 0 ? built.S.vals.altitude[sampleIndex] : null,
                        aspectUsed: sampleIndex >= 0 && isFinite(built.S.vals.aspect[sampleIndex]) });
                }
                if (!built.counts.background || !built.counts.sites) {
                    throw core.keyedError('err.noBackgroundSamples', { sites: built.counts.sites, background: built.counts.background },
                        'After terrain sampling the sample set has ' + built.counts.sites + ' sites and ' + built.counts.background + ' background points; a fit needs both.');
                }
                if (built.counts.sites < minSites) {
                    var e2 = core.keyedError('err.tooFewTerrain', { n: built.counts.sites, min: minSites },
                        'After terrain sampling only ' + built.counts.sites + ' sites had valid terrain (minimum ' + minSites + ').');
                    e2.code = 'too_few_sites';
                    throw e2;
                }
                checkToken(params.token);
                progress('prog.train', 65);
                return trainWorker.call('train', {
                    releaseWater: true, S: built.S, waterClasses: built.waterClasses,
                    minSlopeDeg: params.minSlopeDeg, folds: 5, robustConfig: TRAIN_ROBUST_CONFIG
                }).then(function (tr) {
                    return { train: tr.result, built: built, hardExcluded: hard, warnings: warnings };
                });
            });
        }).then(function (t) {
            checkToken(params.token);
            // Prediction window (search circle + buffer) with the same DEM provider.
            progress('prog.window', 80);
            var wb = core.circleBBox(centre.lat, centre.lon, radiusM + BUFFER_M);
            var wgrid = isHoard ? hoardScale.grid(wb, centre, hoardConfig.resolutionM) : predictionGridFor(wb, dem, warnings);
            if (isHoard) hoardScale.assertSame(grid,wgrid);
            // The prediction DEM raster and the UAT protection mask (often ~hundreds
            // of tiles for a 50 km TRAIN window) do not depend on each other: fetch
            // them together instead of the mask waiting for the DEM to finish first.
            var demP = prov.loadDemGrid(cachedDem, wgrid, Math.min(dem.tilePx || 1000, mobile ? 512 : 1000));
            var exclusionP = startExclusionMask(wgrid, centre.lat, centre.lon, radiusM, params);
            return Promise.all([demP, exclusionP]).then(function (r) {
                var elev = r[0], exclusionResult = r[1];
                var masks = rasteriseWater(water.water, wgrid);
                return setPredictionAnalysis(session, {
                    grid: wgrid, spacing: isHoard ? hoardScale.spacing(wgrid) : null, elev: elev, smooth: !!params.smoothDem, nodata: undefined,
                    circle: { lat: centre.lat, lon: centre.lon, radiusM: radiusM },
                    waterMasks: masks,
                    altRef: t.built.altRef, soilRef: t.built.soilRef, _exclusionResult: exclusionResult
                }, params, warnings).then(function (res) {
                    session.analysisKey = null;
                    session.provenance = provenanceFor(dem, wgrid, water.water, water.provider, demDecision);
                    if (params.siteSource) session.provenance.sites = params.siteSource;
                    session.stats = res.stats;
                    session.waterClasses = Object.keys(masks);
                    return t;
                });
            });
        }).then(function (t) {
            checkToken(params.token);
            progress('prog.scoring', 90);
                var tr = t.train;
                var thr = tr.thresholds;
                if(tr.robust.skipped)warnings.push(M('warn.robustSkipped',{n:tr.robust.siteCount,min:TRAIN_ROBUST_CONFIG.minSites},'Robust fitting was skipped: too few sites.'));
                if(tr.robust.possibleSecondPattern.length)warnings.push(M('warn.secondPattern',{n:tr.robust.possibleSecondPattern.length},'A coherent alternate site pattern was preserved, not down-weighted.'));
                if(tr.robust.weightChange>=TRAIN_ROBUST_CONFIG.weightChangeWarning)warnings.push(M('warn.weightShift',{v:(100*tr.robust.weightChange).toFixed(0)},'Robust fitting materially changed the learned variable weights.'));
                var robustSites=tr.robust.flagged.map(function(x){var p=t.built.samples[x.index]||{};return {id:p.id||null,sampleIndex:x.index,lat:p.lat,lon:p.lon,weight:x.weight,reason:x.reason};});
            return trainWorker.call('score', {
                mode: 'train', model: tr.model, waterClasses: t.built.waterClasses,
                thresholds: thr, minAreaM2: params.minAreaM2, smoothIters: 1
            }).then(function (res) {
                requireScores(res);
                progress('prog.done', 100);
                var periodCount = sel.sites.length;
                var output = {
                    mode: 'train',
                    geojson: res.geojson,
                    heatmap: res.heatmap,
                    thresholds: res.thresholds,
                    areaKm2: res.areaKm2,
                    scoreStats: res.scoreStats,
                    provenance: session.provenance,
                    warnings: warnings.slice(),   // t.warnings is the same array; do not duplicate every note
                    diagnostics: {
                        siteData: siteMeta || null,
                        performance: metrics,
                        category: isHoard ? 'hoards' : 'settlements', analysisResolutionM: isHoard ? hoardConfig.resolutionM : null, backgroundType: params.backgroundType || 'random',
                        sitesUsed: t.built.counts.sites,
                        sitesInAreaBeforeExclusions: periodCount,
                        hardExcluded: t.hardExcluded.excluded,
                        hardExcludedTotal: t.hardExcluded.total,
                        positionMedianRadiusM: TRAIN_ROBUST_CONFIG.positionRadiusM,
                        hardExcludedDetails: t.hardExcluded.details,
                        downweightedSites: robustSites,
                        robustSkipped: tr.robust.skipped,
                        possibleSecondPattern: tr.robust.possibleSecondPattern.map(function(i){var p=t.built.samples[i]||{};return {id:p.id||null,lat:p.lat,lon:p.lon};}),
                        robustIterations: tr.robust.iterations,
                        weightChange: tr.robust.weightChange,
                        sitesInSample: t.built.counts.sites,
                        backgroundUsed: t.built.counts.background,
                        dropped: sel.dropped,
                        weights: tr.model.weights,
                        curves: tr.model.curves,
                        cv: tr.cv,
                        cvRobust: tr.cv,
                        cvPlain: tr.cvPlain,
                        soilSlopeR: tr.soilSlopeR,
                        excluded: tr.excluded,
                        variables: tr.variables,
                        confidence: tr.confidence,
                        thresholds: thr,
                        noSignal: tr.model.noSignal
                    }
                };
                if(session.trainCache)session.trainCache.output=output;
                return output;
            });
        }).catch(function(error){
            if(trainWorker){
                trainWorker.terminate();
                if(session.worker===trainWorker){session.worker=null;session.analysisKey=null;}
            }
            throw error;
        });
    }

    function rerunTrain(session, restoredIndices) {
        var cache=session&&session.trainCache;if(!cache||!cache.output||!session.worker) return Promise.reject(new Error('TRAIN cached samples are unavailable; run TRAIN again first.'));
        cache.restoredIndices=Array.from(new Set((restoredIndices||[]).map(Number)));
        var config=Object.assign({},cache.robustConfig,{restoredIndices:cache.restoredIndices});
        return session.worker.call('train',{S:cache.S,waterClasses:cache.waterClasses,minSlopeDeg:cache.minSlopeDeg,folds:5,robustConfig:config}).then(function(reply){
            var tr=reply.result;
            return session.worker.call('score',{mode:'train',model:tr.model,waterClasses:cache.waterClasses,thresholds:tr.thresholds,minAreaM2:cache.minAreaM2,smoothIters:1}).then(function(scored){
                requireScores(scored);
                var out=Object.assign({},cache.output),d=Object.assign({},out.diagnostics),robustSites=tr.robust.flagged.map(function(x){var p=cache.built.samples[x.index]||{};return {id:p.id||null,sampleIndex:x.index,lat:p.lat,lon:p.lon,weight:x.weight,reason:x.reason};});
                d.weights=tr.model.weights;d.curves=tr.model.curves;d.cv=tr.cv;d.cvRobust=tr.cv;d.cvPlain=tr.cvPlain;d.downweightedSites=robustSites;d.robustSkipped=tr.robust.skipped;d.possibleSecondPattern=tr.robust.possibleSecondPattern.map(function(i){var p=cache.built.samples[i]||{};return {id:p.id||null,sampleIndex:i,lat:p.lat,lon:p.lon};});d.robustIterations=tr.robust.iterations;d.weightChange=tr.robust.weightChange;d.thresholds=tr.thresholds;d.confidence=tr.confidence;
                out.geojson=scored.geojson;out.heatmap=scored.heatmap;out.thresholds=scored.thresholds;out.areaKm2=scored.areaKm2;out.scoreStats=scored.scoreStats;out.diagnostics=d;
                out.warnings=(out.warnings||[]).filter(function(w){return !w||!['warn.robustSkipped','warn.secondPattern','warn.weightShift'].includes(w.key);});
                if(tr.robust.skipped)out.warnings.push(core.msg('warn.robustSkipped',{n:tr.robust.siteCount,min:TRAIN_ROBUST_CONFIG.minSites},'Robust outlier handling was skipped.'));
                if(tr.robust.possibleSecondPattern.length)out.warnings.push(core.msg('warn.secondPattern',{n:tr.robust.possibleSecondPattern.length},'A possible second pattern was preserved.'));
                if(tr.robust.weightChange>=TRAIN_ROBUST_CONFIG.weightChangeWarning)out.warnings.push(core.msg('warn.weightShift',{v:(100*tr.robust.weightChange).toFixed(0)},'Robust fitting materially changed weights.'));
                cache.output=out;return out;
            });
        });
    }

    return {
        BUFFER_M: BUFFER_M,
        TRAIN_AREA_KM: TRAIN_AREA_KM,
        createWorkerClient: createWorkerClient,
        mobileTrainProfile: mobileTrainProfile,
        isCancelled: isCancelled,
        cancelledError: cancelledError,
        rasteriseWater: rasteriseWater,
        waterSegments: waterSegments,
        sampleBackground: sampleBackground,
        filterTrainingSites: filterTrainingSites,
        trainRobustConfig: TRAIN_ROBUST_CONFIG,
        buildSampleSet: buildSampleSet,
        sitePool: sitePool,
        trainSiteStatus: trainSiteStatus,
        runManual: runManual,
        runTrain: runTrain,
        rerunTrain: rerunTrain,
        pickDemProvider: pickDemProvider,
        fetchWaterChain: fetchWaterChain,
        waterOptions: waterOptions
    };
});
