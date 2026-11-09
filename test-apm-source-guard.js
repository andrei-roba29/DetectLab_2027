'use strict';
// Source guard for the site-source boundary.
//
// History: the identifier was previously banned from the whole working tree,
// because an earlier catalogue had to be removed everywhere. The ARIADNE portal
// provider now exists by explicit instruction, so the rule is scoped instead of
// absolute:
//
//   1. The identifier may appear ONLY in the sanctioned ARIADNE paths below.
//   2. The settlement pipeline and the panel must never mention it: Ariadne is a
//      separate provider with fixed roles, not a settlement source, and nothing in
//      the UI may offer it as one.
//
// Spelled as codepoints so this guard does not itself reintroduce the token in a
// way that the tree scan has to allowlist.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const token = String.fromCharCode(97, 114, 105, 97, 100, 110, 101);

const SANCTIONED = [
    path.join('js', 'apm-next', 'ariadne'),
    path.join('supabase', 'functions', 'ariadne'),
    path.join('supabase', 'functions', '_shared'),
    path.join('test', 'fixtures', 'ariadne'),
    path.join('backend', 'migrations', 'manual') + path.sep + '019_apm_ariadne_gateway.sql',
    'ARIADNE_PROVIDER.md',
    'test-apm-ariadne.mjs',
    'test-live-check-tools.mjs',
    'test-apm-source-guard.js',        // this file names the paths it allows
    path.join('tools', 'live-check', 'README.md')
];

// The pipeline files that must stay free of it, checked explicitly so a future
// edit cannot quietly wire the provider into settlement training.
const MUST_STAY_CLEAN = [
    path.join('js', 'apm-next', 'apm-ui.js'),
    path.join('js', 'apm-next', 'apm-providers.js'),
    path.join('js', 'apm-next', 'apm-pipeline.js'),
    path.join('js', 'apm-next', 'apm-sites.js'),
    path.join('js', 'apm-next', 'apm-core.js'),
    path.join('js', 'apm-next', 'apm-worker.js'),
    'index.html'
];

function sanctioned(rel) {
    return SANCTIONED.some(prefix => rel === prefix || rel.startsWith(prefix + path.sep));
}

const root = __dirname;
const outside = [];
const escapes = [];

function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['.git', 'node_modules'].includes(ent.name)) continue;
        const p = path.join(dir, ent.name);
        const rel = path.relative(root, p);
        if (ent.isDirectory()) { walk(p); continue; }
        if (!ent.isFile()) continue;
        const bytes = fs.readFileSync(p);
        if (bytes.subarray(0, 8192).includes(0)) continue;                  // binary
        const text = bytes.toString('utf8').toLowerCase();
        const mentions = text.includes(token) || p.toLowerCase().includes(token);
        if (!mentions) continue;
        if (sanctioned(rel)) continue;
        outside.push(rel);
    }
}

walk(root);
for (const rel of MUST_STAY_CLEAN) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    if (fs.readFileSync(p, 'utf8').toLowerCase().includes(token)) escapes.push(rel);
}

assert.deepEqual(outside, [], 'The provider identifier must stay inside its sanctioned paths');
assert.deepEqual(escapes, [], 'The settlement pipeline and the panel must not reference the provider');
console.log(`PASS site-source boundary: the provider identifier appears only inside ${SANCTIONED.length} sanctioned paths, and never in the settlement pipeline or the panel`);
