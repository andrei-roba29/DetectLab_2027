'use strict';
// Run with node test-ios-pwa-keyboard.js. Device testing is still needed for
// the actual iOS keyboard, which cannot be opened by a simulated DOM event.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const helper = fs.readFileSync('js/ios-input-focus.js', 'utf8');

function setup(nav) {
    const body = {}, root = {}, trigger = {}, other = {};
    const document = { body, documentElement: root, activeElement: trigger };
    const window = { navigator: nav };
    vm.runInNewContext(helper, { window, document });
    let calls = 0;
    const input = { focus() { calls++; document.activeElement = input; } };
    return { window, document, trigger, other, input, calls: () => calls };
}
for (const nav of [
    { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' },
    { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 5 }
]) {
    const t = setup(nav);
    t.window.DetectLabInputFocus.autoFocus(t.input, t.trigger);
    assert.strictEqual(t.calls(), 0, 'iOS waits for the real tap');
    // Native user focus is not blocked by the helper.
    t.input.focus();
    assert.strictEqual(t.document.activeElement, t.input);
}
{
    const t = setup({ userAgent: 'desktop', platform: 'MacIntel', maxTouchPoints: 0 });
    t.window.DetectLabInputFocus.autoFocus(t.input, t.trigger);
    assert.strictEqual(t.calls(), 1, 'desktop autofocus remains available');
    t.document.activeElement = t.other;
    t.window.DetectLabInputFocus.autoFocus(t.input, t.trigger);
    assert.strictEqual(t.calls(), 1, 'late focus cannot steal another control');
}

// Exercise the actual inline visual-viewport handler with keyboard resize,
// focus switching, scrolling and blur. It must not modify the input itself.
const start = html.indexOf('                var authViewport = window.visualViewport;');
const end = html.indexOf('                // ── PWA ACCOUNT STACK RESTORED', start);
assert(start > -1 && end > start);
const events = {}, viewportEvents = {}, properties = {};
let editing = false;
const modal = {
    contains: el => !!el.inModal,
    classList: { toggle: (name, on) => { assert.strictEqual(name, 'pwa-auth-editing'); editing = on; } },
    style: { setProperty: (key, value) => { properties[key] = value; }, removeProperty: key => { delete properties[key]; } }
};
const document = { activeElement: null, getElementById: () => modal, addEventListener: (type, cb) => { events[type] = cb; } };
const viewport = { height: 800, offsetTop: 0, addEventListener: (type, cb) => { viewportEvents[type] = cb; } };
vm.runInNewContext(html.slice(start, end), { window: { visualViewport: viewport }, document, setTimeout: cb => cb() });
document.activeElement = { tagName: 'INPUT', inModal: true };
events.focusin();
viewport.height = 480; viewport.offsetTop = 20;
viewportEvents.resize();
assert(editing);
assert.strictEqual(properties['--pwa-auth-viewport-height'], '480px');
assert.strictEqual(properties['--pwa-auth-viewport-top'], '20px');
viewport.offsetTop = 35; viewportEvents.scroll();
assert.strictEqual(properties['--pwa-auth-viewport-top'], '35px');
document.activeElement = { tagName: 'TEXTAREA', inModal: true };
events.focusout();
assert(editing, 'switching fields keeps the viewport fitted');
document.activeElement = { tagName: 'BUTTON', inModal: false };
events.focusout();
assert(!editing);
assert.deepStrictEqual(properties, {});

for (const file of ['ios-input-focus', 'auth', 'friends', 'library-of-babel', 'subscriptions']) {
    const url = `js/${file}.js?v=20261101-ios-keyboard`;
    assert(html.includes(url) && sw.includes(url), `${url} must be loaded and precached`);
}
assert(html.indexOf('js/ios-input-focus.js?') < html.indexOf('js/friends.js?'));
assert(html.includes('body.is-pwa #authModal .auth-box'));
assert(sw.includes('detectlab-v369-ios-keyboard'));
console.log('iOS PWA input focus, viewport and offline shell checks passed');
