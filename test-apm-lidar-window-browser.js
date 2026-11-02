'use strict';
// Real browser geometry: desktop APM vs LiDAR, plus unchanged mobile/PWA APM.
// Optional dependencies: puppeteer-core and @sparticuz/chromium.
const assert = require('node:assert/strict');
const fs = require('node:fs');
let puppeteer, chromium;
try {
    puppeteer = require('puppeteer-core');
    chromium = require('@sparticuz/chromium');
    chromium = chromium.default || chromium;
} catch (_) { console.log('SKIP — install puppeteer-core and @sparticuz/chromium for browser geometry tests'); process.exit(0); }
(async () => {
    const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
    try {
        const page = await browser.newPage();
        const styles = ['css/styles.css', 'css/map3d-terrain.css', 'css/next-gen-apm.css', 'css/window-resize.css', 'css/map-window-layers.css']
            .map(file => '<style>' + fs.readFileSync(file, 'utf8') + '</style>').join('');
        for (const scenario of [
            { name: 'desktop', width: 1200, height: 900, frameWidth: 900, frameHeight: 560, desktop: true },
            { name: 'narrow map on desktop', width: 1000, height: 800, frameWidth: 330, frameHeight: 560, desktop: true },
            { name: 'desktop fullscreen', width: 1280, height: 720, frameWidth: 1280, frameHeight: 720, desktop: true, fullscreen: true },
            { name: 'desktop short viewport', width: 850, height: 400, frameWidth: 850, frameHeight: 400, desktop: true },
            { name: 'mobile web', width: 360, height: 720, frameWidth: 360, frameHeight: 720 },
            { name: 'PWA phone', width: 390, height: 844, frameWidth: 390, frameHeight: 844, pwa: true },
            { name: 'PWA desktop width', width: 1200, height: 900, frameWidth: 900, frameHeight: 560, pwa: true }
        ]) {
            await page.setViewport({ width: scenario.width, height: scenario.height });
            await page.setContent(`<!doctype html><html><head>${styles}<style>body { margin: 0 } .map-frame { position: relative; width: ${scenario.frameWidth}px; height: ${scenario.frameHeight}px; --pwa-bottom-controls-clearance: 72px; --map3d-safe-area-bottom: 20px; }</style></head><body class="${scenario.pwa ? 'is-pwa' : ''}"><div class="map-frame ${scenario.fullscreen ? 'is-fullscreen' : ''}"><div id="map3d-focus"><div class="m3d-focus-card"></div></div><section id="apmNextPanel" class="apm-panel"></section><section class="apm-panel reference"></section></div></body></html>`);
            for (const height of [80, 2000]) {
                const boxes = await page.evaluate(height => {
                    const cards = [document.querySelector('.m3d-focus-card'), document.querySelector('#apmNextPanel'), document.querySelector('.reference')];
                    cards.forEach(card => { card.innerHTML = `<div style="height:${height}px"></div>`; });
                    return cards.map(card => { const r = card.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, overflow: getComputedStyle(card).overflowY }; });
                }, height);
                const expected = scenario.desktop ? boxes[0] : boxes[2];
                for (const key of ['left', 'right', 'top', 'bottom', 'width', 'height'])
                    assert(Math.abs(expected[key] - boxes[1][key]) < 1, `${scenario.name}, content ${height}, ${key}: ${JSON.stringify(boxes)}`);
                assert.equal(boxes[1].overflow, 'auto');
            }
            if (scenario.desktop) {
                await page.addScriptTag({ content: fs.readFileSync('js/window-resize.js', 'utf8') });
                const boxes = await page.evaluate(() => {
                    const cards = [document.querySelector('.m3d-focus-card'), document.querySelector('#apmNextPanel')];
                    cards.forEach(card => card.querySelector('.dl-window-resize-handle').dispatchEvent(
                        new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })));
                    return cards.map(card => { const r = card.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, inline: card.getAttribute("style"), max: getComputedStyle(card).maxHeight }; });
                });
                for (const key of ['top', 'bottom', 'height'])
                    assert(Math.abs(boxes[0][key] - boxes[1][key]) < 1, `${scenario.name}, resized ${key}: ${JSON.stringify(boxes)}`);
            }
        }
        console.log('Desktop APM / LiDAR geometry and unchanged mobile/PWA: OK');
    } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
