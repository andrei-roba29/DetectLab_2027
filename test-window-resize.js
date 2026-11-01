'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) { console.log('SKIP — install jsdom to test interactive window resizing.'); process.exit(0); }

const script = fs.readFileSync('js/window-resize.js', 'utf8');
const css = fs.readFileSync('css/window-resize.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
for (const asset of ['css/window-resize.css?v=20261101-account-social-no-grip', 'js/window-resize.js?v=20261101-account-social-no-grip']) {
    assert(html.includes(asset) && sw.includes(asset), 'new asset is loaded and precached');
}
assert(!/'\\.transp-panel'/.test(script), 'the layers window is never given a resize grip');
assert(/touch-action:\s*none\s*!important/.test(css), 'touch drag is not taken over by scrolling');
assert(/overflow-y:\s*auto\s*!important/.test(css), 'content remains scrollable');

(async () => {
    const dom = new JSDOM(`<!doctype html><html lang="en"><body>
        <div class="map-frame"><div class="transp-panel"><button>Layer control</button></div>
        <div id="rvt-body"><button>Settings</button></div></div>
        <div id="authModal" style="display:flex;align-items:center;flex-direction:row"><div class="auth-box"><input id="email"></div></div>
        <div style="display:flex;align-items:center"><div class="premium-box"></div></div>
        <div id="friendsManagerPanel"></div><div id="eventsManagerPanel"></div>
        <div class="pwa-account-wrapper"><div id="accountPanel"><button>Account</button></div></div>
        </body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    const frame = window.document.querySelector('.map-frame');
    frame.getBoundingClientRect = () => ({ height: 560 });
    const mockHeight = el => {
        el.getBoundingClientRect = () => ({ height: parseFloat(el.style.height) || 340 });
    };
    const layer = window.document.querySelector('.transp-panel');
    const rvt = window.document.querySelector('#rvt-body');
    const auth = window.document.querySelector('.premium-box');
    const gripFree = '.auth-box, #accountPanel, .pwa-account-wrapper, #friendsManagerPanel, #eventsManagerPanel';
    function assertGripFree() {
        window.document.querySelectorAll(gripFree).forEach(panel => {
            assert(!panel.querySelector('.dl-window-resize-handle'), panel.className || panel.id);
        });
    }
    [layer, rvt, auth].forEach(mockHeight);
    window.eval(script);
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    assert(!layer.querySelector('.dl-window-resize-handle'), 'the layers window carries no drag handle');
    assert(!layer.classList.contains('dl-window-resized'), 'the layers window is left un-resized');
    const handle = rvt.querySelector('.dl-window-resize-handle');
    assertGripFree();
    assert(handle && auth.querySelector('.dl-window-resize-handle'));
    assert.equal(handle.getAttribute('role'), 'separator');
    assert.equal(handle.getAttribute('aria-orientation'), 'horizontal');
    assert(!window.document.querySelector('#accountPanel > .dl-window-resize-handle'), 'PWA account window has no nested handle');
    const authHandle = auth.querySelector('.dl-window-resize-handle');
    authHandle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    assert.equal(auth.style.getPropertyValue('--dl-resize-shift'), '8px', 'centred dialog keeps its bottom edge when shrinking');
    function pointer(target, type, y, id = 4) {
        const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientY: y, button: 0 });
        Object.defineProperty(event, 'pointerId', { value: id });
        target.dispatchEvent(event);
    }
    pointer(handle, 'pointerdown', 100);
    pointer(window, 'pointermove', 200);
    assert.equal(rvt.style.height, '240px', 'dragging down shrinks the window');
    assert(rvt.classList.contains('dl-window-compact'), 'small windows get the compact content layout');
    assert.equal(rvt.style.getPropertyPriority('height'), 'important', 'PWA heights are overridden');
    assert.equal(handle.getAttribute('aria-valuenow'), '240');
    pointer(window, 'pointerup', 200);
    pointer(window, 'pointermove', 250);
    assert.equal(rvt.style.height, '240px', 'releasing the drag stops resizing');
    handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    assert.equal(rvt.style.height, '256px', 'keyboard increases height');
    handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    assert.equal(rvt.style.height, '96px', 'minimum preserves a usable scrollable window');
    handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    assert.equal(rvt.style.height, '544px', 'height is bounded by the map frame');
    assert(!rvt.classList.contains('dl-window-compact'), 'expanding restores the normal layout');
    assert(rvt.querySelector('button'), 'existing controls survive resizing');
    assert(!layer.style.height && !layer.classList.contains('dl-window-compact'), 'the layers window keeps its docked geometry while dialogs resize');
    rvt.innerHTML = '<button>Re-rendered settings</button>';
    const created = window.document.createElement('div');
    created.className = 'offline-library';
    frame.appendChild(created);
    await new Promise(resolve => window.setTimeout(resolve, 0));
    assert.equal(rvt.querySelectorAll('.dl-window-resize-handle').length, 1, 'grip returns after rerender');
    assert.equal(created.querySelectorAll('.dl-window-resize-handle').length, 1, 'dynamically added windows get a grip');
    window.document.body.appendChild(window.document.querySelector('#accountPanel'));
    window.document.querySelectorAll(gripFree).forEach(panel => {
        panel.innerHTML = '<button>Updated content</button>';
    });
    const desktopAccount = window.document.querySelector('#accountPanel');
    if (desktopAccount) window.document.body.appendChild(desktopAccount);
    const friends = window.document.createElement('div');
    friends.id = 'friendsManagerPanel';
    window.document.body.appendChild(friends);
    await new Promise(resolve => window.setTimeout(resolve, 0));
    assertGripFree();
    dom.window.close();
    console.log('Window resize: pointer, keyboard, limits, dynamic windows, PWA wiring and a grip-free layers window OK.');
})().catch(err => { console.error(err); process.exitCode = 1; });
