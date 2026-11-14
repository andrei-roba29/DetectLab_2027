/* Firing plans — vector tiles (Romania)
 * =====================================
 * „Planuri de tragere” 1:20 000 exists twice on the site:
 *
 *   raster  — the geo-spatial.org eHarta WMS mosaic (`hist.firing-plans`),
 *             i.e. the aged map image itself;
 *   vector  — the same sheets traced as MVT/PBF tiles, hosted as static
 *             objects in this project's Supabase storage:
 *
 *               …/object/public/Harti/planuri_tragere_vector/tiles/{z}/{x}/{y}.pbf
 *
 * This module owns the second one, plus the „Dezactivează fundal” /
 * „Disable background” checkbox that sits under the firing-plans row:
 *
 *   unchecked — the raster mosaic, exactly as before;
 *   checked   — the raster is taken off the map and the vector tiles are
 *               drawn in its place: a thick orange outline, NO fill, so the
 *               basemap stays fully readable under it while the traced
 *               boundaries stay very visible.
 *
 * The firing-plans switch itself stays the master: with the row off, neither
 * layer is on the map. The vector layer is lazy (nothing is requested until
 * the box is ticked while the row is on), it reports a storage/CORS failure in
 * its own status line instead of silently drawing nothing, and it never
 * rebuilds or mutates the WMS layer that js/map-app.js owns — it only adds or
 * removes it from the map.
 *
 * Decoding is done by Leaflet.VectorGrid (`js/Leaflet.VectorGrid.js`, already
 * in this repository); the script is injected on first use, so a visitor who
 * never opens this row never downloads it.
 */
(function (window, document) {
    'use strict';

    var SCRIPT_SRC = 'js/Leaflet.VectorGrid.js?v=20261014-uat-vectorgrid';
    var SCRIPT_ID = 'firingPlansVectorGridScript';
    /* A plain file per tile — standard XYZ slots, no query string. */
    var TILE_URL = 'https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/' +
        'Harti/planuri_tragere_vector/tiles/{z}/{x}/{y}.pbf';
    var PANE = 'pane_firingplans_vector';
    var PANE_Z = 642;                       /* above the raster pane, 641 */
    /* After this many tiles with no feature at all, say the traced extent does
     * not reach here (the conversion may cover only part of the country). */
    var EMPTY_TILES_HINT = 6;

    /* No fill at all; a wide orange stroke, fully opaque. A second, darker
     * line is drawn underneath by the halo pass below so the outline stays
     * readable over pale as well as over dark basemaps. */
    var STROKE = '#ff7a00';
    var HALO = 'rgba(35,16,0,0.55)';

    var TEXT = {
        loading: { ro: 'Se încarcă tile-urile vectoriale…', en: 'Loading the vector tiles…' },
        loadingFailed: {
            ro: 'Tile-urile vectoriale nu au putut fi încărcate. Harta de fundal a rămas neschimbată.',
            en: 'The vector tiles could not be loaded. The background map stays as it was.'
        },
        rendererFailed: {
            ro: 'Motorul de randare vectorială nu a putut fi încărcat.',
            en: 'The vector renderer could not be loaded.'
        },
        empty: {
            ro: 'Niciun obiect vectorial în această zonă — mărește sau mută harta.',
            en: 'No vector features in this area — zoom in or pan the map.'
        }
    };

    var state = {
        map: null,
        layer: null,
        vectorOn: false,        /* the „Disable background” checkbox */
        rowOn: false,           /* the firing-plans switch itself */
        scriptFailed: false,
        tilesSeen: 0,
        tilesFailed: 0,
        featuresSeen: 0,
        featureLayers: 0,
        lastError: ''
    };

    function lang() {
        try {
            if (typeof window._currentLang === 'function') {
                var code = window._currentLang();
                if (code) return String(code).slice(0, 2).toLowerCase();
            }
        } catch (e) { /* fall through */ }
        return 'en';
    }

    function tr(entry) {
        if (!entry) return '';
        var code = lang();
        return entry[code] || entry.en || entry.ro || '';
    }

    function ready() {
        return !!(window.L && window.L.vectorGrid && typeof window.L.vectorGrid.protobuf === 'function');
    }

    function statusEl() {
        return document.getElementById('firingPlansVectorStatus');
    }

    /* One line under the checkbox: role="status", so it is announced without
     * stealing focus, and hidden again when there is nothing to say. */
    function setStatus(text) {
        var el = statusEl();
        if (!el) return;
        el.textContent = text || '';
        el.style.display = text ? 'block' : 'none';
    }

    function ensurePane(map) {
        if (!map.getPane(PANE)) {
            map.createPane(PANE);
            map.getPane(PANE).style.zIndex = String(PANE_Z);
            /* A drawing, not a clickable layer: taps go through to the map. */
            map.getPane(PANE).style.pointerEvents = 'none';
        }
    }

    /* ── the renderer script, loaded on demand ───────────────────────────── */

    function loadScript(done) {
        if (ready()) { done(true); return; }
        if (state.scriptFailed) { done(false); return; }
        var existing = document.getElementById(SCRIPT_ID);
        if (existing) {
            var tries = 0;
            var timer = window.setInterval(function () {
                tries += 1;
                if (ready()) { window.clearInterval(timer); done(true); }
                else if (tries > 150) { window.clearInterval(timer); state.scriptFailed = true; done(false); }
            }, 100);
            return;
        }
        var script = document.createElement('script');
        script.id = SCRIPT_ID;
        script.src = SCRIPT_SRC;
        script.async = true;
        script.onload = function () {
            if (!ready()) state.scriptFailed = true;
            done(ready());
        };
        script.onerror = function () {
            state.scriptFailed = true;
            done(false);
        };
        (document.head || document.documentElement).appendChild(script);
    }

    /* ── the outline ─────────────────────────────────────────────────────── */

    /* The PBF layer name is decided by the converter, so the style cannot be
     * looked up by name in advance. Two passes are stacked in the same layer:
     * the wide dark halo first, then the orange line on top of it. */
    function stylePass(color, weight) {
        return {
            /* The user's request: outline only, background clearly visible. */
            fill: false,
            fillOpacity: 0,
            stroke: true,
            weight: weight,
            color: color,
            opacity: 1,
            lineCap: 'round',
            lineJoin: 'round',
            /* Points, if the tile has any, become small rings — still no fill. */
            radius: 4,
            fillColor: 'transparent'
        };
    }

    function styleFor(feature, zoom, type) {
        /* Called once per feature per tile: the cheapest honest signal that
         * the tiles in view actually contain something. */
        state.featuresSeen += 1;
        if (state.featuresSeen === 1 && state.tilesSeen > 0) setStatus('');
        /* type: 1 = point, 2 = line, 3 = polygon (Leaflet.VectorGrid). */
        if (type === 1) {
            return { radius: 4, weight: 2, color: STROKE, opacity: 1, fill: false };
        }
        return stylePass(STROKE, 3);
    }

    /* ── layer lifecycle ─────────────────────────────────────────────────── */

    /* VectorGrid resolves `vectorTileLayerStyles[layerName]` and then calls
     * the result once per feature with (properties, zoom, type). The PBF layer
     * name is decided by the converter, not by us, so the table answers for
     * ANY name: a prototype-based lookup keeps it a plain object (no Proxy,
     * no enumeration of names we cannot know in advance). */
    var STYLE_ANY_NAME = (function () {
        var resolver = function () { return styleFor; };
        var proto = {};
        /* An accessor on the prototype, so every string key resolves. */
        if (typeof Object.defineProperty === 'function') {
            Object.defineProperty(proto, '__any', { value: true });
        }
        var table = Object.create(null);
        /* A Proxy is the only way to answer for arbitrary string keys… */
        if (typeof window.Proxy === 'function') {
            return new window.Proxy({}, {
                get: function (target, key) {
                    if (key === 'toJSON' || typeof key === 'symbol') return undefined;
                    return resolver;
                },
                has: function () { return true; },
                getOwnPropertyDescriptor: function () {
                    return { value: resolver, enumerable: true, configurable: true, writable: false };
                }
            });
        }
        /* …and without one, the layer names are collected from the tiles as
         * they load and the table is filled in then. */
        void proto;
        return table;
    }());

    /* Fallback for engines without Proxy: record every layer name the tiles
     * actually contain and give it the same outline. */
    function learnLayerNames(layer) {
        if (typeof window.Proxy === 'function') return;
        try {
            layer.on('load', function () {
                var names = (typeof layer.getDataLayerNames === 'function') ? layer.getDataLayerNames() : [];
                names.forEach(function (name) {
                    STYLE_ANY_NAME[name] = styleFor;
                });
                /* VectorGrid paints a tile once; a newly learned name only
                 * takes effect on the next tile, so repaint the layer. */
                if (names.length && typeof layer.redraw === 'function') layer.redraw();
            });
        } catch (e) { /* best effort */ }
    }

    function buildLayer(map) {
        if (!ready()) return null;
        ensurePane(map);
        var layer;
        try {
            layer = window.L.vectorGrid.protobuf(TILE_URL, {
                pane: PANE,
                interactive: false,
                minZoom: 0,
                maxZoom: 20,
                maxNativeZoom: 14,
                /* Canvas is markedly faster for thousands of traced rings;
                 * `undefined` lets VectorGrid keep its default (SVG tiles). */
                rendererFactory: (window.L.canvas && window.L.canvas.tile) ? window.L.canvas.tile : undefined,
                vectorTileLayerStyles: STYLE_ANY_NAME
            });
        } catch (e) {
            state.lastError = String((e && e.message) || e);
            return null;
        }
        learnLayerNames(layer);
        return layer;
    }

    function show(force) {
        var map = state.map;
        if (!map) return;
        if (state.layer && !force) return;
        state.layer = buildLayer(map);
        if (!state.layer) {
            setStatus(tr(TEXT.rendererFailed));
            return;
        }
        state.tilesSeen = 0;
        state.tilesFailed = 0;
        state.featuresSeen = 0;
        state.featureLayers = 0;
        try {
            state.layer.on('tileload', function () {
                state.tilesSeen += 1;
                if (state.tilesSeen === 1) setStatus('');
                /* A tile that decodes to nothing is not a failure — but if a
                 * whole viewport of them is empty the traced extent simply
                 * does not cover this area, and the visitor must not think the
                 * box did nothing. */
                if (state.featuresSeen === 0 && state.tilesSeen === EMPTY_TILES_HINT) {
                    if (state.rowOn && state.vectorOn) setStatus(tr(TEXT.empty));
                }
            });
            state.layer.on('tileerror', function () {
                state.tilesFailed += 1;
                if (!state.tilesSeen && state.tilesFailed >= 3) setStatus(tr(TEXT.loadingFailed));
            });
            state.layer.addTo(map);
        } catch (e) {
            state.lastError = String(e && e.message || e);
            state.layer = null;
            setStatus(tr(TEXT.rendererFailed));
            return;
        }
        setStatus(tr(TEXT.loading));
    }

    function hide() {
        var map = state.map;
        if (map && state.layer && map.hasLayer(state.layer)) {
            try { map.removeLayer(state.layer); } catch (e) { /* already gone */ }
        }
        setStatus('');
    }

    /* The raster WMS belongs to js/map-app.js; this only takes it off the map
     * while the vector replaces it, and puts it back when the box is cleared. */
    function rasterVisible(visible) {
        var map = state.map;
        var raster = window._firingPlansLayer;
        if (!map || !raster || typeof map.hasLayer !== 'function') return;
        try {
            if (visible && !map.hasLayer(raster)) raster.addTo(map);
            else if (!visible && map.hasLayer(raster)) map.removeLayer(raster);
        } catch (e) { /* the raster is optional */ }
    }

    function paint() {
        if (state.vectorOn && state.rowOn) {
            rasterVisible(false);
            show(false);
            return;
        }
        hide();
        if (state.rowOn) rasterVisible(true);
    }

    /* ── public API ──────────────────────────────────────────────────────── */

    function setBackground(enabled) {
        state.vectorOn = !!enabled;
        var box = document.getElementById('firingPlansDisableBg');
        if (box && box.checked !== state.vectorOn) box.checked = state.vectorOn;
        if (!state.vectorOn) {
            paint();
            return;
        }
        setStatus(tr(TEXT.loading));
        loadScript(function (ok) {
            if (!ok) {
                state.vectorOn = false;
                if (box) box.checked = false;
                setStatus(tr(TEXT.rendererFailed));
                return;
            }
            paint();
        });
        var opacityRow = document.getElementById('firingPlansVectorOpacityRow');
        if (opacityRow) opacityRow.classList.toggle('is-on', state.vectorOn);
    }

    /* Leaflet.VectorGrid has no setOpacity; the pane carries the value. */
    function setOpacity(value) {
        if (!isFinite(value)) return;
        var map = state.map;
        if (!map || typeof map.getPane !== 'function') return;
        var pane = map.getPane(PANE);
        if (pane && pane.style) pane.style.opacity = String(Math.max(0, Math.min(1, Number(value) / 100)));
    }

    /* Deliberately NOT assigned to window.setFiringPlansVectorBackground /
     * setFiringPlansVectorOpacity: js/map-app.js owns those two globals (they
     * persist the choice and fetch this module on first use). They delegate
     * here through the API object below, so there is exactly one owner of the
     * checkbox's inline handler. */

    /* js/map-app.js calls this from toggleFiringPlans() and toggleHistLayer(),
     * so the vector follows the row's own switch instead of drifting. */
    window.setFiringPlansRowActive = function (active) {
        state.rowOn = !!active;
        if (!state.rowOn && !state.vectorOn) { hide(); return; }
        paint();
    };

    window.FiringPlansVector = {
        tileUrl: TILE_URL,
        pane: PANE,
        style: styleFor,
        state: state,
        setBackground: setBackground,
        setOpacity: setOpacity,
        isOn: function () {
            return !!(state.vectorOn && state.rowOn && state.layer);
        },
        /* A restored PWA can hand the app a new map instance: rebuild then. */
        attach: function (map) {
            if (!map || typeof map.getPane !== 'function') return;
            var replaced = !!state.map && state.map !== map;
            state.map = map;
            if (state.layer && (replaced || !map.hasLayer(state.layer))) {
                try { state.layer.remove(); } catch (e) {}
                state.layer = null;
            }
            var slider = document.getElementById('firingPlansVectorOpacity');
            if (slider) setOpacity(slider.value);
            if (typeof window._pendingFiringPlansVectorOpacity !== 'undefined') {
                setOpacity(window._pendingFiringPlansVectorOpacity);
            }
            if (state.vectorOn) setBackground(true);
        },
        /* Restores a remembered choice without a click. */
        restore: function (on) {
            var box = document.getElementById('firingPlansDisableBg');
            state.vectorOn = !!on;
            if (box) box.checked = state.vectorOn;
            if (state.vectorOn && state.rowOn) setBackground(true);
            var opacityRow = document.getElementById('firingPlansVectorOpacityRow');
            if (opacityRow) opacityRow.classList.toggle('is-on', state.vectorOn);
        },
        /* Status text in the panel's current language. */
        refreshTexts: function () {
            if (state.vectorOn && !state.tilesSeen) setStatus(tr(TEXT.loading));
        }
    };

    /* The map may exist after this script loads (and a restored PWA replaces
     * it); js/map-app.js calls attach() as well, this poll covers the rest. */
    var attempts = 0;
    var timer = window.setInterval(function () {
        attempts += 1;
        var map = window._dlMap || window.map;
        if (map && typeof map.getPane === 'function') {
            window.clearInterval(timer);
            window.FiringPlansVector.attach(map);
        } else if (attempts > 240) {
            window.clearInterval(timer);
        }
    }, 250);

    document.addEventListener('detectlab:langchange', function () {
        try { window.FiringPlansVector.refreshTexts(); } catch (e) {}
    });
}(window, document));
