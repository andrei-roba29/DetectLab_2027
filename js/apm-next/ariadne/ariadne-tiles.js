/*!
 * Geometry for the ARIADNE portal: the bbox string, the size limits, the quadrant
 * recursion and the geohash-7 cell maths.
 *
 * bbox format is the portal's, verified from a browser:
 *   bbox=<N>,<W>,<S>,<E>   top-left lat, top-left lon, bottom-right lat, bottom-right lon
 *
 * Pure functions. No network, no DOM, no transport awareness.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DetectLabAriadneTiles = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
    var KM_PER_DEG_LAT = 111.32;

    function boxAround(centre, radiusKm) {
        var dLat = radiusKm / KM_PER_DEG_LAT;
        var cos = Math.cos(centre.lat * Math.PI / 180);
        var dLon = radiusKm / (KM_PER_DEG_LAT * Math.max(Math.abs(cos), 0.05));
        return {
            south: Math.max(-85, centre.lat - dLat),
            north: Math.min(85, centre.lat + dLat),
            west: Math.max(-180, centre.lon - dLon),
            east: Math.min(180, centre.lon + dLon)
        };
    }

    /** The portal's parameter format: N,W,S,E. */
    function bboxString(box) {
        return [box.north, box.west, box.south, box.east].map(function (v) { return Number(v.toFixed(6)); }).join(',');
    }

    /** Strict parser for the same format. Returns null rather than a repaired value. */
    function parseBbox(text) {
        if (typeof text !== 'string') return null;
        var parts = text.split(',');
        if (parts.length !== 4) return null;
        var n = parts.map(Number);
        if (!n.every(function (v) { return Number.isFinite(v); })) return null;
        var box = { north: n[0], west: n[1], south: n[2], east: n[3] };
        if (box.north <= box.south || box.east <= box.west) return null;
        if (box.north > 90 || box.south < -90 || box.west < -180 || box.east > 180) return null;
        return box;
    }

    function boxWidthKm(box, lat) {
        var mid = lat == null ? (box.north + box.south) / 2 : lat;
        return (box.east - box.west) * KM_PER_DEG_LAT * Math.cos(mid * Math.PI / 180);
    }

    function boxHeightKm(box) {
        return (box.north - box.south) * KM_PER_DEG_LAT;
    }

    function metresPerCell(precision) {
        // geohash-7 is about 152 m x 152 m; each step up/down is a factor of 32 in area.
        var base = 153;
        return base * Math.pow(8, 7 - (precision || 7));
    }

    /** Split until every side is at most maxSideKm. Used to respect the server's bbox limit. */
    function splitToMaxSide(box, maxSideKm) {
        var tiles = [box];
        // Same tolerance the server applies, so a 120.0000001 km side is not split.
        var limit = maxSideKm + 0.5;
        for (var guard = 0; guard < 4096; guard++) {
            var worst = -1, worstSide = 0;
            for (var i = 0; i < tiles.length; i++) {
                var side = Math.max(boxHeightKm(tiles[i]), boxWidthKm(tiles[i]));
                if (side > limit && side > worstSide) { worst = i; worstSide = side; }
            }
            if (worst < 0) break;
            var t = tiles[worst];
            var rest = tiles.slice(0, worst).concat(tiles.slice(worst + 1));
            if (boxHeightKm(t) >= boxWidthKm(t)) {
                var midLat = (t.north + t.south) / 2;
                if (midLat === t.north || midLat === t.south) break;
                rest.push({ south: t.south, north: midLat, west: t.west, east: t.east }, { south: midLat, north: t.north, west: t.west, east: t.east });
            } else {
                var midLon = (t.east + t.west) / 2;
                if (midLon === t.east || midLon === t.west) break;
                rest.push({ south: t.south, north: t.north, west: t.west, east: midLon }, { south: t.south, north: t.north, west: midLon, east: t.east });
            }
            tiles = rest;
        }
        return tiles;
    }

    /** The four quadrants of a box, in a fixed order: SW, SE, NW, NE. */
    function quadrants(box) {
        var midLat = (box.north + box.south) / 2;
        var midLon = (box.east + box.west) / 2;
        return [
            { south: box.south, north: midLat, west: box.west, east: midLon },
            { south: box.south, north: midLat, west: midLon, east: box.east },
            { south: midLat, north: box.north, west: box.west, east: midLon },
            { south: midLat, north: box.north, west: midLon, east: box.east }
        ];
    }

    function insideBox(box, lat, lon) {
        return lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;
    }

    function encodeGeohash(lat, lon, precision) {
        var latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
        var hash = '', bits = 0, bit = 0, even = true;
        precision = precision || 7;
        while (hash.length < precision) {
            if (even) {
                var midLon = (lonMin + lonMax) / 2;
                if (lon >= midLon) { bits = (bits << 1) | 1; lonMin = midLon; } else { bits = bits << 1; lonMax = midLon; }
            } else {
                var midLat = (latMin + latMax) / 2;
                if (lat >= midLat) { bits = (bits << 1) | 1; latMin = midLat; } else { bits = bits << 1; latMax = midLat; }
            }
            even = !even;
            if (++bit === 5) { hash += BASE32[bits]; bits = 0; bit = 0; }
        }
        return hash;
    }

    function decodeGeohash(hash) {
        var latMin = -90, latMax = 90, lonMin = -180, lonMax = 180, even = true;
        for (var i = 0; i < hash.length; i++) {
            var idx = BASE32.indexOf(hash[i]);
            if (idx < 0) throw new Error('invalid geohash character: ' + hash[i]);
            for (var m = 16; m >= 1; m = m >> 1) {
                if (even) { if (idx & m) lonMin = (lonMin + lonMax) / 2; else lonMax = (lonMin + lonMax) / 2; }
                else { if (idx & m) latMin = (latMin + latMax) / 2; else latMax = (latMin + latMax) / 2; }
                even = !even;
            }
        }
        return { south: latMin, north: latMax, west: lonMin, east: lonMax };
    }

    /** Centre point of a cell key; null when the key is not a geohash. */
    function cellCentre(key) {
        if (typeof key !== 'string' || !key.length) return null;
        for (var i = 0; i < key.length; i++) if (BASE32.indexOf(key[i]) < 0) return null;
        var box = decodeGeohash(key);
        return { lat: (box.north + box.south) / 2, lon: (box.east + box.west) / 2, box: box };
    }

    function distanceM(a, b) {
        var d = Math.PI / 180;
        var p = (b.lat - a.lat) * d, q = (b.lon - a.lon) * d;
        return 12742000 * Math.asin(Math.min(1, Math.sqrt(Math.sin(p / 2) * Math.sin(p / 2) + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(q / 2) * Math.sin(q / 2))));
    }

    /** Ray casting on a lon/lat polygon (ring of [lon, lat] pairs). */
    function insidePolygon(lat, lon, ring) {
        var inside = false;
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            var a = ring[i], b = ring[j];
            if (((a[1] > lat) !== (b[1] > lat)) && lon < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        return inside;
    }

    return {
        boxAround: boxAround, bboxString: bboxString, parseBbox: parseBbox,
        boxWidthKm: boxWidthKm, boxHeightKm: boxHeightKm, metresPerCell: metresPerCell,
        splitToMaxSide: splitToMaxSide, quadrants: quadrants, insideBox: insideBox,
        encodeGeohash: encodeGeohash, decodeGeohash: decodeGeohash, cellCentre: cellCentre,
        distanceM: distanceM, insidePolygon: insidePolygon
    };
});
