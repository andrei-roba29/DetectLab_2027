// Reported 2026-11-01: choosing the LiDAR Settings area from a country-wide
// view (z10) left it a blur once the user flew in — the photo effect was drawn
// from the tile of the zoom the map had WHEN the area was picked, upscaled step
// by step. This drives the real pipeline (prepare + PhotoLayer.createTile) and
// pins the two halves of the fix:
//   1. the prepared depth belongs to the LAYER (its native ceiling, bounded by
//      the tile budget), never to the view the centre was tapped from;
//   2. above that depth the overlay asks the provider for the EXACT level of
//      the tile on screen instead of blowing up the deepest prepared one.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

/* ── a canvas that remembers what was painted ─────────────────────────────── */
function makeCanvas() {
    const ctx = {
        image: null,
        drawImage() {},
        putImageData(image) { this.image = image; },
        createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
        getImageData(w, h) {
            const data = new Uint8ClampedArray(w * h * 4);
            for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = 120; data[i + 3] = 255; }
            return { width: w, height: h, data };
        },
        clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}
    };
    return { width: 0, height: 0, getContext() { return ctx; }, toBlob(cb) { cb(null); } };
}

/* ── Leaflet-free grid layer plumbing ─────────────────────────────────────── */
const panes = {};
const captured = {};
const layerWithTiles = {
    options: { maxNativeZoom: 16, maxZoom: 20, minZoom: 0, opacity: 1 },   // a z16 LiDAR pyramid
    _tiles: {},
    on() {}, off() {}
};
const map = {
    zoom: 10,
    createPane(n) { panes[n] = { style: {} }; },
    getPane(n) { return panes[n]; },
    getContainer() { return { style: {} }; },
    getZoom() { return this.zoom; },
    on() {}, off() {}, removeLayer() {}, hasLayer() { return true; }, addLayer() {},
    project({ lat, lng }, z) {
        const s = 256 * 2 ** z, sin = Math.sin(lat * Math.PI / 180);
        return { x: (lng + 180) / 360 * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
    }
};

const fetched = [];
function GridLayer(options) { this.options = options || {}; this.handlers = {}; }
GridLayer.prototype.addTo = function () { return this; };
GridLayer.prototype.on = function (name, fn) { this.handlers[name] = fn; return this; };
GridLayer.prototype.getContainer = function () { return { style: {} }; };
GridLayer.extend = function (proto) {
    const Layer = function (options) { GridLayer.call(this, options); Object.assign(this, proto); };
    Layer.prototype = Object.create(GridLayer.prototype);
    captured.photo = proto;
    return Layer;
};

const listeners = {};
const window = {
    _dlMap: map,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    innerWidth: 1280,                       // desktop budget: 96 tiles
    L: { GridLayer, circle: () => ({ addTo() { return this; } }) },
    dispatchEvent(event) { if (process.env.DEBUG_PHOTO) console.log('  ·', event.detail && event.detail.status); },
    setTimeout(fn) { return fn(); },
    DetectLabLidar3D: { activeLayers: () => [entry] },
    DetectLabMirror: { tileUrlFor: (layer, z, x, y) => 'https://tiles.example/' + z + '/' + x + '/' + y },
    DetectLabMap3D: {
        _fetchTile(url) {
            fetched.push(url);
            return Promise.resolve({ data: new ArrayBuffer(8) });
        }
    }
};
const entry = { key: 'lidar.ro1m', tagKey: 'lidar.ro1m', defId: null, minzoom: 0, maxzoom: 16, layer: layerWithTiles };
const document = { createElement: () => makeCanvas() };

vm.runInNewContext(fs.readFileSync('js/lidar-photo-filter.js', 'utf8'), {
    window, document, console,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Map, Set, WeakMap, Math, Number, Promise, String, Array, Object, JSON, Error, Infinity,
    Uint8ClampedArray, Float32Array, Float64Array, ArrayBuffer,
    ImageData: class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } },
    Blob: class { constructor() {} },
    createImageBitmap: () => Promise.resolve({ width: 256, height: 256, close() {} }),
    AbortController: class { constructor() { this.signal = { aborted: false, addEventListener() {} }; } abort() { this.signal.aborted = true; } },
    requestAnimationFrame: fn => fn(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: id => clearTimeout(id),
    queueMicrotask: fn => fn()
});

const api = window.DLPhotoFilter;

(async () => {
    /* [1] Picked from z10 — the same disc a close-in pick would prepare. */
    const ok = await api.prepare('ro1m', { lat: 46.77, lng: 23.6 }, 'hillshade', {});
    assert.equal(ok, true, 'the area is prepared');
    const pickedFar = api.get();
    assert.ok(pickedFar, 'the prepared area is published');
    assert.ok(pickedFar.zoom > 10, 'a z10 pick is not prepared at z10 (got z' + pickedFar.zoom + ')');
    assert.equal(pickedFar.zoom, 16, 'the disc is prepared at the layer native ceiling');

    /* The pick zoom no longer moves the plan. */
    map.zoom = 17;
    await api.prepare('ro1m', { lat: 46.77, lng: 23.6 }, 'hillshade', {});
    assert.equal(api.get().zoom, pickedFar.zoom, 'the pick zoom never decides the prepared depth');
    map.zoom = 10;
    await api.prepare('ro1m', { lat: 46.77, lng: 23.6 }, 'hillshade', {});
    const session = api.get();
    assert.equal(session.zoom, 16);

    /* [2] One level above the prepared depth: the exact tile is requested. */
    const before = fetched.length;
    let doneWith = null;
    const deep = map.project({ lat: 46.77, lng: 23.6 }, 17);
    const deepCoords = { z: 17, x: Math.floor(deep.x / 256), y: Math.floor(deep.y / 256) };
    const tile = overlayInstance().createTile(deepCoords, (err, canvas) => { doneWith = { err, canvas }; });
    assert.equal(fetched.length, before + 1, 'the deeper level is fetched from the provider');
    assert.match(fetched[fetched.length - 1], /\/17\//, 'the request names the exact level on screen, not the prepared one');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(doneWith && doneWith.err, null, 'the tile completes');
    assert.ok(tile, 'a canvas is handed to Leaflet');

    /* [3] A tile far outside the disc is never requested. */
    const far = fetched.length;
    overlayInstance().createTile({ z: 17, x: deepCoords.x + 120, y: deepCoords.y }, () => {});
    assert.equal(fetched.length, far, 'tiles that cannot touch the 1 km disc ask for nothing');

    /* [4] The prepared depth itself still paints from the cache, with no IO. */
    const cached = fetched.length;
    const p = map.project({ lat: 46.77, lng: 23.6 }, 16);
    overlayInstance().createTile({ z: 16, x: Math.floor(p.x / 256), y: Math.floor(p.y / 256) }, () => {});
    assert.equal(fetched.length, cached, 'prepared levels are drawn from memory');

    /* [5] Leaving the 3D view resets the area: the effect is dropped, the
     * decoded tile cache is released and the adjustments go back to defaults.
     * Keeping them across the hand-off crashed the installed PWA. */
    assert.ok(api.get(), 'the area is still prepared before 3D closes');
    assert.equal(typeof api.reset, 'function', 'the area can be reset');
    let removed = 0;
    const removeLayer = map.removeLayer;
    map.removeLayer = function (layer) { removed++; return removeLayer && removeLayer.call(map, layer); };
    (listeners['detectlab:3d-closed'] || []).forEach(fn => fn({ type: 'detectlab:3d-closed' }));
    assert.equal(api.get(), null, 'a 3D close drops the prepared area');
    assert.ok(removed >= 1, 'the photo overlay leaves the 2D map');
    const defaults = { exposure: 0, highlights: 0, shadows: 0, contrast: 0, brightness: 0, sharpness: 0, opacity: 100 };
    assert.deepEqual({ ...api._test.controls }, defaults, 'the adjustments go back to their defaults');
    assert.ok(removed >= 1);
    map.removeLayer = removeLayer;

    console.log('LiDAR area depth: layer-owned plan, on-demand deep tiles, and a reset when 3D closes.');
})().catch(err => { console.error(err); process.exitCode = 1; });

function overlayInstance() {
    if (!captured.photo) throw new Error('PhotoLayer was not built');
    const instance = Object.create(GridLayer.prototype);
    GridLayer.call(instance, { tileSize: 256 });
    Object.assign(instance, captured.photo);
    return instance;
}
