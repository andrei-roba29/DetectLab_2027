'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('css/map-window-layers.css', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');

// A body-level PWA stack would paint above the entire map section regardless
// of any z-index assigned to panels within the map frame.
const frame = html.indexOf('<div class="map-frame">');
const stack = html.indexOf('<div id="pwa-br-stack"');
const wrapper = html.indexOf('<div class="map-wrapper">', frame);
assert(frame < stack && stack < wrapper, 'PWA controls share the map frame stacking context');
assert.equal((html.match(/id="pwa-br-stack"/g) || []).length, 1);
assert(!html.includes('body.is-pwa.transp-panel-open #pwa-br-stack'), 'uncovered controls remain available');

const panelRule = css.match(/\.map-frame #iosBldSettingsPanel,[\s\S]*?\{\s*z-index:\s*(\d+)/);
assert(panelRule);
const windowLayer = Number(panelRule[1]);
for (const selector of ['#iosfreeModal', '.hist-shift-panel', '.om-panel', '.offline-map-panel', '.offline-library', '.apm-panel', '#rvt-panel', '#map3d-focus', '.arch-report-host']) {
    assert(panelRule[0].includes(selector), `${selector} must be above map buttons`);
}
assert(windowLayer > 10200 && windowLayer < 10600, 'windows clear fullscreen controls without obscuring the globe gate');
assert(/body\.is-pwa \.map-frame \.transp-panel[\s\S]*?z-index:\s*10300\s*!important/.test(css));
assert(/html\.globe-gate-open \.map-frame\.is-fullscreen \.btn-close-fullscreen\s*\{\s*z-index:\s*10700\s*!important/.test(css));
assert(!/pointer-events\s*:/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'preserve existing window hit testing');
const url = 'css/map-window-layers.css?v=20261102-report-lidar-window';
assert(html.includes(url) && sw.includes(url), 'the new stylesheet is loaded and precached');
console.log('Map window stacking and PWA control containment: OK');
