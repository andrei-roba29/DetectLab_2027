// Real tutorial JS/CSS in Chromium, with a minimal map-shell fixture (no map,
// authentication, tile services or model pipeline). Checks guide rendering,
// navigation, localisation and scrolling, NOT the documented tools themselves.
// Run: PLAYWRIGHT_MODULE_DIR=/path/to/node_modules node test-tutorial-browser.js
// Optional: CHROMIUM_EXECUTABLE_PATH=/path/to/chromium; otherwise uses Playwright's
// browser or @sparticuz/chromium if installed in PLAYWRIGHT_MODULE_DIR.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
    const moduleDir = process.env.PLAYWRIGHT_MODULE_DIR;
    if (!moduleDir) {
        console.log('SKIP tutorial browser checks: set PLAYWRIGHT_MODULE_DIR.');
        return;
    }
    const { chromium } = require(path.join(moduleDir, 'playwright-core'));
    let executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
    let args = [];
    if (!executablePath && fs.existsSync(path.join(moduleDir, '@sparticuz/chromium'))) {
        const load = require('node:module').createRequire(path.join(moduleDir, '__tutorial_test.cjs'));
        const imported = load('@sparticuz/chromium');
        const bundled = imported.default || imported;
        executablePath = await bundled.executablePath();
        args = bundled.args.filter(arg => arg !== '--single-process');
    }
    const browser = await chromium.launch({ headless: true, executablePath, args });
    try {
        for (const scenario of [
            { pwa: false, width: 1440, height: 900 },
            { pwa: true, width: 390, height: 844 },
            { pwa: true, width: 320, height: 568 },
            { pwa: true, width: 844, height: 390 }
        ]) {
            for (const language of ['ro', 'en']) {
                const context = await browser.newContext({
                    viewport: { width: scenario.width, height: scenario.height },
                    hasTouch: scenario.pwa, reducedMotion: 'reduce'
                });
                const page = await context.newPage();
                const errors = [];
                page.on('pageerror', error => errors.push(error.message));
                await page.route('**/*', route => route.abort());
                await page.setContent(`<!doctype html><html lang="${language}"><head>
                    <meta name="viewport" content="width=device-width,initial-scale=1">
                    <style>body {margin:0;font-family:Arial;background:#222} .map-frame {height:100vh}</style>
                    </head><body class="${scenario.pwa ? 'is-pwa' : ''}">
                    <div class="map-frame"><button id="mapHelpBtn" onclick="openMapTutorial(4)">?</button></div>
                    </body></html>`);
                await page.addStyleTag({ content: fs.readFileSync(path.join(__dirname, 'css/tutorial.css'), 'utf8') });
                await page.evaluate(lang => { window._currentLang = () => lang; }, language);
                await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, 'js/tutorial.js'), 'utf8') });
                await page.click('#mapHelpBtn');
                assert.equal(await page.locator('.dl-tut-dot').count(), 13);
                await page.locator('.dl-tut-tab.premium').click();
                assert.match(await page.locator('.dl-tut-card-body').innerText(), /APM Next-Gen/);
                await page.locator('.dl-tut-nav-btn').nth(1).click();
                for (let index = 5; index <= 11; index++) {
                    await page.waitForFunction(i => document.querySelector('.dl-tut-title').textContent.startsWith(`${i + 1}/13`), index);
                    assert(await page.locator('.dl-tut-card-body[role="region"]').isVisible());
                    const geometry = await page.evaluate(() => {
                        const card = document.querySelector('.dl-tut-card');
                        const region = card.querySelector('.dl-tut-card-body');
                        const bar = document.querySelector('.dl-tut-bar').getBoundingClientRect();
                        const rect = card.getBoundingClientRect();
                        region.scrollTop = region.scrollHeight;
                        const last = region.lastElementChild.getBoundingClientRect();
                        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
                            barLeft: bar.left, barRight: bar.right, barBottom: bar.bottom,
                            lastBottom: last.bottom, regionBottom: region.getBoundingClientRect().bottom,
                            scrollable: region.scrollHeight > region.clientHeight,
                            scrollTop: region.scrollTop, pageScroll: document.documentElement.scrollTop };
                    });
                    assert(geometry.left >= 0 && geometry.right <= scenario.width + 1, 'card fits horizontally');
                    assert(geometry.top >= geometry.barBottom && geometry.bottom <= scenario.height + 1, 'card fits vertically');
                    assert(geometry.barLeft >= 0 && geometry.barRight <= scenario.width + 1, '13-dot toolbar fits');
                    assert(geometry.lastBottom <= geometry.regionBottom + 2, 'last section is reachable');
                    if (geometry.scrollable) assert(geometry.scrollTop > 0, 'overflow scrolls inside card');
                    assert.equal(geometry.pageScroll, 0, 'scrolling card does not scroll page');
                    assert.equal(await page.locator('.dl-tut-ring').count(), 0, 'no stale target rings on feature cards');
                    await page.locator('.dl-tut-nav-btn').nth(1).click();
                }
                assert(await page.locator('.dl-tut-finish').isVisible());
                await page.keyboard.press('ArrowLeft');
                await page.waitForFunction(() => document.querySelector('.dl-tut-title').textContent.startsWith('12/13'));
                const otherLanguage = language === 'en' ? 'ro' : 'en';
                await page.evaluate(lang => {
                    window._currentLang = () => lang;
                    document.dispatchEvent(new Event('detectlab:langchange'));
                }, otherLanguage);
                assert.match(await page.locator('.dl-tut-title').innerText(),
                    otherLanguage === 'ro' ? /Alte scurtături utile/ : /More useful shortcuts/);
                assert.equal(await page.locator('#mapHelpBtn').getAttribute('aria-label'),
                    otherLanguage === 'ro' ? 'Ghid rapid' : 'Quick guide');
                // Jump directly via a dot, resize, then close/reopen: all use the
                // same card renderer and must not leave an empty slide behind.
                await page.locator('.dl-tut-dot').nth(8).click();
                await page.setViewportSize({ width: scenario.height, height: scenario.width });
                await page.waitForFunction(() => document.querySelector('.dl-tut-card-body[role="region"]')?.getAttribute('aria-label').includes('MANUAL'));
                await page.keyboard.press('Escape');
                assert.equal(await page.locator('#dlTutorial').isVisible(), false);
                await page.click('#mapHelpBtn');
                await page.locator('.dl-tut-dot').last().click();
                await page.locator('.dl-tut-finish').click();
                assert.equal(await page.locator('#dlTutorial').isVisible(), false);
                assert.deepEqual(errors, [], 'no browser errors');
                console.log(`PASS ${scenario.pwa ? 'PWA' : 'desktop'} ${scenario.width}×${scenario.height} ${language}: catalogue, seven feature cards, scrolling, navigation, language switch, resize, close/reopen`);
                await context.close();
            }
        }
    } finally {
        await browser.close();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
