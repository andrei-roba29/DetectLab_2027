/* ═══════════════════════════════════════════════════════════════════════════
 * DetectLab — surse de patrimoniu pe regiuni (România / Danemarca)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Stratul „Zone cu potențial arheologic” are aceeași logică în ambele țări,
 * dar sursa siturilor diferă:
 *
 *   RO  window._localLayerData[0|5|6]  — straturile RAN încărcate de hartă
 *   DK  WFS-ul public Fund og Fortidsminder (Slots- og Kulturstyrelsen, CC0)
 *
 * Modulul de față NU calculează nimic: aduce siturile Danemarcei din WFS și
 * le livrează în exact aceeași formă pe care `buildGlobalSiteIndex()` din
 * js/archeo-potential.js o citește din `_localLayerData`:
 *
 *     { 0: FeatureCollection(puncte), 6: FeatureCollection(poligoane) }
 *
 * Fiecare feature are `id`, `geometry` (GeoJSON 4326) și `properties`; peste
 * atributele originale ale serviciului se adaugă `__dk: true`, ca bucata de
 * raport să știe că „frednr” nu e „cod RAN”.
 *
 * Endpoint-uri (aceleași ca js/danish-layers.config.js, deja folosite de hartă):
 *   direct : https://www.kulturarv.dk/ffgeoserver/public/wfs   (CORS deschis)
 *   proxy  : /api/geo/dk-heritage                              (fallback, areal)
 *
 * Limitări asumate, impuse de serviciu (vezi DENMARK_LAYERS.md):
 *   · fără filtre de atribute prin proxy; bbox + un plafon de features pe tip;
 *   · fără paginare — un strat e „truncated” când atinge plafonul, iar starea
 *     ajunge în UI, nu e ascunsă;
 *   · geometriile vin în EPSG:4326, fără reproiectare locală.
 *
 * Nu se face niciun request către alt host decât kulturarv.dk / same-origin.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DetectLabArcheoRegions = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var DK_WFS = 'https://www.kulturarv.dk/ffgeoserver/public/wfs';
    var DK_PROXY = '/api/geo/dk-heritage';
    var FETCH_TIMEOUT_MS = 14000;
    var MAX_FEATURES_PER_TYPE = 1500;   // plafon per tip de geometrie / rulare
    var MAX_TOTAL_FEATURES = 4000;      // plafon dur pentru o rulare
    var CACHE_TTL_MS = 10 * 60 * 1000;  // aceeași zonă rulată de două ori nu re-descarcă

    /* ── Regiuni ───────────────────────────────────────────────────────────
     * `uat` spune dacă regiunea are un raster de intravilan care să excludă
     * ceva. Danemarca nu are UAT în aplicație, deci `false` înseamnă „fără
     * mască de intravilan”, nu „mască goală care respinge tot”.
     *
     * Razele de protecție: în RO vin din RAN (600 + 100 m). În DK monumentele
     * sunt protejate prin „beskyttelseslinje” de 100 m (naturbeskyttelsesloven
     * §18 pentru fortidsminder) — folosim 100 m + 25 m de siguranță, nu cifra
     * românească. Diferența e documentată în DENMARK_LAYERS.md. */
    var REGIONS = {
        RO: {
            id: 'RO',
            country: 'RO',
            names: { ro: 'România', en: 'Romania' },
            bounds: [[43.4, 20.0], [48.5, 29.9]],
            siteRadiusM: 600,
            siteBufferM: 100,
            uat: true,
            provider: 'RAN (CIMEC)',
            attribution: '© DetectLab 2026 · date RAN CIMEC'
        },
        DK: {
            id: 'DK',
            country: 'DK',
            names: { ro: 'Danemarca', en: 'Denmark' },
            bounds: [[54.3, 7.5], [58.0, 16.0]],
            siteRadiusM: 100,
            siteBufferM: 25,
            uat: false,
            provider: 'Fund og Fortidsminder',
            attribution: '© Slots- og Kulturstyrelsen · Fund og Fortidsminder (CC0 1.0)'
        }
    };

    function inBounds(lat, lng, bounds) {
        if (!bounds) return false;
        var s = bounds[0], n = bounds[1];
        return lat >= s[0] && lat <= n[0] && lng >= s[1] && lng <= n[1];
    }

    // Regiunea unui punct; `null` = în afara zonelor acoperite.
    function regionFor(lat, lng) {
        lat = Number(lat); lng = Number(lng);
        if (!isFinite(lat) || !isFinite(lng)) return null;
        if (inBounds(lat, lng, REGIONS.DK.bounds)) return REGIONS.DK;
        if (inBounds(lat, lng, REGIONS.RO.bounds)) return REGIONS.RO;
        return null;
    }

    function regionById(id) {
        return REGIONS[String(id || '').toUpperCase()] || null;
    }

    function regionName(region, lang) {
        if (!region || !region.names) return '';
        return region.names[lang] || region.names.ro || '';
    }

    /* ── Tipurile Fund og Fortidsminder folosite ca situri ─────────────────
     * `layerId` respectă convenția stratului de potențial: 0 = puncte,
     * 6 = poligoane. Liniile (ex. „stenkreds” digitizate ca linii) contribuie
     * cu un punct la mijlocul geometriei — un perimetru de linie nu are sens
     * ca sit punctual, dar nici nu poate fi ignorat. */
    var DK_TYPES = [
        { typeName: 'public:fundogfortidsminder_punkt_fredet', layerId: 0, kind: 'point', label: 'punkt fredet' },
        { typeName: 'public:fundogfortidsminder_punkt_ikkefredet', layerId: 0, kind: 'point', label: 'punkt ikke-fredet' },
        { typeName: 'public:fundogfortidsminder_areal_fredet', layerId: 6, kind: 'polygon', label: 'areal fredet', proxy: true },
        { typeName: 'public:fundogfortidsminder_linje_fredet', layerId: 0, kind: 'line', label: 'linje fredet' }
    ];

    // Grad-pătrat care acoperă cercul de căutare (cu puțin adaos).
    function bboxFor(lat, lng, radiusM) {
        var r = Math.max(200, Number(radiusM) || 0);
        var dLat = r / 111320;
        var dLng = dLat / Math.max(0.05, Math.cos(lat * Math.PI / 180));
        return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
    }

    function wfsUrl(typeName, bbox, count) {
        // Aceeași construcție ca wfsDirectUrl() din js/danish-layers.js —
        // bbox în ordinea west,south,east,north + EPSG:4326 (cum o cere
        // serviciul, verificat pe hartă).
        return DK_WFS + '?service=WFS&version=2.0.0&request=GetFeature' +
            '&typeNames=' + encodeURIComponent(typeName) +
            '&outputFormat=application/json&srsName=EPSG:4326' +
            '&bbox=' + bbox.map(function (v) { return v.toFixed(6); }).join(',') + ',EPSG:4326' +
            '&count=' + Math.max(1, Math.min(3000, count || MAX_FEATURES_PER_TYPE));
    }

    function proxyUrl(bbox, count) {
        return DK_PROXY + '?bbox=' + bbox.map(function (v) { return v.toFixed(6); }).join(',') +
            '&layer=fortidsminder&maxFeatures=' + Math.max(1, Math.min(400, count || 200));
    }

    function fetchJson(url, opts) {
        opts = opts || {};
        if (typeof fetch !== 'function') return Promise.reject(new Error('fetch unavailable'));
        var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
        var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, opts.timeoutMs || FETCH_TIMEOUT_MS);
        var init = { method: 'GET', headers: { Accept: 'application/json' } };
        if (ctrl) init.signal = ctrl.signal;
        return fetch(url, init).then(function (res) {
            if (!res || !res.ok) {
                if (res && res.status === 400) throw new Error('HTTP 400 (bbox/typename respins)');
                throw new Error('HTTP ' + (res ? res.status : '?'));
            }
            return res.json();
        }).then(function (json) {
            clearTimeout(timer);
            return json;
        }, function (err) {
            clearTimeout(timer);
            throw err;
        });
    }

    function arrayDepth(a) {
        var d = 0, cur = a;
        while (Array.isArray(cur)) { d++; cur = cur[0]; }
        return d;
    }

    // Punct reprezentativ pentru o geometrie de linie: mijlocul lungimii.
    function lineMidpoint(coords) {
        if (!coords || !coords.length) return null;
        var pts = [];
        (function walk(a) {
            if (!Array.isArray(a)) return;
            if (typeof a[0] === 'number') { pts.push(a); return; }
            a.forEach(walk);
        })(coords);
        if (!pts.length) return null;
        if (pts.length === 1) return pts[0];
        var segs = [], total = 0;
        for (var i = 1; i < pts.length; i++) {
            var dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
            var len = Math.sqrt(dx * dx + dy * dy);
            segs.push(len); total += len;
        }
        var half = total / 2, acc = 0;
        for (var s = 0; s < segs.length; s++) {
            if (acc + segs[s] >= half && segs[s] > 0) {
                var t = (half - acc) / segs[s];
                return [pts[s][0] + (pts[s + 1][0] - pts[s][0]) * t,
                        pts[s][1] + (pts[s + 1][1] - pts[s][1]) * t];
            }
            acc += segs[s];
        }
        return pts[pts.length - 1];
    }

    function compactProps(raw) {
        var src = raw || {};
        var out = { __dk: true };
        // Doar atributele pe care le afișăm / le folosim. Restul (zeci de
        // coloane de registru) ar umfla fiecare rulare degeaba.
        ['anlaegstype', 'datering', 'frednr', 'stednr', 'url', 'betegnelse',
         'kommune', 'sogn', 'periode', 'kategori', 'areal_m2'].forEach(function (k) {
            if (src[k] !== undefined && src[k] !== null && String(src[k]).trim() !== '') {
                out[k] = typeof src[k] === 'string' ? src[k].trim() : src[k];
            }
        });
        // Serviciul livrează uneori atributele cu majuscule.
        Object.keys(src).forEach(function (k) {
            var lk = String(k).toLowerCase();
            if (out[lk] === undefined && String(src[k] || '').trim() !== '' &&
                ['anlaegstype', 'datering', 'frednr', 'stednr', 'url', 'betegnelse'].indexOf(lk) !== -1) {
                out[lk] = src[k];
            }
        });
        return out;
    }

    // Un GeoJSON Feature → feature-ul din convenția `_localLayerData`.
    function adaptFeature(f, type, idx) {
        var g = f && f.geometry;
        if (!g || !g.coordinates) return null;
        var props = compactProps(f.properties);
        var id = (f.id !== undefined && f.id !== null) ? String(f.id)
            : (props.frednr ? 'fred-' + props.frednr : 'idx-' + idx);

        if (g.type === 'Point') {
            return { type: 'Feature', id: id,
                geometry: { type: 'Point', coordinates: g.coordinates },
                properties: props };
        }
        if (g.type === 'MultiPoint') {
            return { type: 'Feature', id: id,
                geometry: { type: 'Point', coordinates: g.coordinates[0] },
                properties: props };
        }
        if (g.type === 'LineString' || g.type === 'MultiLineString') {
            var mid = lineMidpoint(g.coordinates);
            if (!mid) return null;
            props.__dkLine = true;
            return { type: 'Feature', id: id, geometry: { type: 'Point', coordinates: mid }, properties: props };
        }
        if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
            return { type: 'Feature', id: id, geometry: g, properties: props };
        }
        return null;
    }

    var _cache = {};

    function cacheKey(bbox) {
        return bbox.map(function (v) { return v.toFixed(3); }).join(',');
    }

    function emptyCollection() {
        return { type: 'FeatureCollection', features: [] };
    }

    /* Încarcă siturile Danemarcei în jurul unui punct.
     * Rezolvă ÎNTOTDEAUNA (nu respinge) cu:
     *   { data: {0: FC, 6: FC}, meta: { region, sources[], points, polygons,
     *     truncated, failed, attribution, provider } }
     * `meta.failed === meta.sources.length` înseamnă „registrul nu a răspuns” —
     * stratul de potențial raportează starea, nu inventează situri. */
    function loadDanishSites(lat, lng, radiusM, opts) {
        opts = opts || {};
        var bbox = opts.bbox || bboxFor(lat, lng, radiusM);
        var key = cacheKey(bbox);
        var now = Date.now();
        if (!opts.force && _cache[key] && (now - _cache[key].at) < CACHE_TTL_MS) {
            return Promise.resolve(_cache[key].result);
        }

        var data = { 0: emptyCollection(), 6: emptyCollection() };
        var meta = {
            region: 'DK',
            provider: REGIONS.DK.provider,
            attribution: REGIONS.DK.attribution,
            bbox: bbox,
            radiusM: radiusM,
            sources: [],
            points: 0,
            polygons: 0,
            truncated: 0,
            failed: 0,
            lines: 0
        };

        var budget = { left: MAX_TOTAL_FEATURES };

        function record(type, json, err) {
            var entry = { typeName: type.typeName, label: type.label, count: 0, truncated: false };
            if (err) {
                entry.error = (err && err.message) ? err.message : String(err);
                meta.failed += 1;
                meta.sources.push(entry);
                return;
            }
            var feats = (json && json.features) || [];
            entry.truncated = !!(json && (json.exceededTransferLimit || json.truncated)) ||
                feats.length >= MAX_FEATURES_PER_TYPE;
            var used = 0;
            for (var i = 0; i < feats.length; i++) {
                if (budget.left <= 0) { entry.truncated = true; break; }
                var adapted = adaptFeature(feats[i], type, i);
                if (!adapted) continue;
                data[type.layerId].features.push(adapted);
                budget.left -= 1;
                used += 1;
                if (adapted.properties.__dkLine) meta.lines += 1;
                if (type.layerId === 6) meta.polygons += 1;
                else meta.points += 1;
            }
            entry.count = used;
            if (entry.truncated) meta.truncated += 1;
            meta.sources.push(entry);
        }

        var chain = Promise.resolve();
        DK_TYPES.forEach(function (type) {
            chain = chain.then(function () {
                if (opts.isCancelled && opts.isCancelled()) return null;
                if (budget.left <= 0) return null;
                var want = Math.min(MAX_FEATURES_PER_TYPE, budget.left);
                return fetchJson(wfsUrl(type.typeName, bbox, want)).then(function (json) {
                    record(type, json, null);
                }, function (err) {
                    // Arealul are și proxy same-origin; restul nu.
                    if (!type.proxy) { record(type, null, err); return; }
                    return fetchJson(proxyUrl(bbox, Math.min(400, want))).then(function (json) {
                        record(type, json, null);
                    }, function (proxyErr) {
                        record(type, null, err || proxyErr);
                    });
                });
            });
        });

        return chain.then(function () {
            var result = { data: data, meta: meta };
            _cache[key] = { at: Date.now(), result: result };
            // Cache-ul nu trebuie să crească la infinit într-o sesiune lungă.
            var keys = Object.keys(_cache);
            if (keys.length > 24) {
                keys.sort(function (a, b) { return _cache[a].at - _cache[b].at; });
                for (var i = 0; i < keys.length - 24; i++) delete _cache[keys[i]];
            }
            return result;
        });
    }

    function clearCache() { _cache = {}; }

    return {
        REGIONS: REGIONS,
        DK_TYPES: DK_TYPES,
        regionFor: regionFor,
        regionById: regionById,
        regionName: regionName,
        bboxFor: bboxFor,
        wfsUrl: wfsUrl,
        loadDanishSites: loadDanishSites,
        clearCache: clearCache,
        MAX_FEATURES_PER_TYPE: MAX_FEATURES_PER_TYPE,
        MAX_TOTAL_FEATURES: MAX_TOTAL_FEATURES
    };
}));
