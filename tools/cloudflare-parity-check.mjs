/*
 * tools/cloudflare-parity-check.mjs
 * ───────────────────────────────────────────────────────────────────────────
 * Proves, at build time, that the generated Cloudflare copies behave exactly
 * like the modules they were generated from — so nothing was "silently changed
 * to make the code compile".
 *
 *   netlify/lib/map3d-tile.mjs            ↔ functions/_generated/map3d-tile.mjs
 *   netlify/lib/map3d-country-modules.mjs ↔ functions/_generated/map3d-country-modules.mjs
 *   backend/src/lib/finland-geo.mjs       ↔ functions/_generated/finland-geo.mjs
 *
 * Both sides are loaded in the SAME Node process and driven with the same
 * inputs; every comparison is on the observable output (returned objects, the
 * upstream URL that would be fetched, response status/headers/body bytes), never
 * on source text. `globalThis.fetch` is replaced with a recorder, so the
 * comparison covers the real request path without any network access.
 *
 * Used by tools/sync-cloudflare-generated.mjs (default when writing, and with
 * --check --verify) and by test-cloudflare-generated.mjs.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rel = (root, p) => pathToFileURL(path.join(root, p)).href;

/** Every Web-Mercator tile the two implementations must agree on. */
const TILE_MATRIX = [];
for (const z of [0, 1, 3, 7, 10, 13, 16, 19, 22]) {
    const n = Math.pow(2, z);
    TILE_MATRIX.push([z, 0, 0], [z, n - 1, n - 1], [z, n >> 1, n >> 1], [z, Math.min(1, n - 1), Math.min(2, n - 1)]);
}
const CRS_LIST = ['EPSG:3857', 'EPSG:900913', 'EPSG:4326', 'CRS:84', 'EPSG:4258', 'EPSG:2180', 'EPSG:25832', '', null, 'weird'];

/** Query strings the tile validator must classify identically. */
const TILE_QUERIES = [
    '',
    'layer=',
    'layer=nope&z=1&x=0&y=0',
    'layer=dummy&z=-1&x=0&y=0',
    'layer=dummy&z=23&x=0&y=0',
    'layer=dummy&z=3&x=8&y=0',
    'layer=dummy&z=3&x=0&y=-1',
    'layer=dummy&z=3&x=0&y=0&t=2021',
    'layer=dummy&z=3&x=0&y=0&t=2021-06',
    'layer=dummy&z=3&x=0&y=0&t=2021-06-04',
    'layer=dummy&z=3&x=0&y=0&t=yesterday',
    'layer=dummy&z=3&x=0&y=0&p=1104-2155Fore',
    'layer=dummy&z=3&x=0&y=0&p=a',
    'layer=dummy&z=3&x=0&y=0&p=bad product!',
    'layer=dummy&z=3&x=0&y=0&m=elevation',
    'layer=dummy&z=3&x=0&y=0&m=' + 'x'.repeat(41),
    'layer=dummy&z=abc&x=0&y=0'
];

/** Relay-mode URLs: allowed hosts, refused hosts, and malformed input. */
const RELAY_URLS = [
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/1360/2176',
    'https://pastmaps.cenagis.edu.pl/geoserver/ihpan/wms?SERVICE=WMS',
    'https://geoserve.cast.uark.edu/geoserver/gwc/service/wms?SERVICE=WMS',
    'https://image.discomap.eea.europa.eu/arcgis/services/VHR2018/ImageServer/exportImage',
    'https://maps.lantmateriet.se/hojdmodell/wms/v1.1?SERVICE=WMS',
    'https://api.dataforsyningen.dk/dhm_terraen_skyggekort_DAF?request=GetTile',
    'https://raw.githubusercontent.com/Some/Repo/main/tiles/1/2/3.png',
    'https://overpass-api.de/api/interpreter',
    'https://evil.example.com/tile.png',
    'https://detectlab.ro/api/map3d/tile',
    'http://localhost:8788/tile.png',
    'http://127.0.0.1/tile.png',
    'http://10.0.0.5/tile.png',
    'http://192.168.1.1/tile.png',
    'http://169.254.169.254/latest/meta-data/',
    'http://172.16.0.9/tile.png',
    'https://[::1]/tile.png',
    'ftp://server.arcgisonline.com/tile.png',
    'file:///etc/passwd',
    'https://user:pass@server.arcgisonline.com/tile.png',
    'https://server.arcgisonline.com/tile.png x',
    'not a url',
    '',
    'https://' + 'a'.repeat(4100) + '.example/x'
];

/** /api/geo/finland?src=… inputs, allowed and refused. */
const FINLAND_QUERIES = [
    'src=mml-hillshade&z=11&col=984&row=1306',
    'src=mml-hillshade&z=99&col=1&row=1',
    'src=mml-hillshade&z=11&col=-1&row=1',
    'src=mml-hillshade-open&z=11&col=984&row=1306',
    'src=museo-tile&z=8&col=128&row=128',
    'src=hkp-tile&id=623&x=1&y=1&z=8',
    'src=hkp-tile&id=999&x=1&y=1&z=8',
    'src=museo-wfs&id=133&bbox=24.9,60.1,25.1,60.3',
    'src=museo-wfs&id=131&bbox=24.9,60.1,25.1,60.3',
    'src=museo-wfs&id=133&bbox=60.1,24.9,60.3,25.1',
    'src=museo-wfs&id=133&bbox=20,55,35,70',
    'src=syke&url=' + encodeURIComponent('https://paikkatiedot.ymparisto.fi/geoserver/wfs?service=WFS&request=GetFeature&token=SECRET'),
    'src=syke&url=' + encodeURIComponent('https://evil.example.com/geoserver/wfs'),
    'src=aland&url=' + encodeURIComponent('https://kartor.regeringen.ax/arcgis/rest/services/Kartor/MapServer/export?bbox=1,2,3,4&username=u&password=p'),
    'src=aland&url=' + encodeURIComponent('http://kartor.regeringen.ax/arcgis/rest/services/Kartor/MapServer/export'),
    'src=aland&url=' + encodeURIComponent('https://kartor.regeringen.ax/somewhere/else'),
    'src=unknown-source',
    '',
    'src=syke'
];

/* ── fetch recorder ──────────────────────────────────────────────────────── */

function installFetchRecorder() {
    const real = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        calls.push({ url, init: init ? JSON.parse(JSON.stringify({ method: init.method || 'GET', headers: init.headers || null })) : null });
        /* A tiny but valid PNG, so the image sniffing path is exercised. */
        const png = Uint8Array.from(atob(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGD4DwABBAEAcCBlCwAAAABJRU5ErkJggg=='
        ), (c) => c.charCodeAt(0));
        return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    };
    return {
        calls,
        restore() { globalThis.fetch = real; }
    };
}

function summarise(calls) {
    return calls.map((c) => c.url + '|' + JSON.stringify(c.init && c.init.headers));
}

/* The one intentional textual difference between the two copies: the relay
 * refusal tells a Cloudflare operator to re-run the generator after editing the
 * allow-list. Everything else must be identical. */
const KNOWN_TEXT_DIFFERENCES = [
    [', then re-run node tools/sync-cloudflare-generated.mjs', '']
];

function normalizeKnownDifferences(value) {
    let out = String(value);
    for (const [from, to] of KNOWN_TEXT_DIFFERENCES) out = out.split(from).join(to);
    return out;
}

async function responseFingerprint(response) {
    const headers = {};
    for (const [k, v] of response.headers) headers[k.toLowerCase()] = v;
    let body = '';
    try {
        const buf = new Uint8Array(await response.clone().arrayBuffer());
        body = buf.length + ':' + Array.from(buf.subarray(0, 24)).join(',');
        if (headers['content-type'] && headers['content-type'].includes('json')) {
            body = JSON.stringify(JSON.parse(new TextDecoder().decode(buf)));
        }
    } catch (err) {
        body = 'unreadable:' + String(err).slice(0, 40);
    }
    return { status: response.status, headers, body };
}

/* ═══════════════════════════════════════════════════════════════════════════ */

export async function verifyParity({ root, quiet = false } = {}) {
    const ROOT = root || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const say = (m) => { if (!quiet) console.log(m); };
    const report = { checks: 0 };
    const step = (name) => { report.checks++; say('  · ' + name); };

    const original = await import(rel(ROOT, 'netlify/lib/map3d-tile.mjs'));
    const generated = await import(rel(ROOT, 'functions/_generated/map3d-tile.mjs'));
    const originalModules = await import(rel(ROOT, 'netlify/lib/map3d-country-modules.mjs'));
    const generatedModules = await import(rel(ROOT, 'functions/_generated/map3d-country-modules.mjs'));
    const originalFinland = await import(rel(ROOT, 'backend/src/lib/finland-geo.mjs'));
    const generatedFinland = await import(rel(ROOT, 'functions/_generated/finland-geo.mjs'));

    /* ── 1. the registry: the allow-list itself ─────────────────────────── */
    {
        const a = original.registry.list().map((d) => d.id).sort();
        const b = generated.registry.list().map((d) => d.id).sort();
        assert.deepEqual(b, a, 'the generated map3d module must see exactly the same layer registry');
        assert.ok(a.length > 100, 'the registry looks empty — the config require()s were not bundled');
        step(`layer registry identical (${a.length} layers, both sides the same module instance: ${original.registry === generated.registry})`);
    }

    /* ── 2. pure Web-Mercator / CRS maths ───────────────────────────────── */
    {
        assert.equal(original.MERCATOR_R, generated.MERCATOR_R);
        assert.equal(original.MERCATOR_HALF, generated.MERCATOR_HALF);
        for (const [z, x, y] of TILE_MATRIX) {
            assert.deepEqual(generated.tileBounds3857(z, x, y), original.tileBounds3857(z, x, y), `tileBounds3857(${z},${x},${y})`);
            for (const crs of CRS_LIST) {
                assert.deepEqual(generated.tileBboxInCrs(z, x, y, crs), original.tileBboxInCrs(z, x, y, crs),
                    `tileBboxInCrs(${z},${x},${y},${crs})`);
            }
        }
        for (const [lon, lat] of [[19.4, 47.5], [21.0, 52.25], [-18.0, 64.1], [60.0, 69.9], [0, 0], [9.5, 55.7]]) {
            assert.deepEqual(generated.lonLatTo3857(lon, lat), original.lonLatTo3857(lon, lat), `lonLatTo3857(${lon},${lat})`);
            assert.deepEqual(generated.lonLatToEpsg2180(lon, lat), original.lonLatToEpsg2180(lon, lat), `lonLatToEpsg2180(${lon},${lat})`);
            const [mx, my] = original.lonLatTo3857(lon, lat);
            assert.deepEqual(generated.mercatorToLonLat(mx, my), original.mercatorToLonLat(mx, my), `mercatorToLonLat(${mx},${my})`);
        }
        step(`tile maths + CRS transforms identical over ${TILE_MATRIX.length} tiles × ${CRS_LIST.length} CRS`);
    }

    /* ── 3. the relay allow-list (the open-proxy guard) ─────────────────── */
    {
        const a = [...original.relayAllowedHosts()].sort();
        const b = [...generated.relayAllowedHosts()].sort();
        assert.deepEqual(b, a, 'the relay host allow-list must be set-identical');
        assert.ok(a.includes('server.arcgisonline.com') && a.includes('pastmaps.cenagis.edu.pl'),
            'the relay allow-list looks wrong');
        for (const raw of RELAY_URLS) {
            const url = 'https://detectlab.ro/api/map3d/tile?u=' + encodeURIComponent(raw);
            assert.deepEqual(
                generated.validateRelayUrl(raw),
                original.validateRelayUrl(raw),
                'validateRelayUrl(' + raw.slice(0, 60) + ')');
            assert.deepEqual(
                generated.validateTileRequest(new URL(url)),
                original.validateTileRequest(new URL(url)),
                'validateTileRequest(relay ' + raw.slice(0, 40) + ')');
        }
        step(`relay allow-list set-identical (${a.length} hosts) and ${RELAY_URLS.length} relay URLs classified the same`);
    }

    /* ── 4. request validation ──────────────────────────────────────────── */
    {
        const layers = original.registry.list();
        const samples = [layers[0], layers[Math.floor(layers.length / 2)], layers[layers.length - 1]]
            .filter(Boolean).map((d) => d.id);
        let n = 0;
        for (const q of TILE_QUERIES) {
            for (const id of ['', ...samples]) {
                const query = q.replace('dummy', id || 'dummy');
                const url = new URL('https://detectlab.ro/api/map3d/tile?' + query);
                const a = original.validateTileRequest(url);
                const b = generated.validateTileRequest(url);
                /* `def` is the registry object; compare its identity-relevant fields. */
                const norm = (r) => Object.assign({}, r, { def: r.def ? { id: r.def.id, kind: r.def.kind, crs: r.def.crs || null } : undefined });
                assert.deepEqual(norm(b), norm(a), 'validateTileRequest(' + query + ')');
                n++;
            }
        }
        step(`${n} tile requests validated identically`);
    }

    /* ── 5. upstream URL building for EVERY registered layer ────────────── */
    {
        const layers = original.registry.list();
        let compared = 0;
        let dynamic = 0;
        const aScope = originalModules.countryModuleScope();
        const bScope = generatedModules.countryModuleScope();

        assert.deepEqual(Object.keys(bScope).sort(), Object.keys(aScope).sort(),
            'the country-module sandbox must expose the same globals');

        for (const def of layers) {
            const bDef = generated.layerById(def.id);
            assert.ok(bDef, 'layer missing from the generated registry: ' + def.id);
            for (const [z, x, y] of [[12, 2176, 1360], [6, 33, 21], [16, 35000, 22000]]) {
                for (const extra of [{}, { time: '2021' }, { product: '1104-2155Fore' }, { mode: 'elevation' }, { mode: 'dtm' }]) {
                    const args = Object.assign({ z, x, y }, extra);
                    const a = original.buildUpstreamUrl(def, args);
                    const b = generated.buildUpstreamUrl(bDef, args);
                    assert.deepEqual(b, a, `buildUpstreamUrl(${def.id}, ${JSON.stringify(args)})`);
                    compared++;
                }
            }
            if (def.kind === 'dynamic' && def.builder && def.builder.module) {
                dynamic++;
                /* The per-tile builder is the part that used node:vm. */
                for (const mode of ['', 'dtm', 'dsm', 'elevation', 'surface', 'height', 'hillshade', 'multi']) {
                    for (const [z, x, y] of [[13, 4352, 2720], [10, 544, 340]]) {
                        const a = original.registry.tileUrlAt(def, z, x, y, { modules: aScope, mode });
                        const b = generated.registry.tileUrlAt(bDef, z, x, y, { modules: bScope, mode });
                        assert.equal(b, a, `tileUrlAt(${def.id}, ${z}/${x}/${y}, mode=${mode}) — the embedded country module must build the same URL as the node:vm sandbox`);
                        compared++;
                    }
                }
            }
            assert.equal(generated.proxyMode(bDef), original.proxyMode(def), 'proxyMode(' + def.id + ')');
        }
        assert.ok(dynamic > 0, 'no module-backed layer was exercised — the sandbox parity check is vacuous');
        const aReport = original.proxyReport();
        const bReport = generated.proxyReport();
        assert.deepEqual(bReport, aReport, 'proxyReport()');
        step(`${compared} upstream URLs built identically for ${layers.length} layers (${dynamic} of them module-backed, i.e. built inside the sandbox)`);
    }

    /* ── 6. handleTileRequest end to end ────────────────────────────────── */
    {
        const layers = original.registry.list();
        const ids = [layers[0].id, layers[Math.floor(layers.length / 2)].id, layers[layers.length - 1].id];
        const moduleBacked = layers.find((d) => d.kind === 'dynamic' && d.builder && d.builder.module);
        const cases = [
            '/api/map3d/tile?layer=' + encodeURIComponent(ids[0]) + '&z=12&x=2176&y=1360',
            '/api/map3d/tile?layer=' + encodeURIComponent(ids[1]) + '&z=10&x=544&y=340&t=2021',
            '/api/map3d/tile?layer=not-a-layer&z=10&x=1&y=1',
            '/api/map3d/tile?layer=' + encodeURIComponent(ids[2]) + '&z=99&x=1&y=1',
            '/api/map3d/tile?u=' + encodeURIComponent('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/1360/2176'),
            '/api/map3d/tile?u=' + encodeURIComponent('https://evil.example.com/x.png'),
            '/api/map3d/tile?u=' + encodeURIComponent('http://169.254.169.254/latest/meta-data/')
        ];
        if (moduleBacked) {
            cases.push('/api/map3d/tile?layer=' + encodeURIComponent(moduleBacked.id) + '&z=13&x=4352&y=2720');
        }
        /* Layers that exercise the paths the migration brief singles out: the
         * EPSG:2180 reprojection, a module-backed per-tile builder, the CORONA
         * product parameter, and — importantly — the definitions whose registry
         * URL is a RELATIVE same-origin proxy path (/api/geo/dk-dtk25 and
         * friends). A relative URL cannot be fetched by undici on Netlify nor by
         * the Workers runtime, so both answer with the labelled blank tile; that
         * is pre-existing behaviour and it must not change here. */
        for (const id of ['cenagis.city_warszawa_1822', 'cenagis.kdr', 'danish.dtk25', 'danish.orto',
                          'danish.fortidsminder', 'lidar.dk-dhm', 'lidar.se-lantmateriet',
                          'lidar.nl-ahn', 'sat.corona-60s', 'finland.mml-hillshade']) {
            if (!original.layerById(id)) continue;
            const product = id === 'sat.corona-60s' ? '&p=1104-2155Fore' : '';
            cases.push('/api/map3d/tile?layer=' + encodeURIComponent(id) + '&z=13&x=4352&y=2720' + product);
        }

        for (const c of cases) {
            const recA = installFetchRecorder();
            let a;
            try { a = await original.handleTileRequest(new Request('https://detectlab.ro' + c)); }
            finally { recA.restore(); }

            const recB = installFetchRecorder();
            let b;
            try { b = await generated.handleTileRequest(new Request('https://detectlab.ro' + c)); }
            finally { recB.restore(); }

            assert.deepEqual(summarise(recB.calls), summarise(recA.calls), 'upstream request differs for ' + c);
            const fa = await responseFingerprint(a);
            const fb = await responseFingerprint(b);
            fa.body = normalizeKnownDifferences(fa.body);
            fb.body = normalizeKnownDifferences(fb.body);
            /* The generated copy sends CDN-Cache-Control where the original sends
             * the Netlify-only directive; that is the one intended difference. */
            const netlifyCdn = fa.headers['netlify-cdn-cache-control'];
            delete fa.headers['netlify-cdn-cache-control'];
            if (netlifyCdn !== undefined) {
                assert.equal(fb.headers['cdn-cache-control'], netlifyCdn,
                    'the 7-day CDN pin must survive as CDN-Cache-Control for ' + c);
                delete fb.headers['cdn-cache-control'];
            }
            assert.deepEqual(fb, fa, 'response differs for ' + c);
        }
        step(`${cases.length} handleTileRequest cases produce the same upstream request and the same response`);
    }

    /* ── 7. the Finland proxy ───────────────────────────────────────────── */
    {
        assert.deepEqual(generatedFinland.finlandConfig(), originalFinland.finlandConfig(),
            'the Finnish layer config must be the same object contents');
        const a = originalFinland._internal;
        const b = generatedFinland._internal;
        assert.deepEqual(b.TM35FIN.levels, a.TM35FIN.levels);
        assert.deepEqual(b.TM35FIN.matrixSize(11), a.TM35FIN.matrixSize(11));
        assert.deepEqual([...b.HKP_IDS].sort(), [...a.HKP_IDS].sort());
        assert.deepEqual([...b.WFS_IDS].sort(), [...a.WFS_IDS].sort());
        assert.deepEqual([...b.PASSTHROUGH].sort(), [...a.PASSTHROUGH].sort());
        assert.deepEqual([...b.STRIPPED].sort(), [...a.STRIPPED].sort());
        assert.deepEqual(Object.keys(b.UPSTREAM).sort(), Object.keys(a.UPSTREAM).sort());
        for (const key of Object.keys(a.UPSTREAM)) {
            assert.equal(b.UPSTREAM[key].url(11, 984, 1306, 'MML-KEY'), a.UPSTREAM[key].url(11, 984, 1306, 'MML-KEY'),
                'UPSTREAM[' + key + '].url');
            assert.equal(b.UPSTREAM[key].cache, a.UPSTREAM[key].cache);
            assert.equal(b.UPSTREAM[key].needsKey || null, a.UPSTREAM[key].needsKey || null);
        }
        for (const v of ['0', '11', '15', '16', '-1', 'abc', '']) {
            assert.equal(b.validTile(v, '1', '1'), a.validTile(v, '1', '1'), 'validTile(' + v + ')');
        }
        for (const v of ['24.9,60.1,25.1,60.3', '60.1,24.9,60.3,25.1', '20,55,35,70', '', 'a,b,c,d']) {
            assert.equal(b.validBbox(v), a.validBbox(v), 'validBbox(' + v + ')');
        }

        const withKey = process.env.MML_API_KEY;
        process.env.MML_API_KEY = 'parity-test-key';
        try {
            for (const q of FINLAND_QUERIES) {
                for (const origin of [null, 'https://detectlab.ro', 'https://evil.example']) {
                    const headers = {};
                    if (origin) headers.origin = origin;
                    const build = (fn) => new Request('https://detectlab.ro/api/geo/finland?' + q, { headers });

                    const recA = installFetchRecorder();
                    let ra;
                    try { ra = await originalFinland.finlandGeoResponse(build()); } finally { recA.restore(); }
                    const recB = installFetchRecorder();
                    let rb;
                    try { rb = await generatedFinland.finlandGeoResponse(build()); } finally { recB.restore(); }

                    assert.deepEqual(summarise(recB.calls), summarise(recA.calls),
                        'finland upstream request differs for src query "' + q + '" origin ' + origin);
                    assert.deepEqual(await responseFingerprint(rb), await responseFingerprint(ra),
                        'finland response differs for "' + q + '" origin ' + origin);
                }
            }
        } finally {
            if (withKey === undefined) delete process.env.MML_API_KEY;
            else process.env.MML_API_KEY = withKey;
        }
        step(`Finland proxy identical: config, tile matrix, allow-lists and ${FINLAND_QUERIES.length * 3} requests`);
    }

    say(`✓ ${report.checks} parity groups verified between the Netlify/Express modules and the generated Cloudflare copies`);
    return report;
}

/* Direct invocation: node tools/cloudflare-parity-check.mjs */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
    verifyParity({ quiet: false }).catch((err) => {
        console.error('✗ parity check failed:\n' + String((err && err.message) || err));
        process.exit(1);
    });
}
