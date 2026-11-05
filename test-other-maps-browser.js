'use strict';
// Optional real-browser regression for the Other-maps tile overlay.
//
// Runs only when a Chromium toolchain is provided:
//   PUPPETEER_MODULE_DIR=/path/to/node_modules \
//   CHROMIUM_EXECUTABLE_PATH=/path/to/chromium \
//   node test-other-maps-browser.js
//
// It loads the real Leaflet + js/other-maps-tiles.js + js/other-maps-overlay.js
// (no network) and a synthetic 3000 × 750 sheet whose source CROPS its edge
// tiles, like NLS IIIF and the Wikimedia Josephine scans.  The assertions are
// the two reports behind §8.2/§8.3:
//   · the sheet keeps its 4:1 natural shape at every zoom / pyramid level,
//     and each bitmap is painted at its own span (no square-cell stretch);
//   · the master opacity hides every painted pixel at 0 %, not just the
//     active sheet's tiles.
if (!process.env.PUPPETEER_MODULE_DIR || !process.env.CHROMIUM_EXECUTABLE_PATH) {
    console.log('SKIP other-maps browser: set PUPPETEER_MODULE_DIR and CHROMIUM_EXECUTABLE_PATH');
    return;
}
const assert = require('node:assert/strict');
const path = require('node:path');
const puppeteer = require(path.join(process.env.PUPPETEER_MODULE_DIR, 'puppeteer-core'));

const SETUP = `
const Tiles = window.DetectLabOtherMapsTiles;
const Overlays = window.DetectLabOtherMapsOverlay;
const META = { w: 3000, h: 750, maxZoom: 3 };
function sheetTile(record, x, y, level) {
    const span = Tiles.tileSpanFor(META, x, y, level);
    if (!(span.w > 0) || !(span.h > 0)) return '';
    const c = document.createElement('canvas');
    c.width = Math.ceil(span.w);
    c.height = Math.ceil(span.h);
    const g = c.getContext('2d');
    g.fillStyle = '#efe3c8';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#c33333';
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, c.width - 3, c.height - 3);
    return c.toDataURL('image/png');
}
Tiles.registerSource('fixture', {
    resolve: function () { return Promise.resolve(META); },
    tileUrl: function (record, x, y, level) { return sheetTile(record, x, y, level); },
    tileSpan: function (record, x, y, level) { return Tiles.tileSpanFor(META, x, y, level); }
});
const map = window.__map = L.map('map', {
    center: [46.77, 23.59], zoom: 12,
    zoomAnimation: false, fadeAnimation: false,
    attributionControl: false, zoomControl: false
});
map.createPane('pane_om_browser');
map.getPane('pane_om_browser').style.zIndex = '611';
const mgr = window.__mgr = Overlays.createManager(map, {
    pane: 'pane_om_browser', zIndex: 611, opacity: 1
});
window.__ready = false;
mgr.add({ id: 'TST/1', source: 'fixture', path: 'synthetic-sheet',
    lat: 46.77, lng: 23.59, w: META.w, h: META.h }).then(function () {
    window.__ready = true;
});
`;
const HTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/css/leaflet.css">
<style>html,body{margin:0;height:100%;background:#0b1a2a}#map{position:absolute;inset:0;background:#0b1a2a}</style>
</head><body><div id="map"></div></body></html>`;

function close(a, b, tolerance) { return Math.abs(a - b) <= tolerance; }

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    let checks = 0;
    const ok = (value, message) => { assert.ok(value, message); checks++; };
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1000, height: 700 });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.setContent(HTML);
        await page.addStyleTag({ path: path.join(__dirname, 'css/leaflet.css') });
        for (const file of ['js/leaflet.js', 'js/other-maps-tiles.js', 'js/other-maps-overlay.js']) {
            await page.addScriptTag({ path: path.join(__dirname, file) });
        }
        await page.evaluate(SETUP);
        await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });

        for (const zoom of [12, 13, 14, 15]) {
            await page.evaluate((z) => window.__map.setZoom(z), zoom);
            await page.waitForFunction((z) => window.__map.getZoom() === z, { timeout: 10000 }, zoom);
            await new Promise((resolve) => setTimeout(resolve, 120));
            const measurement = await page.evaluate(() => {
                const ov = window.__mgr.list()[0];
                const grid = ov.gridEl.getBoundingClientRect();
                const box = ov.boxEl.getBoundingClientRect();
                return {
                    level: ov.geom.level,
                    grid: [grid.width, grid.height],
                    box: [box.width, box.height],
                    tiles: Array.from(ov.gridEl.querySelectorAll('img')).map((img) => ({
                        natural: [img.naturalWidth, img.naturalHeight],
                        css: [parseFloat(img.style.width), parseFloat(img.style.height)]
                    }))
                };
            });
            ok(measurement.grid[0] > 100 && measurement.grid[1] > 20,
                'z' + zoom + ': the sheet grid is painted');
            ok(close(measurement.grid[0] / measurement.grid[1], 4, 1e-6),
                'z' + zoom + ': the sheet grid keeps the natural 4:1 aspect');
            if (measurement.box[0] > 0) {
                ok(close(measurement.box[0] / measurement.box[1], 4, 1e-6),
                    'z' + zoom + ': the selection box keeps the same 4:1 aspect');
            }
            measurement.tiles.forEach((tile) => {
                ok(tile.natural[0] > 0 && tile.natural[1] > 0,
                    'z' + zoom + ': every visible bitmap decoded');
                ok(close(tile.css[0] / tile.css[1], tile.natural[0] / tile.natural[1], 0.02),
                    'z' + zoom + ': a cropped tile is painted at its own span, not a square');
            });
        }

        // Master opacity: pick a pixel well inside the sheet at z13, then
        // compare the rendered screenshot at 100 % and 0 %.
        await page.evaluate(() => window.__map.setZoom(13));
        await page.waitForFunction(() => window.__map.getZoom() === 13, { timeout: 10000 });
        await new Promise((resolve) => setTimeout(resolve, 150));
        const point = await page.evaluate(() => {
            const ov = window.__mgr.list()[0];
            const r = ov.boxEl.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        });
        async function pixelAt() {
            const shot = await page.screenshot({ encoding: 'base64' });
            return page.evaluate(async ({ b64, x, y }) => {
                const img = new Image();
                img.src = 'data:image/png;base64,' + b64;
                await img.decode();
                const c = document.createElement('canvas');
                c.width = img.width; c.height = img.height;
                const g = c.getContext('2d');
                g.drawImage(img, 0, 0);
                return Array.from(g.getImageData(x, y, 1, 1).data);
            }, { b64: shot, x: point.x, y: point.y });
        }
        const painted = await pixelAt();
        ok(painted[0] > 200 && painted[1] > 180 && painted[2] > 150,
            'the synthetic sheet is painted over the basemap at 100 %');
        const opacity = await page.evaluate(() => {
            window.__mgr.setOpacityAll(0);
            const ov = window.__mgr.list()[0];
            return { root: getComputedStyle(ov.root).opacity, inline: ov.root.style.opacity };
        });
        ok(opacity.root === '0' && opacity.inline === '0',
            'the master opacity reaches the sheet root');
        const hidden = await pixelAt();
        ok(hidden[0] < 40 && hidden[1] < 60 && hidden[2] < 80,
            'at 0 % the basemap is visible again (nothing paints over it)');
        await page.evaluate(() => window.__mgr.setOpacityAll(1));
        const again = await pixelAt();
        ok(again[0] > 200 && again[1] > 180 && again[2] > 150,
            'raising the master opacity paints the sheet again');

        ok(errors.length === 0, 'no page error: ' + errors.join(' | '));
        console.log('✓ other-maps browser: ' + checks + ' checks passed at z12–z15');
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
