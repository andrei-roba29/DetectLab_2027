/* A historical map moved in 2D must be drawn at that same position in 3D.
 *
 * The 2D side (js/hist-shift.js) remembers a per-pane offset in PROJECTED
 * metres (EPSG:3857) and applies it as a CSS transform on the layer's Leaflet
 * pane. MapLibre has no per-layer transform, so the correction travels as data:
 *
 *   · rasters        → the offset is in the tile template
 *                      (`dl2d://…/{z}/{x}/{y}?hs=<x>,<y>`) and each requested
 *                      tile is composed from the neighbours the shifted window
 *                      covers (js/map3d-mirror.js + js/map3d-terrain.js);
 *   · image overlays → the four corners move by the same metres.
 *
 * What this file protects:
 *   1. a position set in 2D is announced (`detectlab:histshiftchange`), so 3D
 *      can never keep drawing the old spot;
 *   2. the offset survives the round trip metre → pixel → metres at every zoom
 *      and every tile size, and the shifted sheet is composed from the RIGHT
 *      neighbours (the sheet moves, the world does not);
 *   3. a pane with no offset costs exactly what it cost before (one request
 *      per tile, the registry template, no composition).
 *
 * Usage: node test-hist-shift-3d.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const M_PER_PX_Z0 = 156543.03392;                  /* projected m/px at z0 (256 px world) */
const M_PER_DEG_LNG = (2 * Math.PI * 6378137) / 360;

console.log('[Test] historical map moved in 2D — the same position in 3D...');

/* ── a canvas that really moves pixels ──────────────────────────────────────
 * The composition under test is "draw these tiles at these offsets", so the
 * stand-in has to honour dx/dy/width/height — a canvas that ignores them would
 * assert nothing. Node has no canvas; this one keeps the pixels in a plain
 * buffer and does source-over by hand. */
class FakeCanvas {
    constructor(w, h) {
        this._w = Math.max(1, Math.round(w || 1));
        this._h = Math.max(1, Math.round(h || 1));
        this._pixels = new Uint8ClampedArray(this._w * this._h * 4);
    }
    get width() { return this._w; }
    set width(v) { this._w = Math.max(1, Math.round(v || 1)); this._pixels = new Uint8ClampedArray(this._w * this._h * 4); }
    get height() { return this._h; }
    set height(v) { this._h = Math.max(1, Math.round(v || 1)); this._pixels = new Uint8ClampedArray(this._w * this._h * 4); }
    getContext(kind) { return kind === '2d' ? this : null; }
    clearRect() { this._pixels.fill(0); }
    drawImage(image, dx, dy, dw, dh) {
        const src = image && image._pixels;
        if (!src) return;
        const sw = image.width || 1;
        const sh = image.height || 1;
        const w = Math.round(dw == null ? sw : dw);
        const h = Math.round(dh == null ? sh : dh);
        const ox = Math.round(dx || 0);
        const oy = Math.round(dy || 0);
        for (let y = 0; y < h; y += 1) {
            const py = oy + y;
            if (py < 0 || py >= this._h) continue;
            const sy = Math.min(sh - 1, Math.floor((y * sh) / h));
            for (let x = 0; x < w; x += 1) {
                const px = ox + x;
                if (px < 0 || px >= this._w) continue;
                const sx = Math.min(sw - 1, Math.floor((x * sw) / w));
                const si = (sy * sw + sx) * 4;
                const di = (py * this._w + px) * 4;
                const a = src[si + 3] / 255;
                if (a <= 0) continue;
                for (let c = 0; c < 3; c += 1) {
                    this._pixels[di + c] = Math.round(src[si + c] * a + this._pixels[di + c] * (1 - a));
                }
                this._pixels[di + 3] = Math.max(this._pixels[di + 3], src[si + 3]);
            }
        }
    }
    getImageData(x, y, w, h) { return { data: this._pixels.slice(), width: w, height: h }; }
    putImageData(frame) { this._pixels.set(frame.data); }
    toBlob(done) { done({ arrayBuffer: () => Promise.resolve(this._pixels.slice().buffer) }); }
}
const solidImage = (r, g, b, size) => ({
    width: size, height: size,
    _pixels: (function () {
        const d = new Uint8ClampedArray(size * size * 4);
        for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
        return d;
    })()
});
/* The bytes ARE the colour here: 4 bytes in, a solid tile out — enough to prove
 * which upstream tile every pixel of the composed tile came from. */
const fakeDecoder = (blob) => blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    return solidImage(bytes[0] || 0, bytes[1] || 0, bytes[2] || 0, 256);
});
const pixelAt = (canvas, x, y) => {
    const at = (y * canvas.width + x) * 4;
    return [canvas._pixels[at], canvas._pixels[at + 1], canvas._pixels[at + 2], canvas._pixels[at + 3]];
};

const indexHtml = read('index.html');
const swJs = read('sw.js');
const histShiftSource = read('js/hist-shift.js');
const mirrorSource = read('js/map3d-mirror.js');
const viewerSource = read('js/map3d-terrain.js');
const registrySource = read('js/layer-registry.js');

// ══════════════════════════════════════════════════════════════
// 1. The 2D side announces the new position
// ══════════════════════════════════════════════════════════════
{
    const listeners = {};
    const events = [];
    const store = {};
    function FakeEl(tag) {
        this.tagName = String(tag || 'div').toUpperCase();
        this.nodeType = 1;
        this.style = {};
        this.children = [];
        this._listeners = {};
        this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
        this.checked = false;
        this.value = '';
        this.textContent = '';
    }
    FakeEl.prototype.appendChild = function (c) { return c; };
    FakeEl.prototype.addEventListener = function (type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); };
    FakeEl.prototype.querySelector = function () { return new FakeEl('div'); };
    FakeEl.prototype.setAttribute = function () {};
    const panes = { pane_austrian: { style: { zIndex: '640' } }, pane_ww1: { style: { zIndex: '646' } } };
    const histLayers = [
        { options: { pane: 'pane_austrian', layers: 'austrian' }, _url: 'https://wms.example.org/wms', getTileUrl() { return 'x'; } },
        { options: { pane: 'pane_ww1', layers: 'ww1' }, _url: 'https://tiles.example.org/ww1', getTileUrl() { return 'y'; } }
    ];
    const container = new FakeEl('div');
    const map = {
        dragging: { enabled() { return true; }, enable() {}, disable() {} },
        getContainer() { return container; },
        getZoom() { return 12; },
        eachLayer(fn) { histLayers.forEach(fn); },
        getPane(name) { return panes[name] || null; },
        on() {}
    };
    const DEFS = [
        { id: 'hist.austrian', group: 'hist-free', title: { ro: 'Harta Austriacă', en: 'Austrian Map' } },
        { id: 'premium.ww1', group: 'hist-premium', title: { ro: 'Primul Război Mondial', en: 'WW1' } }
    ];
    class FakeCustomEvent {
        constructor(type, init) { this.type = type; this.detail = (init && init.detail) || {}; }
    }
    const win = {
        _dlMap: map,
        _currentLang: 'ro',
        CustomEvent: FakeCustomEvent,
        localStorage: { getItem(k) { return store[k] || null; }, setItem(k, v) { store[k] = v; } },
        DetectLabLayers: {
            get(id) { return DEFS.filter((d) => d.id === id)[0] || null; },
            matchDef(probe) { return DEFS.filter((d) => d.id === (probe.layers === 'austrian' ? 'hist.austrian' : 'premium.ww1'))[0] || null; }
        },
        setTimeout, clearTimeout, setInterval, clearInterval,
        dispatchEvent(ev) {
            events.push(ev);
            (listeners[ev.type] || []).slice().forEach((fn) => fn(ev));
            return true;
        },
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
    };
    const documentFake = { readyState: 'complete', documentElement: { lang: 'ro' }, createElement: (t) => new FakeEl(t), addEventListener() {} };
    const sandbox = { window: win, document: documentFake, console, CustomEvent: FakeCustomEvent };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(histShiftSource, sandbox, { filename: 'js/hist-shift.js' });
    const HS = win.DetectLabHistShift;
    assert(HS, 'DetectLabHistShift exported');
    assert.strictEqual(HS.CHANGE_EVENT, 'detectlab:histshiftchange', 'the event name is part of the API');

    let heard = 0;
    win.addEventListener(HS.CHANGE_EVENT, () => { heard += 1; });

    HS.setOffset('pane_austrian', 120, -40);
    assert.strictEqual(events.length, 1, 'setting an offset announces it once');
    assert.strictEqual(heard, 1, 'the listener on window hears it (that is where 3D listens)');
    const detail = events[0].detail;
    assert.strictEqual(detail.pane, 'pane_austrian', 'the event names the pane that moved');
    assert.deepStrictEqual({ x: detail.offset.x, y: detail.offset.y }, { x: 120, y: -40 }, 'with the offset in metres');
    assert.strictEqual(JSON.stringify(Object.keys(detail.offsets)), JSON.stringify(['pane_austrian']),
        'and the whole non-zero map, so a listener needs no second lookup');
    assert.strictEqual(detail.maxOffsetM, HS.MAX_OFFSET_M, 'the 3 km ceiling travels with it');

    HS.setOffset('pane_austrian', 120, -40);
    assert.strictEqual(events.length, 1, 're-setting the same position is not a change');

    HS.setOffset('pane_ww1', 0, 500);
    assert.strictEqual(events.length, 2, 'a second sheet moving is its own event');
    assert.strictEqual(JSON.stringify(HS.offsets()),
        JSON.stringify({ pane_austrian: { x: 120, y: -40 }, pane_ww1: { x: 0, y: 500 } }),
        'offsets() lists only the panes that are actually off their true position');

    HS.reset('pane_austrian');
    assert.strictEqual(events.length, 3, 'a reset is an announcement too — 3D has to put the sheet back');
    assert.deepStrictEqual({ x: events[2].detail.offset.x, y: events[2].detail.offset.y }, { x: 0, y: 0 });
    assert.strictEqual(JSON.stringify(Object.keys(HS.offsets())), JSON.stringify(['pane_ww1']), 'and it drops out of the offset map');
    assert.ok(store['dlHistShift.v1'].indexOf('pane_ww1') !== -1, 'the remaining offset is still persisted');
    console.log('  ✓ a position set (or reset) in 2D is announced with its pane and metres');
}

// ══════════════════════════════════════════════════════════════
// 2. The mirror turns an offset into tiles and corners
// ══════════════════════════════════════════════════════════════
const mirrorSandbox = (function () {
    const shiftApi = {
        getOffset(pane) {
            if (pane === 'pane_austrian') return { x: 120, y: -40 };
            if (pane === 'pane_ww1') return { x: -500, y: 250 };
            return { x: 0, y: 0 };
        },
        offsets() { return { pane_austrian: { x: 120, y: -40 }, pane_ww1: { x: -500, y: 250 } }; }
    };
    const doc = {
        documentElement: { lang: 'ro' },
        createElement(tag) { return tag === 'canvas' ? new FakeCanvas(1, 1) : {}; },
        addEventListener() {}
    };
    const win = {
        document: doc,
        DetectLabHistShift: shiftApi,
        Blob: Blob,
        URL: URL,
        createImageBitmap: fakeDecoder,
        console: console
    };
    win.window = win;
    const sandbox = { window: win, document: doc, console, Blob, URL, Promise, Uint8ClampedArray };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(mirrorSource, sandbox, { filename: 'js/map3d-mirror.js' });
    return { mirror: win.DetectLabMirror, win, doc };
})();
const mirror = mirrorSandbox.mirror;
/* Objects made inside a vm context have that context's prototypes, so two
 * identical shapes are not `deepStrictEqual`; the values are what matter. */
const same = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);

(async function mirrorChecks() {
    assert(mirror, 'DetectLabMirror exported');

    /* …the pane is the unit, exactly like the 2D side */
    same(mirror.shiftForPane('pane_austrian'), { x: 120, y: -40 }, 'a pane offset is read from the 2D module');
    same(mirror.shiftForPane('pane_nothing'), { x: 0, y: 0 }, 'an unknown pane is on its true position');
    same(mirror.shiftForPane(null), { x: 0, y: 0 }, 'no pane, no offset');
    assert.strictEqual(mirror.hasShift({ x: 0, y: 0 }), false, 'a zero offset is no offset');
    assert.strictEqual(mirror.hasShift({ x: 0.0004, y: 0 }), false, 'a sub-millimetre offset is no offset');
    assert.strictEqual(mirror.hasShift({ x: 0, y: -12 }), true, 'a metre is an offset');
    assert(/pane_austrian=120,-40/.test(mirror.historyShiftSignature()), 'a signature of the whole state, for the poll');

    /* …the template is how a raster carries it */
    const tpl = 'dl2d://2d.A/{z}/{x}/{y}';
    assert.strictEqual(mirror.shiftTemplate(tpl, { x: 120, y: -40 }), tpl + '?hs=120,-40', 'the offset rides in the tile template');
    assert.strictEqual(mirror.shiftTemplate(tpl, { x: 0, y: 0 }), tpl, 'no offset, byte-identical template');
    assert.strictEqual(mirror.shiftTemplate(tpl + '?a=1', { x: 1, y: 2 }), tpl + '?a=1&hs=1,2', 'an existing query is extended, never replaced');
    same(mirror.parseShift(tpl + '?hs=120,-40'), { x: 120, y: -40 }, 'and read back');
    same(mirror.parseShift(tpl), { x: 0, y: 0 }, 'a template without an offset means “true position”');

    /* …metres become pixels of the tile canvas at that zoom and tile size */
    const px = mirror.shiftPixels({ x: 1000, y: 0 }, 10, 256);
    assert.ok(Math.abs(px.x - 1000 / (M_PER_PX_Z0 / 1024)) < 1e-9, '1000 m at z10 is 1000/(m/px) pixels: ' + px.x);
    const px512 = mirror.shiftPixels({ x: 1000, y: 0 }, 10, 512);
    assert.ok(Math.abs(px512.x - px.x * 4) < 1e-9,
        'a 512 px tile covers half the ground, so the same metres are 4× the pixels (a square)');
    assert.ok(Math.abs(mirror.shiftPixels({ x: 0, y: 3000 }, 12, 256).y - 3000 / (M_PER_PX_Z0 / 4096)) < 1e-6,
        'the y offset follows the same scale (down in the pane = south on the world)');

    /* …and the tile it is drawn from is the tile the window covers */
    let plan = mirror.shiftMosaic({ x: 0, y: 0 }, 12, 100, 200, 256);
    assert.strictEqual(plan.tiles.length, 1, 'no offset: exactly one tile, the requested one');
    same(plan.tiles[0], { z: 12, x: 100, y: 200, dx: 0, dy: 0, size: 256 }, 'drawn where it belongs');

    plan = mirror.shiftMosaic({ x: 2.6, y: 0 }, 12, 100, 200, 256);
    assert.strictEqual(plan.tiles.length, 2, 'a 2.6 px shift reaches into the left neighbour');
    const left = plan.tiles.filter((t) => t.x === 99)[0];
    const own = plan.tiles.filter((t) => t.x === 100)[0];
    assert.ok(left && Math.abs(left.dx + 253.4) < 0.01, 'the neighbour is drawn mostly off-canvas: ' + (left && left.dx));
    assert.ok(own && Math.abs(own.dx - 2.6) < 0.01, 'the sheet’s own tile lands 2.6 px to the right: ' + (own && own.dx));
    assert.ok(left.dy === 0 && own.dy === 0, 'nothing moves vertically for a horizontal correction');

    plan = mirror.shiftMosaic({ x: 0, y: -2.6 }, 12, 100, 200, 256);
    const ownRow = plan.tiles.filter((t) => t.y === 200)[0];
    const nextRow = plan.tiles.filter((t) => t.y === 201)[0];
    assert.ok(ownRow && Math.abs(ownRow.dy + 2.6) < 0.01, 'a NORTHWARD offset (negative y) draws the sheet 2.6 px up: ' + (ownRow && ownRow.dy));
    assert.ok(nextRow && Math.abs(nextRow.dy - 253.4) < 0.01,
        'and the bottom edge of the tile now shows the top of the tile below it (down = south)');

    /* A 3 km correction at a deep zoom is not hundreds of tiles: the window is
     * still one tile wide, it is only twenty tile indices away. */
    const big = mirror.shiftPixels({ x: 3000, y: 0 }, 18, 256);
    plan = mirror.shiftMosaic(big, 18, 131072, 90000, 256);
    assert.ok(Math.abs(big.x - 3000 / (M_PER_PX_Z0 / 262144)) < 1e-6, '3 km at z18 is 5 000+ pixels');
    assert.strictEqual(plan.tiles.length, 2, 'and still two upstream tiles, not a block (' + plan.tiles.length + ')');
    assert.strictEqual(plan.zoom, 18, 'at the zoom MapLibre asked for — no soft, stepped-down picture');
    assert.ok(plan.tiles.some((t) => t.x === 131072 - 20), 'the tile twenty indices west is the one whose pixels belong there');
    assert.ok(plan.tiles.every((t) => t.size === 256 && t.x >= 0 && t.y >= 0), 'every part is a full tile of that zoom');
    assert.ok(plan.tiles.length <= mirror.SHIFT_TILES_MAX, 'the block never exceeds the documented ceiling');
    console.log('  ✓ an offset in metres becomes a bounded neighbour block of tiles');
})().then(mirrorCorners);

async function mirrorCorners() {
    /* An image overlay (the free Josephine sheet) is moved by its corners. */
    const corners = [[23.5, 46.8], [23.7, 46.8], [23.7, 46.7], [23.5, 46.7]];
    const moved = mirror.shiftCoordinates(corners, { x: 1000, y: 0 });
    assert.strictEqual(moved.length, 4, 'all four corners');
    assert.ok(Math.abs((moved[0][0] - corners[0][0]) * M_PER_DEG_LNG - 1000) < 1e-6,
        '+x moves the sheet east by exactly those projected metres');
    assert.ok(Math.abs(moved[0][1] - corners[0][1]) < 1e-9, 'an eastward offset leaves latitude alone');

    const south = mirror.shiftCoordinates(corners, { x: 0, y: 1000 });
    assert.ok(south[0][1] < corners[0][1], '+y (down in the pane) is SOUTH on the world');
    const mercY = (lat) => 6378137 * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const latAt = (y) => (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI;
    assert.ok(Math.abs(latAt(mercY(corners[0][1]) - 1000) - south[0][1]) < 1e-9,
        'the latitude moves in mercator-y, exactly as the 2D pixel grid does');
    same(mirror.shiftCoordinates(corners, { x: 0, y: 0 }), corners,
        'no offset returns the corners untouched');

    /* Composition: the pixels of the right neighbours, at the right place. */
    const parts = [
        { data: solidImage(255, 0, 0, 256), dx: -250, dy: 0, size: 256, srcSize: 256 },
        { data: solidImage(0, 0, 255, 256), dx: 6, dy: 0, size: 256, srcSize: 256 }
    ];
    const bytes = await mirror.composeShiftedTile(parts, 256);
    const composed = new FakeCanvas(256, 256);
    composed._pixels.set(new Uint8ClampedArray(bytes));
    assert.deepStrictEqual(pixelAt(composed, 0, 10), [255, 0, 0, 255],
        'the left edge is the RIGHT edge of the left neighbour (the sheet moved east)');
    assert.deepStrictEqual(pixelAt(composed, 5, 10), [255, 0, 0, 255], 'up to the offset');
    assert.deepStrictEqual(pixelAt(composed, 6, 10), [0, 0, 255, 255], 'from the offset on, the layer’s own tile');
    assert.deepStrictEqual(pixelAt(composed, 255, 10), [0, 0, 255, 255], 'and to the end of the tile');
    assert.strictEqual(bytes.byteLength, 256 * 256 * 4, 'one 256² tile comes out, exactly what a protocol must return');
    const scaled = await mirror.composeShiftedTile(
        [{ data: solidImage(0, 255, 0, 256), dx: 0, dy: 0, size: 512, srcSize: 256 }], 256);
    const scaledCanvas = new FakeCanvas(256, 256);
    scaledCanvas._pixels.set(new Uint8ClampedArray(scaled));
    assert.deepStrictEqual(pixelAt(scaledCanvas, 0, 0), [0, 255, 0, 255],
        'a coarser (stretched) part is scaled into the tile, not clipped to it');
    assert.deepStrictEqual(pixelAt(scaledCanvas, 255, 255), [0, 255, 0, 255], '…right to the far corner');
    console.log('  ✓ the corners and the composed tile carry the correction exactly');
}

// ══════════════════════════════════════════════════════════════
// 3. The 3D viewer: the deck follows the 2D position
// ══════════════════════════════════════════════════════════════
(async function viewerChecks() {
    const fetched = [];
    const stubElement = () => ({
        style: {}, dataset: {}, children: [], checked: false, value: '',
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        setAttribute() {}, getAttribute() { return null; }, addEventListener() {},
        removeEventListener() {}, appendChild(c) { return c; }, removeChild() {},
        querySelector() { return stubElement(); }, querySelectorAll() { return []; },
        insertBefore(c) { return c; }, contains() { return false; }, focus() {}
    });
    const doc = {
        readyState: 'complete',
        head: stubElement(), body: stubElement(), documentElement: stubElement(),
        createElement(tag) { return tag === 'canvas' ? new FakeCanvas(1, 1) : stubElement(); },
        getElementById() { return null; },
        querySelector() { return null; }, querySelectorAll() { return []; },
        addEventListener() {}, removeEventListener() {}
    };
    const listeners = {};
    const win = {
        document: doc,
        Blob: Blob,
        URL: URL,
        createImageBitmap: fakeDecoder,
        setTimeout, clearTimeout,
        setInterval() { return 0; }, clearInterval() {},
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener() {},
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        navigator: { onLine: true },
        console: console,
        /* The 2D owner of the offsets, exactly as js/hist-shift.js exposes it. */
        DetectLabHistShift: {
            getOffset(pane) {
                if (pane === 'pane_austrian') return { x: 120, y: -40 };
                if (pane === 'pane_ww1') return { x: 0, y: 0 };
                return { x: 0, y: 0 };
            },
            offsets() { return { pane_austrian: { x: 120, y: -40 } }; }
        },
        /* Every tile the viewer asks for, answered with a colour that names the
         * tile: the test can tell which upstream tile a pixel came from. */
        fetch(url) {
            fetched.push(url);
            const m = /tile\/(\d+)\/(\d+)\/(\d+)/.exec(String(url));
            const x = m ? Number(m[2]) : 0;
            const y = m ? Number(m[3]) : 0;
            const bytes = new Uint8Array([x % 256, y % 256, 7, 255]);
            return Promise.resolve({
                ok: true, status: 200,
                headers: { get() { return null; } },
                arrayBuffer() { return Promise.resolve(bytes.buffer); }
            });
        }
    };
    win.window = win;
    const sandbox = {
        window: win, document: doc, console,
        Blob, URL, Promise, Uint8ClampedArray,
        setTimeout, clearTimeout, navigator: win.navigator
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(registrySource, sandbox, { filename: 'js/layer-registry.js' });
    vm.runInContext(mirrorSource, sandbox, { filename: 'js/map3d-mirror.js' });
    vm.runInContext(viewerSource, sandbox, { filename: 'js/map3d-terrain.js' });
    const api = win.DetectLabMap3D;
    const MIRROR = win.DetectLabMirror;
    assert(api && MIRROR, 'the viewer and the mirror are up');

    /* A historical tile layer as map-app.js builds it: its own pane, an XYZ
     * service, the registry definition behind it. */
    const layer = {
        _leaflet_id: 'H1',
        options: { pane: 'pane_austrian', name: 'Harta Austriacă', tileSize: 256 },
        _url: 'https://hist.example.org/tile/{z}/{x}/{y}',
        getTileSize() { return { x: 256, y: 256 }; },
        getTileUrl(c) { return 'https://hist.example.org/tile/' + c.z + '/' + c.x + '/' + c.y; }
    };
    /* The dl2d:// protocol resolves a key through the mirror's table, which the
     * mirror fills while it walks the live 2D map. Collecting that map would
     * drag all of Leaflet into this file, so the one entry this test needs is
     * put there directly — the key itself is the mirror's own. */
    const key = MIRROR.keyFor(layer);
    const realLayerByKey = MIRROR.layerByKey;
    MIRROR.layerByKey = (k) => (k === key ? layer : realLayerByKey(k));

    const shiftedItem = {
        key: key, pane: 'pane_austrian', defId: 'hist.austrian', render: 'url',
        template: MIRROR.templateFor(layer), tileSize: 256, layer: layer,
        minzoom: 0, maxzoom: 18, label: 'Harta Austriacă'
    };
    assert.strictEqual(JSON.stringify(api._shiftOf(shiftedItem)), JSON.stringify({ x: 120, y: -40 }),
        'the viewer knows which pane an item lives in');

    /* A sheet the user moved is asked through dl2d:// WITH its offset… */
    const shiftedTiles = api._rasterTilesFor(shiftedItem, false);
    assert.strictEqual(JSON.stringify(shiftedTiles), JSON.stringify(['dl2d://' + key + '/{z}/{x}/{y}?hs=120,-40']),
        'a moved sheet carries its offset in the tile template: ' + JSON.stringify(shiftedTiles));
    /* …a sheet on its true position keeps the registry route it had before. */
    const stillItem = Object.assign({}, shiftedItem, { pane: 'pane_ww1' });
    const stillTiles = api._rasterTilesFor(stillItem, false);
    assert(stillTiles[0].indexOf('dl2d://') !== 0 || stillTiles[0].indexOf('hs=') === -1,
        'a sheet that was never moved is fetched exactly as before: ' + JSON.stringify(stillTiles));

    /* The plan of one shifted tile, straight from the viewer. */
    const mosaic = api._shiftMosaic(shiftedItem, 12, 100, 200);
    assert(mosaic.tiles.length >= 1 && mosaic.tiles.length <= 16, 'the viewer composes a bounded block');
    assert.strictEqual(mosaic.tiles[0].z, 12, 'at the zoom MapLibre asked for (a small correction)');

    /* Composition through the real fetch/blend path. */
    fetched.length = 0;
    const templateUrl = 'dl2d://' + key + '/12/100/200?hs=120,-40';
    const bytes = await api._shiftedTile(layer, templateUrl, { z: 12, x: 100, y: 200 }, { x: 120, y: -40 }, null);
    assert(fetched.length >= 1, 'the shifted tile is downloaded, not invented');
    assert(fetched.every((u) => /tile\/12\/\d+\/\d+/.test(u)), 'every part is a real tile request at that zoom: ' + fetched.join(' '));
    assert(fetched.some((u) => /tile\/12\/100\/200/.test(u)), 'the tile’s own pixels are part of it');
    const tileCanvas = new FakeCanvas(256, 256);
    tileCanvas._pixels.set(new Uint8ClampedArray(bytes));
    assert.strictEqual(tileCanvas.width, 256, 'one 256² tile comes back');
    assert.deepStrictEqual(pixelAt(tileCanvas, 200, 20), [100, 200, 7, 255],
        'the middle of the tile is the layer’s own tile (x=100, y=200) — the sheet moved, not the world');

    /* Cached: a pan back over the same tile costs nothing. */
    const before = fetched.length;
    await api._shiftedTile(layer, templateUrl, { z: 12, x: 100, y: 200 }, { x: 120, y: -40 }, null);
    assert.strictEqual(fetched.length, before, 'the composed tile is cached under its offset-carrying URL');

    /* …and the same URL through the real dl2d:// protocol handler. */
    const protocols = {};
    api._registerProtocols({ addProtocol(name, fn) { protocols[name] = fn; } });
    assert(typeof protocols.dl2d === 'function', 'the dl2d:// protocol is registered');
    fetched.length = 0;
    /* A different position, so this is a tile MapLibre would ask for after the
     * user dragged the sheet again — not the cached composition above. */
    const served = await protocols.dl2d({ url: 'dl2d://' + key + '/12/100/200?hs=121,-40' }, {});
    assert(served && served.data, 'the protocol answers with tile bytes');
    assert(fetched.length >= 1 && new Uint8Array(served.data).length === 256 * 256 * 4,
        'through the protocol the composed tile is what MapLibre receives');

    /* A layer with no offset must not pay for any of this: one request, and the
     * tile MapLibre gets is the upstream tile itself. */
    fetched.length = 0;
    const plain = await protocols.dl2d({ url: 'dl2d://' + key + '/12/100/200' }, {});
    assert.strictEqual(fetched.length, 1, 'an unshifted tile is a single request, as before');
    assert.deepStrictEqual(Array.from(new Uint8Array(plain.data)), [100, 200, 7, 255],
        'and the bytes are handed over untouched (no compose step)');

    /* The 3D view re-lays its deck when 2D announces a move. */
    assert(typeof listeners['detectlab:histshiftchange'] === 'object' &&
        listeners['detectlab:histshiftchange'].length === 1,
        'the viewer listens for the 2D move (3D open or not — the state is read on open)');
    const status = api.status();
    assert(typeof status.shiftedTiles === 'number', 'status() counts the composed tiles');
    assert(status.historyShift && status.historyShift.pane_austrian,
        'status() names the offsets currently applied, for a support report');
    console.log('  ✓ the 3D deck drapes the moved sheet where 2D put it');
})().then(wiringChecks).catch((err) => { console.error(err); process.exitCode = 1; });

// ══════════════════════════════════════════════════════════════
// 4. Wiring — the modules are shipped and cached under one tag
// ══════════════════════════════════════════════════════════════
function wiringChecks() {
    const mirrorTag = /js\/map3d-mirror\.js\?v=([\w.-]+)/.exec(indexHtml);
    const viewerTag = /js\/map3d-terrain\.js\?v=([\w.-]+)/.exec(indexHtml);
    const shiftTag = /js\/hist-shift\.js\?v=([\w.-]+)/.exec(indexHtml);
    assert(mirrorTag && viewerTag && shiftTag, 'index.html loads the mirror, the viewer and the 2D offset');
    [mirrorTag, viewerTag, shiftTag].forEach((m) => {
        assert(swJs.indexOf(m[0]) !== -1, 'sw.js precaches ' + m[0]);
    });
    assert(shiftTag[1].indexOf('hist-shift') !== -1, 'the 2D module is re-tagged for this change');
    assert(/CACHE_NAME\s*=\s*'detectlab-v\d+/.test(swJs), 'the cache has a version');
    /* Both halves name the same event, and the viewer reads the offset from the
     * 2D module — never from a duplicate of it. */
    assert(/detectlab:histshiftchange/.test(histShiftSource), 'the 2D side dispatches the event');
    assert(/detectlab:histshiftchange/.test(viewerSource), 'the 3D side listens to the same event');
    assert(/DetectLabHistShift/.test(mirrorSource) && /shiftForPane/.test(mirrorSource),
        'the mirror reads the offset from window.DetectLabHistShift');
    assert(!/dlHistShift\.v1/.test(mirrorSource) && !/dlHistShift\.v1/.test(viewerSource),
        'neither 3D file re-implements the storage — the 2D module stays the single owner');
    console.log('  ✓ shipped, cached and reading the one owner of the offset');
    console.log('OK — a historical map moved in 2D is drawn at that same position in 3D.');
}
