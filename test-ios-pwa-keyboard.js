'use strict';
// DOM regression coverage. Only a real iOS device can confirm OS keyboard UI.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const helper = fs.readFileSync('js/ios-input-focus.js', 'utf8');

function setup(nav) {
    const handlers = {}, timers = [];
    const classes = new Set();
    const classList = { add: name => classes.add(name), remove: name => classes.delete(name) };
    const body = { classList }, root = { classList };
    const document = {
        body, documentElement: root, activeElement: body,
        addEventListener(type, cb) { handlers[type] = cb; }
    };
    const window = {
        navigator: nav, location: { search: '' },
        matchMedia: () => ({ matches: false }),
        dispatchEvent(event) { handlers[event.type]?.(event); }
    };
    vm.runInNewContext(helper, {
        window, document,
        Event: class { constructor(type) { this.type = type; } },
        setTimeout(cb) { timers.push(cb); return timers.length; },
        clearTimeout() {}
    });
    return { window, document, body, root, handlers, timers, classes };
}
const input = { nodeType: 1, tagName: 'INPUT', type: 'text' };
const other = { nodeType: 1, tagName: 'INPUT', type: 'email' };
{
    const t = setup({ userAgent: 'iPhone', standalone: true });
    assert(t.handlers.touchstart && t.handlers.focusin && t.handlers.focusout);
    t.handlers.touchstart({ target: input });
    assert(t.classes.has('dl-native-typing'), 'unlock occurs BEFORE native focus');
    t.document.activeElement = input;
    t.handlers.focusin({ target: input });
    t.handlers.focusout({ target: input });
    t.document.activeElement = other;
    t.handlers.focusin({ target: other });
    t.timers.shift()();
    assert(t.classes.has('dl-native-typing'), 'switching fields keeps document unlocked');
    t.handlers.focusout({ target: other });
    t.document.activeElement = t.body;
    t.timers.shift()();
    assert(!t.classes.has('dl-native-typing'), 'restore after leaving editable fields');
    assert(!helper.includes('createElement'), 'never render a fake keyboard');
    let focused = 0;
    t.window.DetectLabInputFocus.autoFocus({ focus() { focused++; } }, t.body);
    assert.strictEqual(focused, 0, 'iOS must use the native tap, not delayed focus');
}
{
    const t = setup({ userAgent: 'desktop', platform: 'MacIntel', maxTouchPoints: 0 });
    assert(!t.handlers.touchstart, 'desktop shell unchanged');
    let focused = 0;
    t.window.DetectLabInputFocus.autoFocus({ focus() { focused++; } }, t.body);
    assert.strictEqual(focused, 1, 'desktop autofocus stays available');
}

// The modal backdrop remains opaque over the map while the card fits the
// visual viewport; unlike the previous release there is no transparent gap.
assert(html.includes('html.is-pwa.dl-native-typing') && html.includes('body.is-pwa.dl-native-typing #map-section'));
assert(/body\.is-pwa #authModal\.pwa-auth-editing\s*\{[^}]*bottom:\s*0;[^}]*height:\s*100%/s.test(html));
assert(html.includes("classList.contains('dl-native-typing')"));
assert(html.includes("addEventListener('dl:input-session-end'"));
assert(!html.includes('dlFallbackKeyboard') && !html.includes('dlKeyboardToggle'));
for (const file of ['ios-input-focus', 'auth', 'friends', 'library-of-babel', 'subscriptions']) {
    const url = `js/${file}.js?v=20261101-ios-native-keyboard`;
    assert(html.includes(url) && sw.includes(url), `${url} must be loaded and precached`);
}
assert(sw.includes('detectlab-v372-ios-native-keyboard'));
console.log('iOS PWA native text-entry layout and offline shell checks passed');
