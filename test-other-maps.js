#!/usr/bin/env node
'use strict';

/* Behavioural checks for the “Alte hărți / Other maps” sub-layer.
 *
 * Run with:  node test-other-maps.js
 *
 * Covers, without touching the network:
 *   1. js/other-maps-tiles.js  — the Hungaricana ECW tile hash (both readings
 *      of dezoomify's note), the pyramid level maths and the URL builders;
 *   2. js/other-maps-overlay.js — the pure transform maths: pyramid level
 *      choice, on-screen size and the inverse transform that decides which
 *      tiles to fetch for a rotated, scaled, moved sheet;
 *   3. data/other-maps-catalog.json — every record is usable;
 *   4. the clustering contract: the dots must group EXACTLY like the
 *      Patrimoniu sites (same helper, same config, same distances);
 *   5. js/other-maps.js — a group of sheets on one place opens the list, a
 *      group spread over the map zooms in instead;
 *   6. the overlay manager against a fake map + mini DOM — a fresh sheet is
 *      framed into the viewport, zooming in keeps the old tiles as a stand-in
 *      until the finer level loads (and the fallback retires it), zooming out
 *      refetches the coarser level, reset/ remove clean up.
 *   7. js/other-maps-nls.js — NLS Map Finder IIIF region URLs, info.json
 *      parsing, the WFS query/feature mapping, the committed NLS seed
 *      catalogue, the multi-source dispatcher and an NLS sheet driven
 *      through the same overlay manager (sections 10–14).
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
let checks = 0;
function ok(condition, message) {
    assert.ok(condition, message);
    checks++;
}
function eq(actual, expected, message) {
    assert.strictEqual(actual, expected, message);
    checks++;
}

/* ── sandbox ─────────────────────────────────────────────────────────── */
function storageStub(initial) {
    const map = new Map(Object.entries(initial || {}));
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k)
    };
}

/* The browser's WebCrypto, backed by node's crypto, so the module under test
 * runs the very same AES-128-CBC call it will run in the page. */
function webCryptoStub() {
    return {
        subtle: {
            importKey: (format, key, algorithm, extractable, usages) =>
                Promise.resolve({ format, key, algorithm, usages }),
            encrypt: (algorithm, key, data) => {
                const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key.key), Buffer.alloc(16));
                return Promise.resolve(Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()]));
            }
        }
    };
}

/* ── mini DOM + manual timers (for the manager simulation, §6) ───────── */
/* Timers never fire on their own: the test flushes them explicitly, so the
 * stand-in's 6 s fallback is exercised on demand and node never waits. */
const pendingTimers = new Map();
let nextTimerId = 1;
function flushTimers() {
    const list = Array.from(pendingTimers.values());
    pendingTimers.clear();
    list.forEach((timer) => timer.fn());
}

function fakeEl(tag) {
    const el = {
        nodeType: 1,
        tagName: String(tag).toUpperCase(),
        className: '',
        style: {},
        attributes: Object.create(null),
        children: [],
        parentNode: null,
        listeners: Object.create(null),
        appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
        removeChild(child) {
            const i = el.children.indexOf(child);
            if (i >= 0) el.children.splice(i, 1);
            child.parentNode = null;
            return child;
        },
        addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
        removeEventListener(type, fn) {
            el.listeners[type] = (el.listeners[type] || []).filter((f) => f !== fn);
        },
        dispatch(type) { (el.listeners[type] || []).slice().forEach((fn) => fn({ type })); },
        getAttribute(name) { return el.attributes[name] == null ? null : el.attributes[name]; },
        setAttribute(name, value) { el.attributes[name] = String(value); },
        /* The panel markup is a string, so a real selector is not needed:
         * hand back a fresh element for `ensurePanel`'s listener wiring. */
        querySelector: () => fakeEl('div'),
        querySelectorAll: () => [],
        matches: () => false,
        setPointerCapture: () => {},
        getContext: () => (el._ctx2d = el._ctx2d || {
            clearRect: () => {}, save: () => {}, restore: () => {}, translate: () => {},
            beginPath: () => {}, arc: () => {}, fill: () => {}, stroke: () => {}, fillText: () => {},
            lineWidth: 0, globalAlpha: 1, fillStyle: '', strokeStyle: '', font: '',
            textAlign: '', textBaseline: ''
        })
    };
    el.classList = {
        _set: new Set(),
        add(c) { el.classList._set.add(c); },
        remove(c) { el.classList._set.delete(c); },
        toggle(c, on) {
            const should = (on == null) ? !el.classList._set.has(c) : !!on;
            if (should) el.classList._set.add(c);
            else el.classList._set.delete(c);
        },
        contains(c) { return el.classList._set.has(c); }
    };
    return el;
}

/* A Leaflet stand-in: the anchor is pinned to the centre of a 400×800
 * viewport, layer points are identity, and the test drives zooms by
 * rewriting `_state.zoom` and firing 'zoomend'. */
function fakeMap(initial) {
    const state = Object.assign({}, initial);
    const panes = Object.create(null);
    const events = Object.create(null);
    const container = fakeEl('div');
    return {
        _animatingZoom: false,
        _state: state,
        getZoom: () => state.zoom,
        getSize: () => ({ x: state.size.x, y: state.size.y }),
        getCenter: () => state.center,
        getContainer: () => container,
        getPane: (name) => panes[name] || null,
        createPane: (name) => {
            const pane = fakeEl('div');
            panes[name] = pane;
            container.appendChild(pane);
            return pane;
        },
        latLngToLayerPoint: () => ({ x: 200, y: 400 }),
        containerPointToLayerPoint: (pt) => ({ x: pt.x, y: pt.y }),
        on: (type, fn) => { (events[type] = events[type] || []).push(fn); },
        off: (type, fn) => { events[type] = (events[type] || []).filter((f) => f !== fn); },
        fire: (type) => { (events[type] || []).slice().forEach((fn) => fn({ type })); }
    };
}

const sandbox = {
    console,
    Math,
    Number,
    String,
    Object,
    Array,
    JSON,
    Promise,
    isFinite,
    TextEncoder,
    Uint8Array,
    URLSearchParams,
    AbortController,
    Date,
    setTimeout: (fn, ms) => { pendingTimers.set(nextTimerId, { fn, ms }); return nextTimerId++; },
    clearTimeout: (id) => { pendingTimers.delete(id); },
    clearInterval: () => {},
    setInterval: () => 0,
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: storageStub(),
    crypto: webCryptoStub(),
    document: {
        readyState: 'loading',
        addEventListener: () => {},
        getElementById: () => null,
        documentElement: { lang: 'ro' },
        createElement: (tag) => fakeEl(tag)
    },
    /* The same string form L.DomUtil writes in the browser, so the test can
     * assert the exact transform the user would see. */
    L: {
        point: (x, y) => (x != null && typeof x === 'object'
            && typeof x.x === 'number' && typeof x.y === 'number')
            ? x
            : pt(x, y),
        latLng: (lat, lng) => (lat != null && typeof lat === 'object' && 'lat' in lat)
            ? lat
            : { lat, lng },
        DomUtil: {
            setPosition: (el, p) => {
                el.style.transform = 'translate3d(' + p.x + 'px,' + p.y + 'px,0)';
            },
            setTransform: (el, p, s) => {
                el.style.transform = 'translate3d(' + p.x + 'px,' + p.y + 'px,0) scale(' + s + ')';
            }
        }
    }
};
/* A plain {x,y} with the vector ops the zoom-animation maths leans on —
 * the point instances L.point() would hand back in the browser. */
function pt(x, y) {
    return {
        x, y,
        add(p) { return pt(this.x + p.x, this.y + p.y); },
        subtract(p) { return pt(this.x - p.x, this.y - p.y); },
        multiplyBy(k) { return pt(this.x * k, this.y * k); },
        _round() { this.x = Math.round(this.x); this.y = Math.round(this.y); return this; }
    };
}
/* loadCatalog() fetches the JSON catalogues; serve them from memory so the
 * dots test can run the real attach → enable → redraw path without a
 * network.  The stub routes by URL: the Hungaricana catalogue, the NLS
 * seed catalogue, an IIIF info.json and a WFS response each get their own
 * body, and an unset body answers non-OK (the NLS catalogue is optional). */
let fakeCatalogJson = null;
let fakeNlsCatalogJson = null;
let fakeJosephineJson = null;
let fakeNlsInfoJson = null;
let fakeWfsJson = null;
let fakeCommonsJson = null;
sandbox.fetch = (url) => {
    const u = String(url || '');
    let body = fakeCatalogJson;
    if (u.indexOf('other-maps-nls-catalog.json') !== -1) body = fakeNlsCatalogJson;
    else if (u.indexOf('iosfree_db.json') !== -1) body = fakeJosephineJson;
    else if (u.indexOf('info.json') !== -1) body = fakeNlsInfoJson;
    else if (u.indexOf('geoserver') !== -1 || u.indexOf('wfs') !== -1) body = fakeWfsJson;
    else if (u.indexOf('en.wikipedia.org') !== -1) body = fakeCommonsJson;
    return Promise.resolve({ ok: body != null, json: () => Promise.resolve(body) });
};
sandbox.window = sandbox;
vm.createContext(sandbox);

function load(relative) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, relative), 'utf8'), sandbox, { filename: relative });
}

load('js/patrimoniu-clustering.js');
load('js/other-maps-tiles.js');
load('js/other-maps-nls.js');
load('js/other-maps-overlay.js');
load('js/other-maps.js');

const Clustering = sandbox.DetectLabPatrimoniuClustering;
const Tiles = sandbox.DetectLabOtherMapsTiles;
const Nls = sandbox.DetectLabOtherMapsNls;
const Overlay = sandbox.DetectLabOtherMapsOverlay;
const OtherMaps = sandbox.DetectLabOtherMaps;
const JosephineTiles = Tiles.source('josephine');
assert(JosephineTiles && typeof JosephineTiles.resolve === 'function' &&
    typeof JosephineTiles.tileUrl === 'function',
    'Josephine sheets register through the shared overlay tile adapter');

/* ══ 1. tile hashes ═══════════════════════════════════════════════════ */
(async function run() {
    // dezoomify's issue #346 gives one worked example: path
    // maps/mol/s012/div13/s12_div_xiii_0031/s12_div_xiii_0031.ecw (sum 4952),
    // tile x=5, y=5, z=10, ciphertext 67d1e405cb7b1eeb04cabffd9be3596c…
    const samplePath = 'maps/mol/s012/div13/s12_div_xiii_0031/s12_div_xiii_0031.ecw';
    const asZxy = await Tiles.tileUrl.call(null, samplePath, 5, 5, 10);
    Tiles.noteOrder('xyz');
    const asXyz = await Tiles.tileUrl(samplePath, 5, 5, 10);
    Tiles.noteOrder('zxy');

    eq(path.basename(asXyz), '67d1e405cb7b1eeb04cabffd9be3596c',
        'the |x|y|z reading reproduces the hash published in dezoomify #346');
    ok(/^[0-9a-f]{32}$/.test(path.basename(asZxy)),
        'the |z|x|y reading produces a well-formed 32-char hash');
    ok(asZxy !== asXyz, 'the two hash orders really do differ');
    ok(asZxy.startsWith('https://static-cdn.hungaricana.hu/tile/image/' + samplePath + '/'),
        'the tile URL keeps the ECW path and only hashes the coordinates');

    // Tiles for the same sheet at different levels/columns must differ.
    const tileA = await Tiles.tileUrl(samplePath, 0, 0, 3);
    const tileB = await Tiles.tileUrl(samplePath, 1, 0, 3);
    const tileC = await Tiles.tileUrl(samplePath, 0, 0, 4);
    ok(tileA !== tileB && tileA !== tileC, 'each (x, y, z) is a different tile');

    // The hash is stable: asking twice must not change the answer.
    eq(await Tiles.tileUrl(samplePath, 2, 1, 3), await Tiles.tileUrl(samplePath, 2, 1, 3),
        'the hash is deterministic');

    eq(Tiles.thumbUrl(samplePath),
        'https://static-cdn.hungaricana.hu/tile/thumb/' + samplePath,
        'thumbnails need no hash');
    eq(Tiles.recordUrl('MOLTerkeptar/2146'),
        'https://maps.hungaricana.hu/en/MOLTerkeptar/2146/view/',
        'the record URL points at the human-readable page');
    eq(Tiles.maxZoomFor(512, 512), 0, 'a 512 px sheet has a single level');
    eq(Tiles.maxZoomFor(513, 400), 1, 'just over 512 px needs level 1');
    eq(Tiles.maxZoomFor(8192, 4096), 4, 'an 8192 px sheet tops out at level 4');

    /* ══ 2. transform maths ═══════════════════════════════════════════ */
    eq(Math.round(Overlay.resolutionAt(0, 0)), 156543, 'z0 at the equator: 156543 m per pixel');
    ok(Overlay.resolutionAt(0, 10) < Overlay.resolutionAt(0, 9),
        'zooming in shrinks the metres covered by one pixel');
    ok(Overlay.resolutionAt(60, 10) < Overlay.resolutionAt(0, 10),
        'the same zoom covers fewer metres per pixel away from the equator');

    eq(Overlay.normalizeDegrees(370), 10, '370° normalises to 10°');
    eq(Overlay.normalizeDegrees(-190), 170, '-190° normalises to 170°');
    eq(Overlay.snapDegrees(89.5), 90, 'a hair below 90° snaps to 90°');
    eq(Overlay.snapDegrees(80), 80, 'a genuine 80° is left alone');

    // A 10 000 × 7 000 px sheet, 1 m per pixel → 10 km wide on the ground.
    const plan = Overlay.planGeometry({ lat: 47, zoom: 14, w: 10000, h: 7000, mpp: 1, maxZoom: 5 });
    ok(plan.level >= 0 && plan.level <= 5, 'the pyramid level stays inside the pyramid');
    ok(Math.abs(plan.k - plan.dW / plan.wL) < 1e-9, 'k is exactly on-screen width / level width');
    ok(plan.dW > 0 && plan.dH > 0, 'the sheet has a positive on-screen size');
    ok(Math.abs(plan.dW / plan.dH - 10000 / 7000) < 1e-6, 'the aspect ratio is preserved');

    // A tiny scale must not pick a level above the pyramid's top…
    const tiny = Overlay.planGeometry({ lat: 47, zoom: 14, w: 10000, h: 7000, mpp: 0.02, maxZoom: 5 });
    eq(tiny.level, 0, 'the smallest scale clamps to the pyramid root');
    const huge = Overlay.planGeometry({ lat: 47, zoom: 14, w: 10000, h: 7000, mpp: 400, maxZoom: 5 });
    eq(huge.level, 5, 'the largest scale clamps to the deepest level');

    /* The “frame it” scale: longest side ≈ FIT_FRACTION of the smaller
     * viewport edge, in metres per natural pixel. */
    const res12 = Overlay.resolutionAt(47, 12);
    const fitMppPhone = Overlay.fitScale(8000, 6000, res12, 400, 800);
    eq(fitMppPhone, 0.7 * 400 * res12 / 8000,
        'fitScale sizes the sheet to 70% of the smaller viewport edge');
    eq(Overlay.fitScale(8000, 6000, res12, 800, 400), fitMppPhone,
        'fitScale uses the smaller edge regardless of orientation');
    eq(Overlay.fitScale(6000, 8000, res12, 400, 800), 0.7 * 400 * res12 / 8000,
        'fitScale follows the longest side for portrait sheets');
    eq(Overlay.fitScale(0, 0, res12, 400, 800), null, 'fitScale gives up without a size');
    eq(Overlay.fitScale(8000, 6000, res12, 0, 0), null, 'fitScale gives up without a viewport');

    /* A freshly added sheet is framed, so its on-screen size IS the fit:
     * longest side on screen = FIT_FRACTION of the smaller edge, natural
     * aspect, a level inside the pyramid and a bounded tile window. */
    const fitted = Overlay.planGeometry(
        { lat: 47, zoom: 12, w: 8000, h: 6000, mpp: fitMppPhone, maxZoom: 4 },
        { anchor: { x: 200, y: 400 }, rotation: 0, topLeft: { x: 0, y: 0 }, bottomRight: { x: 400, y: 800 } }
    );
    ok(Math.abs(fitted.dW - 0.7 * 400) < 1e-9, 'the fitted sheet spans 70% of the smaller edge');
    ok(Math.abs(fitted.dW / fitted.dH - 8000 / 6000) < 1e-6, 'the fitted sheet keeps its natural 4:3 format');
    ok(fitted.level >= 0 && fitted.level <= 4, 'the fitted sheet stays inside the pyramid');
    ok(fitted.k <= 1 + 1e-9, 'the fitted sheet is never upscaled past its own pixels');
    const fittedRange = Overlay.visibleTileRange(fitted, { x: 200, y: 400 }, 0,
        { x: 0, y: 0 }, { x: 400, y: 800 });
    ok((fittedRange.x1 - fittedRange.x0 + 1) * (fittedRange.y1 - fittedRange.y0 + 1) <= Overlay.maxSharpTiles,
        'the fitted tile window respects the budget');

    /* The sharp-level preference: one level finer downscaling (k ≤ 1, crisp)
     * instead of upscaling (k > 1, soft) — with a view that says the extra
     * tiles are affordable (a small window). */
    const sharpMpp = Math.pow(2, 0.3 - 3) * res12;   // base = 0.3 → round 0, ceil 1
    const sharp = Overlay.planGeometry(
        { lat: 47, zoom: 12, w: 4000, h: 3000, mpp: sharpMpp, maxZoom: 3 },
        { anchor: { x: 200, y: 400 }, rotation: 0, topLeft: { x: 0, y: 0 }, bottomRight: { x: 400, y: 800 } }
    );
    const sharpNoView = Overlay.planGeometry({ lat: 47, zoom: 12, w: 4000, h: 3000, mpp: sharpMpp, maxZoom: 3 });
    eq(sharpNoView.level, 0, 'without a viewport the planner keeps the 1:1 level');
    ok(sharpNoView.k > 1, '…which means a mild upscale there');
    eq(sharp.level, 1, 'with an affordable window the planner steps up one level');
    ok(sharp.k <= 1 + 1e-9, 'the stepped-up level downscales (crisp, no blur)');

    /* …but a viewport whose fine window would exceed the tile budget keeps
     * the 1:1 level — no tile storm for a wall-sized sheet. */
    const wideMpp = 0.2625 * res12;                  // base ≈ 2.07 → round 2, ceil 3
    const wide = Overlay.planGeometry(
        { lat: 47, zoom: 12, w: 8000, h: 6000, mpp: wideMpp, maxZoom: 4 },
        { anchor: { x: 1500, y: 1000 }, rotation: 0, topLeft: { x: 0, y: 0 }, bottomRight: { x: 3000, y: 2000 } }
    );
    eq(wide.level, 2, 'an over-budget fine window keeps the 1:1 level');
    ok(wide.k > 1 && wide.k < 1.1, '…accepting the mild 1:1 upscale rather than hundreds of tiles');

    // …and the visible tile window must always contain every tile the
    // viewport actually looks at — that is the whole point of the inverse
    // transform, and it has to hold at any rotation.
    function coversViewport(geom, anchor, rotationDeg, topLeft, bottomRight) {
        const range = Overlay.visibleTileRange(geom, anchor, rotationDeg, topLeft, bottomRight);
        const theta = rotationDeg * Math.PI / 180;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        const corners = [
            [topLeft.x, topLeft.y], [bottomRight.x, topLeft.y],
            [bottomRight.x, bottomRight.y], [topLeft.x, bottomRight.y]
        ];
        return corners.every(([x, y]) => {
            const dx = x - anchor.x;
            const dy = y - anchor.y;
            const lx = (cos * dx + sin * dy) / geom.k + geom.wL / 2;
            const ly = (-sin * dx + cos * dy) / geom.k + geom.hL / 2;
            const tx = Math.floor(lx / Overlay.tileSize);
            const ty = Math.floor(ly / Overlay.tileSize);
            return tx >= range.x0 && tx <= range.x1 && ty >= range.y0 && ty <= range.y1;
        });
    }
    const viewport = { topLeft: { x: 0, y: 0 }, bottomRight: { x: 1200, y: 800 } };
    const centred = Overlay.planGeometry({ lat: 47, zoom: 12, w: 4000, h: 3000, mpp: 40, maxZoom: 4 });
    ok(coversViewport(centred, { x: 600, y: 400 }, 0, viewport.topLeft, viewport.bottomRight),
        'the tile window covers the viewport (rotation 0)');
    ok(coversViewport(centred, { x: 600, y: 400 }, 90, viewport.topLeft, viewport.bottomRight),
        'the tile window covers the viewport (rotation 90°)');
    ok(coversViewport(centred, { x: 600, y: 400 }, 37, viewport.topLeft, viewport.bottomRight),
        'the tile window covers the viewport (rotation 37°)');
    ok(coversViewport(centred, { x: 600, y: 400 }, -128, viewport.topLeft, viewport.bottomRight),
        'the tile window covers the viewport (rotation -128°)');
    // A sheet drawn entirely inside the viewport asks for all of its tiles.
    const inside = Overlay.planGeometry({ lat: 47, zoom: 12, w: 4000, h: 3000, mpp: 1, maxZoom: 4 });
    const insideRange = Overlay.visibleTileRange(inside, { x: 600, y: 400 }, 0, viewport.topLeft, viewport.bottomRight);
    eq(insideRange.x0, 0, 'a fully visible sheet starts at tile column 0');
    eq(insideRange.x1, inside.cols - 1, 'a fully visible sheet ends at its last column');
    eq(insideRange.y0, 0, 'a fully visible sheet starts at tile row 0');
    eq(insideRange.y1, inside.rows - 1, 'a fully visible sheet ends at its last row');

    const small = Overlay.planGeometry({ lat: 47, zoom: 16, w: 4000, h: 3000, mpp: 0.05, maxZoom: 4 });
    const smallRange = Overlay.visibleTileRange(small, { x: 600, y: 400 }, 0, viewport.topLeft, viewport.bottomRight);
    ok(smallRange.x0 >= 0 && smallRange.x1 < small.cols, 'the window never leaves the tile grid');
    ok(smallRange.x1 >= smallRange.x0 && smallRange.y1 >= smallRange.y0, 'the window is not inverted');

    const offscreen = Overlay.visibleTileRange(small, { x: 60000, y: 40000 }, 0, viewport.topLeft, viewport.bottomRight);
    ok(offscreen.x0 >= 0 && offscreen.x1 < small.cols, 'a sheet far outside the view still yields a legal window');

    /* ── stability across zoom and pan (OTHER_MAPS.md §9) ─────────────────
     * A sheet is one fixed picture on the ground.  Whatever the zoom, the
     * painted grid must fill exactly the framed box (no shape drift from
     * integer level sizes), each zoom step must double its on-screen size,
     * and the pyramid level must not depend on where the sheet sits in the
     * viewport or how it is rotated (no look change while panning). */
    const stableSizes = [[4000, 3000], [10000, 7000], [6123, 8517], [2600, 900], [30000, 21000], [8001, 333]];
    const stableView = { topLeft: { x: 0, y: 0 }, bottomRight: { x: 1280, y: 800 } };
    let worstAspect = 0;
    let worstDouble = 0;
    let panLevelDrift = 0;
    for (const [w, h] of stableSizes) {
        const maxZoom = Tiles.maxZoomFor(w, h);
        const mpp = 0.7 * 900 * Overlay.resolutionAt(47, 12) / Math.max(w, h);
        for (let z = 4; z <= 18; z++) {
            const g = Overlay.planGeometry({ lat: 47, zoom: z, w, h, mpp, maxZoom });
            worstAspect = Math.max(worstAspect,
                Math.abs(g.hL * g.k / g.dH - 1), Math.abs(g.wL * g.k / g.dW - 1));
            const next = Overlay.planGeometry({ lat: 47, zoom: z + 1, w, h, mpp, maxZoom });
            const screenNow = g.dW, screenNext = next.dW;
            worstDouble = Math.max(worstDouble, Math.abs(screenNext / screenNow - 2) * (screenNow > 0 ? 1 : 0));
            const levels = new Set();
            [[0, 0], [640, 400], [-3000, 200], [5000, 5000], [-120, 9000]].forEach(([x, y]) => {
                [0, 37, 90, -128].forEach((rot) => {
                    const at = Overlay.planGeometry({ lat: 47, zoom: z, w, h, mpp, maxZoom },
                        { anchor: { x, y }, rotation: rot, topLeft: stableView.topLeft, bottomRight: stableView.bottomRight });
                    levels.add(at.level);
                });
            });
            if (levels.size > 1) panLevelDrift++;
        }
    }
    ok(worstAspect < 1e-9, `the painted grid fills the framed box exactly at every zoom (worst ${worstAspect.toExponential(2)})`);
    ok(worstDouble < 1e-9, `each zoom step exactly doubles the on-screen size (worst ${worstDouble.toExponential(2)})`);
    eq(panLevelDrift, 0, 'the pyramid level never depends on pan position or rotation');

    /* ══ 3. the catalogue ═════════════════════════════════════════════ */
    const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/other-maps-catalog.json'), 'utf8'));
    ok(Array.isArray(catalog.maps) && catalog.maps.length > 0, 'the catalogue has records');
    ok(catalog.tileBase && catalog.thumbBase, 'the catalogue names its endpoints');

    const ids = new Set();
    catalog.maps.forEach((entry) => {
        ok(entry.id, 'record has an id');
        ok(!ids.has(entry.id), 'id ' + entry.id + ' is unique');
        ids.add(entry.id);
        ok(/^[a-z0-9/._\-()]+\.ecw$/i.test(entry.path), entry.id + ' carries an ECW path');
        ok(entry.lat > 40 && entry.lat < 52, entry.id + ' sits at a plausible central-European latitude');
        ok(entry.lng > 12 && entry.lng < 30, entry.id + ' sits at a plausible central-European longitude');
        ok(entry.place, entry.id + ' names a place');
    });

    // Same-place sheets stay individually addressable: every card in the
    // window Adds its own record id.
    const byPlace = OtherMaps.groupByPlace(catalog.maps);
    const multi = byPlace.filter((loc) => loc.count > 1);
    ok(multi.length >= 1, 'at least one place holds several sheets');
    multi.forEach((loc) => {
        const sheetIds = loc.sheets.map((sheet) => sheet.id);
        ok(new Set(sheetIds).size === sheetIds.length, loc.place + ' lists distinct sheet ids');
    });

    /* ══ 4. clustering — identical to Patrimoniu ══════════════════════ */
    const config = Clustering.CONFIG;
    eq(config.minZoom, 6, 'the shared config starts clustering at z6');
    eq(config.disableClusteringAtZoom, 11, 'the shared config stops clustering at z11');
    eq(Clustering.getDistanceKm(6, config), 5, 'z6 groups within 5 km');
    eq(Clustering.getDistanceKm(10, config), 1, 'z10 groups within 1 km');
    eq(Clustering.getDistanceKm(11, config), 0, 'z11 groups nothing');

    const index = new Clustering.SpatialIndex(config.indexCellSizeM);
    const records = catalog.maps.map((entry) => ({
        id: entry.id,
        lat: entry.lat,
        lng: entry.lng,
        latlng: { lat: entry.lat, lng: entry.lng },
        place: entry.place
    }));

    // Sheets of one place share one point → they become ONE location, so the
    // map never stacks identical dots on top of each other.
    const locations = OtherMaps.groupByPlace(records);
    ok(locations.length < records.length, 'co-located sheets are merged into places');
    ok(locations.every((loc) => loc.count >= 1 && loc.sheets.length === loc.count),
        'every location counts its sheets');
    locations.forEach((loc) => index.add(loc));

    const maramures = locations.filter((l) => /Maramure/i.test(l.place || ''));
    ok(maramures.length >= 1 && maramures[0].count > 3, 'the Maramureș sheets share one dot');
    const cluj = locations.filter((l) => l.place === 'Cluj-Napoca (RO)');
    ok(cluj.length === 1 && cluj[0].count > 40, 'the Cluj-Napoca sheets share one dot');
    const grouped = Clustering.clusterRecords(maramures, 11, index, config);
    eq(grouped.length, 1, 'one place is one dot even with clustering disabled');

    // At country scale, places hundreds of km apart stay separate…
    const worldView = Clustering.clusterRecords(locations, 6, index, config);
    ok(worldView.length > 1, 'distant places stay separate at z6');
    // …and the dots that are single places open the sheet list when tapped.
    const singles = worldView.filter((cluster) => OtherMaps.isLocationCluster(cluster));
    ok(singles.length >= 1, 'at least one z6 dot is a single place');

    // Two places 1.4 km apart: one dot at z6 (5 km), two pins at z11 (1 km).
    const near = OtherMaps.groupByPlace([
        { id: 'a', lat: 47.000, lng: 23.000, place: 'A' },
        { id: 'b', lat: 47.010, lng: 23.010, place: 'B' }
    ]);
    const nearIndex = new Clustering.SpatialIndex(config.indexCellSizeM);
    near.forEach((loc) => nearIndex.add(loc));
    eq(Clustering.clusterRecords(near, 6, nearIndex, config).length, 1, '1.4 km apart: one dot at z6');
    const splitNear = Clustering.clusterRecords(near, 11, nearIndex, config);
    eq(splitNear.length, 2, '1.4 km apart: two pins at z11');
    ok(!OtherMaps.isLocationCluster(Clustering.clusterRecords(near, 6, nearIndex, config)[0]),
        'a group of two places is geographic, so a tap zooms in');
    ok(OtherMaps.isLocationCluster(splitNear[0]),
        'a single place is a location, so a tap opens the sheet list');

    // Overlapping neighbour dots merge into one window: the Maramureș
    // town and county sheets sit ~350 m apart and share taps at low zoom.
    const locTown = { place: 'Sighetu Marmației (RO)', sheets: [{ id: 'a/1', title: 't1' }, { id: 'a/2', title: 't2' }] };
    const locCounty = { place: 'Comitatul Maramureș (azi Maramureș, RO)', sheets: [{ id: 'b/1', title: 't3' }] };
    const tapTown = { cluster: { members: [locTown] } };
    const tapCounty = { cluster: { members: [locCounty] } };
    const merged = OtherMaps.mergeTapSheets([tapTown, tapCounty]);
    eq(merged.sheets.length, 3, 'tapping two overlapping dots lists every sheet');
    eq(merged.places.length, 2, 'tapping two overlapping dots names both places');
    eq(OtherMaps.mergeTapSheets([tapTown, tapTown, tapCounty]).sheets.length, 3,
        'a sheet reached twice is listed once');
    eq(OtherMaps.mergeTapSheets([{ cluster: { members: [locTown, locCounty] } }]).sheets.length, 0,
        'a geographic group contributes no sheets to the merge');
    const lone = OtherMaps.mergeTapSheets([tapCounty]);
    eq(lone.sheets.length, 1, 'a lone dot still opens its own sheet');
    eq(lone.places[0], locCounty.place, 'a lone dot keeps its place name');

    /* ══ 5. labels ════════════════════════════════════════════════════ */
    ok(OtherMaps.t('om_add').length > 0, 'the Romanian table is used when the page is Romanian');
    ['ro', 'en', 'hu'].forEach((lang) => {
        ok(OtherMaps.strings[lang].om_places_count.indexOf('{n}') >= 0, lang + ' counts merged places');
        ok(OtherMaps.strings[lang].om_place_count.length > 0, lang + ' names one merged place');
    });
    eq(OtherMaps.formatMeters(0.42), '0.42 m', 'sub-metre widths read in metres');
    eq(OtherMaps.formatMeters(2500), '2.50 km', 'kilometre widths read in km');
    const limits = Overlay.limits;
    eq(OtherMaps.sliderFromMppLimits(limits.mppMin, limits), 0, 'the scale slider starts at the minimum');
    eq(OtherMaps.sliderFromMppLimits(limits.mppMax, limits), 1000, 'the scale slider ends at the maximum');

    /* ══ 6. the manager: framing on add + level crossfade ═════════════ */
    /* The overlay manager against a fake map + mini DOM. The sheet's
     * natural size comes from the catalogue hint (no network), tile <img>s
     * load only when the test dispatches 'load', and the stand-in's
     * fallback timer is flushed on demand. */
    const simMap = fakeMap({ zoom: 12, size: { x: 400, y: 800 }, center: { lat: 47.933, lng: 23.892 } });
    const mgr = Overlay.createManager(simMap, { pane: 'om_test_pane', opacity: 0.8 });
    const rec = {
        id: 'TST/1',
        path: 'maps/mol/s011/s11_0647/s11_0647.ecw',
        lat: 47.933,
        lng: 23.892,
        w: 8000,
        h: 6000
    };
    const ov = await mgr.add(rec);
    await new Promise((r) => setImmediate(r));   // let the tile-URL promises set src

    // A fresh sheet is framed into the viewport, not dropped at an
    // arbitrary ground size.
    const fitMpp12 = Overlay.fitScale(8000, 6000, Overlay.resolutionAt(47.933, 12), 400, 800);
    ok(Math.abs(ov.state.mpp - fitMpp12) / fitMpp12 < 1e-9,
        'a fresh sheet is framed: mpp = fitScale(viewport, zoom)');
    eq(ov.geom.level, 0, 'the fitted sheet sits at the pyramid root at county zoom');
    const gridTiles = () => ov.gridEl.children.filter((el) => el.tagName === 'IMG');
    eq(gridTiles().length, 1, 'the whole fitted sheet is one root-level tile');

    // Zoom in → finer level: the old tiles stay as a blurred stand-in,
    // repositioned by 2^Δ, until the new level loads.
    simMap._state.zoom = 13;
    simMap.fire('zoomend');
    await new Promise((r) => setImmediate(r));
    eq(ov.geom.level, 1, 'zooming in moves the sheet to a finer pyramid level');
    ok(ov.stale && Object.keys(ov.stale.imgs).length === 1,
        'the old level is kept as a stand-in while the finer one loads');
    eq(gridTiles().length, 5, 'stand-in tiles and new tiles coexist on the grid');
    const standin = ov.stale.imgs['0:0:0'];
    eq(standin.style.left, '0px', 'the stand-in tile keeps its ground position');
    eq(standin.style.width, '1024.6px', '…scaled 2^Δ to cover the same ground at the finer level');
    ok(standin.className.indexOf('om-tile-stale') >= 0, 'stand-in tiles are tagged as such');
    eq(pendingTimers.size, 1, 'the stand-in carries a fallback timer');

    // Nothing loads → the fallback drops the stand-in (no forever blur).
    flushTimers();
    ok(!ov.stale, 'the fallback timer retires the stand-in');
    eq(gridTiles().length, 4, '…leaving exactly the new-level window');
    eq(pendingTimers.size, 0, '…and the fallback timer is gone');

    // Zoom out → coarser level: the finer tiles are dropped, no stand-in.
    simMap._state.zoom = 11;
    simMap.fire('zoomend');
    await new Promise((r) => setImmediate(r));
    eq(ov.geom.level, 0, 'zooming out returns to the coarser level');
    ok(!ov.stale, 'going coarser drops the finer tiles (nothing can stand in)');
    eq(gridTiles().length, 1, 'the coarser window is refetched');

    // Zoom in again, and this time the tiles load: the stand-in retires
    // the moment every wanted tile has settled.
    simMap._state.zoom = 13;
    simMap.fire('zoomend');
    await new Promise((r) => setImmediate(r));
    ok(ov.stale, 'the stand-in is back for the second zoom-in');
    gridTiles().filter((el) => el.className.indexOf('stale') < 0)
        .forEach((img) => img.dispatch('load'));
    ok(!ov.stale, 'every new tile settled → the stand-in retires');
    eq(gridTiles().length, 4, '…and the grid holds exactly the new-level window');

    // Reset returns to the framed state of the current view (zoom 13 here).
    mgr.reset('TST/1');
    const fitMpp13 = Overlay.fitScale(8000, 6000, Overlay.resolutionAt(47.933, 13), 400, 800);
    ok(Math.abs(ov.state.mpp - fitMpp13) / fitMpp13 < 1e-9, 'reset returns the framed scale');
    eq(ov.state.rotation, 0, 'reset clears the rotation');
    ok(ov.state.lat === rec.lat && ov.state.lng === rec.lng, 'reset restores the sheet position');

    // Removal cleans up tiles and leaves no timer behind.
    mgr.remove('TST/1');
    eq(gridTiles().length, 0, 'remove empties the grid');
    eq(pendingTimers.size, 0, '…and no stand-in timer is left behind');

    /* ══ 6b. one opacity slider for every sheet ════════════════════════
     * The layer slider is a master control.  It used to touch only the
     * active sheet, so a second (often restored) Josephine scan stayed
     * painted at its own saved opacity even after the user set 0%. */
    const ovA = await mgr.add(Object.assign({}, rec, { id: 'TST/A' }));
    const ovB = await mgr.add(Object.assign({}, rec, {
        id: 'TST/B', lat: 47.95, lng: 23.91
    }));
    await new Promise((r) => setImmediate(r));
    mgr.setActive('TST/A');
    eq(mgr.setOpacityAll(0), 0, 'setOpacityAll clamps to 0');
    eq(ovA.root.style.opacity, '0', 'the active sheet follows the master opacity');
    eq(ovB.root.style.opacity, '0', 'a non-active sheet follows it too');
    eq(mgr.snapshot().overlays.filter((o) => o.opacity === 0).length, 2,
        'the snapshot records 0 for every sheet, so a restore cannot resurrect one');
    mgr.setOpacityAll(0.55);
    eq(ovA.root.style.opacity, '0.55', 'raising the master opacity reaches the active sheet');
    eq(ovB.root.style.opacity, '0.55', '…and the inactive one');
    mgr.remove('TST/A');
    mgr.remove('TST/B');
    flushTimers();
    eq(gridTiles().length, 0, 'the opacity fixtures leave no tiles behind');

    /* ══ 7. zoom animation: dots and sheets stay locked to the tiles ════
     * The reported glitch: while Leaflet animates a zoom it leaves the map
     * pane stationary for 250 ms and CSS-scales ONLY the tile containers.
     * The dots canvas and the sheet roots have to apply the matching
     * transform themselves — otherwise they sit still, drift away from
     * their places, and snap back at zoomend (“se mișcă sacadat”).  This
     * section drives a fake map with the real Web Mercator conventions
     * (project space linear in zoom, layer = project − pixelOrigin,
     * container = layer + mapPanePos, map pane at a constant pan offset)
     * and checks the exact transform string plus the geometry: every
     * painted pixel must land at its target-zoom position. */
    const BASE = 1000;
    const projectAt = (ll, z) => pt(BASE * Math.pow(2, z) * ll.lng, BASE * Math.pow(2, z) * ll.lat);
    const PANE_POS = pt(17, 9);   // a non-zero pan drift, so anchors aren't trivial
    function makeProjMap(initial) {
        const state = Object.assign({}, initial);
        const panes = Object.create(null);
        const events = Object.create(null);
        const containerEl = fakeEl('div');
        const originAt = (center, z) => projectAt(center, z)
            .subtract(pt(state.size.x / 2, state.size.y / 2)).add(PANE_POS);
        return {
            _animatingZoom: false,
            _state: state,
            getZoom: () => state.zoom,
            getSize: () => pt(state.size.x, state.size.y),
            getCenter: () => state.center,
            getContainer: () => containerEl,
            getPane: (name) => panes[name] || null,
            createPane: (name) => {
                const p = fakeEl('div');
                panes[name] = p;
                containerEl.appendChild(p);
                return p;
            },
            project: (ll, z) => projectAt(ll, z == null ? state.zoom : z),
            getPixelOrigin: () => originAt(state.center, state.zoom),
            _getNewPixelOrigin: (center, z) => originAt(center, z),
            getZoomScale: (to, from) => Math.pow(2, to - from),
            latLngToLayerPoint: (ll) => projectAt(ll, state.zoom).subtract(originAt(state.center, state.zoom))._round(),
            containerPointToLayerPoint: (cp) => cp.subtract(PANE_POS),
            getBounds: () => {
                const scale = BASE * Math.pow(2, state.zoom);
                const halfW = state.size.x / 2 / scale, halfH = state.size.y / 2 / scale;
                return {
                    getSouth: () => state.center.lat - halfH,
                    getNorth: () => state.center.lat + halfH,
                    getWest: () => state.center.lng - halfW,
                    getEast: () => state.center.lng + halfW
                };
            },
            on: (type, fn) => { (events[type] = events[type] || []).push(fn); },
            off: (type, fn) => { events[type] = (events[type] || []).filter((f) => f !== fn); },
            fire: (type, ev) => { (events[type] || []).slice().forEach((fn) => fn(Object.assign({ type }, ev))); }
        };
    }
    const projMap = makeProjMap({ zoom: 12, size: { x: 800, y: 600 }, center: { lat: 46.769, lng: 23.59 } });
    const originAt = (z) => projectAt(projMap.getCenter(), z)
        .subtract(pt(400, 300)).add(PANE_POS);
    const TOP_LEFT = pt(0, 0).subtract(PANE_POS);   // containerPointToLayerPoint(0,0)

    // ── the dots canvas ─────────────────────────────────────────────────
    fakeCatalogJson = catalog;
    fakeJosephineJson = {
        centre: { d: 'Centre', l: 'https://commons.wikimedia.org/wiki/File:Test.jpg', c: { lat: 46.769, lng: 23.59 } },
        nearby: { d: 'Nearby', l: 'https://commons.wikimedia.org/wiki/File:Test.jpg', c: { lat: 46.76905, lng: 23.59 } },
        bocsaCs: { d: 'Bocsa CS homonym', l: 'https://commons.wikimedia.org/wiki/File:Test.jpg', c: { lat: 45.3781756, lng: 21.7312589 } },
        homonym: { d: 'Distant homonym', l: 'https://commons.wikimedia.org/wiki/File:Test.jpg', c: { lat: 45, lng: 25 } }
    };
    OtherMaps.attach(projMap);
    OtherMaps.setEnabled(true);
    await new Promise((r) => setImmediate(r));   // loadCatalog → ensureCanvas → redraw
    ok(OtherMaps.isEnabled(), 'the layer turns on with the fake map attached');
    ok(OtherMaps.state.canvas && /leaflet-zoom-animated/.test(OtherMaps.state.canvas.className),
        'the dots canvas carries the zoom-anim class (0.25 s transition, 0 0 origin)');
    ok(OtherMaps.state.hits.length > 0, 'dots are painted at the settled zoom');
    ok(OtherMaps.records().some((r) => r.source === 'josephine'), 'enable loads the Josephine catalogue');
    const foot = OtherMaps.state.josephineFootprints;
    eq(foot.length, 1, 'out-of-Transylvania homonyms are excluded without creating extra coverage discs');
    eq(foot[0].places.length, 2, 'only the Transylvania localities remain on the sheet footprint');
    ok(foot.every((f) => OtherMaps.isInJosephineTransylvania(f.lat, f.lng)),
        'every painted Josephine footprint sits inside the Transylvania survey');
    ok(OtherMaps.state.hits.some((h) => h.coverage), 'coverage appears below zoom 13');
    const styles = [];
    const ctx = OtherMaps.state.ctx;
    const oldFill = ctx.fill;
    ctx.fill = function () { styles.push(this.fillStyle); };
    OtherMaps.redraw();
    ctx.fill = oldFill;
    ok(styles.length > 1 && styles[0] === 'rgba(0, 70, 35, 0.30)', 'dark green coverage is drawn first');
    ok(styles.slice(1).some((style) => style !== styles[0]), 'existing green dots are drawn on top');
    const strokes = [];
    const originalStroke = ctx.stroke;
    ctx.stroke = function () { strokes.push(this.strokeStyle); };
    OtherMaps.redraw();
    ctx.stroke = originalStroke;
    eq(strokes[0], 'rgba(255, 255, 255, 0.7)', 'dark coverage circles have a translucent white outline');
    const coverageHit = OtherMaps.state.hits.find((h) => h.coverage);
    ok(OtherMaps.mergeTapSheets([coverageHit]).sheets[0].source === 'josephine',
        'the coverage hit resolves to the selectable Josephine sheet');


    const omState = OtherMaps.state;
    const anchor12 = originAt(12).add(TOP_LEFT);
    ok(Math.abs(omState.lastAnchor.x - anchor12.x) < 1e-6 && Math.abs(omState.lastAnchor.y - anchor12.y) < 1e-6,
        'a settled redraw records the project-space anchor of the painted frame');
    eq(omState.lastZoom, 12, '…and the zoom it was painted at');
    eq(omState.canvas.style.transform, 'translate3d(-17px,-9px,0)',
        'a settled canvas is placed plainly (no zoom transform lingers)');

    // Animated zoom in (button / double-tap / wheel): no move events fire
    // for 250 ms — the zoomanim handler must scale the settled frame.
    projMap.fire('zoomanim', { center: projMap.getCenter(), zoom: 13 });
    const p1_13 = originAt(13);
    const expOff = anchor12.multiplyBy(2).subtract(p1_13)._round();
    eq(omState.canvas.style.transform,
        'translate3d(' + expOff.x + 'px,' + expOff.y + 'px,0) scale(2)',
        'zoomanim applies translate(2·anchor − newOrigin) scale(2)');

    // The geometry: after the transform, every painted dot sits exactly
    // where the settled z13 view would paint it (container coordinates).
    omState.hits.forEach(function (hit) {
        const drawn = projectAt(hit.latlng, 12).subtract(originAt(12));   // layer point as painted
        const local = drawn.subtract(TOP_LEFT);                          // canvas pixel
        const got = PANE_POS.add(pt(expOff.x + 2 * local.x, expOff.y + 2 * local.y));
        const want = projectAt(hit.latlng, 13).subtract(originAt(13)).add(PANE_POS);
        ok(Math.abs(got.x - want.x) < 1e-4 && Math.abs(got.y - want.y) < 1e-4,
            'a dot stays on its place through the animated zoom (' + hit.cluster.count + ' sheets)');
    });

    // Settling (zoomend): a plain redraw resets the transform and re-records.
    projMap._state.zoom = 13;
    projMap.fire('move');
    projMap.fire('zoomend');
    eq(omState.lastZoom, 13, 'the settled redraw re-records the frame at the new zoom');
    eq(omState.canvas.style.transform, 'translate3d(-17px,-9px,0)',
        '…and the canvas goes back to a plain placement (no lingering scale)');

    // Pinch: 'zoom' events fire per frame and the origin already moves —
    // the transform must track the live center/zoom from the settled frame,
    // and 'move' events must NOT redraw mid-pinch (they would fight it).
    projMap.touchZoom = { _zooming: true };
    const anchor13 = originAt(13).add(TOP_LEFT);
    projMap.fire('move');
    ok(Math.abs(omState.lastAnchor.x - anchor13.x) < 1e-6 && Math.abs(omState.lastAnchor.y - anchor13.y) < 1e-6,
        'mid-pinch move events do not repaint (guard)');
    projMap._state.zoom = 14;
    projMap.fire('zoom', { pinch: true });
    const expOffPinch = anchor13.multiplyBy(2).subtract(originAt(14))._round();
    eq(omState.canvas.style.transform,
        'translate3d(' + expOffPinch.x + 'px,' + expOffPinch.y + 'px,0) scale(2)',
        'a pinch rescales the settled frame live (zoom 13 → 14)');
    projMap.touchZoom._zooming = false;
    projMap.fire('move');
    projMap.fire('zoomend');
    eq(omState.lastZoom, 14, 'after the pinch settles, the frame is re-recorded at 14');
    eq(omState.canvas.style.transform, 'translate3d(-17px,-9px,0)',
        '…and the plain placement is restored');

    // ── the sheet overlays ──────────────────────────────────────────────
    const mgr2 = OtherMaps.state.manager;   // created by attach() on projMap
    const rec7 = {
        id: 'TST/7',
        path: 'maps/mol/s011/s11_0647/s11_0647.ecw',
        /* Deliberately OFF the map centre: a centre point keeps the same
         * layer position at every zoom, which would hide re-anchoring. */
        lat: 47.95,
        lng: 23.91,
        w: 8000,
        h: 6000
    };
    const ov7 = await mgr2.add(rec7);
    await new Promise((r) => setImmediate(r));
    ok(/leaflet-zoom-animated/.test(ov7.root.className),
        'the sheet root carries the zoom-anim class');
    eq(ov7.root.style.transform,
        'translate3d(' + ov7.anchor.x + 'px,' + ov7.anchor.y + 'px,0)',
        'a settled sheet is placed at its anchor (no zoom transform)');

    // Animated zoom out → in by two: the root gets
    // translate(s·(projectAnchor − anchor) − newOrigin) scale(s) translate(anchor).
    projMap.fire('zoomanim', { center: projMap.getCenter(), zoom: 15 });
    const a14 = pt(ov7.anchor.x, ov7.anchor.y);
    const bitmapAnchor7 = originAt(14).add(a14);
    const off7 = bitmapAnchor7.multiplyBy(2).subtract(originAt(15))._round();
    eq(ov7.root.style.transform,
        'translate3d(' + off7.x + 'px,' + off7.y + 'px,0) scale(2)',
        'zoomanim scales the sheet around its bitmap anchor (14 → 15)');

    // …and the sheet's anchor point stays on the ground: container of the
    // anchor after the transform = the settled z15 container of its LatLng.
    const anchorContainer15 = projectAt(rec7, 15).subtract(originAt(15)).add(PANE_POS);
    // The anchor is the root's local (0,0): translate(off7)·scale(2) maps it
    // to off7 in pane coordinates.
    const gotAnchor = PANE_POS.add(pt(off7.x, off7.y));
    ok(Math.abs(gotAnchor.x - anchorContainer15.x) < 1 && Math.abs(gotAnchor.y - anchorContainer15.y) < 1,
        'the sheet anchor stays on its ground point through the animation');

    // …and a content point stays on the ground too — the whole scan must not
    // drift, not just the anchor.
    const p7 = pt(123, 45);
    const gotContent = PANE_POS.add(pt(off7.x + 2 * p7.x, off7.y + 2 * p7.y));
    const wantContent = projectAt(rec7, 15).add(pt(2 * p7.x, 2 * p7.y))
        .subtract(originAt(15)).add(PANE_POS);
    ok(Math.abs(gotContent.x - wantContent.x) < 1 && Math.abs(gotContent.y - wantContent.y) < 1,
        'a sheet content point stays on its ground point through the animation');

    // Settle: render() resets the root transform and re-records the frame.
    projMap._state.zoom = 15;
    projMap.fire('move');
    projMap.fire('zoomend');
    ok(ov7.anchor.x !== a14.x || ov7.anchor.y !== a14.y,
        'settling at z15 re-anchors the sheet (layer points changed)');
    eq(ov7.root.style.transform,
        'translate3d(' + ov7.anchor.x + 'px,' + ov7.anchor.y + 'px,0)',
        '…and the plain placement is restored');

    // The georeference square is geographic too: a zoom animation scales it
    // around the place (its own centre) with the same transform the sheet
    // root gets, so the square stays locked to the ground through the glide.
    const homeLL = { lat: rec7.lat, lng: rec7.lng };
    const homeLayer = projMap.latLngToLayerPoint(homeLL);
    projMap.fire('zoomanim', { center: projMap.getCenter(), zoom: 16 });
    const homeBitmap = originAt(15).add(homeLayer);
    const gOff = homeBitmap.multiplyBy(2).subtract(originAt(16))._round();
    eq(ov7.georefEl.style.transform,
        'translate3d(' + gOff.x + 'px,' + gOff.y + 'px,0) scale(2)',
        'the georeference square scales around the place through the animation');

    /* ══ 8. the georeference square ═════════════════════════════════════
     * Every Hungaricana sheet is confined to a square around the place it
     * was added for: the anchor may be dragged/rotated/scaled, but it may
     * never leave the square.  5 km is the default; the panel can enlarge it
     * for an exceptional sheet. */
    const G_R = 6378137;
    const G_MPP_LAT = Math.PI * G_R / 180;
    function groundMeters(lat, lng, cLat, cLng) {
        return {
            x: (lng - cLng) * G_MPP_LAT * Math.cos(cLat * Math.PI / 180),
            y: (lat - cLat) * G_MPP_LAT
        };
    }
    const G_LAT = 47.0, G_LNG = 23.0;
    const insidePt = Overlay.clampToSquare(47.01, 23.01, G_LAT, G_LNG, 5);
    ok(Math.abs(insidePt.lat - 47.01) < 1e-9 && Math.abs(insidePt.lng - 23.01) < 1e-9,
        'a point inside the square is unchanged');
    const northPt = Overlay.clampToSquare(48.0, 23.0, G_LAT, G_LNG, 5);
    let northM = groundMeters(northPt.lat, northPt.lng, G_LAT, G_LNG);
    ok(Math.abs(northM.y - 2500) < 1 && Math.abs(northM.x) < 1,
        'a point far north clamps to the north edge (+2.5 km on the ground)');
    const eastPt = Overlay.clampToSquare(47.0, 24.0, G_LAT, G_LNG, 5);
    let eastM = groundMeters(eastPt.lat, eastPt.lng, G_LAT, G_LNG);
    ok(Math.abs(eastM.x - 2500) < 1 && Math.abs(eastM.y) < 1,
        'a point far east clamps to the east edge (+2.5 km on the ground)');
    const cornerPt = Overlay.clampToSquare(48.0, 24.0, G_LAT, G_LNG, 5);
    let cornerM = groundMeters(cornerPt.lat, cornerPt.lng, G_LAT, G_LNG);
    ok(Math.abs(cornerM.x - 2500) < 1 && Math.abs(cornerM.y - 2500) < 1,
        'a point past the corner clamps to the corner');
    const bigPt = Overlay.clampToSquare(47.2, 23.0, G_LAT, G_LNG, 100);
    ok(Math.abs(bigPt.lat - 47.2) < 1e-9, 'a bigger square lets the point through');
    const zeroPt = Overlay.clampToSquare(48.0, 23.0, G_LAT, G_LNG, 0);
    ok(Math.abs(zeroPt.lat - 48.0) < 1e-9, 'a zero square does not clamp');
    ok(isNaN(Overlay.clampToSquare(NaN, 23.0, G_LAT, G_LNG, 5).lat),
        'a non-finite latitude is returned unchanged');

    /* The manager: a fresh sheet owns a 5 km square, setState clamps the
     * anchor into it, setBoundsKm resizes it (enlarging lets the anchor
     * travel, shrinking pulls it back), the square is painted in layer space
     * and the state/snapshot carry the size. */
    const geoMap = fakeMap({ zoom: 12, size: { x: 400, y: 800 }, center: { lat: 47.933, lng: 23.892 } });
    const geoMgr = Overlay.createManager(geoMap, { pane: 'om_georef_pane', opacity: 0.8 });
    const geoRec = {
        id: 'TST/8',
        path: 'maps/mol/s011/s11_0647/s11_0647.ecw',
        lat: 47.933,
        lng: 23.892,
        w: 8000,
        h: 6000
    };
    const geoOv = await geoMgr.add(geoRec);
    await new Promise((r) => setImmediate(r));
    eq(geoOv.state.boundsKm, 5, 'a fresh sheet starts with the default 5 km square');
    eq(geoMgr.getBoundsKm('TST/8'), 5, 'getBoundsKm reports the default');
    ok(geoOv.georefEl && /om-georef/.test(geoOv.georefEl.className),
        'the sheet owns a georeference square element');
    ok(geoOv.georefEl.parentNode === geoMap.getPane('om_georef_pane'),
        'the square lives in the overlay pane');

    // A position far outside the square is clamped back to the edge.
    const farState = geoMgr.setState('TST/8', { lat: 48.5, lng: 23.892 });
    let farM = (farState.lat - geoRec.lat) * G_MPP_LAT;
    ok(farM > 2499 && farM <= 2500 + 1e-6,
        'setState clamps the anchor into the 5 km square, onto the edge');

    // Enlarging the square lets the anchor travel further.
    geoMgr.setBoundsKm('TST/8', 50);
    eq(geoMgr.getBoundsKm('TST/8'), 50, 'setBoundsKm stores the new square');
    const farState2 = geoMgr.setState('TST/8', { lat: 48.5, lng: 23.892 });
    let farM2 = (farState2.lat - geoRec.lat) * G_MPP_LAT;
    ok(farM2 > 2500, 'a bigger square lets the anchor move further');

    // Shrinking pulls the anchor back inside the smaller square.
    geoMgr.setState('TST/8', { lat: 48.5, lng: 23.892 });
    geoMgr.setBoundsKm('TST/8', 5);
    const shrunkM = (geoMgr.state('TST/8').lat - geoRec.lat) * G_MPP_LAT;
    ok(shrunkM <= 2500 + 1e-6, 'shrinking the square pulls the anchor back inside');

    // The square is drawn at the place, at the square side on the ground.
    geoMgr.setAlignMode(true);
    geoMgr.setActive('TST/8');
    const geoHalfPx = (5 * 1000 / 2) / Overlay.resolutionAt(geoRec.lat, 12);
    ok(Math.abs(parseFloat(geoOv.georefInner.style.width) - geoHalfPx * 2) < 1e-6,
        'the square is drawn at the square side on the ground');
    ok(geoOv.georefEl.style.display !== 'none', 'the square is visible in align mode');
    ok(geoMgr.state('TST/8').boundsKm === 5, 'publicState carries boundsKm');
    ok(geoMgr.snapshot().overlays[0].boundsKm === 5, 'the snapshot carries boundsKm');
    geoMgr.remove('TST/8');
    ok(!geoOv.georefEl.parentNode, 'remove detaches the square');

    /* ══ 9. the panel selector ═════════════════════════════════════════
     * The “Overlay the map” panel exposes the square size as an option. The
     * helper that builds the <option> list is exercised here (the mini DOM in
     * this file cannot parse the panel's innerHTML); the manager side of the
     * change is covered by the setBoundsKm checks above. */
    const georefOptions = OtherMaps.georefOptionsHtml(5);
    ok(/value="5"/.test(georefOptions), 'the selector offers the 5 km preset');
    ok(/value="100"/.test(georefOptions), 'the selector offers the 100 km preset');
    ok(/value="5">5 km<\/option>/.test(georefOptions), 'each preset is labelled with its size');
    const georefCustom = OtherMaps.georefOptionsHtml(7);
    ok(/value="7"/.test(georefCustom), 'a non-preset square is offered as its own option');
    ok(OtherMaps.strings.ro.om_georef && OtherMaps.strings.en.om_georef && OtherMaps.strings.hu.om_georef,
        'the georeference label exists in all three languages');
    ok(OtherMaps.strings.ro.om_georef_hint && OtherMaps.strings.en.om_georef_hint && OtherMaps.strings.hu.om_georef_hint,
        'the georeference hint exists in all three languages');

    /* ══ 10. the NLS Map Finder adapter ════════════════════════════════
     * js/other-maps-nls.js turns the NLS GeoServer WFS features into Other
     * maps records and reads the scans through the IIIF Image API.  Nothing
     * here touches the network: info.json and WFS bodies are served by the
     * URL-aware fetch stub at the top of this file. */
    ok(Nls && Nls.SOURCE === 'nls', 'the NLS adapter is loaded');
    eq(Nls.TILE_SIZE, 512, 'the IIIF tile grid matches the overlay grid');
    eq(Nls.FIND_LAYERS.length, 12, 'the finder query covers the twelve documented WFS layers');
    ok(Nls.COVERAGE.south === 49.1 && Nls.COVERAGE.north === 61, 'the coverage box is Great Britain / Ireland');

    eq(Nls.imageIdOf({ id: 'nls/228799835' }), '228799835', 'imageIdOf strips the nls/ prefix');
    eq(Nls.imageIdOf('228799835'), '228799835', 'imageIdOf accepts a bare viewer id');
    eq(Nls.iiifPath('102345214'), '10234/102345214', 'the IIIF path prefix drops the last four digits');
    eq(Nls.iiifPath('74415150'), '7441/74415150', 'an eight-digit town plan takes a four-digit prefix');
    eq(Nls.iiifBase({ path: '10234/102345214' }),
        'https://map-view.nls.uk/iiif/2/10234%2F102345214', 'the IIIF base URL encodes the slash');
    eq(Nls.thumbUrl({ id: 'nls/102345214', path: '10234/102345214' }),
        'https://map-view.nls.uk/iiif/2/10234%2F102345214/full/256,/0/default.jpg',
        'thumbnails are IIIF full-region requests');
    eq(Nls.recordUrl({ id: 'nls/102345214', path: '10234/102345214' }),
        'https://maps.nls.uk/view/102345214', 'the record URL points at the Map Images viewer');
    ok(/point=55.95330,-3.18830/.test(Nls.findUrl(55.9533, -3.1883)), 'the finder deep link carries the marker point');
    eq(Nls.maxZoomFor(13176, 10110), 5, 'a 13176 px sheet has a six-level pyramid');
    eq(Nls.maxZoomFor(512, 512), 0, 'a 512 px sheet has a single pyramid level');

    const v2 = Nls.parseInfo({
        width: 2048, height: 1024,
        tiles: [{ width: 512, height: 512, scaleFactors: [1, 2, 4, 8] }]
    });
    eq(v2.maxZoom, 3, 'IIIF v2 scale factors map onto pyramid levels');
    const v11 = Nls.parseInfo({ width: 9392, height: 8770, tile_width: 9392, scale_factors: [1, 2, 4, 8, 16, 32, 64, 128] });
    eq(v11.maxZoom, 7, 'IIIF v1.1 scale_factors are understood too');
    eq(Nls.parseInfo({ width: 1000, height: 800 }).maxZoom, Nls.maxZoomFor(1000, 800),
        'an info document without tiles falls back to the 512 px rule');

    const nlsRec = { id: 'nls/142842536', nlsId: '142842536', source: 'nls', path: '14284/142842536', w: 13176, h: 10110 };
    const nlsMeta = await Nls.resolve(nlsRec, { w: 13176, h: 10110 });
    eq(nlsMeta.w, 13176, 'resolve honours the catalogue size hint without a request');
    eq(nlsMeta.maxZoom, 5, 'the hinted pyramid depth is computed');
    const nativeTile = await Nls.tileUrl(nlsRec, 0, 0, 5);
    eq(nativeTile, 'https://map-view.nls.uk/iiif/2/14284%2F142842536/0,0,512,512/512,512/0/default.jpg',
        'a native-level tile is a 512 px IIIF region request');
    const rootTile = await Nls.tileUrl(nlsRec, 0, 0, 0);
    eq(rootTile, 'https://map-view.nls.uk/iiif/2/14284%2F142842536/0,0,13176,10110/412,316/0/default.jpg',
        'the pyramid root is one whole-image request at the smallest derivative');
    const edgeTile = await Nls.tileUrl(nlsRec, 25, 0, 5);
    ok(/\/12800,0,376,512\/376,512\/0\/default\.jpg$/.test(edgeTile), 'edge tiles are clamped to the image width');
    eq(await Nls.tileUrl(nlsRec, 26, 0, 5), '', 'a tile outside the grid resolves to an empty URL');

    /* ── tile spans (§8.2): what a tile really covers ────────────────────
     * IIIF clamps the region at the sheet edge, so the bitmap of the last
     * column / row is narrower than 512 px.  The overlay paints a tile at
     * the span reported here; stretching those bitmaps over a full square
     * cell distorted the sheet — by 512/384 at one level, 512/256 at the
     * next — which is what the user saw as “the maps distort on zoom”. */
    const rootSpan = await Nls.tileSpan(nlsRec, 0, 0, 0);
    ok(Math.abs(rootSpan.w - 13176 / 32) < 1e-9 && Math.abs(rootSpan.h - 10110 / 32) < 1e-9,
        'the pyramid root tile spans the whole sheet at its level size (411.75 × 315.94 px)');
    const nativeSpan = await Nls.tileSpan(nlsRec, 0, 0, 5);
    eq(nativeSpan.w, 512, 'an interior native tile spans a full 512 px cell (width)');
    eq(nativeSpan.h, 512, 'an interior native tile spans a full 512 px cell (height)');
    const edgeSpan = await Nls.tileSpan(nlsRec, 25, 0, 5);
    eq(edgeSpan.w, 376, 'the last native column spans only its clamped width');
    eq(edgeSpan.h, 512, '…and a full cell in height');
    const bottomSpan = await Nls.tileSpan(nlsRec, 0, 19, 5);
    eq(bottomSpan.h, 382, 'the last native row spans only its clamped height');
    eq((await Nls.tileSpan(nlsRec, 25, 19, 5)).w, 376, 'a corner tile is clamped on both axes');

    /* The free Josephine source crops its Wikimedia canvases the same way
     * and reports the same spans (one Commons metadata lookup, shared by
     * the tile URL and the span). */
    fakeCommonsJson = {
        query: { pages: { '-1': { imageinfo: [{
            url: 'https://upload.wikimedia.org/scan.jpg', width: 6000, height: 4000
        }] } } }
    };
    const josRecord = {
        id: 'josephine:scan.jpg', source: 'josephine',
        josephineEntry: { l: 'https://commons.wikimedia.org/wiki/File:Scan.jpg' }
    };
    const josRoot = await JosephineTiles.tileSpan(josRecord, 0, 0, 0);
    eq(josRoot.w, 375, 'a Josephine root tile spans the whole 6000 px sheet at its level width');
    eq(josRoot.h, 250, '…and its level height, not a 512 px square');
    const josEdge = await JosephineTiles.tileSpan(josRecord, 11, 0, 4);
    eq(josEdge.w, 368, 'a Josephine edge tile is clipped to the scan width');
    eq((await JosephineTiles.tileSpan(josRecord, 0, 7, 4)).h, 416, '…and the last row to its height');
    fakeCommonsJson = null;

    fakeNlsInfoJson = {
        width: 2048, height: 1024,
        tiles: [{ width: 512, height: 512, scaleFactors: [1, 2, 4, 8] }]
    };
    const fetched = await Nls.resolve({ id: 'nls/910000001', source: 'nls', path: '91000/910000001' });
    eq(fetched.maxZoom, 3, 'without a hint the pyramid comes from the fetched info.json');
    const candidates = Nls.iiifBaseCandidates({ path: '91000/910000001' });
    eq(candidates.length, 3, 'the info lookup has the current and two legacy service paths');
    ok(candidates[0].indexOf('/iiif/2/') !== -1 && candidates[2].indexOf('/iiif/1/') !== -1,
        'the current /iiif/2 service is tried before the legacy paths');
    fakeNlsInfoJson = null;
    let resolveFailed = false;
    try {
        await Nls.resolve({ id: 'nls/910000009', source: 'nls', path: '91000/910000009' });
    } catch (e) { resolveFailed = true; }
    ok(resolveFailed, 'an unreachable info.json rejects so the overlay can apply its fallback size');
    fakeNlsInfoJson = { width: 2048, height: 1024, tiles: [{ scaleFactors: [1, 2, 4, 8] }] };

    const wfsUrl = decodeURIComponent(Nls.wfsBBoxUrl({ west: -3.3, south: 55.9, east: -3.1, north: 56.0 }));
    eq((wfsUrl.match(/nls:/g) || []).length, 12, 'the WFS query names every finder layer');
    eq((wfsUrl.match(/INTERSECTS/g) || []).length, 12, 'each layer gets its own INTERSECTS filter');
    ok(wfsUrl.indexOf('SRID=4326;POLYGON') !== -1 && wfsUrl.indexOf('maxFeatures=300') !== -1,
        'the bbox query is an EPSG:4326 polygon capped at 300 features');
    eq((wfsUrl.match(/the_geom/g) || []).length, 24,
        'the footprint column is both returned (propertyName) and filtered (CQL_INTERSECTS)');

    const sampleFeature = {
        id: 'OS_Town_Plans_Eng_non500_WFS.60',
        properties: { IMAGE: '228799835', SHEET: 'Accrington - Sheet 1, Surveyed: 1849,<br> Published: 1851', DATES: '', YEAR: '1851' },
        geometry: { type: 'MultiPolygon', coordinates: [[[[-2.3695, 53.7511], [-2.3695, 53.7568], [-2.3549, 53.7568], [-2.3549, 53.7511], [-2.3695, 53.7511]]]] }
    };
    const sampleRecord = Nls.featureToRecord(sampleFeature);
    eq(sampleRecord.id, 'nls/228799835', 'a WFS feature becomes an nls record');
    eq(sampleRecord.path, '22879/228799835', 'the record carries the IIIF path');
    eq(sampleRecord.place, 'Accrington', 'the place is the sheet-title prefix');
    eq(sampleRecord.year, 1851, 'the YEAR property is parsed');
    ok(Math.abs(sampleRecord.lat - 53.75395) < 1e-9 && Math.abs(sampleRecord.lng + 2.3622) < 1e-9,
        'the point is the footprint bbox centroid');
    const dated = Nls.featureToRecord({
        id: 'towns.7',
        properties: { IMAGE: '700000007', SHEET: 'Oldtown - Plan', DATES: 'Published 1872' },
        geometry: { type: 'Polygon', coordinates: [[[-3, 54], [-3, 54.1], [-2.9, 54.1], [-2.9, 54], [-3, 54]]] }
    });
    eq(dated.year, 1872, 'a missing YEAR falls back to the DATES text');
    eq(Nls.featureToRecord({ properties: { IMAGE: 'not-a-number' }, geometry: sampleFeature.geometry }), null,
        'a feature without a numeric viewer id is rejected');
    eq(Nls.stripHtml('a&nbsp;<br>b &amp; c'), 'a b & c', 'HTML in titles is flattened to text');
    ok(Nls.inCoverage(55.95, -3.19) && !Nls.inCoverage(46.77, 23.6), 'coverage accepts Scotland and rejects Romania');
    ok(Nls.intersectsCoverage({ west: -4, south: 55, east: -2, north: 56 }), 'an overlapping bbox is inside coverage');
    ok(!Nls.intersectsCoverage({ west: 20, south: 45, east: 28, north: 48 }), 'a Romanian bbox is outside coverage');

    fakeWfsJson = {
        type: 'FeatureCollection',
        features: [
            sampleFeature,
            Object.assign({}, sampleFeature, { properties: Object.assign({}, sampleFeature.properties, { IMAGE: '228799838' }) }),
            sampleFeature,
            { properties: { IMAGE: 'bad' }, geometry: sampleFeature.geometry }
        ]
    };
    const found = await Nls.queryBBox({ west: -3.3, south: 55.9, east: -3.1, north: 56.0 });
    eq(found.length, 2, 'queryBBox parses features, drops bad rows and de-duplicates viewer ids');
    fakeWfsJson = null;
    const realWarn = console.warn;
    console.warn = () => {};   // the failure path warns by design; keep the test output clean
    const failed = await Nls.queryBBox({ west: -3.3, south: 55.9, east: -3.1, north: 56.0 });
    console.warn = realWarn;
    eq(failed.length, 0, 'a failed finder query resolves to an empty list, never throws');

    /* ══ 11. the multi-source dispatcher ═══════════════════════════════ */
    eq(Tiles.source('nls'), Nls, 'the NLS adapter registered itself with the tile dispatcher');
    eq(await Tiles.tileUrl(nlsRec, 0, 0, 5), nativeTile, 'record objects route to the NLS adapter');
    eq((await Tiles.tileSpan(nlsRec, 25, 0, 5)).w, 376, 'tile spans route to the NLS adapter');
    const hungSpan = await Tiles.tileSpan({ path: 'maps/mol/x/y.ecw' }, 3, 2, 4);
    eq(hungSpan.w, 512, 'a Hungaricana tile keeps the full square cell (the sheet is padded inside it)');
    eq(hungSpan.h, 512, '…on both axes, so the grid clip trims the padding');

    /* The span maths every CROPPED source shares (NLS IIIF regions and the
     * Josephine Commons canvases), independent of any network. */
    const spanMeta = { w: 13176, h: 10110, maxZoom: 5 };
    eq(Tiles.tileSpanFor(spanMeta, 0, 0, 5).w, 512, 'an interior cell spans a full 512 px');
    eq(Tiles.tileSpanFor(spanMeta, 0, 0, 5).h, 512, '…on both axes');
    eq(Tiles.tileSpanFor(spanMeta, 25, 0, 5).w, 376, 'the last column is clipped to the image width');
    eq(Tiles.tileSpanFor(spanMeta, 0, 19, 5).h, 382, 'the last row is clipped to the image height');
    eq(Tiles.tileSpanFor(spanMeta, 25, 19, 5).w, 376, 'a corner cell is clipped on both axes');
    eq(Tiles.tileSpanFor(spanMeta, 0, 0, 0).w, 13176 / 32, 'the pyramid root spans the whole sheet (width)');
    eq(Tiles.tileSpanFor(spanMeta, 0, 0, 0).h, 10110 / 32, '…and the whole sheet (height)');
    ok(Math.abs(Tiles.tileSpanFor({ w: 4096, h: 3072, maxZoom: 3 }, 0, 0, 0).h - 384) < 1e-9,
        'a 4:3 sheet at its root level spans 512 × 384, not a square');
    ok(typeof (Tiles.source('josephine') || {}).tileSpan === 'function',
        'the Josephine source reports tile spans too (its Commons canvases are cropped at the edge)');
    eq(Tiles.thumbUrl(nlsRec), Nls.thumbUrl(nlsRec), 'thumbnails route to the NLS adapter');
    eq(Tiles.recordUrl(nlsRec), Nls.recordUrl(nlsRec), 'record links route to the NLS adapter');
    eq(Tiles.thumbUrl({ path: 'maps/mol/x/y.ecw' }),
        'https://static-cdn.hungaricana.hu/tile/thumb/maps/mol/x/y.ecw',
        'a sourceless record object stays on the Hungaricana path');
    eq(Tiles.recordUrl('MOLTerkeptar/2146'),
        'https://maps.hungaricana.hu/en/MOLTerkeptar/2146/view/', 'plain string ids stay on the Hungaricana path');

    /* ══ 12. the committed NLS seed catalogue ══════════════════════════ */
    const nlsCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/other-maps-nls-catalog.json'), 'utf8'));
    ok(Array.isArray(nlsCatalog.maps) && nlsCatalog.maps.length > 50, 'the NLS seed holds a substantial set of sheets');
    eq(nlsCatalog.sourceId, 'nls', 'the catalogue declares its source id');
    ok(/^https:\/\/map-view\.nls\.uk\/iiif\/2\/$/.test(nlsCatalog.iiifBase), 'the catalogue names the IIIF service');
    ok(/geoserver\.nls\.uk\/geoserver\/wfs$/.test(nlsCatalog.wfs), 'the catalogue names the finder WFS endpoint');
    const nlsIds = new Set();
    nlsCatalog.maps.forEach((entry) => {
        ok(/^nls\/\d+$/.test(entry.id), entry.id + ' is an nls record id');
        ok(!nlsIds.has(entry.id), entry.id + ' is unique');
        nlsIds.add(entry.id);
        ok(entry.path === Nls.iiifPath(entry.id.split('/')[1]), entry.id + ' carries the correct <prefix>/<id> IIIF path');
        ok(entry.source === 'nls', entry.id + ' is tagged with the nls source');
        ok(entry.lat >= Nls.COVERAGE.south && entry.lat <= Nls.COVERAGE.north, entry.id + ' sits inside the coverage latitude band');
        ok(entry.lng >= Nls.COVERAGE.west && entry.lng <= Nls.COVERAGE.east, entry.id + ' sits inside the coverage longitude band');
        ok(entry.place && entry.title, entry.id + ' carries a place and a title');
        ok(!entry.w || (entry.w > 0 && entry.h > 0), entry.id + ' has no implausible size hint');
    });

    const combined = OtherMaps.combineCatalogMaps(
        { maps: [{ id: 'H/1', path: 'maps/mol/h.ecw', lat: 47, lng: 23, place: 'Cluj-Napoca (RO)' }] },
        { sourceId: 'nls', maps: [{ id: 'nls/1', path: '00001/1', lat: 54, lng: -3, place: 'Testtown' }] }
    );
    eq(combined.length, 2, 'combineCatalogMaps merges both catalogues');
    eq(combined[0].source, 'hungaricana', 'Hungaricana rows are tagged by default');
    eq(combined[1].source, 'nls', 'NLS rows keep their source id');

    /* ══ 13. module integration: strings, live merge, labels ═══════════ */
    ok(OtherMaps.strings.ro.om_source_nls && OtherMaps.strings.en.om_source_nls && OtherMaps.strings.hu.om_source_nls,
        'the NLS source button is translated in all three languages');
    ok(/National Library of Scotland/.test(OtherMaps.sourceLabel({ source: 'nls' })),
        'the NLS badge label names the library');
    const beforeCount = OtherMaps.records().length;
    const liveRecord = {
        id: 'nls/920000002', nlsId: '920000002', source: 'nls', path: '92000/920000002',
        title: 'Liveworth - Sheet 1', place: 'Liveworth', lat: 53.8, lng: -2.4, year: 1899,
        provider: 'National Library of Scotland', collection: 'towns', precision: 'settlement'
    };
    ok(OtherMaps.mergeLiveRecords([liveRecord, liveRecord]), 'a new live sheet is accepted');
    ok(!OtherMaps.mergeLiveRecords([liveRecord]), 'a repeated live sheet is not added twice');
    OtherMaps.rebuildRecords();
    eq(OtherMaps.records().length, beforeCount + 1, 'the live sheet joined the shared record index');
    ok(OtherMaps.records().some((r) => r.id === 'nls/920000002' && r.source === 'nls'),
        'the merged record keeps its source tag');
    const cellKey = OtherMaps.nlsCellKey({ west: -3.3, south: 55.9, east: -3.1, north: 56.0 });
    ok(/^\d+\|-?\d+\|-?\d+$/.test(cellKey), 'the live-query cache key is zoom|latCell|lngCell');
    OtherMaps.scheduleNlsLive();   // Romania viewport: must no-op without throwing

    /* ══ 14. an NLS sheet through the overlay manager ══════════════════
     * The free-transform machinery is source-agnostic: an NLS record goes
     * through the same fit/frame path, and its <img> elements receive IIIF
     * region URLs rather than ECW hashes. */
    const nlsMap = fakeMap({ zoom: 12, size: { x: 400, y: 800 }, center: { lat: 53.754, lng: -2.362 } });
    const nlsMgr = Overlay.createManager(nlsMap, { pane: 'om_nls_pane', opacity: 0.8 });
    const nlsSheet = {
        id: 'nls/930000003', nlsId: '930000003', source: 'nls', path: '93000/930000003',
        lat: 53.754, lng: -2.362, w: 4096, h: 3072
    };
    const nlsOv = await nlsMgr.add(nlsSheet);
    await new Promise((r) => setImmediate(r));
    const nlsImgs = nlsOv.gridEl.children.filter((el) => el.tagName === 'IMG');
    ok(nlsImgs.length >= 1, 'the NLS sheet paints tile images');
    ok(nlsImgs.every((img) => /map-view\.nls\.uk\/iiif\/2\/93000%2F930000003\/.+\.jpg/.test(img.src || '')),
        'every NLS tile src is an IIIF region URL');
    const nlsFit = Overlay.fitScale(4096, 3072, Overlay.resolutionAt(53.754, 12), 400, 800);
    ok(Math.abs(nlsOv.state.mpp - nlsFit) / nlsFit < 1e-9, 'a fresh NLS sheet is framed into the viewport like any other');

    /* Every tile is painted at the level-pixel span it covers.  At the
     * framing zoom the whole 4096 × 3072 NLS sheet arrives as one 512 × 384
     * IIIF bitmap; painting it in a 512 × 512 square cell stretched the
     * sheet 33 % vertically (and cropped it), and each finer level stretched
     * its edge tiles by another factor — the “maps distort on zoom” report. */
    const nlsGridImgs = () => nlsOv.gridEl.children.filter((el) => el.tagName === 'IMG');
    eq(nlsGridImgs().length, 1, 'the framed NLS sheet is one tile');
    eq(nlsGridImgs()[0].style.width, '512.6px', 'the tile spans the sheet width in level pixels');
    eq(nlsGridImgs()[0].style.height, '384.6px', '…and the sheet height, not a stretched 512 px square');

    nlsMap._state.zoom = 13;
    nlsMap.fire('zoomend');
    await new Promise((r) => setImmediate(r));
    eq(nlsOv.geom.level, 1, 'zooming in moves the NLS sheet to the finer level');
    const staleTiles = nlsGridImgs().filter((img) => img.className.indexOf('stale') >= 0);
    ok(staleTiles.length === 1 && staleTiles[0].style.width === '1024.6px' && staleTiles[0].style.height === '768.6px',
        'the outgoing tile keeps its own span, scaled by 2^Δ, while the finer level loads');
    const bottomRow = nlsGridImgs().filter((img) => img.style.top === '512px' && img.className.indexOf('stale') < 0);
    ok(bottomRow.length > 0 && bottomRow.every((img) => img.style.height === '256.6px'),
        'the finer level paints its bottom row at its own 256 px span (no square stretch)');
    const rightColumn = nlsGridImgs().filter((img) => img.style.left === '512px' && img.className.indexOf('stale') < 0);
    ok(rightColumn.length > 0 && rightColumn.every((img) => img.style.width === '512.6px'),
        'the right column of a 1024 px level is still a full cell');
    nlsMgr.remove('nls/930000003');

    const hungMap = fakeMap({ zoom: 12, size: { x: 400, y: 800 }, center: { lat: 47.933, lng: 23.892 } });
    const hungMgr = Overlay.createManager(hungMap, { pane: 'om_hung_pane', opacity: 0.8 });
    const hungSheet = { id: 'TST/NLS', path: 'maps/mol/s011/s11_0647/s11_0647.ecw', lat: 47.933, lng: 23.892, w: 4096, h: 3072 };
    const hungOv = await hungMgr.add(hungSheet);
    await new Promise((r) => setImmediate(r));
    const hungImgs = hungOv.gridEl.children.filter((el) => el.tagName === 'IMG');
    ok(hungImgs.length >= 1 && hungImgs.every((img) => /static-cdn\.hungaricana\.hu/.test(img.src || '')),
        'sourceless sheets still paint through the Hungaricana hash pyramid');
    hungMgr.remove('TST/NLS');

    /* ══ 15. finding and re-opening an added sheet ═══════════════════ */
    const fm = OtherMaps.state.map;          // the projMap attached in §7
    const fmgr = OtherMaps.state.manager;
    fm._state.zoom = 15;
    fm.fire('move');
    fm.fire('zoomend');
    await new Promise((r) => setImmediate(r));

    // The active sheet keeps its dashed border with align mode off, so a
    // sheet left at opacity 0 can be found again; the handles stay hidden.
    fmgr.setAlignMode(false);
    fmgr.setActive('TST/7');
    const ov7b = fmgr.get('TST/7');
    ok(ov7b.frameEl.style.display !== 'none', 'the active sheet keeps its dashed border with align mode off');
    ok(ov7b.handles.nw.style.display === 'none', 'the resize handles stay hidden outside align mode');
    ok(ov7b.georefEl.style.display === 'none', 'the georeference square stays hidden outside align mode');

    // Catalogue dots and coverage are hidden and non-interactive throughout
    // alignment, including redraws caused by movement or opacity changes.
    OtherMaps.redraw();
    ok(OtherMaps.state.hits.length > 0, 'catalogue targets are present before alignment');
    let clears = 0;
    const originalClear = OtherMaps.state.ctx.clearRect;
    OtherMaps.state.ctx.clearRect = function () { clears++; };
    fmgr.setAlignMode(true);
    eq(OtherMaps.state.hits.length, 0, 'starting alignment removes all dot and coverage targets');
    ok(clears > 0, 'starting alignment clears the dots canvas immediately');
    fm.fire('move');
    OtherMaps.setOpacity(70);
    eq(OtherMaps.state.hits.length, 0, 'redraws cannot restore dots during alignment');
    fmgr.setAlignMode(false);
    ok(OtherMaps.state.hits.length > 0, 'finishing alignment restores catalogue targets');
    fmgr.setAlignMode(true);
    fmgr.remove('TST/7');
    ok(OtherMaps.state.hits.length > 0, 'removing the last aligned sheet restores dots');
    OtherMaps.state.ctx.clearRect = originalClear;
    await fmgr.add(rec7);

    /* The public layer slider must reach every sheet, including restored
     * ones that are not active.  At 0% the dashed frame disappears with the
     * tiles (both live inside the root), so nothing keeps painting over the
     * basemap. */
    const fresh7 = fmgr.get('TST/7');
    const ov8 = await fmgr.add(Object.assign({}, rec7, {
        id: 'TST/8', lat: 47.99, lng: 23.99
    }));
    OtherMaps.setOpacity(0);
    eq(fresh7.root.style.opacity, '0', 'Other maps master opacity reaches the active sheet');
    eq(ov8.root.style.opacity, '0', '…and an inactive added sheet');
    ok(fresh7.frameEl.style.opacity !== '1' || fresh7.root.style.opacity === '0',
        'the selection frame cannot stay visible at 0%');
    OtherMaps.setOpacity(80);
    eq(ov8.root.style.opacity, '0.8', 'raising the layer opacity restores every sheet');
    fmgr.remove('TST/8');

    // A tap on the sheet hits the added map (container coordinates), so the
    // panel can be reopened by clicking the map that was added.
    fm.latLngToContainerPoint = (ll) => projectAt(ll, fm.getZoom())
        .subtract(originAt(fm.getZoom())).add(PANE_POS);
    const sheetPt = fm.latLngToContainerPoint({ lat: rec7.lat, lng: rec7.lng });
    eq(OtherMaps.overlayAtContainer(sheetPt).id, 'TST/7', 'a tap on the sheet lands on the added map');
    OtherMaps.setOpacity(0);
    eq(OtherMaps.overlayAtContainer(sheetPt), null,
        'an invisible 0% sheet cannot steal taps from the catalogue dots');
    OtherMaps.setOpacity(80);
    eq(OtherMaps.overlayAtContainer({ x: sheetPt.x + 100000, y: sheetPt.y + 100000 }), null,
        'a tap far from the sheet misses it');
    ok(OtherMaps.findAddedOverlay([{ id: 'TST/none' }, { id: 'TST/7' }]) === 'TST/7',
        'findAddedOverlay returns the first sheet already on the map');
    ok(OtherMaps.findAddedOverlay([{ id: 'TST/none' }]) === null,
        'findAddedOverlay returns null when nothing is added');

    // Clicking the added map reopens the panel: clear the green dots so the
    // tap resolves to the sheet, not to a place dot.
    OtherMaps.state.hits = [];
    fm.fire('click', { latlng: { lat: rec7.lat, lng: rec7.lng }, containerPoint: sheetPt });
    ok(OtherMaps.state.panel && OtherMaps.state.panel.classList.contains('show'),
        'clicking the added map reopens the panel');

    /* Josephine scans are folded into the same result/overlay record model.
     * Each image's marker radius must enclose every indexed locality. */
    const josephineDb = JSON.parse(fs.readFileSync(path.join(ROOT, 'iosfree_db.json'), 'utf8'));
    const josephineRecords = OtherMaps.buildJosephineRecords(josephineDb);
    ok(josephineRecords.length > 0, 'Josephine sheets are included in Other maps records');
    josephineRecords.forEach((record) => {
        ok(record.source === 'josephine' && record.path && record.josephineEntry,
            'Josephine records use the shared image-source record contract');
        const enclosing = record.josephinePlaces.every((p) => {
            const dLat = (p.lat - record.lat) * Math.PI / 180;
            const dLng = (p.lng - record.lng) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(record.lat * Math.PI / 180) *
                Math.cos(p.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
            const metres = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return metres <= record.coverageRadiusMeters;
        });
        ok(enclosing, 'Josephine coverage circles enclose all places assigned to each scan');
    });

    // Every catalogue locality must belong to a single compact Transylvania footprint.
    const allFootprints = OtherMaps.buildJosephineFootprints(josephineRecords);
    const dbKeys = Object.keys(josephineDb);
    eq(josephineRecords.reduce((sum, r) => sum + r.josephinePlaces.length, 0),
        dbKeys.length,
        'every iosfree_db.json locality lies inside the Transylvania Josephine survey');
    eq(allFootprints.length, josephineRecords.length,
        'every Josephine sheet produces one compact Transylvania coverage disc (no split homonym discs)');
    eq(allFootprints.reduce((sum, f) => sum + f.places.length, 0),
        josephineRecords.reduce((sum, r) => sum + r.josephinePlaces.length, 0),
        'all indexed Josephine localities are represented');
    allFootprints.forEach((f) => {
        ok(OtherMaps.isInJosephineTransylvania(f.lat, f.lng),
            'footprint centre lies inside the Transylvania survey (' + f.sheet.id + ')');
        ok(f.radiusMeters <= 20000,
            'footprint radius matches a single compact map sheet (' + f.sheet.id + ')');
        f.places.forEach((p) => {
            ok(OtherMaps.isInJosephineTransylvania(p.lat, p.lng),
                'footprint locality lies inside Transylvania (' + p.name + ')');
            const dLat = (p.lat - f.lat) * Math.PI / 180;
            const dLng = (p.lng - f.lng) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(f.lat * Math.PI / 180) *
                Math.cos(p.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
            ok(12742000 * Math.asin(Math.sqrt(a)) <= f.radiusMeters,
                'each estimated disc covers the localities assigned to it');
        });
    });

    // Regression: Bocșa on pg017 must resolve to Bocșa, Sălaj (Transylvania),
    // never Bocșa, Caraș-Severin (Banat), and no non-Transylvanian town may be
    // covered by any Josephine sheet footprint.
    const haversineM = (a, b) => {
        const dLat = (b.lat - a.lat) * Math.PI / 180;
        const dLng = (b.lng - a.lng) * Math.PI / 180;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) *
            Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
        return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
    };
    const bocsaSalaj = { lat: 47.2948642, lng: 22.9172167 };
    const bocsaCarasSeverin = { lat: 45.3781756, lng: 21.7312589 };
    ok(josephineDb.bocsa && haversineM(josephineDb.bocsa.c, bocsaSalaj) < 1000,
        'iosfree_db.json maps Bocsa (pg017) to Bocsa, Salaj in Transylvania');
    ok(allFootprints.some((f) => haversineM(f, bocsaSalaj) <= f.radiusMeters),
        'pg017 covers Bocsa, Salaj');
    const outsideProbeTowns = [
        ['Bocsa, Caras-Severin', bocsaCarasSeverin.lat, bocsaCarasSeverin.lng],
        ['Resita, Caras-Severin', 45.3008, 21.8893],
        ['Caransebes, Caras-Severin', 45.4167, 22.2167],
        ['Timisoara, Timis', 45.7489, 21.2087],
        ['Arad, Arad', 46.1866, 21.3123],
        ['Oradea, Bihor', 47.0465, 21.9189],
        ['Satu Mare, Satu Mare', 47.79, 22.8857],
        ['Sighetu Marmatiei, Maramures', 47.933, 23.892],
        ['Suceava, Suceava', 47.6514, 26.2556],
        ['Botosani, Botosani', 47.7486, 26.6694],
        ['Piatra Neamt, Neamt', 46.9275, 26.3708],
        ['Bacau, Bacau', 46.567, 26.9146],
        ['Iasi, Iasi', 47.1585, 27.6014],
        ['Focsani, Vrancea', 45.696, 27.183],
        ['Buzau, Buzau', 45.15, 26.8333],
        ['Ploiesti, Prahova', 44.9462, 26.0254],
        ['Bucuresti', 44.4268, 26.1025],
        ['Pitesti, Arges', 44.8565, 24.8692],
        ['Ramnicu Valcea, Valcea', 45.1047, 24.375],
        ['Targu Jiu, Gorj', 45.0342, 23.2747],
        ['Craiova, Dolj', 44.3302, 23.7949],
        ['Orsova, Mehedinti', 44.723, 22.398],
        ['Constanta, Constanta', 44.1598, 28.6348]
    ];
    outsideProbeTowns.forEach(([label, lat, lng]) => {
        ok(!OtherMaps.isInJosephineTransylvania(lat, lng),
            label + ' is rejected by the Transylvania Josephine filter');
        ok(allFootprints.every((f) => haversineM(f, { lat, lng }) > f.radiusMeters),
            'no Josephine coverage disc overlaps ' + label);
    });

    // Runtime defence against future homonyms: out-of-region places, minority
    // intra-Transylvania homonyms, all-outside sheets, and 1-vs-1 ties.
    const mixedDb = {
        campia: { d: 'Campia', l: 'https://commons.wikimedia.org/wiki/File:Josephinische_Landaufnahme_pg017.jpg', c: { lat: 47.3095, lng: 22.899 } },
        salajeni: { d: 'Salajeni', l: 'https://commons.wikimedia.org/wiki/File:Josephinische_Landaufnahme_pg017.jpg', c: { lat: 47.3264, lng: 22.9056 } },
        bocsaWrong: { d: 'Bocsa', l: 'https://commons.wikimedia.org/wiki/File:Josephinische_Landaufnahme_pg017.jpg', c: bocsaCarasSeverin },
        intraHomonym: { d: 'Saliste', l: 'https://commons.wikimedia.org/wiki/File:Josephinische_Landaufnahme_pg017.jpg', c: { lat: 45.795, lng: 23.886 } },
        banatOnly: { d: 'Timisoara', l: 'https://commons.wikimedia.org/wiki/File:Banat_Only.jpg', c: { lat: 45.7489, lng: 21.2087 } },
        tieA: { d: 'Cluj', l: 'https://commons.wikimedia.org/wiki/File:Tie.jpg', c: { lat: 46.77, lng: 23.59 } },
        tieB: { d: 'Sibiu', l: 'https://commons.wikimedia.org/wiki/File:Tie.jpg', c: { lat: 45.80, lng: 24.15 } }
    };
    const mixedRecs = OtherMaps.buildJosephineRecords(mixedDb);
    eq(mixedRecs.length, 2, 'sheets whose places are all outside Transylvania are omitted');
    const mixed017 = mixedRecs.find((r) => r.id.includes('pg017'));
    eq(mixed017.josephinePlaces.length, 2, 'Bocsa CS and distant minority homonyms are dropped from pg017');
    const mixedFoot = OtherMaps.buildJosephineFootprints(mixedRecs);
    eq(mixedFoot.filter((f) => f.sheet.id === mixed017.id).length, 1,
        'pg017 retains a single compact Sălaj coverage disc');
    eq(mixedFoot.filter((f) => f.sheet.id.includes('Tie')).length, 2,
        'equal-size separated Transylvania groups stay split rather than forming a region-wide disc');

    // Cache-busting tags keep installed PWAs and force-cache fetches current.
    const otherMapsSrc = fs.readFileSync(path.join(ROOT, 'js/other-maps.js'), 'utf8');
    const overlaySrc = fs.readFileSync(path.join(ROOT, 'js/other-maps-overlay.js'), 'utf8');
    const indexSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const dbTag = (otherMapsSrc.match(/JOSEPHINE_CATALOG_URL = '(iosfree_db\.json\?v=[^']+)'/) || [])[1];
    const jsTag = (indexSrc.match(/src="(js\/other-maps\.js\?v=[^"]+)"/) || [])[1];
    ok(Boolean(dbTag) && swSrc.includes("'" + dbTag + "'"),
        'sw.js precaches the active iosfree_db.json cache-busting URL');
    ok(Boolean(jsTag) && swSrc.includes("'" + jsTag + "'"),
        'sw.js precaches the active js/other-maps.js cache-busting URL');

    // At high zoom, a disc remains hittable even if its centre is off screen.
    const state = OtherMaps.state;
    state.staticRecords = OtherMaps.buildJosephineRecords(fakeJosephineJson);
    state.liveRecords = [];
    OtherMaps.rebuildRecords();
    fm._state.center = { lat: 46.769025, lng: 23.590035 };
    fm._state.zoom = 14;
    OtherMaps.redraw();
    const coverageOffscreen = state.hits.find((h) => h.coverage);
    ok(coverageOffscreen && coverageOffscreen.point.x < -17, 'a footprint intersecting the view is kept with its centre off screen');
    ok(OtherMaps.mergeTapSheets([coverageOffscreen]).sheets[0].josephineEntry,
        'off-centre coverage selects its original scan');
    // Drive the actual click handler and inspect its available-sheets modal.
    const modal = fakeEl('div');
    const modalChildren = {};
    modal.querySelector = (selector) => modalChildren[selector] || (modalChildren[selector] = fakeEl('div'));
    state.modal = modal;
    const clickPoint = pt(-16, Math.max(-9, Math.min(591, coverageOffscreen.point.y)));
    fm.fire('click', { latlng: { lat: 46.769, lng: 23.59 },
        layerPoint: clickPoint, containerPoint: clickPoint.add(PANE_POS) });
    ok(modal.classList.contains('show'), 'clicking the visible portion opens the available maps');
    ok(modalChildren['.om-modal-list'].innerHTML.includes('Test.jpg'),
        'the available maps list contains the Josephine scan');
    // A normal dot must win hit precedence even if the large coverage disc
    // has a closer centre; both sources remain available in the same list.
    state.staticRecords.push({ id: 'normal-test', source: 'hungaricana', path: 'test/path',
        place: 'Existing dot', title: 'Existing sheet', lat: 46.769025, lng: 23.590011 });
    OtherMaps.rebuildRecords();
    OtherMaps.redraw();
    const ordinaryHit = state.hits.find((h) => !h.coverage);
    ok(ordinaryHit, 'ordinary dots remain present over the coverage');
    modal.classList.remove('show');
    fm.fire('click', { latlng: fm._state.center, layerPoint: ordinaryHit.point,
        containerPoint: ordinaryHit.point.add(PANE_POS) });
    const listHtml = modalChildren['.om-modal-list'].innerHTML;
    ok(listHtml.indexOf('Existing sheet') >= 0 && listHtml.indexOf('Test.jpg') >= 0 &&
        listHtml.indexOf('Existing sheet') < listHtml.indexOf('Test.jpg'),
        'the top dot is selected first while overlapping Josephine sheets remain accessible');
    fm._state.center = { lat: 46.769025, lng: 23.59 };
    fm._state.zoom = 13;
    OtherMaps.redraw();
    const radius13 = state.hits.find((h) => h.coverage).radius;
    fm._state.zoom = 14;
    OtherMaps.redraw();
    const radius14 = state.hits.find((h) => h.coverage).radius;
    ok(Math.abs(radius14 / radius13 - 2) < 0.001, 'coverage scales with geographic area on zoom');
    // A sheet saved at 0% must come back at 0%.  The restored sheet used to
    // keep its own saved opacity and stayed painted over the basemap.
    OtherMaps.setOpacity(0);
    OtherMaps.setEnabled(false);
    eq(state.hits.length, 0, 'disabling Other maps removes the coverage hit targets');
    OtherMaps.setEnabled(true);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    ok(state.hits.some((h) => h.coverage), 're-enabling restores the Josephine coverage');
    const restored7 = fmgr.get('TST/7');
    ok(restored7, 'the saved sheet is restored with the layer');
    eq(restored7.root.style.opacity, '0', 'a sheet restored at layer opacity 0% stays invisible');
    OtherMaps.setOpacity(80);

    /* ══ 16. non-Josephine intra-border stability (zoom & scale lock) ═══
     * Regression for Task 2: Hungaricana ECW and NLS IIIF sheets must stay
     * motionless inside their own `.om-box` outline across every basemap zoom
     * and every sheet scale (mpp), matching Josephine sheets. */
    const TILE = Tiles.TILE_SIZE;
    const BLEED = 0.6;

    /* Map a normalised sheet point (u, v) ∈ (0, 1)² through the actual DOM
     * tile layout (`img.style.left/top/width/height`) and `.om-grid` /
     * `.om-box` sizes, returning its normalised position inside `.om-box`. */
    function paintedBoxPos(ov, u, v, serverMode, trueW, trueH) {
        const gW = parseFloat(ov.gridEl.style.width);
        const gH = parseFloat(ov.gridEl.style.height);
        const bW = parseFloat(ov.boxEl.style.width);
        const bH = parseFloat(ov.boxEl.style.height);
        const bL = parseFloat(ov.boxEl.style.left);
        const bT = parseFloat(ov.boxEl.style.top);
        ok(Math.abs(bL + bW / 2) < 1e-9 && Math.abs(bT + bH / 2) < 1e-9,
            '.om-box stays centred on the sheet anchor');
        ok(Math.abs(gW * ov.geom.k - bW) < 1e-6 && Math.abs(gH * ov.geom.k - bH) < 1e-6,
            '.om-grid fills .om-box 1:1 on both axes');
        const scale = Math.pow(2, ov.meta.maxZoom - ov.geom.level);
        const lx = (u * trueW) / scale;
        const ly = (v * trueH) / scale;
        const tx = Math.floor(lx / TILE);
        const ty = Math.floor(ly / TILE);
        const img = ov.tiles[ov.geom.level + ':' + tx + ':' + ty];
        assert(img, 'missing active tile ' + ov.geom.level + ':' + tx + ':' + ty);
        const left = parseFloat(img.style.left);
        const top = parseFloat(img.style.top);
        const spanW = parseFloat(img.style.width) - BLEED;
        const spanH = parseFloat(img.style.height) - BLEED;
        const trueSpanW = serverMode === 'padded' ? TILE : Math.min(TILE, (trueW / scale) - tx * TILE);
        const trueSpanH = serverMode === 'padded' ? TILE : Math.min(TILE, (trueH / scale) - ty * TILE);
        const fx = (lx - tx * TILE) / trueSpanW;
        const fy = (ly - ty * TILE) / trueSpanH;
        return {
            x: (left + fx * spanW) / gW,
            y: (top + fy * spanH) / gH
        };
    }

    function decodeActiveTiles(ov, serverMode, trueW, trueH) {
        const s = Math.pow(2, ov.meta.maxZoom - ov.geom.level);
        Object.keys(ov.tiles).forEach((key) => {
            const img = ov.tiles[key];
            const x = img._om.x, y = img._om.y;
            if (serverMode === 'padded') {
                img.naturalWidth = TILE;
                img.naturalHeight = TILE;
            } else {
                const roundFn = serverMode === 'floor' ? Math.floor
                    : serverMode === 'ceil' ? Math.ceil : Math.round;
                const tw = Math.max(1, Math.min(TILE, roundFn(trueW / s) - x * TILE));
                const th = Math.max(1, Math.min(TILE, roundFn(trueH / s) - y * TILE));
                img.naturalWidth = tw;
                img.naturalHeight = th;
            }
            img.dispatch('load');
        });
    }

    const sampleLandmarks = [
        [0.08, 0.12], [0.5, 0.5], [0.94, 0.93], [0.985, 0.35], [0.32, 0.985]
    ];

    // 16a. Hungaricana cropped-edge sheets (round, ceil, floor) and padded
    //      512×512 sheets stay fixed to 0.000 px across full zoom + scale sweeps.
    function wideFakeMap(zoom, lat, lng) {
        const m = fakeMap({ zoom, size: { x: 32000, y: 32000 }, center: { lat, lng } });
        m.latLngToLayerPoint = () => ({ x: 16000, y: 16000 });
        return m;
    }

    const hungCases = [
        { id: 'H/CROP-R', path: 'maps/mol/t/crop_r.ecw', w: 7420, h: 5380, mode: 'round' },
        { id: 'H/CROP-C', path: 'maps/mol/t/crop_c.ecw', w: 10680, h: 5329, mode: 'ceil' },
        { id: 'H/CROP-F', path: 'maps/mol/t/crop_f.ecw', w: 4004, h: 4941, mode: 'floor' },
        { id: 'H/PAD',    path: 'maps/mol/t/pad512.ecw', w: 7420, h: 5380, mode: 'padded' }
    ];
    for (const c of hungCases) {
        const zMap = wideFakeMap(11, 46.77, 23.59);
        const zMgr = Overlay.createManager(zMap, { pane: 'pane_' + c.id, opacity: 0.85 });
        const sheet = { id: c.id, source: 'hungaricana', path: c.path, lat: 46.77, lng: 23.59, w: c.w, h: c.h };
        const res11 = Overlay.resolutionAt(46.77, 11);
        // Start framed at level 0 so the root tile itself exercises edge detection.
        const initMpp = res11 * Math.pow(2, -Tiles.maxZoomFor(c.w, c.h)) * 0.85;
        const zOv = await zMgr.add(sheet, { mpp: initMpp });
        await new Promise((r) => setImmediate(r));
        // Before decode: interior cells stay visible while unmeasured edge tiles
        // are held hidden so they never flash stretched for a single frame.
        const initialTiles = Object.values(zOv.tiles);
        const edgeTiles = initialTiles.filter((img) => {
            const sp = Tiles.tileSpanFor(zOv.meta, img._om.x, img._om.y, img._om.level);
            return sp.w < TILE || sp.h < TILE;
        });
        ok(edgeTiles.length > 0 && edgeTiles.every((img) => img.style.visibility === 'hidden'),
            c.id + ': unmeasured edge tiles are hidden until decode');
        decodeActiveTiles(zOv, c.mode, c.w, c.h);
        ok(edgeTiles.every((img) => img.style.visibility === ''),
            c.id + ': decoded edge tiles become visible immediately');
        eq(Tiles.edgeModeOf(sheet), c.mode === 'padded' ? 'padded' : 'cropped',
            c.id + ': edge mode is inferred from the decoded bitmap and cached');

        const visitedLevels = new Set();
        // Scale sweep across every level 0..maxZoom and back down, plus rotations.
        for (let lv = 0; lv <= zOv.meta.maxZoom; lv++) {
            const mpp = res11 * Math.pow(2, lv - zOv.meta.maxZoom) * 0.9;
            zMgr.setState(c.id, { mpp, rotation: lv === 2 ? 37 : 0 });
            await new Promise((r) => setImmediate(r));
            decodeActiveTiles(zOv, c.mode, c.w, c.h);
            visitedLevels.add(zOv.geom.level);
            for (const [u, v] of sampleLandmarks) {
                const got = paintedBoxPos(zOv, u, v, c.mode, c.w, c.h);
                ok(Math.abs(got.x - u) < 1e-9 && Math.abs(got.y - v) < 1e-9,
                    c.id + ' L=' + zOv.geom.level + ': landmark (' + u + ',' + v + ') stays pinned in .om-box');
            }
        }
        // Basemap zoom in/out sweep without changing mpp.
        zMgr.setState(c.id, { mpp: res11 * Math.pow(2, -zOv.meta.maxZoom) * 0.9, rotation: 0 });
        for (const z of [11, 12, 13, 14, 15, 13, 11]) {
            zMap._state.zoom = z;
            zMap.fire('zoomend');
            await new Promise((r) => setImmediate(r));
            decodeActiveTiles(zOv, c.mode, c.w, c.h);
            for (const [u, v] of sampleLandmarks) {
                const got = paintedBoxPos(zOv, u, v, c.mode, c.w, c.h);
                ok(Math.abs(got.x - u) < 1e-9 && Math.abs(got.y - v) < 1e-9,
                    c.id + ' zoom=' + z + ': landmark stays pinned inside .om-box');
            }
        }
        ok(visitedLevels.size >= 4, c.id + ': exercised multiple pyramid levels');
        zMgr.remove(c.id);
    }

    // 16b. probePyramid recovers pixel-exact dimensions and never corrupts
    //      hash order on portrait/out-of-bounds edges (decrypts real hashes).
    function decryptHungUrl(url) {
        const hex = String(url || '').split('/').pop();
        if (!/^[0-9a-f]{32}$/.test(hex)) return null;
        const decipher = crypto.createDecipheriv('aes-128-ecb', Buffer.from('dGhpcyBpcyBubyBr'), null);
        decipher.setAutoPadding(false);
        const plain = Buffer.concat([decipher.update(Buffer.from(hex, 'hex')), decipher.final()])
            .toString('utf8').replace(/\*+$/, '');
        const parts = plain.split('|').map(Number);
        return parts.length === 4 ? { sum: parts[0], a: parts[1], b: parts[2], c: parts[3] } : null;
    }

    function installProbeServer(spec) {
        const Z = Tiles.maxZoomFor(spec.w, spec.h);
        sandbox.Image = function MockProbeImage() {
            const self = { naturalWidth: 0, naturalHeight: 0, onload: null, onerror: null };
            Object.defineProperty(self, 'src', {
                set(url) {
                    setImmediate(() => {
                        const dec = decryptHungUrl(url);
                        if (!dec) { if (self.onerror) self.onerror(); return; }
                        const z = spec.order === 'xyz' ? dec.c : dec.a;
                        const x = spec.order === 'xyz' ? dec.a : dec.b;
                        const y = spec.order === 'xyz' ? dec.b : dec.c;
                        const maxZ = spec.truncatedMaxZ != null ? spec.truncatedMaxZ : Z;
                        if (z < 0 || z > maxZ || x < 0 || y < 0) {
                            if (self.onerror) self.onerror();
                            return;
                        }
                        const s = Math.pow(2, maxZ - z);
                        const tW = Math.max(1, Math.ceil(spec.w / s));
                        const tH = Math.max(1, Math.ceil(spec.h / s));
                        const cols = Math.ceil(tW / TILE), rows = Math.ceil(tH / TILE);
                        if (x >= cols || y >= rows) {
                            if (self.onerror) self.onerror();
                            return;
                        }
                        self.naturalWidth = spec.padded ? TILE : Math.min(TILE, tW - x * TILE);
                        self.naturalHeight = spec.padded ? TILE : Math.min(TILE, tH - y * TILE);
                        if (self.onload) self.onload();
                    });
                }
            });
            return self;
        };
    }

    const prevCatalogJson = fakeCatalogJson;
    fakeCatalogJson = null; // simulate /tile/imagesize/ blocked by CORS
    Tiles.clearCache();

    // Cropped landscape sheet: exact pixel dimensions recovered.
    installProbeServer({ w: 7420, h: 5380, order: 'zxy', padded: false });
    const probedCrop = await Tiles.resolve('maps/probe/crop_7420.ecw');
    eq(probedCrop.w, 7420, 'probePyramid recovers exact natural width from cropped edge tile');
    eq(probedCrop.h, 5380, 'probePyramid recovers exact natural height from cropped edge tile');
    eq(probedCrop.maxZoom, 4, 'probePyramid recovers exact maxZoom');
    eq(probedCrop.edgeMode, 'cropped', 'probePyramid records cropped edge mode immediately');
    eq((await Tiles.tileSpan('maps/probe/crop_7420.ecw', 0, 0, 0)).w, 7420 / 16,
        'probed cropped Hungaricana sheet pre-sizes tiles to exact fractional span');

    // Tall portrait sheet (1400×3500, Z=3, cols=3, rows=7): probe(3,0,3) in xyz
    // would collide with valid z=3,x=0,y=3 — must NOT inflate width or flip order.
    installProbeServer({ w: 1400, h: 3500, order: 'zxy', padded: false });
    const probedPortrait = await Tiles.resolve('maps/probe/portrait_1400.ecw');
    eq(probedPortrait.w, 1400, 'portrait probe is immune to xyz/zxy coordinate collision');
    eq(probedPortrait.h, 3500, 'portrait probe recovers exact height');
    eq(Tiles.preferredOrder(), 'zxy', 'portrait edge probe never flips hash order to xyz');

    // Padded 512×512 sheet: grid size halves identically across every level (0 drift).
    installProbeServer({ w: 7420, h: 5380, order: 'zxy', padded: true });
    const probedPad = await Tiles.resolve('maps/probe/pad_7420.ecw');
    eq(probedPad.w, 15 * TILE, 'padded probe recovers exact column grid width');
    eq(probedPad.h, 11 * TILE, 'padded probe recovers exact row grid height');
    eq(probedPad.edgeMode, 'padded', 'non-square padded pyramid is detected at root');

    // Alternate-order server: cleanly disambiguated at (0,0,1) without corrupting spans.
    installProbeServer({ w: 1400, h: 3500, order: 'xyz', padded: false });
    const probedXyz = await Tiles.resolve('maps/probe/alt_xyz.ecw');
    eq(Tiles.preferredOrder(), 'xyz', 'order disambiguation still works via (0,0,1)');
    eq(probedXyz.w, 1400, 'xyz server width is recovered to the pixel');
    eq(probedXyz.h, 3500, 'xyz server height is recovered to the pixel');
    Tiles.noteOrder('zxy');

    // Overlay error on an out-of-bounds/missing tile never flips hash order.
    eq(Tiles.canFlipOrder({ source: 'hungaricana', path: 'maps/probe/p.ecw' }, 0, 0, 1), true,
        'hash-order retry is allowed on unambiguous (0,0,1) for tagged Hungaricana records');
    eq(Tiles.canFlipOrder({ source: 'hungaricana', path: 'maps/probe/p.ecw' }, 3, 0, 3), false,
        'hash-order retry is blocked on ambiguous edge coordinates');

    delete sandbox.Image;
    fakeCatalogJson = prevCatalogJson;

    // 16c. Stand-in scaling stays locked across late span resolution, rapid
    //      multi-step wheel/handle scale-in, and zoom-out/scale-out transitions.
    const stMap = fakeMap({ zoom: 11, size: { x: 400, y: 800 }, center: { lat: 46.77, lng: 23.59 } });
    const stMgr = Overlay.createManager(stMap, { pane: 'om_standin_lock', opacity: 0.8 });
    const stSheet = { id: 'H/ST', source: 'hungaricana', path: 'maps/mol/t/st.ecw', lat: 46.77, lng: 23.59, w: 7420, h: 5380 };
    const stOv = await stMgr.add(stSheet);
    await new Promise((r) => setImmediate(r));
    decodeActiveTiles(stOv, 'round', 7420, 5380);
    eq(stOv.geom.level, 0, 'stand-in test begins at level 0');
    // Rapid two-step scale-in L0 → L1 → L2 without L1 finishing in between:
    stMgr.setState('H/ST', { mpp: stOv.state.mpp * 2 });
    eq(stOv.geom.level, 1, 'step 1 reaches level 1');
    stMgr.setState('H/ST', { mpp: stOv.state.mpp * 2 });
    eq(stOv.geom.level, 2, 'step 2 reaches level 2 before L1 decoded');
    const keptL0 = stOv.stale && stOv.stale.imgs['0:0:0'];
    ok(Boolean(keptL0), 'rapid multi-level scale retains the decoded L0 stand-in');
    ok(Math.abs((parseFloat(keptL0.style.width) - BLEED) - stOv.geom.wL) < 1e-6 &&
       Math.abs((parseFloat(keptL0.style.height) - BLEED) - stOv.geom.hL) < 1e-6,
       'retained L0 stand-in scales by 4× to match L2 .om-box exactly');
    await new Promise((r) => setImmediate(r));
    decodeActiveTiles(stOv, 'round', 7420, 5380);
    ok(!stOv.stale, 'stand-in retires once L2 finishes decoding');
    // Now scale back OUT L2 → L1: decoded L2 tiles stay scaled by 0.5× until L1 decodes.
    stMgr.setState('H/ST', { mpp: stOv.state.mpp * 0.5 });
    eq(stOv.geom.level, 1, 'scaling down steps to level 1');
    ok(stOv.stale && Object.keys(stOv.stale.imgs).length > 0,
        'scaling down retains decoded L2 tiles as a 0.5× stand-in (no blank blink)');
    const staleCorner = stOv.stale.imgs['2:3:2'];
    if (staleCorner) {
        const expRight = parseFloat(staleCorner.style.left) + parseFloat(staleCorner.style.width) - BLEED;
        const expBottom = parseFloat(staleCorner.style.top) + parseFloat(staleCorner.style.height) - BLEED;
        ok(Math.abs(expRight - stOv.geom.wL) < 1e-6 && Math.abs(expBottom - stOv.geom.hL) < 1e-6,
            'downscaled L2 corner stand-in lands flush on L1 .om-box border');
    }
    await new Promise((r) => setImmediate(r));
    decodeActiveTiles(stOv, 'round', 7420, 5380);
    ok(!stOv.stale, 'downscaled stand-in retires once L1 decodes');
    stMgr.remove('H/ST');

    // 16d. NLS IIIF fixes: legacy /iiif/1/ fallback chain + native quality,
    //      sub-0.5-px edge tile clamping, canonical width-only fallback URL,
    //      transient info.json recovery, and full zoom/scale box-lock sweep.
    const origFetch = sandbox.fetch;
    sandbox.fetch = (url) => {
        const u = String(url || '');
        if (u.indexOf('/iiif/1/94000%2F940000001/info.json') !== -1) {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    '@context': 'http://library.stanford.edu/iiif/image-api/1.1/context.json',
                    width: 9392,
                    height: 8770,
                    scale_factors: [1, 2, 4, 8, 16, 32]
                })
            });
        }
        if (u.indexOf('94000%2F940000001/info.json') !== -1) {
            return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
        }
        return origFetch(url);
    };
    const legacyRec = { id: 'nls/940000001', nlsId: '940000001', source: 'nls', path: '94000/940000001' };
    const legacyMeta = await Nls.resolve(legacyRec);
    eq(legacyMeta.w, 9392, 'NLS info.json fallback succeeds when /iiif/2/ 404s and /iiif/1/ answers');
    eq(legacyMeta.quality, 'native', 'IIIF v1.1 info.json selects native quality');
    const legacyUrl = await Nls.tileUrl(legacyRec, 0, 0, 0);
    ok(legacyUrl.startsWith('https://map-view.nls.uk/iiif/1/94000%2F940000001/') &&
       /\/native\.jpg$/.test(legacyUrl),
       'legacy NLS tiles use the resolved /iiif/1/ service base and native.jpg');
    sandbox.fetch = origFetch;

    // Sub-0.5-px trailing edge sliver (26625 px at scale 4 → rw=1, rw/s=0.25):
    const sliverRec = { id: 'nls/940000002', nlsId: '940000002', source: 'nls', path: '94000/940000002', w: 26625, h: 18433 };
    await Nls.resolve(sliverRec, { w: 26625, h: 18433 });
    const sliverUrl = await Nls.tileUrl(sliverRec, 13, 0, 4);
    ok(/\/26624,0,1,2048\/1,512\/0\/default\.jpg$/.test(sliverUrl),
        'sub-0.5-px NLS edge tile clamps request width to 1 px instead of empty URL');
    const altRootUrl = await Nls.tileUrlAlt(nlsRec, 0, 0, 0);
    eq(altRootUrl, 'https://map-view.nls.uk/iiif/2/14284%2F142842536/full/412,/0/default.jpg',
        'NLS alternate tile URL uses canonical IIIF full/{w}, syntax');
    const altEdgeUrl = await Nls.tileUrlAlt(nlsRec, 25, 0, 5);
    eq(altEdgeUrl, 'https://map-view.nls.uk/iiif/2/14284%2F142842536/12800,0,376,512/376,/0/default.jpg',
        'NLS alternate edge URL keeps exact region with canonical width-only size');

    // Full NLS zoom + scale sweep preserves 0.000 px landmark coordinates inside .om-box,
    // AND a late tileSpan resolving after stand-in promotion preserves its 2^Δ scale.
    const nlsSweepMap = wideFakeMap(11, 51.57, -0.77);
    const nlsSweepMgr = Overlay.createManager(nlsSweepMap, { pane: 'om_nls_sweep', opacity: 0.85 });
    const nlsSweepRec = { id: 'nls/940000003', nlsId: '940000003', source: 'nls', path: '94000/940000003',
        lat: 51.57, lng: -0.77, w: 13176, h: 10110 };
    const nlsRes11 = Overlay.resolutionAt(51.57, 11);
    const nlsInitMpp = nlsRes11 * Math.pow(2, -5) * 0.85;
    const nlsSweepOv = await nlsSweepMgr.add(nlsSweepRec, { mpp: nlsInitMpp });
    // Promote L0 → L1 BEFORE L0's async tileSpan/tileUrl microtask settles:
    nlsSweepMgr.setState(nlsSweepRec.id, { mpp: nlsInitMpp * 2 });
    await new Promise((r) => setImmediate(r));
    const latePromoted = nlsSweepOv.stale && nlsSweepOv.stale.imgs['0:0:0'];
    ok(Boolean(latePromoted) &&
       Math.abs((parseFloat(latePromoted.style.width) - BLEED) - (13176 / 16)) < 1e-6 &&
       Math.abs((parseFloat(latePromoted.style.height) - BLEED) - (10110 / 16)) < 1e-6,
       'late tileSpan on a promoted stand-in scales by 2^Δ instead of shrinking to 1×');
    for (let lv = 0; lv <= nlsSweepOv.meta.maxZoom; lv++) {
        nlsSweepMgr.setState(nlsSweepRec.id, { mpp: nlsRes11 * Math.pow(2, lv - nlsSweepOv.meta.maxZoom) * 0.85 });
        await new Promise((r) => setImmediate(r));
        // Even if the IIIF server rounds output height by 1 px, NLS keeps exact region span.
        Object.values(nlsSweepOv.tiles).forEach((img) => {
            img.naturalWidth = 500;
            img.naturalHeight = 350;
            img.dispatch('load');
        });
        for (const [u, v] of sampleLandmarks) {
            const got = paintedBoxPos(nlsSweepOv, u, v, 'round', 13176, 10110);
            ok(Math.abs(got.x - u) < 1e-9 && Math.abs(got.y - v) < 1e-9,
                'NLS L=' + nlsSweepOv.geom.level + ': landmark stays pinned inside .om-box');
        }
    }
    for (const z of [11, 12, 13, 14, 15, 12]) {
        nlsSweepMgr.setState(nlsSweepRec.id, { mpp: nlsInitMpp });
        nlsSweepMap._state.zoom = z;
        nlsSweepMap.fire('zoomend');
        await new Promise((r) => setImmediate(r));
        Object.values(nlsSweepOv.tiles).forEach((img) => img.dispatch('load'));
        for (const [u, v] of sampleLandmarks) {
            const got = paintedBoxPos(nlsSweepOv, u, v, 'round', 13176, 10110);
            ok(Math.abs(got.x - u) < 1e-9 && Math.abs(got.y - v) < 1e-9,
                'NLS zoom=' + z + ': landmark stays pinned inside .om-box');
        }
    }
    nlsSweepMgr.remove(nlsSweepRec.id);

    // Transient info.json failure followed by recovery upgrades ov.meta to exact sheet aspect.
    fakeNlsInfoJson = null;
    const recovRec = { id: 'nls/940000004', nlsId: '940000004', source: 'nls', path: '94000/940000004', lat: 51.57, lng: -0.77 };
    const warnSaved = console.warn;
    console.warn = () => {};
    const recovOv = await nlsSweepMgr.add(recovRec);
    console.warn = warnSaved;
    ok(recovOv.metaFallback === true && recovOv.meta.w === 4000, 'failed info.json marks overlay as fallback meta');
    fakeNlsInfoJson = { width: 14450, height: 9960, tiles: [{ width: 512, height: 512, scaleFactors: [1, 2, 4, 8, 16, 32] }] };
    nlsSweepMgr.setState(recovRec.id, { mpp: recovOv.state.mpp * 2 });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    eq(recovOv.metaFallback, false, 'subsequent resolved info.json clears fallback flag');
    eq(recovOv.meta.w, 14450, 'overlay adopts real NLS width so grid and tiles never drift apart');
    eq(recovOv.meta.h, 9960, 'overlay adopts real NLS height');
    nlsSweepMgr.remove(recovRec.id);

    // Rotated basemap (leaflet-rotate bearing ≠ 0°): pyramid level, .om-box size, and
    // tile visibility never jump or get reverse-culled when containerPointToLayerPoint rotates.
    const rotBaseMap = fakeMap({ zoom: 12, size: { x: 1000, y: 800 }, center: { lat: 46.77, lng: 23.59 } });
    let bearingDeg = 0;
    rotBaseMap.containerPointToLayerPoint = function (pt) {
        const cx = rotBaseMap._state.size.x / 2;
        const cy = rotBaseMap._state.size.y / 2;
        const rad = bearingDeg * Math.PI / 180;
        const dx = pt.x - cx, dy = pt.y - cy;
        return {
            x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
            y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
        };
    };
    const rotMgr = Overlay.createManager(rotBaseMap, { pane: 'om_rot_base', opacity: 0.85 });
    const rotRec = { id: 'MOLTerkeptar/99004', source: 'hungaricana', path: 'maps/test/r.ecw',
        lat: 46.77, lng: 23.59, w: 6971, h: 4813 };
    await Tiles.resolve(rotRec.path, { w: 6971, h: 4813 });
    Tiles.noteEdgeMode(rotRec.path, 'cropped');
    const rotOv = await rotMgr.add(rotRec);
    await new Promise((r) => setImmediate(r));
    const levelAt0 = rotOv.geom.level;
    const wAt0 = rotOv.geom.dW;
    const hAt0 = rotOv.geom.dH;
    const tileCountAt0 = Object.keys(rotOv.tiles).length;
    ok(tileCountAt0 > 0, 'rotated-basemap overlay renders visible tiles at 0°');
    for (const b of [45, 90, 135, 180, 225, 315, 0]) {
        bearingDeg = b;
        rotBaseMap.fire('move');
        await new Promise((r) => setImmediate(r));
        eq(rotOv.geom.level, levelAt0, 'basemap bearing ' + b + '° keeps identical pyramid level');
        ok(Math.abs(rotOv.geom.dW - wAt0) < 1e-9 && Math.abs(rotOv.geom.dH - hAt0) < 1e-9,
            'basemap bearing ' + b + '° keeps identical .om-box dimensions');
        ok(Object.keys(rotOv.tiles).length >= tileCountAt0,
            'basemap bearing ' + b + '° never reverse-culls visible tiles');
    }
    rotMgr.remove(rotRec.id);

    // 16e. All live other-maps assets in index.html are precached by sw.js,
    // pointer-capture events are listened to on their capture target, external
    // tile hosts pass through sw.js, and pyramid storage keys are v2.
    for (const asset of [
        'css/other-maps.css',
        'js/other-maps-tiles.js',
        'js/other-maps-nls.js',
        'js/other-maps-overlay.js',
        'js/other-maps.js'
    ]) {
        const re = new RegExp('(?:href|src)="(' + asset.replace(/[./]/g, '\\$&') + '\\?v=[^"]+)"');
        const tagged = (indexSrc.match(re) || [])[1];
        ok(Boolean(tagged) && swSrc.includes("'" + tagged + "'"),
            'sw.js precaches live ' + asset + ' URL (' + tagged + ')');
    }
    ok(overlaySrc.includes("container.addEventListener('pointermove', onPointerMove") &&
       overlaySrc.includes("container.addEventListener('pointerup', onPointerUp") &&
       overlaySrc.includes("container.removeEventListener('pointermove', onPointerMove"),
       'align drags receive and clean up pointer events on the map container that owns pointer capture');
    ok(/const CACHE_NAME = 'detectlab-v430-leaf-switches-only'/.test(swSrc),
       'the current layer-switch hierarchy gets a fresh service-worker cache version');
    for (const host of ['hungaricana.hu', 'nls.uk', 'wikimedia.org']) {
        ok(swSrc.includes("'" + host + "'"), 'sw.js passes through external tile host ' + host);
    }
    eq(Tiles.CACHE_KEY, 'dlOtherMaps.pyramid.v2', 'Hungaricana pyramid cache bumped to v2');
    ok(Boolean(sandbox.localStorage.getItem('dlOtherMaps.nls.pyramid.v2')) &&
       sandbox.localStorage.getItem('dlOtherMaps.nls.pyramid.v1') === null &&
       Boolean(sandbox.localStorage.getItem('dlOtherMaps.pyramid.v2')) &&
       sandbox.localStorage.getItem('dlOtherMaps.pyramid.v1') === null,
       'Hungaricana & NLS pyramid caches persist under v2 and purge v1');
    flushTimers();

    console.log('✓ other-maps: ' + checks + ' checks passed '+
        ('(' + catalog.maps.length + ' Hungaricana + ' + nlsCatalog.maps.length + ' NLS catalogue records, ' +
            locations.length + ' Hungaricana places)'));
})().catch((err) => {
    console.error('✗ other-maps test failed:', err && err.message);
    process.exit(1);
});
