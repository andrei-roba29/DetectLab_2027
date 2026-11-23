#!/usr/bin/env node
'use strict';

/* Parent groups with child layers are navigational only: their own switches
 * stay hidden, while actual sublayers keep their independent switches.
 * Standalone layers (no sublayers) retain their switch. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };

const html = read('index.html');
const css = read('css/styles.css');
const sw = read('sw.js');
const parents = [
    'heritageToggle', 'histToggle', 'lidarToggle', 'ukHeritageToggle',
    'finlandToggle', 'romanToggle', 'hoardsToggle', 'histPremiumToggle', 'vegfpToggle'
];
for (const id of parents) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('<label\\b[^>]*class="[^"]*dl-parent-layer-switch[^"]*"[^>]*>[\\s\\S]*?<input\\b[^>]*id="' + escaped + '"');
    check(re.test(html), id + ' is a hidden parent switch because the group has sublayers');
}

check(css.includes('.dl-parent-layer-switch') && /display:\s*none\s*!important/.test(css),
    'shared parent switch style hides parent controls without removing their backing state');
check(css.includes('#transpPanel .albania-section > .transp-layer-label .apm-toggle-switch'),
    'generated Albania section masters are hidden while their individual layer rows remain visible');
check(css.includes('#transpPanel .danish-group-row .lidar-style-switch'),
    'generated Danish group masters are hidden');
check(css.includes('#transpPanel .finland-group-master'),
    'generated Finland section masters are hidden');

for (const id of ['patrimoniuToggle', 'naturalProtectedToggle', 'austrianMapToggle',
    'otherMapsToggle', 'roman_shade_herod', 'vegfpPpiToggle', 'satellite60sToggle']) {
    const pos = html.indexOf('id="' + id + '"');
    check(pos >= 0, id + ' remains available as a sublayer control');
}
for (const id of ['battlesToggle', 'apmToggle', 'apm20Toggle']) {
    const pos = html.indexOf('id="' + id + '"');
    const label = html.lastIndexOf('<label', pos);
    const labelStart = html.lastIndexOf('>', label) + 1;
    const opening = html.slice(label, pos);
    check(pos >= 0 && label >= 0 && !/dl-parent-layer-switch/.test(opening),
        id + ' stays switchable as a standalone layer with no sublayers');
}

const cssTag = 'css/styles.css?v=20261118-leaf-switch-only';
check(html.includes(cssTag) && sw.includes("'" + cssTag + "'"),
    'the new parent/child switch styling is versioned and precached');
check(/const CACHE_NAME = 'detectlab-v434-merge-main-align-switch'/.test(sw),
    'the app shell cache is bumped for the merged switch hierarchy and alignment changes');

console.log('✓ parent groups have no visible switch; child layers and standalone layers do');
console.log(checks + ' checks passed');
