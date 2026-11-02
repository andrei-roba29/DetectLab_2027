#!/usr/bin/env python3
"""Generate a small, deterministic GeoPackage for the range-reader tests.

No downloads or GIS dependencies. The large out-of-view geometries and an
actual multi-level SQLite RTree catch accidental nationwide/full-file reads.
Output goes to a caller-supplied temporary path, never into the repository.
"""
import math
import sqlite3
import struct
import sys
from pathlib import Path


def mercator(point):
    x, y = point
    return [x * 20037508.342789244 / 180,
            math.log(math.tan(math.pi / 4 + y * math.pi / 360)) * 20037508.342789244 / math.pi]


def polygon(rings):
    data = struct.pack('<BI', 1, 3) + struct.pack('<I', len(rings))
    for ring in rings:
        data += struct.pack('<I', len(ring))
        data += b''.join(struct.pack('<dd', *point) for point in ring)
    return data


def geometry(rings, srs):
    points = [p for ring in rings for p in ring]
    xs, ys = zip(*points)
    bbox = [min(xs), max(xs), min(ys), max(ys)]
    return b'GP' + struct.pack('<BBi', 0, 3, srs) + struct.pack('<dddd', *bbox) + polygon(rings), bbox


def build(path):
    path = Path(path)
    path.unlink(missing_ok=True)
    db = sqlite3.connect(str(path))
    db.executescript('''
        PRAGMA application_id = 1196444487;
        PRAGMA user_version = 10300;
        CREATE TABLE gpkg_contents (table_name TEXT PRIMARY KEY, data_type TEXT NOT NULL,
            identifier TEXT, description TEXT, last_change TEXT DEFAULT CURRENT_TIMESTAMP, srs_id INTEGER);
        CREATE TABLE gpkg_geometry_columns (table_name TEXT, column_name TEXT,
            geometry_type_name TEXT, srs_id INTEGER, z INTEGER DEFAULT 0, m INTEGER DEFAULT 0);
        CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT, srs_id INTEGER PRIMARY KEY,
            organization TEXT, organization_coordsys_id INTEGER, definition TEXT);
    ''')
    for srs in [4326, 3857]:
        db.execute('INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?)',
                   ['EPSG:' + str(srs), srs, 'EPSG', srs, 'undefined'])
    outer = [[22.84, 47.73], [22.92, 47.73], [22.92, 47.81], [22.84, 47.81], [22.84, 47.73]]
    hole = [[22.86, 47.75], [22.86, 47.76], [22.87, 47.76], [22.87, 47.75], [22.86, 47.75]]
    for table, srs in [('protected', 4326), ('projected', 3857), ('no_index', 4326)]:
        db.execute(f'CREATE TABLE {table} (fid INTEGER PRIMARY KEY, geom BLOB, name TEXT)')
        db.execute('INSERT INTO gpkg_contents (table_name,data_type,identifier,srs_id) VALUES (?,?,?,?)', [table, 'features', table, srs])
        db.execute('INSERT INTO gpkg_geometry_columns (table_name,column_name,geometry_type_name,srs_id) VALUES (?,?,?,?)', [table, 'geom', 'POLYGON', srs])
        if table != 'no_index':
            db.execute(f'CREATE VIRTUAL TABLE rtree_{table}_geom USING rtree(id,minx,maxx,miny,maxy)')
        rings = [[mercator(p) for p in ring] for ring in [outer, hole]] if srs == 3857 else [outer, hole]
        blob, bbox = geometry(rings, srs)
        db.execute(f'INSERT INTO {table} VALUES (?,?,?)', [1, blob, '<script>unsafe()</script> · Satu Mare'])
        if table != 'no_index':
            db.execute(f'INSERT INTO rtree_{table}_geom VALUES (?,?,?,?,?)', [1] + bbox)
        if table == 'protected':
            for fid in range(2, 182):
                x, y = 27 + fid / 10000, 45 + fid / 10000
                ring = [[x + .02 * math.cos(i * 2 * math.pi / 1400),
                         y + .02 * math.sin(i * 2 * math.pi / 1400)] for i in range(1400)]
                ring.append(ring[0])
                blob, bbox = geometry([ring], srs)
                db.execute(f'INSERT INTO {table} VALUES (?,?,?)', [fid, blob, 'Outside viewport'])
                db.execute(f'INSERT INTO rtree_{table}_geom VALUES (?,?,?,?,?)', [fid] + bbox)
    db.commit()
    db.close()


if __name__ == '__main__':
    build(sys.argv[1])
