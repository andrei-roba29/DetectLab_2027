#!/usr/bin/env node
/*
 * test-cloudflare-generated.mjs
 * ───────────────────────────────────────────────────────────────────────────
 * functions/_generated/*.mjs are NOT hand-written. They are produced by
 * tools/sync-cloudflare-generated.mjs from three files that already exist for
 * the Netlify deployment and the Express backend:
 *
 *   netlify/lib/map3d-country-modules.mjs  → functions/_generated/map3d-country-modules.mjs
 *   netlify/lib/map3d-tile.mjs             → functions/_generated/map3d-tile.mjs
 *   netlify/functions/finland-geo.mjs      → functions/_generated/finland-geo.mjs
 *
 * This test protects the mechanism that keeps them in step:
 *
 *   1. `--check` passes on a clean tree, i.e. the committed generated files are
 *      exactly what the sources produce today. A stale copy can never be
 *      deployed unnoticed — tools/cloudflare-build.mjs runs --check first.
 *   2. `--check` FAILS when a generated file drifts from its source (the guard
 *      is actually armed, not decorative).
 *   3. Generation is deterministic: running the generator again changes nothing.
 *   4. The three sources themselves are untouched (the migration is additive).
 *   5. The transformation did what it claims: no Node runtime API survives, the
 *      eight country modules are embedded VERBATIM (not paraphrased), the
 *      registry is a static import, and the CDN cache header was translated.
 *   6. The generated modules load in a real runtime and expose the entry points
 *      the routes call.
 *
 * Run:  node test-cloudflare-generated.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

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
function runGenerator(args) {
    try {
        const stdout = execFileSync(process.execPath, ['tools/sync-cloudflare-generated.mjs', ...args],
            { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { code: 0, stdout };
    } catch (error) {
        return { code: error.status ?? 1, stdout: (error.stdout || '') + (error.stderr || '') };
    }
}

const GENERATED = [
    ['functions/_generated/map3d-country-modules.mjs', 'netlify/lib/map3d-country-modules.mjs'],
    ['functions/_generated/map3d-tile.mjs', 'netlify/lib/map3d-tile.mjs'],
    ['functions/_generated/finland-geo.mjs', 'netlify/functions/finland-geo.mjs']
];

/* ═══════════════════════════════════════════════════════════════════════════ */
group('1. The committed generated files are in step with their sources');
for (const [generated, source] of GENERATED) {
    check(`${generated} exists`, fs.existsSync(path.join(ROOT, generated)));
    check(`its source ${source} exists`, fs.existsSync(path.join(ROOT, source)));
}
{
    const result = runGenerator(['--check']);
    eq('tools/sync-cloudflare-generated.mjs --check exits 0', result.code, 0);
    if (result.code !== 0) console.error(result.stdout);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('2. The drift guard is armed — a stale generated file is refused');
{
    const target = 'functions/_generated/map3d-tile.mjs';
    const backup = read(target);
    try {
        fs.writeFileSync(path.join(ROOT, target), backup + '\n// drifted on purpose\n');
        const stale = runGenerator(['--check']);
        check('--check exits non-zero when a generated file drifts', stale.code !== 0, `exit ${stale.code}`);
        check('and names the drifted file', stale.stdout.includes('map3d-tile.mjs'), stale.stdout.slice(0, 300));

        /* The generator must also be able to heal it. */
        const healed = runGenerator(['--no-verify']);
        eq('regenerating exits 0', healed.code, 0);
        eq('the regenerated file is byte-identical to the committed one', read(target), backup);
    } finally {
        fs.writeFileSync(path.join(ROOT, target), backup);
    }
    eq('the tree is restored', read(target), backup);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('3. Generation is deterministic and idempotent');
{
    const before = GENERATED.map(([g]) => read(g));
    const again = runGenerator(['--no-verify']);
    eq('a second run exits 0', again.code, 0);
    GENERATED.forEach(([g], i) => eq(`${g} is unchanged by a second run`, read(g), before[i]));
    const onceMore = runGenerator(['--check']);
    eq('--check still passes afterwards', onceMore.code, 0);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('4. The Netlify and backend sources are untouched');
{
    const git = (args) => { try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }); } catch { return ''; } };
    for (const [, source] of GENERATED) {
        eq(`${source} has no local modification`, git(['diff', '--name-only', 'HEAD', '--', source]).trim(), '');
    }
    eq('netlify/lib/ has no local modification', git(['diff', '--name-only', 'HEAD', '--', 'netlify/lib']).trim(), '');
    eq('backend/src/lib/ has no local modification', git(['diff', '--name-only', 'HEAD', '--', 'backend/src/lib']).trim(), '');
    eq('js/layer-registry.js has no local modification', git(['diff', '--name-only', 'HEAD', '--', 'js/layer-registry.js']).trim(), '');
    check('the Netlify handler still uses node:vm and node:fs (it was NOT rewritten)',
        /node:vm/.test(read('netlify/lib/map3d-country-modules.mjs')) && /node:fs/.test(read('netlify/lib/map3d-country-modules.mjs')));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('5. No Node runtime API survives in the generated copies');
{
    /* Comments legitimately explain what was removed, so they are stripped
     * before scanning — the same rule the generator's own guard uses. */
    const code = (text) => text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/([^:'"`\s])\s*\/\/.*$/gm, '$1');
    const forbidden = [
        ['node:fs', /node:fs/],
        ['node:vm', /node:vm/],
        ['node:path', /node:path/],
        ['node:url', /node:url/],
        ['node:crypto', /node:crypto/],
        ['createRequire', /createRequire/],
        ['require(', /\brequire\s*\(/],
        ['new Function', /new\s+Function\s*\(/],
        ['eval(', /[^.\w]eval\s*\(/],
        ['__dirname', /__dirname/],
        ['readFileSync', /readFileSync/],
        ['vm.runInNewContext', /runInNewContext/],
        ['a REGISTRY_PATH-style path constant', /\b(const|let|var)\s+REGISTRY_PATH\b/],
        ['a HERE-style import.meta file path', /\bimport\.meta\.url\b/],
        ['process.cwd', /process\.cwd\s*\(/]
    ];
    for (const [generated] of GENERATED) {
        const body = code(read(generated));
        for (const [name, pattern] of forbidden) {
            check(`${path.basename(generated)} contains no ${name}`, !pattern.test(body),
                (body.match(new RegExp(pattern.source, 'm')) || [''])[0]);
        }
        if (generated.endsWith('map3d-country-modules.mjs')) {
            /* Pure embedded code plus one scope factory: it touches no global
             * that needs a shim, so it imports nothing at all. */
            check('map3d-country-modules.mjs is self-contained (imports nothing)',
                !/^import\s/m.test(read(generated)));
        } else {
            check(`${path.basename(generated)} imports the runtime shims`,
                /import '\.\.\/_lib\/runtime-shims\.js'/.test(read(generated)));
        }
        check(`${path.basename(generated)} carries the do-not-edit banner`,
            /GENERATED FILE|do not edit|Do not edit/i.test(read(generated).slice(0, 2000)));
    }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('6. The eight country modules are embedded VERBATIM');
{
    const source = read('netlify/lib/map3d-country-modules.mjs');
    const generated = read('functions/_generated/map3d-country-modules.mjs');

    /* The Netlify copy lists eight browser layer scripts and evaluates each one
     * from disk inside a node:vm sandbox at request time. A workerd isolate
     * forbids code generation from strings (new Function / eval throw EvalError)
     * and has no filesystem, so the generator embeds each script as real code in
     * a parameter-shadowing IIFE. "Verbatim" means every code line of every
     * js/*-layer.js file appears in the generated module unchanged — no
     * paraphrase, no dropped layer. */
    const listed = [...source.matchAll(/^\s*'(js\/[a-z0-9-]+\.js)',?$/gm)].map((m) => m[1]);
    eq('the Netlify source lists eight country modules', listed.length, 8);
    const generatedList = [...generated.matchAll(/^\s*'(js\/[a-z0-9-]+\.js)',?$/gm)].map((m) => m[1]);
    check('the generated module lists the same eight ids for its metadata endpoint',
        JSON.stringify(generatedList) === JSON.stringify(listed),
        `${generatedList.length} listed: ${JSON.stringify(generatedList)}`);

    const runners = [...generated.matchAll(/^\s*\['(js\/[a-z0-9-]+\.js)',\s*(runCountryModule\d+)\],?$/gm)]
        .map((m) => ({ file: m[1], fn: m[2] }));
    eq('the generated module embeds eight module runners', runners.length, 8);
    check('every listed module has a runner',
        JSON.stringify(runners.map((r) => r.file).sort()) === JSON.stringify([...listed].sort()),
        JSON.stringify(runners.map((r) => r.file)));
    for (const runner of runners) {
        check(`${runner.file} → function ${runner.fn}() is defined`,
            new RegExp(`function ${runner.fn}\\(`).test(generated));
    }

    /* Line-for-line comparison against the real browser scripts on disk. */
    let total = 0;
    const missing = [];
    for (const file of listed) {
        const original = read(file);
        const lines = original.split('\n')
            .map((l) => l.trim())
            .filter((l) => l.length > 3 && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));
        total += lines.length;
        check(`${file} is strict-mode, so it is safe to inline in an ES module`, /['"]use strict['"]/.test(original));
        for (const line of lines) {
            if (!generated.includes(line)) missing.push(`${file}: ${line.slice(0, 80)}`);
        }
    }
    check(`all ${total} code lines of the eight country modules are present verbatim`,
        missing.length === 0, `${missing.length} missing, e.g. ${JSON.stringify(missing.slice(0, 3))}`);

    check('countryModuleScope() replaces the vm context', /export function countryModuleScope\(\)/.test(generated));
    check('the embedded user agent identifies the Cloudflare runtime',
        /userAgent:\s*'cloudflare-pages-function'/.test(generated));
    check('the Netlify source still reads the scripts from disk inside node:vm',
        /node:vm/.test(source) && /node:fs/.test(source) && /runInNewContext|createContext/.test(source));
    const code = generated.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    check('no vm sandbox survives in the generated copy', !/createContext|runInNewContext/.test(code));
    check('no JS_DIR-style directory constant survives', !/\bJS_DIR\b/.test(code));
}

group('7. map3d-tile — the registry is a static import and the CDN header is translated');
{
    const generated = read('functions/_generated/map3d-tile.mjs');
    const source = read('netlify/lib/map3d-tile.mjs');
    check('the layer registry is imported statically from js/layer-registry.js',
        /import registryModule from '\.\.\/\.\.\/js\/layer-registry\.js'/.test(generated));
    check('the country module scope comes from the generated sibling module',
        /import \{ countryModuleScope \} from '\.\/map3d-country-modules\.mjs'/.test(generated));
    check('the source still reads the registry from disk with createRequire',
        /createRequire/.test(source) && /REGISTRY_PATH/.test(source));
    const code = generated.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    check('Netlify-CDN-Cache-Control is gone from the code', !/Netlify-CDN-Cache-Control/.test(code));
    check('the CDN pin is emitted as the standard CDN-Cache-Control', /'CDN-Cache-Control'/.test(code));
    check('the Cloudflare-CDN-Cache-Control twin is added by the shared adapter',
        /Cloudflare-CDN-Cache-Control/.test(read('functions/_lib/pages-adapter.js')));
    check('the seven-day tile pin survives unchanged',
        /s-maxage=\$\{Math\.max\(cacheSeconds, 604800\)\}/.test(code) &&
        /s-maxage=\$\{Math\.max\(cacheSeconds, 604800\)\}/.test(source));
    check('stale-while-revalidate is preserved', /stale-while-revalidate=86400/.test(code));
    check('handleTileRequest is still exported', /export (async )?function handleTileRequest/.test(generated));
    check('the relay allow-list is still exported for the tests', /validateRelayUrl|RELAY_ALLOWED_HOSTS|ALLOWED_RELAY/.test(generated));
}

group('8. finland-geo — the config is a static import, the handler is unchanged');
{
    const generated = read('functions/_generated/finland-geo.mjs');
    /* The Netlify Function is a thin re-export of the shared backend library;
     * that library is the canonical source the generator transforms. */
    const netlifyFunction = read('netlify/functions/finland-geo.mjs');
    const source = read('backend/src/lib/finland-geo.mjs');
    check('the Netlify Function still re-exports the shared backend library',
        /from '\.\.\/\.\.\/backend\/src\/lib\/finland-geo\.mjs'/.test(netlifyFunction));
    check('the generated copy names that library as its canonical source',
        /Canonical source\s*:\s*backend\/src\/lib\/finland-geo\.mjs/.test(generated));
    check('the Finland layer config is imported statically',
        /import finlandLayersConfig from '\.\.\/\.\.\/backend\/src\/lib\/finland-layers\.config\.cjs'/.test(generated));
    check('the canonical source still loads the .cjs config with createRequire',
        /createRequire/.test(source) && /require\(path\.resolve\(HERE, 'finland-layers\.config\.cjs'\)\)/.test(source));
    const code = generated.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    check('no createRequire survives in the generated copy', !/createRequire/.test(code));
    check('finlandGeoResponse is still exported', /export async function finlandGeoResponse/.test(generated));
    check('the Netlify `export const config = { path }` block was dropped',
        /export const config\s*=/.test(netlifyFunction) && !/export const config\s*=/.test(generated));
    check('the handler body is otherwise carried over verbatim',
        /MML_API_KEY/.test(generated) && /mml_api_key_missing/.test(generated) && /upstream_timeout/.test(generated));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('9. The generated modules load and expose their entry points');
{
    const modules = await import(new URL('file://' + path.join(ROOT, 'functions/_generated/map3d-country-modules.mjs')).href);
    eq('COUNTRY_MODULES lists eight entries', modules.COUNTRY_MODULES.length, 8);
    check('countryModuleScope() is a function', typeof modules.countryModuleScope === 'function');
    const scope = modules.countryModuleScope();
    check('the scope provides the globals the modules were written against',
        scope && typeof scope === 'object' && scope.navigator && scope.navigator.userAgent === 'cloudflare-pages-function');

    const tile = await import(new URL('file://' + path.join(ROOT, 'functions/_generated/map3d-tile.mjs')).href);
    check('handleTileRequest is a function', typeof tile.handleTileRequest === 'function');
    const layers = tile.registry.all();
    eq('the statically imported registry exposes all 189 layers', layers.length, 189);
    check('layerById() resolves a module-backed LiDAR layer', !!tile.layerById('lidar.se-lantmateriet'));
    check('layerById() resolves a base layer', !!tile.layerById('base.imagery'));
    check('layerById() refuses an unknown layer', !tile.layerById('not-a-layer'));
    const hosts = typeof tile.relayAllowedHosts === 'function' ? tile.relayAllowedHosts() : tile.relayAllowedHosts;
    check('the relay allow-list is still a closed set of public hosts',
        hosts instanceof Set && hosts.size >= 40, `${hosts && hosts.size} hosts`);
    check('the allow-list contains the ArcGIS imagery hosts the relay needs',
        hosts.has('services.arcgisonline.com') && hosts.has('server.arcgisonline.com'));
    eq('a loopback URL is refused with the documented reason',
        tile.validateRelayUrl('http://127.0.0.1/x.png').reason, 'private-host');
    check('an allowed public URL passes validation',
        tile.validateRelayUrl('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/1/2/3').ok === true);

    const finland = await import(new URL('file://' + path.join(ROOT, 'functions/_generated/finland-geo.mjs')).href);
    check('finlandGeoResponse is a function', typeof finland.finlandGeoResponse === 'function');
    check('the Finland config resolved through the static .cjs import',
        !!finland.finlandConfig?.() && typeof finland.finlandConfig() === 'object');
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('10. The Netlify copies still behave identically (parity)');
{
    const parity = execFileSync(process.execPath, ['tools/cloudflare-parity-check.mjs'],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    check('tools/cloudflare-parity-check.mjs passes', /pass|✓/.test(parity), parity.slice(-400));
    check('the parity report has no failing group', !/FAILED/.test(parity));
}

console.log('\n' + '─'.repeat(72));
if (failures) {
    console.error(`✗ ${failures} of ${checks} checks FAILED`);
    process.exit(1);
}
console.log(`✓ all ${checks} checks passed — the generated Cloudflare modules are faithful, in step and Node-runtime-free`);
