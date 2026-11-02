'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) { console.log('SKIP — install jsdom to test APM desktop resizing.'); process.exit(0); }
const dom = new JSDOM('<!doctype html><body><div class="map-frame"><section id="apmNextPanel" class="apm-panel" style="position:absolute;bottom:16px"><button>Settings</button></section></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
let desktop = true;
window.matchMedia = () => ({ matches: desktop });
const frame = window.document.querySelector('.map-frame');
const panel = window.document.querySelector('.apm-panel');
frame.getBoundingClientRect = () => ({ height: 560 });
panel.getBoundingClientRect = () => ({ height: parseFloat(panel.style.height) || 400, bottom: 800 });
window.eval(fs.readFileSync('js/window-resize.js', 'utf8'));
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
const handle = panel.querySelector('.dl-window-resize-handle');
function end() { handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })); }
end();
assert.equal(panel.style.height, '544px', 'desktop APM uses the same map-frame bounds as LiDAR');
assert.equal(handle.getAttribute('aria-valuemax'), '544');
assert.equal(panel.style.bottom, '16px', 'bottom stays anchored');
frame.classList.add('is-fullscreen');
end();
assert.equal(panel.style.height, '544px', 'fullscreen retains LiDAR frame limits');
frame.classList.remove('is-fullscreen');
window.document.body.classList.add('is-pwa');
end();
assert.equal(panel.style.height, '528px', 'PWA retains frame and bottom clearance');
window.document.body.classList.remove('is-pwa');
desktop = false;
end();
assert.equal(panel.style.height, '528px', 'mobile web retains frame limits');
console.log('APM desktop resize checks passed');
