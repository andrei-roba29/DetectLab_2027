#!/usr/bin/env node
/*
 * tools/cloudflare-build.mjs
 * ───────────────────────────────────────────────────────────────────────────
 * THE Cloudflare Pages build command for DetectLab:
 *
 *     node tools/cloudflare-build.mjs
 *
 * (Dashboard → Workers & Pages → detectlab → Settings → Build →
 *  Build command: `node tools/cloudflare-build.mjs`,
 *  Build output directory: `cloudflare-dist`. Nothing else is configured.)
 *
 * It runs three steps, in the order Netlify's own pipeline implies:
 *
 *   1. node tools/sync-cloudflare-generated.mjs
 *      Regenerate functions/_generated/* from their canonical sources and prove
 *      runtime parity with them. Fails the build on drift — the Cloudflare
 *      deployment may never serve allow-lists or tile maths that differ from
 *      Netlify's.
 *
 *   2. node tools/build-corona-europe-catalog.mjs
 *      THE SAME SCRIPT, FROM THE SAME DIRECTORY, that netlify.toml runs
 *      (`command = "node tools/build-corona-europe-catalog.mjs || true"`).
 *      The Corona catalogue implementation is not duplicated: the script keeps
 *      importing netlify/lib/corona-catalog.mjs and keeps writing
 *      data/corona-europe-catalog.json. The `|| true` tolerance is reproduced
 *      here — a temporarily unavailable corona.cast.uark.edu must not fail the
 *      deployment — and is extended with a committed-snapshot fallback, see §2
 *      of CLOUDFLARE_MIGRATION.md.
 *
 *   3. node tools/build-cloudflare-dist.mjs
 *      Assemble cloudflare-dist/: the site Netlify publishes from "." plus
 *      _headers, _redirects and _routes.json from cloudflare/.
 *
 * Options
 *   --update-corona-snapshot  after a SUCCESSFUL live build, also refresh
 *                             data/corona-europe-catalog.snapshot.json (the
 *                             committed fallback). Run this from a machine with
 *                             internet access, then commit the file.
 *   --skip-corona             do not contact CAST at all (offline/local builds)
 *   --no-verify               skip the parity check in step 1 (not recommended)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readCatalogue, publishCatalogue } from './corona-snapshot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOGUE = path.join(ROOT, 'data/corona-europe-catalog.json');
const SNAPSHOT = path.join(ROOT, 'data/corona-europe-catalog.snapshot.json');


const argv = process.argv.slice(2);
const updateSnapshot = argv.includes('--update-corona-snapshot');
const skipCorona = argv.includes('--skip-corona');
const noVerify = argv.includes('--no-verify');

function run(command, args, { tolerateFailure = false, label = '' } = {}) {
    console.log(`\n── ${label || command + ' ' + args.join(' ')} ──`);
    const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: false });
    const failed = result.status !== 0;
    if (failed && !tolerateFailure) {
        console.error(`\n✗ Cloudflare build failed at: ${label || command + ' ' + args.join(' ')}`);
        process.exit(result.status || 1);
    }
    return !failed;
}

/* ── 1. the generated Cloudflare copies of the Node-only server modules ───── */
run(process.execPath,
    ['tools/sync-cloudflare-generated.mjs', ...(noVerify ? ['--no-verify'] : [])],
    { label: 'step 1/3 — regenerate functions/_generated and verify runtime parity' });

/* ── 2. the CORONA Europe catalogue snapshot (identical to the Netlify step) ─ */
console.log('\n── step 2/3 — CORONA Europe catalogue (same script Netlify runs) ──');
let catalogueBuilt = false;
if (skipCorona) {
    console.log('= skipped (--skip-corona)');
} else {
    /* `|| true`: exactly the tolerance netlify.toml declares. */
    catalogueBuilt = run(process.execPath, ['tools/build-corona-europe-catalog.mjs'],
        { tolerateFailure: true, label: 'node tools/build-corona-europe-catalog.mjs || true' });
}

const built = readCatalogue(CATALOGUE);

if (catalogueBuilt && built.ok) {
    if (updateSnapshot) {
        /* Replace the committed fallback ONLY with a catalogue that has real
         * entries. An empty or unparseable build leaves the previous snapshot
         * exactly as it was — never truncated, never removed. */
        const { published, source: fresh } = publishCatalogue(CATALOGUE, SNAPSHOT);
        if (!published) throw new Error('unreachable: built.ok was already verified');
        const mb = (fs.statSync(SNAPSHOT).size / (1024 * 1024)).toFixed(2);
        console.log(`✓ refreshed the committed fallback data/corona-europe-catalog.snapshot.json (${mb} MB) — commit it`);
        console.log(`  ${fresh.passes} passes / ${fresh.frames} frames / ${fresh.blocks} blocks`);
    } else if (!fs.existsSync(SNAPSHOT)) {
        console.log('! no committed fallback yet. To make the Cloudflare build survive an');
        console.log('  unreachable CAST server, run once from a machine with internet access:');
        console.log('      node tools/cloudflare-build.mjs --update-corona-snapshot');
        console.log('  and commit data/corona-europe-catalog.snapshot.json.');
    }
} else if (catalogueBuilt && !built.ok) {
    /* The script exited 0 but produced nothing usable. Whatever was already in
     * data/ is left byte-for-byte alone: a bad refresh must never replace a good
     * catalogue with an empty one. */
    console.log(`! the build produced a catalogue that is not publishable (${built.reason}) —`);
    console.log('  data/corona-europe-catalog.json was NOT overwritten and the deployment continues');
    console.log('  with whatever was already there, or with the runtime proxy if there was nothing.');
} else if (!built.ok) {
    /* CAST is down (or was skipped) and nothing usable was generated this run. */
    const snapshot = readCatalogue(SNAPSHOT);
    const fallback = snapshot.ok ? publishCatalogue(SNAPSHOT, CATALOGUE) : { published: false };
    if (fallback.published) {
        const mb = (fs.statSync(CATALOGUE).size / (1024 * 1024)).toFixed(2);
        console.log(`✓ CAST unreachable — publishing the committed snapshot instead (${mb} MB)`);
        console.log('  data/corona-europe-catalog.snapshot.json → data/corona-europe-catalog.json');
        console.log(`  ${snapshot.passes} passes / ${snapshot.frames} frames / ${snapshot.blocks} blocks`);
    } else if (fs.existsSync(SNAPSHOT)) {
        console.log(`! the committed snapshot exists but is not publishable (${snapshot.reason}) —`);
        console.log('  it was NOT copied over data/corona-europe-catalog.json. Regenerate it from a');
        console.log('  machine with internet access:  node tools/cloudflare-build.mjs --update-corona-snapshot');
    } else {
        console.log('= CAST unreachable and no committed snapshot: the deployment continues');
        console.log('  without data/corona-europe-catalog.json, exactly as Netlify does.');
        console.log('  js/corona-wms-layer.js then falls back to the runtime proxy');
        console.log('  /api/corona/rasters, which on Cloudflare additionally keeps a');
        console.log('  datacentre copy of the last good catalogue (functions/_lib/corona-cache.mjs).');
    }
}

/* ── 3. the Pages build output directory ──────────────────────────────────── */
run(process.execPath, ['tools/build-cloudflare-dist.mjs'],
    { label: 'step 3/3 — assemble cloudflare-dist/ (site + _headers + _redirects + _routes.json)' });

console.log('\n✓ Cloudflare build complete. Deploy with:');
console.log('    npx wrangler@latest pages deploy cloudflare-dist');
console.log('  (or let the Cloudflare Dashboard run this build command — it publishes');
console.log('   pages_build_output_dir from wrangler.jsonc and picks up ./functions.)');
