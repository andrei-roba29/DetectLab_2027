// Regression test — Albanian raster map clicks never trigger generic identify popups.
//
// Raster WMS GetFeatureInfo often returns rendered tile metadata (e.g. band
// names) rather than useful features. Only layers explicitly marked
// `identify: true` may answer through this generic handler; actual vector
// features keep their own hit-test/click behavior.
//
// Run: node test-asig-click-guard.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const src = read('js/asig-albania-layers.js');
const CONFIG = require('./js/asig-albania-layers.config.js');

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };

console.log('[ASIG] map tap → feature info is gated to the Albanian footprint');

/* ── 1. The map-wide handler consults the gate, nothing else ────────────── */
const handler = /map\.on\('click', function \(event\) \{([\s\S]*?)\n        \}\);/.exec(src);
check(!!handler, 'the module still registers its map click handler');
check(/canQueryAt\(event\.latlng\)/.test(handler[1]),
    'the handler must go through canQueryAt() — the old hasActive() test let any tap through');
check(!/hasActive\(\)/.test(handler[1]),
    'the handler must not fall back to the persisted “has active layers” flag');
check(!/openFeatureInfo\([^)]*\)[\s\S]*openFeatureInfo/.test(handler[1]),
    'one tap opens one popup');

/* ── 2. canQueryAt() checks all four conditions ─────────────────────────── */
const gate = /function canQueryAt\(latlng\) \{([\s\S]*?)\n    \}/.exec(src);
check(!!gate, 'canQueryAt() must exist');
[
    [/runtime\.suppressed/, 'a suppressed group (leaving the country) must not answer'],
    [/runtime\.inCountry/, 'the selected-country gate must be enforced'],
    [/insideFootprint\(latlng\)/, 'the tap must be inside the ASIG footprint'],
    [/activeWmsLeaves\(\)\.length > 0/, 'an explicitly identifiable feature layer must actually be drawing']
].forEach(([re, message]) => check(re.test(gate[1]), message));

/* ── 3. “Active” now means on this map, not remembered in storage ───────── */
const leaves = /function activeWmsLeaves\(\) \{([\s\S]*?)\n    \}/.exec(src);
check(!!leaves, 'activeWmsLeaves() must exist');
check(/map\.hasLayer && !map\.hasLayer\(part\.layer\)/.test(leaves[1]) ||
      /!map\.hasLayer\(part\.layer\)/.test(leaves[1]),
    'a remembered-but-not-drawn layer must be skipped (hasLayer check)');
check(/var map = mapInstance\(\)/.test(leaves[1]),
    'the map instance is needed for that check');
check(/part\.leaf\.identify !== true/.test(leaves[1]),
    'raster WMS layers are skipped unless the catalogue explicitly opts them into identify');

/* ── 4. The footprint maths, run for real ───────────────────────────────── */
const fnSource = /function insideFootprint\(latlng\) \{[\s\S]*?\n    \}/.exec(src)[0];
const insideFootprint = new Function('CONFIG', fnSource + '\nreturn insideFootprint;')(
    { countryBounds: CONFIG.countryBounds }
);
const bounds = CONFIG.countryBounds;
check(JSON.stringify(bounds) === JSON.stringify([[39.538, 18.773], [42.758, 21.179]]),
    'the footprint is the published Albanian coverage box');
check(insideFootprint({ lat: 41.3275, lng: 19.8187 }) === true, 'Tirana answers');
check(insideFootprint({ lat: 42.4, lng: 19.5 }) === true, 'northern Albania answers');
check(insideFootprint({ lat: 40.0, lng: 20.1 }) === true, 'southern Albania answers');
/* The points that used to open the popup: the reporter's own taps. */
check(insideFootprint({ lat: 46.7712, lng: 23.6236 }) === false, 'Cluj-Napoca must not answer');
check(insideFootprint({ lat: 44.4268, lng: 26.1025 }) === false, 'Bucharest must not answer');
check(insideFootprint({ lat: 51.5074, lng: -0.1278 }) === false, 'London must not answer');
check(insideFootprint({ lat: 37.9838, lng: 23.7275 }) === false, 'Athens must not answer');
check(insideFootprint({ lat: 43.0, lng: 19.0 }) === false, 'just north of the border must not answer');
check(insideFootprint({ lat: 38.5, lng: 20.0 }) === false, 'just south of the border must not answer');
check(insideFootprint(null) === false, 'a tap without coordinates must not answer');
check(insideFootprint({}) === false, 'a malformed latlng must not answer');
check(insideFootprint({ lat: '41.3', lng: '19.8' }) === false,
    'string coordinates are not trusted');
/* The documented margin around the outline. */
check(insideFootprint({ lat: bounds[0][0] - 0.01, lng: bounds[0][1] - 0.01 }) === true,
    'a tap marginally outside the outline is still accepted (tile edge)');
check(insideFootprint({ lat: bounds[1][0] + 0.05, lng: bounds[1][1] + 0.05 }) === false,
    'the margin stays small — a tap well outside never answers');

/* ── 5. The gate is reachable from the public API (used by tests/tools) ── */
['canQueryAt', 'insideFootprint'].forEach((name) =>
    check(new RegExp('\\b' + name + ':\\s*' + name + ',').test(src),
        'API must expose ' + name));

/* ── 6. The intended behaviour is documented ────────────────────────────── */
const doc = read('ALBANIA_ASIG_LAYERS.md');
check(/raster.*silent|click on these layers is silent/i.test(doc),
    'the docs state that raster map clicks do not open generic popups');
check(/identify: true/.test(doc) && /vector renderers/i.test(doc),
    'the docs describe explicit WMS identify opt-in and separate vector hit-tests');
check(/footprint|selected country|country gate/i.test(doc),
    'the docs must state that identify candidates remain country/footprint gated');
const index = read('index.html');
const sw = read('sw.js');
const asigTag = 'js/asig-albania-layers.js?v=20261118-raster-click-silent';
check(index.includes(asigTag) && sw.includes("'" + asigTag + "'"),
    'the updated Albania click behavior is cache-busted and precached');

console.log('✓ raster layers are silent; only explicit identify layers can open a popup');
console.log('✓ candidates must be on the map, selected for Albania, and inside its footprint');
console.log('\n' + checks + ' checks passed — Albanian raster clicks do not trigger ASIG identify.');
