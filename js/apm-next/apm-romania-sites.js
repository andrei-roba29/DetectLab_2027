/* Romania TRAIN: one shared Supabase client, one RPC, no site-source fallback. */
(function (root, factory) {
    var config = typeof module === 'object' && module.exports ? require('./romania-periods.config.js') : root.DetectLabRomaniaApmConfig;
    var api = factory(root, config);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DetectLabRomaniaApmSites = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis), function (root, config) {
    'use strict';
    // Natural Earth Admin-0, 1:110m, public domain. Generalised national outline, not a legal boundary.
    // https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson
    var RO = [[28.233554, 45.488283], [28.679779, 45.304031], [29.149725, 45.464925], [29.603289, 45.293308], [29.626543, 45.035391], [29.141612, 44.82021], [28.837858, 44.913874], [28.558081, 43.707462], [27.970107, 43.812468], [27.2424, 44.175986], [26.065159, 43.943494], [25.569272, 43.688445], [24.100679, 43.741051], [23.332302, 43.897011], [22.944832, 43.823785], [22.65715, 44.234923], [22.474008, 44.409228], [22.705726, 44.578003], [22.459022, 44.702517], [22.145088, 44.478422], [21.562023, 44.768947], [21.483526, 45.18117], [20.874313, 45.416375], [20.762175, 45.734573], [20.220192, 46.127469], [21.021952, 46.316088], [21.626515, 46.994238], [22.099768, 47.672439], [22.710531, 47.882194], [23.142236, 48.096341], [23.760958, 47.985598], [24.402056, 47.981878], [24.866317, 47.737526], [25.207743, 47.891056], [25.945941, 47.987149], [26.19745, 48.220881], [26.619337, 48.220726], [26.924176, 48.123264], [27.233873, 47.826771], [27.551166, 47.405117], [28.12803, 46.810476], [28.160018, 46.371563], [28.054443, 45.944586], [28.233554, 45.488283]];
    function insideRomania(lat, lon) {
        var inside = false;
        for (var i = 0, j = RO.length - 1; i < RO.length; j = i++) {
            var a = RO[i], b = RO[j];
            if (((a[1] > lat) !== (b[1] > lat)) && lon < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        return inside;
    }
    function normaliseName(s) {
        return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    }
    function descriptivePart(name) {
        var n = normaliseName(name), at = n.indexOf(' de la ');
        return { text: at < 0 ? n : n.slice(0, at), lowerConfidence: at < 0 };
    }
    function inferPeriod(name) {
        var part = descriptivePart(name);
        for (var i = 0; i < config.periods.length && !(part.lowerConfidence && config.ambiguousWholeNames.indexOf(part.text) >= 0); i++) {
            var p = config.periods[i];
            if (p.patterns.some(function (pattern) { return new RegExp('(?:^|[^a-z0-9])(?:' + pattern + ')(?=$|[^a-z0-9])').test(part.text); })) {
                return { periodLabel: p.label, periodStart: p.start, periodEnd: p.end, periodSource: 'name-keyword',
                    confidence: part.lowerConfidence ? 'low' : 'approximate', periodConfidence: part.lowerConfidence ? 0.35 : 0.65, periodConfigSource: p.source };
            }
        }
        return { periodLabel: 'unknown', periodStart: null, periodEnd: null, periodSource: 'unknown', confidence: 'unknown', periodConfidence: 0 };
    }
    function isExcludedType(name) {
        var text = descriptivePart(name).text;
        return config.excludeNamePatterns.some(function (pattern) { return new RegExp('(?:^|[^a-z0-9])(?:' + pattern + ')').test(text); });
    }
    function distanceM(a, b) {
        var p = Math.PI / 180, dlat = (b.lat - a.lat) * p, dlon = (b.lon - a.lon) * p;
        return 12742000 * Math.asin(Math.min(1, Math.sqrt(Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dlon / 2) ** 2)));
    }
    function dedupe(rows) {
        var out = [], byName = new Map();
        rows.forEach(function (r) {
            var key = normaliseName(r.name), group = byName.get(key) || [];
            if (!group.some(function (q) { return distanceM(r, q) <= 5; })) {
                out.push(r); group.push(r); byName.set(key, group);
            }
        });
        return out;
    }
    // Distance to every outline segment in a local metric projection, not a rectangular envelope.
    function areaCrossesBorder(center, radiusKm) {
        var xscale = 111320 * Math.cos(center.lat * Math.PI / 180), yscale = 111320;
        return !insideRomania(center.lat, center.lon) || RO.some(function (a, i) {
            var b = RO[(i + 1) % RO.length];
            var ax = (a[0] - center.lon) * xscale, ay = (a[1] - center.lat) * yscale;
            var bx = (b[0] - center.lon) * xscale, by = (b[1] - center.lat) * yscale;
            var dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
            return Math.hypot(ax + t * dx, ay + t * dy) <= radiusKm * 1000;
        });
    }
    function createProvider(options) {
        options = options || {};
        return {
            id: 'romania-repertory', label: 'Romanian National Archaeological Repertory',
            source: 'Supabase archaeological_sites_a', available: true,
            getSites: async function (center, radiusKm) {
                var radius = Math.min(50, Math.max(0, Number(radiusKm == null ? 50 : radiusKm)));
                if (!Number.isFinite(center.lat) || !Number.isFinite(center.lon) || !Number.isFinite(radius)) throw new Error('Invalid training coordinates or radius');
                if (!insideRomania(center.lat, center.lon)) {
                    var empty = [];
                    empty._meta = { outsideRomania: true, message: 'Built-in site data covers Romania only. Upload CSV.', truncated: false };
                    return empty;
                }
                var sb = options.client || root.supabaseClient;
                if (!sb || typeof sb.rpc !== 'function') throw new Error('Supabase client unavailable. Upload CSV or retry.');
                var timer, request = sb.rpc('apm_sites_within', { p_lat: center.lat, p_lon: center.lon, p_radius_km: radius, p_include_empty_coord: !!config.includeEmptyCoord });
                try {
                    var res = await Promise.race([request, new Promise(function (_, reject) {
                        timer = setTimeout(function () { reject(new Error('Romania database request timed out. Upload CSV or retry.')); }, options.timeoutMs || 20000);
                    })]);
                    if (res.error) throw new Error(res.error.message || 'Romania database request failed');
                    var payload = res.data;
                    if (!payload || !Array.isArray(payload.rows)) throw new Error('Invalid Romania database response. Upload CSV or retry.');
                    var excludedType = 0, excludedBorder = 0;
                    var exact = payload.rows.filter(function (r) {
                        var flag = String(r.coord_flag || '').trim().toUpperCase();
                        return flag === 'DA' || (config.includeEmptyCoord && !flag);
                    });
                    var mapped = exact.map(function (r) {
                        var lat = Number(r.lat), lon = Number(r.lon);
                        if (!Number.isFinite(lat) || !Number.isFinite(lon) || (!insideRomania(lat, lon) || distanceM(center, {lat: lat, lon: lon}) > radius * 1000)) { excludedBorder++; return null; }
                        if (isExcludedType(r.name)) { excludedType++; return null; }
                        return Object.assign({ id: String(r.object_id), name: r.name || '', lat: lat, lon: lon, siruta: r.siruta,
                            coord_flag: r.coord_flag, type: 'settlement', positionAccuracy: null, positionAccepted: true,
                            approximatePosition: false, source: 'romania-repertory' }, inferPeriod(r.name));
                    }).filter(Boolean);
                    var beforeDedupe = mapped.length;
                    mapped = dedupe(mapped);
                    mapped._protectionRecords = exact.filter(function (r) { return insideRomania(Number(r.lat), Number(r.lon)); });
                    mapped._meta = { outsideRomania: false, truncated: !!payload.truncated, total: payload.total_in_area == null ? null : payload.total_in_area,
                        excludedPosition: payload.excluded_approximate == null ? null : payload.excluded_approximate,
                        excludedUnknownPosition: payload.excluded_unknown_coord == null ? null : payload.excluded_unknown_coord,
                        excludedGeometry: payload.excluded_geometry || 0, excludedType: excludedType, excludedBorder: excludedBorder,
                        duplicate: beforeDedupe - mapped.length, unknownPeriod: mapped.filter(function (r) { return r.periodSource === 'unknown'; }).length,
                        returned: mapped.length, includeEmptyCoord: !!config.includeEmptyCoord, areaCrossesBorder: areaCrossesBorder(center, radius) };
                    return mapped;
                } finally { clearTimeout(timer); }
            }
        };
    }
    return { createProvider: createProvider, insideRomania: insideRomania, normaliseName: normaliseName,
        descriptivePart: descriptivePart, inferPeriod: inferPeriod, isExcludedType: isExcludedType, dedupe: dedupe, areaCrossesBorder: areaCrossesBorder };
});
