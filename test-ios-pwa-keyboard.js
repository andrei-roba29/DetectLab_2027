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
    const document = { body, documentElement: root, activeElement: trigger, addEventListener() {} };
    const window = { navigator: nav, addEventListener() {}, innerHeight: 800 };
    vm.runInNewContext(helper, { window, document, setTimeout() {} });
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

// A real iOS keyboard cannot be simulated in Node. Verify the local fallback:
// it appears only if the native visual viewport stayed full-size, edits the
// active field via input events, and disappears when the OS keyboard opens.
{
    const listeners = {}, viewportListeners = {}, timers = [];
    const classes = new Set();
    function el(tag) {
        const children = [];
        return {
            nodeType: 1, tagName: tag.toUpperCase(), children,
            style: { setProperty() {}, removeProperty() {} },
            classList: { add: x => classes.add(x), remove: x => classes.delete(x) },
            setAttribute() {},
            addEventListener(type, cb) { this['on' + type] = cb; },
            appendChild(child) { children.push(child); return child; },
            removeChild(child) { children.splice(children.indexOf(child), 1); },
            get firstChild() { return children[0]; }
        };
    }
    const body = el('body'), root = el('html');
    const doc = {
        body, documentElement: root, activeElement: body,
        createElement: el,
        addEventListener(type, cb) { listeners[type] = cb; }
    };
    const viewport = { height: 800, offsetTop: 0, addEventListener(type, cb) { viewportListeners[type] = cb; } };
    const win = {
        navigator: { userAgent: 'iPhone', standalone: true }, visualViewport: viewport, innerHeight: 800,
        addEventListener(type, cb) { listeners['window-' + type] = cb; }
    };
    const field = {
        nodeType: 1, tagName: 'INPUT', type: 'text', isConnected: true,
        value: 'old', selectionStart: 3, selectionEnd: 3, events: [],
        dispatchEvent(e) { this.events.push(e.type); return true; },
        setRangeText(text, start, end) {
            this.value = this.value.slice(0, start) + text + this.value.slice(end);
            this.selectionStart = this.selectionEnd = start + text.length;
        },
        blur() { doc.activeElement = body; listeners.focusout({ target: field }); }
    };
    vm.runInNewContext(helper, {
        window: win, document: doc,
        Event: class { constructor(type) { this.type = type; } },
        KeyboardEvent: class { constructor(type) { this.type = type; } },
        setTimeout(cb) { timers.push(cb); return timers.length; }, clearTimeout() {}
    });
    doc.activeElement = field;
    listeners.focusin({ target: field });
    assert.strictEqual(body.children.length, 1, 'manual fallback control is offered immediately');
    const toggle = body.children[0];
    timers.shift()();
    const keyboard = body.children[1];
    assert(keyboard && !keyboard.hidden && classes.has('dl-fallback-typing'));
    const letter = keyboard.children[1].children[0];
    letter.onclick({ preventDefault() {} });
    assert.strictEqual(field.value, 'oldq');
    assert.deepStrictEqual(field.events, ['input']);
    const backspace = keyboard.children[3].children.at(-1);
    backspace.onpointerdown({ preventDefault() {} });
    assert.strictEqual(field.value, 'old', 'backspace edits at the caret on touch down');
    backspace.onclick({ preventDefault() {} });
    assert.strictEqual(field.value, 'old', 'touch click cannot delete twice');
    viewport.height = 480;
    viewportListeners.resize();
    assert(keyboard.hidden, 'native keyboard replaces fallback');
    assert(!classes.has('dl-fallback-typing'));
    toggle.onclick({ preventDefault() {} });
    assert(!keyboard.hidden, 'manual control also works when viewport resize falsely signals a native keyboard');
    assert.strictEqual(keyboard.style.bottom, '320px', 'fallback stays in the visible viewport, above the empty OS keyboard area');
    field.blur();
    timers.shift()(); // deferred focusout (switch fields or dismiss)
    assert(keyboard.hidden && toggle.hidden, 'leaving text fields removes the fallback');
    viewport.height = 800;
    viewportListeners.resize();
    assert(keyboard.hidden, 'no fallback without an editable field');
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
    const url = `js/${file}.js?v=20261101-ios-keyboard-fallback`;
    assert(html.includes(url) && sw.includes(url), `${url} must be loaded and precached`);
}
assert(html.indexOf('js/ios-input-focus.js?') < html.indexOf('js/friends.js?'));
assert(html.includes('body.is-pwa #authModal .auth-box'));
assert(html.includes('#dlFallbackKeyboard[hidden]') && html.includes('body.is-pwa.dl-fallback-typing #authModal.show'),
    'keyboard is placed over the map and login form leaves room for it');
assert(sw.includes('detectlab-v371-ios-keyboard-fallback'));
console.log('iOS PWA input focus, viewport and offline shell checks passed');
