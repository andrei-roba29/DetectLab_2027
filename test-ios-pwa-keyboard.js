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
    const classList = {
        add: name => classes.add(name),
        toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }
    };
    const properties = {};
    const root = { classList, style: { setProperty(key, value) {
        properties[key] = value;
        if (key === '--dl-ios-screen-h') sizes.push([key, value]);
    } } };
    const body = { classList };
    const document = { body, documentElement: root, activeElement: body,
        addEventListener(type, handler) { events[type] = handler; } };
    const window = {
        navigator: nav, innerHeight: 800, innerWidth: 390, scrollX: 0, scrollY: 0,
        visualViewport: { height: 800, offsetTop: 0,
            addEventListener(type, handler) { events['viewport.' + type] = handler; } },
        scrollTo(options) { this.scrollX = options.left; this.scrollY = options.top; this.scrolled = true; },
        matchMedia: () => ({ matches: installed }),
        addEventListener(type, handler) { events[type] = handler; },
        dispatchEvent() {}
    };
    vm.runInNewContext(helper, {
        window, document,
        Event: class { constructor(type) { this.type = type; } },
        setTimeout(cb) { timers.push(cb); return cb; },
        clearTimeout(cb) { const at = timers.indexOf(cb); if (at >= 0) timers.splice(at, 1); }
    });
    return { window, document, body, root, events, timers, classes, sizes, properties,
        flush() { while (timers.length) timers.shift()(); } };
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
// Keyboard close, viewport changes and resume must not leave a short map or
// a document scroll offset behind. Test the real helper with native-event stubs.
{
    const t = setup({ userAgent: 'iPhone', standalone: true }, true);
    assert(!t.classes.has('dl-ios-editing'), 'document is locked at rest');
    assert.strictEqual(t.properties['--pwa-viewport-h'], '800px');
    assert.strictEqual(t.properties['--pwa-bleed'], '0px', 'iOS never inherits a physical-screen bleed');
    t.document.activeElement = { nodeType: 1, tagName: 'INPUT', type: 'search' };
    t.events.focusin();
    assert(t.classes.has('dl-ios-editing'), 'native focus unlocks document scrolling');
    t.window.innerHeight = 460;
    t.window.visualViewport.height = 460;
    t.window.scrollY = 180;
    t.events['viewport.resize']();
    t.flush();
    assert.strictEqual(t.sizes.length, 1, 'keyboard cannot shrink the map');
    assert(!t.window.scrolled, 'never reset scroll under a focused field');

    t.document.activeElement = t.body;
    t.events.focusout();
    t.flush(); // even a late-closing keyboard must not publish its short height
    assert(t.classes.has('dl-ios-editing'), 'wait for actual keyboard dismissal before locking');
    assert.strictEqual(t.sizes.length, 1);
    t.window.innerHeight = 800;
    t.window.visualViewport.height = 800;
    t.events['viewport.resize']();
    t.events['viewport.scroll']();
    t.flush();
    assert(!t.classes.has('dl-ios-editing'), 'document relocks after dismissal');
    assert.strictEqual(t.window.scrollY, 0, 'stale WebKit document offset is removed');
    assert.strictEqual(t.sizes.length, 1, 'unchanged height does not invalidate Leaflet');

    t.window.innerHeight = 820;
    t.window.visualViewport.height = 820;
    t.events.resize(); t.flush();
    assert.strictEqual(t.properties['--dl-ios-screen-h'], '820px', 'ordinary viewport resize refits the map');
    t.window.innerHeight = 830;
    t.window.visualViewport.height = 830;
    t.events.pageshow(); t.flush();
    assert.strictEqual(t.properties['--pwa-viewport-h'], '830px', 'resume refits after WebKit settles');
    t.window.innerHeight = 600;
    t.window.visualViewport.height = 600;
    t.events.resize(); t.flush();
    assert.strictEqual(t.properties['--dl-ios-screen-h'], '600px', 'large idle resize is not mistaken for a keyboard');
    t.window.innerWidth = 844;
    t.window.innerHeight = 390;
    t.window.visualViewport.height = 390;
    t.events.orientationchange(); t.flush();
    assert.strictEqual(t.properties['--dl-ios-screen-h'], '390px', 'landscape is not mistaken for a keyboard');
}
{
    const t = setup({ userAgent: 'iPhone', standalone: true }, true);
    const input = { nodeType: 1, tagName: 'INPUT', type: 'email' };
    t.document.activeElement = input;
    t.events.focusin();
    t.events.focusout(); // switching directly to another input
    t.events.focusin();
    t.flush();
    assert(t.classes.has('dl-ios-editing'), 'switching fields cannot relock native text entry');
    assert.strictEqual(t.sizes.length, 1);
}
const idleRule = html.match(/html\.is-pwa\.dl-ios-native-layout,\s*body\.is-pwa\.dl-ios-native-layout\s*\{([^}]+)\}/);
assert(idleRule && /overflow: hidden !important/.test(idleRule[1]), 'no scrollable empty tail at rest');
assert(/body\.is-pwa\.dl-ios-native-layout\.dl-ios-editing\s*\{[^}]*overflow-y: auto !important/s.test(html),
    'native keyboard retains the normal-flow scrolling escape hatch');
assert(html.includes('html.is-pwa.dl-ios-native-layout') &&
    html.includes('body.is-pwa.dl-ios-native-layout #map-section'));
assert(/body\.is-pwa\.dl-ios-native-layout #map-section\s*\{[^}]*position:\s*relative !important/s.test(html));
assert(html.includes("classList.contains('dl-ios-native-layout')"), 'iOS bypasses physical screen.height map fitter');
assert(/body\.is-pwa #authModal\.pwa-auth-editing\s*\{[^}]*bottom:\s*0;[^}]*height:\s*100%/s.test(html));
assert(!html.includes('dlKeyboardToggle'), 'no standalone keyboard toggle button');
assert(!html.includes('ios-fallback-keyboard'), 'native keyboard is not overlaid by app keys');
assert(!sw.includes('js/ios-fallback-keyboard.js'), 'fallback keyboard is not precached');
assert(!html.includes('dlIosKeyboard') && !html.includes('--dl-ios-keys-height'));
for (const file of ['friends', 'library-of-babel', 'subscriptions']) {
    const url = `js/${file}.js?v=20261101-ios-flow-keyboard`;
    assert(html.includes(url) && sw.includes(url), `${url} must be loaded and precached`);
}
const helperUrl = 'js/ios-input-focus.js?v=20261102-ios-viewport-settle';
assert(html.includes(helperUrl) && sw.includes(helperUrl), 'updated viewport helper is loaded and precached');
assert(Number(/const CACHE_NAME = 'detectlab-v(\d+)-/.exec(sw)[1]) >= 383);
console.log('iOS standalone layout and native text-entry regression checks passed');
