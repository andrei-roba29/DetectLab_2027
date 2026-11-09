/*!
 * Splitting a 150 km search disc into query-sized tiles, and optional geohash
 * cells for hosts that only accept cell keys.
 *
 * Two independent strategies:
 *   splitBox()      — k-d style split of the bounding box, always available, and
 *                     what the provider uses by default (one bbox query per tile).
 *   geohashCells()  — standard geohash cover, for an index that filters on cells.
 *
 * Both are pure. Switching transport never touches either of them.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DetectLabAriadneTiles = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

    function boxAround(centre, radiusKm) {
        var dLat = radiusKm / 111.32;
        var cos = Math.cos(centre.lat * Math.PI / 180);
        // Near the poles a degree of longitude is very short; clamp instead of exploding.
        var dLon = radiusKm / (111.32 * Math.max(Math.abs(cos), 0.05));
        return {
            south: Math.max(-85, centre.lat - dLat),
            north: Math.min(85, centre.lat + dLat),
            west: Math.max(-180, centre.lon - dLon),
            east: Math.min(180, centre.lon + dLon)
        };
    }

    function area(box) { return (box.north - box.south) * (box.east - box.west); }

    function splitBox(box, maxTiles) {
        var tiles = [box];
        maxTiles = Math.max(1, maxTiles || 1);
        while (tiles.length < maxTiles) {
            // Always split the tile with the largest area, along its longer side.
            var worst = 0;
            for (var i = 1; i < tiles.length; i++) if (area(tiles[i]) > area(tiles[worst])) worst = i;
            var t = tiles[worst];
            var tall = (t.north - t.south) >= (t.east - t.west);
            var next = tiles.slice(0, worst).concat(tiles.slice(worst + 1));
            if (tall) {
                var midLat = (t.north + t.south) / 2;
                if (midLat === t.north || midLat === t.south) break;
                next.push({ south: t.south, north: midLat, west: t.west, east: t.east },
                          { south: midLat, north: t.north, west: t.west, east: t.east });
            } else {
                var midLon = (t.east + t.west) / 2;
                if (midLon === t.east || midLon === t.west) break;
                next.push({ south: t.south, north: t.north, west: t.west, east: midLon },
                          { south: t.south, north: t.north, west: midLon, east: t.east });
            }
            tiles = next;
        }
        return tiles;
    }

    function encloses(box, lat, lon) {
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

    /** Cell keys whose squares cover the box. Returns null when the cover would exceed `maxCells`. */
    function geohashCells(box, precision, maxCells) {
        precision = precision || 5;
        maxCells = maxCells || 64;
        var latStep = 1, lonStep = 1;
        var b = decodeGeohash(encodeGeohash((box.south + box.north) / 2, (box.west + box.east) / 2, precision));
        latStep = b.north - b.south;
        lonStep = b.east - b.west;
        var rows = Math.ceil((box.north - box.south) / latStep) + 1;
        var cols = Math.ceil((box.east - box.west) / lonStep) + 1;
        if (rows * cols > maxCells) return { cells: null, needed: rows * cols, precision: precision };
        var cells = {};
        for (var i = 0; i < rows; i++) {
            var lat = Math.min(box.north - 1e-9, box.south + i * latStep + latStep / 2);
            for (var j = 0; j < cols; j++) {
                var lon = Math.min(box.east - 1e-9, box.west + j * lonStep + lonStep / 2);
                cells[encodeGeohash(lat, lon, precision)] = true;
            }
        }
        return { cells: Object.keys(cells), needed: rows * cols, precision: precision };
    }

    return { boxAround: boxAround, splitBox: splitBox, encloses: encloses, encodeGeohash: encodeGeohash, decodeGeohash: decodeGeohash, geohashCells: geohashCells };
});
