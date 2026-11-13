#!/usr/bin/env node
/*
 * tools/sync-cloudflare-generated.mjs
 * ───────────────────────────────────────────────────────────────────────────
 * Generates the Cloudflare-Workers-compatible copies of the three server
 * modules that cannot run in the Workers runtime as they are written:
 *
 *   source (untouched)                              generated copy
 *   ─────────────────────────────────────────────   ──────────────────────────────────────────────────
 *   netlify/lib/map3d-country-modules.mjs        →  functions/_generated/map3d-country-modules.mjs
 *   netlify/lib/map3d-tile.mjs                   →  functions/_generated/map3d-tile.mjs
 *   backend/src/lib/finland-geo.mjs              →  functions/_generated/finland-geo.mjs
 *
 * WHY A GENERATED COPY INSTEAD OF AN IMPORT
 *   The Cloudflare Workers runtime (verified on workerd 2026-11-10, the binary
 *   wrangler 4.161 ships) has:
 *     • no filesystem            → node:fs, createRequire(path), import.meta.url
 *                                  file lookups cannot work;
 *     • no node:vm               → the country-module sandbox cannot exist;
 *     • no dynamic codegen       → `new Function(...)` throws
 *                                  "EvalError: Code generation from strings
 *                                   disallowed for this context", so the module
 *                                  sources cannot be evaluated from strings
 *                                  either;
 *     • no node: prefixed imports → importing `node:module`/`node:path`/
 *                                  `node:url`/`node:vm` fails the bundle
 *                                  unless `nodejs_compat` is enabled, and even
 *                                  with it createRequire() still cannot read a
 *                                  file that does not exist in the isolate.
 *   This project deliberately does NOT enable `nodejs_compat`, so the three
 *   modules are transformed mechanically instead.
 *
 * NOTHING IS REWRITTEN BY HAND
 *   Each generated copy is the source file verbatim, with a small number of
 *   exactly-anchored spans swapped for their Workers equivalent (the anchors
 *   are asserted to occur exactly once — the tool fails loudly if the source
 *   ever changes shape). All the allow-lists, the tile maths, the CRS
 *   transforms, the cache policy, the upstream tables and the credential
 *   handling stay owned by the original file. `--check` (run by the test suite
 *   and by every Cloudflare build) fails on any drift, exactly like the
 *   existing tools/sync-danish-config.mjs / tools/sync-finland-config.mjs.
 *
 *   node tools/sync-cloudflare-generated.mjs            # write the copies
 *   node tools/sync-cloudflare-generated.mjs --check    # exit 1 if out of date
 *   node tools/sync-cloudflare-generated.mjs --verify   # also diff the two
 *                                                       # implementations at
 *                                                       # runtime (default on
 *                                                       # when writing)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'functions/_generated');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ── anchored text surgery helpers ────────────────────────────────────────── */

function countOf(haystack, needle) {
    let n = 0;
    let i = haystack.indexOf(needle);
    while (i !== -1) { n++; i = haystack.indexOf(needle, i + needle.length); }
    return n;
}

/** Replace the whole span between two unique markers (both included). */
function replaceSpan(src, startMarker, endMarker, replacement, label) {
    const starts = countOf(src, startMarker);
    if (starts !== 1) fail(`${label}: start marker occurs ${starts}× (expected exactly 1)`);
    const from = src.indexOf(startMarker);
    const tail = src.slice(from + startMarker.length);
    const ends = countOf(tail, endMarker);
    if (ends !== 1) fail(`${label}: end marker occurs ${ends}× after the start marker (expected exactly 1)`);
    const to = from + startMarker.length + tail.indexOf(endMarker) + endMarker.length;
    return src.slice(0, from) + replacement + src.slice(to);
}

/** Replace one exact substring, asserting it occurs exactly once. */
function replaceOnce(src, find, replacement, label) {
    const n = countOf(src, find);
    if (n !== 1) fail(`${label}: anchor occurs ${n}× (expected exactly 1)`);
    return src.replace(find, replacement);
}

function fail(message) {
    throw new Error('[sync-cloudflare-generated] ' + message);
}

/**
 * Guard: the generated copy must not import or call anything the Workers
 * runtime lacks. Only real statements are inspected — the generated header and
 * the inline comments legitimately mention node:vm and friends to explain why
 * they are gone.
 */
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))   /* block comments → blank, lines kept */
        .split('\n')
        .map((line) => {
            /* a // comment, unless the // is inside a string or a URL */
            const cut = line.search(/(^|[^:'"`\\])\/\//);
            return cut === -1 ? line : line.slice(0, cut + 1);
        })
        .join('\n');
}

function assertNoNodeRuntime(src, label) {
    const code = stripComments(src);
    const offenders = code.split('\n').filter((line) => /\bfrom\s+['"]node:/.test(line)
        || /\bimport\s*\(\s*['"]node:/.test(line)
        || /\brequire\s*\(\s*['"]node:/.test(line)
        || /\bcreateRequire\b/.test(line)
        || /\bvm\.(createContext|runInContext|Script)\b/.test(line)
        || /\bfs\.(readFileSync|existsSync|writeFileSync|promises)\b/.test(line)
        || /\bfileURLToPath\b/.test(line)
        || /\b__dirname\b|\bimport\.meta\.url\b/.test(line));
    if (offenders.length) {
        fail(label + ': Node-only runtime code survived the transform:\n    ' + offenders.join('\n    '));
    }
    return code;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  1. netlify/lib/map3d-country-modules.mjs
 *     node:vm + node:fs  →  the module sources embedded as real code
 * ═══════════════════════════════════════════════════════════════════════════ */

/* The globals the node:vm sandbox defines on its context object, in the order
 * they appear in the source. A runner shadows exactly these names and nothing
 * else, so an identifier that was a ReferenceError inside the vm is still not
 * silently resolved from a Workers global. */
const SANDBOX_PARAMS = [
    'window', 'self', 'globalThis', 'document', 'console',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'fetch', 'URL', 'Image', 'L'
];

/** The list of module files the source declares (parsed, never hardcoded). */
function parseCountryModules(src) {
    const block = /export const COUNTRY_MODULES = \[([\s\S]*?)\];/.exec(src);
    if (!block) fail('map3d-country-modules: cannot find the COUNTRY_MODULES array');
    const files = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    if (!files.length) fail('map3d-country-modules: COUNTRY_MODULES is empty');
    return files;
}

function buildCountryModuleRunners(files) {
    const runners = files.map((file, index) => {
        const source = read(file);
        if (!source.trim().length) fail(`map3d-country-modules: ${file} is empty`);
        /* Every module is already an IIFE that takes `root` and is written with
         * 'use strict' inside it, so embedding it in this strict ESM module
         * does not change its semantics. */
        if (!source.includes('use strict')) {
            fail(`map3d-country-modules: ${file} is not strict-mode code — embedding it ` +
                 'in a strict ESM module could change its semantics, so it is refused');
        }
        return [
            `/* ── ${file} — embedded verbatim ───────────────────────────────── */`,
            `function runCountryModule${index}(context) {`,
            `    (function (${SANDBOX_PARAMS.join(', ')}) {`,
            source.replace(/\n$/, ''),
            `    }).call(context, ${SANDBOX_PARAMS.map((name) => `context.${name}`).join(', ')});`,
            `}`
        ].join('\n');
    });

    return [
        '/* GENERATED — one function per entry of COUNTRY_MODULES. Each embeds the',
        ' * browser module verbatim inside a function whose parameters shadow exactly',
        ' * the globals the node:vm sandbox provided, and whose `this` is the context',
        ' * object — the same binding a `vm.runInContext()` script sees. */',
        'const MODULE_RUNNERS = [',
        files.map((file, index) => `    ['${file}', runCountryModule${index}]`).join(',\n'),
        '];',
        '',
        runners.join('\n\n'),
        ''
    ].join('\n');
}

export function generatedCountryModules() {
    const src = read('netlify/lib/map3d-country-modules.mjs');
    const files = parseCountryModules(src);

    let out = replaceSpan(
        src,
        "import { fileURLToPath } from 'node:url';",
        "const JS_DIR = path.resolve(HERE, '../../js');",
        [
            '/* No node:url / node:fs / node:path / node:vm here: the Cloudflare Workers',
            ' * runtime has no filesystem, no node:vm, and refuses eval() and',
            ' * new Function() ("Code generation from strings disallowed for this',
            ' * context"), so the module sources cannot be read at request time nor',
            ' * evaluated from strings. They are embedded below as real code inside',
            ' * functions whose parameters shadow exactly the globals the node:vm',
            ' * sandbox provided — same bindings, same evaluation order, same failures. */'
        ].join('\n'),
        'map3d-country-modules: node prelude'
    );

    out = replaceSpan(
        out,
        '    try {\n        vm.createContext(context);',
        "console.warn('[map3d-tile] country module not evaluated: ' + file + ' — ' + e.message);\n        }\n    }",
        [
            '    for (const [file, run] of MODULE_RUNNERS) {',
            '        try {',
            '            run(context);',
            '        } catch (e) {',
            "            console.warn('[map3d-tile] country module not evaluated: ' + file + ' — ' + e.message);",
            '        }',
            '    }'
        ].join('\n'),
        'map3d-country-modules: vm evaluation loop'
    );

    /* The sandbox identifies itself to the modules; on Cloudflare it is a Pages
     * Function, not a Netlify Function. */
    out = replaceOnce(out, "userAgent: 'netlify-function'", "userAgent: 'cloudflare-pages-function'",
        'map3d-country-modules: sandbox user agent');

    /* Insert the runners after COUNTRY_MODULES and before the Leaflet stub, so
     * the const is initialised before countryModuleScope() can ever run. */
    const leafletMarker = '/* ── the smallest Leaflet that lets a layer module define itself ──────────── */';
    if (countOf(out, leafletMarker) !== 1) fail('map3d-country-modules: cannot find the Leaflet stub marker');
    out = out.replace(leafletMarker, buildCountryModuleRunners(files) + '\n' + leafletMarker);

    assertNoNodeRuntime(out, 'map3d-country-modules');
    if (files.some((f) => !out.includes(`/* ── ${f} — embedded verbatim`))) fail('map3d-country-modules: a module was not embedded');

    return HEADER('functions/_generated/map3d-country-modules.mjs',
        'netlify/lib/map3d-country-modules.mjs',
        'node:vm + node:fs sandbox → the same eight browser modules embedded as real code') + out;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  2. netlify/lib/map3d-tile.mjs
 *     createRequire(../../js/layer-registry.js) → a static ESM import
 * ═══════════════════════════════════════════════════════════════════════════ */

export function generatedMap3dTile() {
    const src = read('netlify/lib/map3d-tile.mjs');

    let out = replaceSpan(
        src,
        "import { createRequire } from 'node:module';",
        'export const registry = require(REGISTRY_PATH);',
        [
            "/* The Workers runtime has no filesystem, so the registry cannot be located",
            " * with createRequire(path.resolve(…)) at runtime. It is imported statically",
            " * instead: js/layer-registry.js is UMD (module.exports + root.DetectLabLayers)",
            " * and its three require() lookups are guarded by `typeof require ===",
            " * 'function'`, which esbuild satisfies by bundling js/asig-albania-layers.",
            " * config.js, js/danish-layers.config.js and js/finland-layers.config.js. The",
            " * registry object is therefore byte-for-byte the one the browser and the",
            " * Netlify function use — 189 layers on all three runtimes (verified). */",
            "import registryModule from '../../js/layer-registry.js';",
            "import { countryModuleScope } from './map3d-country-modules.mjs';",
            '',
            '/* The registry is shared verbatim with the browser. */',
            'export const registry = registryModule;'
        ].join('\n'),
        'map3d-tile: registry prelude'
    );

    /* Netlify's own CDN directive is ignored by Cloudflare; CDN-Cache-Control is
     * the standard one and is honoured by the Cloudflare edge. Same 7-day pin. */
    out = replaceOnce(out, "'Netlify-CDN-Cache-Control':", "'CDN-Cache-Control':",
        'map3d-tile: CDN cache directive');

    out = replaceOnce(
        out,
        "hint: 'add the host to window.DETECTLAB_MAP3D.proxy.extraHosts (or to RELAY_EXTRA_HOSTS in netlify/lib/map3d-tile.mjs)'",
        "hint: 'add the host to window.DETECTLAB_MAP3D.proxy.extraHosts (or to RELAY_EXTRA_HOSTS in netlify/lib/map3d-tile.mjs, then re-run node tools/sync-cloudflare-generated.mjs)'",
        'map3d-tile: relay refusal hint'
    );

    const map3dCode = assertNoNodeRuntime(out, 'map3d-tile');
    if (/\bREGISTRY_PATH\b/.test(map3dCode)) fail('map3d-tile: a filesystem lookup survived');
    if (/Netlify-CDN-Cache-Control/.test(out)) fail('map3d-tile: a Netlify-only header survived');

    /* Buffer is used at module-evaluation time (BLANK_PNG), so the runtime shims
     * are imported first: ESM evaluates imports in source order, which
     * guarantees a working Buffer/process before this module's body runs. */
    return HEADER('functions/_generated/map3d-tile.mjs',
        'netlify/lib/map3d-tile.mjs',
        'createRequire(js/layer-registry.js) → a static ESM import; Netlify-CDN-Cache-Control → CDN-Cache-Control',
        "import '../_lib/runtime-shims.js';\n\n") + out;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  3. backend/src/lib/finland-geo.mjs
 *     createRequire(finland-layers.config.cjs) → a static ESM import
 * ═══════════════════════════════════════════════════════════════════════════ */

export function generatedFinlandGeo() {
    const src = read('backend/src/lib/finland-geo.mjs');

    let out = replaceSpan(
        src,
        "import { createRequire } from 'node:module';",
        'const HERE = path.dirname(fileURLToPath(import.meta.url));',
        [
            '/* The Workers runtime has no filesystem, so the config cannot be located',
            " * with createRequire(path.resolve(HERE, …)). It is imported statically",
            ' * instead — the very same generated .cjs mirror the Netlify function and',
            ' * the Express backend use, so there is still exactly one description of',
            ' * the Finnish tile matrix. */',
            "import finlandLayersConfig from '../../backend/src/lib/finland-layers.config.cjs';"
        ].join('\n'),
        'finland-geo: node prelude'
    );

    out = replaceSpan(
        out,
        'let config = null;\ntry {',
        '  config = null;   /* the proxy still works — it carries its own constants */\n}',
        'let config = finlandLayersConfig;',
        'finland-geo: config lookup'
    );

    const finlandCode = assertNoNodeRuntime(out, 'finland-geo');
    if (/\bHERE\b/.test(finlandCode)) fail('finland-geo: a filesystem lookup survived');

    return HEADER('functions/_generated/finland-geo.mjs',
        'backend/src/lib/finland-geo.mjs',
        'createRequire(finland-layers.config.cjs) → a static ESM import',
        "import '../_lib/runtime-shims.js';\n\n") + out;
}

/* ── generated-file header (same convention as tools/sync-danish-config.mjs) ── */

function HEADER(outRel, srcRel, what, extra = '') {
    return `/*
 * ${outRel}
 * ───────────────────────────────────────────────────────────────────────────
 * GENERATED COPY — do not edit this file.
 *
 * Canonical source : ${srcRel}
 * Adapted for      : the Cloudflare Workers runtime (Pages Functions)
 * What changed     : ${what}
 *
 * Regenerate with
 *
 *     node tools/sync-cloudflare-generated.mjs
 *
 * \`node tools/sync-cloudflare-generated.mjs --check\` — run by the Cloudflare
 * build and by test-cloudflare-generated.mjs — fails on any drift, so the
 * allow-lists, tile maths and cache policy of the Netlify deployment stay the
 * single source of truth. Everything below the transformation anchors is the
 * canonical file verbatim.
 */

${extra}`;
}

/* ── the three targets ───────────────────────────────────────────────────── */

export const TARGETS = [
    { out: 'functions/_generated/map3d-country-modules.mjs', build: generatedCountryModules },
    { out: 'functions/_generated/map3d-tile.mjs', build: generatedMap3dTile },
    { out: 'functions/_generated/finland-geo.mjs', build: generatedFinlandGeo }
];

export function expectedFiles() {
    return TARGETS.map((t) => ({ out: t.out, want: t.build() }));
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const isCheck = argv.includes('--check');
const isVerify = argv.includes('--verify') || (!isCheck && !argv.includes('--no-verify'));

async function verify() {
    const { verifyParity } = await import('./cloudflare-parity-check.mjs');
    return verifyParity({ root: ROOT, quiet: true });
}

let files;
try {
    files = expectedFiles();
} catch (err) {
    console.error(String(err && err.message || err));
    process.exit(1);
}

if (isCheck) {
    let drift = false;
    for (const { out, want } of files) {
        const have = fs.existsSync(path.join(ROOT, out)) ? fs.readFileSync(path.join(ROOT, out), 'utf8') : null;
        if (have !== want) {
            drift = true;
            console.error(`✗ ${out} is out of date — run: node tools/sync-cloudflare-generated.mjs`);
        }
    }
    if (drift) process.exit(1);
    console.log(`✓ ${files.length} generated Cloudflare function modules are in step with their sources`);
    if (isVerify) {
        try { await verify(); } catch (err) { console.error(String(err && err.message || err)); process.exit(1); }
    }
    process.exit(0);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
let written = 0;
for (const { out, want } of files) {
    const abs = path.join(ROOT, out);
    const have = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    if (have === want) {
        console.log(`= ${out} already in step`);
        continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, want);
    written++;
    console.log(`✓ wrote ${out} (${want.split('\n').length} lines)`);
}
if (!written) console.log('= nothing to regenerate');

if (isVerify) {
    try {
        await verify();
        console.log('✓ runtime parity with the Netlify/Express implementations verified');
    } catch (err) {
        console.error(String(err && err.message || err));
        process.exit(1);
    }
}
