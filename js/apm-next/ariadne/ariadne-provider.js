/*!
 * ARIADNE site provider for APM Next Gen.
 *
 * Implements the existing SiteProvider interface so the pipeline does not care
 * where the records come from:
 *     { id, label, source, getSites(centre, radiusKm, opts) → Promise<Record[]> }
 * plus getCounts() for the panel's period/subject lists.
 *
 * Two roles, both selectable (default from config):
 *   mode 'positive'    — only hits whose ariadneSubject matches config.positiveSubjects
 *                        (a real site/monument with a point) may train the model.
 *   mode 'comparison'  — every hit with a point, used only as a known-site comparison set.
 *
 * The upstream call is delegated to ONE injected function (ariadne-upstream.js),
 * so 'server' vs 'browser' transport changes nothing here.
 *
 * NOT VERIFIED against the live host. Everything below is exercised by
 * test-apm-ariadne.mjs against the real response fixture and a fake transport.
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

    function distanceM(a, b) {
        var d = Math.PI / 180;
        var p = (b.lat - a.lat) * d, q = (b.lon - a.lon) * d;
        return 12742000 * Math.asin(Math.min(1, Math.sqrt(Math.sin(p / 2) * Math.sin(p / 2) + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(q / 2) * Math.sin(q / 2))));
    }

    function mergeBuckets(into, list) {
        for (var i = 0; i < list.length; i++) {
            var b = list[i];
            into[b.key] = (into[b.key] || 0) + (b.count || 0);
        }
        return into;
    }

    function createProvider(options) {
        options = options || {};
        var config = Object.assign({}, defaults, options.config || {});
        var transport = options.transport || (options.upstream ? options.upstream : upstream.create(config, options.deps));
        // Allow a bare {call} to be injected (tests, or a future non-Supabase proxy).
        var call = typeof transport.call === 'function' ? transport.call.bind(transport) : transport.call;
        var now = options.now || function () { return Date.now(); };
        var cache = options.cache || { map: new Map(), get: function (k) { var v = this.map.get(k); return v && v.expires > now() ? v.value : null; }, set: function (k, v) { this.map.set(k, { value: v, expires: now() + config.cacheTtlMs }); } };

        function cacheKey(centre, radiusKm, mode) {
            return [mode, centre.lat.toFixed(3), centre.lon.toFixed(3), Math.round(radiusKm)].join('|');
        }

        function radiusKmClamp(r) { return Math.min(Math.abs(r) || 0, 200); }

        /** Page through one tile. Throws rather than returning a partial tile. */
        async function searchTile(tile, mode, signal, stats) {
            var pageSize = config.pageSize, maxPages = config.maxPages;
            var collected = [], from = 0, total = 0, relation = null, rejected = {}, subjects = [], cells = [];
            for (var page = 0; page < maxPages; page++) {
                var body = query.buildSearchBody({ box: tile, from: from, size: pageSize, aggregations: page === 0, fields: config.fields });
                var res = await call({ path: '', method: 'POST', body: body }, { signal: signal, timeoutMs: config.timeoutMs });
                stats.requests++;
                stats.bytes += res.bytes || 0;
                stats.ms += res.ms || 0;
                var parsed = parse.parseResponse(res.json);
                total = parsed.total;
                relation = parsed.relation;
                for (var k in parsed.rejected) rejected[k] = (rejected[k] || 0) + parsed.rejected[k];
                subjects = mergeBuckets(subjects, parsed.buckets.subjects);
                cells = mergeBuckets(cells, parsed.buckets.cells);
                collected = collected.concat(parsed.hits);
                if (parsed.rawHits === 0) break;
                from += parsed.rawHits;
                if (from >= total) break;
                if (page + 1 >= query.pagesFor(total, pageSize, maxPages)) break;
            }
            stats.truncated = stats.truncated || (Number.isFinite(total) && collected.length < total && relation !== 'eq' ? true : collected.length < total);
            return { records: collected, total: total, relation: relation, rejected: rejected, subjects: subjects, cells: cells };
        }

        async function gather(centre, radiusKm, mode, signal) {
            if (!centre || !Number.isFinite(centre.lat) || !Number.isFinite(centre.lon) || Math.abs(centre.lat) > 90 || Math.abs(centre.lon) > 180) {
                throw err('ariadne.invalid', 'Invalid centre coordinates');
            }
            radiusKm = radiusKmClamp(radiusKm);
            if (!(radiusKm > 0)) throw err('ariadne.invalid', 'Invalid radius');
            var key = cacheKey(centre, radiusKm, mode);
            var hit = cache.get(key);
            if (hit) { hit.meta.cached = true; return hit; }

            var box = tiles.boxAround(centre, radiusKm);
            var list = tiles.splitBox(box, config.maxTiles);
            var stats = { requests: 0, bytes: 0, ms: 0, truncated: false };
            var all = [], totals = 0, rejected = {}, subjects = {}, cells = {}, failures = [];
            var pending = list.map(function (tile) { return tile; });
            var workers = [];
            var started = now();

            async function worker() {
                while (pending.length) {
                    var tile = pending.shift();
                    try {
                        var r = await searchTile(tile, mode, signal, stats);
                        all = all.concat(r.records);
                        totals += r.total || 0;
                        for (var k in r.rejected) rejected[k] = (rejected[k] || 0) + r.rejected[k];
                        mergeBuckets(subjects, Object.keys(r.subjects).map(function (k) { return { key: k, count: r.subjects[k] }; }));
                        mergeBuckets(cells, Object.keys(r.cells).map(function (k) { return { key: k, count: r.cells[k] }; }));
                    } catch (e) {
                        failures.push({ tile: tile, key: e.key || 'ariadne.error', message: e.message });
                        throw e;
                    }
                }
            }
            for (var w = 0; w < Math.max(1, Math.min(config.concurrency, list.length)); w++) workers.push(worker());
            try { await Promise.all(workers); }
            catch (e) { e.meta = { partial: true, tilesPlanned: list.length, failures: failures }; throw e; }

            var seen = new Set();
            var records = [];
            for (var i = 0; i < all.length; i++) {
                var r = all[i];
                if (seen.has(r.id)) continue;
                seen.add(r.id);
                if (config.excludeWithoutPoint && (!Number.isFinite(r.lat) || !Number.isFinite(r.lon))) continue;
                var d = distanceM(centre, r);
                if (d > radiusKm * 1000 + 1) continue;      // tiles are rectangles; the disc is the truth
                r.distanceM = Math.round(d);
                if (mode === 'positive' && !parse.isPositive(r, config.positiveSubjects)) continue;
                records.push(r);
            }
            records.sort(function (a, b) { return a.distanceM - b.distanceM || String(a.id).localeCompare(String(b.id)); });

            var result = {
                records: records,
                meta: {
                    source: 'ariadne', mode: mode, transport: transport.mode || 'injected',
                    tileBbox: box, tiles: list.length, requests: stats.requests,
                    bytes: stats.bytes, upstreamMs: stats.ms, elapsedMs: now() - started,
                    totalInBox: totals, returned: records.length,
                    truncated: Boolean(stats.truncated), rejected: rejected,
                    subjects: subjects, cells: cells, cached: false,
                    live: false,  // <- stays false: nothing here proves the host answers
                    note: 'Not verified against the live ARIADNE host.'
                }
            };
            cache.set(key, result);
            return result;
        }

        return {
            id: 'ariadne',
            label: 'ARIADNE',
            source: 'ARIADNE portal',
            transportMode: transport.mode || 'injected',
            getSites: function (centre, radiusKm, opts) { return gather(centre, radiusKm, (opts && opts.mode) || 'positive', opts && opts.signal).then(function (r) { var out = r.records; out._meta = r.meta; return out; }); },
            getCounts: function (centre, radiusKm, opts) { return gather(centre, radiusKm, (opts && opts.mode) || 'comparison', opts && opts.signal).then(function (r) { return r.meta; }); },
            clearCache: function () { if (cache.map && cache.map.clear) cache.map.clear(); }
        };
    }

    return { createProvider: createProvider, distanceM: distanceM };
});
