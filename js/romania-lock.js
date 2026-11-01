/* DetectLab — Romania-only view lock.
 *
 * Replaces the retired country-selection UI: the 3D globe gate
 * (js/globe-arcgis-gate.js + js/globe-country-picker.js) and the country
 * dock / "Exit view" (js/country-dock.js) are gone. There is no country
 * picker and no country list any more — the app is Romania only, and the
 * flat 2D Leaflet view is locked to Romania's bounds (panning is clamped
 * with maxBoundsViscosity 1 and the zoom floor sits just under the fitted
 * zoom, so the user cannot wander off).
 *
 * This module also keeps the Esri World Hillshade overlay that used to be
 * owned by the country dock (window.toggleWorldHillshade), because the
 * ArcGIS basemap control still exposes that checkbox.
 */
(function () {
    'use strict';
    if (!window || !document) return;

    /* ── Romania bounds [[south, west], [north, east]] — the same APM box
       js/map-app.js uses for the initial view. ── */
    var RO_BOUNDS = [
        [42.8657855276803872, 19.9018464511967004],
        [49.0024961993941517, 30.6713880698685237]
    ];
    // Bounds in the [west, south, east, north] order the rest of the app
    // expects on window._detectlabCountryBounds.
    var RO_BOUNDS_WSEN = [RO_BOUNDS[0][1], RO_BOUNDS[0][0], RO_BOUNDS[1][1], RO_BOUNDS[1][0]];

    var LOCK_PAD = 0.15;        // degrees of slack around the country bbox
    var LOCK_ZOOM_SLACK = 1;    // zoom levels below the fit the user may reach
    var FIT_MAX_ZOOM = 11;      // never dive past this on the initial fit
    var FIT_PADDING = 24;       // px padding for the initial fitBounds

    /* ── Esri World Hillshade overlay (ported from the old country dock) ── */
    var HS_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}';
    var HS_ATTRIBUTION = 'World Hillshade &copy; Esri, USGS, NOAA';
    var HS_PANE = 'pane_world_hillshade';
    var HS_PANE_Z = '400';
    var HS_OPACITY = 0.5;
    var HS_MAX_NATIVE_ZOOM = 16;
    var HS_STORAGE_KEY = 'detectlab_world_hillshade_v1';

    var state = {
        map: null,
        baseMinZoom: null,
        baseMaxZoom: null,
        hillshadeLayer: null,
        hillshadeOn: false
    };

    function safeGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function safeSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }

    // Romania is the only country: publish the same globals the old picker
    // wrote, so the search bar, layer filtering and the rest of map-app.js
    // keep behaving exactly as they did for a selected RO.
    window._detectlabSelectedCountry = 'RO';
    window._detectlabSelectedCountryName = 'Romania';
    window._detectlabCountryBounds = RO_BOUNDS_WSEN;

    function countryFitZoom(map, bounds) {
        var fit = FIT_MAX_ZOOM;
        try {
            if (map && typeof map.getBoundsZoom === 'function') {
                var z = map.getBoundsZoom(bounds, false, [FIT_PADDING, FIT_PADDING]);
                if (typeof z === 'number' && isFinite(z)) fit = Math.min(FIT_MAX_ZOOM, z);
            }
        } catch (e) {}
        return fit;
    }

    function lockToRomania(map) {
        if (!map || !window.L) return;
        try {
            if (typeof state.baseMinZoom !== 'number') state.baseMinZoom = map.getMinZoom();
            if (typeof state.baseMaxZoom !== 'number' && typeof map.getMaxZoom === 'function') state.baseMaxZoom = map.getMaxZoom();

            var bounds = L.latLngBounds(RO_BOUNDS);
            if (typeof map.stop === 'function') map.stop();
            // Fit outside any previous zoom floor, then clamp.
            if (typeof state.baseMinZoom === 'number') map.setMinZoom(state.baseMinZoom);
            if (typeof state.baseMaxZoom === 'number' && typeof map.setMaxZoom === 'function') map.setMaxZoom(state.baseMaxZoom);
            var fitZoom = countryFitZoom(map, bounds);
            map.fitBounds(bounds, { padding: [FIT_PADDING, FIT_PADDING], maxZoom: fitZoom, animate: false });

            map.options.maxBoundsViscosity = 1;
            map.setMaxBounds(bounds.pad(LOCK_PAD));
            map.setMinZoom(Math.max(state.baseMinZoom, fitZoom - LOCK_ZOOM_SLACK));
            if (typeof state.baseMaxZoom === 'number' && typeof map.setMaxZoom === 'function') map.setMaxZoom(state.baseMaxZoom);
        } catch (e) {
            console.warn('[DetectLab] Romania lock: could not restrict the map view to Romania', e);
        }
    }

    /* ══ World hillshade overlay (never touches the basemap itself) ══ */
    function ensureHillshadeLayer() {
        if (state.hillshadeLayer) return state.hillshadeLayer;
        if (!window.L || typeof window.L.tileLayer !== 'function') return null;
        var map = state.map;
        if (!map) return null;
        try {
            if (typeof map.getPane === 'function' && !map.getPane(HS_PANE) && typeof map.createPane === 'function') {
                map.createPane(HS_PANE);
            }
            var pane = (typeof map.getPane === 'function') ? map.getPane(HS_PANE) : null;
            if (pane && pane.style) pane.style.zIndex = HS_PANE_Z;
            state.hillshadeLayer = window.L.tileLayer(HS_URL, {
                pane: HS_PANE,
                opacity: HS_OPACITY,
                minZoom: 1,
                maxZoom: 20,
                maxNativeZoom: HS_MAX_NATIVE_ZOOM,
                attribution: HS_ATTRIBUTION,
                crossOrigin: false
            });
        } catch (e) {
            console.warn('[DetectLab] Romania lock: world hillshade layer unavailable', e);
            return null;
        }
        return state.hillshadeLayer;
    }

    function setHillshade(on, opts) {
        var map = state.map;
        var layer = on ? ensureHillshadeLayer() : state.hillshadeLayer;
        state.hillshadeOn = !!on;
        if (layer && map) {
            try {
                if (on && !map.hasLayer(layer)) layer.addTo(map);
                else if (!on && map.hasLayer(layer)) map.removeLayer(layer);
            } catch (e) {
                console.warn('[DetectLab] Romania lock: could not toggle world hillshade', e);
            }
        }
        if (!opts || opts.persist !== false) safeSet(HS_STORAGE_KEY, on ? '1' : '0');
        return !!(on && layer);
    }
    window.toggleWorldHillshade = setHillshade;

    window.DetectLabRomaniaLock = {
        RO_BOUNDS: RO_BOUNDS,
        attach: function (map) {
            state.map = map;
            lockToRomania(map);
            // Announce the (fixed) selection so any listener — e.g. the
            // locality preload in map-app.js — sees the same event the old
            // globe gate dispatched.
            try {
                document.dispatchEvent(new CustomEvent('detectlab:country-selected', {
                    detail: { iso: 'RO', name: 'Romania', bounds: RO_BOUNDS_WSEN }
                }));
            } catch (e) {}
            // filterLayersForCountry() is defined later in map-app.js's
            // synchronous init, so defer the RO layer-window filter.
            setTimeout(function () {
                try {
                    if (typeof window.filterLayersForCountry === 'function') window.filterLayersForCountry('RO');
                } catch (e) {}
                // Restore a persisted hillshade preference.
                try { if (safeGet(HS_STORAGE_KEY) === '1') setHillshade(true, { persist: false }); } catch (e) {}
            }, 0);
        },
        isLocked: function () { return true; },
        isHillshadeOn: function () { return !!(state.hillshadeLayer && state.hillshadeOn); }
    };
})();
