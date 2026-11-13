#!/usr/bin/env node
/*
 * test-cloudflare-config.mjs
 * ───────────────────────────────────────────────────────────────────────────
 * The migration is ADDITIVE. This test proves it, and proves that the
 * Cloudflare configuration files say what the migration brief requires.
 *
 *   1. The Netlify deployment is intact — netlify.toml, netlify/functions/,
 *      netlify/lib/, the Express backend, the frontend, the PWA and the data
 *      directory are byte-for-byte what git has, and no _headers / _redirects /
 *      package.json appeared at the repository root (Netlify publishes "." and
 *      reads all three).
 *   2. _routes.json invokes Functions for exactly the nine API paths, so no
 *      static asset, PWA file, map tile or application path ever pays for a
 *      Function invocation, and no catch-all can shadow anything.
 *   3. _headers preserves the Google OAuth callback headers exactly and adds no
 *      rule that could break the existing frontend.
 *   4. _redirects contains no rule Cloudflare would silently ignore, and the
 *      www → apex canonicalisation is implemented where Cloudflare can actually
 *      do it (functions/_middleware.js + a documented Dashboard Redirect Rule).
 *   5. The two country domains can never redirect to each other.
 *   6. wrangler.jsonc does not enable nodejs_compat and publishes
 *      cloudflare-dist/.
 *   7. The build pipeline runs the SAME Corona catalogue script Netlify runs and
 *      assembles an output directory that contains the site and nothing
 *      server-side.
 *
 * Run:  node test-cloudflare-config.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

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

const git = (args) => {
    try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }); }
    catch { return ''; }
};

/* The nine routes, exactly as the frontend calls them and as netlify.toml maps them. */
const ROUTES = [
    ['/api/corona/rasters', 'corona-rasters'],
    ['/api/geo/se-hojdmodell', 'se-hojdmodell'],
    ['/api/map3d/tile', 'map3d-tile'],
    ['/api/geo/dk-dhm', 'dk-dhm'],
    ['/api/geo/dk-dtk25', 'dk-dtk25'],
    ['/api/geo/dk-orto', 'dk-orto'],
    ['/api/geo/dk-heritage', 'dk-heritage'],
    ['/api/geo/finland', 'finland-geo'],
    ['/api/geo/asig-heritage', 'asig-heritage']
];

/* ═══════════════════════════════════════════════════════════════════════════ */
group('1. The existing Netlify implementation is intact');

const changed = git(['status', '--porcelain']).split('\n').map((l) => l.trim()).filter(Boolean);
const changedPaths = changed.map((l) => l.replace(/^[A-Z?!]+\s+/, '').replace(/^.* -> /, ''));
const isCloudflareOnly = (p) => /^(functions\/|cloudflare\/|cloudflare-dist\/|wrangler\.jsonc$|CLOUDFLARE_|tools\/(sync-cloudflare-generated|build-cloudflare-dist|cloudflare-build|cloudflare-parity-check|cloudflare-smoke|cloudflare-map3d-audit|corona-snapshot)\.mjs$|test-cloudflare-|\.gitignore$|data\/corona-europe-catalog\.snapshot\.json$)/.test(p);
const unexpected = changedPaths.filter((p) => !isCloudflareOnly(p));
check('nothing outside the Cloudflare additions was created, modified or deleted',
    unexpected.length === 0, 'changed: ' + JSON.stringify(unexpected));
check('no tracked file was deleted',
    !changed.some((l) => /^\s*D/.test(l)), changed.filter((l) => /^\s*D/.test(l)).join(', '));

for (const rel of ['netlify.toml', 'netlify/functions/asig-heritage.mjs', 'netlify/functions/corona-rasters.mjs',
    'netlify/functions/dk-dhm.mjs', 'netlify/functions/dk-dtk25.mjs', 'netlify/functions/dk-heritage.mjs',
    'netlify/functions/dk-orto.mjs', 'netlify/functions/finland-geo.mjs', 'netlify/functions/map3d-tile.mjs',
    'netlify/functions/se-hojdmodell.mjs', 'netlify/lib/corona-catalog.mjs', 'netlify/lib/map3d-country-modules.mjs',
    'netlify/lib/map3d-tile.mjs', 'tools/build-corona-europe-catalog.mjs', 'backend/package.json',
    'tools/apm-test/package.json']) {
    check(`${rel} still exists`, exists(rel));
}
const netlifyDiff = git(['diff', '--name-only', 'HEAD', '--', 'netlify', 'netlify.toml', 'backend', 'js', 'css', 'images',
    'index.html', 'sw.js', 'manifest.json', 'data', 'src', 'webfonts', 'tools/build-corona-europe-catalog.mjs']);
check('netlify/, netlify.toml, backend/, the frontend, the PWA and data/ are byte-for-byte unchanged',
    netlifyDiff.trim() === '', netlifyDiff.trim());

/* netlify.toml still says exactly what the live site needs. */
const toml = read('netlify.toml');
check('netlify.toml still publishes the repository root', /publish\s*=\s*"\."/.test(toml));
check('netlify.toml still builds the Corona catalogue, tolerating a CAST outage',
    /command\s*=\s*"node tools\/build-corona-europe-catalog\.mjs \|\| true"/.test(toml));
check('netlify.toml still declares netlify/functions', /\[functions\][\s\S]{0,80}directory\s*=\s*"netlify\/functions"/.test(toml));
for (const [route, fn] of ROUTES) {
    check(`netlify.toml still rewrites ${route} → /.netlify/functions/${fn}`,
        new RegExp(`from = "${route.replace(/\//g, '\\/')}"[\\s\\S]{0,120}to = "\/\\.netlify\\/functions\\/${fn}"[\\s\\S]{0,40}status = 200`).test(toml));
}
check('netlify.toml still carries the Google OAuth callback headers',
    /for = "\/google-auth-callback\.html"[\s\S]{0,200}Cache-Control = "no-store"[\s\S]{0,200}Referrer-Policy = "no-referrer"[\s\S]{0,200}X-Robots-Tag = "noindex, nofollow"/.test(toml));
check('netlify.toml still canonicalises both www hosts',
    /from = "https:\/\/www\.detectlab\.eu\/\*"/.test(toml) && /from = "https:\/\/www\.detectlab\.ro\/\*"/.test(toml));

/* Netlify reads these from the publish directory, so they must not exist there. */
for (const forbidden of ['_headers', '_redirects', '_routes.json', 'package.json', '_worker.js']) {
    check(`no ${forbidden} at the repository root (Netlify publishes "." and would read it)`, !exists(forbidden));
}
{
    const ignoreDiff = git(['diff', 'HEAD', '--', '.gitignore']).split('\n');
    const removed = ignoreDiff.filter((l) => /^-[^-]/.test(l));
    const added = ignoreDiff.filter((l) => /^\+[^+]/.test(l));
    check('.gitignore lost no existing rule', removed.length === 0, removed.join(' | '));
    check('.gitignore only gained the three Cloudflare paths',
        added.filter((l) => !/^\+\s*(#|$)/.test(l)).map((l) => l.slice(1).trim())
            .every((l) => ['cloudflare-dist/', '.wrangler/', '.dev.vars'].includes(l)),
        JSON.stringify(added));
    check('the added block explains itself', /^\+.*CLOUDFLARE_MIGRATION\.md/m.test(git(['diff', 'HEAD', '--', '.gitignore'])));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('2. cloudflare/_routes.json — Functions only where they are needed');
const routes = JSON.parse(read('cloudflare/_routes.json'));
eq('schema version', routes.version, 1);
eq('include lists exactly the nine API paths', routes.include.length, 9);
for (const [route] of ROUTES) {
    check(`${route} invokes a Function`, routes.include.includes(route));
}
eq('include contains nothing else', routes.include.filter((r) => !ROUTES.some(([x]) => x === r)).length, 0);
eq('exclude is empty (include is already exhaustive)', routes.exclude.length, 0);
check('no wildcard can shadow an application path, a PWA asset or a map tile',
    routes.include.every((r) => !r.includes('*')));
check('every include entry is an exact /api path', routes.include.every((r) => r.startsWith('/api/') && r.length > 5));
check('the rule count is far inside the 100-rule Cloudflare limit', routes.include.length + routes.exclude.length <= 100);
for (const notAFunction of ['/', '/index.html', '/sw.js', '/manifest.json', '/css', '/js', '/data',
    '/api/search', '/api/rvt/metadata', '/api/payments/checkout', '/api/map3d/status']) {
    check(`${notAFunction} never invokes a Function`, !routes.include.some((r) => notAFunction.startsWith(r) || r.startsWith(notAFunction + '/')));
}
/* Every route maps to a real function file, and every function file is routed. */
for (const [route, fn] of ROUTES) {
    const file = 'functions' + route + '.js';
    check(`${route} → ${file} exists`, exists(file));
    check(`${route} still has its Netlify twin netlify/functions/${fn}.mjs`, exists(`netlify/functions/${fn}.mjs`));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('3. cloudflare/_headers — the OAuth callback headers are preserved');
const headers = read('cloudflare/_headers');
{
    const block = /(^|\n)\/google-auth-callback\.html\n((?:[ \t]+.+\n?)+)/.exec(headers);
    if (check('a /google-auth-callback.html block exists', !!block)) {
        const rules = block[2].split('\n').map((l) => l.trim()).filter(Boolean).filter((l) => !l.startsWith('#'));
        const map = Object.fromEntries(rules.map((l) => l.split(':').map((x) => x.trim())));
        eq('Cache-Control: no-store is preserved', map['Cache-Control'], 'no-store');
        eq('Referrer-Policy: no-referrer is preserved', map['Referrer-Policy'], 'no-referrer');
        eq('X-Robots-Tag: noindex, nofollow is preserved', map['X-Robots-Tag'], 'noindex, nofollow');
        eq('the block sets exactly those three headers', rules.length, 3);
    }
}
{
    /* Cloudflare joins a header set twice with a comma, so no path may be given
     * the same header by two blocks. */
    const blocks = headers.split(/\n(?=\/)/).filter((b) => /^\//.test(b));
    const perHeader = {};
    for (const block of blocks) {
        const lines = block.split('\n');
        const pattern = lines[0].trim();
        for (const line of lines.slice(1)) {
            const t = line.trim();
            if (!t || t.startsWith('#') || t.startsWith('!')) continue;
            const name = t.split(':')[0].trim().toLowerCase();
            perHeader[name] = perHeader[name] || [];
            perHeader[name].push(pattern);
        }
    }
    const overlapping = Object.entries(perHeader).filter(([, patterns]) => patterns.includes('/*') && patterns.length > 1);
    check('no header is set both by /* and by a narrower block (Cloudflare would join them with a comma)',
        overlapping.length === 0, JSON.stringify(overlapping));
    eq('the number of header blocks is far inside the 100-rule limit', blocks.length <= 100, true);
    check('every block line is under the 2000-character limit',
        headers.split('\n').every((l) => l.length <= 2000));
}
/* Only the rule lines matter — the file's prose explains what was deliberately
 * NOT added, so comments are stripped before scanning. */
const headerRules = headers.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
check('no Content-Security-Policy is introduced (it would break the inline scripts and the tile hosts)',
    !headerRules.some((l) => /content-security-policy/i.test(l)));
check('no Permissions-Policy is introduced (the app uses geolocation)',
    !headerRules.some((l) => /permissions-policy/i.test(l)));
check('no Cross-Origin-Opener/Embedder-Policy is introduced (they break the cross-origin tile iframes)',
    !headerRules.some((l) => /cross-origin-(opener|embedder)-policy/i.test(l)));
check('X-Content-Type-Options: nosniff is added site-wide', /\/\*\n\s+X-Content-Type-Options: nosniff/.test(headers));
check('the PWA shell is revalidated so an installed app picks up a new sw.js',
    /\/sw\.js\n\s+Cache-Control: no-cache/.test(headers) && /\/manifest\.json\n\s+Cache-Control: no-cache/.test(headers));
check('no Cache-Control rule weakens the seven-day tile caching',
    !/\/(js|css|images|data)\/?\*[\s\S]{0,80}max-age=0/.test(headers));
check('the file documents that _headers does not apply to Pages Function responses',
    /STATIC ASSET responses only/i.test(headers));

/* wrangler.jsonc sets assets.html_handling:"none", so Pages serves the callback
 * at BOTH /google-auth-callback.html and /google-auth-callback as a direct 200.
 * A _headers rule matches the URL that PRODUCED the response, and each spelling
 * now produces its own, so the callback needs the same three headers on both —
 * verified live in workerd by tools/cloudflare-smoke.mjs. */
{
    const blockFor = (pattern) => {
        const re = new RegExp('(^|\n)' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\n((?:[ \t]+.+\n?)+)');
        const m = re.exec(headers);
        if (!m) return null;
        return Object.fromEntries(m[2].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
            .map((l) => l.split(':').map((x) => x.trim())));
    };
    const htmlBlock = blockFor('/google-auth-callback.html');
    const cleanBlock = blockFor('/google-auth-callback');
    check('a block exists for the extensionless URL Pages also serves directly', !!cleanBlock);
    check('the clean-URL block carries exactly the same three headers as the .html block',
        !!htmlBlock && !!cleanBlock && JSON.stringify(htmlBlock) === JSON.stringify(cleanBlock),
        JSON.stringify({ htmlBlock, cleanBlock }));
    eq('and no fourth header is introduced for the callback', Object.keys(cleanBlock || {}).length, 3);
    check('the file explains why the block is repeated and names the setting that makes both URLs live',
        /html_handling/.test(headers) && /no redirect/i.test(headers) && /PWA_GOOGLE_SIGN_IN\.md/.test(headers));
    check('the file no longer claims a 308 that html_handling:"none" removed', !/308/.test(headers));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('4. cloudflare/_redirects and the www → apex canonicalisation');
const redirects = read('cloudflare/_redirects');
{
    const rules = redirects.split('\n')
        .filter((l) => l.trim() && !l.trim().startsWith('#'))
        .map((l) => l.trim());
    eq('_redirects declares no rule (Cloudflare Pages cannot match a hostname)', rules.length, 0);
    check('the file states why the two hostname rules are not here',
        /Domain-level redirects/.test(redirects) && /functions\/_middleware\.js/.test(redirects) && /Redirect Rule/.test(redirects));
    check('no catch-all redirect is introduced', !/^\s*\/\*/m.test(redirects));
}
{
    const middleware = await import(new URL('file://' + path.join(ROOT, 'functions/_middleware.js')).href);
    const table = middleware.CANONICAL_HOSTS;
    eq('the table covers exactly the two www hosts', Object.keys(table).length, 2);
    eq('www.detectlab.ro → detectlab.ro', table['www.detectlab.ro'], 'detectlab.ro');
    eq('www.detectlab.eu → detectlab.eu', table['www.detectlab.eu'], 'detectlab.eu');
    check('NEITHER country domain is ever rewritten to the other one',
        Object.entries(table).every(([from, to]) => from.replace(/^www\./, '') === to));
    check('no wildcard or cross-market target exists in the table',
        Object.values(table).every((t) => t === 'detectlab.ro' || t === 'detectlab.eu'));

    const run = async (url) => {
        let nexted = false;
        const response = await middleware.onRequest({
            request: new Request(url),
            next: () => { nexted = true; return new Response('next'); }
        });
        return { response, nexted };
    };
    for (const [host, apex] of [['www.detectlab.ro', 'detectlab.ro'], ['www.detectlab.eu', 'detectlab.eu']]) {
        const { response, nexted } = await run(`https://${host}/checkout.html?plan=year&lang=ro#frag`);
        eq(`${host} is canonicalised with a 301`, response.status, 301);
        eq(`${host} keeps the path, query and fragment`,
            response.headers.get('location'), `https://${apex}/checkout.html?plan=year&lang=ro#frag`);
        check(`${host} does not fall through to next()`, !nexted);
    }
    for (const host of ['detectlab.ro', 'detectlab.eu', 'detectlab-4i1.pages.dev', 'www.example.com', 'localhost']) {
        const { response, nexted } = await run(`https://${host}/api/map3d/tile?layer=x&z=1&x=0&y=0`);
        check(`${host} is served unchanged (next())`, nexted && response.status === 200);
    }
    const uppercase = await run('https://WWW.DetectLab.RO/informatii-utile.html');
    eq('the host match is case-insensitive', uppercase.response.status, 301);
    eq('the target keeps the lowercase apex', uppercase.response.headers.get('location'), 'https://detectlab.ro/informatii-utile.html');
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('5. wrangler.jsonc — the Cloudflare project settings');
{
    const text = read('wrangler.jsonc');
    /* Comments are prose: they explain why nodejs_compat is deliberately OFF. */
    const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const json = JSON.parse(withoutComments);
    eq('pages_build_output_dir is the dedicated Cloudflare directory', json.pages_build_output_dir, 'cloudflare-dist');
    check('a compatibility_date is declared', /^\d{4}-\d{2}-\d{2}$/.test(json.compatibility_date || ''));
    check('nodejs_compat is NOT enabled',
        !/nodejs_compat/.test(withoutComments) && !(json.compatibility_flags || []).includes('nodejs_compat'));
    eq('compatibility_flags is empty', (json.compatibility_flags || []).length, 0);
    check('no secret or credential is declared as a var', !/"vars"\s*:/.test(withoutComments));
    check('no binding is declared that the migration does not need',
        !/kv_namespaces|d1_databases|r2_buckets|durable_objects|queues|service_bindings/.test(withoutComments));
    check('the file explains why the repository root is not the output directory',
        /Netlify/.test(text) && /cloudflare-dist/.test(text));

    /* Without a deployed 404 asset, Cloudflare's router answers ANY unmatched
     * path with index.html and status 200 — measured locally: /netlify.toml and
     * /api/does-not-exist both came back "200 text/html" (the 636 KB shell).
     * Netlify answers a real 404, and sw.js caches same-origin 200s, so the
     * deployment ships cloudflare/404.html and points the router at it. */
    eq('assets.not_found_handling serves the deployed 404 page', json.assets && json.assets.not_found_handling, '404-page');
    eq('assets.directory repeats pages_build_output_dir so the two cannot drift',
        json.assets && json.assets.directory, './' + json.pages_build_output_dir);
    check('the file records the measured evidence for that setting',
        /index\.html with status 200|200 text\/html/.test(text) && /404/.test(text));
    /* assets.html_handling:"none" — the OAuth callback fix. Pages' default
     * ("auto-trailing-slash") answers /foo.html with a 308 to /foo, which (a) put
     * the one-time Google `code` through a redirect hop and (b) made sw.js skip
     * all 13 precached .html documents, because it caches a 200 only (sw.js:2414).
     * Measured locally with this setting in place: both callback spellings answer
     * 200 with no-store / no-referrer / noindex,nofollow, every precached .html
     * answers 200 with an empty redirect_url, and unmatched paths still 404. */
    eq('assets.html_handling keeps every .html URL a direct 200 (no clean-URL 308)',
        json.assets && json.assets.html_handling, 'none');
    check('the file records that evidence, including the sw.js 200-only precache guard',
        /html_handling/.test(text) && /sw\.js:2414|200 only|only caches a 200/i.test(text)
        && /google-auth-callback\.html/.test(text) && /308/.test(text));
    check('and that both spellings of the callback are documented as live',
        /\/google-auth-callback\.html[\s\S]{0,600}\/google-auth-callback\b/.test(text));
    check('no run_worker_first override is introduced (_routes.json already governs routing)',
        !json.assets || json.assets.run_worker_first === undefined);
    eq('the existing detectlab-feedback Worker project is untouched',
        git(['diff', '--name-only', 'HEAD', '--', 'detectlab-feedback']).trim(), '');
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('5b. cloudflare/404.html — the Cloudflare-only error page');
{
    check('cloudflare/404.html exists', exists('cloudflare/404.html'));
    check('no 404.html at the repository root (Netlify publishes "." and would adopt it)',
        !exists('404.html'));
    const page = read('cloudflare/404.html');
    check('it is a real HTML document', /<!DOCTYPE html>/i.test(page) && /<\/html>/.test(page));
    check('it carries no script, so it cannot interfere with sw.js, Supabase or Stripe',
        !/<script/i.test(page));
    check('it references no external asset (a 404 page whose own assets 404 is worse than none)',
        !/<link[^>]+href=["'](?!(?:data:|#))/i.test(page) && !/<img/i.test(page) &&
        !/(src|href)=["'](?:https?:)?\/\/(?!detectlab)/i.test(page.replace(/<!--[^]*?-->/g, '')));
    check('it is marked noindex', /name="robots"[^>]+noindex/i.test(page));
    check('it links home with a relative URL', /href="\/"/.test(page));
    check('it does not link the OTHER country domain (DOMAIN_SETUP.md keeps the markets apart)',
        !/href=["']https:\/\/detectlab\.(ro|eu)/.test(page.replace(/<!--[^]*?-->/g, '')));
    check('it stays small', page.length < 8192, `${page.length} bytes`);
    check('it explains why it exists and that it is Cloudflare-only',
        /CLOUDFLARE-ONLY/i.test(page) && /not_found_handling|index\.html/.test(page));
}

group('6. The build pipeline and the assembled output directory');
{
    const builder = await import(new URL('file://' + path.join(ROOT, 'tools/build-cloudflare-dist.mjs')).href);
    for (const dir of ['netlify', 'backend', 'functions', 'cloudflare', 'tools', 'test', 'test-results',
        'supabase', 'rvt_service', 'scripts_conflicts', 'detectlab-feedback', 'node_modules', '.git']) {
        check(`${dir}/ is never published as a static asset`, builder.EXCLUDED_DIRS.has(dir));
    }
    for (const file of ['netlify.toml', 'wrangler.jsonc', '.gitignore', '.dev.vars']) {
        check(`${file} is never published as a static asset`, builder.EXCLUDED_ROOT_FILES.has(file));
    }
    check('the browser-facing exception inside rvt_service/ is declared',
        builder.BROWSER_FACING_IN_EXCLUDED_DIRS.has('rvt_service/methods.json'));
    check('the Cloudflare configuration files include the 404 page',
        builder.CONFIG_FILES.includes('404.html') &&
        ['_headers', '_redirects', '_routes.json'].every((f) => builder.CONFIG_FILES.includes(f)));
    const files = builder.collectSiteFiles();
    check('the site itself is collected', files.includes('index.html') && files.includes('sw.js') &&
        files.includes('manifest.json') && files.some((f) => f.startsWith('js/')) && files.some((f) => f.startsWith('css/')));
    const insideExcluded = files.filter((f) => [...builder.EXCLUDED_DIRS].some((d) => f.startsWith(d + '/')));
    check('the only collected paths inside an excluded directory are the declared browser-facing exceptions',
        insideExcluded.every((f) => builder.BROWSER_FACING_IN_EXCLUDED_DIRS.has(f)),
        JSON.stringify(insideExcluded));
    check('every declared exception is actually collected',
        [...builder.BROWSER_FACING_IN_EXCLUDED_DIRS].every((f) => files.includes(f)));
    check('no .env, key or certificate can be collected',
        !files.some((f) => /(^|\/)\.env/.test(f) || /\.(pem|key)$/.test(f)));

    const out = path.join(ROOT, 'cloudflare-dist');
    if (check('cloudflare-dist/ has been built', fs.existsSync(out))) {
        for (const required of ['index.html', 'sw.js', 'manifest.json', '_headers', '_redirects', '_routes.json',
            '404.html', 'css', 'js', 'data', 'images', 'webfonts', 'google-auth-callback.html', 'checkout.html']) {
            check(`cloudflare-dist/${required} is published`, fs.existsSync(path.join(out, required)));
        }
        for (const forbidden of ['netlify.toml', 'wrangler.jsonc', '_worker.js', 'backend', 'netlify', 'functions',
            'supabase', 'tools', '.git', 'package.json']) {
            check(`cloudflare-dist/${forbidden} is NOT published`, !fs.existsSync(path.join(out, forbidden)));
        }
        eq('the published _routes.json is the Cloudflare source file',
            fs.readFileSync(path.join(out, '_routes.json'), 'utf8'), read('cloudflare/_routes.json'));
        eq('the published _headers is the Cloudflare source file',
            fs.readFileSync(path.join(out, '_headers'), 'utf8'), read('cloudflare/_headers'));
        eq('the published _redirects is the Cloudflare source file',
            fs.readFileSync(path.join(out, '_redirects'), 'utf8'), read('cloudflare/_redirects'));
        eq('the published 404.html is the Cloudflare source file',
            fs.readFileSync(path.join(out, '404.html'), 'utf8'), read('cloudflare/404.html'));
        /* The PWA precache list must resolve inside the published directory —
         * a 404 there fails the service worker install and takes the offline
         * app down with it. */
        const sw = fs.readFileSync(path.join(out, 'sw.js'), 'utf8');
        const start = sw.indexOf('const PRECACHE_URLS = [');
        const list = sw.slice(start, sw.indexOf('\n];', start));
        const urls = [...list.matchAll(/^\s*'([^']+)'/gm)].map((m) => m[1]);
        check('the precache list was parsed', urls.length > 500, `${urls.length} entries`);
        const missing = urls
            .filter((u) => !/^https?:/.test(u))
            .map((u) => u.replace(/^\//, '').split('?')[0])
            .filter((u) => fs.existsSync(path.join(ROOT, u)) && !fs.existsSync(path.join(out, u)));
        check(`every precached local URL is published (${urls.length} entries)`, missing.length === 0,
            'missing: ' + JSON.stringify(missing.slice(0, 8)));

        /* Stronger: every local file the browser can ask for, found by scanning
         * the frontend sources for path-like string literals. This is how
         * rvt_service/methods.json — precached by sw.js and fetched as the
         * offline fallback by js/rvt-panel.js — was caught. */
        const sources = ['index.html', 'sw.js', 'checkout.html', 'manifest.json']
            .filter(exists)
            .concat((function walkDir(dir, acc) {
                for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
                    const rel = dir + '/' + entry.name;
                    if (entry.isDirectory()) { if (!['node_modules', '.git'].includes(entry.name)) walkDir(rel, acc); }
                    else if (/\.(js|css|json|html)$/.test(entry.name)) acc.push(rel);
                }
                return acc;
            })('js', []).concat((function walkDir2(dir, acc) {
                for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
                    const rel = dir + '/' + entry.name;
                    if (entry.isDirectory()) walkDir2(rel, acc);
                    else if (/\.(js|css|json|html)$/.test(entry.name)) acc.push(rel);
                }
                return acc;
            })('src', [])));
        const literal = /['"`](\/?[A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)+\.(?:json|js|css|png|jpe?g|svg|webp|ico|woff2?|ttf|html|geojson|txt|xml))['"`]/g;
        const referenced = new Set();
        for (const source of sources) {
            for (const m of read(source).matchAll(literal)) referenced.add(m[1].replace(/^\//, ''));
        }
        const unpublished = [...referenced]
            .filter((rel) => fs.existsSync(path.join(ROOT, rel)) && !fs.existsSync(path.join(out, rel)));
        check(`every local file the frontend references is published (${referenced.size} distinct paths scanned)`,
            unpublished.length === 0, 'unpublished: ' + JSON.stringify(unpublished.slice(0, 10)));
        check('the RVT offline fallback is published from an otherwise-excluded directory',
            fs.existsSync(path.join(out, 'rvt_service/methods.json')));
        eq('and nothing else from the Python RVT service is published',
            fs.readdirSync(path.join(out, 'rvt_service')).length, 1);

        /* Cloudflare Pages limits: 20,000 files per deployment, 25 MiB per file. */
        const publishedAll = (function count(dir, acc) {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) count(full, acc); else acc.push(full);
            }
            return acc;
        })(out, []);
        check(`the deployment is inside Cloudflare's 20,000-file limit (${publishedAll.length} files)`,
            publishedAll.length <= 20000);
        const oversize = publishedAll.filter((f) => fs.statSync(f).size > 25 * 1024 * 1024);
        check(`no published file exceeds Cloudflare's 25 MiB per-file limit`, oversize.length === 0, oversize.join(', '));
    }
}
{
    const build = read('tools/cloudflare-build.mjs');
    check('the Cloudflare build runs the SAME Corona script Netlify runs, from the repository root',
        /'tools\/build-corona-europe-catalog\.mjs'/.test(build) && /cwd: ROOT/.test(build));
    check('the Corona step tolerates a CAST outage, like netlify.toml\'s "|| true"',
        /tolerateFailure: true/.test(build));
    check('a committed snapshot is published when CAST is unreachable',
        /corona-europe-catalog\.snapshot\.json/.test(build));
    check('the generated Cloudflare modules are refreshed and parity-checked on every build',
        /sync-cloudflare-generated\.mjs/.test(build));
    check('the Corona implementation itself is not duplicated',
        !/fetchCoronaCatalog|buildCatalogPayload/.test(build) && exists('tools/build-corona-europe-catalog.mjs'));
    eq('the Corona build script still imports the shared Netlify library',
        /from '\.\.\/netlify\/lib\/corona-catalog\.mjs'/.test(read('tools/build-corona-europe-catalog.mjs')), true);
    check('data/corona-europe-catalog.json is still git-ignored (generated at deploy time)',
        /(^|\n)data\/corona-europe-catalog\.json(\n|$)/.test(read('.gitignore')));
    check('the committed snapshot name is NOT git-ignored',
        !read('.gitignore').includes('corona-europe-catalog.snapshot.json'));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('7. The frontend keeps calling the same nine paths');
{
    const frontend = ['index.html', 'sw.js', ...fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f)]
        .filter(exists).map(read).join('\n');
    for (const [route] of ROUTES) {
        check(`the frontend still references ${route}`, frontend.includes(route));
    }
    check('the frontend never hardcodes a host-specific API base',
        !/[a-z0-9-]+\.pages\.dev\/api\//.test(frontend) && !/\/\.netlify\/functions\//.test(frontend));
    check('every frontend call to these APIs is same-origin (a relative /api path)',
        !/https?:\/\/detectlab\.(ro|eu)\/api\//.test(frontend));
    const supabase = read('src/lib/supabase.js');
    check('the Supabase integration is untouched', git(['diff', '--name-only', 'HEAD', '--', 'src']).trim() === '' && /supabase/i.test(supabase));
    check('the checkout / Stripe frontend is untouched', git(['diff', '--name-only', 'HEAD', '--', 'checkout.html', 'js/checkout.js', 'js/subscriptions.js']).trim() === '');
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('8. The two migration documents exist and honour the cross-references in the code');
{
    for (const doc of ['CLOUDFLARE_MIGRATION.md', 'CLOUDFLARE_DASHBOARD_CHECKLIST.md']) {
        check(`${doc} exists`, exists(doc));
        check(`${doc} is substantial`, read(doc).length > 8000, `${read(doc).length} bytes`);
    }
    const migration = read('CLOUDFLARE_MIGRATION.md');
    const checklist = read('CLOUDFLARE_DASHBOARD_CHECKLIST.md');

    /* Code comments cite these exact sections; the numbering must not drift. */
    const required = [
        ['## 2. The CORONA Europe catalogue', 'functions/_lib/corona-cache.mjs and tools/cloudflare-build.mjs cite §2'],
        ['## 4. Runtime compatibility audit', 'functions/_lib/runtime-shims.js cites §4'],
        ['## 5. Environment variables and secrets', 'runtime-shims.js and wrangler.jsonc cite §5'],
        ['### 6.4 `www` → apex', 'functions/_middleware.js and cloudflare/_redirects cite §6.4'],
        ['### 6.1 `cloudflare/_routes.json`', 'the _routes.json contract'],
        ['### 6.2 `cloudflare/_headers`', 'the _headers contract'],
        ['### 6.3 Not-found handling', 'the 404.html rationale'],
        ['## 9. Known limitations', 'the brief requires documented limitations'],
        ['## 10. Rollback to Netlify', 'the brief requires a rollback path']
    ];
    for (const [heading, why] of required) {
        check(`CLOUDFLARE_MIGRATION.md contains "${heading.slice(0, 42)}…" (${why})`, migration.includes(heading));
    }
    check('CLOUDFLARE_DASHBOARD_CHECKLIST.md §3 is the Redirect Rules section (cited by tools/cloudflare-smoke.mjs)',
        /\n## 3\. Redirect Rules/.test(checklist));
    check('the checklist numbers its sections 1–8 in order',
        [1, 2, 3, 4, 5, 6, 7, 8].every((n) => new RegExp(`\n## ${n}\\.`).test(checklist)));

    /* The secrets table must name every variable the code reads, and no other. */
    const known = ['DATAFORSYNINGEN_TOKEN', 'DATAFORDELER_USERNAME', 'DATAFORDELER_USER', 'DATAFORDELER_PASSWORD',
        'DANISH_PROXY_ALLOWED_ORIGINS', 'LANTMATERIET_WMS_USER', 'LANTMATERIET_WMS_PASSWORD',
        'LANTMATERIET_WMS_TOKEN', 'LANTMATERIET_WMS_URL', 'MML_API_KEY', 'FINLAND_PROXY_ALLOWED_ORIGINS'];
    for (const name of known) {
        check(`both documents list ${name}`, migration.includes(name) && checklist.includes(name));
    }
    const docVars = new Set([...migration.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map((m) => m[1])
        .filter((v) => /TOKEN|PASSWORD|USERNAME|USER|KEY|ORIGINS|URL|VERSION|SECRET/.test(v)));
    /* Repository identifiers that merely look credential-shaped. */
    const notVariables = ['NODE_VERSION', 'SECRET_PATTERNS', 'EXCLUDED_ROOT_FILES', 'EXCLUDED_DIRS',
        'BROWSER_FACING_IN_EXCLUDED_DIRS', 'KNOWN_ENV_VARS', 'CONFIG_FILES', 'PRECACHE_URLS'];
    const undocumented = [...docVars].filter((v) => !known.includes(v) && !notVariables.includes(v));
    check('no undocumented credential-shaped variable is mentioned', undocumented.length === 0,
        JSON.stringify(undocumented));

    /* Every route in the map must exist on both hosts. */
    for (const [route, fn] of ROUTES) {
        check(`the migration document maps ${route}`, migration.includes(route));
        check(`and names its Netlify twin ${fn}`, migration.includes(fn));
    }
    check('the documents state that nothing was deployed and Netlify is untouched',
        /NOT deployed/.test(migration) && /untouched/.test(migration) &&
        /Do not change production DNS/.test(checklist));
    check('the documents forbid any cross-market redirect',
        /the two markets must never be crossed/.test(migration) &&
        /cross-market redirect that is forbidden/.test(migration) &&
        /can ever send `\.ro` traffic to `\.eu` or vice versa/.test(migration) &&
        /may ever send one to the other/.test(checklist) &&
        /hardcodes \*\*its own\*\* apex/.test(checklist));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('9. Google OAuth callback routing — regression tests for BOTH URLs');
{
    /* The migration brief asks for regression tests covering the original
     * `.html` URL and any extensionless URL still supported. Group 3 pins the
     * `_headers` side and group 5 pins assets.html_handling; this group pins the
     * routing facts that make those two settings correct, from the files
     * themselves, so the suite also passes with no server running. The live
     * counterpart is group 2 of tools/cloudflare-smoke.mjs. */
    const sw = read('sw.js');
    const callbackPage = read('google-auth-callback.html');
    const pwaTest = read('test-pwa-google-auth.js');
    const netlifyToml = read('netlify.toml');

    /* ── 1. which URL is the real one ──────────────────────────────────────
     * The redirect URI handed to Supabase's OAuth helper is the `.html` URL, so
     * that is where Google actually sends the browser. It must be served
     * directly, not redirected. */
    eq('the OAuth redirect URI the app registers is the .html URL',
        /const callbackUrl = 'https:\/\/detectlab\.ro\/google-auth-callback\.html'/.test(pwaTest), true);
    check('the app\'s own test suite pins that URI', /redirectTo, callbackUrl/.test(pwaTest));
    check('and that the callback page scrubs the one-time code back to the .html path',
        /cb\.replaced, '\/google-auth-callback\.html'/.test(pwaTest));
    check('so the address bar keeps /google-auth-callback.html after sign-in — a reload must not 308',
        /replaceState|history\.replaceState/.test(callbackPage) || /replaced/.test(pwaTest));

    /* ── 2. the service worker bypass ─────────────────────────────────────
     * sw.js returns early for the callback so it never reaches the network-first
     * clone-and-cache pipeline, and the callback is not in the precache list.
     * With assets.html_handling:"none" the browser lands on the .html URL, which
     * is exactly what this bypass matches. */
    const bypass = /OAuth callbacks carry one-time codes[^\n]*\n\s*if \(requestURL\.origin === location\.origin && requestURL\.pathname === '(\/google-auth-callback\.html)'\) return;/
        .exec(sw);
    check('sw.js bypasses caching for the actual callback URL (exact-pathname early return)', !!bypass);
    eq('and the bypassed pathname is the URL Google redirects to', bypass && bypass[1], '/google-auth-callback.html');
    check('the callback document is NOT in the precache list',
        !/^\s*'google-auth-callback/m.test(sw) && !/PRECACHE[\s\S]{0,40000}'google-auth-callback/.test(sw));
    check('sw.js caches a 200 only, so no redirect response can enter Cache Storage',
        /response\.status === 200/.test(sw));
    eq('sw.js is byte-identical to HEAD — the PWA is unchanged by this migration',
        git(['diff', '--stat', 'HEAD', '--', 'sw.js']).trim(), '');
    eq('google-auth-callback.html is byte-identical to HEAD',
        git(['diff', '--stat', 'HEAD', '--', 'google-auth-callback.html']).trim(), '');

    /* ── 3. both spellings, on both hosts ────────────────────────────────
     * Netlify publishes "." and serves pretty URLs, so /google-auth-callback
     * resolves there too, but netlify.toml declares the header block for the
     * .html URL only. cloudflare/_headers covers BOTH, so the Cloudflare side is
     * a superset of the Netlify guarantee, and netlify.toml is untouched. */
    check('netlify.toml declares the callback header block for the .html URL',
        /for = "\/google-auth-callback\.html"/.test(netlifyToml));
    eq('netlify.toml is byte-identical to HEAD', git(['diff', '--stat', 'HEAD', '--', 'netlify.toml']).trim(), '');
    const headersText = read('cloudflare/_headers');
    for (const spelling of ['/google-auth-callback.html', '/google-auth-callback']) {
        const re = new RegExp('^' + spelling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'm');
        check(`cloudflare/_headers has a block for ${spelling}`, re.test(headersText));
        const body = headersText.slice(headersText.search(re));
        const block = body.slice(0, body.indexOf('\n\n'));
        for (const [h, v] of [['Cache-Control', 'no-store'], ['Referrer-Policy', 'no-referrer'],
                              ['X-Robots-Tag', 'noindex, nofollow']]) {
            check(`${spelling} → ${h}: ${v}`, new RegExp('^\\s*' + h + ': ' + v.replace(/,/g, '\\,') + '\\s*$', 'm').test(block));
        }
        eq(`${spelling} → exactly three headers, no fourth`,
            block.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length, 4);
    }
    check('the extensionless block is a Cloudflare-only addition, documented as such',
        /Cloudflare-only configuration file/.test(headersText));

    /* ── 4. the setting that removes the redirect ──────────────────────── */
    const wrangler = JSON.parse(read('wrangler.jsonc').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''));
    eq('assets.html_handling serves each .html file at its own path', wrangler.assets.html_handling, 'none');
    eq('and unmatched paths still 404 through the deployed page', wrangler.assets.not_found_handling, '404-page');
    check('no _redirects rule can rewrite the callback (the file declares no rule at all)',
        !read('cloudflare/_redirects').split('\n').some((l) => l.trim() && !l.trim().startsWith('#')));
    check('_routes.json keeps the Function away from the callback path, so the asset is served',
        !JSON.stringify(JSON.parse(read('cloudflare/_routes.json'))).includes('google-auth-callback'));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('10. The CORONA snapshot — a failed refresh can never destroy a good one');
{
    const snapshotModule = await import(new URL('file://' + path.join(ROOT, 'tools/corona-snapshot.mjs')).href);
    const { readCatalogue, publishCatalogue } = snapshotModule;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'detectlab-corona-'));
    const write = (name, content) => { const f = path.join(tmp, name); fs.writeFileSync(f, content); return f; };

    /* ── readCatalogue(): "is this file worth publishing?" ───────────────── */
    const GOOD = JSON.stringify({ source: 'cast', generated: '2020-01-01T00:00:00.000Z',
        bbox: [-25, 34, 60, 72], passes: 2, frames: 3, blocks: [{ id: 'A' }, { id: 'B' }] });
    eq('a catalogue with real entries is publishable', readCatalogue(write('good.json', GOOD)).ok, true);
    eq('and its counts are reported for the build log', readCatalogue(path.join(tmp, 'good.json')).blocks, 2);
    eq('a missing file is rejected, not created', readCatalogue(path.join(tmp, 'nope.json')).reason, 'absent');
    eq('truncated JSON is rejected', readCatalogue(write('truncated.json', GOOD.slice(0, 40))).ok, false);
    check('and says why', /not valid JSON/.test(readCatalogue(path.join(tmp, 'truncated.json')).reason));
    eq('an empty-blocks payload is rejected (a 200 from a reshaped upstream must not blank the layer)',
        readCatalogue(write('empty.json', JSON.stringify({ passes: 0, frames: 0, blocks: [] }))).ok, false);
    eq('a payload without blocks[] is rejected', readCatalogue(write('noblocks.json', '{"passes":1}')).ok, false);
    eq('a JSON array is rejected', readCatalogue(write('array.json', '[1,2,3]')).ok, false);
    eq('HTML is rejected', readCatalogue(write('html.json', '<html>challenge</html>')).ok, false);

    /* ── publishCatalogue(): the target is never made worse ─────────────── */
    const target = write('target.json', GOOD);
    const before = fs.readFileSync(target, 'utf8');
    eq('a good source is published', publishCatalogue(write('src-good.json', GOOD), target).published, true);
    eq('the published file is the source, byte for byte', fs.readFileSync(target, 'utf8'), GOOD);
    for (const [label, content] of [['truncated', GOOD.slice(0, 20)], ['empty-blocks', '{"blocks":[]}'],
                                    ['missing', null], ['HTML', '<html>x</html>']]) {
        const src = content === null ? path.join(tmp, 'does-not-exist.json') : write(`src-${label}.json`, content);
        const r = publishCatalogue(src, target);
        eq(`a ${label} source is refused`, r.published, false);
        eq(`and the existing good file survives a ${label} source unchanged`, fs.readFileSync(target, 'utf8'), before);
    }

    /* ── the real builder: a failed refresh must not touch an existing file ─
     * Run against a throwaway --out= path so data/ is never involved. In this
     * sandbox corona.cast.uark.edu is unreachable, so the run fails; a machine
     * WITH internet access would succeed, and then the file must be a valid
     * catalogue. Both outcomes are asserted, so the test is correct either way. */
    const victim = write('victim.json', GOOD);
    const victimBefore = fs.readFileSync(victim, 'utf8');
    const built = spawnSync(process.execPath,
        ['tools/build-corona-europe-catalog.mjs', `--out=${victim}`],
        { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
    if (built.status === 0) {
        eq('a successful refresh writes a publishable catalogue', readCatalogue(victim).ok, true);
    } else {
        check('the refresh failed (no egress to corona.cast.uark.edu from this sandbox)',
            /fetch failed|ENOTFOUND|ECONNRESET|network/i.test(String(built.stderr) + String(built.stdout)));
        eq('and the file it was pointed at still exists', fs.existsSync(victim), true);
        eq('byte for byte — a failed refresh neither removed nor corrupted it',
            fs.readFileSync(victim, 'utf8'), victimBefore);
        eq('the snapshot validator agrees it is still publishable', readCatalogue(victim).ok, true);
    }

    /* ── the build script routes every copy through that validator ──────── */
    const buildScript = read('tools/cloudflare-build.mjs');
    check('cloudflare-build.mjs imports the validator instead of copying files blindly',
        /from '\.\/corona-snapshot\.mjs'/.test(buildScript) && /readCatalogue/.test(buildScript));
    check('and never calls fs.copyFileSync on a catalogue without validating it first',
        !/fs\.copyFileSync\((CATALOGUE|SNAPSHOT)/.test(buildScript));
    check('an unpublishable build is reported, not silently published',
        /not publishable/.test(buildScript));

    /* ── the frontend consumes it from the SAME origin ─────────────────── */
    const coronaLayer = read('js/corona-wms-layer.js');
    check('js/corona-wms-layer.js requests the snapshot by a relative, same-origin path',
        /sources\.push\('data\/corona-europe-catalog\.json'\)/.test(coronaLayer));
    check('and only after an explicit window.CORONA_CATALOG_URL override',
        coronaLayer.indexOf('CORONA_CATALOG_URL') < coronaLayer.indexOf("'data/corona-europe-catalog.json'"));
    check('the runtime proxy stays the fallback', /\/api\/corona\/rasters/.test(coronaLayer));
    eq('js/corona-wms-layer.js is byte-identical to HEAD — the frontend is unchanged',
        git(['diff', '--stat', 'HEAD', '--', 'js/corona-wms-layer.js']).trim(), '');

    /* ── the Function can reach a deployed snapshot through env.ASSETS ─── */
    const cacheLib = read('functions/_lib/corona-cache.mjs');
    check('functions/_lib/corona-cache.mjs has an env.ASSETS tier', /env\.ASSETS|context\.env && context\.env\.ASSETS/.test(cacheLib));
    check('it re-clips with the shared bboxIntersects() rather than reimplementing it',
        /from '\.\.\/\.\.\/netlify\/lib\/corona-catalog\.mjs'/.test(cacheLib) && /bboxIntersects/.test(cacheLib));
    check('and it is validated, so a missing or empty asset keeps the honest 502',
        /blocks\.length === 0/.test(cacheLib) && /return null/.test(cacheLib));

    /* ── the state of the snapshot in THIS repository ─────────────────── */
    const liveCatalogue = path.join(ROOT, 'data/corona-europe-catalog.json');
    const liveSnapshot = path.join(ROOT, 'data/corona-europe-catalog.snapshot.json');
    console.log(`      · data/corona-europe-catalog.json          : ${fs.existsSync(liveCatalogue) ? readCatalogue(liveCatalogue).bytes + ' bytes' : 'ABSENT (git-ignored, built at deploy time)'}`);
    console.log(`      · data/corona-europe-catalog.snapshot.json : ${fs.existsSync(liveSnapshot) ? readCatalogue(liveSnapshot).blocks + ' blocks' : 'ABSENT — cannot be generated here (no egress to corona.cast.uark.edu)'}`);
    eq('the generator itself is byte-identical to HEAD (Netlify runs the same script)',
        git(['diff', '--stat', 'HEAD', '--', 'tools/build-corona-europe-catalog.mjs']).trim(), '');
    eq('netlify/lib/corona-catalog.mjs is byte-identical to HEAD',
        git(['diff', '--stat', 'HEAD', '--', 'netlify/lib/corona-catalog.mjs']).trim(), '');
    check('data/corona-europe-catalog.json stays git-ignored, exactly as before',
        read('.gitignore').split('\n').some((l) => l.trim() === 'data/corona-europe-catalog.json'));

    fs.rmSync(tmp, { recursive: true, force: true });
}

/* ═══════════════════════════════════════════════════════════════════════════ */
group('11. The Pages project slug is consistent everywhere — and is not a guess');
{
    /* The Dashboard could not be inspected from this sandbox (no credentials, no
     * route to api.cloudflare.com), so the slug must come from evidence in the
     * repository and must not drift between the four places that name it. This
     * group is the guard the migration brief asks for: "do not guess the slug". */
    const wrangler = JSON.parse(read('wrangler.jsonc').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''));
    const slug = wrangler.name;
    const migration = read('CLOUDFLARE_MIGRATION.md');
    const checklist = read('CLOUDFLARE_DASHBOARD_CHECKLIST.md');
    const countryModules = read('netlify/lib/map3d-country-modules.mjs');

    check('wrangler.jsonc declares a project name', typeof slug === 'string' && slug.length > 0, String(slug));
    check('the name is a legal Pages slug (lowercase alphanumerics and hyphens, ≤ 58 chars)',
        /^[a-z0-9][a-z0-9-]{0,56}[a-z0-9]$/.test(slug), slug);
    eq('it is not the Worker project that already exists in this repository', slug === 'detectlab-feedback', false);

    /* ── the evidence ───────────────────────────────────────────────────── */
    const host = `${slug}.pages.dev`;
    check(`netlify/lib/map3d-country-modules.mjs names https://${host}/ as the sandbox location`,
        countryModules.includes(`https://${host}/`) && countryModules.includes(`hostname: '${host}'`));
    eq('that file is byte-identical to HEAD — the evidence is pre-existing, not planted by this migration',
        git(['diff', '--stat', 'HEAD', '--', 'netlify/lib/map3d-country-modules.mjs']).trim(), '');
    const tracked = git(['grep', '-ho', '[a-z0-9-]*\\.pages\\.dev', 'HEAD', '--', '.']).split('\n').filter(Boolean);
    check(`${host} is the only *.pages.dev hostname at HEAD`,
        tracked.length > 0 && tracked.every((h) => h === host), JSON.stringify([...new Set(tracked)]));

    /* ── the two documents must agree with wrangler.jsonc ───────────────── */
    check(`CLOUDFLARE_MIGRATION.md §7.0 states the slug "${slug}"`,
        migration.includes(`"name": "${slug}"`) && /### 7\.0 The Pages project slug/.test(migration));
    check('§7.0 says plainly that the Dashboard could not be inspected',
        /not\*\* Dashboard-confirmed|could not be \*\*confirmed\*\*|could not be inspected/.test(migration));
    check('§7.0 cites the file and line the slug comes from',
        /netlify\/lib\/map3d-country-modules\.mjs:141/.test(migration));
    check('§7.0 warns that a wrong `name` creates a second project',
        /creates a new one|stray project/i.test(migration));
    check('and that the slug must be read from the Dashboard before deploying',
        /Before deploying|BEFORE ANY DEPLOY/i.test(migration));

    check(`CLOUDFLARE_DASHBOARD_CHECKLIST.md §1.2 names the same slug`,
        /\| 1\.2 \| Project name \| `[^`]*`/.test(checklist) && checklist.includes(`\`${slug}\``));
    /* Prose is wrapped across blockquote lines and carries markdown emphasis, so
     * both documents are flattened before the wording is asserted on. */
    const flat = (text) => text.replace(/\*\*/g, '').replace(/^>\s?/gm, '').replace(/\s+/g, ' ');
    const flatChecklist = flat(checklist);
    check('§1.2 tells the operator to confirm it, and not to create a second project',
        /confirm this against the Dashboard/i.test(flatChecklist) && /do not create a second one/i.test(flatChecklist));
    check('§1.2 offers the alternative: point wrangler.jsonc at the existing slug',
        /set `name` in `wrangler\.jsonc` to the existing slug/i.test(flatChecklist));

    /* A hostname label never contains a dot, so `<hash>.detectlab-4i1.pages.dev`
     * yields exactly `detectlab-4i1.pages.dev` and the optional `<hash>.` prefix. */
    const previewHosts = (text) => [...new Set(text.match(/[a-z0-9-]+\.pages\.dev/g) || [])];
    check(`every preview URL in the checklist uses ${host}`,
        previewHosts(checklist).every((h) => h === host), JSON.stringify(previewHosts(checklist)));
    check(`every preview URL in the migration document uses ${host}`,
        previewHosts(migration).every((h) => h === host || h === 'project.pages.dev'),
        JSON.stringify(previewHosts(migration)));

    /* ── nothing in the runtime depends on the slug ─────────────────────── */
    const middleware = read('functions/_middleware.js');
    eq('the middleware canonicalises exactly two hosts', Object.keys((await import(new URL('file://' + path.join(ROOT, 'functions/_middleware.js')).href)).CANONICAL_HOSTS).length, 2);
    check('and neither is a *.pages.dev host, so any preview slug is served unchanged',
        !/pages\.dev/.test(middleware));
    eq('the build output directory is unchanged by the slug', wrangler.pages_build_output_dir, 'cloudflare-dist');
    check('the smoke tool probes a preview host of the same slug',
        read('tools/cloudflare-smoke.mjs').includes(host));
}

console.log('\n' + '─'.repeat(72));
if (failures) {
    console.error(`✗ ${failures} of ${checks} checks FAILED`);
    process.exit(1);
}
console.log(`✓ all ${checks} checks passed — the migration is additive and the Netlify deployment is intact`);
