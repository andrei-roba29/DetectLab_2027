/*!
 * ARIADNE search response → records and cells. Pure; no network, no DOM.
 *
 * Verified shape (operator's own responses, 2026-11-09):
 *   small box : hits populated, one page, no paging
 *   large box : hits: [] and aggregations.geogridCentroid.grids.buckets holds
 *               geohash-7 cells (~152 m), capped at 5000
 *
 * A hit is a point only when data.spatial[] carries a geopoint. A record with
 * just a boundingbox is a collection envelope, not a site: it is rejected, and
 * no coordinate is ever derived from the box or from its centroid.
 */
(function (root, factory) {
    var tiles = typeof module === 'object' && module.exports
        ? require('./ariadne-tiles.js')
        : root.DetectLabAriadneTiles;
    var api = factory(tiles);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DetectLabAriadneParse = api;
})(typeof self !== 'undefined' ? self : this, function (tiles) {
    'use strict';

    function finite(v) { return typeof v === 'number' && Number.isFinite(v); }

    function point(v) {
        if (!v || typeof v !== 'object') return null;
        var lat = Number(v.lat), lon = Number(v.lon == null ? v.lng : v.lon);
        if (!finite(lat) || !finite(lon)) return null;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
        return { lat: lat, lon: lon };
    }

    function labelList(value, key) {
        var out = [];
        if (!value) return out;
        var list = Array.isArray(value) ? value : [value];
        for (var i = 0; i < list.length; i++) {
            var item = list[i];
            if (item == null) continue;
            if (typeof item === 'string') { out.push(item); continue; }
            var text = item[key] == null ? item.name : item[key];
            if (text != null && String(text).trim() !== '') out.push(String(text));
        }
        return out;
    }

    function titleOf(data) {
        var t = data && data.title;
        if (t == null) return '';
        if (typeof t === 'string') return t;
        if (Array.isArray(t)) {
            for (var i = 0; i < t.length; i++) if (t[i] && t[i].text) return String(t[i].text);
            return '';
        }
        return t.text == null ? '' : String(t.text);
    }

    /** One hit → one record, or a rejection with a reason. */
    function toRecord(hit) {
        if (!hit || !hit.id) return { rejected: 'no-id' };
        var data = hit.data || {};
        var spatial = Array.isArray(data.spatial) ? data.spatial : (data.spatial ? [data.spatial] : []);
        var chosen = null, places = [], boxOnly = false;
        for (var i = 0; i < spatial.length; i++) {
            var s = spatial[i] || {};
            if (s.placeName) places.push(String(s.placeName));
            var p = point(s.geopoint);
            if (p && !chosen) chosen = p;
            if (!chosen && s.boundingbox) boxOnly = true;
        }
        // A collection envelope is not a location.
        if (!chosen) return { rejected: boxOnly ? 'collection-boundingbox-only' : 'no-geopoint' };
        return {
            record: {
                id: 'ariadne:' + String(hit.id),
                ariadneId: String(hit.id),
                name: titleOf(data),
                lat: chosen.lat,
                lon: chosen.lon,
                source: 'ariadne',
                type: data.resourceType || 'unknown',
                resourceType: data.resourceType || null,
                positionKind: 'geopoint',
                approximatePosition: false,
                publisher: labelList(data.publisher, 'name')[0] || null,
                subjects: labelList(data.ariadneSubject, 'prefLabel'),
                places: places,
                periodLabel: null
            }
        };
    }

    function readBuckets(node) {
        if (!node || !Array.isArray(node.buckets)) return [];
        return node.buckets.map(function (b) {
            return { key: b.key, count: b.doc_count == null ? b.count : b.doc_count };
        });
    }

    /** One grid bucket → one cell with a real centre, or a rejection. */
    function toCell(bucket) {
        if (!bucket || bucket.key == null) return { rejected: 'bad-cell' };
        var centre = tiles.cellCentre(String(bucket.key));
        if (!centre) return { rejected: 'bad-cell-key' };
        return {
            cell: {
                key: String(bucket.key),
                count: Number(bucket.doc_count == null ? bucket.count : bucket.doc_count) || 0,
                lat: centre.lat,
                lon: centre.lon,
                box: centre.box
            }
        };
    }

    function parseResponse(json) {
        if (!json || typeof json !== 'object') return { hits: [], cells: [], total: 0, rejected: { malformed: 1 }, buckets: {}, malformed: true };
        var rawHits = Array.isArray(json.hits) ? json.hits : [];
        var hits = [], rejected = {};
        for (var i = 0; i < rawHits.length; i++) {
            var r = toRecord(rawHits[i]);
            if (r.record) hits.push(r.record);
            else rejected[r.rejected] = (rejected[r.rejected] || 0) + 1;
        }
        var aggs = json.aggregations || {};
        var grid = aggs.geogridCentroid && aggs.geogridCentroid.grids ? aggs.geogridCentroid.grids : aggs.geogridCentroid;
        var buckets = readBuckets(grid);
        var cells = [];
        for (var j = 0; j < buckets.length; j++) {
            var c = toCell(buckets[j]);
            if (c.cell) cells.push(c.cell);
            else rejected[c.rejected] = (rejected[c.rejected] || 0) + 1;
        }
        return {
            hits: hits,
            rawHits: rawHits.length,
            cells: cells,
            gridDocCount: grid && finite(Number(grid.doc_count)) ? Number(grid.doc_count) : null,
            total: json.total && finite(Number(json.total.value)) ? Number(json.total.value) : null,
            relation: json.total && json.total.relation ? String(json.total.relation) : null,
            rejected: rejected,
            buckets: {
                subjects: readBuckets(aggs.ariadneSubject),
                temporal: readBuckets(aggs.temporal && aggs.temporal.temporal ? aggs.temporal.temporal : aggs.temporal)
            },
            malformed: false
        };
    }

    /* The portal's own subject vocabulary is not perfectly stable: the same idea is
     * published as "Site/monument", "Archaeological site", "Monument", "site"…
     * The rule stays the same (a published subject that says site or monument) but is
     * matched on words, not on one exact string, and the record's resource type counts
     * as a subject when the hit carries no subject list. Coins and inscriptions never
     * match, so they still cannot become settlement positives. */
    function subjectWords(value) {
        return String(value == null ? '' : value)
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .split(/[^a-z]+/).filter(Boolean);
    }

    function saysSite(value) {
        var words = subjectWords(value);
        for (var i = 0; i < words.length; i++) {
            if (words[i] === 'site' || words[i] === 'monument' || words[i] === 'monuments') return true;
        }
        return false;
    }

    /** A positive training site: a point, and a published subject that says it is a site. */
    function isPositive(record, subjects) {
        if (!record) return false;
        var wanted = Array.isArray(subjects) ? subjects : [];
        var published = (record.subjects || []).concat(record.type ? [record.type] : []);
        if (!published.length) return false;
        for (var i = 0; i < published.length; i++) {
            for (var j = 0; j < wanted.length; j++) {
                if (String(published[i]).toLowerCase() === String(wanted[j]).toLowerCase()) return true;
            }
            if (wanted.length && saysSite(published[i])) return true;
        }
        return false;
    }

    /** The cap is a truncation, not a total. */
    function isCapped(cellCount, cap) { return cellCount >= cap; }

    return { parseResponse: parseResponse, toRecord: toRecord, toCell: toCell, isPositive: isPositive, isCapped: isCapped, point: point };
});
