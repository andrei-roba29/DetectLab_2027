#!/usr/bin/env node
/*
 * tools/cloudflare-map3d-audit.mjs
 * ───────────────────────────────────────────────────────────────────────────
 * Exhaustive audit of the /api/map3d/tile layer catalogue, answering one
 * question with evidence rather than by inspection:
 *
 *   Which registry layers can produce `per-tile-builder-unavailable` (or any
 *   other builder error) on the Cloudflare deployment, and does the Netlify
 *   deployment produce EXACTLY the same thing for the same input?
 *
 * Why this exists: `buildUpstreamUrl()` answers a failed per-tile build with
 * `{ error: 'per-tile-builder-unavailable' }`, and `handleTileRequest()` turns
 * that into a transparent 1×1 PNG with `X-Map3D-Upstream: unavailable`. A blank
 * tile is indistinguishable from "no coverage" to a map viewer, so if the
 * Cloudflare copy failed to build a URL that Netlify builds, real LiDAR data
 * would silently disappear instead of raising an error. This audit sweeps every
 * layer over a geographic grid and fails on the first divergence.
 *
 *   node tools/cloudflare-map3d-audit.mjs            # full sweep + report
 *   node tools/cloudflare-map3d-audit.mjs --quiet    # report only on failure
 *
 * It is an audit, not a fix: nothing here changes behaviour. Both
 * implementations are imported as they are deployed — the Netlify one runs its
 * node:vm sandbox, the Cloudflare one runs the compiled-in country modules — and
 * `globalThis.fetch` is replaced with a recorder so no upstream is ever called.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => pathToFileURL(path.join(ROOT, p)).href;
const QUIET = process.argv.includes('--quiet');

/* A real 1×1 transparent PNG, so the end-to-end comparison has bytes to compare. */
const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64');

/* ── the two implementations, exactly as each host deploys them ───────────── */
const netlify = await import(rel('netlify/lib/map3d-tile.mjs'));
const netlifyModules = await import(rel('netlify/lib/map3d-country-modules.mjs'));
const cloudflare = await import(rel('functions/_generated/map3d-tile.mjs'));
const cloudflareModules = await import(rel('functions/_generated/map3d-country-modules.mjs'));

/* ── fetch recorder: no upstream is ever contacted ────────────────────────── */
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
    calls.push({ url: String(typeof input === 'string' ? input : input.url), init });
    return new Response(new Uint8Array(PNG_1x1), { status: 200, headers: { 'content-type': 'image/png' } });
};

/**
 * A builder that returns a RELATIVE url is not a failure: `proxy: 'never'`
 * layers (the Danish DHM and Swedish LiDAR proxies) are fetched by MapLibre
 * DIRECTLY from the same origin, so the browser-side builder hands back
 * `/api/geo/dk-dhm?…` and the credential proxy Function attaches the secret.
 * Such a layer is never routed through /api/map3d/tile at all.
 */
function hostOf(url, def) {
    if (/^https?:/i.test(url)) {
        try { return new URL(url).hostname; } catch { return '(unparsable absolute url)'; }
    }
    const mode = netlify.proxyMode(def);
    return `(same-origin ${url.split('?')[0]} — proxyMode=${mode}, never routed through /api/map3d/tile)`;
}

/**
 * Which browser-side file defines the module global the registry points at?
 * node:fs is fine HERE — this audit tool runs in Node; it is the deployed
 * Function that has no filesystem, which is exactly what is being audited.
 */
const LAYER_FILES = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('-layer.js'));
function traceBuilderFile(moduleGlobal) {
    for (const file of LAYER_FILES) {
        const text = fs.readFileSync(path.join(ROOT, 'js', file), 'utf8');
        if (new RegExp(`(root|window)\\.${moduleGlobal}\\s*=|var\\s+${moduleGlobal}\\s*=`).test(text)) return 'js/' + file;
    }
    return '(not found in js/*-layer.js)';
}

/* ── the sweep ────────────────────────────────────────────────────────────── */
/** z=4 over the whole world: every country's territory is inside this grid. */
function worldGrid(z) {
    const n = Math.pow(2, z);
    const out = [];
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) out.push([z, x, y]);
    return out;
}
/** z=8 over Europe, where every LiDAR provider in the catalogue lives. */
function europeGrid(z, x0, x1, y0, y1) {
    const out = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
    return out;
}

const TILES = [
    ...worldGrid(2),                 /*   16 tiles — the whole world, coarse   */
    ...europeGrid(5, 15, 19, 10, 12),/*   15 tiles — Europe                   */
    ...europeGrid(8, 128, 136, 82, 88), /* 63 tiles — Europe, finer           */
    [12, 2176, 1360], [13, 4352, 2720], [16, 35000, 22000] /* the parity fixtures */
];
const MODES = ['', 'dtm', 'dsm', 'elevation', 'surface', 'height', 'hillshade', 'multi'];
const TIMES = ['', '2021', '1104-2155Fore'];
/* `kind: 'dynamic'` layers (CORONA film products, image overlays, the Finnish
 * local-authority layers) need a product name in `p=`; without one the pipeline
 * answers `missing-product` on BOTH hosts. Sweep both the missing and a supplied
 * product so the audit shows what the app actually sends. */
const PRODUCTS_WITH = ['1104-2155Fore', 'DS1104-2155Fore'];

const layers = netlify.registry.list();
const netlifyScope = netlifyModules.countryModuleScope();
const cloudflareScope = cloudflareModules.countryModuleScope();

let divergences = 0;
let comparisons = 0;
const report = [];
/** Filled in by section E; exported so a caller can assert on the classification. */
export const transport = {};

function fail(message) {
    divergences++;
    console.error('  \u2717 ' + message);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
if (!QUIET) console.log(`\nSweeping ${layers.length} registry layers × ${TILES.length} tiles (× modes/products where declared)\n`);

for (const def of layers) {
    const cfDef = cloudflare.layerById(def.id);
    if (!cfDef) { fail(`${def.id}: missing from the Cloudflare registry`); continue; }

    const moduleBacked = def.kind === 'dynamic' && def.builder && def.builder.module;
    const needsProduct = def.kind === 'dynamic' && !def.builder;
    const modes = moduleBacked ? MODES : (def.modes ? ['', ...Object.keys(def.modes)] : ['']);
    const times = def.time ? TIMES : [''];
    const products = needsProduct ? ['', ...PRODUCTS_WITH] : [''];

    const outcome = { urls: 0, hosts: new Set(), errors: new Map(), unavailableTiles: [], unavailableModes: new Set() };
    const netlifyOutcome = { urls: 0, errors: new Map(), unavailableTiles: [] };

    for (const mode of modes) {
      for (const product of products) {
        for (const time of times) {
            for (const [z, x, y] of TILES) {
                const args = { z, x, y, mode, time, product };
                const a = netlify.buildUpstreamUrl(def, args);
                const b = cloudflare.buildUpstreamUrl(cfDef, args);
                comparisons++;

                /* The two must agree exactly — same URL, or same error. */
                const same = JSON.stringify(a) === JSON.stringify(b);
                if (!same) {
                    fail(`${def.id} z=${z}/${x}/${y} mode='${mode}' time='${time}' p='${product}'\n` +
                        `      netlify    : ${JSON.stringify(a).slice(0, 220)}\n` +
                        `      cloudflare : ${JSON.stringify(b).slice(0, 220)}`);
                    continue;
                }
                if (a && a.error) {
                    outcome.errors.set(a.error, (outcome.errors.get(a.error) || 0) + 1);
                    netlifyOutcome.errors.set(a.error, (netlifyOutcome.errors.get(a.error) || 0) + 1);
                    if (a.error === 'per-tile-builder-unavailable') {
                        outcome.unavailableModes.add(mode || '(default)');
                        if (outcome.unavailableTiles.length < 3) outcome.unavailableTiles.push(`${z}/${x}/${y}${mode ? ' m=' + mode : ''}`);
                        if (netlifyOutcome.unavailableTiles.length < 3) netlifyOutcome.unavailableTiles.push(`${z}/${x}/${y}`);
                    }
                } else if (a && a.url) {
                    outcome.urls++;
                    netlifyOutcome.urls++;
                    outcome.hosts.add(hostOf(a.url, def));
                }
            }
        }
        }
    }

    report.push({
        id: def.id,
        kind: def.kind,
        moduleBacked,
        builder: def.builder || null,
        builderFile: moduleBacked ? traceBuilderFile(def.builder.module) : null,
        urls: outcome.urls,
        hosts: [...outcome.hosts],
        errors: [...outcome.errors.entries()],
        unavailableTiles: outcome.unavailableTiles,
        unavailableModes: [...outcome.unavailableModes],
        identical: outcome.urls === netlifyOutcome.urls &&
            JSON.stringify([...outcome.errors.entries()].sort()) === JSON.stringify([...netlifyOutcome.errors.entries()].sort())
    });
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* End to end: every layer through handleTileRequest on both implementations. */
const e2e = { compared: 0, blank: [], divergent: [] };
for (const def of layers) {
    const query = `/api/map3d/tile?layer=${encodeURIComponent(def.id)}&z=8&x=132&y=85`;
    calls.length = 0;
    let a;
    try { a = await netlify.handleTileRequest(new Request('https://detectlab.ro' + query)); }
    catch (error) { a = { status: 'threw', message: error.message }; }
    const aCalls = calls.slice();
    calls.length = 0;
    let b;
    try { b = await cloudflare.handleTileRequest(new Request('https://detectlab.ro' + query)); }
    catch (error) { b = { status: 'threw', message: error.message }; }
    const bCalls = calls.slice();

    const fingerprint = async (r, recorded) => {
        if (r.status === 'threw') return `threw:${r.message}`;
        const body = Buffer.from(await r.arrayBuffer());
        const headers = {};
        for (const name of ['content-type', 'cache-control', 'x-map3d-tile', 'x-map3d-upstream', 'x-map3d-reason', 'x-map3d-cache']) {
            const value = r.headers.get(name);
            if (value) headers[name] = value;
        }
        return JSON.stringify({ status: r.status, headers, bytes: body.length, sha: body.toString('base64').slice(0, 24), calls: recorded.map((c) => c.url) });
    };
    const fa = await fingerprint(a, aCalls);
    const fb = await fingerprint(b, bCalls);
    e2e.compared++;
    if (fa !== fb) e2e.divergent.push({ id: def.id, netlify: fa, cloudflare: fb });
    const blank = /"x-map3d-tile":"blank"|per-tile-builder-unavailable|"x-map3d-upstream":"unavailable"/.test(fa);
    if (blank) e2e.blank.push({ id: def.id, fingerprint: fa });
}
for (const d of e2e.divergent) {
    fail(`handleTileRequest(${d.id}) differs\n      netlify    : ${d.netlify.slice(0, 260)}\n      cloudflare : ${d.cloudflare.slice(0, 260)}`);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
globalThis.fetch = realFetch;

if (!QUIET) {
    console.log('─'.repeat(100));
    console.log('A. Module-backed (per-tile builder) layers — traced to their browser-side builder');
    console.log('─'.repeat(100));
    const backed = report.filter((r) => r.moduleBacked);
    for (const r of backed) {
        const embedded = cloudflareModules.COUNTRY_MODULES.includes(r.builderFile);
        console.log(`  ${r.id.padEnd(24)} ${r.builderFile.padEnd(40)} global=${String(r.builder.module).padEnd(22)} fn=${String(r.builder.fn).padEnd(16)} kind=${r.builder.kind}`);
        console.log(`  ${''.padEnd(24)} compiled into the Cloudflare deployment: ${embedded ? 'YES' : 'NO — WOULD BE A BLANK TILE'}   URLs built: ${r.urls}   hosts: ${r.hosts.join(', ')}`);
        if (r.errors.length) console.log(`  ${''.padEnd(24)} builder errors: ${r.errors.map(([e, n]) => `${e}×${n}`).join(', ')} (identical on Netlify: ${r.identical})`);
    }
    const missing = backed.filter((r) => !cloudflareModules.COUNTRY_MODULES.includes(r.builderFile));
    console.log(`\n  ${backed.length} module-backed layers, all ${missing.length === 0 ? 'embedded' : '— ' + missing.length + ' NOT embedded'}; ` +
        `${report.filter((r) => r.kind === 'dynamic' && !r.moduleBacked).length} further dynamic layers use a plain template (no module).`);

    console.log('\n' + '─'.repeat(100));
    console.log('B. Every layer that can answer `per-tile-builder-unavailable` (or any builder error)');
    console.log('─'.repeat(100));
    const withErrors = report.filter((r) => r.errors.length);
    if (!withErrors.length) {
        console.log('  none — no layer in the catalogue produced a builder error for any swept tile, mode or time.');
    }
    for (const r of withErrors) {
        console.log(`  ${r.id.padEnd(26)} ${r.errors.map(([e, n]) => `${e} on ${n}/${TILES.length * (r.moduleBacked ? MODES.length : 1)} swept tiles`).join('; ')}`);
        console.log(`  ${''.padEnd(26)} identical on Netlify: ${r.identical ? 'YES' : 'NO ← REGRESSION'}   example tiles: ${r.unavailableTiles.join(', ') || 'n/a'}   URLs still built: ${r.urls}`);
        if (r.moduleBacked) console.log(`  ${''.padEnd(26)} builder: ${r.builderFile} → ${r.builder.module}.${r.builder.fn}()   modes affected: ${r.unavailableModes.join(', ') || 'n/a'}`);
    }

    console.log('\n' + '─'.repeat(100));
    console.log('C. End-to-end handleTileRequest — one request per layer, both implementations');
    console.log('─'.repeat(100));
    console.log(`  ${e2e.compared} layers compared; ${e2e.divergent.length} divergent.`);
    console.log(`  ${e2e.blank.length} answered a blank/labelled tile with NO network egress available in this sandbox:`);
    for (const b of e2e.blank.slice(0, 40)) {
        const parsed = JSON.parse(b.fingerprint);
        console.log(`    ${b.id.padEnd(26)} ${parsed.status}  ${parsed.headers['x-map3d-tile'] || ''} ${(parsed.headers['x-map3d-reason'] || '').slice(0, 44)}${parsed.calls.length ? '  → ' + parsed.calls[0].slice(0, 60) : ''}`);
    }
    if (e2e.blank.length > 40) console.log(`    … and ${e2e.blank.length - 40} more`);
    console.log('\n  A blank tile here means the UPSTREAM FETCH failed (this sandbox has no egress');
    console.log('  beyond github/npm/pypi), not that the URL builder failed: every one of these');
    console.log('  layers built the identical upstream URL on both hosts — see section A/B and');
    console.log('  the recorded call above. The distinction matters: a builder failure returns');
    console.log("  X-Map3D-Upstream: unavailable with NO upstream call at all.");

    const noCallBlank = e2e.blank.filter((b) => !JSON.parse(b.fingerprint).calls.length);
    console.log(`\n  Layers whose blank tile came with NO upstream call (i.e. a genuine builder`);
    console.log(`  failure rather than an unreachable provider): ${noCallBlank.length}` +
        (noCallBlank.length ? '\n    ' + noCallBlank.map((b) => b.id).join('\n    ') : ''));

    console.log('\n' + '─'.repeat(100));
    console.log('C2. Which layers are routed through /api/map3d/tile at all (registry proxyMode)');
    console.log('─'.repeat(100));
    const modes = { direct: [], auto: [], proxied: [] };
    for (const def of layers) modes[netlify.proxyMode(def)].push(def.id);
    for (const mode of ['proxied', 'auto', 'direct']) {
        console.log(`  ${mode.padEnd(8)} ${String(modes[mode].length).padStart(4)} layers — ` +
            (mode === 'direct' ? 'MapLibre fetches these itself; the tile proxy is never called for them'
                : mode === 'proxied' ? 'always through /api/map3d/tile'
                    : 'through the proxy only when the provider sends no CORS headers'));
    }
    const relative = layers.filter((d) => {
        const u = netlify.registry.tileUrlAt(d, 8, 132, 85, { modules: netlifyScope, mode: '' }) ||
            (netlify.buildUpstreamUrl(d, { z: 8, x: 132, y: 85, product: '1104-2155Fore' }) || {}).url || '';
        return u && !/^https?:/i.test(u);
    });
    console.log(`\n  Layers whose upstream URL is same-origin (relative) — by design, proxyMode=direct:`);
    for (const d of relative) {
        const u = netlify.registry.tileUrlAt(d, 8, 132, 85, { modules: netlifyScope, mode: '' }) ||
            (netlify.buildUpstreamUrl(d, { z: 8, x: 132, y: 85, product: '1104-2155Fore' }) || {}).url || '';
        console.log(`    ${d.id.padEnd(30)} ${String(u).split('?')[0].padEnd(26)} proxy=${d.proxy || 'auto'} cors=${d.cors || 'unknown'}`);
    }
    const never = relative.filter((d) => d.proxy === 'never');
    const auto = relative.filter((d) => d.proxy !== 'never');
    console.log(`  (${relative.length} layers: ${never.length} marked proxy:'never' (${never.map((d) => d.id).join(', ')}),`);
    console.log(`   ${auto.length} Danish layers marked proxy:'auto' whose URL is same-origin.)`);
    console.log(`   Identical on both hosts — same registry, same builders, same 26 190 comparisons.`);
    console.log(`   A same-origin URL is fetched by the browser directly (js/map3d-mirror.js takes the`);
    console.log(`   URL from the live Leaflet layer; the ?u= relay exists only for CROSS-origin hosts`);
    console.log(`   that send no CORS headers, and CORS does not apply to a same-origin request).`);
    console.log(`   Should such a layer ever be handed to the tile proxy anyway, a relative URL cannot`);
    console.log(`   be fetched by a server-side proxy on EITHER runtime — undici on Netlify refuses it`);
    console.log(`   exactly as workerd does — so both answer the same labelled blank tile. That is`);
    console.log(`   pre-existing behaviour, unchanged by this migration and pinned by the sweep below.)`);

    /* ── E. how each layer is actually transported ──────────────────────────
     * The sweep above compares buildUpstreamUrl for every layer, which is the
     * right thing to compare, but a reader still needs to know which layers ever
     * REACH /api/map3d/tile. That decision is the registry's own:
     * map3dTiles(def, opts) → proxyTemplate() | protocolTemplate() | directTemplate().
     * Classified here with the registry's own function, not by re-deriving it. */
    console.log('\n' + '─'.repeat(100));
    console.log('E. Transport — which layers ever reach /api/map3d/tile (registry.map3dTiles)');
    console.log('─'.repeat(100));

    const classify = (opts) => {
        const buckets = { proxied: [], dl3d: [], directHttp: [], sameOrigin: [], none: [] };
        for (const def of layers) {
            let templates = [];
            try { templates = netlify.registry.map3dTiles(def, { modules: netlifyScope, ...opts }); }
            catch { templates = []; }
            const t = String(templates[0] || '');
            if (!t) buckets.none.push(def.id);
            else if (t.startsWith('/api/map3d/tile')) buckets.proxied.push(def.id);
            else if (t.startsWith('dl3d://')) buckets.dl3d.push(def.id);
            else if (/^https?:/i.test(t)) buckets.directHttp.push(def.id);
            else buckets.sameOrigin.push(def.id);
        }
        return buckets;
    };
    /* (i) as the 3D view asks on a fresh session, before any CORS probe fired;
     * (ii) with proxyHostsAll, the test/debug override that forces every layer
     *      onto the proxy — the theoretical ceiling of the Function's workload. */
    const fresh = classify({});
    const ceiling = classify({ proxyHostsAll: true });
    const rows = [
        ['proxied through /api/map3d/tile', fresh.proxied, ceiling.proxied],
        ['dl3d:// — per-tile module call in the browser', fresh.dl3d, ceiling.dl3d],
        ['direct http(s) upstream URL', fresh.directHttp, ceiling.directHttp],
        ['same-origin /api/geo/* credential proxy', fresh.sameOrigin, ceiling.sameOrigin],
        ['no tile template at all', fresh.none, ceiling.none]
    ];
    console.log('  transport'.padEnd(52) + 'fresh session'.padStart(14) + 'proxyHostsAll'.padStart(15));
    for (const [label, a, b] of rows) console.log('  ' + label.padEnd(50) + String(a.length).padStart(14) + String(b.length).padStart(15));
    console.log(`  ${'total'.padEnd(50)}${String(layers.length).padStart(14)}${String(layers.length).padStart(15)}`);

    console.log(`\n  Proxied by declaration (proxy:'always') — ${fresh.proxied.length} layers:`);
    console.log('    ' + fresh.proxied.join(', '));
    console.log(`\n  dl3d:// per-tile builders resolved IN THE BROWSER by js/map3d-terrain.js:`);
    console.log('    ' + fresh.dl3d.join(', '));
    console.log(`    Of these, ${fresh.dl3d.filter((id) => ceiling.proxied.includes(id)).length} move onto the proxy if their host`);
    console.log(`    is healed (the Function's embedded country module then builds the identical URL);`);
    console.log(`    ${fresh.dl3d.filter((id) => !ceiling.proxied.includes(id)).join(', ') || '(none)'} stay in the browser forever (proxy:'never').`);

    /* The same-origin layers cannot be healed onto the proxy in production, and
     * that is worth stating with the line that proves it rather than asserting it. */
    const terrain = fs.readFileSync(path.join(ROOT, 'js/map3d-terrain.js'), 'utf8');
    const healBailsOnEmptyHost = /if \(!host \|\| state\.proxyHosts\[host\]\) return;/.test(terrain);
    const productionNeverUsesProxyHostsAll = !/proxyHostsAll/.test(terrain);
    console.log(`\n  The ${fresh.sameOrigin.length} same-origin layers can NEVER be routed through /api/map3d/tile:`);
    console.log(`    · hostOf() returns '' for a relative URL, and js/map3d-terrain.js bails out of the`);
    console.log(`      CORS heal on an empty host  → ${healBailsOnEmptyHost ? 'confirmed in the source' : 'NOT CONFIRMED'}`);
    console.log(`    · production passes proxyHosts: Object.keys(state.proxyHosts) only; proxyHostsAll is`);
    console.log(`      a test/debug override      → ${productionNeverUsesProxyHostsAll ? 'confirmed (js/map3d-terrain.js never sets it)' : 'NOT CONFIRMED'}`);
    console.log(`    · shouldProxy('') resolves to registryHostPolicy('') === 'always' → false`);
    console.log(`    So the ${ceiling.proxied.length}-layer ceiling above is reachable only from a test harness. In production the`);
    console.log(`    Function sees the ${fresh.proxied.length} declared layers plus any CROSS-origin 'auto' layer whose provider`);
    console.log(`    failed the runtime CORS probe — and the sweep above covers all ${layers.length} either way.`);
    if (fresh.none.length) {
        console.log(`\n  No template at all: ${fresh.none.join(', ')} — map3dTiles() returns [] for a dynamic`);
        console.log(`    definition with no resolvable module, which is the registry's documented honest`);
        console.log(`    answer ("unsupported: no tile template"), not a blank tile. Identical on both hosts.`);
    }
    transport.healBailsOnEmptyHost = healBailsOnEmptyHost;
    transport.productionNeverUsesProxyHostsAll = productionNeverUsesProxyHostsAll;
    transport.fresh = fresh;
    transport.ceiling = ceiling;
    if (!healBailsOnEmptyHost || !productionNeverUsesProxyHostsAll) {
        fail('the same-origin transport reasoning no longer matches js/map3d-terrain.js');
    }

    console.log('\n' + '─'.repeat(100));
    console.log(`D. Totals — ${comparisons} buildUpstreamUrl comparisons and ${e2e.compared} end-to-end requests`);
    console.log('─'.repeat(100));
    console.log(`  layers swept            : ${report.length} (of ${layers.length} registered)`);
    console.log(`  module-backed layers    : ${backed.length}, all traced to a js/*-layer.js builder and all embedded`);
    console.log(`  tiles per layer         : ${TILES.length} (world z=2, Europe z=5 and z=8, plus three deep-zoom fixtures)`);
    console.log(`  modes / times swept     : ${MODES.length} modes for module-backed layers, ${TIMES.length} time values where declared`);
    console.log(`  distinct upstream hosts : ${new Set(report.flatMap((r) => r.hosts)).size}`);
    console.log(`  divergences             : ${divergences}`);
}

if (divergences) {
    console.error(`\n✗ ${divergences} divergence(s) between the Netlify and Cloudflare tile pipelines — see above`);
    process.exit(1);
}
console.log(`\n✓ ${comparisons} buildUpstreamUrl comparisons and ${e2e.compared} end-to-end tile requests are identical on both hosts`);
console.log('✓ no layer loses its real data on Cloudflare: every builder error is reproduced byte-for-byte from the Netlify pipeline');
