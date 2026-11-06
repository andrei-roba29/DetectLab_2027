#!/usr/bin/env node
'use strict';
/*
 * test-hoards-layers.js
 * ───────────────────────────────────────────────────────────────────────────
 * “Hoards” — a PREMIUM group for EVERY country, built from the seven DARMC
 * (Harvard) ArcGIS FeatureServer catalogues:
 *
 *   8  Carolingian coin hoards, 769–814 CE      12  Gallic coin hoards, 200–300 CE
 *   9  Carolingian coin hoards, 815–840 CE      15  Late Roman deposits (gold weight)
 *   10 Carolingian coin hoards, 841–900 CE      16  Late Roman deposits (deposit date)
 *   11 Carolingian coin hoards, after 900 CE
 *
 * What this test locks down
 * -------------------------
 *   1. index.html: one premium group row (`data-category="premium"`, no country
 *      attribution) with a title that travels through js/translations.js, a
 *      group ⓘ, an expand chevron, a master switch, a group opacity slider and
 *      the `#hoardsSubLayers` mount, plus the module's <script> tag.
 *   2. js/hoards-layers.js, run against a stub DOM + stub Leaflet + stub fetch:
 *      seven rows (one per FeatureServer layer, layer 8 listed once), each with
 *      its own switch, opacity slider, % badge, status line and ⓘ; every query
 *      asks only its own layer for the visible envelope in EPSG:4326; the
 *      sliders repaint without re-querying; failures, partial answers and the
 *      legacy Esri JSON fallback are handled on the row, never thrown.
 *   3. EVERY COUNTRY: no ISO ever gates the group (GB, RO, FR, US, JP and the
 *      global no-country view all keep it on screen).
 *   4. The Premium tab gate + the subscription gate: the group and every row it
 *      builds are `data-category="premium"`, a free user cannot switch a
 *      catalogue on (UI or API), and a lapsed plan turns everything off.
 *   5. Translations + cache-busting: `layer_hoards` exists in all 25 menu
 *      languages, and index.html / sw.js request/pre-cache the same URLs.
 *
 * No network, account or npm dependency. Usage: node test-hoards-layers.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');
const html = read('index.html');
const css = read('css/styles.css');
const sw = read('sw.js');
const moduleSource = read('js/hoards-layers.js');
const translationsSource = read('js/translations.js');

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };

console.log('[Hoards] premium · every country · seven DARMC FeatureServer catalogues');

/* ══════════════════════════════════════════════════════════════════════════
 * 1. THE PANEL MARKUP — a premium group row, exactly one of it
 * ══════════════════════════════════════════════════════════════════════════ */

const groupStart = html.indexOf('id="hoardsRow"');
check(groupStart > 0, 'index.html declares #hoardsRow');
const groupTagStart = html.lastIndexOf('<div', groupStart);
const groupTag = html.slice(groupTagStart, html.indexOf('>', groupStart) + 1);

check(/class="[^"]*\btransp-layer-row\b[^"]*"/.test(groupTag),
    'the hoards group is a real .transp-layer-row — the same box as every other layer row');
check(/data-category="premium"/.test(groupTag),
    'the hoards group declares data-category="premium"');
check(!/\bactive\b/.test(groupTag.replace(/data-category="premium"/, '')),
    'the premium group does not claim the Free tab marker on load');
check(!/data-country|data-pays|country-section-list/.test(groupTag),
    'the group carries NO country attribution — DARMC hoards belong to every country');
check((html.match(/id="hoardsRow"/g) || []).length === 1, 'there is exactly one hoards group');

const groupEnd = html.indexOf('<!-- Harti Istorice', groupStart);
check(groupEnd > groupStart, 'the hoards block is delimited by the next premium block');
const groupHtml = html.slice(groupTagStart, groupEnd);

check(/<span[^>]*data-key="layer_hoards"[^>]*id="hoardsTitle"[^>]*>/.test(groupHtml),
    'the group title travels through js/translations.js (data-key="layer_hoards")');
check(/showHoardsGroupInfo\(\)/.test(groupHtml), 'the group carries its own ⓘ');
check(/id="hoardsExpandBtn"/.test(groupHtml) && /id="hoardsExpandIcon"/.test(groupHtml),
    'the group carries the expand/collapse chevron of the other groups');
check(/id="hoardsToggle"/.test(groupHtml) && /toggleHoardsLayers\(this\.checked\)/.test(groupHtml),
    'the group carries a master on/off switch');
check(/id="hoardsOpacitySlider"/.test(groupHtml) && /setHoardsOpacity\(this\.value\)/.test(groupHtml),
    'the group carries the group opacity slider');
check(/class="transp-slider"[^>]*id="hoardsOpacitySlider"/.test(groupHtml),
    'the group slider is the shared .transp-slider');
check(/id="hoardsOpacitySlider"/.test(groupHtml),
    'the group slider id contains “Opacity” (the vertical mirror’s hook)');
check(/id="hoardsPct"/.test(groupHtml), 'the group slider has its .pct badge');
check(/PREMIUM/.test(groupHtml), 'the group is visibly marked PREMIUM');
check(/id="hoardsSubLayers"/.test(groupHtml), 'the group exposes the #hoardsSubLayers mount');

check(/<script src="js\/hoards-layers\.js\?v=[^"]+"><\/script>/.test(html),
    'index.html loads the module');

/* ══════════════════════════════════════════════════════════════════════════
 * 2. CSS — premium tab gate, no country gate
 * ══════════════════════════════════════════════════════════════════════════ */

check(/\.hoards-sublayer\[data-category\]\s*\{\s*display:\s*none\s*!important/.test(css),
    'a catalogue row with no tab marker is hidden');
check(/\.hoards-sublayer\[data-category\]\.active\s*\{\s*display:\s*flex\s*!important/.test(css),
    'a catalogue row is displayed only when the current tab marked it .active');
check(!/#transpPanel #hoardsRow\.country-layer-unavailable/.test(css),
    'the CSS deliberately has no country gate for the hoards group');
check(/\.hoards-status\.is-error/.test(css), 'the failure state of a catalogue row is styled');
check(/\.hoards-popup-row/.test(css), 'the popup attribute lines are styled');
check(/\.hoards-sublayer \.apm-toggle-switch input:focus-visible/.test(css),
    'the generated switches stay keyboard-visible');

/* ══════════════════════════════════════════════════════════════════════════
 * 3. THE MODULE — seven rows, own switch/slider/ⓘ, viewport queries
 * ══════════════════════════════════════════════════════════════════════════ */

function makeDom() {
    const byId = Object.create(null);

    class ClassList {
        constructor(el) { this.el = el; this.set = new Set(); }
        add() { Array.prototype.forEach.call(arguments, (c) => c && this.set.add(c)); this.sync(); }
        remove() { Array.prototype.forEach.call(arguments, (c) => this.set.delete(c)); this.sync(); }
        contains(c) { return this.set.has(c); }
        toggle(c, force) {
            const on = force === undefined ? !this.set.has(c) : !!force;
            if (on) this.set.add(c); else this.set.delete(c);
            this.sync();
            return on;
        }
        sync() { this.el._className = Array.from(this.set).join(' '); }
        get value() { return Array.from(this.set).join(' '); }
    }

    class Element {
        constructor(tag) {
            this.tagName = String(tag || 'div').toUpperCase();
            this.children = [];
            this.attributes = Object.create(null);
            this.style = {};
            this.listeners = Object.create(null);
            this.classList = new ClassList(this);
            this.parentNode = null;
            this._text = '';
            this._html = '';
        }
        get className() { return this.classList.value; }
        set className(value) {
            this.classList.set = new Set(String(value || '').split(/\s+/).filter(Boolean));
            this.classList.sync();
        }
        get id() { return this.attributes.id || ''; }
        set id(value) { this.setAttribute('id', value); }
        setAttribute(key, value) {
            this.attributes[key] = String(value);
            if (key === 'id') byId[String(value)] = this;
            if (key === 'class') {
                this.classList.set = new Set(String(value || '').split(/\s+/).filter(Boolean));
                this.classList.sync();
            }
        }
        getAttribute(key) {
            return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null;
        }
        hasAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key); }
        removeAttribute(key) { delete this.attributes[key]; }
        appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
            return child;
        }
        get textContent() {
            if (this._text) return this._text;
            if (!this.children.length) return '';
            return this.children.map((child) => child.textContent).join('');
        }
        set textContent(value) { this._text = String(value == null ? '' : value); this.children = []; }
        get innerHTML() { return this._html; }
        set innerHTML(value) { this._html = String(value == null ? '' : value); this._text = ''; this.children = []; }
        set type(value) { this.attributes.type = value; }
        set checked(value) { this._checked = !!value; }
        get checked() { return !!this._checked; }
        set indeterminate(value) { this._indeterminate = !!value; }
        get indeterminate() { return !!this._indeterminate; }
        set value(value) { this.attributes.value = String(value); }
        get value() { return this.attributes.value; }
        get scrollHeight() { return 40 * (this.children.length || 1); }
        get offsetHeight() { return 20; }
        addEventListener(type, handler) { (this.listeners[type] || (this.listeners[type] = [])).push(handler); }
        dispatch(type, event) {
            const ev = event || {};
            ev.target = ev.target || this;
            ev.preventDefault = ev.preventDefault || function () {};
            ev.stopPropagation = ev.stopPropagation || function () {};
            (this.listeners[type] || []).forEach((handler) => handler(ev));
        }
        get dataset() {
            const data = {};
            Object.keys(this.attributes).forEach((key) => {
                if (key.indexOf('data-') !== 0) return;
                data[key.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = this.attributes[key];
            });
            return data;
        }
        matches(selector) { return matchesCompound(this, selector); }
        querySelectorAll(selector) { return querySelectorAll(this, selector); }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        closest(selector) {
            for (let node = this; node; node = node.parentNode) {
                if (node.nodeType === 1 && matchesCompound(node, selector)) return node;
            }
            return null;
        }
        contains(node) {
            for (let n = node; n; n = n.parentNode) if (n === this) return true;
            return false;
        }
    }

    function matchesCompound(el, compound) {
        const selector = String(compound).trim();
        if (!selector) return false;
        const tag = (/^([a-zA-Z]*)/.exec(selector) || [])[1] || '';
        if (tag && tag !== '*' && el.tagName !== tag.toUpperCase()) return false;
        const classes = (selector.match(/\.[A-Za-z0-9_-]+/g) || []).map((c) => c.slice(1));
        if (!classes.every((c) => el.classList.contains(c))) return false;
        const attrs = selector.match(/\[[^\]]+\]/g) || [];
        for (let i = 0; i < attrs.length; i++) {
            const match = /^\[\s*([A-Za-z0-9_:-]+)\s*(?:=\s*["']?([^"'\]]*)["']?\s*)?\]$/.exec(attrs[i]);
            if (!match) return false;
            const value = el.getAttribute(match[1]);
            if (value === null) return false;
            if (match[2] !== undefined && value !== match[2]) return false;
        }
        return true;
    }

    function descendants(root, out) {
        root.children.forEach((child) => {
            out.push(child);
            descendants(child, out);
        });
        return out;
    }

    function querySelectorAll(root, selector) {
        const parts = String(selector).trim().split(/\s+/);
        let candidates = [root];
        parts.forEach((part) => {
            const next = [];
            candidates.forEach((node) => {
                descendants(node, []).forEach((child) => {
                    if (matchesCompound(child, part) && next.indexOf(child) < 0) next.push(child);
                });
                if (matchesCompound(node, part) && next.indexOf(node) < 0) next.push(node);
            });
            candidates = next;
        });
        return candidates;
    }

    const documentElement = new Element('html');
    documentElement.setAttribute('lang', 'en');
    const body = new Element('body');

    const document = {
        readyState: 'complete',
        documentElement: documentElement,
        body: body,
        listeners: Object.create(null),
        createElement: (tag) => new Element(tag),
        getElementById: (id) => byId[id] || null,
        querySelector: (selector) => querySelectorAll(body, selector)[0] || null,
        querySelectorAll: (selector) => querySelectorAll(body, selector),
        addEventListener(type, handler) {
            (this.listeners[type] || (this.listeners[type] = [])).push(handler);
        },
        dispatch(type, detail) {
            const ev = { detail: detail, target: body, preventDefault() {}, stopPropagation() {} };
            (this.listeners[type] || []).forEach((handler) => handler(ev));
        }
    };

    return { document, body, Element, byId };
}

const dom = makeDom();
const { document, body, Element, byId } = dom;

/* Tab bar — the premium tab is the active one for this run. */
const tabs = new Element('div');
tabs.className = 'transp-panel-tabs';
const freeTab = new Element('button');
freeTab.className = 'tab-btn';
freeTab.setAttribute('data-tab', 'free');
const premiumTab = new Element('button');
premiumTab.className = 'tab-btn active';
premiumTab.setAttribute('data-tab', 'premium');
tabs.appendChild(freeTab);
tabs.appendChild(premiumTab);

/* The group skeleton index.html owns. */
const group = new Element('div');
group.className = 'transp-layer-row hoards-group';
group.setAttribute('id', 'hoardsRow');
group.setAttribute('data-category', 'premium');

const masterInput = new Element('input');
masterInput.setAttribute('type', 'checkbox');
masterInput.setAttribute('id', 'hoardsToggle');
group.appendChild(masterInput);

const expandIcon = new Element('svg');
expandIcon.setAttribute('id', 'hoardsExpandIcon');
group.appendChild(expandIcon);
const expandBtn = new Element('button');
expandBtn.setAttribute('id', 'hoardsExpandBtn');
group.appendChild(expandBtn);

const groupPct = new Element('span');
groupPct.className = 'pct';
groupPct.setAttribute('id', 'hoardsPct');
group.appendChild(groupPct);

const groupSlider = new Element('input');
groupSlider.setAttribute('type', 'range');
groupSlider.className = 'transp-slider';
groupSlider.setAttribute('id', 'hoardsOpacitySlider');
groupSlider.setAttribute('value', '85');
group.appendChild(groupSlider);

const mount = new Element('div');
mount.setAttribute('id', 'hoardsSubLayers');
group.appendChild(mount);

body.appendChild(tabs);
body.appendChild(group);

/* Stub Leaflet + map + network. */
const geoJsonLayers = [];
const panes = {};
const mapLayers = new Set();
const mapHandlers = {};
const map = {
    createPane(id) { panes[id] = { style: {} }; return panes[id]; },
    getPane(id) { return panes[id]; },
    hasLayer(layer) { return mapLayers.has(layer); },
    addLayer(layer) { mapLayers.add(layer); return this; },
    removeLayer(layer) { mapLayers.delete(layer); return this; },
    on(types, handler) {
        String(types).split(/\s+/).forEach((type) => {
            (mapHandlers[type] || (mapHandlers[type] = [])).push(handler);
        });
    },
    fire(type) { (mapHandlers[type] || []).forEach((handler) => handler()); },
    getZoom() { return 7; },
    getBounds() { return { getWest: () => 20.2, getSouth: () => 43.9, getEast: () => 26.2, getNorth: () => 48.2 }; }
};

function FakeGeoJSON(options) {
    this.options = options || {};
    this.features = [];
    this.children = [];
}
FakeGeoJSON.prototype.addTo = function (target) { target.addLayer(this); return this; };
FakeGeoJSON.prototype.clearLayers = function () { this.features = []; this.children = []; };
FakeGeoJSON.prototype.addData = function (collection) {
    this.features = (collection && collection.features) || [];
    this.children = this.features.map((feature) => ({
        feature: feature,
        style: {},
        setStyle(next) { this.style = Object.assign({}, this.style, next); }
    }));
};
FakeGeoJSON.prototype.eachLayer = function (fn) { this.children.forEach(fn); };
FakeGeoJSON.prototype.setStyle = function () {};

const L = {
    geoJSON(data, options) {
        const layer = new FakeGeoJSON(options);
        geoJsonLayers.push(layer);
        return layer;
    },
    circleMarker(latlng, options) { return { latlng: latlng, options: options, setStyle() {} }; },
    Util: { extend: (target, source) => Object.assign(target || {}, source || {}) }
};

/* Fetch stub: every layer answers with one point record; the layer id is kept
 * so the test can prove each switch queried only its own catalogue. */
const fetchCalls = [];
let partialFor = null;
let failLayer = null;
/* A deployment that rejects f=geojson: the module must retry the same viewport
 * as classic Esri JSON and convert it, not report “no records”. */
let esriOnlyLayer = null;
function fetchStub(url) {
    const href = String(url);
    fetchCalls.push(href);
    const layerMatch = /FeatureServer\/(\d+)\/query/.exec(href);
    const layerId = layerMatch ? Number(layerMatch[1]) : null;
    if (failLayer !== null && layerId === failLayer) {
        return Promise.reject(new Error('offline'));
    }
    if (esriOnlyLayer !== null && layerId === esriOnlyLayer) {
        if (/[?&]f=geojson/.test(href)) return Promise.reject(new Error('f=geojson unsupported'));
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                features: [{
                    attributes: { OBJECTID: 7, Name: 'Esri record', GoldEquivalent: 5 },
                    geometry: { x: 24.1, y: 45.8 }
                }]
            })
        });
    }
    const props = { OBJECTID: 1, Site: 'Roșiori', GoldEquivalent: 12.5, Country: 'Romania' };
    const payload = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [24.1, 45.8] }, properties: props }]
    };
    if (partialFor !== null && layerId === partialFor) payload.exceededTransferLimit = true;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
}

const shownInfo = [];
const windowListeners = Object.create(null);
const sandbox = {
    console: { warn() {}, error() {}, info() {} },
    document,
    listeners: windowListeners,
    addEventListener(type, handler) {
        (windowListeners[type] || (windowListeners[type] = [])).push(handler);
    },
    fireWindow(type) {
        (windowListeners[type] || []).forEach((handler) => handler({ type: type }));
    },
    L,
    _dlMap: map,
    URLSearchParams,
    fetch: fetchStub,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    AbortController,
    Promise,
    showLayerInfo(...args) { shownInfo.push(args); },
    _currentLang: () => 'en'
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(moduleSource, sandbox, { filename: 'js/hoards-layers.js' });

const api = sandbox.DetectLabHoards;
check(!!api, 'the module publishes window.DetectLabHoards');
check(api.sources.length === 7, 'seven catalogues — layer 8 is listed once, not twice');
check(api.sources.map((s) => s.layerId).join(',') === '8,9,10,11,12,15,16',
    'the exact FeatureServer layer ids the viewer supplied (8, 9, 10, 11, 12, 15, 16)');
check(/services1\.arcgis\.com\/qN3V93cYGMKQCOxL\/arcgis\/rest\/services\/DARMC_Archaeological_Studies\/FeatureServer\//.test(moduleSource),
    'the catalogues point at the DARMC_Archaeological_Studies FeatureServer');
check(new Set(api.sources.map((s) => s.layerId)).size === 7,
    'no FeatureServer layer is listed twice');
check(api.sources.every((s) => s.label && s.label.en && s.label.ro),
    'every catalogue carries an English and a Romanian name');

/* Rows: one per catalogue, each with own switch / slider / % / status / ⓘ. */
const rowNodes = api.sources.map((s) => document.getElementById('hoardsLayer-' + s.id));
check(rowNodes.every(Boolean), 'a row exists for each of the seven catalogues');
check(rowNodes.every((row) => row.getAttribute('data-category') === 'premium'),
    'every catalogue row is data-category="premium"');
check(rowNodes.every((row) => row.classList.contains('active')),
    'the rows follow the active Premium tab (applyCurrentTab)');
check(rowNodes.every((row) => row.classList.contains('dl-sublayer-row')),
    'the rows use the shared glass sublayer box');
api.sources.forEach((s) => {
    check(!!document.getElementById('hoardsToggle-' + s.id), s.id + ': own on/off switch');
    check(!!document.getElementById('hoardsOpacity-' + s.id), s.id + ': own opacity slider');
    check(!!document.getElementById('hoardsPct-' + s.id), s.id + ': own % badge');
    check(!!document.getElementById('hoardsStatus-' + s.id), s.id + ': own status line');
});
check(mount.children.length === 7, 'the mount holds exactly seven rows');

/* ⓘ per catalogue names its own dates/provider. */
api.sourceInfo('gallic-200-300');
check(shownInfo.length === 1, 'the catalogue ⓘ opens the info panel');
check(/Gallic/.test(shownInfo[0][0]) && /200–300/.test(shownInfo[0][0]),
    'the ⓘ of a catalogue is that catalogue’s own (dates in the title)');
check(/DARMC/.test(shownInfo[0][1]), 'the ⓘ credits DARMC');
api.groupInfo();
check(/Hoards/.test(shownInfo[1][0]) && /DARMC/.test(shownInfo[1][1]),
    'the group ⓘ credits DARMC for the whole family');

/* ── switching, failures, every country ──────────────────────────────── */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
    /* The module polls for the live map (window._dlMap) every 250 ms, exactly
     * as it does in the app, so the first switch happens after that attach. */
    await sleep(320);
    check(!!(mapHandlers.moveend && mapHandlers.moveend.length),
        'the module attaches itself to the live map (moveend/zoomend refresh)');
    check(!!panes.pane_hoards, 'the module owns its own pane above the heritage pane');

    fetchCalls.length = 0;
    api.setSource('gallic-200-300', true);
    await sleep(60);
    const queried = fetchCalls.map((href) => (/FeatureServer\/(\d+)\//.exec(href) || [])[1]);
    check(queried.length > 0 && queried.every((id) => id === '12'),
        'switching one catalogue queries only its own FeatureServer layer');
    const first = fetchCalls[0];
    check(/[?&]f=geojson/.test(first), 'the first request asks for GeoJSON');
    check(/outSR=4326/.test(first) && /inSR=4326/.test(first), 'both CRSs are WGS84');
    check(/geometryType=esriGeometryEnvelope/.test(first) && /spatialRel=esriSpatialRelIntersects/.test(first),
        'the query is the visible envelope ∩ the layer');
    check(/20\.2%2C43\.9%2C26\.2%2C48\.2/.test(first) || /20\.2,43\.9,26\.2,48\.2/.test(first),
        'the envelope is the map’s own bounding box');
    check(api.isActive('gallic-200-300'), 'the switch state is remembered');
    check(api.statusOf('gallic-200-300').count === 1, 'the row reports its feature count');

    /* A partial answer is flagged, not silently truncated. */
    partialFor = 12;
    api.refresh();
    await sleep(400);
    check(/partial/.test(api.statusOf('gallic-200-300').text),
        'an ArcGIS exceededTransferLimit answer is reported as partial');
    partialFor = null;

    /* A failure is reported on the row and never thrown. */
    failLayer = 12;
    api.refresh();
    await sleep(400);
    check(api.statusOf('gallic-200-300').kind === 'error',
        'a failing FeatureServer leaves a readable error on the row');
    failLayer = null;

    /* f=geojson unsupported → the same viewport retried as classic Esri JSON. */
    esriOnlyLayer = 12;
    api.refresh();
    await sleep(400);
    check(api.statusOf('gallic-200-300').count === 1,
        'classic Esri JSON is converted instead of reported as “no records”');
    check(api.statusOf('gallic-200-300').kind !== 'error',
        'the f=json fallback leaves no error on the row');
    check(fetchCalls.some((href) => /[?&]f=json/.test(href) && /FeatureServer\/12\//.test(href)),
        'the fallback asks the same layer for f=json');
    esriOnlyLayer = null;

    /* Group opacity repaints, it does not re-query. */
    const before = fetchCalls.length;
    api.setGroupOpacity(40);
    check(fetchCalls.length === before, 'changing opacity repaints instead of re-querying');
    check(String(document.getElementById('hoardsOpacity-gallic-200-300').value) === '40',
        'the group opacity reaches every catalogue slider');
    check(document.getElementById('hoardsPct-gallic-200-300').textContent === '40%',
        'the group opacity reaches every catalogue badge');

    /* Switching off removes the layer from the map and clears its row. */
    const onMapBefore = mapLayers.size;
    check(onMapBefore === 1, 'exactly the switched-on catalogue is on the map');
    api.setSource('gallic-200-300', false);
    check(!api.isActive('gallic-200-300'), 'switching off clears the state');
    check(api.statusOf('gallic-200-300').text === '', 'switching off clears the status line');
    check(mapLayers.size === onMapBefore - 1, 'switching off removes the Leaflet group from the map');
    check(api.sources.length === 7, 'the catalogue list survives a switch-off (state is reusable)');

    /* ── every country ────────────────────────────────────────────────── */
    ['GB', 'RO', 'FR', 'DE', 'IT', 'ES', 'PL', 'US', 'JP', 'AU', ''].forEach((iso) => {
        document.dispatch('detectlab:country-selected', { iso: iso });
        const row = document.getElementById('hoardsRow');
        check(!row.classList.contains('country-layer-unavailable'),
            'the hoards group stays on screen for ' + (iso || 'the global view'));
        check(row.getAttribute('aria-hidden') === 'false',
            'the hoards group is announced as visible for ' + (iso || 'the global view'));
    });
    api.filterForCountry('JP');
    check(api.sources.every((s) => !document.getElementById('hoardsLayer-' + s.id)
        .classList.contains('country-layer-unavailable')),
        'no catalogue row is ever country-gated');
    document.dispatch('detectlab:country-cleared');
    check(!document.getElementById('hoardsRow').classList.contains('country-layer-unavailable'),
        'leaving the country view keeps the group available (it is a global layer)');

    /* ── the group master switch ──────────────────────────────────────── */
    api.toggleAll(true);
    check(api.sources.every((s) => api.isActive(s.id)), 'the master switch turns every catalogue on');
    check(masterInput.checked === true, 'the master switch reflects “all on”');
    api.setSource('gallic-200-300', false);
    check(masterInput.indeterminate === true, 'a partly switched group is indeterminate');
    api.toggleAll(false);
    check(api.sources.every((s) => !api.isActive(s.id)), 'the master switch turns every catalogue off');
    check(masterInput.checked === false, 'the master switch reflects “all off”');

    /* ── the premium gate ─────────────────────────────────────────────── */
    let modalOpened = 0;
    sandbox.openPremiumModal = () => { modalOpened++; };
    sandbox._dlIsPremium = () => false;
    api.setSource('gallic-200-300', true);
    check(!api.isActive('gallic-200-300'), 'a free user cannot switch a premium catalogue on');
    check(modalOpened > 0, 'the denied switch opens the membership window');
    check(mapLayers.size === 0, 'nothing is drawn for a free user');
    api.toggleAll(true);
    check(api.sources.every((s) => !api.isActive(s.id)), 'the master switch is premium-gated too');
    api.setGroupOpacity(10);
    check(api.sources.every((s) => !api.isActive(s.id)), 'opacity never switches a premium layer on');
    sandbox._dlIsPremium = () => true;
    api.setSource('gallic-200-300', true);
    check(api.isActive('gallic-200-300'), 'a premium member can switch the catalogue on');
    api.setSource('gallic-200-300', false);
    check(!api.isActive('gallic-200-300'), 'switching OFF is always allowed');

    /* A lapsed plan must not leave premium catalogues drawing. */
    api.toggleAll(true);
    check(api.sources.every((s) => api.isActive(s.id)), 'every catalogue is on for the member');
    sandbox._dlIsPremium = () => false;
    sandbox.fireWindow('detectlab:authchange');
    check(api.sources.every((s) => !api.isActive(s.id)),
        'signing out switches every premium catalogue off');
    check(mapLayers.size === 0, 'signing out leaves no hoard layer on the map');
    sandbox._dlIsPremium = () => true;

    /* ── the language switch rebuilds the rows, never the state ───────── */
    api.setSource('carolingian-769-814', true);
    check(!!document.getElementById('hoardsLayer-carolingian-769-814'),
        'the row exists before the language switch');
    document.dispatch('detectlab:langchange');
    check(api.isActive('carolingian-769-814'), 'a language switch keeps the switches as they were');
    check(mount.children.length === 7, 'a language switch rebuilds exactly seven rows');

    /* ── collapsing keeps the group usable ────────────────────────────── */
    api.setExpanded(false, true);
    check(mount.style.maxHeight === '0px', 'collapsing hides the catalogue column');
    api.setExpanded(true, true);
    check(mount.style.maxHeight === 'none', 'expanding releases the height ceiling');

    finish();
})().catch((err) => {
    console.error(err);
    process.exit(1);
});

function finish() {
    /* ══════════════════════════════════════════════════════════════════════
     * 4. TRANSLATIONS + PREMIUM WIRING + CACHE-BUSTING
     * ══════════════════════════════════════════════════════════════════════ */

    const dictLangs = (translationsSource.match(/^            [a-z]{2}: \{/gm) || []).length;
    check(dictLangs === 25, 'the translation file still holds exactly 25 dictionaries');
    const hoards = (translationsSource.match(/layer_hoards: '/g) || []).length;
    check(hoards === 25, 'layer_hoards exists in all 25 menu languages');

    check(/js\/hoards-layers\.js\?v=20261106-hoards/.test(sw),
        'sw.js pre-caches the hoards module with the same version index.html requests');
    check(/css\/styles\.css\?v=20261106-hoards/.test(sw) &&
          /css\/styles\.css\?v=20261106-hoards/.test(html),
        'index.html and sw.js agree on the stylesheet version');
    check(/const CACHE_NAME = 'detectlab-v\d+-/.test(sw) &&
        Number((sw.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1]) >= 411,
        'the app-shell cache is bumped for the release (v411 or newer)');
    check(/js\/subscriptions\.js\?v=20261106-hoards/.test(html) &&
          /js\/subscriptions\.js\?v=20261106-hoards/.test(sw),
        'index.html and sw.js agree on the versioned subscription module');
    check(/\n\s*'toggleHoardsLayers',/.test(read('js/subscriptions.js')),
        'the master switch is wrapped by the premium gate in js/subscriptions.js');

    console.log('OK — ' + checks + ' checks: premium Hoards group, 7 DARMC catalogues, all countries.');
}

/* The async chain above ends in finish(); a stray rejection must fail the run. */
process.on('unhandledRejection', (err) => {
    console.error(err);
    process.exit(1);
});
