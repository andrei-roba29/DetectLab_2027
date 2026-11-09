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

    /** ARIADNE hit → TRAIN record. Cells are density, not sites, and are refused. */
    function ariadneRecord(record) {
        if (!record || record.positionKind === 'cell') return null;
        if (!Number.isFinite(record.lat) || !Number.isFinite(record.lon)) return null;
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
                var stats = { dare: { ok: false, records: 0, error: null }, ariadne: { ok: false, records: 0, requests: 0, error: null, mode: null } };
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
                            (hits || []).forEach(function (record) {
                                var mappedRecord = ariadneRecord(record);
                                if (mappedRecord) collected.push(mappedRecord);
                            });
                        } catch (error) {
                            tileErrors.push(String(error && error.message || error));
                        }
                    }
                    // Only hits count; a disabled role or a grid-only answer leaves nothing.
                    // Overlapping tiles repeat a site near an edge: count it once.
                    var uniqueAriadne = merge.dedupeWithin(collected, merge.distanceM);
                    stats.ariadne.ok = uniqueAriadne.records.length > 0 || tileErrors.length === 0;
                    stats.ariadne.records = uniqueAriadne.records.length;
                    stats.ariadne.received = collected.length;
                    stats.ariadne.repeated = uniqueAriadne.dropped;
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

                var merged = merge.merge(groups, mergeOptions);
                var records = merged.records.map(function (r) { return Object.assign({}, r, { type: 'settlement' }); });
                records._meta = {
                    category: 'outside-sites',
                    region: 'outside-romania',
                    outsideRomania: false,          // a real catalogue answered here
                    sources: stats,
                    merged: merged.stats.merged,
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
