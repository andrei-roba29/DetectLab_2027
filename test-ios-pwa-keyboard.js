'use strict';
// The OS keyboard cannot be emulated by Node: test the standalone layout
// contract that differs from Safari and that used to fight native text entry.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const helper = fs.readFileSync('js/ios-input-focus.js', 'utf8');

function setup(nav, installed) {
    const events = {}, timers = [], classes = new Set(), sizes = [];
    const classList = { add: name => classes.add(name) };
    const root = { classList, style: { setProperty(key, value) { sizes.push([key, value]); } } };
    const body = { classList };
    const document = { body, documentElement: root, activeElement: body,
        addEventListener(type, handler) { events[type] = handler; } };
    const window = {
        navigator: nav, innerHeight: 800,
        matchMedia: () => ({ matches: installed }),
        addEventListener(type, handler) { events[type] = handler; },
        dispatchEvent() {}
    };
    vm.runInNewContext(helper, {
        window, document,
        Event: class { constructor(type) { this.type = type; } },
        setTimeout(cb) { timers.push(cb); }
    });
    return { window, document, body, root, events, timers, classes, sizes };
}
{
    const t = setup({ userAgent: 'iPhone', standalone: true }, true);
    assert(t.classes.has('dl-ios-native-layout'), 'normal-flow shell is active before any text field is touched');
    assert.deepStrictEqual(t.sizes, [['--dl-ios-screen-h', '800px']], 'use layout viewport, not physical screen.height');
    t.document.activeElement = { nodeType: 1, tagName: 'INPUT', type: 'password' };
    t.window.innerHeight = 460;
    t.events.orientationchange();
    t.timers.shift()();
    assert.strictEqual(t.sizes.length, 1, 'opening the keyboard cannot resize/reposition the map');
    t.document.activeElement = t.body;
    t.window.innerHeight = 390;
    t.events.orientationchange();
    t.timers.shift()();
    assert.deepStrictEqual(t.sizes[1], ['--dl-ios-screen-h', '390px'], 'rotation at rest updates the map');
    let focused = 0;
    t.window.DetectLabInputFocus.autoFocus({ focus() { focused++; } }, t.body);
    assert.strictEqual(focused, 0, 'iOS focus belongs to a real user tap');
}
{
    const t = setup({ userAgent: 'desktop', platform: 'MacIntel', maxTouchPoints: 0 }, true);
    assert(!t.classes.has('dl-ios-native-layout'), 'desktop shell unchanged');
    let focused = 0;
    t.window.DetectLabInputFocus.autoFocus({ focus() { focused++; } }, t.body);
    assert.strictEqual(focused, 1, 'desktop autofocus still works');
}
{
    const t = setup({ userAgent: 'iPhone', standalone: false }, false);
    assert(!t.classes.has('dl-ios-native-layout'), 'Safari tab is unaffected');
}
assert(html.includes('html.is-pwa.dl-ios-native-layout') &&
    html.includes('body.is-pwa.dl-ios-native-layout #map-section'));
assert(/body\.is-pwa\.dl-ios-native-layout #map-section\s*\{[^}]*position:\s*relative !important/s.test(html));
assert(html.includes("classList.contains('dl-ios-native-layout')"), 'iOS bypasses physical screen.height map fitter');
assert(/body\.is-pwa #authModal\.pwa-auth-editing\s*\{[^}]*bottom:\s*0;[^}]*height:\s*100%/s.test(html));
assert(!html.includes('dlKeyboardToggle'), 'no standalone keyboard toggle button');
assert(!html.includes('ios-fallback-keyboard'), 'native keyboard is not overlaid by app keys');
assert(!sw.includes('js/ios-fallback-keyboard.js'), 'fallback keyboard is not precached');
assert(!html.includes('dlIosKeyboard') && !html.includes('--dl-ios-keys-height'));
for (const file of ['ios-input-focus', 'friends', 'library-of-babel', 'subscriptions']) {
    const url = `js/${file}.js?v=20261101-ios-flow-keyboard`;
    assert(html.includes(url) && sw.includes(url), `${url} must be loaded and precached`);
}
assert(sw.includes('detectlab-v378-ios-oauth-return'));
console.log('iOS standalone layout and native text-entry regression checks passed');
