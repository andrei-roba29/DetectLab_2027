/*!
 * ARIADNE provider for APM Next Gen.
 *
 * Roles are FIXED, not user switches:
 *   settlement mode + centre outside Romania → positive training sites
 *   hoard mode      + centre outside Romania → known-site comparison only
 *   any centre inside Romania                → never used
 *
 * Data path, as verified against the portal:
 *   · small boxes return hits (one page, no paging) — usable only with a geopoint
 *   · 50–150 km boxes return hits: [] and a geohash-7 cell grid (~152 m) capped at
 *     exactly 5000 cells. A capped answer is incomplete: the box is split into four
 *     quadrants and retried, recursively, up to `maxDepth`, deduplicating by cell key.
 *
 * The settlement role additionally requires the captured site-type/period filter
 * fragments: without them the grid cannot be restricted to sites, so the role stays
 * blocked rather than guessing.
 *
 * The upstream call is delegated to one injected function (ariadne-upstream.js), so
 * 'server' vs 'browser' changes nothing here.
 *
 * NOT VERIFIED against the live host from this environment.
 */
(function (root, factory) {
    var node = typeof module === 'object' && module.exports;
    var api = factory(
        node ? require('./ariadne.config.js') : root.DetectLabAriadneConfig,
        node ? require('./ariadne-tiles.js') : root.DetectLabAriadneTiles,
        node ? require('./ariadne-parse.js') : root.DetectLabAriadneParse,
        node ? require('./ariadne-query.js') : root.DetectLabAriadneQuery,
        node ? require('./ariadne-upstream.js') : root.DetectLabAriadneUpstream
    );
    if (node) module.exports = api;
    else root.DetectLabAriadneProvider = api;
})(typeof self !== 'undefined' ? self : this, function (defaults, tiles, parse, query, upstream) {
    'use strict';

    function err(key, message) { var e = new Error(message); e.key = key; return e; }

    function createProvider(options) {
        options = options || {};
        var config = Object.assign({}, defaults, options.config || {});
        var transport = options.transport || upstream.create(config, options.deps);
        var call = transport.call.bind(transport);
        var now = options.now || function () { return Date.now(); };
        var cache = options.cache || (function () {
            var map = new Map();
            return {
                map: map,
                get: function (k) { var v = map.get(k); return v && v.expires > now() ? v.value : null; },
                set: function (k, v) { map.set(k, { value: v, expires: now() + config.cacheTtlMs }); },
                clear: function () { map.clear(); }
            };
        })();
        var insideRomania = options.insideRomania || function (lat, lon) { return tiles.insidePolygon(lat, lon, config.romania); };

        /** The fixed role for a mode and a centre. Never a user choice. */
        function roleFor(appMode, centre) {
            if (!centre || !Number.isFinite(centre.lat) || !Number.isFinite(centre.lon)) return { role: 'disabled', reason: 'invalid-centre' };
            if (insideRomania(centre.lat, centre.lon)) return { role: 'disabled', reason: 'romania-excluded' };
            if (appMode === 'settlement') {
                if (!query.filtersConfigured(config)) return { role: 'disabled', reason: 'filters-not-configured' };
                return { role: config.roles.settlement };
            }
            if (appMode === 'hoard') return { role: config.roles.hoard };
            return { role: 'disabled', reason: 'unknown-app-mode' };
        }

        function cacheKey(centre, radiusKm, appMode) {
            return [appMode, centre.lat.toFixed(3), centre.lon.toFixed(3), Math.round(radiusKm)].join('|');
        }

        async function search(centre, radiusKm, appMode, signal) {
            var decision = roleFor(appMode, centre);
            if (decision.role === 'disabled') {
                return { records: [], cells: [], meta: baseMeta(centre, radiusKm, appMode, decision) };
            }
            radiusKm = Math.min(Math.abs(radiusKm) || 0, config.maxRadiusKm);
            if (!(radiusKm > 0)) throw err('ariadne.invalid', 'Invalid radius');

            var key = cacheKey(centre, radiusKm, appMode);
            var cached = cache.get(key);
            if (cached) { cached.meta.cached = true; return cached; }

            var stats = { requests: 0, bytes: 0, upstreamMs: 0, tilesPlanned: 0, tilesDone: 0, capped: 0, incomplete: false };
            var cellMap = new Map();
            var hits = [];
            var rejected = {};
            var subjects = {}, temporal = {};
            var started = now();
            var root = tiles.boxAround(centre, radiusKm);
            var queue = tiles.splitToMaxSide(root, config.maxSideKm).map(function (box) { return { box: box, depth: 0 }; });
            stats.tilesPlanned = queue.length;

            while (queue.length) {
                if (stats.requests >= config.maxRequests) { stats.incomplete = true; break; }
                var tile = queue.shift();
                var params = query.buildParams(config, { box: tile.box });
                var res = await call(params, { signal: signal });
                stats.requests++;
                stats.bytes += res.bytes || 0;
                stats.upstreamMs += res.ms || 0;
                var parsed = parse.parseResponse(res.json);
                Object.keys(parsed.rejected).forEach(function (k) { rejected[k] = (rejected[k] || 0) + parsed.rejected[k]; });
                parsed.buckets.subjects.forEach(function (b) { subjects[b.key] = (subjects[b.key] || 0) + b.count; });
                parsed.buckets.temporal.forEach(function (b) { temporal[b.key] = (temporal[b.key] || 0) + b.count; });
                hits = hits.concat(parsed.hits);

                var capped = parse.isCapped(parsed.cells.length, config.cellCap);
                if (capped && tile.depth < config.maxDepth) {
                    stats.capped++;
                    tiles.quadrants(tile.box).forEach(function (q) { queue.push({ box: q, depth: tile.depth + 1 }); });
                    stats.tilesPlanned += 4;
                    continue;
                }
                if (capped) { stats.capped++; stats.incomplete = true; }
                stats.tilesDone++;
                parsed.cells.forEach(function (cell) {
                    if (config.scopeBoxes && !tiles.insideBox(tile.box, cell.lat, cell.lon)) return;
                    var existing = cellMap.get(cell.key);
                    if (!existing || cell.count > existing.count) cellMap.set(cell.key, cell);
                });
            }

            // The disc is the truth, the rectangle is only how we asked.
            var cells = [];
            cellMap.forEach(function (cell) {
                if (tiles.distanceM(centre, cell) <= radiusKm * 1000 + 1) cells.push(cell);
            });
            cells.sort(function (a, b) { return tiles.distanceM(centre, a) - tiles.distanceM(centre, b) || a.key.localeCompare(b.key); });

            var records;
            if (hits.length) {
                // Small box: precise points, one page, as the portal returns them.
                var seen = new Set();
                records = [];
                for (var i = 0; i < hits.length; i++) {
                    var h = hits[i];
                    if (seen.has(h.id)) continue;
                    seen.add(h.id);
                    var d = tiles.distanceM(centre, h);
                    if (d > radiusKm * 1000 + 1) continue;
                    if (decision.role === 'positive' && !parse.isPositive(h, config.positiveSubjects || [])) continue;
                    h.distanceM = Math.round(d);
                    records.push(h);
                }
                records.sort(function (a, b) { return a.distanceM - b.distanceM; });
            } else {
                // Large box: the cell grid is the data. One approximate point per cell,
                // never one per underlying record (they are not ours to invent).
                records = cells.map(function (cell) {
                    return {
                        id: 'ariadne:cell:' + cell.key,
                        name: '',
                        lat: cell.lat,
                        lon: cell.lon,
                        source: 'ariadne',
                        type: 'cell',
                        positionKind: 'cell',
                        approximatePosition: true,
                        cellKey: cell.key,
                        cellCount: cell.count,
                        subjects: [],
                        distanceM: Math.round(tiles.distanceM(centre, cell))
                    };
                });
            }

            var result = {
                records: records,
                cells: cells,
                meta: Object.assign(baseMeta(centre, radiusKm, appMode, decision), {
                    tiles: stats.tilesPlanned,
                    tilesCompleted: stats.tilesDone,
                    requests: stats.requests,
                    bytes: stats.bytes,
                    upstreamMs: stats.upstreamMs,
                    elapsedMs: now() - started,
                    hits: hits.length,
                    cells: cells.length,
                    cellsCapped: stats.capped,
                    incomplete: stats.incomplete,
                    rejected: rejected,
                    subjects: subjects,
                    temporal: temporal,
                    cached: false
                })
            };
            cache.set(key, result);
            return result;
        }

        function baseMeta(centre, radiusKm, appMode, decision) {
            return {
                source: 'ariadne', appMode: appMode || null, role: decision.role,
                disabled: decision.role === 'disabled', reason: decision.reason || null,
                centre: centre, radiusKm: radiusKm,
                transport: transport.mode || 'injected',
                live: false,
                note: 'Not verified against the live ARIADNE host; the grid path is capped at ' + config.cellCap + ' cells per request.'
            };
        }

        /**
         * CALCULATED, not measured: how many requests a radius needs before the
         * 5000-cell cap stops firing, and whether that fits in the budget.
         */
        function estimate(centre, radiusKm) {
            radiusKm = Math.min(Math.abs(radiusKm) || 0, config.maxRadiusKm);
            var box = tiles.boxAround(centre, radiusKm);
            var base = tiles.splitToMaxSide(box, config.maxSideKm);
            var cellKm = tiles.metresPerCell(config.cellPrecision) / 1000;
            var side = 0;
            for (var i = 0; i < base.length; i++) side = Math.max(side, tiles.boxHeightKm(base[i]), tiles.boxWidthKm(base[i]));
            var depth = 0, count = base.length, perTile = Math.ceil(side / cellKm) * Math.ceil(side / cellKm);
            while (perTile > config.cellCap && depth < config.maxDepth) {
                depth++; count *= 4; side /= 2;
                perTile = Math.ceil(side / cellKm) * Math.ceil(side / cellKm);
            }
            return {
                radiusKm: radiusKm, baseTiles: base.length, depth: depth, requests: count,
                cellsPerTileAtStop: perTile,
                completable: perTile <= config.cellCap,
                withinBudget: count <= config.maxRequests,
                calculated: true,
                note: 'Arithmetic from the 152 m cell size and the 5000-cell cap. Not a measurement.'
            };
        }

        return {
            id: 'ariadne',
            label: 'ARIADNE',
            source: 'ARIADNE portal',
            transportMode: transport.mode || 'injected',
            roleFor: roleFor,
            getSites: function (centre, radiusKm, opts) {
                opts = opts || {};
                return search(centre, radiusKm, opts.appMode, opts.signal).then(function (r) {
                    var out = r.records.slice();
                    out._meta = r.meta;
                    return out;
                });
            },
            getGrid: function (centre, radiusKm, opts) {
                opts = opts || {};
                return search(centre, radiusKm, opts.appMode, opts.signal).then(function (r) {
                    var out = r.cells.slice();
                    out._meta = r.meta;
                    return out;
                });
            },
            getCounts: function (centre, radiusKm, opts) {
                opts = opts || {};
                return search(centre, radiusKm, opts.appMode, opts.signal).then(function (r) { return r.meta; });
            },
            estimate: estimate,
            clearCache: function () { if (cache.clear) cache.clear(); }
        };
    }

    return { createProvider: createProvider };
});
