'use strict';
// Compares the actual card geometry with the same content in both hosts.
// Optional dependencies: puppeteer-core and @sparticuz/chromium.
const assert = require('node:assert/strict');
const fs = require('node:fs');
let puppeteer, chromium;
try { puppeteer = require('puppeteer-core'); chromium = require('@sparticuz/chromium'); chromium = chromium.default || chromium; }
catch (_) { console.log('SKIP — install puppeteer-core and @sparticuz/chromium for browser geometry tests'); process.exit(0); }
(async () => {
    const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
    try {
        const page = await browser.newPage();
        const styles = ['css/styles.css', 'css/map3d-terrain.css', 'css/next-gen-apm.css', 'css/window-resize.css', 'css/map-window-layers.css']
            .map(file => '<style>' + fs.readFileSync(file, 'utf8') + '</style>').join('');
        const html = fs.readFileSync('index.html', 'utf8');
        const panel = html.match(/<section id="archReportPanel"[\s\S]*?<\/section>/)[0].replace(' hidden aria-hidden="true"', ' aria-hidden="false"');
        for (const scenario of [
            { name: 'desktop', width: 1200, height: 900, frameWidth: 900, frameHeight: 560 },
            { name: 'narrow desktop frame', width: 1000, height: 800, frameWidth: 330, frameHeight: 560 },
            { name: 'mobile web', width: 320, height: 640, frameWidth: 320, frameHeight: 600 },
            { name: 'PWA phone', width: 390, height: 844, frameWidth: 390, frameHeight: 844, pwa: true },
            { name: 'PWA landscape', width: 700, height: 360, frameWidth: 700, frameHeight: 360, pwa: true, fullscreen: true }
        ]) {
            await page.setViewport({ width: scenario.width, height: scenario.height });
            await page.setContent(`<!doctype html><html><head>${styles}<style>body { margin: 0 } .map-frame { position: relative; width: ${scenario.frameWidth}px; height: ${scenario.frameHeight}px; --pwa-bottom-controls-clearance: 72px; --map3d-safe-area-bottom: 20px; }</style></head><body class="${scenario.pwa ? 'is-pwa' : ''}"><div class="map-frame ${scenario.fullscreen ? 'is-fullscreen' : ''}"><div id="map3d-focus"><div class="m3d-focus-card"></div></div><div class="arch-report-host">${panel}</div></div></body></html>`);
            // The actual report remains scrollable and its controls are interactive.
            const real = await page.evaluate(() => {
                const report = document.querySelector('#archReportPanel');
                const r = report.getBoundingClientRect();
                return { height: r.height, clientHeight: report.clientHeight, scrollHeight: report.scrollHeight,
                    events: getComputedStyle(report).pointerEvents,
                    hasControls: !!report.querySelector('#archReportBaselineTrain') };
            });
            assert(real.height > 0 && real.hasControls && real.events === 'auto', scenario.name);
            assert(real.scrollHeight >= real.clientHeight, scenario.name + ' ' + JSON.stringify(real));
            // Identical tall content makes the max height observable; short content
            // also checks that neither card is forced to fill its available space.
            for (const height of [80, 2000]) {
                const result = await page.evaluate(height => {
                    const lidar = document.querySelector('.m3d-focus-card');
                    const report = document.querySelector('#archReportPanel');
                    lidar.innerHTML = report.innerHTML = `<div style="height:${height}px"></div>`;
                    const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
                    return { lidar: rect(lidar), report: rect(report), overflow: getComputedStyle(report).overflowY, hostEvents: getComputedStyle(report.parentElement).pointerEvents };
                }, height);
                for (const key of ['left', 'right', 'top', 'bottom', 'width', 'height'])
                    assert(Math.abs(result.lidar[key] - result.report[key]) < 1, `${scenario.name}, content ${height}: ${key}: ${JSON.stringify(result)}`);
                assert.equal(result.overflow, 'auto');
                assert.equal(result.hostEvents, 'none');
            }
            await page.addScriptTag({ content: fs.readFileSync('js/window-resize.js', 'utf8') });
            const resized = await page.evaluate(() => {
                const cards = [document.querySelector('.m3d-focus-card'), document.querySelector('#archReportPanel')];
                cards.forEach(card => card.querySelector('.dl-window-resize-handle').dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })));
                return cards.map(card => {
                    const r = card.getBoundingClientRect();
                    return { top: r.top, bottom: r.bottom, height: r.height };
                });
            });
            for (const key of ['top', 'bottom', 'height'])
                assert(Math.abs(resized[0][key] - resized[1][key]) < 1, `${scenario.name} resized ${key}: ${JSON.stringify(resized)}`);
        }
        console.log('Report / LiDAR window geometry: OK');
    } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
