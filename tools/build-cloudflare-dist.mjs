#!/usr/bin/env node
/*
 * tools/build-cloudflare-dist.mjs
 * ───────────────────────────────────────────────────────────────────────────
 * Assembles the Cloudflare Pages build output directory (cloudflare-dist/) from
 * the repository root, and adds the three Cloudflare-only configuration files
 * from cloudflare/.
 *
 * WHY NOT PUBLISH THE REPOSITORY ROOT DIRECTLY
 *   Netlify publishes "." (netlify.toml [build] publish = ".", untouched) and
 *   Netlify also reads any `_headers` or `_redirects` file it finds in the
 *   publish directory. Cloudflare needs both files — `_headers` for the Google
 *   OAuth callback headers, `_routes.json` so that static assets never invoke a
 *   Function — and putting them at the repository root would have silently
 *   changed the live Netlify site. That is exactly what this migration must not
 *   do, so the Cloudflare deployment publishes a directory of its own.
 *
 *   Cloudflare Pages keeps Functions in `./functions` at the PROJECT ROOT
 *   (not inside the output directory), so wrangler.jsonc points
 *   pages_build_output_dir at cloudflare-dist/ while the routes below stay
 *   where Cloudflare expects them.
 *
 * WHAT IS COPIED
 *   Everything a browser can ask for: the HTML pages, css/, js/, images/,
 *   data/, src/, webfonts/, sw.js, manifest.json and the root-level documents.
 *
 * WHAT IS DELIBERATELY NOT COPIED (and why — see EXCLUDED_DIRS below)
 *   The server-side trees (netlify/, backend/, functions/, tools/, cloudflare/),
 *   the test harnesses and their artefacts, the separate Cloudflare Worker
 *   project in detectlab-feedback/, the Python services, the Supabase
 *   migrations, VCS metadata, dependencies and any .env file. Netlify publishes
 *   some of these today because it publishes "."; none of them is referenced by
 *   index.html, sw.js or the service worker's PRECACHE_URLS list (checked), so
 *   excluding them cannot change frontend behaviour — and it stops SQL
 *   migrations and server source from being served as static assets.
 *
 *   One exception is required: rvt_service/methods.json, which js/rvt-panel.js
 *   fetches as its offline fallback and sw.js precaches. It is published from
 *   an otherwise-excluded directory via BROWSER_FACING_IN_EXCLUDED_DIRS.
 *
 *   node tools/build-cloudflare-dist.mjs                 # build
 *   node tools/build-cloudflare-dist.mjs --check         # exit 1 if stale/missing
 *   node tools/build-cloudflare-dist.mjs --out=DIR       # a different output dir
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_DIR = path.join(ROOT, 'cloudflare');

/* ── what must never be published ─────────────────────────────────────────── */

/** Directories that are not part of the website. */
export const EXCLUDED_DIRS = new Set([
    '.git', '.github', '.wrangler', '.cache', '.idea', '.vscode',
    'node_modules', '__pycache__',
    'cloudflare-dist',                      /* the output directory itself */
    'netlify',                              /* the Netlify deployment (stays exactly as it is) */
    'backend',                              /* the Express service, deployed separately on Railway */
    'functions',                            /* Cloudflare Functions are read from the project root, not published */
    'cloudflare',                           /* the _headers/_redirects/_routes.json sources; copied explicitly below */
    'tools',                                /* build and verification scripts */
    'test', 'test-results',                 /* fixtures and Playwright artefacts */
    'supabase',                             /* SQL migrations — must not be a public static asset */
    'rvt_service',                          /* the Python RVT tile service, deployed separately */
    'scripts_conflicts',                    /* Python data-build scripts */
    'detectlab-feedback',                   /* a SEPARATE Cloudflare Worker project with its own wrangler.toml */
    'samples'
]);

/** Root-level files that are hosting/build configuration, not website content. */
export const EXCLUDED_ROOT_FILES = new Set([
    '.gitignore', '.gitattributes', '.editorconfig',
    'netlify.toml',                         /* the Netlify deployment's own config */
    'wrangler.jsonc', 'wrangler.toml',      /* this deployment's own config */
    'package-lock.json',                    /* the repository root has no package.json */
    '.dev.vars'
]);

/**
 * Names excluded at ANY depth (a nested dependency or cache directory), as
 * opposed to EXCLUDED_DIRS, which are matched on their path from the
 * repository root.
 */
const EXCLUDED_NAMES_AT_ANY_DEPTH = new Set(['node_modules', '__pycache__', '.git', '.wrangler', '.cache']);

/**
 * Browser-facing files that live inside a directory which is otherwise
 * excluded. Netlify publishes "." and therefore serves these today, so the
 * Cloudflare deployment must serve them too or the frontend breaks.
 *
 *   rvt_service/methods.json — the RVT parameter defaults (5 KB of JSON).
 *     js/rvt-panel.js line 576 fetches it as the offline fallback when the
 *     separate /api/rvt/* service is unreachable, and sw.js lists it in
 *     PRECACHE_URLS, so a missing copy would fail the service worker install.
 *     Everything else in rvt_service/ is the Python service itself, which runs
 *     on its own host and must not be published.
 *
 * test-cloudflare-config.mjs scans every local path the frontend references and
 * asserts each one is published, so this list cannot silently drift.
 */
export const BROWSER_FACING_IN_EXCLUDED_DIRS = new Set([
    'rvt_service/methods.json'
]);

/** Name patterns refused anywhere in the tree — a secret must never be published. */
const SECRET_PATTERNS = [
    /(^|\/)\.env(\.|$)/,
    /(^|\/)[^/]*\.pem$/,
    /(^|\/)[^/]*\.key$/,
    /(^|\/)credentials\.json$/,
    /(^|\/)service-account[^/]*\.json$/,
    /\.DS_Store$/,
    /\.log$/
];

function isSecretPath(relPath) {
    return SECRET_PATTERNS.some((re) => re.test(relPath));
}

/* ── the copy ─────────────────────────────────────────────────────────────── */

export function collectSiteFiles() {
    const files = [];
    const walk = (dir, rel) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const relPath = rel ? rel + '/' + entry.name : entry.name;
            if (entry.isDirectory()) {
                if (EXCLUDED_NAMES_AT_ANY_DEPTH.has(entry.name)) continue;
                if (EXCLUDED_DIRS.has(relPath)) {
                    /* Publish the browser-facing files that live inside it. */
                    for (const allowed of BROWSER_FACING_IN_EXCLUDED_DIRS) {
                        if (allowed.startsWith(relPath + '/') && fs.existsSync(path.join(ROOT, allowed))) files.push(allowed);
                    }
                    continue;
                }
                walk(path.join(dir, entry.name), relPath);
            } else if (entry.isFile()) {
                if (rel === '' && EXCLUDED_ROOT_FILES.has(entry.name)) continue;
                if (isSecretPath(relPath)) continue;
                files.push(relPath);
            }
        }
    };
    walk(ROOT, '');
    return files;
}

/** The Cloudflare-only configuration files, published at the output root. */
export const CONFIG_FILES = ['_headers', '_redirects', '_routes.json', '404.html'];

export function buildDist({ out, quiet = false } = {}) {
    const outDir = out || path.join(ROOT, 'cloudflare-dist');
    if (!outDir.startsWith(ROOT)) throw new Error('the output directory must stay inside the repository');

    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    const files = collectSiteFiles();
    let bytes = 0;
    for (const rel of files) {
        const src = path.join(ROOT, rel);
        const dest = path.join(outDir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        bytes += fs.statSync(dest).size;
    }

    for (const name of CONFIG_FILES) {
        const src = path.join(CONFIG_DIR, name);
        if (!fs.existsSync(src)) throw new Error(`cloudflare/${name} is missing — it is required by Cloudflare Pages`);
        fs.copyFileSync(src, path.join(outDir, name));
        bytes += fs.statSync(path.join(outDir, name)).size;
    }

    /* Sanity: the site must be recognisable, and no secret may have slipped in. */
    for (const required of ['index.html', 'manifest.json', 'sw.js', 'css', 'js', 'data']) {
        if (!fs.existsSync(path.join(outDir, required))) {
            throw new Error(`the build output is missing ${required} — the copy filter is wrong`);
        }
    }
    const published = fs.readdirSync(outDir);
    for (const forbidden of ['netlify.toml', 'wrangler.jsonc', '.git', 'backend', 'netlify', 'functions', 'supabase', 'tools', 'cloudflare']) {
        if (published.includes(forbidden)) throw new Error(`${forbidden} must not be published as a static asset`);
    }

    const corona = path.join(outDir, 'data/corona-europe-catalog.json');
    const summary = {
        outDir: path.relative(ROOT, outDir),
        files: files.length + CONFIG_FILES.length,
        megabytes: Number((bytes / (1024 * 1024)).toFixed(2)),
        coronaCatalogue: fs.existsSync(corona)
            ? Number((fs.statSync(corona).size / (1024 * 1024)).toFixed(2)) + ' MB'
            : 'absent — the runtime proxy /api/corona/rasters covers it (same as Netlify)'
    };
    if (!quiet) {
        console.log(`✓ ${summary.files} files (${summary.megabytes} MB) → ${summary.outDir}/`);
        console.log(`  ${CONFIG_FILES.join(' / ')} copied from cloudflare/`);
        console.log(`  data/corona-europe-catalog.json: ${summary.coronaCatalogue}`);
    }
    return summary;
}

/* ── --check: does the committed tree still produce this output? ──────────── */

function check(outDir) {
    const target = outDir || path.join(ROOT, 'cloudflare-dist');
    const missing = [];
    for (const rel of [...collectSiteFiles(), ...CONFIG_FILES]) {
        if (!fs.existsSync(path.join(target, rel))) missing.push(rel);
    }
    for (const name of CONFIG_FILES) {
        const a = path.join(CONFIG_DIR, name);
        const b = path.join(target, name);
        if (fs.existsSync(a) && fs.existsSync(b) &&
            fs.readFileSync(a, 'utf8') !== fs.readFileSync(b, 'utf8')) missing.push(name + ' (differs)');
    }
    if (missing.length) {
        console.error(`✗ ${target} is missing or stale (${missing.length} file(s)), e.g. ${missing.slice(0, 5).join(', ')}`);
        console.error('  run: node tools/build-cloudflare-dist.mjs');
        process.exit(1);
    }
    console.log(`✓ ${path.relative(ROOT, target)} is complete and in step with the repository`);
}

const argv = process.argv.slice(2);
const outArg = argv.find((a) => a.startsWith('--out='));
const out = outArg ? path.resolve(ROOT, outArg.slice('--out='.length)) : undefined;

if (argv.includes('--check')) check(out);
else buildDist({ out });
