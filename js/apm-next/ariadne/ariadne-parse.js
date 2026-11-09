/*!
 * ARIADNE search response → records. Pure, no network, no DOM.
 *
 * Shape taken from the real response excerpt of 2026-11-09:
 *   { total:{value,relation},
 *     hits:[ { id, data:{ ariadneSubject:[{prefLabel}], publisher:[{name}],
 *                         title:{language,text}, spatial:[{centroid:{lon,lat},
 *                         geopoint:{lon,lat}, placeName, boundingbox}], resourceType } } ],
 *     aggregations:{ geogridCentroid:{grids:{buckets:[{key,doc_count}]}},
 *                    ariadneSubject:{buckets:[...]}, temporal:{temporal:{buckets:[...]}} } }
 *
 * A hit without a point is never given an invented one. A bounding box is not a site.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DetectLabAriadneParse = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function finite(v) { return typeof v === 'number' && Number.isFinite(v); }

    function point(v) {
        if (!v || typeof v !== 'object') return null;
        var lat = v.lat == null ? v.latitude : v.lat;
        var lon = v.lon == null ? (v.lng == null ? v.longitude : v.lng) : v.lon;
        lat = Number(lat); lon = Number(lon);
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
            var text = item[key] == null ? (item.name == null ? item.text : item.name) : item[key];
            if (text != null && String(text).trim() !== '') out.push(String(text));
        }
        return out;
    }

    function titleOf(data) {
        if (!data) return '';
        var t = data.title;
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
        var chosen = null, how = null, places = [], onlyBox = false;
        for (var i = 0; i < spatial.length; i++) {
            var s = spatial[i] || {};
            if (s.placeName) places.push(String(s.placeName));
            var p = point(s.geopoint);
            if (p && !chosen) { chosen = p; how = 'geopoint'; }
            if (!chosen) { p = point(s.centroid); if (p) { chosen = p; how = 'centroid'; } }
            if (!chosen && s.boundingbox) onlyBox = true;
        }
        if (!chosen) return { rejected: onlyBox ? 'bounding-box-only' : 'no-point' };
        var subjects = labelList(data.ariadneSubject, 'prefLabel');
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
                positionKind: how,
                approximatePosition: how === 'centroid',
                publisher: labelList(data.publisher, 'name')[0] || null,
                subjects: subjects,
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

    function parseResponse(json) {
        if (!json || typeof json !== 'object') return { hits: [], total: 0, relation: null, rejected: {}, buckets: {}, malformed: true };
        var hits = Array.isArray(json.hits) ? json.hits : [];
        var records = [], rejected = {};
        for (var i = 0; i < hits.length; i++) {
            var r = toRecord(hits[i]);
            if (r.record) records.push(r.record);
            else rejected[r.rejected] = (rejected[r.rejected] || 0) + 1;
        }
        var aggs = json.aggregations || {};
        return {
            hits: records,
            rawHits: hits.length,
            total: json.total && finite(Number(json.total.value)) ? Number(json.total.value) : records.length,
            relation: json.total && json.total.relation ? String(json.total.relation) : null,
            rejected: rejected,
            buckets: {
                subjects: readBuckets(aggs.ariadneSubject),
                temporal: readBuckets(aggs.temporal && aggs.temporal.temporal ? aggs.temporal.temporal : aggs.temporal),
                cells: readBuckets(aggs.geogridCentroid && aggs.geogridCentroid.grids ? aggs.geogridCentroid.grids : aggs.geogridCentroid),
                cellsTotal: aggs.geogridCentroid && aggs.geogridCentroid.grids && finite(aggs.geogridCentroid.grids.doc_count) ? aggs.geogridCentroid.grids.doc_count : null
            },
            malformed: false
        };
    }

    /** A positive training site: a point, and a published subject that says it is a site. */
    function isPositive(record, subjects) {
        if (!record || !Array.isArray(subjects) || !subjects.length) return false;
        if (!record.subjects || !record.subjects.length) return false;
        for (var i = 0; i < record.subjects.length; i++) {
            for (var j = 0; j < subjects.length; j++) {
                if (String(record.subjects[i]).toLowerCase() === String(subjects[j]).toLowerCase()) return true;
            }
        }
        return false;
    }

    return { parseResponse: parseResponse, toRecord: toRecord, isPositive: isPositive, point: point };
});
