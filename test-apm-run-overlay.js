'use strict';
// The run overlay: animation on screen, blurred page behind, loading bar under it.
// Pure DOM/CSS module — the test drives it directly, no pipeline, no network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {JSDOM} = createRequire(path.join(__dirname, 'tools/apm-test/package.json'))('jsdom');
const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
let passed = 0;
function check(label, fn) { fn(); console.log('PASS ' + label); passed++; }

const EN = {
    'run.overlayTitle': 'Building the TRAIN model…',
    'run.overlayReportTrain': 'The archaeological report is running the APM Next-Gen TRAIN model…',
    'run.cancel': 'Cancel'
};
const t = (key, vars) => {
    let s = EN[key] || key;
    if (vars) Object.keys(vars).forEach(k => { s = s.replace('{' + k + '}', vars[k]); });
    return s;
};

function boot() {
    const dom = new JSDOM('<!doctype html><body></body>', {url: 'https://detectlab.example', runScripts: 'outside-only'});
    const w = dom.window;
    w.eval(read('js/apm-next/apm-run-overlay.js'));
    return {dom, w, O: w.DetectLabApmRunOverlay};
}

check('the module exposes create/close/isOpen and needs nothing else', () => {
    const {w, O, dom} = boot();
    assert.equal(typeof O.create, 'function');
    assert.equal(typeof O.close, 'function');
    assert.equal(typeof O.isOpen, 'function');
    assert.equal(O.isOpen(), false);
    assert.equal(w.document.querySelectorAll('.apm-run-overlay').length, 0, 'nothing is drawn until asked');
    dom.window.close();
});

check('the animation comes first, the loading bar directly under it', () => {
    const {dom, w, O} = boot();
    const view = O.create({t});
    const box = w.document.querySelector('.apm-run-overlay');
    assert(box, 'overlay is in the document');
    assert.equal(box.getAttribute('role'), 'dialog');
    assert.equal(box.getAttribute('aria-modal'), 'true');
    assert.equal(box.getAttribute('aria-label'), EN['run.overlayTitle']);
    const card = box.querySelector('.apm-run-card');
    const order = Array.from(card.children).map(n => n.className);
    assert.deepEqual(order, ['apm-run-head', 'apm-run-visual', 'apm-run-live', 'apm-run-step', 'apm-run-bar', 'apm-run-meta'],
        'window title → animation → bar → meta: ' + order.join(', '));
    assert.equal(card.querySelector('.apm-run-head .apm-run-title').textContent, EN['run.overlayTitle'],
        'the title is the window title bar');
    const visual = card.querySelector('.apm-run-visual');
    assert.equal(visual.querySelectorAll('.apm-run-ring').length, 3, 'three pulsing rings');
    assert(visual.querySelector('.apm-run-sweep'), 'and a rotating sweep');
    assert(visual.getAttribute('aria-hidden'), 'the decoration is not read out');
    const bar = card.querySelector('.apm-run-bar');
    assert.equal(bar.getAttribute('role'), 'progressbar');
    assert.equal(bar.getAttribute('aria-valuemin'), '0');
    assert.equal(bar.getAttribute('aria-valuemax'), '100');
    assert.equal(bar.getAttribute('aria-valuenow'), '0');
    assert.equal(w.document.querySelectorAll('.apm-run-title').length, 1);
    assert.equal(O.isOpen(), true);
    view.close();
    assert.equal(w.document.querySelector('.apm-run-overlay'), null, 'closing removes it');
    assert.equal(O.isOpen(), false);
    dom.window.close();
});

check('update() drives the bar, the percentage and the step text', () => {
    const {dom, w, O} = boot();
    const view = O.create({t});
    view.update({pct: 42.7, label: 'Downloading elevation (EU-DEM)…'});
    assert.equal(w.document.querySelector('.apm-run-fill').style.width, '43%', 'rounded, not truncated');
    assert.equal(w.document.querySelector('.apm-run-bar').getAttribute('aria-valuenow'), '43');
    assert.equal(w.document.querySelector('.apm-run-pct').textContent, '43%');
    assert.equal(w.document.querySelector('.apm-run-step').textContent, 'Downloading elevation (EU-DEM)…');
    assert.equal(w.document.querySelector('.apm-run-bar').getAttribute('aria-valuetext'), 'Downloading elevation (EU-DEM)…');
    [['-5', '0%'], ['150', '100%'], ['abc', '0%'], [null, '0%']].forEach(([input, expected]) => {
        view.update({pct: input});
        assert.equal(w.document.querySelector('.apm-run-fill').style.width, expected.replace('%', '%'), 'clamped: ' + input);
    });
    view.close();
    dom.window.close();
});

check('one overlay at a time: a second create replaces the first instead of stacking', () => {
    const {dom, w, O} = boot();
    O.create({t, titleKey: 'run.overlayReportTrain'});
    assert.equal(w.document.querySelectorAll('.apm-run-overlay').length, 1);
    O.create({t});
    const all = w.document.querySelectorAll('.apm-run-overlay');
    assert.equal(all.length, 1, 'still exactly one');
    assert.equal(w.document.querySelector('.apm-run-title').textContent, EN['run.overlayTitle'], 'the newest wins');
    O.close();
    assert.equal(w.document.querySelectorAll('.apm-run-overlay').length, 0);
    dom.window.close();
});

check('the panel preview is mounted inside the overlay, and the rings step aside', () => {
    const {dom, w, O} = boot();
    const host = w.document.createElement('div');
    host.className = 'apm-preview-host';
    const view = O.create({t, animationHost: host});
    const live = w.document.querySelector('.apm-run-live');
    assert.equal(live.contains(host), true, 'the real-site preview is the animation now');
    assert.equal(w.document.querySelector('.apm-run-visual').hidden, true, 'no second animation next to it');
    assert(w.document.querySelector('.apm-run-card').classList.contains('is-live'));
    view.close();
    assert.equal(host.parentNode, null, 'closing hands the preview back, detached and intact');
    assert.equal(host.className, 'apm-preview-host', 'the caller re-attaches the same node');
    dom.window.close();
});

check('a widget that stops on its own gives the animation back', () => {
    const {dom, w, O} = boot();
    const host = w.document.createElement('div');
    host.className = 'apm-preview-host';
    const view = O.create({t});
    view.setAnimation(host);
    assert.equal(w.document.querySelector('.apm-run-visual').hidden, true);
    assert.equal(w.document.querySelector('.apm-run-card').classList.contains('is-live'), true);
    view.clearAnimation();
    assert.equal(host.parentNode, null, 'the dead widget is detached');
    assert.equal(w.document.querySelector('.apm-run-visual').hidden, false, 'the rings return');
    assert(!w.document.querySelector('.apm-run-card').classList.contains('is-live'));
    view.close();
    dom.window.close();
});

check('cancel is offered only when the caller can cancel, and it reports back', () => {
    const {dom, w, O} = boot();
    O.create({t});
    assert.equal(w.document.querySelector('.apm-run-cancel'), null, 'no cancel button without a handler');
    O.close();
    let cancelled = 0, closed = 0;
    const view = O.create({t, onCancel: () => { cancelled++; }, onClose: () => { closed++; }});
    const btn = w.document.querySelector('.apm-run-cancel');
    assert(btn, 'cancel button present');
    assert.equal(btn.textContent, 'Cancel');
    btn.click();
    assert.equal(cancelled, 1, 'the caller decides what cancelling means');
    view.close();
    assert.equal(closed, 1, 'onClose runs once, on removal');
    view.close();
    assert.equal(closed, 1, 'and closing twice is harmless');
    dom.window.close();
});

check('the stylesheet blurs the page, keeps the bar, and honours reduced motion', () => {
    const css = read('css/next-gen-apm.css');
    const block = css.slice(css.indexOf('.apm-run-overlay {'));
    assert(block.length > 0, 'the overlay is styled');
    assert(/backdrop-filter:\s*blur\(/.test(css), 'the page behind is blurred');
    assert(/-webkit-backdrop-filter:\s*blur\(/.test(css), 'including Safari');
    assert(/@supports not \(\(backdrop-filter/.test(css), 'and there is an opaque fallback');
    assert(/\.apm-run-overlay \{[^}]*position:\s*fixed/.test(css), 'fixed, so it is on screen and not in the panel');
    assert(/\.apm-run-overlay \{[^}]*inset:\s*0/.test(css), 'covering the viewport');
    assert(/@keyframes apmRunPulse/.test(css) && /@keyframes apmRunSpin/.test(css), 'the animation is CSS, not a script');
    assert(/@media \(prefers-reduced-motion: reduce\)[^}]*\{[\s\S]{0,400}apm-run-ring/.test(css), 'motion can be switched off');
});

check('the module does no I/O and starts no timers', () => {
    const src = read('js/apm-next/apm-run-overlay.js');
    assert(!/\bfetch\s*\(|XMLHttpRequest|setTimeout|setInterval|requestAnimationFrame/.test(src),
        'no fetch/XHR/timers: the overlay only mirrors state it is given');
    assert(!/L\.|map\.|addLayer/.test(src), 'and touches no map');
});

console.log(`${passed} run-overlay checks passed.`);
