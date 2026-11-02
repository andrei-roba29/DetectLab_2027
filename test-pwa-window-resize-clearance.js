'use strict';
/* PWA regression: dragging a window's resize grip must never drop the window
   below its own bottom clearance (the "© Leafleet" line / home indicator). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) { console.log('SKIP — install jsdom to test PWA window resizing.'); process.exit(0); }

const script = fs.readFileSync('js/window-resize.js', 'utf8');
const css = fs.readFileSync('css/window-resize.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const tag = '20261102-pwa-window-resize-bottom-clearance';
for (const asset of [`css/window-resize.css?v=${tag}`, `js/window-resize.js?v=${tag}`]) {
    assert(html.includes(asset), `${asset} is loaded by index.html`);
    assert(sw.includes(asset), `${asset} is precached for offline PWA`);
}
// v385 introduced this fix; any later shell cache still carries it.
const cacheVersion = Number((sw.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1]);
assert(cacheVersion >= 385, 'shell cache is bumped so installed PWAs receive the fix');
// The blanket bottom:0 override is gone for good. Match the old rule exactly.
assert(!/\.dl-window-resized\s*\{[^}]*bottom:\s*0\s*!important/.test(css), 'no resized window is snapped to bottom:0');
assert(/\.dl-window-resized\.dl-window-release-top\s*\{[^}]*top:\s*auto\s*!important/.test(css), 'only stretched overlays release their top edge');
assert(/body\.is-pwa \.dl-window-resized\.dl-window-bottom-safe\s*\{[^}]*--pwa-bleed[^}]*env\(safe-area-inset-bottom/.test(css), 'PWA floor follows bleed + safe-area inset');
assert(script.includes('PWA_BOTTOM_FLOOR') && script.includes('clearBottomGuard'), 'the grip keeps each window\'s designed bottom');

(async () => {
    const dom = new JSDOM(`<!doctype html><html lang="en"><body class="is-pwa">
        <div class="map-frame">
          <section class="apm-panel" id="apmNextPanel" style="position:absolute;bottom:76px">APM Next Gen</section>
          <div class="offline-map-panel" style="position:absolute;bottom:8px">Offline maps</div>
          <div class="om-panel" style="position:absolute;top:70px">Top-anchored panel</div>
          <div class="hist-shift-panel" style="position:absolute;top:50%;transform:translateY(-50%)">Centred panel</div>
        </div>
        <div class="fr-chat-panel" style="position:fixed;top:0px;bottom:0px">Chat</div>
        </body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    const doc = window.document;
    Object.defineProperty(window, 'innerHeight', { value: 764, configurable: true });
    doc.documentElement.style.setProperty('--pwa-bleed', '16px');
    // Android PWA: the map frame is the physical screen (page viewport 764 + 16px bleed).
    const frame = doc.querySelector('.map-frame');
    frame.getBoundingClientRect = () => ({ height: 780, top: 0, bottom: 780 });
    const mockHeight = el => {
        el.getBoundingClientRect = () => ({ height: parseFloat(el.style.height) || 340, top: 0, bottom: 340 });
    };
    const apm = doc.querySelector('#apmNextPanel');
    const offline = doc.querySelector('.offline-map-panel');
    const chat = doc.querySelector('.fr-chat-panel');
    const topAnchored = doc.querySelector('.om-panel');
    const centred = doc.querySelector('.hist-shift-panel');
    [apm, offline, chat, topAnchored, centred].forEach(mockHeight);
    window.eval(script);
    doc.dispatchEvent(new window.Event('DOMContentLoaded'));

    function pointer(target, type, y, id = 7) {
        const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientY: y, button: 0 });
        Object.defineProperty(event, 'pointerId', { value: id });
        target.dispatchEvent(event);
    }
    function drag(panel, id) {
        const handle = panel.querySelector('.dl-window-resize-handle');
        assert(handle, 'window has a resize grip');
        pointer(handle, 'pointerdown', 100, id);
        pointer(window, 'pointermove', 140, id);   // drag down = shrink
        pointer(window, 'pointerup', 140, id);
        return handle;
    }

    // 1. APM Next Gen keeps its designed 76px clearance (16px + 44px + bleed).
    const apmHandle = drag(apm, 7);
    assert(apm.classList.contains('dl-window-resized'), 'APM window was resized');
    assert.equal(apm.style.getPropertyValue('bottom'), '76px', 'the drag does not overwrite the APM bottom offset');
    assert.equal(apm.style.getPropertyPriority('bottom'), '', 'no !important bottom is injected');
    assert(!apm.classList.contains('dl-window-bottom-safe'), 'a window already above the tag is not moved');
    assert(!apm.classList.contains('dl-window-release-top'), 'a bottom-only window keeps its top');
    assert.equal(apm.style.height, '300px', 'dragging down shrinks the window');
    // Growing it to the limit must leave 76px below and 16px above it.
    apmHandle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    const maxTop = 780 - 76 - 16;   // 688: frame - designed bottom - top guard
    assert(parseFloat(apm.style.height) <= maxTop, 'the tallest APM window still fits above its clearance');
    assert(parseFloat(apm.style.getPropertyValue('max-height')) <= maxTop, 'max-height is clamped to the free space');
    assert.equal(apm.style.getPropertyValue('bottom'), '76px', 'maximising also keeps the bottom offset');

    // 2. A window whose own clearance is below the © Leafleet line is lifted.
    const offlineHandle = drag(offline, 8);
    assert(offline.classList.contains('dl-window-bottom-safe'), 'short-clearance window gets the PWA floor');
    assert.equal(offline.style.getPropertyValue('bottom'), '8px', 'the own inline bottom offset is never overwritten');
    assert.equal(offline.style.getPropertyPriority('bottom'), '', 'no inline bottom is injected');
    assert(parseFloat(offline.style.height) <= 780 - 12 - 16 - 16, 'the lifted window is clamped against the floor');

    // 3. A stretched full-screen overlay releases its top but is NOT lifted.
    drag(chat, 9);
    assert(chat.classList.contains('dl-window-release-top'), 'inset:0 overlay releases top so height takes effect');
    assert(!chat.classList.contains('dl-window-bottom-safe'), 'full-screen overlays keep their own safe-area padding');
    assert.equal(chat.style.getPropertyValue('bottom'), '0px', 'stretched overlay keeps its own bottom');

    // 3b. A window anchored at a fixed px top may not grow past the bottom
    //     padding either (e.g. the Josephine-docked settings panel).
    const topHandle = drag(topAnchored, 10);
    topHandle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    assert(parseFloat(topAnchored.style.height) <= 780 - 70 - 16, 'a top-anchored window is clamped above the bottom edge');
    assert(!topAnchored.classList.contains('dl-window-bottom-safe'), 'a top-anchored window is not given a bottom offset');
    // A transform-centred window stays centred, so it must not be clamped as
    // if `top:50%` were a fixed anchor.
    const centredHandle = drag(centred, 11);
    centredHandle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    assert(parseFloat(centred.style.height) > 700, 'a centred window can still use the full viewport height');

    // 4. Leaving PWA mode (or the app running as a website) drops the lift and
    //    restores the window's own bottom.
    doc.body.classList.remove('is-pwa');
    offlineHandle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    assert(!offline.classList.contains('dl-window-bottom-safe'), 'the floor is PWA-only');
    assert.equal(offline.style.getPropertyValue('bottom'), '8px', 'the own bottom offset is restored');

    // 5. Rotation / bleed change re-measures the floor and the clamp.
    doc.body.classList.add('is-pwa');
    doc.documentElement.style.setProperty('--pwa-bleed', '32px');
    window.dispatchEvent(new window.Event('resize'));
    assert(offline.classList.contains('dl-window-bottom-safe'), 'the floor survives a resize reflow');
    assert.equal(offline.style.getPropertyValue('bottom'), '8px', 'the own offset survives the reflow');

    dom.window.close();
    console.log('PWA window resize: APM and every other window stay above the © Leafleet line OK.');
})().catch(err => { console.error(err); process.exitCode = 1; });
