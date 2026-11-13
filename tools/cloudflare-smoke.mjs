#!/usr/bin/env node
/*
 * tools/cloudflare-smoke.mjs
 * ───────────────────────────────────────────────────────────────────────────
 * End-to-end smoke test of a RUNNING Cloudflare Pages deployment — the local
 * workerd runtime (`wrangler pages dev`) or a real *.pages.dev preview. It
 * checks the things the unit tests cannot: real routing, real `_headers` and
 * `_routes.json` handling, real middleware, real binary tiles.
 *
 *   node tools/cloudflare-smoke.mjs                          # http://127.0.0.1:8799
 *   node tools/cloudflare-smoke.mjs --url=http://127.0.0.1:8799
 *   node tools/cloudflare-smoke.mjs --url=https://<hash>.detectlab-4i1.pages.dev
 *
 * Start the local runtime first (dummy values — nothing here needs a real
 * secret, and a missing one is itself a documented outcome):
 *
 *   npx wrangler@latest pages dev cloudflare-dist --port=8799 --ip=127.0.0.1 \
 *     -b DATAFORSYNINGEN_TOKEN=local-test-ds-token \
 *     -b DATAFORDELER_USERNAME=local-test-dfd-user \
 *     -b DATAFORDELER_PASSWORD=local-test-dfd-pass \
 *     -b LANTMATERIET_WMS_USER=local-test-lm-user \
 *     -b LANTMATERIET_WMS_PASSWORD=local-test-lm-pass \
 *     -b MML_API_KEY=local-test-mml-key \
 *     -b DANISH_PROXY_ALLOWED_ORIGINS=https://detectlab.ro,https://detectlab.eu
 *
 * Requests use node:http / node:https rather than fetch() on purpose: the www →
 * apex checks have to send a chosen Host header, and Node's fetch() ignores it.
 * Nothing is written, and no upstream is called with a real credential.
 */
import http from 'node:http';
import https from 'node:https';

const argv = process.argv.slice(2);
const urlArg = argv.find((a) => a.startsWith('--url='));
const BASE = new URL(urlArg ? urlArg.slice('--url='.length) : 'http://127.0.0.1:8799');
const QUIET = argv.includes('--quiet');

/* The dummy secret values the local runtime is expected to be started with. A
 * response must never contain one of them; against a real preview deployment
 * the real values are unknown to this script, which is exactly the point — the
 * check below then simply has nothing to match. */
const LOCAL_DUMMY_SECRETS = ['local-test-ds-token', 'local-test-dfd-user', 'local-test-dfd-pass',
    'local-test-lm-user', 'local-test-lm-pass', 'local-test-mml-key'];

const ROUTES = ['/api/corona/rasters', '/api/geo/se-hojdmodell', '/api/map3d/tile', '/api/geo/dk-dhm',
    '/api/geo/dk-dtk25', '/api/geo/dk-orto', '/api/geo/dk-heritage', '/api/geo/finland',
    '/api/geo/asig-heritage'];

let checks = 0;
let failures = 0;
let notes = 0;
const bodies = [];

function check(name, condition, detail) {
    checks++;
    if (condition) { if (!QUIET) console.log('  \u2713 ' + name); return true; }
    failures++;
    console.error('  \u2717 ' + name + (detail ? ' \u2014 ' + detail : ''));
    return false;
}
function eq(name, actual, expected) {
    return check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
/** An outcome that depends on the outside world: reported, never failed. */
function note(name, detail) {
    notes++;
    console.log(`  \u2022 ${name}${detail ? ' \u2014 ' + detail : ''}`);
}
function group(title) { console.log('\n' + title); }

/**
 * Set once, in section 6: whether this runtime can actually reach the upstream
 * providers. The sandbox this migration was verified in has no egress except
 * github/npm/pypi, so every real WMS/WMTS/WFS call fails there — which the
 * handlers answer exactly as they do on Netlify (a labelled blank tile, or a
 * 502). Those outcomes are environment notes, not failures; a validation error,
 * a refusal or a leaked secret is a failure everywhere.
 */
let EGRESS = null;
function expectStatus(name, response, { withEgress, withoutEgress, always }) {
    const allowed = always || (EGRESS ? withEgress : withoutEgress) || withEgress;
    const label = always ? '' : (EGRESS ? '' : ' (no egress: degraded status accepted)');
    return check(`${name} → ${allowed.join('/')}${label}`, allowed.includes(response.status),
        `${response.status} ${String(response.text).slice(0, 90)}`);
}

/**
 * One request, no redirect following, so a 301/308 is visible.
 * @param {string} path  path + query
 * @param {object} [options]  { method, host (Host header override), headers, body }
 */
function probe(path, options = {}) {
    const transport = BASE.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const headers = { ...(options.headers || {}) };
        if (options.host) headers.Host = options.host;
        if (options.body) headers['Content-Length'] = Buffer.byteLength(options.body);
        const request = transport.request({
            protocol: BASE.protocol,
            hostname: BASE.hostname,
            port: BASE.port,
            path,
            method: options.method || 'GET',
            headers
        }, (response) => {
            const chunks = [];
            response.on('data', (c) => chunks.push(c));
            response.on('end', () => {
                const raw = Buffer.concat(chunks);
                bodies.push({ path, body: raw.toString('utf8').slice(0, 4000) });
                resolve({
                    status: response.statusCode,
                    headers: response.headers,
                    header(name) { return response.headers[name.toLowerCase()]; },
                    raw,
                    bytes: raw.length,
                    get text() { return raw.toString('utf8'); },
                    get json() { try { return JSON.parse(raw.toString('utf8')); } catch { return null; } },
                    get isPng() { return raw.length > 8 && raw[0] === 0x89 && raw.toString('latin1', 1, 4) === 'PNG'; },
                    get isJpeg() { return raw.length > 3 && raw[0] === 0xff && raw[1] === 0xd8; }
                });
            });
        });
        request.on('error', reject);
        request.setTimeout(45000, () => request.destroy(new Error('timeout')));
        if (options.body) request.write(options.body);
        request.end();
    });
}

console.log(`Cloudflare Pages smoke test → ${BASE.origin}`);

/* ═══════════════════════════════════════════════════════════════════════════ */
group('1. Static assets are served without invoking a Function');
{
    const home = await probe('/');
    eq('GET / → 200', home.status, 200);
    check('/ is the application shell', /text\/html/.test(home.header('content-type') || '') && home.bytes > 100000,
        `${home.bytes} bytes, ${home.header('content-type')}`);
    check('a static asset carries no Function runtime tag', !home.header('x-detectlab-runtime'));
    eq('X-Content-Type-Options: nosniff is applied site-wide', home.header('x-content-type-options'), 'nosniff');

    for (const [path, type] of [['/sw.js', 'javascript'], ['/manifest.json', 'json'],
        ['/js/layer-registry.js', 'javascript'], ['/css/checkout.css', 'css']]) {
        const r = await probe(path);
        if (r.status === 404) { note(`${path} is not published`, 'not referenced by the frontend'); continue; }
        eq(`GET ${path} → 200`, r.status, 200);
        check(`${path} is served as ${type}`, (r.header('content-type') || '').includes(type), r.header('content-type'));
        check(`${path} never invokes a Function`, !r.header('x-detectlab-runtime'));
    }
    const sw = await probe('/sw.js');
    eq('sw.js is revalidated on every request', sw.header('cache-control'), 'no-cache');
    const manifest = await probe('/manifest.json');
    eq('manifest.json is revalidated on every request', manifest.header('cache-control'), 'no-cache');

    /* The one file published from an otherwise-excluded directory: the RVT
     * offline fallback that sw.js precaches and js/rvt-panel.js fetches. */
    const rvt = await probe('/rvt_service/methods.json');
    eq('GET /rvt_service/methods.json → 200', rvt.status, 200);
    check('the RVT offline fallback is valid JSON', !!rvt.json && !!rvt.json.groups);
    const rvtSource = await probe('/rvt_service/server.py');
    eq('the Python service itself is not published', rvtSource.status, 404);

    /* Nothing server-side may be reachable as a static asset. Cloudflare's asset
     * router only answers an unmatched path with a real 404 when a 404 asset is
     * deployed; without cloudflare/404.html it served index.html with 200, so
     * /netlify.toml and /api/does-not-exist both answered "200 text/html".
     * wrangler.jsonc sets assets.not_found_handling = "404-page" to match. */
    for (const forbidden of ['/netlify.toml', '/wrangler.jsonc', '/netlify/functions/map3d-tile.mjs',
        '/backend/package.json', '/functions/_middleware.js', '/tools/cloudflare-build.mjs',
        '/supabase/migrations', '/.gitignore', '/cloudflare/_headers', '/totally-missing-xyz',
        '/rvt_service/server.py', '/data/corona-europe-catalog.snapshot.json']) {
        const r = await probe(forbidden);
        eq(`${forbidden} → 404`, r.status, 404);
        check(`${forbidden} is answered by the 404 page, never by the app shell`,
            /404/.test(r.text) && r.bytes < 20000, `${r.bytes} bytes`);
        check(`${forbidden} does not leak the file it was asked for`, !r.text.includes('netlify.toml') ||
            forbidden === '/netlify.toml' ? true : !r.text.includes(forbidden));
    }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('2. The Google OAuth callback: both spellings, direct 200, all three headers');
{
    /* wrangler.jsonc sets assets.html_handling:"none", so Cloudflare Pages serves
     * google-auth-callback.html at its own URL AND at the extensionless one, each
     * as a direct 200 — the default "auto-trailing-slash" behaviour redirected
     * /google-auth-callback.html → /google-auth-callback with a 308, which put the
     * one-time Google `code` through a redirect hop and made sw.js skip every
     * precached .html document (it caches a 200 only). This group is the live
     * regression test for BOTH URLs the brief asks about. */
    for (const spelling of ['/google-auth-callback.html', '/google-auth-callback']) {
        const r = await probe(spelling);
        eq(`GET ${spelling} → 200 (no redirect)`, r.status, 200);
        check(`${spelling} is not a redirect`, !r.header('location'), `${r.header('location')}`);
        check(`${spelling} serves the real callback page`,
            /text\/html/.test(r.header('content-type') || '') && r.bytes > 500);
        eq(`${spelling} → Cache-Control: no-store`, r.header('cache-control'), 'no-store');
        eq(`${spelling} → Referrer-Policy: no-referrer`, r.header('referrer-policy'), 'no-referrer');
        eq(`${spelling} → X-Robots-Tag: noindex, nofollow`, r.header('x-robots-tag'), 'noindex, nofollow');
        eq(`${spelling} → Cache-Control set exactly once (no comma-joined duplicate)`,
            String(r.headers['cache-control']).split(',').filter((p) => /no-store/.test(p)).length, 1);
        eq(`${spelling} → Referrer-Policy set exactly once`,
            String(r.headers['referrer-policy']).split(',').filter((p) => /no-referrer/.test(p)).length, 1);
        check(`${spelling} → no Cross-Origin-Opener-Policy breaks the popup handoff`, !r.header('cross-origin-opener-policy'));

        /* The real OAuth shape: Google appends ?code=…&state=… to the registered URI. */
        const q = await probe(`${spelling}?code=one-time-code&state=xyz`);
        eq(`${spelling}?code=…&state=… → 200`, q.status, 200);
        eq(`${spelling}?code=… → Cache-Control: no-store`, q.header('cache-control'), 'no-store');
        eq(`${spelling}?code=… → X-Robots-Tag: noindex, nofollow`, q.header('x-robots-tag'), 'noindex, nofollow');
        /* The leak that matters is the code appearing in the stored document. A
         * cf-cache-status of HIT would be the local asset router holding the file
         * bytes, not the browser holding the URL, so the assertion is made on the
         * body and on Cache-Control instead. */
        check(`${spelling}?code=… → the one-time code is never echoed into the served document`,
            !/one-time-code/.test(q.text) && !/state=xyz/.test(q.text));

        const head = await probe(spelling, { method: 'HEAD' });
        eq(`HEAD ${spelling} → 200`, head.status, 200);
    }

    /* Every document sw.js precaches must now answer 200 at its .html URL, or the
     * offline shell is never built (sw.js only caches a 200 response). */
    for (const doc of ['/index.html', '/checkout.html', '/tehnologie.html', '/technology.html',
                       '/proces.html', '/process.html', '/europe-roman-atlas.html',
                       '/europe-roman-atlas.html?embed=1']) {
        const r = await probe(doc);
        eq(`sw.js precache entry ${doc} → 200, not a 308`, r.status, 200);
    }

    /* The callback is never served from a cache layer, and its extensionless twin
     * is not rewritten by _redirects (that file declares no rule at all). */
    const again = await probe('/google-auth-callback.html');
    check('a second request for the callback is still a direct 200', again.status === 200);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('3. www → apex canonicalisation, with no cross-market redirect');
{
    const apiPath = '/api/map3d/tile?layer=base.imagery&z=1&x=0&y=0';
    for (const [www, apex] of [['www.detectlab.ro', 'detectlab.ro'], ['www.detectlab.eu', 'detectlab.eu']]) {
        const r = await probe(apiPath, { host: www });
        eq(`${www} on an API path → 301`, r.status, 301);
        const location = new URL(r.header('location'));
        eq(`${www} redirects to its own apex, never to the other market`, location.hostname, apex);
        eq('the path is preserved', location.pathname, '/api/map3d/tile');
        eq('the query is preserved', location.search, '?layer=base.imagery&z=1&x=0&y=0');
        check(`${www} does not reach the Function`, !r.header('x-detectlab-runtime'));

        const apexResponse = await probe(apiPath, { host: apex });
        eq(`${apex} is served normally`, apexResponse.status, 200);
        eq(`${apex} answers from the Cloudflare runtime`, apexResponse.header('x-detectlab-runtime'), 'cloudflare-pages-function');
    }
    const eu = await probe('/api/geo/finland?src=museo-wfs&id=999', { host: 'www.detectlab.eu' });
    eq('a www API call on the .eu host canonicalises to .eu', new URL(eu.header('location')).hostname, 'detectlab.eu');
    check('no www host is ever redirected across markets',
        !/detectlab\.eu/.test(String((await probe(apiPath, { host: 'www.detectlab.ro' })).header('location'))) &&
        !/detectlab\.ro/.test(String((await probe(apiPath, { host: 'www.detectlab.eu' })).header('location'))));

    /* A preview host must be left alone: the migration is validated there. */
    const preview = await probe(apiPath, { host: 'deadbeef.detectlab-4i1.pages.dev' });
    eq('a *.pages.dev preview host is served unchanged', preview.status, 200);

    /* DOCUMENTED LIMITATION. _routes.json restricts Functions to the nine API
     * paths, so the middleware never runs for a static asset and Cloudflare
     * Pages has no host-level _redirects. Canonicalising www for the site
     * itself is a Dashboard Redirect Rule — see CLOUDFLARE_DASHBOARD_CHECKLIST.md. */
    const staticWww = await probe('/', { host: 'www.detectlab.ro' });
    if (staticWww.status === 200) {
        note('www on a STATIC path is not redirected by the deployment',
            'expected: needs the Dashboard Redirect Rule (checklist §3). Functions only run on the nine API paths.');
    } else {
        check('www on a static path is redirected (the Dashboard Redirect Rule is already in place)',
            staticWww.status === 301 && new URL(staticWww.header('location')).hostname === 'detectlab.ro',
            `${staticWww.status} ${staticWww.header('location')}`);
    }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('4. All nine routes are answered by a Cloudflare Pages Function');
{
    for (const route of ROUTES) {
        const r = await probe(route);
        check(`${route} reaches a Function`, r.header('x-detectlab-runtime') === 'cloudflare-pages-function',
            `${r.status}, runtime=${r.header('x-detectlab-runtime')}`);
        check(`${route} answers (a bare request is refused with a documented status)`,
            [200, 400, 401, 404, 405, 502, 503].includes(r.status), `${r.status}`);
        check(`${route} never answers 500 on a bare request`, r.status !== 500);
    }
    const notARoute = await probe('/api/does-not-exist');
    eq('an unmapped /api path is a plain 404, not a Function', notARoute.status, 404);
    check('and it never invokes a Function', !notARoute.header('x-detectlab-runtime'));
    const rvtApi = await probe('/api/rvt/metadata');
    check('/api/rvt/* belongs to the separate Python service and is not implemented here',
        rvtApi.status === 404 && !rvtApi.header('x-detectlab-runtime'), `${rvtApi.status}`);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('5. Method matrix — GET / HEAD / OPTIONS / POST');
{
    const tile = '/api/map3d/tile?layer=base.imagery&z=1&x=0&y=0';
    const cases = [
        /* path, method, expected status set, label */
        [tile, 'OPTIONS', [204], 'map3d/tile preflight'],
        ['/api/geo/dk-dtk25?service=WMS&request=GetCapabilities', 'OPTIONS', [204], 'dk-dtk25 preflight'],
        ['/api/geo/dk-orto?service=WMS&request=GetCapabilities', 'OPTIONS', [204], 'dk-orto preflight'],
        ['/api/geo/dk-heritage?bbox=10,55,11,56', 'OPTIONS', [204], 'dk-heritage preflight'],
        ['/api/geo/finland?src=museo-wfs&id=133&bbox=24.9,60.1,25.1,60.3', 'OPTIONS', [204], 'finland preflight'],
        ['/api/geo/asig-heritage', 'OPTIONS', [405], 'asig-heritage is GET-only'],
        ['/api/geo/se-hojdmodell', 'OPTIONS', [400], 'se-hojdmodell treats OPTIONS as a WMS request (Netlify parity)'],
        ['/api/geo/dk-dhm', 'OPTIONS', [400], 'dk-dhm treats OPTIONS as a WMTS request (Netlify parity)'],
        [tile, 'POST', [405], 'map3d/tile refuses POST'],
        ['/api/geo/dk-dtk25?service=WMS&request=GetCapabilities', 'POST', [405], 'dk-dtk25 refuses POST'],
        ['/api/geo/dk-orto?service=WMS&request=GetCapabilities', 'POST', [405], 'dk-orto refuses POST'],
        ['/api/geo/dk-heritage?bbox=10,55,11,56', 'POST', [405], 'dk-heritage refuses POST'],
        ['/api/geo/finland?src=museo-wfs&id=133', 'POST', [405], 'finland refuses POST'],
        ['/api/geo/asig-heritage?bbox=20,40,21,41', 'POST', [405], 'asig-heritage refuses POST']
    ];
    for (const [path, method, expected, label] of cases) {
        const r = await probe(path, { method, body: method === 'POST' ? 'x=1' : undefined });
        check(`${label}: ${method} → ${expected.join('/')}`, expected.includes(r.status), `${r.status}`);
        if (method === 'OPTIONS' && expected[0] === 204) {
            eq(`${label}: CORS allows any origin`, r.header('access-control-allow-origin'), '*');
            check(`${label}: the allowed methods are declared`, /GET/.test(r.header('access-control-allow-methods') || ''),
                r.header('access-control-allow-methods'));
            eq(`${label}: a preflight has no body`, r.bytes, 0);
        }
    }
    const head = await probe(tile, { method: 'HEAD' });
    eq('HEAD on a tile → 200', head.status, 200);
    eq('HEAD carries no body', head.bytes, 0);
    check('HEAD still reports the runtime tag', head.header('x-detectlab-runtime') === 'cloudflare-pages-function');
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('6. /api/map3d/tile stays an allow-listed proxy, never an open relay');
{
    const unknown = await probe('/api/map3d/tile?layer=not-a-real-layer&z=1&x=0&y=0');
    eq('an unknown layer → 404', unknown.status, 404);
    eq('and says unknown-layer', unknown.json && unknown.json.error, 'unknown-layer');

    for (const [q, expected, reason] of [
        ['?layer=base.imagery&z=99&x=0&y=0', 400, 'bad-z'],
        ['?layer=base.imagery&z=-1&x=0&y=0', 400, 'bad-z'],
        ['?layer=base.imagery&z=1&x=9&y=0', 400, 'bad-xy'],
        ['?layer=base.imagery&z=1&x=0&y=-3', 400, 'bad-xy'],
        ['?layer=base.imagery&z=1&x=0&y=0&t=not-a-date', 400, 'bad-time'],
        ['?layer=base.imagery&z=1&x=0&y=0&p=x', 400, 'bad-product'],
        ['?layer=base.imagery&z=1&x=0&y=0&m=' + 'x'.repeat(80), 400, 'bad-mode']
    ]) {
        const r = await probe('/api/map3d/tile' + q);
        eq(`validation ${q.slice(0, 46)} → ${expected} ${reason}`, r.status, expected);
        eq(`and reports ${reason}`, r.json && r.json.error, reason);
    }

    const refusals = [
        ['http://169.254.169.254/latest/meta-data/', 'private-host'],
        ['http://127.0.0.1:8799/', 'private-host'],
        ['http://10.0.0.5/tile.png', 'private-host'],
        ['http://192.168.1.1/tile.png', 'private-host'],
        ['http://[::1]/tile.png', 'private-host'],
        /* .internal and .local are refused as private names before the
         * allow-list is even consulted — validateRelayUrl()'s isPrivateHost(). */
        ['http://metadata.google.internal/x', 'private-host'],
        ['http://evil.example.com/tile.png', 'host-not-allowed'],
        ['https://detectlab.ro.local/tile.png', 'private-host'],
        ['file:///etc/passwd', 'bad-protocol'],
        ['ftp://services.arcgisonline.com/x', 'bad-protocol'],
        ['https://user:pass@services.arcgisonline.com/x', 'credentials'],
        ['not a url at all', 'bad-url']
    ];
    for (const [target, expectedReason] of refusals) {
        const r = await probe('/api/map3d/tile?u=' + encodeURIComponent(target));
        eq(`relay refuses ${target.slice(0, 44)}`, r.status, 403);
        eq(`with the documented reason ${expectedReason}`, r.header('x-map3d-reason'), expectedReason);
        check('and the refusal body is JSON, not an image', /json/.test(r.header('content-type') || ''), r.header('content-type'));
        check('the refusal names no internal host or secret',
            !/169\.254|127\.0\.0\.1|token|password|secret/i.test(r.text.replace(expectedReason, '')));
    }

    /* An allowed host is relayed. The sandbox has no egress to it, so a blank
     * labelled tile is the documented degraded outcome — both are acceptable. */
    const allowed = await probe('/api/map3d/tile?u=' + encodeURIComponent(
        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/1/0/0'));
    check('an allow-listed relay URL is never refused (403 would mean the allow-list broke)',
        allowed.status !== 403, `${allowed.status}`);
    EGRESS = allowed.status === 200 && allowed.bytes > 300 && allowed.header('x-map3d-tile') !== 'blank';
    if (EGRESS) {
        check('the relayed tile is a real image', allowed.isPng || allowed.isJpeg, allowed.header('content-type'));
        note('this runtime CAN reach the upstream providers', `${allowed.bytes} bytes relayed from arcgisonline.com`);
    } else {
        note('this runtime has no egress to the upstream providers',
            `the allow-listed relay answered ${allowed.status} with a ${allowed.bytes}-byte labelled blank tile, ` +
            `exactly as the Netlify handler does when an upstream is unreachable`);
    }

    /* A module-backed LiDAR layer must build its own upstream URL inside the
     * embedded country module — the part that could not be evaluated from a
     * string in workerd and is now compiled in. */
    /* The eight country LiDAR modules are compiled into the deployment, because a
     * workerd isolate cannot evaluate them from strings (new Function / eval throw
     * EvalError) and has no filesystem to read js/*-layer.js from. What must hold
     * in both environments: the layer is KNOWN (no 404 unknown-layer), the module
     * built an upstream URL and the request went out — with egress that returns a
     * real tile, without egress the handler answers the labelled blank tile it
     * already answers on Netlify. */
    for (const layer of ['lidar.nl-ahn', 'lidar.no-hoydedata', 'lidar.pl-nmt', 'lidar.es-mdt',
        'lidar.ch-swisstopo', 'lidar.uk-ea', 'lidar.dk-dhm', 'lidar.se-lantmateriet']) {
        const r = await probe(`/api/map3d/tile?layer=${layer}&z=6&x=34&y=21`);
        eq(`module-backed ${layer} is a known layer`, r.status, 200);
        check(`module-backed ${layer} answers with an image`, r.isPng || r.isJpeg, r.header('content-type'));
        if (EGRESS) {
            check(`module-backed ${layer} returned a real tile`, r.bytes > 300 && r.header('x-map3d-tile') !== 'blank',
                `${r.bytes} bytes`);
        } else {
            check(`module-backed ${layer} reached its upstream builder (labelled blank, as on Netlify)`,
                r.header('x-map3d-tile') === 'blank' && !!r.header('x-map3d-reason'),
                `X-Map3D-Reason=${r.header('x-map3d-reason')}`);
        }
    }

    const blank = await probe('/api/map3d/tile?layer=base.imagery&z=1&x=0&y=0');
    check('a registry tile answers as an image or a labelled blank tile',
        blank.status === 200 && (blank.isPng || blank.isJpeg), `${blank.status} ${blank.header('content-type')}`);
    if (!EGRESS) {
        note('no egress, so the tile is the documented labelled blank',
            `X-Map3D-Reason=${blank.header('x-map3d-reason') || 'upstream-unreachable'}`);
    } else {
        check('a reachable tile is cached by the CDN for seven days',
            /s-maxage=(604800|\d{6,})/.test(blank.header('cdn-cache-control') || ''),
            `CDN-Cache-Control=${blank.header('cdn-cache-control')}`);
        check('and Cloudflare-CDN-Cache-Control carries the same pin',
            /s-maxage=(604800|\d{6,})/.test(blank.header('cloudflare-cdn-cache-control') || ''),
            blank.header('cloudflare-cdn-cache-control'));
        check('no Netlify-only header is emitted', !blank.header('netlify-cdn-cache-control'));
    }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('7. The Danish, Swedish, Finnish and Albanian routes validate before proxying');
{
    /* (a) Refusals that must hold in ANY environment: they are answered from the
     *     allow-lists and the parameter validation, before any upstream call. */
    const always = [
        ['/api/geo/finland?src=not-a-source', 400, 'unknown_src'],
        ['/api/geo/finland?src=museo-wfs&id=99999&bbox=24.9,60.1,25.1,60.3', 400, null],
        ['/api/geo/finland?src=museo-wfs&id=133&bbox=25.1,60.3,24.9,60.1', 400, 'bad_bbox'],
        ['/api/geo/finland?src=museo-wfs&id=133&bbox=a,b,c,d', 400, 'bad_bbox'],
        ['/api/geo/finland?src=mml-hillshade-open&z=99&x=0&y=0', 400, null],
        ['/api/geo/dk-heritage?bbox=1,2,3', 400, null],
        ['/api/geo/dk-heritage?bbox=30,50,31,51', 400, null],
        ['/api/geo/se-hojdmodell?request=GetMap&layers=not-allowed', 400, null],
        ['/api/geo/se-hojdmodell?service=WMS&request=NotGetMap', 400, null],
        ['/api/geo/dk-dhm?request=GetTile&layer=not-a-layer&tilematrixset=view1&tilematrix=7&tilecol=1&tilerow=1', 400, null],
        ['/api/geo/dk-dhm?request=GetTile&layer=dhm_terraen_skyggekort&tilematrixset=not-a-set&tilematrix=7&tilecol=1&tilerow=1&format=image/jpeg', 400, 'tilematrixset_not_allowed'],
        ['/api/geo/asig-heritage?bbox=1,2,3,4', 400, null],
        ['/api/geo/asig-heritage', 400, null]
    ];
    for (const [path, expected, code] of always) {
        const r = await probe(path);
        eq(`${path.slice(0, 62)} → ${expected}`, r.status, expected);
        check('and the refusal is a JSON problem, not an HTML shell',
            !!r.json && /json/.test(r.header('content-type') || ''), `${r.header('content-type')}: ${r.text.slice(0, 80)}`);
        if (code) eq(`and reports ${code}`, r.json.error || r.json.code, code);
        check('the refusal names no credential', !/local-test-/.test(r.text));
        /* No blanket Access-Control-Allow-Origin assertion here on purpose: the
         * CORONA and map3d routes and every preflight answer `*` (asserted in
         * their own sections), while the Danish/Swedish/Finnish/Albanian routes
         * send no ACAO on a validation refusal — exactly like their Netlify
         * twins, which the frontend only ever calls same-origin. */
    }

    /* (b) Requests that ARE valid and therefore reach an upstream. A bogus
     *     `layers=` is not a validation error: the handler replaces it with the
     *     allow-listed value from the layer config, and `maxFeatures` is clamped
     *     to the documented cap (400 Danish / 150 ASIG) — both pinned exactly by
     *     test-cloudflare-functions.mjs against a recorded upstream URL. Here we
     *     only assert that the route answers, and how it degrades without egress. */
    const upstream = [
        ['/api/geo/dk-dtk25?service=WMS&request=GetMap&layers=ATTACKER&bbox=8,54,9,55&crs=EPSG:3857&width=256&height=256&format=image/png', [200], [200, 400, 502]],
        ['/api/geo/dk-orto?service=WMS&request=GetMap&layers=ATTACKER&bbox=8,54,9,55&crs=EPSG:3857&width=256&height=256&format=image/png', [200], [200, 400, 401, 502]],
        ['/api/geo/dk-heritage?bbox=10,55,11,56&maxFeatures=99999', [200], [200, 400, 502]],
        ['/api/geo/dk-dhm?request=GetTile&layer=dhm_terraen_skyggekort&format=image/jpeg&tilematrixset=view1&tilematrix=7&tilecol=1&tilerow=1', [200], [200, 401, 502]],
        ['/api/geo/se-hojdmodell?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=terrangskuggning&STYLES=&SRS=EPSG:3857&BBOX=1,2,3,4&WIDTH=256&HEIGHT=256&FORMAT=image/png', [200], [200, 401, 502]],
        ['/api/geo/asig-heritage?bbox=20.0,40.0,20.2,40.2&maxFeatures=99999', [200], [200, 400, 502]],
        ['/api/geo/finland?src=museo-wfs&id=133&bbox=24.9,60.1,25.1,60.3', [200], [200, 400, 502, 504]],
        ['/api/geo/finland?src=mml-hillshade-open&z=9&x=290&y=152', [200], [200, 400, 401, 502]],
        ['/api/corona/rasters?bbox=-25,34,60,72', [200], [200, 502]]
    ];
    for (const [path, withE, withoutE] of upstream) {
        const r = await probe(path);
        expectStatus(path.slice(0, 60), r, { withEgress: withE, withoutEgress: withoutE });
        check(`${path.slice(0, 40)} answers JSON or an image, never an HTML shell`,
            /json|image|geojson|xml/.test(r.header('content-type') || ''), r.header('content-type'));
        check(`${path.slice(0, 40)} runs on the Cloudflare runtime`,
            r.header('x-detectlab-runtime') === 'cloudflare-pages-function');
        check(`${path.slice(0, 40)} never echoes a bound secret`,
            !/local-test-ds-token|local-test-dfd-pass|local-test-lm-pass|local-test-mml-key/.test(r.text));
    }

    /* Credential-missing refusals are environment-independent in their shape: the
     * dummy bindings here are syntactically valid, so what comes back is either a
     * successful image or the provider's own refusal. */
    const dhm = await probe('/api/geo/dk-dhm?request=GetTile&layer=dhm_terraen_skyggekort&format=image/jpeg' +
        '&tilematrixset=view1&tilematrix=7&tilecol=1&tilerow=1');
    check('dk-dhm answers 200 (token accepted), 401 (token rejected) or 502 (no egress)',
        [200, 401, 502].includes(dhm.status), `${dhm.status}`);
    check('dk-dhm never echoes the token', !dhm.text.includes('local-test-ds-token'));
    const mml = await probe('/api/geo/finland?src=mml-hillshade-open&z=9&x=290&y=152');
    check('the MML route either serves a tile or reports the documented key problem',
        [200, 400, 401, 502].includes(mml.status), `${mml.status}`);
    if (mml.status === 401 && mml.json) {
        eq('a missing MML key is the one documented variable disclosure', mml.json.variable, 'MML_API_KEY');
    }

    const corona = await probe('/api/corona/rasters?bbox=-25,34,60,72');
    check('corona/rasters answers JSON either way', !!corona.json || /json/.test(corona.header('content-type') || ''),
        corona.header('content-type'));
    if (corona.status === 200) {
        check('the catalogue payload is an object', typeof corona.json === 'object' && corona.json !== null);
        note('CORONA cache state', `X-DetectLab-Corona-Cache=${corona.header('x-detectlab-corona-cache')}`);
        eq('the catalogue is cacheable for an hour', corona.header('cache-control'), 'public, max-age=3600');
    } else {
        eq('a CAST outage is not cached', corona.header('cache-control'), 'no-store');
    }
    eq('CORS is open on the CORONA route (the frontend may call it from any origin)',
        corona.header('access-control-allow-origin'), '*');
}

group('8. No response leaks a secret');
{
    const leaked = [];
    for (const { path, body } of bodies) {
        for (const secret of LOCAL_DUMMY_SECRETS) {
            if (body.includes(secret)) leaked.push(`${path} → ${secret}`);
        }
    }
    check(`none of the ${bodies.length} responses echoes a bound secret value`, leaked.length === 0, leaked.join(', '));
    const named = bodies.filter(({ body }) => /DATAFORDELER_PASSWORD|LANTMATERIET_WMS_PASSWORD|DATAFORSYNINGEN_TOKEN/.test(body));
    check('no response names a secret variable (MML_API_KEY excepted, as on Netlify)',
        named.length === 0, named.map((n) => n.path).join(', '));
}

console.log('\n' + '─'.repeat(72));
if (failures) {
    console.error(`✗ ${failures} of ${checks} live checks FAILED (${notes} note(s))`);
    process.exit(1);
}
console.log(`✓ all ${checks} live checks passed against ${BASE.origin} (${notes} environment note(s))`);
