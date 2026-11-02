// A saved APM switch must not reopen its configuration window on app startup.
// Executes the shipped init, visibility, minimization and switch functions in a
// minimal DOM fixture; no network, model runs or browser dependency required.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const source = read('js/apm-next/apm-ui.js');
const lifecycle = source.slice(source.indexOf('    function setPanelVisible(open)'),
    source.indexOf('    root.DetectLabApmUi ='));
const enable = source.slice(source.indexOf('    function setEnabled(on)'),
    source.indexOf('    function renderSwitch()'));

function boot(saved, { pwa = false, row = true, dock = true, storageError = false } = {}) {
    const classes = new Set(pwa ? ['is-pwa'] : []);
    const entries = new Map();
    const toggle = { checked: false, addEventListener(type, callback) { this[type] = callback; } };
    const panel = { hidden: true, attrs: {}, setAttribute(key, value) { this.attrs[key] = value; } };
    let builds = 0;
    const state = { enabled: false, picking: false, mode: 'manual', centre: null };
    const ui = {};
    const host = { appendChild() {} };
    const root = {
        localStorage: {
            getItem() { if (storageError) throw Error('storage blocked'); return saved; },
            setItem(key, value) { saved = value; }
        },
        DetectLabWindowDock: dock ? {
            minimize(id, label, restore) { entries.set(id, restore); },
            remove(id) { entries.delete(id); }
        } : null
    };
    for (const dependency of ['Heatmap', 'Pipeline', 'Core', 'Sites', 'Providers', 'I18n']) {
        root['DetectLabApm' + dependency] = {};
    }
    const context = {
        root, state, ui,
        document: {
            body: { classList: { toggle(name, on) { on ? classes.add(name) : classes.delete(name); } } },
            getElementById(id) { return id === 'apmNextToggle' && row ? toggle : null; },
            querySelector() { return host; }, addEventListener() {}
        },
        SWITCH_KEY: 'detectlab_apm_next',
        T: key => key,
        buildPanel() { builds++; return panel; },
        h() { return { setAttribute() {} }; },
        renderSwitch() { toggle.checked = state.enabled; },
        updateGate() {}, renderDebugLog() {}, refreshI18n() {}, applyOpacity() {},
        stopPick() { state.picking = false; },
        cancelRun() {}, cancelSiteLoad() {}, clearResult() {}, clearCentre() {}, drawCentre() {}, loadBuiltinSites() {}
    };
    vm.createContext(context);
    vm.runInContext(lifecycle + enable + '\ninit();', context);
    return { context, state, ui, panel, classes, entries, toggle, saved: () => saved, builds: () => builds };
}

for (const pwa of [false, true]) {
    for (const saved of [null, 'off', 'on']) {
        const app = boot(saved, { pwa });
        assert.equal(app.state.enabled, saved === 'on', 'restore saved enabled state');
        assert.equal(app.toggle.checked, saved === 'on', 'layer checkbox stays synchronized');
        assert.equal(app.saved(), saved, 'boot does not overwrite user preference');
        assert.equal(app.panel.hidden, true, 'no automatic window on startup');
        assert.equal(app.classes.has('apm-panel-open'), false, 'no open-window layout class');
        assert.equal(app.entries.has('apm-next'), saved === 'on', 'enabled feature has a drawer restore action');
        vm.runInContext('init();', app.context);
        assert.equal(app.builds(), 1, 'repeated init is idempotent');
        if (saved === 'on') {
            app.entries.get('apm-next')();
            assert.equal(app.panel.hidden, false, 'user can explicitly restore the saved feature');
            assert.equal(app.panel.attrs['aria-hidden'], 'false');
            assert.equal(app.entries.size, 0, 'restoring removes the minimized entry');
            vm.runInContext('minimizePanel();', app.context);
            assert.equal(app.panel.hidden, true);
            assert.equal(app.state.enabled, true, 'minimizing does not disable APM');
        }
        // A deliberate layer switch still opens the panel, unlike saved-state restoration.
        app.toggle.checked = true;
        app.toggle.change();
        assert.equal(app.panel.hidden, false, 'explicit enable opens configuration');
        assert.equal(app.saved(), 'on');
        app.toggle.checked = false;
        app.toggle.change();
        assert.equal(app.panel.hidden, true, 'explicit disable closes configuration');
        assert.equal(app.entries.size, 0);
        assert.equal(app.saved(), 'off');
        // A fresh app instance with that saved preference stays closed again.
        assert.equal(boot(app.saved(), { pwa }).panel.hidden, true);
    }
}
assert.equal(boot('on', { storageError: true }).state.enabled, false, 'blocked storage defaults off');
assert.equal(boot('on', { row: false }).panel.hidden, true, 'standalone launcher stays closed');
assert.equal(boot('on', { dock: false }).panel.hidden, true, 'missing optional drawer does not auto-open');
const url = (read('index.html').match(/src="(js\/apm-next\/apm-ui\.js\?v=[^"]+)"/) || [])[1];
assert(url && url.includes('apm-ui.js?v='), 'UI has a cache tag');
assert(read('sw.js').includes("'" + url + "'"), 'service worker precaches the exact UI URL');
// Every release bumps the shell cache; keep this check independent of the tag.
const shellVersion = Number((read('sw.js').match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1]);
assert(shellVersion >= 366, 'shell cache was bumped for the current release');
console.log('APM startup: saved on/off, PWA/web, drawer restore, explicit toggles, repeated init, storage failure and cache wiring passed.');
