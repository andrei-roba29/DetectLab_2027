#!/usr/bin/env node
/*
 * test-cloudflare-functions.mjs
 * ───────────────────────────────────────────────────────────────────────────
 * Every one of the nine migrated Cloudflare Pages Functions, exercised through
 * its real exported `onRequest(context)` — the same entry point Cloudflare calls
 * — with `globalThis.fetch` replaced by a recorder, so the upstream request that
 * WOULD be sent is asserted exactly.
 *
 * What this pins, per the migration brief:
 *   • route resolution  — functions/api/… exists for each of the nine paths and
 *                         exports onRequest;
 *   • GET / HEAD / OPTIONS and invalid methods;
 *   • missing and invalid parameters;
 *   • the correct upstream request — URL, method and credential headers;
 *   • CORS and cache headers, including the seven-day tile pin surviving as
 *     CDN-Cache-Control instead of Netlify-CDN-Cache-Control;
 *   • error handling (upstream unreachable, upstream error, OGC exception body);
 *   • SECRET HANDLING — the credential is attached server-side and appears in
 *     neither the response body nor any response header, and a caller-supplied
 *     token/username/password/apikey is stripped;
 *   • binary tile responses (real PNG/JPEG bytes) and GeoJSON responses;
 *   • no open proxy — every route refuses a target it is not allow-listed for,
 *     and /api/map3d/tile refuses private, loopback, link-local and unlisted
 *     hosts.
 *
 * No network access and no credentials are required.
 *
 * Run:  node test-cloudflare-functions.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

let checks = 0;
let failures = 0;
function check(name, condition, detail) {
    checks++;
    if (condition) { console.log('  \u2713 ' + name); return true; }
    failures++;
    console.error('  \u2717 ' + name + (detail ? ' \u2014 ' + detail : ''));
    return false;
}
function eq(name, actual, expected) {
    return check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function group(title) { console.log('\n' + title); }

/* ── the nine routes, exactly as the browser calls them ───────────────────── */

export const ROUTES = [
    { path: '/api/corona/rasters', file: 'functions/api/corona/rasters.js', netlify: 'netlify/functions/corona-rasters.mjs' },
    { path: '/api/map3d/tile', file: 'functions/api/map3d/tile.js', netlify: 'netlify/functions/map3d-tile.mjs' },
    { path: '/api/geo/se-hojdmodell', file: 'functions/api/geo/se-hojdmodell.js', netlify: 'netlify/functions/se-hojdmodell.mjs' },
    { path: '/api/geo/dk-dhm', file: 'functions/api/geo/dk-dhm.js', netlify: 'netlify/functions/dk-dhm.mjs' },
    { path: '/api/geo/dk-dtk25', file: 'functions/api/geo/dk-dtk25.js', netlify: 'netlify/functions/dk-dtk25.mjs' },
    { path: '/api/geo/dk-orto', file: 'functions/api/geo/dk-orto.js', netlify: 'netlify/functions/dk-orto.mjs' },
    { path: '/api/geo/dk-heritage', file: 'functions/api/geo/dk-heritage.js', netlify: 'netlify/functions/dk-heritage.mjs' },
    { path: '/api/geo/finland', file: 'functions/api/geo/finland.js', netlify: 'netlify/functions/finland-geo.mjs' },
    { path: '/api/geo/asig-heritage', file: 'functions/api/geo/asig-heritage.js', netlify: 'netlify/functions/asig-heritage.mjs' }
];

/* ── test fixtures ───────────────────────────────────────────────────────── */

const SECRETS = {
    DATAFORSYNINGEN_TOKEN: 'ds-TOKEN-0123456789abcdef',
    DATAFORDELER_USERNAME: 'df-USER-name',
    DATAFORDELER_PASSWORD: 'df-PASS-word',
    LANTMATERIET_WMS_USER: 'lm-USER',
    LANTMATERIET_WMS_PASSWORD: 'lm-PASS',
    MML_API_KEY: 'mml-KEY-uuid',
    DANISH_PROXY_ALLOWED_ORIGINS: 'https://detectlab.ro,https://detectlab.eu',
    FINLAND_PROXY_ALLOWED_ORIGINS: 'https://detectlab.ro'
};

/* A real 1×1 PNG and a real 3-byte JPEG SOI, so the image sniffing is genuine. */
const PNG_BYTES = Uint8Array.from(atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGD4DwABBAEAcCBlCwAAAABJRU5ErkJggg=='
), (c) => c.charCodeAt(0));
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xd9]);
/* Must be >= 32 bytes to pass the map3d image sanity check. */
const BIG_PNG = new Uint8Array([...PNG_BYTES, ...new Uint8Array(48).fill(0x20)]);

const CAST_CATALOG = {
    '1104-2155Fore': {
        label: '1104-2155Fore',
        location: 'corona:1104-2155Fore',
        extent: { minx: 20, miny: 44, maxx: 28, maxy: 48 },
        polygon: JSON.stringify({ type: 'Polygon', coordinates: [[[20, 44], [28, 44], [28, 48], [20, 48], [20, 44]]] }),
        images: [{
            label: 'df004', location: 'corona:1104-2155df004',
            extent: { minx: 24, miny: 45.5, maxx: 26, maxy: 46.5 }
        }]
    },
    '9999-outsideFore': {
        label: 'outside', location: 'corona:9999-outsideFore',
        extent: { minx: -120, miny: 30, maxx: -110, maxy: 40 }
    }
};

const GEOJSON_25832 = {
    type: 'FeatureCollection', totalFeatures: 2,
    features: [
        { type: 'Feature', id: 'ff.1', properties: { navn: 'Runestone', sagsnr: '1234' },
          geometry: { type: 'Point', coordinates: [724123.45, 6185234.56] } },
        { type: 'Feature', id: 'ff.2', properties: { navn: 'Barrow' },
          geometry: { type: 'Polygon', coordinates: [[[724100, 6185200], [724200, 6185200], [724200, 6185300], [724100, 6185200]]] } }
    ]
};

const ASIG_GEOJSON = {
    type: 'FeatureCollection',
    features: [
        { type: 'Feature', id: 'a.1', properties: { emri: 'Castle of <script>x</script>', secret: 'not returned' },
          geometry: { type: 'Polygon', coordinates: [[[19.7, 41.2], [19.9, 41.2], [19.9, 41.4], [19.7, 41.2]]] } },
        { type: 'Feature', id: 'a.2', properties: { name: 'Point site' },
          geometry: { type: 'Point', coordinates: [19.8, 41.3] } }
    ]
};

/** Replace globalThis.fetch for the duration of fn(); return what was requested. */
async function withFetch(impl, fn) {
    const real = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        calls.push({ url, method: (init && init.method) || 'GET', headers: new Headers((init && init.headers) || {}) });
        return impl(url, init, calls.length - 1);
    };
    try { return { result: await fn(), calls }; } finally { globalThis.fetch = real; }
}

const image = (bytes, type) => new Response(bytes, { status: 200, headers: { 'content-type': type } });
const json = (value, init) => Response.json(value, init);

/** Build the EventContext a Pages Function receives. */
function contextFor(url, { env = SECRETS, method = 'GET', headers = {} } = {}) {
    const waitUntil = [];
    return {
        request: new Request(url, { method, headers }),
        env,
        params: {},
        waitUntil: (p) => waitUntil.push(p),
        next: () => { throw new Error('next() must not be reached for an /api route'); },
        _waitUntil: waitUntil
    };
}

/** Call a route's onRequest with process.env pointed at a known binding set. */
async function call(route, url, options = {}) {
    const saved = process.env;
    const context = contextFor(url, options);
    try {
        const response = await route.onRequest(context);
        await Promise.all(context._waitUntil);
        return response;
    } finally {
        try { Object.defineProperty(globalThis.process, 'env', { value: saved, writable: true, configurable: true, enumerable: true }); } catch { /* ignore */ }
    }
}

async function readBody(response) {
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    const type = response.headers.get('content-type') || '';
    return {
        bytes,
        text: new TextDecoder().decode(bytes),
        json: /json/i.test(type) ? JSON.parse(new TextDecoder().decode(bytes)) : null
    };
}

/** Assert no credential from SECRETS appears anywhere in the response. */
async function assertNoSecretLeak(name, response) {
    const { text } = await readBody(response);
    let headers = '';
    for (const [k, v] of response.headers) headers += k + ': ' + v + '\n';
    const leaked = Object.entries(SECRETS)
        .filter(([name]) => !/ALLOWED_ORIGINS$/.test(name))
        .filter(([, value]) => text.includes(value) || headers.includes(value));
    return check(name, leaked.length === 0, 'leaked ' + leaked.map(([k]) => k).join(', '));
}

/* ═══════════════════════════════════════════════════════════════════════════ */

const loaded = {};

group('A. route resolution — the nine Cloudflare Pages Functions');
for (const route of ROUTES) {
    const abs = path.join(ROOT, route.file);
    if (!check(`${route.path} → ${route.file} exists`, fs.existsSync(abs))) continue;
    const mod = await import(new URL('file://' + abs).href);
    if (!check(`${route.path} exports onRequest`, typeof mod.onRequest === 'function')) continue;
    /* Cloudflare Pages ignores files that start with "_"; every other file in
     * functions/ must be one of the nine routes. */
    loaded[route.path] = mod;
}
{
    const stray = [];
    const walk = (dir, rel) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const relPath = rel ? rel + '/' + entry.name : entry.name;
            if (entry.isDirectory()) {
                if (entry.name.startsWith('_')) continue;
                walk(path.join(dir, entry.name), relPath);
            } else if (/\.(js|mjs|ts)$/.test(entry.name)) {
                if (entry.name.startsWith('_')) continue;      /* never a route in Pages */
                stray.push('/' + relPath.replace(/\.(js|mjs|ts)$/, ''));
            }
        }
    };
    walk(path.join(ROOT, 'functions'), '');
    const expected = ROUTES.map((r) => r.path);
    check('functions/ contains no route file beyond the nine mapped paths',
        stray.length === expected.length && stray.every((s) => expected.includes(s)),
        'found ' + JSON.stringify(stray));
    check('_lib/, _generated/ and _middleware.js are excluded from routing by the "_" prefix',
        ['_lib', '_generated'].every((d) => fs.existsSync(path.join(ROOT, 'functions', d))) &&
        fs.existsSync(path.join(ROOT, 'functions/_middleware.js')));
}

group('B. no secret is written into any Cloudflare file');
{
    const offenders = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.(js|mjs|json|md|cjs)$/.test(entry.name)) {
                const text = fs.readFileSync(full, 'utf8');
                for (const [name, value] of Object.entries(SECRETS)) {
                    /* DANISH_/FINLAND_PROXY_ALLOWED_ORIGINS hold public origin
                     * names (https://detectlab.ro), not credentials: they appear
                     * in documentation and in comments on purpose. */
                    if (/ALLOWED_ORIGINS$/.test(name)) continue;
                    if (text.includes(value)) offenders.push(`${path.relative(ROOT, full)} contains ${name}`);
                }
                /* A credential-shaped literal assigned to one of the known names. */
                const m = text.match(/(DATAFORSYNINGEN_TOKEN|DATAFORDELER_(?:USERNAME|PASSWORD|USER)|LANTMATERIET_WMS_(?:USER|PASSWORD|TOKEN)|MML_API_KEY)\s*[:=]\s*['"][^'"]{6,}['"]/g) || [];
                for (const hit of m) {
                    if (/process\.env|context\.env|env\[|\benv\b/.test(hit)) continue;
                    offenders.push(`${path.relative(ROOT, full)}: ${hit.slice(0, 70)}`);
                }
            }
        }
    };
    walk(path.join(ROOT, 'functions'));
    walk(path.join(ROOT, 'cloudflare'));
    for (const f of ['wrangler.jsonc', 'tools/cloudflare-build.mjs', 'tools/build-cloudflare-dist.mjs', 'tools/sync-cloudflare-generated.mjs']) {
        const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
        for (const [name, value] of Object.entries(SECRETS)) {
            /* Same exemption as walk() above: DANISH_/FINLAND_PROXY_ALLOWED_ORIGINS
             * hold the public origin name https://detectlab.ro, which legitimately
             * appears in prose — wrangler.jsonc cites the OAuth redirect URI
             * https://detectlab.ro/google-auth-callback.html, whose prefix is that
             * value. Skipping them here keeps the two loops consistent. */
            if (/ALLOWED_ORIGINS$/.test(name)) continue;
            if (text.includes(value)) offenders.push(`${f} contains ${name}`);
        }
    }
    check('no credential value or credential-shaped literal is committed', offenders.length === 0, offenders.join('; '));
    const text = fs.readFileSync(path.join(ROOT, 'functions/_lib/runtime-shims.js'), 'utf8');
    check('secrets are read from context.env, never from a literal',
        /bindEnv\(env\)/.test(text) && /envView\(env\)/.test(text));
}

/* ── C. /api/corona/rasters ─────────────────────────────────────────────── */
group('C. GET /api/corona/rasters — CORONA catalogue proxy');
{
    const route = loaded['/api/corona/rasters'];

    /* Cold start, CAST unreachable: must be asserted BEFORE any successful load,
     * because the handler's own 12 h isolate-memory cache then serves stale
     * rather than nothing — which is the documented Netlify behaviour. */
    const cold = await withFetch(async () => { throw new Error('CAST is down'); },
        () => call(route, 'https://detectlab.ro/api/corona/rasters?bbox=-25,34,60,72'));
    eq('a cold start with CAST unreachable answers 502', cold.result.status, 502);
    eq('the cold 502 is not cached', cold.result.headers.get('cache-control'), 'no-store');
    eq('the cold 502 keeps CORS', cold.result.headers.get('access-control-allow-origin'), '*');
    check('the cold 502 body is JSON with an error field',
        !!(await readBody(cold.result)).json && typeof (await readBody(cold.result)).json.error === 'string');

    let seenUrl = null;
    const { result: response, calls } = await withFetch(
        async (url) => { seenUrl = url; return json(CAST_CATALOG); },
        () => call(route, 'https://detectlab.ro/api/corona/rasters?bbox=-25,34,60,72')
    );
    eq('upstream is the CAST catalogue endpoint', seenUrl, 'https://corona.cast.uark.edu/corona/get_raster_names');
    eq('exactly one upstream request', calls.length, 1);
    eq('status 200', response.status, 200);
    const body = await readBody(response);
    eq('content-type is JSON', response.headers.get('content-type'), 'application/json; charset=utf-8');
    eq('CORS is open, as on Netlify', response.headers.get('access-control-allow-origin'), '*');
    eq('browser cache preserved', response.headers.get('cache-control'), 'public, max-age=3600');
    eq('the 7-day Netlify CDN pin survives as CDN-Cache-Control',
        response.headers.get('cdn-cache-control'), 'public, s-maxage=604800, stale-while-revalidate=86400');
    check('no Netlify-only header reaches the client',
        response.headers.get('netlify-cdn-cache-control') === null);
    eq('clipped to Europe: 1 pass', body.json.passes, 1);
    eq('clipped to Europe: 1 frame', body.json.frames, 1);
    eq('deep-equal bbox echoed', JSON.stringify(body.json.bbox), '[-25,34,60,72]');
    check('the non-European pass was dropped', !body.text.includes('9999-outside'));
    await assertNoSecretLeak('no secret in the response', response);

    /* The isolate memory cache must make a second request free. */
    const second = await withFetch(async () => json(CAST_CATALOG),
        () => call(route, 'https://detectlab.ro/api/corona/rasters?bbox=-25,34,60,72'));
    eq('the 12 h memory cache means no second upstream call', second.calls.length, 0);
    eq('the cached answer is still 200', second.result.status, 200);

    /* An invalid bbox falls back to Europe rather than failing. */
    const bad = await withFetch(async () => json(CAST_CATALOG),
        () => call(route, 'https://detectlab.ro/api/corona/rasters?bbox=not,a,bbox'));
    eq('an unparsable bbox still answers 200 (Europe fallback)', bad.result.status, 200);

    /* HEAD keeps the status and headers. */
    const head = await withFetch(async () => json(CAST_CATALOG),
        () => call(route, 'https://detectlab.ro/api/corona/rasters', { method: 'HEAD' }));
    eq('HEAD answers 200', head.result.status, 200);
}
group('C2. GET /api/corona/rasters — stale serving and the Cloudflare snapshot');
{
    const route = loaded['/api/corona/rasters'];
    /* The memory cache is warm from section C, so an upstream failure is now
     * answered from it — "serve stale rather than nothing: the upstream is a
     * university server" (netlify/functions/corona-rasters.mjs). */
    const stale = await withFetch(async () => { throw new Error('CAST is down'); },
        () => call(route, 'https://detectlab.ro/api/corona/rasters?bbox=1,2,3,4'));
    eq('once warm, an unreachable CAST is answered from isolate memory', stale.result.status, 200);
    eq('the stale answer keeps the 1 h browser cache', stale.result.headers.get('cache-control'), 'public, max-age=3600');
    eq('and no upstream request was made', stale.calls.length, 0);

    /* A stored datacentre copy must be served instead of a 502. */
    const cacheModule = await import(new URL('file://' + path.join(ROOT, 'functions/_lib/corona-cache.mjs')).href);
    const stored = [];
    const fakeCaches = {
        default: {
            async put(key, response) { stored.push({ key: key.url, response }); },
            async match(key) { const hit = stored.find((s) => s.key === key.url); return hit ? hit.response.clone() : undefined; }
        }
    };
    const savedCaches = globalThis.caches;
    globalThis.caches = fakeCaches;
    try {
        const okRoute = cacheModule.withCoronaCatalogueCache(async (ctx) => new Response(
            JSON.stringify({ passes: 1, frames: 1, blocks: [{ id: 'x' }] }),
            { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } }));
        const ctx = contextFor('https://detectlab.ro/api/corona/rasters?bbox=-25,34,60,72');
        const first = await okRoute(ctx);
        await Promise.all(ctx._waitUntil);
        eq('a good answer is stored in caches.default', stored.length, 1);
        eq('the stored key drops every parameter except bbox',
            stored[0].key, 'https://detectlab.ro/api/corona/rasters?bbox=-25%2C34%2C60%2C72');
        check('the stored copy is pinned for 30 days',
            /max-age=2592000/.test(stored[0].response.headers.get('cache-control') || ''));
        eq('the caller still gets its own body', first.status, 200);
        eq('the live answer is tagged', first.headers.get('x-detectlab-corona-cache'), 'live');

        const failingRoute = cacheModule.withCoronaCatalogueCache(async () => new Response(
            JSON.stringify({ error: 'upstream' }), { status: 502, headers: { 'content-type': 'application/json' } }));
        const staleCtx = contextFor('https://detectlab.ro/api/corona/rasters?bbox=-25,34,60,72');
        const stale = await failingRoute(staleCtx);
        eq('with CAST down the stored catalogue is served instead of the 502', stale.status, 200);
        const staleBody = await readBody(stale);
        eq('and it is the previously generated catalogue', staleBody.json.passes, 1);

        const otherCtx = contextFor('https://detectlab.ro/api/corona/rasters?bbox=0,0,1,1');
        const other = await cacheModule.withCoronaCatalogueCache(async () => new Response(
            JSON.stringify({ error: 'upstream' }), { status: 502, headers: { 'content-type': 'application/json' } }))(otherCtx);
        eq('a different bbox has no snapshot and still answers 502', other.status, 502);
    } finally {
        if (savedCaches === undefined) delete globalThis.caches; else globalThis.caches = savedCaches;
    }
}

/* ── C3. the deployed snapshot asset, reached through env.ASSETS ─────────── */
group('C3. GET /api/corona/rasters — the env.ASSETS snapshot tier (cold datacentre, CAST down)');
{
    const cacheModule = await import(new URL('file://' + path.join(ROOT, 'functions/_lib/corona-cache.mjs')).href);
    eq('the tier asks for the same-origin path the frontend itself prefers',
        cacheModule.SNAPSHOT_ASSET_PATH, '/data/corona-europe-catalog.json');

    /* A harness fixture, in memory only: two blocks, one over Denmark and one
     * over Greece, each with one frame. It is deliberately NOT written to disk —
     * the real snapshot cannot be generated here (corona.cast.uark.edu is
     * unreachable from this sandbox) and fabricating catalogue entries is
     * forbidden, so the tier is tested against a shape, not against invented data. */
    const FIXTURE = {
        source: 'https://corona.cast.uark.edu/corona/get_raster_names',
        generated: '2020-01-01T00:00:00.000Z',
        bbox: [-25, 34, 60, 72],
        passes: 2,
        frames: 2,
        blocks: [
            { id: 'FIXTURE-DK', label: 'fixture', location: 'fixture-dk', extent: [8, 54, 13, 58],
              images: [{ label: 'f', location: 'f-dk', extent: [9, 55, 10, 56] }] },
            { id: 'FIXTURE-GR', label: 'fixture', location: 'fixture-gr', extent: [19, 39, 22, 43],
              images: [{ label: 'f', location: 'f-gr', extent: [20, 40, 21, 41] }] }
        ]
    };

    /* caches.default is present but EMPTY, so the 30-day tier cannot answer and
     * control reaches the asset tier. */
    const savedCaches = globalThis.caches;
    globalThis.caches = { default: { async put() {}, async match() { return undefined; } } };
    const failing = async () => new Response(JSON.stringify({ error: 'CAST is down' }),
        { status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

    try {
        const assetCalls = [];
        const withAsset = (responder, extraEnv = {}) => (url, env) => {
            const route = cacheModule.withCoronaCatalogueCache(failing);
            return route(contextFor(url, { env: { ...extraEnv, ASSETS: { fetch: async (r) => { assetCalls.push(r.url); return responder(r); } } } }));
        };
        const ok = (body, init = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body),
            { status: 200, headers: { 'content-type': 'application/json' }, ...init });

        /* 1. a valid deployed snapshot answers the outage. */
        const served = await withAsset(() => ok(FIXTURE))('https://detectlab.ro/api/corona/rasters?bbox=-25,34,60,72');
        eq('CAST down + cold cache + a deployed snapshot → 200 instead of 502', served.status, 200);
        eq('the answer is labelled as the snapshot tier', served.headers.get('x-detectlab-corona-cache'), 'snapshot');
        eq('and is still marked as coming from the Cloudflare runtime',
            served.headers.get('x-detectlab-runtime'), 'cloudflare-pages-function');
        eq('the asset was fetched from the SAME origin at the documented path',
            assetCalls[assetCalls.length - 1], 'https://detectlab.ro/data/corona-europe-catalog.json');
        const servedBody = await readBody(served);
        eq('the snapshot flag tells the frontend it is not a live CAST answer', servedBody.json.snapshot, true);
        eq('both fixture blocks are inside the Europe bbox', servedBody.json.passes, 2);

        /* 2. the snapshot is re-clipped to the caller's bbox — never "here is all
         *    of Europe" for a bbox that is not in Europe. */
        const danmark = await withAsset(() => ok(FIXTURE))('https://detectlab.ro/api/corona/rasters?bbox=8,54,13,58');
        const dkBody = await readBody(danmark);
        eq('a Danish bbox returns only the Danish block', dkBody.json.passes, 1);
        eq('and that block is the Danish one', dkBody.json.blocks[0].id, 'FIXTURE-DK');
        const asia = await withAsset(() => ok(FIXTURE))('https://detectlab.ro/api/corona/rasters?bbox=100,20,110,30');
        eq('a bbox with nothing in it is NOT answered from the snapshot (no invented coverage)',
            asia.status, 502);
        eq('and the 502 is not cached', asia.headers.get('cache-control'), 'no-store');

        /* 3. every way the asset can be absent or unusable falls through to the
         *    honest 502 — the tier may never manufacture a catalogue. */
        const bad = [
            ['the asset is missing', () => new Response('not found', { status: 404 })],
            ['the asset is not JSON', () => ok('<html>not json</html>')],
            ['the asset parses but has no blocks[] array', () => ok({ passes: 0 })],
            ['the asset parses but contains 0 blocks', () => ok({ ...FIXTURE, blocks: [], passes: 0, frames: 0 })],
            ['the asset fetch throws', () => { throw new Error('ASSETS unavailable'); }]
        ];
        for (const [label, responder] of bad) {
            const r = await withAsset(responder)('https://detectlab.ro/api/corona/rasters?bbox=-25,34,60,72');
            eq(`${label} → the real 502 is kept`, r.status, 502);
        }

        /* 4. no env.ASSETS binding at all (an older runtime, a unit context). */
        const noAssets = cacheModule.withCoronaCatalogueCache(failing);
        const bare = await noAssets(contextFor('https://detectlab.ro/api/corona/rasters?bbox=-25,34,60,72', { env: {} }));
        eq('without an env.ASSETS binding the 502 is kept', bare.status, 502);

        /* 5. a LIVE answer still wins: the asset tier must never shadow CAST. */
        const live = cacheModule.withCoronaCatalogueCache(async () => ok({ passes: 7, frames: 9, blocks: [{ id: 'LIVE' }] }));
        const liveCtx = contextFor('https://detectlab.ro/api/corona/rasters?bbox=-25,34,60,72',
            { env: { ASSETS: { fetch: async () => ok(FIXTURE) } } });
        const liveResponse = await live(liveCtx);
        await Promise.all(liveCtx._waitUntil);
        eq('when CAST answers, the snapshot asset is never consulted', liveResponse.headers.get('x-detectlab-corona-cache'), 'live');
        eq('and the live catalogue is what the caller gets', (await readBody(liveResponse)).json.passes, 7);
    } finally {
        if (savedCaches === undefined) delete globalThis.caches; else globalThis.caches = savedCaches;
    }
}

/* ── D. /api/geo/se-hojdmodell ──────────────────────────────────────────── */
group('D. GET /api/geo/se-hojdmodell — Lantmäteriet credential proxy');
{
    const route = loaded['/api/geo/se-hojdmodell'];
    const tile = 'https://detectlab.ro/api/geo/se-hojdmodell?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap' +
        '&LAYERS=terrangskuggning&STYLES=&SRS=EPSG:3857&BBOX=1,2,3,4&WIDTH=256&HEIGHT=256&FORMAT=image/png';
    const { result: response, calls } = await withFetch(async () => image(BIG_PNG, 'image/png'), () => call(route, tile));
    eq('exactly one upstream request', calls.length, 1);
    check('the upstream is the licensed Lantmäteriet access point',
        calls[0].url.startsWith('https://maps.lantmateriet.se/hojdmodell/wms/v1.1?'), calls[0].url);
    const expectedAuth = 'Basic ' + Buffer.from('lm-USER:lm-PASS', 'utf8').toString('base64');
    eq('the Basic credential is attached server-side', calls[0].headers.get('authorization'), expectedAuth);
    check('the WMS query survived', /LAYERS=terrangskuggning/.test(calls[0].url) && /WIDTH=256/.test(calls[0].url));
    eq('status 200', response.status, 200);
    eq('the image content type is passed through', response.headers.get('content-type'), 'image/png');
    eq('the 7-day browser pin is preserved', response.headers.get('cache-control'), 'public, max-age=604800, immutable');
    eq('the 7-day CDN pin survives as CDN-Cache-Control',
        response.headers.get('cdn-cache-control'), 'public, s-maxage=604800, stale-while-revalidate=86400');
    check('no Netlify-only header reaches the client', response.headers.get('netlify-cdn-cache-control') === null);
    const body = await readBody(response);
    eq('the binary tile is returned byte for byte', body.bytes.length, BIG_PNG.length);
    check('the PNG signature is intact', body.bytes[0] === 0x89 && body.bytes[1] === 0x50);
    await assertNoSecretLeak('no credential in the response', response);

    /* A caller-supplied credential parameter must be stripped upstream. */
    const injected = await withFetch(async () => image(BIG_PNG, 'image/png'),
        () => call(route, tile + '&token=ATTACKER&password=ATTACKER&authorization=ATTACKER'));
    check('token/password/authorization KVP are stripped from the upstream URL',
        !/ATTACKER/.test(injected.calls[0].url), injected.calls[0].url);
    eq('the deployment credential still wins', injected.calls[0].headers.get('authorization'), expectedAuth);

    /* Validation, all answered without touching the network. */
    const cases = [
        ['REQUEST=GetFeature', 400, 'unsupported_request'],
        ['REQUEST=GetMap&LAYERS=secret_layer&FORMAT=image/png&WIDTH=256&HEIGHT=256', 400, 'layer_not_allowed'],
        ['REQUEST=GetMap&LAYERS=terrangskuggning&FORMAT=image/tiff&WIDTH=256&HEIGHT=256', 400, 'format_not_allowed'],
        ['REQUEST=GetMap&LAYERS=terrangskuggning&FORMAT=image/png&WIDTH=9999&HEIGHT=256', 400, 'bad_image_size'],
        ['REQUEST=GetMap&LAYERS=terrangskuggning&FORMAT=image/png&WIDTH=0&HEIGHT=256', 400, 'bad_image_size']
    ];
    for (const [query, status, error] of cases) {
        const base = 'https://detectlab.ro/api/geo/se-hojdmodell?SERVICE=WMS&VERSION=1.1.1&';
        const r = await withFetch(async () => image(BIG_PNG, 'image/png'), () => call(route, base + query));
        const b = await readBody(r.result);
        eq(`${error} → ${status}`, r.result.status, status);
        eq(`${error} body`, b.json && b.json.error, error);
        eq(`${error} never reaches upstream`, r.calls.length, 0);
    }

    /* Missing credentials: the documented non-blocking 401. */
    const noCreds = await withFetch(async () => image(BIG_PNG, 'image/png'),
        () => call(route, tile, { env: {} }));
    eq('missing credentials → 401', noCreds.result.status, 401);
    eq('missing credentials error code', (await readBody(noCreds.result)).json.error, 'lantmateriet_credentials_missing');
    eq('missing credentials never reach upstream', noCreds.calls.length, 0);

    /* A bearer token is the alternative credential style. */
    const bearer = await withFetch(async () => image(BIG_PNG, 'image/png'),
        () => call(route, tile, { env: { LANTMATERIET_WMS_TOKEN: 'oauth-TOKEN' } }));
    eq('LANTMATERIET_WMS_TOKEN is sent as a bearer token',
        bearer.calls[0].headers.get('authorization'), 'Bearer oauth-TOKEN');

    /* Upstream failure modes. */
    const unreachable = await withFetch(async () => { throw new Error('dns'); }, () => call(route, tile));
    eq('unreachable upstream → 502', unreachable.result.status, 502);
    eq('unreachable upstream error code', (await readBody(unreachable.result)).json.error, 'upstream_unreachable');
    const denied = await withFetch(async () => new Response('<html>Authorization Required</html>',
        { status: 401, headers: { 'content-type': 'text/html' } }), () => call(route, tile));
    eq('bad credentials upstream → 401', denied.result.status, 401);
    eq('bad credentials error code', (await readBody(denied.result)).json.error, 'lantmateriet_credentials_invalid');
    const exception = await withFetch(async () => new Response('<?xml version="1.0"?><ServiceExceptionReport/>',
        { status: 200, headers: { 'content-type': 'application/vnd.ogc.se_xml' } }), () => call(route, tile));
    eq('an OGC ServiceException body is never served as a tile', exception.result.status, 502);

    /* Methods. */
    const head = await withFetch(async () => image(BIG_PNG, 'image/png'), () => call(route, tile, { method: 'HEAD' }));
    eq('HEAD is answered by the same handler', head.result.status, 200);
    /* No preflight branch: OPTIONS is handled like any other method, exactly as
     * on Netlify. A bare OPTIONS has no REQUEST parameter and is refused; one
     * carrying a valid GetMap query is proxied. Neither is a browser case for a
     * same-origin <img> tile route. */
    const bareOptions = await withFetch(async () => image(BIG_PNG, 'image/png'),
        () => call(route, 'https://detectlab.ro/api/geo/se-hojdmodell', { method: 'OPTIONS' }));
    eq('a bare OPTIONS → 400 unsupported_request (Netlify parity)', bareOptions.result.status, 400);
    eq('a bare OPTIONS never reaches upstream', bareOptions.calls.length, 0);
    const fullOptions = await withFetch(async () => image(BIG_PNG, 'image/png'), () => call(route, tile, { method: 'OPTIONS' }));
    eq('an OPTIONS carrying a valid GetMap query is proxied (Netlify parity)', fullOptions.result.status, 200);
}

/* ── E. /api/geo/dk-dhm ─────────────────────────────────────────────────── */
group('E. GET /api/geo/dk-dhm — Dataforsyningen DHM WMTS token proxy');
{
    const route = loaded['/api/geo/dk-dhm'];
    const tile = 'https://detectlab.ro/api/geo/dk-dhm?service=WMTS&request=GetTile&version=1.0.0' +
        '&layer=dhm_terraen_skyggekort&style=default&tilematrixset=view1&tilematrix=7&tilecol=100&tilerow=200&format=image/jpeg';
    const { result: response, calls } = await withFetch(async () => image(JPEG_BYTES, 'image/jpeg'), () => call(route, tile));
    eq('exactly one upstream request', calls.length, 1);
    check('the upstream is the DHM skyggekort service chosen from the layer table',
        calls[0].url.startsWith('https://api.dataforsyningen.dk/dhm_terraen_skyggekort_DAF?'), calls[0].url);
    eq('the token travels as the "token" HTTP header, not in the URL',
        calls[0].headers.get('token'), SECRETS.DATAFORSYNINGEN_TOKEN);
    check('the token is absent from the upstream URL', !calls[0].url.includes(SECRETS.DATAFORSYNINGEN_TOKEN));
    eq('status 200', response.status, 200);
    eq('the JPEG content type is passed through', response.headers.get('content-type'), 'image/jpeg');
    eq('the 7-day browser pin is preserved', response.headers.get('cache-control'), 'public, max-age=604800, immutable');
    eq('the 7-day CDN pin survives as CDN-Cache-Control',
        response.headers.get('cdn-cache-control'), 'public, s-maxage=604800, stale-while-revalidate=86400');
    const body = await readBody(response);
    eq('the binary tile is returned byte for byte', body.bytes.length, JPEG_BYTES.length);
    check('the JPEG SOI marker is intact', body.bytes[0] === 0xff && body.bytes[1] === 0xd8);
    await assertNoSecretLeak('no token in the response', response);

    const secondLayer = await withFetch(async () => image(JPEG_BYTES, 'image/jpeg'),
        () => call(route, tile.replace('dhm_terraen_skyggekort', 'dhm_overflade_skyggekort')));
    check('the surface hillshade maps to its own service',
        secondLayer.calls[0].url.startsWith('https://api.dataforsyningen.dk/dhm_overflade_skyggekort_DAF?'), secondLayer.calls[0].url);

    const injected = await withFetch(async () => image(JPEG_BYTES, 'image/jpeg'),
        () => call(route, tile + '&token=ATTACKER&apikey=ATTACKER&username=ATTACKER&password=ATTACKER'));
    check('a caller-supplied token/apikey/username/password is stripped',
        !/ATTACKER/.test(injected.calls[0].url), injected.calls[0].url);
    eq('the deployment token still wins', injected.calls[0].headers.get('token'), SECRETS.DATAFORSYNINGEN_TOKEN);

    const cases = [
        ['request=GetMap', 400, 'unsupported_request'],
        ['request=GetTile&layer=nope&format=image/jpeg&tilematrixset=view1&tilematrix=7&tilecol=1&tilerow=1', 400, 'layer_not_allowed'],
        ['request=GetTile&layer=dhm_terraen_skyggekort&format=image/png&tilematrixset=view1&tilematrix=7&tilecol=1&tilerow=1', 400, 'format_not_allowed'],
        ['request=GetTile&layer=dhm_terraen_skyggekort&format=image/jpeg&tilematrixset=GoogleMapsCompatible&tilematrix=7&tilecol=1&tilerow=1', 400, 'tilematrixset_not_allowed'],
        ['request=GetTile&layer=dhm_terraen_skyggekort&format=image/jpeg&tilematrixset=view1&tilematrix=14&tilecol=1&tilerow=1', 400, 'bad_tile_index'],
        ['request=GetTile&layer=dhm_terraen_skyggekort&format=image/jpeg&tilematrixset=view1&tilematrix=7&tilecol=-1&tilerow=1', 400, 'bad_tile_index'],
        ['request=GetTile&layer=dhm_terraen_skyggekort&format=image/jpeg&tilematrixset=view1&tilematrix=7&tilecol=17188&tilerow=1', 400, 'bad_tile_index'],
        ['request=GetTile&layer=dhm_terraen_skyggekort&format=image/jpeg&tilematrixset=view1&tilematrix=View1:7&tilecol=1&tilerow=1', 200, null],
        ['request=GetTile&layer=dhm_terraen_skyggekort&format=image/jpeg&tilematrixset=View1:7&tilematrix=7&tilecol=1&tilerow=1', 400, 'tilematrixset_not_allowed']
    ];
    for (const [query, status, error] of cases) {
        const r = await withFetch(async () => image(JPEG_BYTES, 'image/jpeg'),
            () => call(route, 'https://detectlab.ro/api/geo/dk-dhm?service=WMTS&' + query));
        eq(`${error || 'View1:7 spelling accepted'} → ${status}`, r.result.status, status);
        if (error) {
            eq(`${error} body`, (await readBody(r.result)).json.error, error);
            eq(`${error} never reaches upstream`, r.calls.length, 0);
        }
    }

    const noToken = await withFetch(async () => image(JPEG_BYTES, 'image/jpeg'), () => call(route, tile, { env: {} }));
    eq('missing token → 401', noToken.result.status, 401);
    eq('missing token error code', (await readBody(noToken.result)).json.error, 'dataforsyningen_token_missing');
    const badToken = await withFetch(async () => new Response('<ExceptionReport>User not authorized</ExceptionReport>',
        { status: 200, headers: { 'content-type': 'text/xml' } }), () => call(route, tile));
    eq('an OGC "User not authorized" body → 401', badToken.result.status, 401);
    eq('invalid token error code', (await readBody(badToken.result)).json.error, 'dataforsyningen_token_invalid');
    const unreachable = await withFetch(async () => { throw new Error('dns'); }, () => call(route, tile));
    eq('unreachable upstream → 502', unreachable.result.status, 502);

    const bareOptions = await withFetch(async () => image(JPEG_BYTES, 'image/jpeg'),
        () => call(route, 'https://detectlab.ro/api/geo/dk-dhm', { method: 'OPTIONS' }));
    eq('a bare OPTIONS → 400 unsupported_request (Netlify parity)', bareOptions.result.status, 400);
    eq('a bare OPTIONS never reaches upstream', bareOptions.calls.length, 0);
    const fullOptions = await withFetch(async () => image(JPEG_BYTES, 'image/jpeg'), () => call(route, tile, { method: 'OPTIONS' }));
    eq('an OPTIONS carrying a valid GetTile query is proxied (Netlify parity)', fullOptions.result.status, 200);
    const head = await withFetch(async () => image(JPEG_BYTES, 'image/jpeg'), () => call(route, tile, { method: 'HEAD' }));
    eq('HEAD is answered by the same handler', head.result.status, 200);
}

/* ── F. /api/geo/dk-dtk25 ───────────────────────────────────────────────── */
group('F. GET /api/geo/dk-dtk25 — Dataforsyningen WMS allow-list');
{
    const route = loaded['/api/geo/dk-dtk25'];
    const lib = await import(new URL('file://' + path.join(ROOT, 'backend/src/lib/danish-layers.mjs')).href);
    const layer = lib.danishLayer('dtk25');
    check('the dtk25 layer exists in the shared config', !!layer);

    const map = 'https://detectlab.ro/api/geo/dk-dtk25?service=WMS&version=1.3.0&request=GetMap' +
        '&layer=dtk25&layers=ATTACKER&styles=&format=image/png&transparent=true&crs=EPSG:3857' +
        '&bbox=1,2,3,4&width=256&height=256';
    const { result: response, calls } = await withFetch(async () => image(BIG_PNG, 'image/png'), () => call(route, map));
    eq('exactly one upstream request', calls.length, 1);
    check('the upstream is the config-selected Dataforsyningen service',
        calls[0].url.startsWith(layer.upstream + '?'), calls[0].url);
    check('the token is appended as a server-side KVP',
        new URL(calls[0].url).searchParams.get('token') === SECRETS.DATAFORSYNINGEN_TOKEN);
    eq('the config LAYERS value replaces a caller-supplied one',
        new URL(calls[0].url).searchParams.get('layers'), layer.layers);
    check('only one layers= parameter survives', (calls[0].url.match(/layers=/gi) || []).length === 1, calls[0].url);
    eq('status 200', response.status, 200);
    eq('the 7-day tile pin is preserved', response.headers.get('cache-control'), 'public, max-age=604800, immutable');
    eq('the 7-day CDN pin survives as CDN-Cache-Control',
        response.headers.get('cdn-cache-control'), 'public, s-maxage=604800, stale-while-revalidate=86400');
    await assertNoSecretLeak('no token in the response', response);

    const injected = await withFetch(async () => image(BIG_PNG, 'image/png'),
        () => call(route, map + '&token=ATTACKER&username=ATTACKER&password=ATTACKER&apikey=ATTACKER'));
    const up = new URL(injected.calls[0].url).searchParams;
    eq('a caller-supplied token is replaced by the deployment token', up.get('token'), SECRETS.DATAFORSYNINGEN_TOKEN);
    eq('a caller-supplied username is dropped', up.get('username'), null);
    eq('a caller-supplied password is dropped', up.get('password'), null);

    /* GetCapabilities is allowed but must never be cached. */
    const caps = await withFetch(async () => new Response(
        '<?xml version="1.0"?><WMS_Capabilities version="1.3.0"></WMS_Capabilities>',
        { status: 200, headers: { 'content-type': 'application/vnd.ogc.wms_xml' } }),
    () => call(route, 'https://detectlab.ro/api/geo/dk-dtk25?service=WMS&version=1.3.0&request=GetCapabilities&layer=dtk25'));
    eq('GetCapabilities → 200', caps.result.status, 200);
    eq('GetCapabilities is not cached', caps.result.headers.get('cache-control'), 'no-store');

    const bad = [
        ['layer=nope&request=GetMap', 400, 'layer_not_allowed'],
        ['layer=dtk25&request=GetFeatureInfo', 400, 'unsupported_request'],
        ['layer=fortidsminder&request=GetMap', 400, 'layer_not_allowed']
    ];
    for (const [query, status, error] of bad) {
        const r = await withFetch(async () => image(BIG_PNG, 'image/png'),
            () => call(route, 'https://detectlab.ro/api/geo/dk-dtk25?service=WMS&' + query));
        eq(`${error} → ${status}`, r.result.status, status);
        eq(`${error} never reaches upstream`, r.calls.length, 0);
    }

    const noToken = await withFetch(async () => image(BIG_PNG, 'image/png'),
        () => call(route, map, { env: { ...SECRETS, DATAFORSYNINGEN_TOKEN: undefined } }));
    eq('missing token → 503 service_unavailable (the variable name is never disclosed)',
        noToken.result.status, 503);
    eq('missing token body', (await readBody(noToken.result)).json.error, 'service_unavailable');
    check('the missing variable name is not in the response',
        !(await readBody(noToken.result)).text.includes('DATAFORSYNINGEN_TOKEN'));

    /* CORS preflight and methods. */
    const options = await withFetch(async () => image(BIG_PNG, 'image/png'), () => call(route, map, { method: 'OPTIONS' }));
    eq('OPTIONS → 204', options.result.status, 204);
    eq('OPTIONS CORS origin', options.result.headers.get('access-control-allow-origin'), '*');
    eq('OPTIONS CORS methods', options.result.headers.get('access-control-allow-methods'), 'GET, HEAD, OPTIONS');
    eq('OPTIONS never reaches upstream', options.calls.length, 0);
    const post = await withFetch(async () => image(BIG_PNG, 'image/png'), () => call(route, map, { method: 'POST' }));
    eq('POST → 405', post.result.status, 405);
    eq('POST body', (await readBody(post.result)).json.error, 'method_not_allowed');
    const head = await withFetch(async () => image(BIG_PNG, 'image/png'), () => call(route, map, { method: 'HEAD' }));
    eq('HEAD → 200 with the same headers', head.result.status, 200);
    eq('HEAD carries no body', (await readBody(head.result)).bytes.length, 0);

    /* A cross-site Origin is refused unless it is on the deployment allow-list. */
    const crossSite = await withFetch(async () => image(BIG_PNG, 'image/png'),
        () => call(route, map, { headers: { origin: 'https://evil.example' } }));
    eq('a foreign Origin → 403', crossSite.result.status, 403);
    eq('foreign Origin body', (await readBody(crossSite.result)).json.error, 'origin_not_allowed');
    eq('foreign Origin never reaches upstream', crossSite.calls.length, 0);
    const allowedOrigin = await withFetch(async () => image(BIG_PNG, 'image/png'),
        () => call(route, map, { headers: { origin: 'https://detectlab.eu' } }));
    eq('an allow-listed Origin is accepted', allowedOrigin.result.status, 200);
}

/* ── G. /api/geo/dk-orto ────────────────────────────────────────────────── */
group('G. GET /api/geo/dk-orto — Datafordeler service-user proxy');
{
    const route = loaded['/api/geo/dk-orto'];
    const lib = await import(new URL('file://' + path.join(ROOT, 'backend/src/lib/danish-layers.mjs')).href);
    const layer = lib.danishLayer('orto');
    check('the orto layer exists in the shared config', !!layer && layer.auth === 'basic');

    const map = 'https://detectlab.ro/api/geo/dk-orto?service=WMS&version=1.3.0&request=GetMap' +
        '&layer=orto&styles=&format=image/jpeg&crs=EPSG:3857&bbox=1,2,3,4&width=256&height=256';
    const { result: response, calls } = await withFetch(async () => image(JPEG_BYTES, 'image/jpeg'), () => call(route, map));
    eq('exactly one upstream request', calls.length, 1);
    check('the upstream is services.datafordeler.dk', calls[0].url.startsWith(layer.upstream + '?'), calls[0].url);
    const up = new URL(calls[0].url).searchParams;
    eq('the service-user name is attached server-side', up.get('username'), SECRETS.DATAFORDELER_USERNAME);
    eq('the service-user password is attached server-side', up.get('password'), SECRETS.DATAFORDELER_PASSWORD);
    eq('status 200', response.status, 200);
    eq('the 7-day tile pin is preserved', response.headers.get('cache-control'), 'public, max-age=604800, immutable');
    eq('the CDN pin survives as CDN-Cache-Control',
        response.headers.get('cdn-cache-control'), 'public, s-maxage=604800, stale-while-revalidate=86400');
    await assertNoSecretLeak('no service-user credential in the response', response);

    const injected = await withFetch(async () => image(JPEG_BYTES, 'image/jpeg'),
        () => call(route, map + '&username=ATTACKER&password=ATTACKER&user=ATTACKER&passwd=ATTACKER'));
    const up2 = new URL(injected.calls[0].url).searchParams;
    eq('a caller cannot borrow another identity (username)', up2.get('username'), SECRETS.DATAFORDELER_USERNAME);
    eq('a caller cannot borrow another identity (password)', up2.get('password'), SECRETS.DATAFORDELER_PASSWORD);
    check('no ATTACKER value reaches upstream', !injected.calls[0].url.includes('ATTACKER'));

    /* The legacy alias. */
    const alias = await withFetch(async () => image(JPEG_BYTES, 'image/jpeg'),
        () => call(route, map, { env: { ...SECRETS, DATAFORDELER_USERNAME: undefined, DATAFORDELER_USER: 'legacy-USER' } }));
    eq('DATAFORDELER_USER is honoured as the legacy alias',
        new URL(alias.calls[0].url).searchParams.get('username'), 'legacy-USER');

    const noCreds = await withFetch(async () => image(JPEG_BYTES, 'image/jpeg'),
        () => call(route, map, { env: { DATAFORSYNINGEN_TOKEN: SECRETS.DATAFORSYNINGEN_TOKEN } }));
    eq('missing service-user → 503', noCreds.result.status, 503);
    eq('missing service-user body', (await readBody(noCreds.result)).json.error, 'service_unavailable');

    const badLayer = await withFetch(async () => image(JPEG_BYTES, 'image/jpeg'),
        () => call(route, 'https://detectlab.ro/api/geo/dk-orto?service=WMS&request=GetMap&layer=dtk25'));
    eq('a token-auth layer is refused on the basic-auth route', badLayer.result.status, 400);
    eq('token layer on orto route body', (await readBody(badLayer.result)).json.error, 'layer_not_allowed');

    const options = await withFetch(async () => image(JPEG_BYTES, 'image/jpeg'), () => call(route, map, { method: 'OPTIONS' }));
    eq('OPTIONS → 204', options.result.status, 204);
    const put = await withFetch(async () => image(JPEG_BYTES, 'image/jpeg'), () => call(route, map, { method: 'PUT' }));
    eq('PUT → 405', put.result.status, 405);
}

/* ── H. /api/geo/dk-heritage ────────────────────────────────────────────── */
group('H. GET /api/geo/dk-heritage — Fund og Fortidsminder WFS → GeoJSON');
{
    const route = loaded['/api/geo/dk-heritage'];
    const lib = await import(new URL('file://' + path.join(ROOT, 'backend/src/lib/danish-layers.mjs')).href);
    let seen = null;
    const { result: response, calls } = await withFetch(async (url) => { seen = url; return json(GEOJSON_25832); },
        () => call(route, 'https://detectlab.ro/api/geo/dk-heritage?bbox=12.5,55.6,12.7,55.8'));
    eq('exactly one upstream request', calls.length, 1);
    const up = new URL(seen);
    check('the upstream is the config-selected national WFS', up.hostname.length > 0 && calls[0].url.includes('request=GetFeature'));
    eq('the query is WFS 1.0.0 GetFeature', up.searchParams.get('request'), 'GetFeature');
    eq('the bbox is converted into the service CRS', up.searchParams.get('srsName'), 'EPSG:25832');
    check('the bbox KVP carries the EPSG:25832 suffix',
        /,EPSG:25832$/.test(up.searchParams.get('bbox')), up.searchParams.get('bbox'));
    const metres = up.searchParams.get('bbox').split(',').slice(0, 4).map(Number);
    check('the converted bbox is in UTM-32N metres for Denmark',
        metres[0] > 600000 && metres[0] < 900000 && metres[1] > 6100000 && metres[1] < 6300000,
        JSON.stringify(metres));
    eq('the feature cap is applied', up.searchParams.get('maxFeatures'), '400');

    eq('status 200', response.status, 200);
    eq('the answer is GeoJSON', response.headers.get('content-type'), 'application/json; charset=utf-8');
    eq('the short feature cache is preserved', response.headers.get('cache-control'), 'public, max-age=300');
    eq('the CDN cache survives as CDN-Cache-Control',
        response.headers.get('cdn-cache-control'), 'public, s-maxage=3600, stale-while-revalidate=86400');
    const body = await readBody(response);
    eq('a FeatureCollection comes back', body.json.type, 'FeatureCollection');
    eq('both features survive', body.json.features.length, 2);
    const [lon, lat] = body.json.features[0].geometry.coordinates;
    check('the point is reprojected to EPSG:4326 degrees over Denmark',
        lon > 12 && lon < 13 && lat > 55 && lat < 56, JSON.stringify([lon, lat]));
    eq('the polygon is reprojected too', body.json.features[1].geometry.type, 'Polygon');
    check('the reprojected polygon is in degrees',
        body.json.features[1].geometry.coordinates[0][0][0] < 180 && body.json.features[1].geometry.coordinates[0][0][1] < 90);
    eq('CRS84 is declared', body.json.crs.properties.name, 'urn:ogc:def:crs:OGC:1.3:CRS84');
    eq('totalFeatures is reported', body.json.totalFeatures, 2);
    eq('truncated is reported', body.json.truncated, false);
    await assertNoSecretLeak('no secret in the GeoJSON', response);

    /* The reprojection must round-trip against the shared forward transform. */
    const [e, n] = lib.lonLatToEpsg25832(lon, lat);
    check('the answer round-trips through the shared EPSG:25832 transform (< 1 m)',
        Math.abs(e - 724123.45) < 1 && Math.abs(n - 6185234.56) < 1, `${e},${n}`);

    const bad = [
        ['', 400, 'bbox_required'],
        ['bbox=1,2,3', 400, 'bbox_required'],
        ['bbox=a,b,c,d', 400, 'bbox_required'],
        ['bbox=12.7,55.8,12.5,55.6', 400, 'bbox_invalid'],
        ['bbox=200,200,300,300', 400, 'bbox_outside_coverage'],
        ['bbox=12.5,55.6,12.7,55.8&layer=dtk25', 400, 'layer_not_allowed'],
        ['bbox=12.5,55.6,12.7,55.8&layer=nope', 400, 'layer_not_allowed']
    ];
    for (const [query, status, error] of bad) {
        const r = await withFetch(async () => json(GEOJSON_25832),
            () => call(route, 'https://detectlab.ro/api/geo/dk-heritage?' + query));
        eq(`${error} → ${status}`, r.result.status, status);
        eq(`${error} body`, (await readBody(r.result)).json.error, error);
        eq(`${error} never reaches upstream`, r.calls.length, 0);
    }

    const maxFeatures = await withFetch(async () => json(GEOJSON_25832),
        () => call(route, 'https://detectlab.ro/api/geo/dk-heritage?bbox=12.5,55.6,12.7,55.8&maxFeatures=99999'));
    eq('a caller cannot raise the feature cap above the config value',
        new URL(maxFeatures.calls[0].url).searchParams.get('maxFeatures'), '400');

    const notGeoJson = await withFetch(async () => new Response('<html>nope</html>',
        { status: 200, headers: { 'content-type': 'text/html' } }),
    () => call(route, 'https://detectlab.ro/api/geo/dk-heritage?bbox=12.5,55.6,12.7,55.8'));
    eq('a non-GeoJSON answer → 502', notGeoJson.result.status, 502);
    eq('non-GeoJSON body', (await readBody(notGeoJson.result)).json.error, 'upstream_not_geojson');

    const options = await withFetch(async () => json(GEOJSON_25832),
        () => call(route, 'https://detectlab.ro/api/geo/dk-heritage?bbox=12.5,55.6,12.7,55.8', { method: 'OPTIONS' }));
    eq('OPTIONS → 204', options.result.status, 204);
    eq('OPTIONS never reaches upstream', options.calls.length, 0);
}

/* ── I. /api/geo/finland ────────────────────────────────────────────────── */
group('I. GET /api/geo/finland — Finnish allow-listed passthrough');
{
    const route = loaded['/api/geo/finland'];

    const { result: hillshade, calls } = await withFetch(async () => image(BIG_PNG, 'image/png'),
        () => call(route, 'https://detectlab.ro/api/geo/finland?src=mml-hillshade&z=11&col=984&row=1306'));
    eq('exactly one upstream request', calls.length, 1);
    eq('the karttamoottori WMTS REST path is built from the fixed table',
        calls[0].url,
        'https://karttamoottori.maanmittauslaitos.fi/maasto/wmts/1.0.0/korkeusmalli_vinovalo/default/ETRS-TM35FIN/11/1306/984.png');
    check('a browser-like User-Agent is sent upstream', /Mozilla\/5\.0/.test(calls[0].headers.get('user-agent') || ''));
    eq('status 200', hillshade.status, 200);
    eq('the 7-day image cache is preserved', hillshade.headers.get('cache-control'), 'public, max-age=604800, immutable');
    const hsBody = await readBody(hillshade);
    eq('the binary tile is returned byte for byte', hsBody.bytes.length, BIG_PNG.length);

    const open = await withFetch(async () => image(BIG_PNG, 'image/png'),
        () => call(route, 'https://detectlab.ro/api/geo/finland?src=mml-hillshade-open&z=11&col=984&row=1306'));
    eq('with MML_API_KEY the official avoin-karttakuva WMTS is used',
        open.calls[0].url,
        'https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/korkeusmalli_vinovalo/default/ETRS-TM35FIN/11/1306/984.png?apikey=' + SECRETS.MML_API_KEY);
    await assertNoSecretLeak('the MML key never appears in the response', open.result);

    const noKey = await withFetch(async () => image(BIG_PNG, 'image/png'),
        () => call(route, 'https://detectlab.ro/api/geo/finland?src=mml-hillshade-open&z=11&col=984&row=1306',
            { env: { ...SECRETS, MML_API_KEY: undefined } }));
    eq('without MML_API_KEY only that src answers 401', noKey.result.status, 401);
    const noKeyBody = await readBody(noKey.result);
    eq('the missing-key error code', noKeyBody.json.error, 'mml_api_key_missing');
    eq('the variable name is disclosed for this src (client shows "needs key")', noKeyBody.json.variable, 'MML_API_KEY');
    eq('no upstream request', noKey.calls.length, 0);

    const hkp = await withFetch(async () => new Response(new Uint8Array([0x1a, 0x2f, 0x43, 0x01]),
        { status: 200, headers: { 'content-type': 'application/x-protobuf' } }),
    () => call(route, 'https://detectlab.ro/api/geo/finland?src=hkp-tile&id=623&x=1&y=1&z=8'));
    check('the HKP MVT tile is relayed to the fixed host', hkp.calls[0].url.startsWith('https://hkp.maanmittauslaitos.fi/hkp/action?'));
    eq('an unknown HKP id is refused', (await withFetch(async () => image(BIG_PNG, 'image/png'),
        () => call(route, 'https://detectlab.ro/api/geo/finland?src=hkp-tile&id=999&x=1&y=1&z=8'))).result.status, 400);

    const wfs = await withFetch(async () => json({ type: 'FeatureCollection', features: [] }),
        () => call(route, 'https://detectlab.ro/api/geo/finland?src=museo-wfs&id=133&bbox=24.9,60.1,25.1,60.3'));
    check('museoverkko GetWFSFeatures is relayed', wfs.calls[0].url.startsWith('https://kartta.museoverkko.fi/action?'));
    eq('a JSON answer gets the short cache', wfs.result.headers.get('cache-control'), 'public, max-age=300');
    const blockedWfs = await withFetch(async () => json({}),
        () => call(route, 'https://detectlab.ro/api/geo/finland?src=museo-wfs&id=131&bbox=24.9,60.1,25.1,60.3'));
    eq('a WFS id outside the allow-list is refused', blockedWfs.result.status, 400);
    eq('refused WFS body', (await readBody(blockedWfs.result)).json.error, 'layer_not_allowed');
    eq('refused WFS never reaches upstream', blockedWfs.calls.length, 0);

    /* The two passthrough sources are host- AND path-allow-listed. */
    const syke = await withFetch(async () => json({ ok: true }),
        () => call(route, 'https://detectlab.ro/api/geo/finland?src=syke&url=' + encodeURIComponent(
            'https://paikkatiedot.ymparisto.fi/geoserver/wfs?service=WFS&request=GetFeature&token=ATTACKER&apikey=ATTACKER')));
    eq('the SYKE host is accepted', syke.result.status, 200);
    check('credentials are stripped from a passthrough query', !/ATTACKER/.test(syke.calls[0].url), syke.calls[0].url);
    for (const [label, url] of [
        ['a different host', 'https://evil.example/geoserver/wfs?service=WFS'],
        ['a different path on the right host', 'https://paikkatiedot.ymparisto.fi/other/wfs?service=WFS'],
        ['a non-https URL', 'http://paikkatiedot.ymparisto.fi/geoserver/wfs'],
        ['embedded credentials', 'https://user:pass@paikkatiedot.ymparisto.fi/geoserver/wfs']
    ]) {
        const r = await withFetch(async () => json({}),
            () => call(route, 'https://detectlab.ro/api/geo/finland?src=syke&url=' + encodeURIComponent(url)));
        eq(`SYKE refuses ${label}`, r.result.status, 400);
        eq(`SYKE ${label} never reaches upstream`, r.calls.length, 0);
    }
    const aland = await withFetch(async () => json({ ok: true }),
        () => call(route, 'https://detectlab.ro/api/geo/finland?src=aland&url=' + encodeURIComponent(
            'https://kartor.regeringen.ax/arcgis/rest/services/Kartor/MapServer/export?bbox=1,2,3,4')));
    eq('the Åland REST host is accepted', aland.result.status, 200);
    const alandBad = await withFetch(async () => json({}),
        () => call(route, 'https://detectlab.ro/api/geo/finland?src=aland&url=' + encodeURIComponent(
            'https://kartor.regeringen.ax/somewhere/else')));
    eq('Åland refuses a path outside the allow-list', alandBad.result.status, 400);

    const bad = [
        ['src=unknown-source', 400, 'unknown_src'],
        ['', 400, 'unknown_src'],
        ['src=mml-hillshade&z=99&col=1&row=1', 400, 'bad_tile_index'],
        ['src=mml-hillshade&z=11&col=-1&row=1', 400, 'bad_tile_index'],
        ['src=museo-wfs&id=133&bbox=25.1,60.3,24.9,60.1', 400, 'bad_bbox'],
        ['src=museo-wfs&id=133&bbox=24.9,60.1,25.1,68.3', 400, 'bad_bbox'],
        ['src=museo-wfs&id=133&bbox=a,b,c,d', 400, 'bad_bbox'],
        ['src=museo-wfs&id=133', 400, 'bad_bbox'],
        ['src=museo-wfs&id=133&bbox=20,55,35,70', 400, 'bad_bbox'],
        ['src=syke', 400, 'url_missing']
    ];
    for (const [query, status, error] of bad) {
        const r = await withFetch(async () => json({}), () => call(route, 'https://detectlab.ro/api/geo/finland?' + query));
        eq(`${error} → ${status}`, r.result.status, status);
        eq(`${error} never reaches upstream`, r.calls.length, 0);
    }

    const timeout = await withFetch(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; },
        () => call(route, 'https://detectlab.ro/api/geo/finland?src=mml-hillshade&z=11&col=984&row=1306'));
    eq('an upstream timeout → 504', timeout.result.status, 504);
    eq('timeout body', (await readBody(timeout.result)).json.error, 'upstream_timeout');
    const status403 = await withFetch(async () => new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain' } }),
        () => call(route, 'https://detectlab.ro/api/geo/finland?src=mml-hillshade&z=11&col=984&row=1306'));
    eq('an upstream 403 is passed through as a 403, not faked as 200', status403.result.status, 403);

    const options = await withFetch(async () => json({}), () => call(route, 'https://detectlab.ro/api/geo/finland?src=mml-hillshade&z=1&col=1&row=1', { method: 'OPTIONS' }));
    eq('OPTIONS → 204', options.result.status, 204);
    eq('OPTIONS CORS methods', options.result.headers.get('access-control-allow-methods'), 'GET, HEAD, OPTIONS');
    const del = await withFetch(async () => json({}), () => call(route, 'https://detectlab.ro/api/geo/finland?src=mml-hillshade&z=1&col=1&row=1', { method: 'DELETE' }));
    eq('DELETE → 405', del.result.status, 405);
    const head = await withFetch(async () => image(BIG_PNG, 'image/png'), () => call(route, 'https://detectlab.ro/api/geo/finland?src=mml-hillshade&z=11&col=984&row=1306', { method: 'HEAD' }));
    eq('HEAD → 200', head.result.status, 200);
    eq('HEAD carries no body', (await readBody(head.result)).bytes.length, 0);
    const crossSite = await withFetch(async () => image(BIG_PNG, 'image/png'),
        () => call(route, 'https://detectlab.ro/api/geo/finland?src=mml-hillshade&z=11&col=984&row=1306',
            { headers: { 'sec-fetch-site': 'cross-site' } }));
    eq('a cross-site Sec-Fetch-Site is refused', crossSite.result.status, 403);
}

/* ── J. /api/geo/asig-heritage ──────────────────────────────────────────── */
group('J. GET /api/geo/asig-heritage — bounded ASIG WFS → GeoJSON');
{
    const route = loaded['/api/geo/asig-heritage'];
    const layer = 'akzm:monumentet_natyrore_07032023';
    const url = 'https://detectlab.ro/api/geo/asig-heritage?layer=' + layer + '&bbox=19.7,41.2,19.9,41.4';
    const { result: response, calls } = await withFetch(async () => json(ASIG_GEOJSON), () => call(route, url));
    eq('exactly one upstream request', calls.length, 1);
    check('the upstream is the ASIG geoportal WFS', calls[0].url.startsWith('https://geoportal.asig.gov.al/service/wfs?'), calls[0].url);
    const up = new URL(calls[0].url);
    eq('WFS 1.0.0 GetFeature', up.searchParams.get('request'), 'GetFeature');
    eq('the requested layer is passed through', up.searchParams.get('typeName'), layer);
    eq('the bbox carries the CRS suffix', up.searchParams.get('bbox'), '19.7,41.2,19.9,41.4,EPSG:4326');
    eq('the feature cap is 150', up.searchParams.get('maxFeatures'), '150');
    eq('status 200', response.status, 200);
    eq('the answer is GeoJSON', response.headers.get('content-type'), 'application/json');
    eq('the 60 s cache is preserved', response.headers.get('cache-control'), 'public, max-age=60');
    eq('nosniff is preserved', response.headers.get('x-content-type-options'), 'nosniff');
    const body = await readBody(response);
    eq('both features survive', body.json.features.length, 2);
    eq('a polygon is reduced to its representative point', body.json.features[0].geometry.type, 'Point');
    const centre = body.json.features[0].geometry.coordinates;
    check('the representative point is the polygon bbox centre',
        Math.abs(centre[0] - 19.8) < 1e-9 && Math.abs(centre[1] - 41.3) < 1e-9,
        JSON.stringify(centre));
    eq('the representative flag is set', body.json.features[0].properties.representative, true);
    eq('unknown properties are dropped', body.json.features[0].properties.secret, undefined);
    check('the title is carried over', String(body.json.features[0].properties.title).length > 0);

    const bad = [
        ['layer=not:allowed&bbox=19.7,41.2,19.9,41.4', 400, 'invalid_layer'],
        ['layer=' + layer + '&bbox=1,2,3,4', 400, 'invalid_bbox'],
        ['layer=' + layer + '&bbox=19.9,41.4,19.7,41.2', 400, 'invalid_bbox'],
        ['layer=' + layer + '&bbox=19.7,41.2,25.0,41.4', 400, 'invalid_bbox'],
        ['layer=' + layer, 400, 'invalid_bbox'],
        ['layer=' + layer + '&bbox=19.7,41.2,19.9', 400, 'invalid_bbox']
    ];
    for (const [query, status, error] of bad) {
        const r = await withFetch(async () => json(ASIG_GEOJSON), () => call(route, 'https://detectlab.ro/api/geo/asig-heritage?' + query));
        eq(`${error} → ${status} (${query.slice(0, 24)}…)`, r.result.status, status);
        eq(`${error} body`, (await readBody(r.result)).json.error, error);
        eq(`${error} never reaches upstream`, r.calls.length, 0);
    }

    /* An archaeology layer discovered from WMS capabilities is accepted. */
    const discovered = await withFetch(async () => json(ASIG_GEOJSON),
        () => call(route, 'https://detectlab.ro/api/geo/asig-heritage?layer=iktk:archaeological_sites_2026&bbox=19.7,41.2,19.9,41.4'));
    eq('a name matching the archaeology pattern is accepted', discovered.result.status, 200);

    const unavailable = await withFetch(async () => new Response('<ExceptionReport/>', { status: 500 }), () => call(route, url));
    eq('an unavailable WFS → 502', unavailable.result.status, 502);
    eq('unavailable body', (await readBody(unavailable.result)).json.error, 'asig_wfs_unavailable');
    const tooLarge = await withFetch(async () => new Response('x'.repeat(2000001), { status: 200, headers: { 'content-type': 'application/json' } }), () => call(route, url));
    eq('an oversized answer → 502', tooLarge.result.status, 502);
    eq('oversized body', (await readBody(tooLarge.result)).json.error, 'asig_response_too_large');
    const notFc = await withFetch(async () => json({ type: 'Feature' }), () => call(route, url));
    eq('a non-FeatureCollection answer → 502', notFc.result.status, 502);
    const badCoords = await withFetch(async () => json({ type: 'FeatureCollection', features: [{ geometry: { type: 'Point', coordinates: [1000000, 1000000] } }] }), () => call(route, url));
    eq('out-of-range coordinates → 502, not a broken marker', badCoords.result.status, 502);

    const options = await withFetch(async () => json(ASIG_GEOJSON), () => call(route, url, { method: 'OPTIONS' }));
    eq('OPTIONS → 405 (only GET is accepted, as on Netlify)', options.result.status, 405);
    const head = await withFetch(async () => json(ASIG_GEOJSON), () => call(route, url, { method: 'HEAD' }));
    eq('HEAD → 405 (only GET is accepted, as on Netlify)', head.result.status, 405);
}

/* ── K. /api/map3d/tile — the allow-listed 3D proxy ─────────────────────── */
group('K. GET /api/map3d/tile — 3D terrain tile proxy');
{
    const route = loaded['/api/map3d/tile'];
    const generated = await import(new URL('file://' + path.join(ROOT, 'functions/_generated/map3d-tile.mjs')).href);
    const layers = generated.registry.list();
    check('the shared layer registry is bundled into the Cloudflare function', layers.length > 100, layers.length + ' layers');

    const wms = layers.find((d) => d.kind === 'wms' && /^https?:/.test(d.url || ''));
    const xyz = layers.find((d) => (d.kind === 'tile' || d.kind === 'xyz') && /\{z\}/.test(d.url || d.template || ''));
    const moduleBacked = layers.find((d) => d.kind === 'dynamic' && d.builder && d.builder.module);
    const reprojected = layers.find((d) => String(d.crs) === 'EPSG:2180');

    if (wms) {
        const { result: response, calls } = await withFetch(async () => image(BIG_PNG, 'image/png'),
            () => call(route, `https://detectlab.ro/api/map3d/tile?layer=${encodeURIComponent(wms.id)}&z=12&x=2176&y=1360`));
        eq(`a registry WMS layer (${wms.id}) reaches exactly one upstream`, calls.length, 1);
        check('the upstream URL is built from the registry definition, not from the caller',
            calls[0].url.startsWith(wms.url) || calls[0].url.startsWith(String(wms.url).split('?')[0]), calls[0].url);
        check('the upstream request is a GetMap', /request=GetMap/i.test(calls[0].url));
        eq('status 200', response.status, 200);
        eq('CORS is allowed for MapLibre', response.headers.get('access-control-allow-origin'), '*');
        eq('the runtime tag names Cloudflare', response.headers.get('x-map3d-proxy'), 'cloudflare-pages-function');
        eq('the browser cache is preserved', response.headers.get('cache-control'), 'public, max-age=86400, stale-while-revalidate=86400');
        eq('the CDN pin survives as CDN-Cache-Control',
            response.headers.get('cdn-cache-control'), 'public, s-maxage=604800, stale-while-revalidate=86400');
        check('no Netlify-only header reaches the client', response.headers.get('netlify-cdn-cache-control') === null);
        const body = await readBody(response);
        eq('the binary tile is returned byte for byte', body.bytes.length, BIG_PNG.length);
        eq('the cache source is reported', response.headers.get('x-map3d-cache'), 'upstream');
        eq('the layer label is reported', response.headers.get('x-map3d-layer'), wms.id);
        await assertNoSecretLeak('no secret in the tile response', response);

        /* The memory cache must serve the second identical request locally. */
        const second = await withFetch(async () => image(BIG_PNG, 'image/png'),
            () => call(route, `https://detectlab.ro/api/map3d/tile?layer=${encodeURIComponent(wms.id)}&z=12&x=2176&y=1360`));
        eq('a repeated tile is served from isolate memory', second.result.headers.get('x-map3d-cache'), 'memory');
        eq('and costs no upstream request', second.calls.length, 0);
    } else check('a WMS registry layer exists to test', false);

    if (xyz) {
        const { result: response, calls } = await withFetch(async () => image(BIG_PNG, 'image/png'),
            () => call(route, `https://detectlab.ro/api/map3d/tile?layer=${encodeURIComponent(xyz.id)}&z=10&x=544&y=340`));
        eq(`an XYZ layer (${xyz.id}) substitutes z/x/y into its own template`, calls.length, 1);
        check('the template placeholders are gone', !/\{[-]?[xyz]\}/.test(calls[0].url), calls[0].url);
        eq('status 200', response.status, 200);
    } else check('an XYZ registry layer exists to test', false);

    if (moduleBacked) {
        const { result: response, calls } = await withFetch(async () => image(BIG_PNG, 'image/png'),
            () => call(route, `https://detectlab.ro/api/map3d/tile?layer=${encodeURIComponent(moduleBacked.id)}&z=13&x=4352&y=2720`));
        check(`the module-backed layer (${moduleBacked.id}) built its URL inside the embedded sandbox`,
            calls.length === 1 && /^https?:/.test(calls[0].url), calls.length ? calls[0].url : 'no upstream request');
        check('the answer is not the "builder unavailable" blank tile',
            response.headers.get('x-map3d-reason') !== 'per-tile-builder-unavailable',
            response.headers.get('x-map3d-reason'));
        eq('status 200', response.status, 200);
    } else check('a module-backed registry layer exists to test', false);

    if (reprojected) {
        const { result: response, calls } = await withFetch(async () => image(BIG_PNG, 'image/png'),
            () => call(route, `https://detectlab.ro/api/map3d/tile?layer=${encodeURIComponent(reprojected.id)}&z=14&x=8704&y=5440`));
        eq(`the EPSG:2180 layer (${reprojected.id}) is reprojected, not refused`, response.status, 200);
        check('the upstream bbox is in EPSG:2180 metres',
            /bbox=/.test(calls[0].url) && !/bbox=[-\d.]{1,3},[-\d.]{1,3},[-\d.]{1,3},[-\d.]{1,3}&/.test(calls[0].url.replace(/%2C/g, ',')),
            calls[0].url.slice(0, 200));
        eq('the CRS is reported', response.headers.get('x-map3d-crs'), 'EPSG:2180');
    } else check('an EPSG:2180 registry layer exists to test', false);

    /* Validation: the guards that keep this from being an open proxy. */
    const bad = [
        ['', 404, 'unknown-layer'],
        ['layer=not-a-layer&z=10&x=1&y=1', 404, 'unknown-layer'],
        ['layer=' + (wms ? wms.id : 'x') + '&z=-1&x=0&y=0', 400, 'bad-z'],
        ['layer=' + (wms ? wms.id : 'x') + '&z=23&x=0&y=0', 400, 'bad-z'],
        ['layer=' + (wms ? wms.id : 'x') + '&z=3&x=8&y=0', 400, 'bad-xy'],
        ['layer=' + (wms ? wms.id : 'x') + '&z=3&x=0&y=-1', 400, 'bad-xy'],
        ['layer=' + (wms ? wms.id : 'x') + '&z=abc&x=0&y=0', 400, 'bad-z'],
        ['layer=' + (wms ? wms.id : 'x') + '&z=3&x=0&y=0&t=yesterday', 400, 'bad-time'],
        ['layer=' + (wms ? wms.id : 'x') + '&z=3&x=0&y=0&p=!!bad!!', 400, 'bad-product'],
        ['layer=' + (wms ? wms.id : 'x') + '&z=3&x=0&y=0&m=' + 'x'.repeat(41), 400, 'bad-mode']
    ];
    for (const [query, status, error] of bad) {
        const r = await withFetch(async () => image(BIG_PNG, 'image/png'),
            () => call(route, 'https://detectlab.ro/api/map3d/tile?' + query));
        eq(`${error} → ${status}`, r.result.status, status);
        eq(`${error} body`, (await readBody(r.result)).json.error, error);
        eq(`${error} never reaches upstream`, r.calls.length, 0);
    }

    /* Relay mode: the open-proxy checks the brief singles out. */
    const allowed = await withFetch(async () => image(BIG_PNG, 'image/png'),
        () => call(route, 'https://detectlab.ro/api/map3d/tile?u=' + encodeURIComponent(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/1360/2176')));
    eq('an allow-listed relay host is fetched', allowed.calls.length, 1);
    eq('an allow-listed relay host answers 200', allowed.result.status, 200);
    eq('the relay is labelled', allowed.result.headers.get('x-map3d-upstream'), 'relay');

    const refused = [
        ['an unlisted host', 'https://evil.example.com/tile.png', 'relay-host-not-allowed'],
        ['a subdomain of an unlisted host', 'https://x.evil.example.com/tile.png', 'relay-host-not-allowed'],
        ['loopback', 'http://127.0.0.1:8788/tile.png', 'relay-private-host'],
        ['localhost', 'http://localhost/tile.png', 'relay-private-host'],
        ['the cloud metadata endpoint', 'http://169.254.169.254/latest/meta-data/', 'relay-private-host'],
        ['RFC1918 10/8', 'http://10.1.2.3/tile.png', 'relay-private-host'],
        ['RFC1918 172.16/12', 'http://172.16.5.4/tile.png', 'relay-private-host'],
        ['RFC1918 192.168/16', 'http://192.168.1.1/tile.png', 'relay-private-host'],
        ['an IPv6 literal', 'https://[::1]/tile.png', 'relay-private-host'],
        ['a .local name', 'http://printer.local/tile.png', 'relay-private-host'],
        ['a file: URL', 'file:///etc/passwd', 'relay-bad-protocol'],
        ['an ftp: URL', 'ftp://server.arcgisonline.com/tile.png', 'relay-bad-protocol'],
        ['embedded credentials', 'https://user:pass@server.arcgisonline.com/tile.png', 'relay-credentials'],
        ['a malformed URL', 'not a url', 'relay-bad-url']
    ];
    for (const [label, target, error] of refused) {
        const r = await withFetch(async () => image(BIG_PNG, 'image/png'),
            () => call(route, 'https://detectlab.ro/api/map3d/tile?u=' + encodeURIComponent(target)));
        eq(`relay refuses ${label}`, r.result.status, 403);
        eq(`relay ${label} body`, (await readBody(r.result)).json.error, error);
        eq(`relay ${label} never reaches upstream`, r.calls.length, 0);
        check(`relay ${label} reports the reason`,
            r.result.headers.get('x-map3d-reason') === error.replace(/^relay-/, ''),
            r.result.headers.get('x-map3d-reason'));
    }

    /* Upstream failures degrade to a labelled transparent tile, never a 5xx. */
    const down = await withFetch(async () => { throw new Error('dns failure'); },
        () => call(route, `https://detectlab.ro/api/map3d/tile?layer=${encodeURIComponent(xyz ? xyz.id : layers[0].id)}&z=11&x=1088&y=680`));
    eq('an unreachable upstream still answers 200', down.result.status, 200);
    eq('and is labelled as an upstream error', down.result.headers.get('x-map3d-upstream'), 'error');
    eq('and is a blank tile', down.result.headers.get('x-map3d-tile'), 'blank');
    const downBody = await readBody(down.result);
    check('the blank tile is a real 1×1 PNG', downBody.bytes[0] === 0x89 && downBody.bytes[1] === 0x50);
    const html = await withFetch(async () => new Response('<html>ServiceException</html>',
        { status: 200, headers: { 'content-type': 'text/html' } }),
    () => call(route, `https://detectlab.ro/api/map3d/tile?layer=${encodeURIComponent(xyz ? xyz.id : layers[0].id)}&z=11&x=1089&y=680`));
    eq('an HTML answer is never handed to the renderer', html.result.headers.get('x-map3d-upstream'), 'not-an-image');
    const http404 = await withFetch(async () => new Response('nope', { status: 404, headers: { 'content-type': 'image/png' } }),
        () => call(route, `https://detectlab.ro/api/map3d/tile?layer=${encodeURIComponent(xyz ? xyz.id : layers[0].id)}&z=11&x=1090&y=680`));
    eq('an upstream 404 is reported', http404.result.headers.get('x-map3d-upstream'), 'http-404');

    /* Methods. */
    const options = await withFetch(async () => image(BIG_PNG, 'image/png'),
        () => call(route, 'https://detectlab.ro/api/map3d/tile?z=1&x=0&y=0', { method: 'OPTIONS' }));
    eq('OPTIONS → 204', options.result.status, 204);
    eq('OPTIONS CORS origin', options.result.headers.get('access-control-allow-origin'), '*');
    eq('OPTIONS never reaches upstream', options.calls.length, 0);
    const post = await withFetch(async () => image(BIG_PNG, 'image/png'),
        () => call(route, 'https://detectlab.ro/api/map3d/tile?z=1&x=0&y=0', { method: 'POST' }));
    eq('POST → 405', post.result.status, 405);
    eq('POST body', (await readBody(post.result)).json.error, 'method-not-allowed');
    const head = await withFetch(async () => image(BIG_PNG, 'image/png'),
        () => call(route, `https://detectlab.ro/api/map3d/tile?layer=${encodeURIComponent(xyz ? xyz.id : layers[0].id)}&z=12&x=2177&y=1361`, { method: 'HEAD' }));
    eq('HEAD → 200 with headers', head.result.status, 200);
    eq('HEAD carries no body', (await readBody(head.result)).bytes.length, 0);
}

/* ── L. the adapter itself ──────────────────────────────────────────────── */
group('L. functions/_lib — adapter and runtime shims');
{
    const adapter = await import(new URL('file://' + path.join(ROOT, 'functions/_lib/pages-adapter.js')).href);
    const shims = await import(new URL('file://' + path.join(ROOT, 'functions/_lib/runtime-shims.js')).href);

    check('Buffer is available and functional', shims.bufferStatus.source === 'runtime' || shims.bufferStatus.source === 'polyfill',
        shims.bufferStatus.reason);
    eq('the Basic-auth encoding the Swedish proxy needs is correct',
        globalThis.Buffer.from('user:pass', 'utf8').toString('base64'), 'dXNlcjpwYXNz');
    eq('the OGC-sniffing slice is correct',
        globalThis.Buffer.from(new TextEncoder().encode('hello world')).toString('utf8', 0, 5), 'hello');
    eq('Buffer.concat + toString is correct',
        globalThis.Buffer.concat([globalThis.Buffer.from(new Uint8Array([0x7b])), globalThis.Buffer.from(new Uint8Array([0x7d]))]).toString('utf8'), '{}');

    /* bindEnv must expose context.env through process.env. */
    const bound = shims.bindEnv({ PROBE_VALUE: 'from-context-env', DATAFORSYNINGEN_TOKEN: 'x' });
    eq('process.env is bound to context.env', process.env.PROBE_VALUE, 'from-context-env');
    check('an unknown variable is undefined, not a crash', process.env.NOT_SET_HERE === undefined);
    eq('bindEnv returns the process object', bound, globalThis.process);
    try { Object.defineProperty(globalThis.process, 'env', { value: process.env, writable: true, configurable: true, enumerable: true }); } catch { /* ignore */ }

    /* Netlify-only directives are translated, nothing else is touched. */
    const translated = adapter.normalize(new Response('body', {
        status: 200,
        headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=604800, immutable',
            'Netlify-CDN-Cache-Control': 'public, s-maxage=604800, stale-while-revalidate=86400'
        }
    }));
    eq('Netlify-CDN-Cache-Control is removed', translated.headers.get('netlify-cdn-cache-control'), null);
    eq('CDN-Cache-Control carries the same value',
        translated.headers.get('cdn-cache-control'), 'public, s-maxage=604800, stale-while-revalidate=86400');
    eq('Cloudflare-CDN-Cache-Control carries the same value',
        translated.headers.get('cloudflare-cdn-cache-control'), 'public, s-maxage=604800, stale-while-revalidate=86400');
    eq('the standard Cache-Control is untouched',
        translated.headers.get('cache-control'), 'public, max-age=604800, immutable');
    eq('the runtime tag is added', translated.headers.get('x-detectlab-runtime'), 'cloudflare-pages-function');
    eq('the body survives the rewrite', await translated.text(), 'body');

    const untouched = adapter.normalize(new Response('x', { status: 200, headers: { 'Content-Type': 'text/plain' } }), { runtimeHeader: false });
    check('a response with nothing to translate is returned as-is', untouched instanceof Response);

    const noBody = adapter.normalize(new Response(null, { status: 204 }), { setHeaders: { 'X-Test': '1' } });
    eq('a 204 keeps its empty body', noBody.status, 204);
    eq('a 204 still receives the header', noBody.headers.get('x-test'), '1');

    /* The error boundary must never leak internals. */
    const boom = adapter.adaptNetlifyFunction(() => { throw new Error('secret detail: DATAFORSYNINGEN_TOKEN=abc'); }, { route: '/probe' });
    const caught = await boom(contextFor('https://detectlab.ro/probe'));
    eq('a throwing handler → 500', caught.status, 500);
    const caughtBody = await readBody(caught);
    eq('the 500 body is generic', caughtBody.json.error, 'internal_error');
    check('the 500 body does not leak the exception message', !caughtBody.text.includes('secret detail'));
    eq('the 500 is not cached', caught.headers.get('cache-control'), 'no-store');

    const badReturn = adapter.adaptNetlifyFunction(() => 'not a response', { route: '/probe' });
    eq('a handler that returns a non-Response → 500', (await badReturn(contextFor('https://detectlab.ro/probe'))).status, 500);
}

/* ── summary ────────────────────────────────────────────────────────────── */
console.log('\n' + '─'.repeat(72));
if (failures) {
    console.error(`✗ ${failures} of ${checks} checks FAILED`);
    process.exit(1);
}
console.log(`✓ all ${checks} checks passed — nine Cloudflare Pages Functions verified`);
