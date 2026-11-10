/*!
 * DetectLab — Next-Gen APM · settlement source outside Romania.
 *
 * Two catalogues answer for the same ground: DARE (Digital Atlas of the Roman
 * Empire) and the ARIADNE portal. Neither is a superset of the other, and the same
 * town is often in both, so they are merged rather than concatenated: one point per
 * place, `sources: [...]` recording every catalogue that attested it.
 *
 * The merge itself lives in apm-site-merge.js. This module only decides what to ask
 * each source, maps both onto the TRAIN record shape, and reports what happened to
 * each of them — a source that fails contributes nothing AND says so, so a zero is
 * never mistaken for "there is nothing here".
 *
 * ARIADNE box limit: the portal answers with hits only for boxes smaller than about
 * 50 km; larger boxes return a density grid, which is not a site list. The training
 * area is therefore cut into tiles small enough to stay in hits mode.
 */
(function (root, factory) {
    var node = typeof module === 'object' && module.exports;
    var api = factory(node ? require('./apm-site-merge.js') : root.DetectLabApmSiteMerge, node ? require('./apm-romania-sites.js') : root.DetectLabRomaniaApmSites);
    if (node) module.exports = api; else root.DetectLabApmOutsideSites = api;
})(typeof self !== 'undefined' ? self : this, function (merge, romania) {
    'use strict';

    var CONFIG = {
        ariadneMaxTileSideKm: 42,   // stays below the portal's ~50 km hits threshold
        ariadneMaxTiles: 9,
        ariadneRadiusPad: 1.06,     // tiles overlap slightly so nothing falls between them
        positionAccuracyM: 50,
        // The portal publishes a small box two ways: hits (real points) and, when it
        // answers with its density grid, one geohash-7 cell per bucket (~152 m). A
        // cell centre is a real location to within half the cell diagonally, so it is
        // accepted as ONE point per cell, at that accuracy, and named as a cell.
        cellAccuracyM: 110,
        // The position-accuracy ceiling the TRAIN filters must use for these records.
        // Inside Romania it stays the shared 100 m; a 110 m cell would be dropped otherwise.
        acceptAccuracyM: 150,
        // Hard budget: the merged list is deduplicated in O(n²), so the cell path is
        // capped and the status line says how many cells were left out.
        maxAriadnePoints: 1500,
        minZoomDare: 7
    };

    function insideRomania(lat, lon) {
        return romania && typeof romania.insideRomania === 'function' ? romania.insideRomania(lat, lon) : false;
    }

    /** Cut the training disc into square tiles a source can answer with hits. */
    function tilesFor(centre, radiusKm, config) {
        var sideKm = 2 * radiusKm;
        var perSide = Math.max(1, Math.min(3, Math.ceil(sideKm / config.ariadneMaxTileSideKm)));
        var tileSide = sideKm / perSide;
        var list = [];
        for (var row = 0; row < perSide; row++) {
            for (var col = 0; col < perSide; col++) {
                var dLat = ((row + 0.5) / perSide - 0.5) * sideKm / 111.32;
                var dLon = ((col + 0.5) / perSide - 0.5) * sideKm / (111.32 * Math.cos(centre.lat * Math.PI / 180));
                list.push({ centre: { lat: centre.lat + dLat, lon: centre.lon + dLon }, radiusKm: (tileSide / 2) * config.ariadneRadiusPad });
            }
        }
        return list.slice(0, config.ariadneMaxTiles);
    }

    /**
     * ARIADNE answer → TRAIN record.
     *
     * A hit is a published point. A bucket from the portal's own grid is not a site:
     * it is one cell with a record count, so it becomes ONE point at the cell centre,
     * named as a cell, carrying the cell's own positional error (half its diagonal)
     * and the count it stands for. Never one point per underlying record.
     */
    function ariadneRecord(record) {
        if (!record || !Number.isFinite(record.lat) || !Number.isFinite(record.lon)) return null;
        if (record.positionKind === 'cell') {
            var key = record.cellKey || String(record.id || '').replace(/^ariadne:cell:/, '');
            return {
                id: record.id || ('ariadne:cell:' + key),
                name: 'ARIADNE grid cell ' + key,
                ancientName: null,
                lat: record.lat, lon: record.lon,
                type: 'settlement',
                positionAccuracy: CONFIG.cellAccuracyM,
                approximatePosition: false,      // the accuracy says how approximate it is
                positionAccepted: true,
                positionKind: 'cell',
                cellKey: key,
                cellCount: typeof record.cellCount === 'number' ? record.cellCount : null,
                source: 'ariadne',
                sourceIds: { ariadne: record.id || ('ariadne:cell:' + key) },
                pleiadesId: null,
                ariadneType: null,
                subjects: [],
                publisher: null,
                periods: [],
                periodSource: 'unknown'
            };
        }
        return {
            id: record.id,
            name: record.name || ('ARIADNE ' + record.ariadneId),
            ancientName: null,
            lat: record.lat, lon: record.lon,
            type: 'settlement',
            positionAccuracy: CONFIG.positionAccuracyM,
            approximatePosition: false,
            positionAccepted: true,
            source: 'ariadne',
            sourceIds: { ariadne: record.ariadneId },
            pleiadesId: null,
            ariadneType: record.type || null,
            subjects: record.subjects || [],
            publisher: record.publisher || null,
            periods: [],
            periodSource: 'unknown'
        };
    }

    // The provider owns the record shape for every source: TRAIN must never drop a
    // real site because a catalogue omitted a field this app expects.
    function dareRecord(record) {
        return Object.assign({}, record, {
            type: 'settlement',
            positionAccuracy: record.positionAccuracy == null ? CONFIG.positionAccuracyM : record.positionAccuracy,
            approximatePosition: record.approximatePosition === true,
            positionAccepted: true,
            periods: record.periods || [],
            periodSource: record.periodSource || 'unknown'
        });
    }

    function mergeCounts(into, more) {
        var out = Object.assign({}, into || {});
        Object.keys(more || {}).forEach(function (k) { out[k] = (out[k] || 0) + more[k]; });
        return out;
    }

    function createProvider(options) {
        options = options || {};
        var config = Object.assign({}, CONFIG, options.config || {});
        var dare = options.dare || null;
        var ariadne = options.ariadne || null;
        var mergeOptions = options.mergeOptions || undefined;

        return {
            id: 'outside-romania',
            label: 'DARE + ARIADNE',
            source: 'dare+ariadne',
            getSites: async function (centre, radiusKm, opts) {
                opts = opts || {};
                if (insideRomania(centre.lat, centre.lon)) {
                    var none = [];
                    none._meta = { outsideRomania: false, region: 'romania', message: 'Romania uses the national repertory, not these catalogues.' };
                    return none;
                }
                var stats = {
                    dare: { ok: false, records: 0, error: null },
                    ariadne: { ok: false, records: 0, requests: 0, error: null, mode: null,
                        hits: 0, cells: 0, cellsCapped: 0, rejected: {}, points: 0, cellPoints: 0,
                        sawHits: 0, sawCells: 0, droppedOverBudget: 0, droppedNearDare: 0 }
                };
                var groups = [];

                if (dare) {
                    try {
                        var dareRecords = await dare.getSites(centre, radiusKm, { signal: opts.signal });
                        var mapped = (dareRecords || []).map(dareRecord).filter(function (r) { return r && r.lat != null; });
                        var uniqueDare = merge.dedupeWithin(mapped, merge.distanceM);
                        groups.push({ source: 'dare', records: uniqueDare.records });
                        stats.dare = { ok: true, records: uniqueDare.records.length, error: null, received: dareRecords._meta ? dareRecords._meta.received : mapped.length,
                            repeated: uniqueDare.dropped };
                    } catch (error) {
                        stats.dare = { ok: false, records: 0, error: String(error && error.message || error) };
                    }
                } else {
                    stats.dare = { ok: false, records: 0, error: 'not configured' };
                }

                var periodsSeen = {};
                if (ariadne) {
                    var collected = [];
                    var tileErrors = [];
                    var hitsSeen = 0, cellsSeen = 0, droppedOverBudget = 0;
                    var tileList = tilesFor(centre, radiusKm, config);
                    for (var i = 0; i < tileList.length; i++) {
                        if (opts.signal && opts.signal.aborted) break;
                        try {
                            var tile = tileList[i];
                            var hits = await ariadne.getSites(tile.centre, tile.radiusKm, { appMode: 'settlement', signal: opts.signal });
                            stats.ariadne.requests += (hits._meta && hits._meta.requests) || 0;
                            stats.ariadne.mode = (hits._meta && hits._meta.mode) || stats.ariadne.mode;
                            ((hits._meta && hits._meta.periods) || []).forEach(function (p) {
                                periodsSeen[p.label] = (periodsSeen[p.label] || 0) + p.count;
                            });
                            stats.ariadne.hits += ((hits._meta && hits._meta.hits) || 0);
                            stats.ariadne.cells += ((hits._meta && hits._meta.cells) || 0);
                            stats.ariadne.cellsCapped = (stats.ariadne.cellsCapped || 0) + ((hits._meta && hits._meta.cellsCapped) || 0);
                            if (hits._meta && hits._meta.rejected) stats.ariadne.rejected = mergeCounts(stats.ariadne.rejected, hits._meta.rejected);
                            (hits || []).forEach(function (record) {
                                if (record && record.positionKind === 'cell') cellsSeen++; else hitsSeen++;
                                var mappedRecord = ariadneRecord(record);
                                if (mappedRecord) collected.push(mappedRecord);
                            });
                        } catch (error) {
                            tileErrors.push(String(error && error.message || error));
                        }
                    }
                    // Overlapping tiles repeat a site near an edge: count it once. The
                    // duplicate-by-id pass is cheap; the distance pass runs on the
                    // already-reduced list, and the whole path is budgeted.
                    var byId = new Map();
                    collected.forEach(function (r) { if (!byId.has(r.id)) byId.set(r.id, r); });
                    var uniqueList = [];
                    byId.forEach(function (r) { uniqueList.push(r); });
                    if (uniqueList.length > config.maxAriadnePoints) {
                        droppedOverBudget = uniqueList.length - config.maxAriadnePoints;
                        uniqueList = uniqueList.slice(0, config.maxAriadnePoints);
                    }
                    var uniqueAriadne = merge.dedupeWithin(uniqueList, merge.distanceM);
                    stats.ariadne.ok = uniqueAriadne.records.length > 0 || tileErrors.length === 0;
                    stats.ariadne.records = uniqueAriadne.records.length;
                    stats.ariadne.received = collected.length;
                    stats.ariadne.points = uniqueAriadne.records.filter(function (r) { return r.positionKind !== 'cell'; }).length;
                    stats.ariadne.cellPoints = uniqueAriadne.records.filter(function (r) { return r.positionKind === 'cell'; }).length;
                    stats.ariadne.repeated = uniqueAriadne.dropped;
                    stats.ariadne.droppedOverBudget = droppedOverBudget;
                    stats.ariadne.sawHits = hitsSeen;
                    stats.ariadne.sawCells = cellsSeen;
                    stats.ariadne.tiles = tileList.length;
                    if (tileErrors.length) stats.ariadne.error = tileErrors[0];
                    // The portal's own period vocabulary for this area, largest first.
                    stats.ariadne.periods = Object.keys(periodsSeen).map(function (label) {
                        return { label: label, count: periodsSeen[label] };
                    }).sort(function (a, b) { return b.count - a.count; });
                    groups.push({ source: 'ariadne', records: uniqueAriadne.records });
                } else {
                    stats.ariadne = { ok: false, records: 0, requests: 0, error: 'not configured', mode: null };
                }

                // A grid cell that contains a DARE point adds nothing: DARE already
                // places that place precisely. Cells are dropped, never DARE.
                var ariadneGroup = groups.filter(function (g) { return g.source === 'ariadne'; })[0];
                var dareGroup = groups.filter(function (g) { return g.source === 'dare'; })[0];
                if (ariadneGroup && dareGroup && dareGroup.records.length && ariadneGroup.records.length) {
                    var keptCells = ariadneGroup.records.filter(function (r) {
                        if (r.positionKind !== 'cell') return true;
                        for (var i = 0; i < dareGroup.records.length; i++) {
                            if (merge.distanceM(r, dareGroup.records[i]) <= merge.DEFAULTS.distanceM) return false;
                        }
                        return true;
                    });
                    stats.ariadne.droppedNearDare = ariadneGroup.records.length - keptCells.length;
                    stats.ariadne.records = keptCells.length;
                    stats.ariadne.points = keptCells.filter(function (r) { return r.positionKind !== 'cell'; }).length;
                    stats.ariadne.cellPoints = keptCells.filter(function (r) { return r.positionKind === 'cell'; }).length;
                    ariadneGroup.records = keptCells;
                }

                var merged = merge.merge(groups, mergeOptions);
                var records = merged.records.map(function (r) { return Object.assign({}, r, { type: 'settlement' }); });
                records._meta = {
                    category: 'outside-sites',
                    region: 'outside-romania',
                    outsideRomania: false,          // a real catalogue answered here
                    sources: stats,
                    merged: merged.stats.merged,
                    attestedByBoth: merged.stats.crossSource || 0,
                    overlaps: merged.stats.overlaps.slice(0, 50),
                    attestedBy: merged.stats.sources,
                    returned: records.length,
                    truncated: false,
                    // A source that failed is named; the records shown are still real.
                    incomplete: !stats.dare.ok || (!!ariadne && !stats.ariadne.ok),
                    periodSource: 'unknown'
                };
                return records;
            }
        };
    }

    return {
        CONFIG: CONFIG, createProvider: createProvider, tilesFor: tilesFor,
        ariadneRecord: ariadneRecord, dareRecord: dareRecord
    };
});
