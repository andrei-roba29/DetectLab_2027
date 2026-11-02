// Next-Gen APM — heat tiles from the pre-projected Mercator texture (real Chromium canvas).
//   PUPPETEER_MODULE_DIR=/path/to/node_modules node test-apm-heat-texture-browser.js
// Without PUPPETEER_MODULE_DIR the checks are skipped (same convention as the other browser tests).
//
// Checks, with real Leaflet and the real js/apm-next/apm-heatmap.js:
//   1. a tile painted with one drawImage from the texture matches the legacy per-pixel
//      projection (same colours, same place) at country, regional and field zooms;
//   2. hidden (built-up / unverified) cells stay transparent at field zoom;
//   3. building a tile is much cheaper than the per-pixel path — this is what made
//      zooming over a TRAIN result stutter on Android PWAs.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');

async function main() {
    if (!process.env.PUPPETEER_MODULE_DIR) {
        console.log('Browser checks skipped (set PUPPETEER_MODULE_DIR to enable).');
        return;
    }
    const req = require('module').createRequire(path.join(process.env.PUPPETEER_MODULE_DIR, '..', 'package.json'));
    const puppeteer = req('puppeteer-core');
    const chromium = req('@sparticuz/chromium');
    const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
    let passed = 0;
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.setViewport({ width: 400, height: 400, deviceScaleFactor: 1 });
        await page.setContent(`<!doctype html><html><head><style>${read('css/leaflet.css')}
            html,body,#m{margin:0;width:100%;height:100%}</style></head><body><div id="m"></div></body></html>`);
        await page.addScriptTag({ content: read('js/leaflet.js') });
        await page.addScriptTag({ content: read('js/apm-next/apm-heatmap.js') });

        const result = await page.evaluate(async () => {
            const H = window.DetectLabApmHeatmap;
            const lat0 = 46.77, lon0 = 23.59;
            // 50 km TRAIN-sized window, 1024 × 1024 analysis cells.
            const w = 1024, h = 1024, dLat = 0.9 / h, dLon = 1.3 / w;
            const grid = { w, h, west: lon0 - 0.65, north: lat0 + 0.45, dLon, dLat };
            const score = new Float32Array(w * h), mask = new Uint8Array(w * h);
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
                const k = j * w + i;
                score[k] = 0.5 + 0.45 * Math.sin(i / 37) * Math.cos(j / 23);
                // Built-up blocks (hidden) and a protection zone (value 2, coloured).
                if (i % 211 < 9 && j % 173 < 9) mask[k] = 1;
                if (Math.hypot(i - 700, j - 300) < 8) mask[k] = 2;
                if (Math.hypot(i - 700, j - 300) < 8) score[k] = 0.95;
            }
            const thresholds = { medium: 0.55, high: 0.7, veryhigh: 0.85 };
            const raster = H.buildRaster(score, grid, thresholds, 512, mask);
            const t0 = performance.now();
            const texture = H.buildMercatorTexture(raster);
            const textureMs = performance.now() - t0;
            const fast = H.displayPayload(raster, texture);

            const map = L.map('m', { zoomAnimation: false, fadeAnimation: false }).setView([lat0, lon0], 9);
            const fastLayer = H.createLayer(fast, L, {}).addTo(map);
            const legacyLayer = H.createLayer(raster, L, {}).addTo(map);

            function pixels(layer, coords) {
                const c = layer.createTile(coords);
                return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            }
            function tileAt(lat, lon, z) {
                const p = map.project([lat, lon], z).divideBy(256).floor();
                const c = L.point(p.x, p.y); c.z = z; return c;
            }
            const comparisons = [];
            for (const z of [8, 10, 12, 15]) {
                const coords = tileAt(lat0 + 0.1, lon0 + 0.1, z);
                const a = pixels(fastLayer, coords), b = pixels(legacyLayer, coords);
                let diff = 0, n = 0, alphaMismatch = 0;
                for (let i = 0; i < a.length; i += 4) {
                    if (b[i + 3] > 40 && a[i + 3] > 40) {
                        diff += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
                        n++;
                    }
                    if ((a[i + 3] > 60) !== (b[i + 3] > 60) && Math.abs(a[i + 3] - b[i + 3]) > 90) alphaMismatch++;
                }
                comparisons.push({ z, meanRgbDiff: n ? diff / n / 3 : 0, compared: n, alphaMismatch: alphaMismatch / (a.length / 4) });
            }

            // Field zoom over the centre of a hidden built-up block: transparent.
            const blockLat = grid.north - (173 * 2 + 4.5) * dLat, blockLon = grid.west + (211 * 2 + 4.5) * dLon;
            const z16 = tileAt(blockLat, blockLon, 16);
            const px = map.project([blockLat, blockLon], 16).subtract(L.point(z16.x * 256, z16.y * 256)).round();
            const hiddenAlpha = pixels(fastLayer, z16)[4 * (px.y * 256 + px.x) + 3];
            // ...while the protection zone (value 2) is coloured, not a hole.
            const protLat = grid.north - 300.5 * dLat, protLon = grid.west + 700.5 * dLon;
            const z15 = tileAt(protLat, protLon, 15);
            const pp = map.project([protLat, protLon], 15).subtract(L.point(z15.x * 256, z15.y * 256)).round();
            const protectedAlpha = pixels(fastLayer, z15)[4 * (pp.y * 256 + pp.x) + 3];

            // Per-tile cost: 24 tiles, as for one phone-sized zoom step.
            // Main-thread time spent in createTile — the work that blocks pinch
            // gestures. (The texture path hands the pixels to the compositor/GPU;
            // a read-back would only measure this sandbox's software GL.)
            function timeTiles(layer, z) {
                const centre = tileAt(lat0, lon0, z), t = performance.now();
                for (let dy = -2; dy < 2; dy++) for (let dx = -3; dx < 3; dx++) {
                    const c = L.point(centre.x + dx, centre.y + dy); c.z = z;
                    layer.createTile(c);
                }
                return performance.now() - t;
            }
            timeTiles(fastLayer, 11);           // warm-up: texture upload + ImageBitmap
            await new Promise((resolve) => setTimeout(resolve, 50));
            const fastMs = timeTiles(fastLayer, 12) + timeTiles(fastLayer, 13);
            const legacyMs = timeTiles(legacyLayer, 12) + timeTiles(legacyLayer, 13);
            return { comparisons, hiddenAlpha, protectedAlpha, fastMs, legacyMs, textureMs,
                texture: { w: texture.w, h: texture.h }, shipsMask: 'exclusionMask' in fast };
        });

        assert.deepStrictEqual(errors, []);
        for (const c of result.comparisons) {
            assert.ok(c.compared > 1000, 'z' + c.z + ' compares coloured pixels');
            assert.ok(c.meanRgbDiff < 6, 'z' + c.z + ' same colours as the per-pixel projection (mean diff ' + c.meanRgbDiff.toFixed(2) + ')');
            assert.ok(c.alphaMismatch < 0.01, 'z' + c.z + ' same coverage/holes (mismatch ' + (c.alphaMismatch * 100).toFixed(2) + '%)');
        }
        console.log('  ok  texture tiles match the per-pixel Mercator projection at z8/z10/z12/z15 ' +
            JSON.stringify(result.comparisons.map(c => +c.meanRgbDiff.toFixed(2))));
        passed++;
        assert.strictEqual(result.hiddenAlpha, 0, 'built-up cell stays transparent at z16');
        assert.ok(result.protectedAlpha > 100, 'protection zone is coloured, no circular hole');
        assert.strictEqual(result.shipsMask, false, 'full-resolution mask is not part of the main-thread payload');
        console.log('  ok  hidden cells stay transparent at field zoom; protection zones are coloured');
        passed++;
        assert.ok(result.fastMs * 10 < result.legacyMs, 'texture tiles block the main thread at least 10x less');
        console.log('  ok  48 tiles, main-thread time: ' + result.fastMs.toFixed(1) + ' ms with the texture vs ' + result.legacyMs.toFixed(1) +
            ' ms per-pixel (texture ' + result.texture.w + 'x' + result.texture.h + ' built once in ' + result.textureMs.toFixed(0) + ' ms, in the worker)');
        passed++;
    } finally {
        await browser.close();
    }
    console.log('\n' + passed + ' passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
