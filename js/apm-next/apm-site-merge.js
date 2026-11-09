/*!
 * DetectLab — Next-Gen APM · merging two independent site catalogues.
 *
 * Outside Romania the settlement layer can draw on more than one source. The same
 * Roman town is likely to be published by both of them, so the merge has to keep
 * one point per place — not one per source.
 *
 * Two records are the same place when either
 *   1. they share an external identifier (a Pleiades id), or
 *   2. their coordinates are within `distanceM` and their names (including ancient
 *      names) are similar enough.
 *
 * The surviving record is the one from the highest-priority source; it carries
 * `sources: [...]` listing every catalogue that attested it, and every alias seen.
 * Nothing is invented: a merged record keeps real coordinates and a real name.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DetectLabApmSiteMerge = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var DEFAULTS = { distanceM: 400, nameSimilarity: 0.5, prefer: ['dare', 'ariadne'] };

    function fold(s) {
        return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    /** Token Jaccard, the same shape as the hoard matcher. Order-independent. */
    function similarity(a, b) {
        var x = new Set(fold(a).split(' ').filter(Boolean));
        var y = new Set(fold(b).split(' ').filter(Boolean));
        if (!x.size || !y.size) return 0;
        var both = 0;
        x.forEach(function (t) { if (y.has(t)) both++; });
        return both / (x.size + y.size - both);
    }

    function distanceM(a, b) {
        var d = Math.PI / 180, p = (b.lat - a.lat) * d, q = (b.lon - a.lon) * d;
        return 12742000 * Math.asin(Math.min(1, Math.sqrt(Math.sin(p / 2) ** 2 +
            Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(q / 2) ** 2)));
    }

    function names(record) {
        return [record.name, record.ancientName].concat(record.aliases || [])
            .map(function (n) { return String(n || '').trim(); }).filter(Boolean);
    }

    function ids(record) {
        var out = [];
        if (record.pleiadesId) out.push('pleiades:' + String(record.pleiadesId));
        (record.externalIds || []).forEach(function (id) { if (id) out.push(String(id)); });
        return out;
    }

    function bestNameSimilarity(a, b) {
        var best = 0;
        names(a).forEach(function (x) {
            names(b).forEach(function (y) {
                var s = similarity(x, y);
                if (s > best) best = s;
            });
        });
        return best;
    }

    function preferRank(source, prefer) {
        var i = prefer.indexOf(source);
        return i < 0 ? prefer.length : i;
    }

    /**
     * @param groups [{ source, records }] — order does not decide anything by itself
     * @param options { distanceM, nameSimilarity, prefer }
     * @returns { records, stats }
     */
    /**
     * The same catalogue can answer twice for the same place when the training area
     * is queried in tiles. Those repeats are not "attested by two catalogues", so
     * they are removed first and counted separately.
     */
    function dedupeWithin(records, distanceM) {
        var kept = [], dropped = 0;
        (records || []).forEach(function (r) {
            if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) { dropped++; return; }
            var repeat = kept.some(function (k) {
                return (k.id && r.id && k.id === r.id) ||
                    (distanceM(r, k) <= 50 && bestNameSimilarity(r, k) >= 0.9);
            });
            if (repeat) { dropped++; return; }
            kept.push(r);
        });
        return {
            records: kept, dropped: dropped,
            distanceM: distanceM
        };
    }

    function merge(groups, options) {
        var opts = Object.assign({}, DEFAULTS, options || {});
        var input = [], repeatedInSource = 0;
        (groups || []).forEach(function (group) {
            var unique = dedupeWithin(group.records, distanceM);
            repeatedInSource += unique.dropped;
            (unique.records || []).forEach(function (record, index) {
                if (!Number.isFinite(record.lat) || !Number.isFinite(record.lon)) return;
                input.push({
                    record: record, source: group.source, index: index,
                    rank: preferRank(group.source, opts.prefer)
                });
            });
        });
        // Deterministic and preference-first: the survivor is always the same record.
        input.sort(function (a, b) {
            return a.rank - b.rank || String(a.record.id).localeCompare(String(b.record.id)) || a.index - b.index;
        });

        var kept = [], overlaps = [];
        input.forEach(function (item) {
            var r = item.record;
            var match = null, why = '';
            for (var i = 0; i < kept.length && !match; i++) {
                var k = kept[i];
                var shared = ids(r).filter(function (id) { return ids(k).indexOf(id) >= 0; });
                if (shared.length) { match = k; why = 'identifier'; continue; }
                var d = distanceM(r, k);
                if (d > opts.distanceM) continue;
                var s = bestNameSimilarity(r, k);
                if (s >= opts.nameSimilarity) { match = k; why = 'proximity+name'; }
            }
            if (!match) {
                var copy = Object.assign({}, r, {
                    sources: [item.source].concat(r.sources || []),
                    sourceIds: Object.assign({}, r.sourceIds, one(item.source, r.id))
                });
                copy.aliases = names(r).filter(function (n) { return n !== copy.name; });
                kept.push(copy);
                return;
            }
            // Absorb: one place, two attestations.
            if (match.sources.indexOf(item.source) < 0) match.sources.push(item.source);
            match.sourceIds = Object.assign({}, match.sourceIds, one(item.source, r.id));
            names(r).forEach(function (n) {
                if (n !== match.name && match.aliases.indexOf(n) < 0) match.aliases.push(n);
            });
            if (!match.pleiadesId && r.pleiadesId) match.pleiadesId = r.pleiadesId;
            if (r.positionAccuracy != null && (match.positionAccuracy == null || r.positionAccuracy < match.positionAccuracy)) {
                // Keep the sharper position, but never move the point silently: the
                // coordinates stay those of the surviving record and the swap is logged.
                match.positionAccuracy = r.positionAccuracy;
            }
            overlaps.push({
                kept: match.id, keptSource: match.sources[0], merged: r.id, mergedSource: item.source,
                reason: why, distance_m: Math.round(distanceM(r, match))
            });
        });

        var perSource = {};
        (groups || []).forEach(function (g) { perSource[g.source] = (g.records || []).length; });
        return {
            records: kept,
            stats: {
                perSource: perSource,
                repeatedInSource: repeatedInSource,
                merged: input.length - kept.length,
                overlaps: overlaps,
                sources: kept.reduce(function (acc, r) {
                    r.sources.forEach(function (s) { acc[s] = (acc[s] || 0) + 1; });
                    return acc;
                }, {})
            }
        };
    }

    function one(source, id) { var o = {}; o[source] = id; return o; }

    return {
        merge: merge, dedupeWithin: dedupeWithin, similarity: similarity, distanceM: distanceM,
        DEFAULTS: DEFAULTS, fold: fold, names: names
    };
});
