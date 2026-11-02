/* Read-only, viewport-bounded GeoPackage access over HTTP Range requests.
 * SQLite runs in a worker; the original .gpkg stays in public object storage.
 * No nationwide GeoJSON download, API key, server conversion or COOP/COEP.
 * See ROMANIA_HERITAGE_SUBLAYERS.md and js/vendor/geopackage/README.md. */
(function (root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DetectLabGeoPackage = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';
    var ENVELOPE_DOUBLES = [0, 4, 6, 6, 8];
    var MAX_VERTICES = 750000;
    var MAX_QUERY_BYTES = 12 * 1024 * 1024;
    var MAX_READ_BYTES = 48 * 1024 * 1024;

    function fail(code) { throw new Error(code); }
    function view(bytes) {
        if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
        return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    function header(bytes) {
        var v = view(bytes);
        if (v.byteLength < 8 || v.getUint8(0) !== 71 || v.getUint8(1) !== 80 || v.getUint8(2) !== 0) fail('invalid_geopackage_geometry');
        var flags = v.getUint8(3), envelope = (flags >> 1) & 7;
        if (envelope > 4 || (flags & 32)) fail('unsupported_geopackage_geometry');
        var start = 8 + ENVELOPE_DOUBLES[envelope] * 8;
        if (v.byteLength < start) fail('invalid_geopackage_geometry');
        var le = !!(flags & 1);
        return { view: v, offset: start, empty: !!(flags & 16), srs: v.getInt32(4, le),
            bbox: envelope ? [v.getFloat64(8, le), v.getFloat64(24, le), v.getFloat64(16, le), v.getFloat64(32, le)] : null };
    }

    /* GeoPackageBinary + OGC/ISO WKB. Preserve multipolygons and every hole;
       Z/M ordinates are consumed but this 2D map only needs X/Y. */
    function decodeGeometry(bytes, transform) {
        var h = header(bytes);
        if (h.empty) return null;
        var v = h.view, at = h.offset, vertices = 0;
        function need(n) { if (at + n > v.byteLength) fail('invalid_wkb'); }
        function uint(le) { need(4); var n = v.getUint32(at, le); at += 4; return n; }
        function number(le) { need(8); var n = v.getFloat64(at, le); at += 8; return n; }
        function geometry(depth) {
            if (depth > 16) fail('invalid_wkb');
            need(5);
            var endian = v.getUint8(at++);
            if (endian > 1) fail('invalid_wkb');
            var le = !!endian, raw = uint(le), iso = raw & 0x0fffffff;
            var dimensions = 2 + ((raw & 0x80000000) || Math.floor(iso / 1000) % 2 ? 1 : 0) +
                ((raw & 0x40000000) || Math.floor(iso / 1000) >= 2 ? 1 : 0);
            var type = iso % 1000;
            if (raw & 0x20000000) uint(le); // EWKB SRID, if present
            function point() {
                if (++vertices > MAX_VERTICES) fail('geometry_too_large');
                var x = number(le), y = number(le);
                for (var d = 2; d < dimensions; d++) number(le);
                if (Number.isNaN(x) && Number.isNaN(y)) return null; // WKB empty point
                if (!Number.isFinite(x) || !Number.isFinite(y)) fail('invalid_coordinates');
                var p = transform ? transform([x, y]) : [x, y];
                if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) fail('invalid_coordinates');
                return p;
            }
            function points() {
                var count = uint(le), out = [];
                if (count > MAX_VERTICES - vertices) fail('geometry_too_large');
                for (var i = 0; i < count; i++) {
                    var p = point();
                    if (!p) fail('invalid_wkb');
                    out.push(p);
                }
                return out;
            }
            if (type === 1) { var p = point(); return p ? { type: 'Point', coordinates: p } : null; }
            if (type === 2) return { type: 'LineString', coordinates: points() };
            var count = uint(le), out = [];
            if (count > MAX_VERTICES) fail('geometry_too_large');
            if (type === 3) {
                for (var r = 0; r < count; r++) out.push(points());
                return { type: 'Polygon', coordinates: out };
            }
            if (type < 4 || type > 7) fail('unsupported_wkb_type');
            var names = { 4: 'MultiPoint', 5: 'MultiLineString', 6: 'MultiPolygon', 7: 'GeometryCollection' };
            var childNames = { 4: 'Point', 5: 'LineString', 6: 'Polygon' };
            for (var c = 0; c < count; c++) {
                var child = geometry(depth + 1);
                if (!child) continue;
                if (type !== 7 && child.type !== childNames[type]) fail('invalid_wkb');
                out.push(type === 7 ? child : child.coordinates);
            }
            return type === 7 ? { type: names[type], geometries: out } : { type: names[type], coordinates: out };
        }
        return geometry(0);
    }

    function intersects(a, b) { return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]; }

    /* Read the standard SQLite RTree shadow nodes, not the virtual table.
       sql.js-httpvfs's SQLite build lacks ENABLE_RTREE. The shadow format is
       stable: big-endian header, then int64 id + four float32 bounds per cell. */
    function indexHits(nodes, bbox) {
        var hits = [], seen = new Set();
        function walk(id, depth) {
            if (depth < 0 || depth > 16 || seen.has(id) || !nodes.has(id)) fail('invalid_spatial_index');
            seen.add(id);
            var v = view(nodes.get(id));
            if (v.byteLength < 4) fail('invalid_spatial_index');
            var count = v.getUint16(2, false);
            if (4 + count * 24 > v.byteLength) fail('invalid_spatial_index');
            for (var i = 0; i < count; i++) {
                var at = 4 + i * 24;
                var key = v.getUint32(at, false) * 4294967296 + v.getUint32(at + 4, false);
                if (!Number.isSafeInteger(key)) fail('invalid_feature_id');
                var box = [v.getFloat32(at + 8, false), v.getFloat32(at + 16, false),
                    v.getFloat32(at + 12, false), v.getFloat32(at + 20, false)];
                if (!intersects(box, bbox)) continue;
                if (depth) walk(key, depth - 1);
                else hits.push(key);
            }
        }
        if (!nodes.has(1)) return hits;
        walk(1, view(nodes.get(1)).getUint16(0, false));
        return hits;
    }

    function quote(name) { return '"' + String(name).replace(/"/g, '""') + '"'; }
    function objects(result) {
        return result.reduce(function (out, table) {
            return out.concat(table.values.map(function (row) {
                var o = Object.create(null);
                table.columns.forEach(function (column, i) { o[column] = row[i]; });
                return o;
            }));
        }, []);
    }
    function projection(srs) {
        var code = String(srs.organization).toUpperCase() === 'EPSG' ? Number(srs.organization_coordsys_id) : null;
        if (code === 4326 || code === 4258) return { forward: function (p) { return p; }, inverse: function (p) { return p; } };
        var definition = srs.definition;
        // Stereo 70 (Romania) needs the datum shift, not just a Krassovsky
        // ellipsoid. Many older GPKGs omit TOWGS84 from their WKT definition.
        if (code === 3844 && !/TOWGS84/i.test(definition || '')) {
            definition = '+proj=sterea +lat_0=46 +lon_0=25 +k=0.99975 +x_0=500000 +y_0=500000 +ellps=krass +towgs84=2.329,-147.042,-92.08,-0.309,0.325,0.497,5.69 +units=m +no_defs';
        } else if (code === 3857) definition = 'EPSG:3857';
        if (!definition || definition === 'undefined' || !root.proj4) fail('unsupported_crs');
        try { return root.proj4(definition, 'EPSG:4326'); } catch (e) { fail('unsupported_crs'); }
    }
    function projectBounds(bbox, convert) {
        var points = [];
        // Sample all four edges: projected geographic bounds can be curved.
        for (var i = 0; i <= 8; i++) {
            var x = bbox[0] + (bbox[2] - bbox[0]) * i / 8;
            var y = bbox[1] + (bbox[3] - bbox[1]) * i / 8;
            points.push(convert([x, bbox[1]]), convert([x, bbox[3]]), convert([bbox[0], y]), convert([bbox[2], y]));
        }
        var out = [Infinity, Infinity, -Infinity, -Infinity];
        points.forEach(function (p) {
            if (!p || !p.every(Number.isFinite)) fail('invalid_coordinates');
            out[0] = Math.min(out[0], p[0]); out[1] = Math.min(out[1], p[1]);
            out[2] = Math.max(out[2], p[0]); out[3] = Math.max(out[3], p[1]);
        });
        var pad = Math.max(out[2] - out[0], out[3] - out[1]) * 0.001;
        return [out[0] - pad, out[1] - pad, out[2] + pad, out[3] + pad];
    }

    async function open(url, options) {
        options = options || {};
        var worker, db, stopped = false, pending = new Set(), tables = [];
        var aborter = new AbortController(), signal = options.signal;
        function abortError() { var e = new Error('GeoPackage closed'); e.name = 'AbortError'; return e; }
        function close(reason) {
            if (stopped) return;
            stopped = true;
            aborter.abort();
            if (worker) worker.terminate();
            var error = reason instanceof Error ? reason : abortError();
            pending.forEach(function (cancel) { cancel(error); });
            pending.clear();
            if (signal) signal.removeEventListener('abort', close);
        }
        function guard(promise) {
            if (stopped) return Promise.reject(abortError());
            return new Promise(function (resolve, reject) {
                var timer, settled = false;
                function finish(callback, value) {
                    if (settled) return;
                    settled = true; clearTimeout(timer); pending.delete(cancel);
                    callback(value);
                }
                function cancel(error) { finish(reject, error); }
                timer = setTimeout(function () { close(new Error('geopackage_timeout')); }, 30000);
                pending.add(cancel);
                Promise.resolve(promise).then(function (value) { finish(resolve, value); }, cancel);
            });
        }
        async function query(sql, params) { return objects(await guard(db.exec(sql, params || []))); }
        if (signal) {
            if (signal.aborted) { close(); throw abortError(); }
            signal.addEventListener('abort', close, { once: true });
        }
        try {
            // Refuse a server that ignores Range BEFORE it can download 75 MB.
            var probe = await guard(fetch(url, { headers: { Range: 'bytes=0-99' }, signal: aborter.signal }));
            if (probe.status !== 206) { if (probe.body) await probe.body.cancel(); fail('range_requests_required'); }
            var bytes = new Uint8Array(await guard(probe.arrayBuffer()));
            if (bytes.length !== 100 || String.fromCharCode.apply(null, bytes.subarray(0, 16)) !== 'SQLite format 3\u0000') fail('invalid_geopackage');
            var pageSize = new DataView(bytes.buffer).getUint16(16, false);
            if (pageSize === 1) pageSize = 65536;
            if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1))) fail('invalid_geopackage');
            var comlink = root.Comlink;
            if (!comlink) fail('sqlite_worker_unavailable');
            comlink.transferHandlers.set('WORKERSQLPROXIES', {
                canHandle: function () { return false; },
                serialize: function () { fail('read_only_geopackage'); },
                deserialize: function (port) { port.start(); return comlink.wrap(port); }
            });
            worker = new Worker(options.workerUrl);
            worker.addEventListener('error', function () { close(new Error('sqlite_worker_unavailable')); });
            var remote = comlink.wrap(worker);
            db = await guard(remote.SplitFileHttpDatabase(options.wasmUrl, [{ from: 'inline', config: {
                serverMode: 'full', url: url, requestChunkSize: pageSize
            } }], undefined, MAX_READ_BYTES));
            await query('PRAGMA query_only = ON');
            var catalog = await query('SELECT table_name, column_name, srs_id FROM gpkg_geometry_columns');
            if (!catalog.length) fail('no_feature_tables');
            for (var t = 0; t < catalog.length; t++) {
                var entry = catalog[t];
                var columns = await query('PRAGMA table_info(' + quote(entry.table_name) + ')');
                var keys = columns.filter(function (c) { return c.pk > 0; });
                if (keys.length !== 1 || !/INT/i.test(keys[0].type)) fail('invalid_geopackage_primary_key');
                var srs = await query('SELECT organization, organization_coordsys_id, definition FROM gpkg_spatial_ref_sys WHERE srs_id = ?', [entry.srs_id]);
                if (!srs.length) fail('unsupported_crs');
                var table = { name: entry.table_name, geom: entry.column_name, pk: keys[0].name, projection: projection(srs[0]), nodes: null, envelopes: null };
                var nodeTable = 'rtree_' + entry.table_name + '_' + entry.column_name + '_node';
                var index = await query('SELECT name FROM sqlite_master WHERE type = ? AND name = ?', ['table', nodeTable]);
                if (index.length) {
                    var size = await query('SELECT SUM(length(data)) AS bytes FROM ' + quote(nodeTable));
                    if (size[0].bytes > 4 * 1024 * 1024) fail('spatial_index_too_large');
                    var nodes = await query('SELECT nodeno, data FROM ' + quote(nodeTable));
                    table.nodes = new Map(nodes.map(function (n) { return [n.nodeno, n.data]; }));
                } else {
                    // Optional GPKG RTree absent: read ONLY the small binary
                    // envelopes, never the geometry overflow pages nationwide.
                    var envelopes = await query('SELECT ' + quote(table.pk) + ' AS id, substr(' + quote(table.geom) + ', 1, 72) AS header FROM ' + quote(table.name) + ' WHERE ' + quote(table.geom) + ' IS NOT NULL');
                    table.envelopes = envelopes.map(function (row) {
                        var h = header(row.header);
                        if (h.empty) return null;
                        if (!h.bbox) {
                            var point = decodeGeometry(row.header);
                            if (!point || point.type !== 'Point') fail('spatial_index_required');
                            h.bbox = point.coordinates.concat(point.coordinates);
                        }
                        return { id: row.id, bbox: h.bbox };
                    }).filter(Boolean);
                }
                tables.push(table);
            }
            return {
                close: close,
                stats: function () { return guard(remote.getStats()); },
                features: async function (bbox, limit) {
                    if (!bbox || bbox.length !== 4 || !bbox.every(Number.isFinite) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) fail('invalid_bbox');
                    limit = Math.max(1, Math.min(500, limit || 250));
                    var features = [], usedBytes = 0, truncated = false;
                    for (var t = 0; t < tables.length; t++) {
                        var table = tables[t], projected = projectBounds(bbox, table.projection.inverse);
                        var ids = table.nodes ? indexHits(table.nodes, projected) : table.envelopes.filter(function (r) { return intersects(r.bbox, projected); }).map(function (r) { return r.id; });
                        ids.sort(function (a, b) { return a - b; });
                        if (ids.length > limit - features.length) truncated = true;
                        ids = ids.slice(0, limit - features.length);
                        if (!ids.length) continue;
                        var placeholders = ids.map(function () { return '?'; }).join(',');
                        // SQLite's length(blob) does not read geometry overflow
                        // pages. Bound the payload before selecting any blobs.
                        var sizes = await query('SELECT ' + quote(table.pk) + ' AS id, length(' + quote(table.geom) + ') AS size FROM ' + quote(table.name) + ' WHERE ' + quote(table.pk) + ' IN (' + placeholders + ')', ids);
                        var accepted = sizes.filter(function (r) {
                            if (usedBytes + r.size > MAX_QUERY_BYTES) { truncated = true; return false; }
                            usedBytes += r.size; return true;
                        }).map(function (r) { return r.id; });
                        if (!accepted.length) continue;
                        var rows = await query('SELECT * FROM ' + quote(table.name) + ' WHERE ' + quote(table.pk) + ' IN (' + accepted.map(function () { return '?'; }).join(',') + ')', accepted);
                        for (var r = 0; r < rows.length; r++) {
                            if (stopped) throw abortError();
                            var properties = rows[r], blob = properties[table.geom];
                            delete properties[table.geom];
                            if (!blob) continue;
                            var geometry;
                            try { geometry = decodeGeometry(blob, table.projection.forward); }
                            catch (error) {
                                if (error.message !== 'geometry_too_large') throw error;
                                truncated = true; continue;
                            }
                            if (geometry) features.push({ type: 'Feature', id: table.name + '/' + properties[table.pk], properties: properties, geometry: geometry });
                            // Let a phone paint/respond between large polygons.
                            if (r % 8 === 0) await new Promise(function (resolve) { setTimeout(resolve, 0); });
                        }
                    }
                    return { type: 'FeatureCollection', features: features, truncated: truncated };
                }
            };
        } catch (err) { close(); throw err; }
    }
    return { open: open, decodeGeometry: decodeGeometry, indexHits: indexHits, projectBounds: projectBounds };
});
