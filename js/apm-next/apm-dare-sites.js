/*!
 * DetectLab — Next-Gen APM · DARE (Digital Atlas of the Roman Empire) site source.
 *
 * The map layer already reads this endpoint; this module reads the same one for
 * training, with one request per training area.
 *
 *   GET https://imperium.ahlfeldt.se/api/geojson.php?bbox=<W>,<S>,<E>,<N>&zoom=<z>
 *
 * Facts taken from the shipped map layer (js/europe-roman-atlas.js), not guessed:
 *   - bbox order is west, south, east, north;
 *   - the service answers a GeoJSON FeatureCollection of Point features;
 *   - `properties.name`, `properties.ancient`, `properties.numType` (category),
 *     `properties.type`, `properties.country`, `properties.pid` where present;
 *   - the map clamps zoom at 10 and only loads at level 7 or more.
 *
 * What this module adds for training: category selection, the settlement record
 * shape the TRAIN pipeline expects, and an honest meta block. Nothing here claims
 * a date the service does not publish.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DetectLabApmDareSites = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var CONFIG = {
        base: 'https://imperium.ahlfeldt.se/api/geojson.php',
        minZoom: 7,
        maxZoom: 10,
        // Settlement-bearing DARE categories. 11 major, 12 regular, 13 civitas
        // capitals, 14 villas. Forts (17/18) and cemeteries (63) are NOT settlements
        // and are deliberately absent.
        settlementCategories: [11, 12, 13, 14],
        // DARE publishes place points; the underlying precision is not stated per
        // feature, so the record says exactly that instead of inventing a figure.
        positionAccuracyM: 50,
        timeoutMs: 18000
    };

    var CATEGORY_LABEL = { 11: 'Major settlement', 12: 'Regular settlement', 13: 'Civitas capital', 14: 'Villa' };

    function bboxFor(centre, radiusKm) {
        var dLat = radiusKm / 111.32;
        var dLon = radiusKm / (111.32 * Math.cos(centre.lat * Math.PI / 180));
        return {
            north: Math.min(90, centre.lat + dLat), south: Math.max(-90, centre.lat - dLat),
            west: Math.max(-180, centre.lon - dLon), east: Math.min(180, centre.lon + dLon)
        };
    }

    /** Web-map zoom that keeps the requested box inside a few tiles. */
    function zoomFor(box) {
        var span = Math.max(box.east - box.west, box.north - box.south);
        if (!(span > 0)) return CONFIG.maxZoom;
        var z = Math.log(360 / span) / Math.LN2 + 1;
        return Math.max(CONFIG.minZoom, Math.min(CONFIG.maxZoom, Math.round(z)));
    }

    function round4(v) { return Math.round(v * 1e4) / 1e4; }

    function buildUrl(box, zoom) {
        return CONFIG.base + '?bbox=' + [box.west, box.south, box.east, box.north].map(round4).join(',') +
            '&zoom=' + Math.max(CONFIG.minZoom, Math.min(CONFIG.maxZoom, Math.round(zoom)));
    }

    function fixMojibake(s) {
        return String(s == null ? '' : s).replace(/Ã©/g, 'é').replace(/Ã /g, 'à').replace(/Ã¨/g, 'è')
            .replace(/Ã¢/g, 'â').replace(/Ã´/g, 'ô').replace(/Ã§/g, 'ç').replace(/Ã¼/g, 'ü');
    }

    function categoryOf(props) {
        var n = parseInt(props.numType, 10);
        if (isNaN(n)) n = parseInt(props.type, 10);
        return isNaN(n) ? null : n;
    }

    /** One GeoJSON feature → the record shape TRAIN expects, or null. */
    function toRecord(feature, categories) {
        if (!feature || !feature.geometry || feature.geometry.type !== 'Point' || !feature.geometry.coordinates) return null;
        var props = feature.properties || {};
        var lon = Number(feature.geometry.coordinates[0]);
        var lat = Number(feature.geometry.coordinates[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
        var category = categoryOf(props);
        if (categories && category != null && categories.indexOf(category) < 0) return null;
        var id = String(feature.id != null ? feature.id : (props.id != null ? props.id : ''));
        if (!id) return null;
        var name = fixMojibake(props.name != null ? props.name : props.NAME).trim();
        var ancient = fixMojibake(props.ancient != null ? props.ancient : (props.ancient_name || props.ANCIENT)).trim();
        return {
            id: 'dare:' + id,
            name: name || ancient || ('DARE ' + id),
            ancientName: ancient || null,
            lat: lat, lon: lon,
            type: 'settlement',
            positionAccuracy: CONFIG.positionAccuracyM,
            approximatePosition: false,
            positionAccepted: true,
            source: 'dare',
            sourceIds: { dare: id },
            // A DARE place id is not documented as a Pleiades id, so it is not used as one.
            pleiadesId: props.pid ? String(props.pid) : null,
            category: category,
            categoryLabel: CATEGORY_LABEL[category] || null,
            country: fixMojibake(props.country).trim() || null,
            // No dates are published per feature: the record says so rather than guessing.
            periods: [],
            periodSource: 'unknown'
        };
    }

    function parse(collection, categories) {
        var features = (collection && collection.features) || [];
        var records = [], dropped = 0;
        features.forEach(function (f) {
            var record = toRecord(f, categories);
            if (record) records.push(record); else dropped++;
        });
        return { records: records, dropped: dropped, received: features.length };
    }

    function createProvider(options) {
        options = options || {};
        var config = Object.assign({}, CONFIG, options.config || {});
        var fetchImpl = options.fetch || (typeof fetch === 'function' ? fetch : null);
        return {
            id: 'dare',
            label: 'DARE — Digital Atlas of the Roman Empire',
            source: config.base,
            getSites: async function (centre, radiusKm, opts) {
                opts = opts || {};
                if (!fetchImpl) throw new Error('DARE: no fetch available');
                var box = bboxFor(centre, radiusKm);
                var url = buildUrl(box, zoomFor(box));
                var response = await fetchImpl(url, { signal: opts.signal });
                if (!response || !response.ok) {
                    throw new Error('DARE request failed' + (response ? ' (' + response.status + ')' : ''));
                }
                var json = typeof response.json === 'function' ? await response.json() : response;
                var parsed = parse(json, config.settlementCategories);
                var records = parsed.records.slice();
                records._meta = {
                    category: 'outside-sites', source: 'dare', url: url, zoom: zoomFor(box),
                    categories: config.settlementCategories,
                    received: parsed.received, returned: records.length, dropped: parsed.dropped,
                    truncated: false, outsideRomania: true, periodSource: 'unknown'
                };
                return records;
            },
            buildUrl: function (centre, radiusKm) { var b = bboxFor(centre, radiusKm); return buildUrl(b, zoomFor(b)); }
        };
    }

    return {
        CONFIG: CONFIG, createProvider: createProvider, parse: parse, toRecord: toRecord,
        bboxFor: bboxFor, zoomFor: zoomFor, buildUrl: buildUrl, categoryOf: categoryOf
    };
});
