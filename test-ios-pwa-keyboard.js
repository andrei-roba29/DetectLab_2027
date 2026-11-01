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
assert(html.includes('js/ios-fallback-keyboard.js?v=20261101-ios-inline-fallback'));
assert(sw.includes('js/ios-fallback-keyboard.js?v=20261101-ios-inline-fallback'));
assert(/#dlIosKeyboard\s*\{[^}]*padding:\s*5px 4px 0;/s.test(html), 'no extra bottom padding');
assert(html.includes('#dlIosKeyboard::after'), 'native-reserved area has an opaque backdrop');
for (const file of ['ios-input-focus', 'friends', 'library-of-babel', 'subscriptions']) {
    const url = `js/${file}.js?v=20261101-ios-flow-keyboard`;
    assert(html.includes(url) && sw.includes(url), `${url} must be loaded and precached`);
}
assert(sw.includes('detectlab-v376-ios-top-level-oauth'));
// The provisional keyboard opens automatically for EVERY editable field, with
// no extra toggle and no second reservation below the OS-provided area.
{
    const source = fs.readFileSync('js/ios-fallback-keyboard.js', 'utf8');
    const events = {}, vvEvents = {}, timers = [];
    function el(tag) {
        const children = [];
        return {
            tagName: tag.toUpperCase(), nodeType: 1, children, offsetHeight: 220,
            style: { setProperty(key, value) { this[key] = value; }, removeProperty(key) { delete this[key]; } },
            setAttribute() {},
            addEventListener(type, cb) { this['on' + type] = cb; },
            appendChild(child) { children.push(child); },
            removeChild(child) { children.splice(children.indexOf(child), 1); },
            get firstChild() { return children[0]; }
        };
    }
    const body = el('body');
    const input = {
        tagName: 'INPUT', type: 'text', nodeType: 1, isConnected: true,
        value: 'Hi', selectionStart: 2, selectionEnd: 2, calls: 0,
        setRangeText(text, start, end) {
            this.value = this.value.slice(0, start) + text + this.value.slice(end);
            this.selectionStart = this.selectionEnd = start + text.length;
        },
        dispatchEvent() { this.calls++; return true; },
        blur() { doc.activeElement = body; events.focusout({ target: input }); }
    };
    const doc = { body, activeElement: body, createElement: el,
        addEventListener(type, cb) { events[type] = cb; } };
    const vv = { height: 480, offsetTop: 0,
        addEventListener(type, cb) { vvEvents[type] = cb; } };
    const win = { navigator: { userAgent: 'iPhone', standalone: true },
        innerHeight: 800, visualViewport: vv,
        matchMedia: () => ({ matches: true }),
        addEventListener(type, cb) { events['window-' + type] = cb; } };
    vm.runInNewContext(source, { document: doc, window: win,
        Event: class { constructor(type) { this.type = type; } },
        KeyboardEvent: class { constructor(type) { this.type = type; } },
        setTimeout(cb) { timers.push(cb); }
    });
    doc.activeElement = input;
    events.focusin({ target: input });
    assert.strictEqual(body.children.length, 1, 'only the keyboard is created, no toggle');
    const keyboard = body.children[0];
    assert.strictEqual(keyboard.id, 'dlIosKeyboard');
    assert.strictEqual(keyboard.style.bottom, '320px', 'keyboard sits above the native reserved space');
    assert.strictEqual(body.style['--dl-ios-keys-height'], '220px', 'auth form gets space above keys, not below them');
    assert.strictEqual(keyboard.style['--dl-os-reserved'], '320px', 'same native space gets an opaque backing, not extra padding');
    keyboard.children[1].children[0].onpointerdown({ preventDefault() {} });
    assert.strictEqual(input.value, 'Hiq');
    assert.strictEqual(input.calls, 1);
    keyboard.children[1].children[0].onclick({ preventDefault() {} });
    assert.strictEqual(input.value, 'Hiq', 'touch does not type twice');
    vv.height = 550;
    vvEvents.resize();
    assert.strictEqual(keyboard.style.bottom, '250px');
    input.blur();
    timers.shift()();
    assert(keyboard.hidden, 'keyboard closes when editing ends');
    assert.strictEqual(body.style['--dl-ios-keys-height'], undefined, 'form height restores after editing');
}
console.log('iOS standalone layout and fallback text-entry regression checks passed');
