// Regression test — the retired legacy "Harta Iosefină" canvas overlay.
//
// Reported on the "Other maps" card of Hărți istorice:
//   · a Josephine sheet appeared by itself when the layer was enabled,
//   · it could not be tapped/clicked,
//   · it ignored the Josephine opacity slider (0% still painted it),
//   · while zooming, its content changed scale inside a body that kept the
//     same on-screen size.
//
// Root cause: js/map-app.js still had a legacy `RotatedImageOverlay` that was
// activated by a place search even though index.html has no #iosfreeToggle,
// and toggleHistLayer treated a missing sub-toggle as "ON".  Its canvas was
// pointer-events:none (unclickable) and only the Josephine raster layer was
// wired to the opacity slider.  Its canvas also capped width/height at 8192
// WITHOUT scaling the drawing / CSS box, so deep zooms cropped the sheet and
// made its content drift inside a fixed rectangle.
//
// Run: node test-iosfree-retired.js  (from repo root)
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');
const app = read('js/map-app.js');
const html = read('index.html');

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(a, b, message) { assert.strictEqual(a, b, message); checks++; }

console.log('[Test] Legacy Iosefină overlay is retired and cannot distort or ignore opacity...');

/* ── 1. No legacy UI exists, so no legacy overlay may auto-activate ───── */
eq(html.indexOf('id="iosfreeToggle"'), -1, 'index.html ships no legacy iosfree sub-toggle');
eq(html.indexOf('id="iosfreeOpacitySlider"'), -1, 'index.html ships no legacy iosfree opacity slider');
eq(html.indexOf('id="iosfreeRow"'), -1, 'index.html ships no legacy iosfree row');

const searchStart = app.indexOf('window._iosFreeActivateSearch = function');
ok(searchStart > 0, 'the legacy search hook still exists (guarded, not dangling)');
const searchEnd = app.indexOf('\n                };', searchStart) + '\n                };'.length;
const searchSource = app.slice(searchStart, searchEnd);

// Execute the real guard with no toggle in the document.
function runSearchHook(toggle) {
    const calls = { removed: 0, looked: 0 };
    const context = {
        document: { getElementById: (id) => (id === 'iosfreeToggle' ? toggle : null) },
        _removeOverlay: () => { calls.removed++; },
        lookupLocality: () => { calls.looked++; },
        _currentLocality: 'old'
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(searchSource, context);
    context._iosFreeActivateSearch('Cluj-Napoca', 46.77, 23.59);
    return calls;
}
const noToggle = runSearchHook(null);
eq(noToggle.looked, 0, 'a search cannot fetch/display a sheet when there is no legacy toggle');
eq(noToggle.removed, 1, '…it clears any stale overlay instead');
const unchecked = runSearchHook({ checked: false });
eq(unchecked.looked, 0, 'an unchecked legacy toggle keeps the overlay off');
eq(unchecked.removed, 1, '…and removes a previous overlay');
const checked = runSearchHook({ checked: true });
eq(checked.looked, 1, 'an explicit, checked legacy toggle still works');
eq(checked.removed, 0, '…without clearing the sheet it is about to show');

/* ── 2. Master/sub toggles must never default a missing toggle to ON ──── */
ok(/var iosOn = !!\(iosToggle && iosToggle\.checked\);/.test(app),
    'toggleHistLayer treats a missing legacy toggle as OFF');
ok(!/var iosOn = !iosToggle \|\| iosToggle\.checked;/.test(app),
    'the old "missing toggle means ON" default is gone');
const histStart = app.indexOf('window.toggleHistLayer = function');
const histBlock = app.slice(histStart, histStart + 2200);
ok(/if \(!on \|\| !iosOn\) \{/.test(histBlock),
    'enabling the historical master layer cannot re-add an orphan legacy sheet');
ok(/if \(_currentOverlay && map\.hasLayer\(_currentOverlay\)\) \{/.test(histBlock),
    'an orphan overlay is removed, never re-added');

const placeStart = app.indexOf('function _placeOnMap(');
const placeBlock = app.slice(placeStart, placeStart + 1200);
ok(/var legacyToggle = document\.getElementById\('iosfreeToggle'\);/.test(placeBlock),
    '_placeOnMap checks for the legacy toggle first');
ok(/if \(!legacyToggle \|\| !legacyToggle\.checked\) \{[\s\S]{0,120}_removeOverlay\(\);[\s\S]{0,40}return;/.test(placeBlock),
    '_placeOnMap refuses to create a sheet without a checked toggle');

const toggleStart = app.indexOf('window.toggleIosfreeLayer = function');
const toggleBlock = app.slice(toggleStart, toggleStart + 900);
ok(/if \(!legacyToggle\) \{[\s\S]{0,160}_removeOverlay\(\);[\s\S]{0,40}return;/.test(toggleBlock),
    'toggleIosfreeLayer cannot revive the overlay when its toggle is absent');

/* ── 3. The legacy pane must not shield map clicks ───────────────────── */
const paneCreate = app.indexOf("map.createPane('iosfreePane');");
ok(paneCreate > 0, 'the legacy pane creation is still present for old sessions');
const paneBlock = app.slice(paneCreate, paneCreate + 500);
ok(/pointerEvents = 'none'/.test(paneBlock), 'the legacy pane is display-only (pointer-events:none)');
ok(!/iosfreePane'\)\.style\.pointerEvents = 'auto'/.test(app),
    'no code makes the legacy pane swallow clicks');

/* ── 4. Canvas cap scales the whole sheet instead of cropping it ──────── */
const classStart = app.indexOf('L.RotatedImageOverlay = L.Layer.extend({');
const classEnd = app.indexOf('L.rotatedImageOverlay =', classStart);
ok(classStart > 0 && classEnd > classStart, 'the legacy overlay class can be inspected');
const classSource = app.slice(classStart, classEnd) + '\n' +
    'L.rotatedImageOverlay = function (url, bounds, options) {' +
    ' return new L.RotatedImageOverlay(url, bounds, options); };';

ok(/var renderScale = Math\.min\(1, MAX_CANVAS \/ fullW, MAX_CANVAS \/ fullH\);/.test(classSource),
    'the backing store is capped by a render scale');
ok(/canvas\.style\.width  = fullW \+ 'px';/.test(classSource) &&
   /canvas\.style\.height = fullH \+ 'px';/.test(classSource),
    'the CSS box keeps the full logical size');
ok(/ctx\.setTransform\(renderScale, 0, 0, renderScale, 0, 0\);/.test(classSource),
    'the drawing is scaled with the backing store');

function fakeCanvas() {
    const calls = { transform: null, draw: null };
    const ctx = {
        setTransform(a, b, c, d, e, f) { calls.transform = [a, b, c, d, e, f]; },
        clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {},
        setLineDash() {}, strokeRect() {},
        drawImage(img, x, y, w, h) { calls.draw = [x, y, w, h]; }
    };
    return {
        style: {}, width: 0, height: 0, calls,
        getContext: () => ctx, parentNode: null
    };
}

function bootLegacyOverlay() {
    function Layer() {}
    Layer.extend = function (proto) {
        function C() { if (this.initialize) this.initialize.apply(this, arguments); }
        C.prototype = proto;
        return C;
    };
    const L = {
        Layer,
        setOptions(obj, options) { obj.options = options || {}; },
        latLngBounds(sw, ne) {
            return {
                getSouthWest: () => sw, getNorthEast: () => ne,
                getCenter: () => ({ lat: (sw.lat + ne.lat) / 2, lng: (sw.lng + ne.lng) / 2 })
            };
        }
    };
    const canvas = fakeCanvas();
    const context = {
        L,
        document: { createElement: () => canvas },
        Image: function Image() {},
        Math, Number, isFinite, console
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(classSource, context);

    const scale = 200000;                         // screen px per degree
    const map = {
        latLngToLayerPoint(ll) {
            return { x: (ll.lng - 23.59) * scale + 500, y: (46.77 - ll.lat) * scale + 350 };
        }
    };
    const sw = { lat: 46.70, lng: 23.45 }, ne = { lat: 46.84, lng: 23.73 };
    const bounds = {
        getSouthWest: () => sw, getNorthEast: () => ne,
        getCenter: () => ({ lat: 46.77, lng: 23.59 })
    };
    const ov = context.L.rotatedImageOverlay('data:image/png;base64,x', bounds, {
        rotation: -12, opacity: 0.8, pane: 'iosfreePane'
    });
    ov._map = map;
    ov._canvas = canvas;
    ov._img = { naturalWidth: 800, naturalHeight: 400 };
    ov._imgLoaded = true;
    ov._redraw();
    return { ov, canvas };
}

const legacy = bootLegacyOverlay();
const cw = legacy.canvas.width, ch = legacy.canvas.height;
const cssW = parseFloat(legacy.canvas.style.width), cssH = parseFloat(legacy.canvas.style.height);
ok(cw > 0 && ch > 0 && cw <= 8192 && ch <= 8192,
    'the backing store stays inside the 8192 px budget at a deep zoom');
ok(cssW > 8192, 'the logical sheet is wider than the backing store (the old code cropped here)');
ok(Math.abs(cssW / cssH - cw / ch) < 0.01,
    'the CSS box and the capped bitmap share the same aspect (nothing is cropped/stretched)');
ok(cssW > cw && cssH > ch, 'the CSS box is the full logical bbox, larger than the downsampled bitmap');
ok(Math.abs(legacy.canvas.calls.transform[0] - cw / cssW) < 1e-6,
    'the canvas transform matches the backing-store / CSS ratio');
const draw = legacy.canvas.calls.draw;
ok(draw && Math.abs(draw[2] / draw[3] - 2) < 0.001,
    'the image is drawn with its natural aspect, not stretched into a square');
eq(legacy.ov.setOpacity(0)._canvas.style.opacity, 0, 'opacity 0 reaches the legacy canvas itself');
eq(legacy.ov.setOpacity(1)._canvas.style.opacity, 1, 'opacity returns when raised');

console.log('✓ iosfree-retired: ' + checks + ' checks passed');
