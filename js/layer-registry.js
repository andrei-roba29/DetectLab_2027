(function (root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (root) root.DetectLabLayers = api;
}(typeof window !== 'undefined' ? window
    : typeof self !== 'undefined' ? self
        : typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    var VERSION = '2026-10-13-3d-mirror-v1';

    /* ═══════════════════════════════════════════════════════════════════════
     *  3D VIEW DEFAULTS — terrain, hillshade, sky, camera
     *  Overridable from the page (no code edit) with:
     *      window.DETECTLAB_MAP3D = { terrain: { provider: 'maptiler' }, … }
     *  Every URL/key lives here (or in that object), never inline in a view.
     * ═══════════════════════════════════════════════════════════════════════ */
    var TERRAIN_PROVIDERS = {
        /* Default: AWS Open Data “Terrain Tiles” (Tilezen Joerd), Terrarium
         * encoding, 256 px, no key, worldwide, CORS-enabled, z0–z15. */
        'aws-terrarium': {
            label: 'AWS Terrain Tiles (Terrarium)',
            tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
            encoding: 'terrarium',
            tileSize: 256,
            minzoom: 0,
            maxzoom: 15,
            attribution: 'Elevation: AWS Open Data “Terrain Tiles” (Tilezen Joerd — SRTM, GMTED, ETOPO1, NED, EDNA, …)'
        },
        /* Optional: MapTiler Terrain-RGB. Needs a key — set it in
         * window.DETECTLAB_MAP3D.terrain.key (or .maptilerKey); it is never
         * committed to the repository. */
        'maptiler': {
            label: 'MapTiler Terrain-RGB',
            tiles: ['https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key={key}'],
            encoding: 'mapbox',
            tileSize: 512,
            minzoom: 0,
            maxzoom: 12,
            attribution: 'Elevation: MapTiler Terrain-RGB',
            requiresKey: 'terrain.key'
        },
        /* Optional: user-supplied DEM. window.DETECTLAB_MAP3D.terrain.tiles
         * plus (for RGB DEMs) window.DETECTLAB_MAP3D.terrain.encoding. */
        'custom': {
            label: 'Custom DEM (window.DETECTLAB_MAP3D.terrain.tiles)',
            tiles: [],
            encoding: 'terrarium',
            tileSize: 256,
            minzoom: 0,
            maxzoom: 15,
            attribution: 'Elevation: custom source'
        }
    };

    var MAP3D_DEFAULT = {
        /* MapLibre GL JS is vendored (same convention as js/leaflet.js) so the
         * 3D view works offline and without a third-party CDN. Point these at
         * a CDN if you prefer: { maplibre: { js: 'https://…/maplibre-gl.js' } } */
        maplibre: {
            js: 'js/maplibre-gl.js?v=20261019-tile-order',
            css: 'css/maplibre-gl.css?v=20261013-3d-terrain',
            namespace: 'maplibregl',
            timeoutMs: 15000,
            /* The vendored SDK is ~1 MB. A phone on cellular can need several
             * times the desktop's 15 s to pull it down, and a timeout shows up
             * as “3D snapped back to 2D” — not as “slow”. */
            timeoutMsMobile: 45000
        },
        terrain: {
            provider: 'aws-terrarium',   // 'aws-terrarium' | 'maptiler' | 'custom'
            exaggeration: 1.4,           // sensible default: visible relief, not a caricature
            minExaggeration: 0.5,
            maxExaggeration: 4,
            key: '',                     // ← MapTiler key (env/config, never in source)
            tiles: [],                   // ← overrides the provider when non-empty
            encoding: '',                // ← overrides the provider when non-empty
            tileSize: 0
        },
        hillshade: {
            enabled: true,
            mode: 'dem',                 // 'dem' (from the DEM above) | 'service' | 'off'
            opacity: 0.55,
            exaggeration: 1,
            /* 'service' mode draws Esri World Hillshade — the same raster the
             * ArcGIS SceneView atlas page (js/europe-roman-atlas.js) uses. */
            serviceTiles: ['https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}'],
            serviceAttribution: 'Hillshade: Esri World Hillshade',
            serviceMaxzoom: 16
        },
        sky: {
            enabled: true,
            paint: {
                'sky-color': '#0b1c33',
                'sky-horizon-blend': 0.6,
                'horizon-color': '#cfe4f5',
                'horizon-fog-blend': 0.6,
                'fog-color': '#a8c6dd',
                'fog-ground-blend': 0.12,
                'atmosphere-blend': 0.7
            }
        },
        camera: {
            pitch: 62,
            bearing: 0,
            maxPitch: 80,
            minZoom: 2,
            maxZoom: 20,
            /* “reset view” returns to the 2D-looking camera */
            flatPitch: 0
        },
        /* Same-origin proxy used for layers whose host sends no CORS headers
         * and/or cannot answer EPSG:3857 tiles. Netlify function in production
         * (netlify.toml), tools/map3d-dev-server.mjs locally. */
        proxy: {
            base: '/api/map3d/tile',
            enabled: true,               // false = never route through it
            probe: true,                 // probe unknown hosts once per session
            tileCacheSeconds: 86400,
            timeoutMs: 15000,
            /* Hosts a layer may be relayed from (?u=) in addition to the ones
             * this registry and the country LiDAR modules already use. Only a
             * layer of your own needs an entry here — never a private host:
             * loopback/private addresses are refused by the proxy outright. */
            extraHosts: []
        },
        perf: {
            /* Phones: 1 device pixel ratio, fewer DEM tiles, shorter tile life */
            mobilePixelRatio: 1,
            mobileMaxTerrainZoom: 12,
            /* The tile cache is measured in *decoded* tiles: 320 × 256 px RGBA
             * is ~80 MB of texture memory on top of the WebGL framebuffers.
             * That is exactly the pressure that makes iOS Safari refuse the GL
             * context (canvas.getContext('webgl2') → null), so phones keep a
             * much smaller cache. */
            mobileMaxTileCacheSize: 64,
            /* WebKit caps the drawing buffer it will allocate. The 4096²
             * desktop ceiling at devicePixelRatio 3 is far past what an iPhone
             * grants, so the phone ceiling is lowered before the very first
             * context is requested (not after it already failed). */
            mobileMaxCanvas: [2048, 2048],
            fadeDuration: 120,
            maxTileCacheSize: 320
        },
        /* Analysis/interactive layers that are NOT draped rasters stay in 2D.
         * Listed in the diagnostics report with the reason. */
        adaptive: true
    };

    function isPlainObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }
    function deepMerge(base, extra) {
        var out = {}, key;
        for (key in base) if (Object.prototype.hasOwnProperty.call(base, key)) out[key] = base[key];
        if (!isPlainObject(extra)) return out;
        for (key in extra) {
            if (!Object.prototype.hasOwnProperty.call(extra, key)) continue;
            out[key] = isPlainObject(out[key]) && isPlainObject(extra[key])
                ? deepMerge(out[key], extra[key]) : extra[key];
        }
        return out;
    }
    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function config() {
        var overrides = null;
        try { overrides = root && root.DETECTLAB_MAP3D; } catch (e) { overrides = null; }
        return deepMerge(MAP3D_DEFAULT, isPlainObject(overrides) ? overrides : {});
    }

    /* Resolved terrain provider: preset + overrides + key substitution. */
    function terrainSource() {
        var cfg = config();
        var t = cfg.terrain || {};
        var preset = TERRAIN_PROVIDERS[t.provider] || TERRAIN_PROVIDERS['aws-terrarium'];
        var tiles = (t.tiles && t.tiles.length ? t.tiles : preset.tiles).slice();
        var encoding = t.encoding || preset.encoding;
        var tileSize = t.tileSize || preset.tileSize;
        var key = t.key || t.maptilerKey || '';
        tiles = tiles.map(function (template) {
            return String(template).replace(/\{key\}/g, encodeURIComponent(key));
        });
        return {
            id: 'detectlab-dem',
            provider: t.provider || 'aws-terrarium',
            label: preset.label,
            tiles: tiles,
            encoding: encoding,
            tileSize: tileSize,
            minzoom: preset.minzoom,
            maxzoom: preset.maxzoom,
            attribution: (t.attribution || preset.attribution || ''),
            requiresKey: preset.requiresKey || null,
            missingKey: !!(preset.requiresKey && !key)
        };
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *  GROUPS — draw order and panel grouping. `z` mirrors the Leaflet pane
     *  z-index used today, so carrying the layer set into 3D preserves order.
     * ═══════════════════════════════════════════════════════════════════════ */
    var GROUPS = {
        'base': { label: {
            "en": "Base maps",
            "ro": "Hărți de bază",
            "de": "Base maps",
            "fr": "Base maps",
            "it": "Base maps",
            "es": "Base maps",
            "pl": "Base maps",
            "uk": "Base maps",
            "hu": "Base maps",
            "cs": "Base maps",
            "sk": "Base maps",
            "nl": "Base maps",
            "bg": "Base maps",
            "el": "Base maps",
            "pt": "Base maps",
            "da": "Base maps",
            "sv": "Base maps",
            "no": "Base maps",
            "fi": "Base maps",
            "et": "Base maps",
            "lv": "Base maps",
            "lt": "Base maps",
            "hr": "Base maps",
            "sr": "Base maps",
            "sl": "Base maps",
            "ru": "Base maps",
            "sq": "Base maps"
        }, z: 100, base: true },
        'sat-hist': { label: {
            "en": "Historical satellite (Copernicus)",
            "ro": "Satelit istoric (Copernicus)",
            "de": "Historical satellite (Copernicus)",
            "fr": "Historical satellite (Copernicus)",
            "it": "Historical satellite (Copernicus)",
            "es": "Historical satellite (Copernicus)",
            "pl": "Historical satellite (Copernicus)",
            "uk": "Historical satellite (Copernicus)",
            "hu": "Historical satellite (Copernicus)",
            "cs": "Historical satellite (Copernicus)",
            "sk": "Historical satellite (Copernicus)",
            "nl": "Historical satellite (Copernicus)",
            "bg": "Historical satellite (Copernicus)",
            "el": "Historical satellite (Copernicus)",
            "pt": "Historical satellite (Copernicus)",
            "da": "Historical satellite (Copernicus)",
            "sv": "Historical satellite (Copernicus)",
            "no": "Historical satellite (Copernicus)",
            "fi": "Historical satellite (Copernicus)",
            "et": "Historical satellite (Copernicus)",
            "lv": "Historical satellite (Copernicus)",
            "lt": "Historical satellite (Copernicus)",
            "hr": "Historical satellite (Copernicus)",
            "sr": "Historical satellite (Copernicus)",
            "sl": "Historical satellite (Copernicus)",
            "ru": "Historical satellite (Copernicus)",
            "sq": "Historical satellite (Copernicus)"
        }, z: 400 },
        'uat': { label: {
            "en": "UAT",
            "ro": "UAT",
            "de": "UAT",
            "fr": "UAT",
            "it": "UAT",
            "es": "UAT",
            "pl": "UAT",
            "uk": "UAT",
            "hu": "UAT",
            "cs": "UAT",
            "sk": "UAT",
            "nl": "UAT",
            "bg": "UAT",
            "el": "UAT",
            "pt": "UAT",
            "da": "UAT",
            "sv": "UAT",
            "no": "UAT",
            "fi": "UAT",
            "et": "UAT",
            "lv": "UAT",
            "lt": "UAT",
            "hr": "UAT",
            "sr": "UAT",
            "sl": "UAT",
            "ru": "UAT",
            "sq": "UAT"
        }, z: 402 },
        'lidar': { label: {
            "en": "LiDAR / relief",
            "ro": "LiDAR / relief",
            "de": "LiDAR / relief",
            "fr": "LiDAR / relief",
            "it": "LiDAR / relief",
            "es": "LiDAR / relief",
            "pl": "LiDAR / relief",
            "uk": "LiDAR / relief",
            "hu": "LiDAR / relief",
            "cs": "LiDAR / relief",
            "sk": "LiDAR / relief",
            "nl": "LiDAR / relief",
            "bg": "LiDAR / relief",
            "el": "LiDAR / relief",
            "pt": "LiDAR / relief",
            "da": "LiDAR / relief",
            "sv": "LiDAR / relief",
            "no": "LiDAR / relief",
            "fi": "LiDAR / relief",
            "et": "LiDAR / relief",
            "lv": "LiDAR / relief",
            "lt": "LiDAR / relief",
            "hr": "LiDAR / relief",
            "sr": "LiDAR / relief",
            "sl": "LiDAR / relief",
            "ru": "LiDAR / relief",
            "sq": "LiDAR / relief"
        }, z: 610 },
        'vegfp': { label: {
            "en": "Vegetation (WMTS)",
            "ro": "Vegetație (WMTS)",
            "de": "Vegetation (WMTS)",
            "fr": "Vegetation (WMTS)",
            "it": "Vegetation (WMTS)",
            "es": "Vegetation (WMTS)",
            "pl": "Vegetation (WMTS)",
            "uk": "Vegetation (WMTS)",
            "hu": "Vegetation (WMTS)",
            "cs": "Vegetation (WMTS)",
            "sk": "Vegetation (WMTS)",
            "nl": "Vegetation (WMTS)",
            "bg": "Vegetation (WMTS)",
            "el": "Vegetation (WMTS)",
            "pt": "Vegetation (WMTS)",
            "da": "Vegetation (WMTS)",
            "sv": "Vegetation (WMTS)",
            "no": "Vegetation (WMTS)",
            "fi": "Vegetation (WMTS)",
            "et": "Vegetation (WMTS)",
            "lv": "Vegetation (WMTS)",
            "lt": "Vegetation (WMTS)",
            "hr": "Vegetation (WMTS)",
            "sr": "Vegetation (WMTS)",
            "sl": "Vegetation (WMTS)",
            "ru": "Vegetation (WMTS)",
            "sq": "Vegetation (WMTS)"
        }, z: 612 },
        'patrimoniu': { label: {
            "en": "Heritage",
            "ro": "Patrimoniu",
            "de": "Kulturerbe",
            "fr": "Patrimoine",
            "it": "Patrimonio",
            "es": "Patrimonio",
            "pl": "Dziedzictwo",
            "uk": "Спадщина",
            "hu": "Örökség",
            "cs": "Dědictví",
            "sk": "Dedičstvo",
            "nl": "Erfgoed",
            "bg": "Наследство",
            "el": "Heritage",
            "pt": "Património",
            "da": "Kulturarv",
            "sv": "Kulturarv",
            "no": "Kulturarv",
            "fi": "Perintö",
            "et": "Pärand",
            "lv": "Mantojums",
            "lt": "Paveldas",
            "hr": "Baština",
            "sr": "Baština",
            "sl": "Dediščina",
            "ru": "Наследие",
            "sq": "Heritage"
        }, z: 620 },
        'hist-free': { label: {
            "en": "Historical maps",
            "ro": "Hărți istorice",
            "de": "Historische Karten",
            "fr": "Cartes historiques",
            "it": "Mappe storiche",
            "es": "Mapas históricos",
            "pl": "Mapy historyczne",
            "uk": "Історичні карти",
            "hu": "Történelmi térképek",
            "cs": "Historické mapy",
            "sk": "Historické mapy",
            "nl": "Historische kaarten",
            "bg": "Исторически карти",
            "el": "Ιστορικοί χάρτες",
            "pt": "Mapas históricos",
            "da": "Historiske kort",
            "sv": "Historiska kartor",
            "no": "Historiske kart",
            "fi": "Historialliset kartat",
            "et": "Ajaloolised kaardid",
            "lv": "Vēsturiskās kartes",
            "lt": "Istoriniai žemėlapiai",
            "hr": "Povijesne karte",
            "sr": "Историјске карте",
            "sl": "Zgodovinski zemljevidi",
            "ru": "Исторические карты",
            "sq": "Historical maps"
        }, z: 640 },
        'apm': { label: {
            "en": "APM (analysis)",
            "ro": "APM (analiză)",
            "de": "APM (analysis)",
            "fr": "APM (analysis)",
            "it": "APM (analysis)",
            "es": "APM (analysis)",
            "pl": "APM (analysis)",
            "uk": "APM (analysis)",
            "hu": "APM (analysis)",
            "cs": "APM (analysis)",
            "sk": "APM (analysis)",
            "nl": "APM (analysis)",
            "bg": "APM (analysis)",
            "el": "APM (analysis)",
            "pt": "APM (analysis)",
            "da": "APM (analysis)",
            "sv": "APM (analysis)",
            "no": "APM (analysis)",
            "fi": "APM (analysis)",
            "et": "APM (analysis)",
            "lv": "APM (analysis)",
            "lt": "APM (analysis)",
            "hr": "APM (analysis)",
            "sr": "APM (analysis)",
            "sl": "APM (analysis)",
            "ru": "APM (analysis)",
            "sq": "APM (analysis)"
        }, z: 645 },
        'hist-sat': { label: {
            "en": "Satellite 60s (CORONA)",
            "ro": "Satelit 60s (CORONA)",
            "de": "Satellite 60s (CORONA)",
            "fr": "Satellite 60s (CORONA)",
            "it": "Satellite 60s (CORONA)",
            "es": "Satellite 60s (CORONA)",
            "pl": "Satellite 60s (CORONA)",
            "uk": "Satellite 60s (CORONA)",
            "hu": "Satellite 60s (CORONA)",
            "cs": "Satellite 60s (CORONA)",
            "sk": "Satellite 60s (CORONA)",
            "nl": "Satellite 60s (CORONA)",
            "bg": "Satellite 60s (CORONA)",
            "el": "Satellite 60s (CORONA)",
            "pt": "Satellite 60s (CORONA)",
            "da": "Satellite 60s (CORONA)",
            "sv": "Satellite 60s (CORONA)",
            "no": "Satellite 60s (CORONA)",
            "fi": "Satellite 60s (CORONA)",
            "et": "Satellite 60s (CORONA)",
            "lv": "Satellite 60s (CORONA)",
            "lt": "Satellite 60s (CORONA)",
            "hr": "Satellite 60s (CORONA)",
            "sr": "Satellite 60s (CORONA)",
            "sl": "Satellite 60s (CORONA)",
            "ru": "Satellite 60s (CORONA)",
            "sq": "Satellite 60s (CORONA)"
        }, z: 648 },
        'hist-premium': { label: {
            "en": "Historical maps",
            "ro": "Hărți istorice",
            "de": "Historische Karten",
            "fr": "Cartes historiques",
            "it": "Mappe storiche",
            "es": "Mapas históricos",
            "pl": "Mapy historyczne",
            "uk": "Історичні карти",
            "hu": "Történelmi térképek",
            "cs": "Historické mapy",
            "sk": "Historické mapy",
            "nl": "Historische kaarten",
            "bg": "Исторически карти",
            "el": "Ιστορικοί χάρτες",
            "pt": "Mapas históricos",
            "da": "Historiske kort",
            "sv": "Historiska kartor",
            "no": "Historiske kart",
            "fi": "Historialliset kartat",
            "et": "Ajaloolised kaardid",
            "lv": "Vēsturiskās kartes",
            "lt": "Istoriniai žemėlapiai",
            "hr": "Povijesne karte",
            "sr": "Историјске карте",
            "sl": "Zgodovinski zemljevidi",
            "ru": "Исторические карты",
            "sq": "Historical maps"
        }, z: 654 },
        'image-overlay': { label: {
            "en": "Image overlays",
            "ro": "Suprapuneri imagine",
            "de": "Image overlays",
            "fr": "Image overlays",
            "it": "Image overlays",
            "es": "Image overlays",
            "pl": "Image overlays",
            "uk": "Image overlays",
            "hu": "Image overlays",
            "cs": "Image overlays",
            "sk": "Image overlays",
            "nl": "Image overlays",
            "bg": "Image overlays",
            "el": "Image overlays",
            "pt": "Image overlays",
            "da": "Image overlays",
            "sv": "Image overlays",
            "no": "Image overlays",
            "fi": "Image overlays",
            "et": "Image overlays",
            "lv": "Image overlays",
            "lt": "Image overlays",
            "hr": "Image overlays",
            "sr": "Image overlays",
            "sl": "Image overlays",
            "ru": "Image overlays",
            "sq": "Image overlays"
        }, z: 630 },
        /* The Danish layers (Denmark) — described in js/danish-layers.config.js
         * and drawn by js/danish-layers.js. The panes themselves are created by
         * that module (base 399, raster overlay 406, vectors 408), just above
         * the app's own basemap stack on pane_satellite (398), so every existing
         * data pane keeps painting over the Danish ones. */
        'danish-base': { label: {
            "en": "Denmark · base maps",
            "ro": "Danemarca · hărți de bază",
            "de": "Denmark · base maps",
            "fr": "Denmark · base maps",
            "it": "Denmark · base maps",
            "es": "Denmark · base maps",
            "pl": "Denmark · base maps",
            "uk": "Denmark · base maps",
            "hu": "Denmark · base maps",
            "cs": "Denmark · base maps",
            "sk": "Denmark · base maps",
            "nl": "Denmark · base maps",
            "bg": "Denmark · base maps",
            "el": "Denmark · base maps",
            "pt": "Denmark · base maps",
            "da": "Denmark · base maps",
            "sv": "Denmark · base maps",
            "no": "Denmark · base maps",
            "fi": "Denmark · base maps",
            "et": "Denmark · base maps",
            "lv": "Denmark · base maps",
            "lt": "Denmark · base maps",
            "hr": "Denmark · base maps",
            "sr": "Denmark · base maps",
            "sl": "Denmark · base maps",
            "ru": "Denmark · base maps",
            "sq": "Denmark · base maps"
        }, z: 399, base: true },
        'danish-overlay': { label: {
            "en": "Denmark · overlays",
            "ro": "Danemarca · tematice",
            "de": "Denmark · overlays",
            "fr": "Denmark · overlays",
            "it": "Denmark · overlays",
            "es": "Denmark · overlays",
            "pl": "Denmark · overlays",
            "uk": "Denmark · overlays",
            "hu": "Denmark · overlays",
            "cs": "Denmark · overlays",
            "sk": "Denmark · overlays",
            "nl": "Denmark · overlays",
            "bg": "Denmark · overlays",
            "el": "Denmark · overlays",
            "pt": "Denmark · overlays",
            "da": "Denmark · overlays",
            "sv": "Denmark · overlays",
            "no": "Denmark · overlays",
            "fi": "Denmark · overlays",
            "et": "Denmark · overlays",
            "lv": "Denmark · overlays",
            "lt": "Denmark · overlays",
            "hr": "Denmark · overlays",
            "sr": "Denmark · overlays",
            "sl": "Denmark · overlays",
            "ru": "Denmark · overlays",
            "sq": "Denmark · overlays"
        }, z: 406 },
        /* The Finnish layers (Finland: MML terrain + cadastral, Museovirasto
         * registers, SYKE, Åland, local conversions) — described in
         * js/finland-layers.config.js and drawn by js/finland-layers.js.
         * The panes themselves are created by that module (rasters — the
         * reprojected TM35FIN canvases, the SYKE/Åland tiles — at 408; the
         * vector overlays — WFS families, MVT cadastral, local GeoJSON — at
         * 409), above the Danish (399/406) stacks. Albania ASIG entries reuse
         * their existing thematic groups (sat-hist, lidar, patrimoniu, hist-free). */
        'finland-raster': { label: {
            "en": "Finland · raster",
            "ro": "Finlanda · raster",
            "de": "Finland · raster",
            "fr": "Finland · raster",
            "it": "Finland · raster",
            "es": "Finland · raster",
            "pl": "Finland · raster",
            "uk": "Finland · raster",
            "hu": "Finland · raster",
            "cs": "Finland · raster",
            "sk": "Finland · raster",
            "nl": "Finland · raster",
            "bg": "Finland · raster",
            "el": "Finland · raster",
            "pt": "Finland · raster",
            "da": "Finland · raster",
            "sv": "Finland · raster",
            "no": "Finland · raster",
            "fi": "Finland · raster",
            "et": "Finland · raster",
            "lv": "Finland · raster",
            "lt": "Finland · raster",
            "hr": "Finland · raster",
            "sr": "Finland · raster",
            "sl": "Finland · raster",
            "ru": "Finland · raster",
            "sq": "Finland · raster"
        }, z: 408 },
        'finland-vector': { label: {
            "en": "Finland · vectors",
            "ro": "Finlanda · vectori",
            "de": "Finland · vectors",
            "fr": "Finland · vectors",
            "it": "Finland · vectors",
            "es": "Finland · vectors",
            "pl": "Finland · vectors",
            "uk": "Finland · vectors",
            "hu": "Finland · vectors",
            "cs": "Finland · vectors",
            "sk": "Finland · vectors",
            "nl": "Finland · vectors",
            "bg": "Finland · vectors",
            "el": "Finland · vectors",
            "pt": "Finland · vectors",
            "da": "Finland · vectors",
            "sv": "Finland · vectors",
            "no": "Finland · vectors",
            "fi": "Finland · vectors",
            "et": "Finland · vectors",
            "lv": "Finland · vectors",
            "lt": "Finland · vectors",
            "hr": "Finland · vectors",
            "sr": "Finland · vectors",
            "sl": "Finland · vectors",
            "ru": "Finland · vectors",
            "sq": "Finland · vectors"
        }, z: 409 },
        /* The two Albania ASIG catalogue sections that have no thematic home in
         * the shared catalogue (the other four reuse sat-hist, lidar, uat and
         * hist-free). Panel placement is still the single Albania group. */
        'asig-env': { label: {
            "en": "Albania · environment",
            "ro": "Albania · mediu",
            "de": "Albania · environment",
            "fr": "Albania · environment",
            "it": "Albania · environment",
            "es": "Albania · environment",
            "pl": "Albania · environment",
            "uk": "Albania · environment",
            "hu": "Albania · environment",
            "cs": "Albania · environment",
            "sk": "Albania · environment",
            "nl": "Albania · environment",
            "bg": "Albania · environment",
            "el": "Albania · environment",
            "pt": "Albania · environment",
            "da": "Albania · environment",
            "sv": "Albania · environment",
            "no": "Albania · environment",
            "fi": "Albania · environment",
            "et": "Albania · environment",
            "lv": "Albania · environment",
            "lt": "Albania · environment",
            "hr": "Albania · environment",
            "sr": "Albania · environment",
            "sl": "Albania · environment",
            "ru": "Albania · environment",
            "sq": "Albania · environment"
        }, z: 618 },
        'asig-plan': { label: {
            "en": "Albania · planning/mining",
            "ro": "Albania · amenajare/minerit",
            "de": "Albania · planning/mining",
            "fr": "Albania · planning/mining",
            "it": "Albania · planning/mining",
            "es": "Albania · planning/mining",
            "pl": "Albania · planning/mining",
            "uk": "Albania · planning/mining",
            "hu": "Albania · planning/mining",
            "cs": "Albania · planning/mining",
            "sk": "Albania · planning/mining",
            "nl": "Albania · planning/mining",
            "bg": "Albania · planning/mining",
            "el": "Albania · planning/mining",
            "pt": "Albania · planning/mining",
            "da": "Albania · planning/mining",
            "sv": "Albania · planning/mining",
            "no": "Albania · planning/mining",
            "fi": "Albania · planning/mining",
            "et": "Albania · planning/mining",
            "lv": "Albania · planning/mining",
            "lt": "Albania · planning/mining",
            "hr": "Albania · planning/mining",
            "sr": "Albania · planning/mining",
            "sl": "Albania · planning/mining",
            "ru": "Albania · planning/mining",
            "sq": "Albania · planning/mining"
        }, z: 646 }
    };

    /* ═══════════════════════════════════════════════════════════════════════
     *  CENAGIS / IH PAN historical-map catalogue
     * ---------------------------------------------------------------------
     * 45 georeferenced sheets served by the IH PAN GeoServer. This table is the
     * single source for BOTH views: js/historical-eu-maps.js builds its
     * MAPS_CATALOG from it (same shape it used to hold inline) and
     * js/map3d-terrain.js builds the 3D raster sources from it.
     * All but two sheets are published as *_3857 (EPSG:3857). The two
     * exceptions (warszawaOKI_2180, rauch_2180) only exist in EPSG:2180 —
     * `reproject: true` routes them through the proxy, which asks the
     * GeoServer for the tile bbox transformed into EPSG:2180.
     * ═══════════════════════════════════════════════════════════════════════ */
    var CENAGIS = {
        /* The IH PAN GeoServer. When that server is down — as it was on
         * 2026-10-13, when every raster GetMap answered 200 with an ECW
         * “Unable to create a valid ImageInputStream” exception body — the
         * whole catalogue can be re-pointed at a mirror / cached copy with
         * one line on the page (before this script loads):
         *
         *     window.DETECTLAB_CENAGIS_WMS = 'https://mirror.example.org/geoserver/ihpan/wms';
         *
         * js/wms-health.js watches that host too, so a mirror is guarded the
         * same way the original service is. See CENAGIS_WMS_HEALTH.md. */
        url: (root && root.DETECTLAB_CENAGIS_WMS) || 'https://pastmaps.cenagis.edu.pl/geoserver/ihpan/wms',
        workspace: 'ihpan',
        version: '1.3.0',
        format: 'image/png',
        transparent: true,
        opacity: 0.80,
        /* GeoServer answers plain <img> tiles without CORS, so every 3D layer
         * from this host starts on the proxy (see MAP_3D_TERRAIN.md §Proxy). */
        cors: 'unknown',
        maps: {
            "wig25k": {
                id: "wig25k", wms_layer: "wig25k_3857",
                title: {
                    "en": "WIG Detailed Map 1:25,000",
                    "ro": "Harta detaliată WIG 1:25 000",
                    "de": "WIG Detailed Map 1:25,000",
                    "fr": "WIG Detailed Map 1:25,000",
                    "it": "WIG Detailed Map 1:25,000",
                    "es": "WIG Detailed Map 1:25,000",
                    "pl": "Mapa szczegółowa WIG 1:25 000",
                    "uk": "WIG Detailed Map 1:25,000",
                    "hu": "WIG Detailed Map 1:25,000",
                    "cs": "WIG Detailed Map 1:25,000",
                    "sk": "WIG Detailed Map 1:25,000",
                    "nl": "WIG Detailed Map 1:25,000",
                    "bg": "WIG Detailed Map 1:25,000",
                    "el": "WIG Detailed Map 1:25,000",
                    "pt": "WIG Detailed Map 1:25,000",
                    "da": "WIG Detailed Map 1:25,000",
                    "sv": "WIG Detailed Map 1:25,000",
                    "no": "WIG Detailed Map 1:25,000",
                    "fi": "WIG Detailed Map 1:25,000",
                    "et": "WIG Detailed Map 1:25,000",
                    "lv": "WIG Detailed Map 1:25,000",
                    "lt": "WIG Detailed Map 1:25,000",
                    "hr": "WIG Detailed Map 1:25,000",
                    "sr": "WIG Detailed Map 1:25,000",
                    "sl": "WIG Detailed Map 1:25,000",
                    "ru": "WIG Detailed Map 1:25,000",
                    "sq": "WIG Detailed Map 1:25,000"
                },
                scale: "1:25 000", years: "1918–1939",
                provider: "Wojskowy Instytut Geograficzny (WIG) / CENAGIS IH PAN",
                bounds: [[49.16, 15.66], [55, 27.33]]
            },
            "wig100k": {
                id: "wig100k", wms_layer: "wig100k_3857",
                title: {
                    "en": "WIG Tactical Map 1:100,000",
                    "ro": "Harta tactică WIG 1:100 000",
                    "de": "WIG Tactical Map 1:100,000",
                    "fr": "WIG Tactical Map 1:100,000",
                    "it": "WIG Tactical Map 1:100,000",
                    "es": "WIG Tactical Map 1:100,000",
                    "pl": "Mapa taktyczna WIG 1:100 000",
                    "uk": "WIG Tactical Map 1:100,000",
                    "hu": "WIG Tactical Map 1:100,000",
                    "cs": "WIG Tactical Map 1:100,000",
                    "sk": "WIG Tactical Map 1:100,000",
                    "nl": "WIG Tactical Map 1:100,000",
                    "bg": "WIG Tactical Map 1:100,000",
                    "el": "WIG Tactical Map 1:100,000",
                    "pt": "WIG Tactical Map 1:100,000",
                    "da": "WIG Tactical Map 1:100,000",
                    "sv": "WIG Tactical Map 1:100,000",
                    "no": "WIG Tactical Map 1:100,000",
                    "fi": "WIG Tactical Map 1:100,000",
                    "et": "WIG Tactical Map 1:100,000",
                    "lv": "WIG Tactical Map 1:100,000",
                    "lt": "WIG Tactical Map 1:100,000",
                    "hr": "WIG Tactical Map 1:100,000",
                    "sr": "WIG Tactical Map 1:100,000",
                    "sl": "WIG Tactical Map 1:100,000",
                    "ru": "WIG Tactical Map 1:100,000",
                    "sq": "WIG Tactical Map 1:100,000"
                },
                scale: "1:100 000", years: "1918–1939",
                provider: "Wojskowy Instytut Geograficzny (WIG) / CENAGIS IH PAN",
                bounds: [[47.75, 12.83], [56, 28.83]]
            },
            "wig300k": {
                id: "wig300k", wms_layer: "wig300k_3857",
                title: {
                    "en": "WIG Operational Map 1:300,000",
                    "ro": "Harta operațională WIG 1:300 000",
                    "de": "WIG Operational Map 1:300,000",
                    "fr": "WIG Operational Map 1:300,000",
                    "it": "WIG Operational Map 1:300,000",
                    "es": "WIG Operational Map 1:300,000",
                    "pl": "Mapa operacyjna WIG 1:300 000",
                    "uk": "WIG Operational Map 1:300,000",
                    "hu": "WIG Operational Map 1:300,000",
                    "cs": "WIG Operational Map 1:300,000",
                    "sk": "WIG Operational Map 1:300,000",
                    "nl": "WIG Operational Map 1:300,000",
                    "bg": "WIG Operational Map 1:300,000",
                    "el": "WIG Operational Map 1:300,000",
                    "pt": "WIG Operational Map 1:300,000",
                    "da": "WIG Operational Map 1:300,000",
                    "sv": "WIG Operational Map 1:300,000",
                    "no": "WIG Operational Map 1:300,000",
                    "fi": "WIG Operational Map 1:300,000",
                    "et": "WIG Operational Map 1:300,000",
                    "lv": "WIG Operational Map 1:300,000",
                    "lt": "WIG Operational Map 1:300,000",
                    "hr": "WIG Operational Map 1:300,000",
                    "sr": "WIG Operational Map 1:300,000",
                    "sl": "WIG Operational Map 1:300,000",
                    "ru": "WIG Operational Map 1:300,000",
                    "sq": "WIG Operational Map 1:300,000"
                },
                scale: "1:300 000", years: "1918–1939",
                provider: "Wojskowy Instytut Geograficzny (WIG) / CENAGIS IH PAN",
                bounds: [[49, 14.33], [55.8, 27.5]]
            },
            "wig500k_1947": {
                id: "wig500k_1947", wms_layer: "wig500k_3857",
                title: {
                    "en": "WIG Poland & Neighboring Countries 1:500,000",
                    "ro": "Harta Poloniei și a țărilor vecine WIG 1:500 000",
                    "de": "WIG Poland & Neighboring Countries 1:500,000",
                    "fr": "WIG Poland & Neighboring Countries 1:500,000",
                    "it": "WIG Poland & Neighboring Countries 1:500,000",
                    "es": "WIG Poland & Neighboring Countries 1:500,000",
                    "pl": "Mapa Polski i Krajów Ościennych WIG 1:500 000",
                    "uk": "WIG Poland & Neighboring Countries 1:500,000",
                    "hu": "WIG Poland & Neighboring Countries 1:500,000",
                    "cs": "WIG Poland & Neighboring Countries 1:500,000",
                    "sk": "WIG Poland & Neighboring Countries 1:500,000",
                    "nl": "WIG Poland & Neighboring Countries 1:500,000",
                    "bg": "WIG Poland & Neighboring Countries 1:500,000",
                    "el": "WIG Poland & Neighboring Countries 1:500,000",
                    "pt": "WIG Poland & Neighboring Countries 1:500,000",
                    "da": "WIG Poland & Neighboring Countries 1:500,000",
                    "sv": "WIG Poland & Neighboring Countries 1:500,000",
                    "no": "WIG Poland & Neighboring Countries 1:500,000",
                    "fi": "WIG Poland & Neighboring Countries 1:500,000",
                    "et": "WIG Poland & Neighboring Countries 1:500,000",
                    "lv": "WIG Poland & Neighboring Countries 1:500,000",
                    "lt": "WIG Poland & Neighboring Countries 1:500,000",
                    "hr": "WIG Poland & Neighboring Countries 1:500,000",
                    "sr": "WIG Poland & Neighboring Countries 1:500,000",
                    "sl": "WIG Poland & Neighboring Countries 1:500,000",
                    "ru": "WIG Poland & Neighboring Countries 1:500,000",
                    "sq": "WIG Poland & Neighboring Countries 1:500,000"
                },
                scale: "1:500 000", years: "1947",
                provider: "Wojskowy Instytut Geograficzny (WIG) / CENAGIS IH PAN",
                bounds: [[49, 13.5], [55, 25.5]]
            },
            "tkkp_126k": {
                id: "tkkp_126k", wms_layer: "TKKP_126k_3857",
                title: {
                    "en": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "ro": "Harta Topografică a Regatului Poloniei 1:126 000",
                    "de": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "fr": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "it": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "es": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "pl": "Topograficzna Karta Królestwa Polskiego 1:126 000",
                    "uk": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "hu": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "cs": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "sk": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "nl": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "bg": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "el": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "pt": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "da": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "sv": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "no": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "fi": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "et": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "lv": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "lt": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "hr": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "sr": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "sl": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "ru": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000",
                    "sq": "Topographic Chart of the Kingdom of Poland (TKKP) 1:126,000"
                },
                scale: "1:126 000", years: "1839–1843",
                provider: "Sztab Kwatermistrzostwa Generalnego WP / CENAGIS IH PAN",
                bounds: [[49.81, 17.27], [55.33, 24.92]]
            },
            "chrzanowski": {
                id: "chrzanowski", wms_layer: "chrzanowski_3857",
                title: {
                    "en": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "ro": "Harta Vechii Polonii (Wojciech Chrzanowski) 1:300 000",
                    "de": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "fr": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "it": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "es": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "pl": "Karta Dawnej Polski 1:300 000 (Wojciech Chrzanowski)",
                    "uk": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "hu": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "cs": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "sk": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "nl": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "bg": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "el": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "pt": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "da": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "sv": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "no": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "fi": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "et": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "lv": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "lt": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "hr": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "sr": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "sl": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "ru": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000",
                    "sq": "Charter of Old Poland (Wojciech Chrzanowski) 1:300,000"
                },
                scale: "1:300 000", years: "1859",
                provider: "Gen. Wojciech Chrzanowski (Paris 1859) / CENAGIS IH PAN",
                bounds: [[45.8, 11.9], [57.1, 38.28]]
            },
            "gaul": {
                id: "gaul", wms_layer: "gaul_3857",
                title: {
                    "en": "Gaul / Raczyński Map 1:125,000",
                    "ro": "Harta Gaula / Raczyńskiego 1:125 000",
                    "de": "Gaul / Raczyński Map 1:125,000",
                    "fr": "Gaul / Raczyński Map 1:125,000",
                    "it": "Gaul / Raczyński Map 1:125,000",
                    "es": "Gaul / Raczyński Map 1:125,000",
                    "pl": "Mapa Gaula/Raczyńskiego 1:125 000",
                    "uk": "Gaul / Raczyński Map 1:125,000",
                    "hu": "Gaul / Raczyński Map 1:125,000",
                    "cs": "Gaul / Raczyński Map 1:125,000",
                    "sk": "Gaul / Raczyński Map 1:125,000",
                    "nl": "Gaul / Raczyński Map 1:125,000",
                    "bg": "Gaul / Raczyński Map 1:125,000",
                    "el": "Gaul / Raczyński Map 1:125,000",
                    "pt": "Gaul / Raczyński Map 1:125,000",
                    "da": "Gaul / Raczyński Map 1:125,000",
                    "sv": "Gaul / Raczyński Map 1:125,000",
                    "no": "Gaul / Raczyński Map 1:125,000",
                    "fi": "Gaul / Raczyński Map 1:125,000",
                    "et": "Gaul / Raczyński Map 1:125,000",
                    "lv": "Gaul / Raczyński Map 1:125,000",
                    "lt": "Gaul / Raczyński Map 1:125,000",
                    "hr": "Gaul / Raczyński Map 1:125,000",
                    "sr": "Gaul / Raczyński Map 1:125,000",
                    "sl": "Gaul / Raczyński Map 1:125,000",
                    "ru": "Gaul / Raczyński Map 1:125,000",
                    "sq": "Gaul / Raczyński Map 1:125,000"
                },
                scale: "1:125 000", years: "1807–1812",
                provider: "Edward Raczyński / Archiwum Państwowe w Poznaniu / CENAGIS IH PAN",
                bounds: [[51.49, 15.12], [52.99, 17.36]]
            },
            "kummersberg": {
                id: "kummersberg", wms_layer: "kummersberg_3857",
                title: {
                    "en": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "ro": "Harta Administrativă a Galiției și Lodomeriei (Kummersberg) 1:115 200",
                    "de": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "fr": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "it": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "es": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "pl": "Administrativ Karte von Galizien und Lodomerien (Kummersberg)",
                    "uk": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "hu": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "cs": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "sk": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "nl": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "bg": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "el": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "pt": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "da": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "sv": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "no": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "fi": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "et": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "lv": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "lt": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "hr": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "sr": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "sl": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "ru": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200",
                    "sq": "Administrative Map of Galicia & Lodomeria (Kummersberg) 1:115,200"
                },
                scale: "1:115 200", years: "1855",
                provider: "Carl Ritter von Kummersberg / CENAGIS IH PAN",
                bounds: [[48.83, 18.62], [50.85, 26.68]]
            },
            "schroetter": {
                id: "schroetter", wms_layer: "schroetter_3857",
                title: {
                    "en": "Schroetter Map (East & West Prussia) 1:150,000",
                    "ro": "Harta Schroetter (Prusia Răsăriteană și Apuseană) 1:150 000",
                    "de": "Schroetter Map (East & West Prussia) 1:150,000",
                    "fr": "Schroetter Map (East & West Prussia) 1:150,000",
                    "it": "Schroetter Map (East & West Prussia) 1:150,000",
                    "es": "Schroetter Map (East & West Prussia) 1:150,000",
                    "pl": "Mapa Schroettera 1:150 000 (Ost- und Westpreussen)",
                    "uk": "Schroetter Map (East & West Prussia) 1:150,000",
                    "hu": "Schroetter Map (East & West Prussia) 1:150,000",
                    "cs": "Schroetter Map (East & West Prussia) 1:150,000",
                    "sk": "Schroetter Map (East & West Prussia) 1:150,000",
                    "nl": "Schroetter Map (East & West Prussia) 1:150,000",
                    "bg": "Schroetter Map (East & West Prussia) 1:150,000",
                    "el": "Schroetter Map (East & West Prussia) 1:150,000",
                    "pt": "Schroetter Map (East & West Prussia) 1:150,000",
                    "da": "Schroetter Map (East & West Prussia) 1:150,000",
                    "sv": "Schroetter Map (East & West Prussia) 1:150,000",
                    "no": "Schroetter Map (East & West Prussia) 1:150,000",
                    "fi": "Schroetter Map (East & West Prussia) 1:150,000",
                    "et": "Schroetter Map (East & West Prussia) 1:150,000",
                    "lv": "Schroetter Map (East & West Prussia) 1:150,000",
                    "lt": "Schroetter Map (East & West Prussia) 1:150,000",
                    "hr": "Schroetter Map (East & West Prussia) 1:150,000",
                    "sr": "Schroetter Map (East & West Prussia) 1:150,000",
                    "sl": "Schroetter Map (East & West Prussia) 1:150,000",
                    "ru": "Schroetter Map (East & West Prussia) 1:150,000",
                    "sq": "Schroetter Map (East & West Prussia) 1:150,000"
                },
                scale: "1:150 000", years: "1796–1802",
                provider: "Friedrich Leopold von Schroetter / CENAGIS IH PAN",
                bounds: [[52.3, 15.1], [55.9, 22.96]]
            },
            "gilly": {
                id: "gilly", wms_layer: "gilly_3857",
                title: {
                    "en": "Gilly Map (South Prussia) 1:150,000",
                    "ro": "Harta Gilly (Prusia de Sud) 1:150 000",
                    "de": "Gilly Map (South Prussia) 1:150,000",
                    "fr": "Gilly Map (South Prussia) 1:150,000",
                    "it": "Gilly Map (South Prussia) 1:150,000",
                    "es": "Gilly Map (South Prussia) 1:150,000",
                    "pl": "Mapa Gilly'ego 1:150 000 (Südpreussen)",
                    "uk": "Gilly Map (South Prussia) 1:150,000",
                    "hu": "Gilly Map (South Prussia) 1:150,000",
                    "cs": "Gilly Map (South Prussia) 1:150,000",
                    "sk": "Gilly Map (South Prussia) 1:150,000",
                    "nl": "Gilly Map (South Prussia) 1:150,000",
                    "bg": "Gilly Map (South Prussia) 1:150,000",
                    "el": "Gilly Map (South Prussia) 1:150,000",
                    "pt": "Gilly Map (South Prussia) 1:150,000",
                    "da": "Gilly Map (South Prussia) 1:150,000",
                    "sv": "Gilly Map (South Prussia) 1:150,000",
                    "no": "Gilly Map (South Prussia) 1:150,000",
                    "fi": "Gilly Map (South Prussia) 1:150,000",
                    "et": "Gilly Map (South Prussia) 1:150,000",
                    "lv": "Gilly Map (South Prussia) 1:150,000",
                    "lt": "Gilly Map (South Prussia) 1:150,000",
                    "hr": "Gilly Map (South Prussia) 1:150,000",
                    "sr": "Gilly Map (South Prussia) 1:150,000",
                    "sl": "Gilly Map (South Prussia) 1:150,000",
                    "ru": "Gilly Map (South Prussia) 1:150,000",
                    "sq": "Gilly Map (South Prussia) 1:150,000"
                },
                scale: "1:150 000", years: "1802–1803",
                provider: "David Gilly (Special Karte von Südpreussen) / CENAGIS IH PAN",
                bounds: [[50.07, 14.88], [53.72, 21.87]]
            },
            "textor": {
                id: "textor", wms_layer: "textor_3857",
                title: {
                    "en": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "ro": "Harta Textor-Sotzmann (Noua Prusie Răsăriteană) 1:150 000",
                    "de": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "fr": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "it": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "es": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "pl": "Mapa Textora-Sotzmanna 1:150 000 (Neu Ostpreussen)",
                    "uk": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "hu": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "cs": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "sk": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "nl": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "bg": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "el": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "pt": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "da": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "sv": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "no": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "fi": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "et": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "lv": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "lt": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "hr": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "sr": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "sl": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "ru": "Textor-Sotzmann Map (New East Prussia) 1:150,000",
                    "sq": "Textor-Sotzmann Map (New East Prussia) 1:150,000"
                },
                scale: "1:150 000", years: "1806–1808",
                provider: "J. C. Textor & D. F. Sotzmann / CENAGIS IH PAN",
                bounds: [[52.48, 18.56], [55.05, 24.34]]
            },
            "m25k": {
                id: "m25k", wms_layer: "m25k_3857",
                title: {
                    "en": "German Topographic Messtischblätter 1:25,000",
                    "ro": "Hărțile Germane Messtischblätter 1:25 000",
                    "de": "German Topographic Messtischblätter 1:25,000",
                    "fr": "German Topographic Messtischblätter 1:25,000",
                    "it": "German Topographic Messtischblätter 1:25,000",
                    "es": "German Topographic Messtischblätter 1:25,000",
                    "pl": "Messtischblätter 1:25 000",
                    "uk": "German Topographic Messtischblätter 1:25,000",
                    "hu": "German Topographic Messtischblätter 1:25,000",
                    "cs": "German Topographic Messtischblätter 1:25,000",
                    "sk": "German Topographic Messtischblätter 1:25,000",
                    "nl": "German Topographic Messtischblätter 1:25,000",
                    "bg": "German Topographic Messtischblätter 1:25,000",
                    "el": "German Topographic Messtischblätter 1:25,000",
                    "pt": "German Topographic Messtischblätter 1:25,000",
                    "da": "German Topographic Messtischblätter 1:25,000",
                    "sv": "German Topographic Messtischblätter 1:25,000",
                    "no": "German Topographic Messtischblätter 1:25,000",
                    "fi": "German Topographic Messtischblätter 1:25,000",
                    "et": "German Topographic Messtischblätter 1:25,000",
                    "lv": "German Topographic Messtischblätter 1:25,000",
                    "lt": "German Topographic Messtischblätter 1:25,000",
                    "hr": "German Topographic Messtischblätter 1:25,000",
                    "sr": "German Topographic Messtischblätter 1:25,000",
                    "sl": "German Topographic Messtischblätter 1:25,000",
                    "ru": "German Topographic Messtischblätter 1:25,000",
                    "sq": "German Topographic Messtischblätter 1:25,000"
                },
                scale: "1:25 000", years: "1870–1945",
                provider: "Königlich Preussische Landesaufnahme / Reichsamt für Landesaufnahme / CENAGIS IH PAN",
                bounds: [[49.39, 13.99], [55.89, 24.66]]
            },
            "kdr": {
                /* `kdr_2180`, NOT `kdr_3857`: the Web-Mercator mosaic of this
                 * sheet is unreadable on the source server — every GetMap for
                 * it answers 200 with
                 *   java.lang.RuntimeException: Unable to create a valid
                 *   ImageInputStream … cartomatic/kdr/mosaick/
                 *   kdr_3857_transparent.ecw
                 * (the 2026-10-13 outage in CENAGIS_WMS_HEALTH.md; re-checked
                 * 2026-10-15 — still broken, and not fixable from a browser).
                 * The same sheet IS readable as `kdr_2180`: the 2D map asks it
                 * for EPSG:3857 tiles and the GeoServer re-projects them on the
                 * fly, the 3D view asks it in EPSG:2180 through the tile proxy.
                 * Verified with GetMap + GetFeatureInfo at Poznań/Berlin/Warsaw
                 * on 2026-10-15 (see WMS_WMTS_LAYER_AUDIT.md §CENAGIS repoint). */
                id: "kdr", wms_layer: "kdr_2180",
                title: {
                    "en": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "ro": "Harta Imperiului German (Karte des Deutschen Reiches) 1:100 000",
                    "de": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "fr": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "it": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "es": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "pl": "Karte des Deutschen Reiches 1:100 000",
                    "uk": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "hu": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "cs": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "sk": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "nl": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "bg": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "el": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "pt": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "da": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "sv": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "no": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "fi": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "et": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "lv": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "lt": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "hr": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "sr": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "sl": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "ru": "German Empire Map (Karte des Deutschen Reiches) 1:100,000",
                    "sq": "German Empire Map (Karte des Deutschen Reiches) 1:100,000"
                },
                scale: "1:100 000", years: "1870–1914 (~1900)",
                provider: "Reichsamt für Landesaufnahme / CENAGIS IH PAN",
                bounds: [[47.25, 5.83], [56, 23.33]],
                notes: 'Repointed from the unreadable kdr_3857 mosaic to kdr_2180 on 2026-10-15.'
            },
            "kdr_gb": {
                id: "kdr_gb", wms_layer: "kdr_gb_3857",
                title: {
                    "en": "German Grossblätter WWII 1:100,000",
                    "ro": "Harta Germană Grossblätter WWII 1:100 000",
                    "de": "German Grossblätter Zweiter Weltkrieg (Erster Weltkrieg (WWI)I) 1:100,000",
                    "fr": "German Grossblätter Seconde Guerre mondiale 1:100,000",
                    "it": "German Grossblätter Seconda guerra mondiale 1:100,000",
                    "es": "German Grossblätter Segunda Guerra Mundial 1:100,000",
                    "pl": "Karte des Deutschen Reiches – Grossblätter 1:100 000",
                    "uk": "German Grossblätter Друга світова війна 1:100,000",
                    "hu": "German Grossblätter II. Világháború 1:100,000",
                    "cs": "German Grossblätter 2. světová válka 1:100,000",
                    "sk": "German Grossblätter 2. svetová vojna 1:100,000",
                    "nl": "German Grossblätter Tweede Wereldoorlog 1:100,000",
                    "bg": "German Grossblätter Втора световна война 1:100,000",
                    "el": "German Grossblätter WWII 1:100,000",
                    "pt": "German Grossblätter Segunda Guerra Mundial 1:100,000",
                    "da": "German Grossblätter WWII 1:100,000",
                    "sv": "German Grossblätter WWII 1:100,000",
                    "no": "German Grossblätter WWII 1:100,000",
                    "fi": "German Grossblätter WWII 1:100,000",
                    "et": "German Grossblätter WWII 1:100,000",
                    "lv": "German Grossblätter WWII 1:100,000",
                    "lt": "German Grossblätter WWII 1:100,000",
                    "hr": "German Grossblätter Drugi svjetski rat 1:100,000",
                    "sr": "German Grossblätter Drugi svjetski rat 1:100,000",
                    "sl": "German Grossblätter Drugi svjetski rat 1:100,000",
                    "ru": "German Grossblätter Вторая мировая война 1:100,000",
                    "sq": "German Grossblätter WWII 1:100,000"
                },
                scale: "1:100 000", years: "1939–1944",
                provider: "Hauptvermessungsabteilung / CENAGIS IH PAN",
                bounds: [[47.75, 13.33], [56.75, 28.33]]
            },
            "kdwr": {
                id: "kdwr", wms_layer: "kdwr_3857",
                title: {
                    "en": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "ro": "Harta Rusiei Vestice (Karte des Westlichen Russlands) 1:100 000",
                    "de": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "fr": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "it": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "es": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "pl": "Karte des Westlichen Russlands 1:100 000",
                    "uk": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "hu": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "cs": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "sk": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "nl": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "bg": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "el": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "pt": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "da": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "sv": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "no": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "fi": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "et": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "lv": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "lt": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "hr": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "sr": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "sl": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "ru": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000",
                    "sq": "Western Russia Map (Karte des Westlichen Russlands) 1:100,000"
                },
                scale: "1:100 000", years: "1914–1921",
                provider: "Kartographische Abteilung des Stellvertretenden Generalstabes / CENAGIS IH PAN",
                bounds: [[49.99, 17.33], [57.75, 27.33]]
            },
            "ukvme": {
                /* `ukvme_2180`, NOT `ukvme_3857` — same story as `kdr` above:
                 * the 3857 mosaic's ECW
                 * (cartomatic/UKvME/mosaick/ukvme_3857_transparent.ecw) cannot
                 * be read by the GeoServer, so every GetMap for it answers 200
                 * with a Java exception body, while `ukvme_2180` renders (the
                 * 2D map gets EPSG:3857 tiles re-projected server-side, the 3D
                 * view asks in EPSG:2180 through the proxy). Verified
                 * 2026-10-15 at Warsaw/Berlin; also verified that the old
                 * `ukvme_3857_transparent` name does not exist at all. */
                id: "ukvme", wms_layer: "ukvme_2180",
                title: {
                    "en": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "ro": "Harta Europei Centrale (Übersichtskarte von Mitteleuropa) 1:300 000",
                    "de": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "fr": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "it": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "es": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "pl": "Übersichtskarte von Mitteleuropa 1:300 000",
                    "uk": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "hu": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "cs": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "sk": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "nl": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "bg": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "el": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "pt": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "da": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "sv": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "no": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "fi": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "et": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "lv": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "lt": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "hr": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "sr": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "sl": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "ru": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000",
                    "sq": "Central Europe Map (Übersichtskarte von Mitteleuropa) 1:300,000"
                },
                scale: "1:300 000", years: "1890–1915 (~1900)",
                provider: "Königlich Preussische Landesaufnahme / CENAGIS IH PAN",
                bounds: [[45.99, 12.33], [58.99, 34.33]],
                notes: 'Repointed from the unreadable ukvme_3857 mosaic to ukvme_2180 on 2026-10-15.'
            },
            "reymann": {
                id: "reymann", wms_layer: "reymann_3857",
                title: {
                    "en": "Reymann's Special Map of Central Europe 1:200,000",
                    "ro": "Harta Specială Reymann a Europei Centrale 1:200 000",
                    "de": "Reymann's Special Map of Central Europe 1:200,000",
                    "fr": "Reymann's Special Map of Central Europe 1:200,000",
                    "it": "Reymann's Special Map of Central Europe 1:200,000",
                    "es": "Reymann's Special Map of Central Europe 1:200,000",
                    "pl": "Reymann's Special-Karte von Central Europa 1:200 000",
                    "uk": "Reymann's Special Map of Central Europe 1:200,000",
                    "hu": "Reymann's Special Map of Central Europe 1:200,000",
                    "cs": "Reymann's Special Map of Central Europe 1:200,000",
                    "sk": "Reymann's Special Map of Central Europe 1:200,000",
                    "nl": "Reymann's Special Map of Central Europe 1:200,000",
                    "bg": "Reymann's Special Map of Central Europe 1:200,000",
                    "el": "Reymann's Special Map of Central Europe 1:200,000",
                    "pt": "Reymann's Special Map of Central Europe 1:200,000",
                    "da": "Reymann's Special Map of Central Europe 1:200,000",
                    "sv": "Reymann's Special Map of Central Europe 1:200,000",
                    "no": "Reymann's Special Map of Central Europe 1:200,000",
                    "fi": "Reymann's Special Map of Central Europe 1:200,000",
                    "et": "Reymann's Special Map of Central Europe 1:200,000",
                    "lv": "Reymann's Special Map of Central Europe 1:200,000",
                    "lt": "Reymann's Special Map of Central Europe 1:200,000",
                    "hr": "Reymann's Special Map of Central Europe 1:200,000",
                    "sr": "Reymann's Special Map of Central Europe 1:200,000",
                    "sl": "Reymann's Special Map of Central Europe 1:200,000",
                    "ru": "Reymann's Special Map of Central Europe 1:200,000",
                    "sq": "Reymann's Special Map of Central Europe 1:200,000"
                },
                scale: "1:200 000", years: "1850–1900",
                provider: "Daniel Gottlob Reymann / Flemming / CENAGIS IH PAN",
                bounds: [[46.5, 5.2], [55.8, 28.5]]
            },
            "dwuwiorstowka": {
                id: "dwuwiorstowka", wms_layer: "dwuwiorstowka_3857",
                title: {
                    "en": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "ro": "Harta Rusă de Două Verste (Dvuhviorstka) 1:84 000",
                    "de": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "fr": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "it": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "es": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "pl": "Dwuwiorstówka 1:84 000",
                    "uk": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "hu": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "cs": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "sk": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "nl": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "bg": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "el": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "pt": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "da": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "sv": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "no": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "fi": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "et": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "lv": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "lt": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "hr": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "sr": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "sl": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "ru": "Russian 2-Verst Map (Dvukhverstka) 1:84,000",
                    "sq": "Russian 2-Verst Map (Dvukhverstka) 1:84,000"
                },
                scale: "1:84 000", years: "1908–1936",
                provider: "Военно-Топографический Отдел Главного Штаба / CENAGIS IH PAN",
                bounds: [[50, 17.5], [56, 26.5]]
            },
            "ahp_ziemie_polskie": {
                id: "ahp_ziemie_polskie", wms_layer: "ahp_ziemie_polskie_3857",
                title: {
                    "en": "Crown Lands of Poland in 16th c. 1:250,000",
                    "ro": "Țările Coroanei Poloneze în sec. XVI 1:250 000",
                    "de": "Crown Lands of Poland in 16th c. 1:250,000",
                    "fr": "Crown Lands of Poland in 16th c. 1:250,000",
                    "it": "Crown Lands of Poland in 16th c. 1:250,000",
                    "es": "Crown Lands of Poland in 16th c. 1:250,000",
                    "pl": "Ziemie polskie Korony w II połowie XVI w. 1:250 000",
                    "uk": "Crown Lands of Poland in 16th c. 1:250,000",
                    "hu": "Crown Lands of Poland in 16th c. 1:250,000",
                    "cs": "Crown Lands of Poland in 16th c. 1:250,000",
                    "sk": "Crown Lands of Poland in 16th c. 1:250,000",
                    "nl": "Crown Lands of Poland in 16th c. 1:250,000",
                    "bg": "Crown Lands of Poland in 16th c. 1:250,000",
                    "el": "Crown Lands of Poland in 16th c. 1:250,000",
                    "pt": "Crown Lands of Poland in 16th c. 1:250,000",
                    "da": "Crown Lands of Poland in 16th c. 1:250,000",
                    "sv": "Crown Lands of Poland in 16th c. 1:250,000",
                    "no": "Crown Lands of Poland in 16th c. 1:250,000",
                    "fi": "Crown Lands of Poland in 16th c. 1:250,000",
                    "et": "Crown Lands of Poland in 16th c. 1:250,000",
                    "lv": "Crown Lands of Poland in 16th c. 1:250,000",
                    "lt": "Crown Lands of Poland in 16th c. 1:250,000",
                    "hr": "Crown Lands of Poland in 16th c. 1:250,000",
                    "sr": "Crown Lands of Poland in 16th c. 1:250,000",
                    "sl": "Crown Lands of Poland in 16th c. 1:250,000",
                    "ru": "Crown Lands of Poland in 16th c. 1:250,000",
                    "sq": "Crown Lands of Poland in 16th c. 1:250,000"
                },
                scale: "1:250 000", years: "XVI w. (~1580)",
                provider: "Atlas Historyczny Polski / Instytut Historii PAN (IH PAN)",
                bounds: [[48.88, 14.49], [55, 24.34]]
            },
            "ahp_drogi": {
                id: "ahp_drogi", wms_layer: "ahp_drogi_3857",
                title: {
                    "en": "Trade & Postal Routes in 16th c. 1:500,000",
                    "ro": "Drumurile comerciale în sec. XVI 1:500 000",
                    "de": "Trade & Postal Routes in 16th c. 1:500,000",
                    "fr": "Trade & Postal Routes in 16th c. 1:500,000",
                    "it": "Trade & Postal Routes in 16th c. 1:500,000",
                    "es": "Trade & Postal Routes in 16th c. 1:500,000",
                    "pl": "Drogi w II połowie XVI w. 1:500 000",
                    "uk": "Trade & Postal Routes in 16th c. 1:500,000",
                    "hu": "Trade & Postal Routes in 16th c. 1:500,000",
                    "cs": "Trade & Postal Routes in 16th c. 1:500,000",
                    "sk": "Trade & Postal Routes in 16th c. 1:500,000",
                    "nl": "Trade & Postal Routes in 16th c. 1:500,000",
                    "bg": "Trade & Postal Routes in 16th c. 1:500,000",
                    "el": "Trade & Postal Routes in 16th c. 1:500,000",
                    "pt": "Trade & Postal Routes in 16th c. 1:500,000",
                    "da": "Trade & Postal Routes in 16th c. 1:500,000",
                    "sv": "Trade & Postal Routes in 16th c. 1:500,000",
                    "no": "Trade & Postal Routes in 16th c. 1:500,000",
                    "fi": "Trade & Postal Routes in 16th c. 1:500,000",
                    "et": "Trade & Postal Routes in 16th c. 1:500,000",
                    "lv": "Trade & Postal Routes in 16th c. 1:500,000",
                    "lt": "Trade & Postal Routes in 16th c. 1:500,000",
                    "hr": "Trade & Postal Routes in 16th c. 1:500,000",
                    "sr": "Trade & Postal Routes in 16th c. 1:500,000",
                    "sl": "Trade & Postal Routes in 16th c. 1:500,000",
                    "ru": "Trade & Postal Routes in 16th c. 1:500,000",
                    "sq": "Trade & Postal Routes in 16th c. 1:500,000"
                },
                scale: "1:500 000", years: "XVI w. (~1580)",
                provider: "Atlas Historyczny Polski / Instytut Historii PAN (IH PAN)",
                bounds: [[48.88, 14.49], [55, 24.34]]
            },
            "ahp_koscielne": {
                id: "ahp_koscielne", wms_layer: "ahp_koscielne_3857",
                title: {
                    "en": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "ro": "Împărțirile ecleziastice în sec. XVI 1:500 000",
                    "de": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "fr": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "it": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "es": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "pl": "Podziały kościelne w II połowie XVI w. 1:500 000",
                    "uk": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "hu": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "cs": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "sk": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "nl": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "bg": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "el": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "pt": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "da": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "sv": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "no": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "fi": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "et": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "lv": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "lt": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "hr": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "sr": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "sl": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "ru": "Ecclesiastical Divisions in 16th c. 1:500,000",
                    "sq": "Ecclesiastical Divisions in 16th c. 1:500,000"
                },
                scale: "1:500 000", years: "XVI w. (~1580)",
                provider: "Atlas Historyczny Polski / Instytut Historii PAN (IH PAN)",
                bounds: [[48.88, 14.49], [55, 24.34]]
            },
            "ahp_wlasnosc": {
                id: "ahp_wlasnosc", wms_layer: "ahp_wlasnosc_3857",
                title: {
                    "en": "Land Ownership Structure in 16th c. 1:500,000",
                    "ro": "Structura proprietății funciare în sec. XVI 1:500 000",
                    "de": "Land Ownership Structure in 16th c. 1:500,000",
                    "fr": "Land Ownership Structure in 16th c. 1:500,000",
                    "it": "Land Ownership Structure in 16th c. 1:500,000",
                    "es": "Land Ownership Structure in 16th c. 1:500,000",
                    "pl": "Rozmieszczenie własności w II połowie XVI w. 1:500 000",
                    "uk": "Land Ownership Structure in 16th c. 1:500,000",
                    "hu": "Land Ownership Structure in 16th c. 1:500,000",
                    "cs": "Land Ownership Structure in 16th c. 1:500,000",
                    "sk": "Land Ownership Structure in 16th c. 1:500,000",
                    "nl": "Land Ownership Structure in 16th c. 1:500,000",
                    "bg": "Land Ownership Structure in 16th c. 1:500,000",
                    "el": "Land Ownership Structure in 16th c. 1:500,000",
                    "pt": "Land Ownership Structure in 16th c. 1:500,000",
                    "da": "Land Ownership Structure in 16th c. 1:500,000",
                    "sv": "Land Ownership Structure in 16th c. 1:500,000",
                    "no": "Land Ownership Structure in 16th c. 1:500,000",
                    "fi": "Land Ownership Structure in 16th c. 1:500,000",
                    "et": "Land Ownership Structure in 16th c. 1:500,000",
                    "lv": "Land Ownership Structure in 16th c. 1:500,000",
                    "lt": "Land Ownership Structure in 16th c. 1:500,000",
                    "hr": "Land Ownership Structure in 16th c. 1:500,000",
                    "sr": "Land Ownership Structure in 16th c. 1:500,000",
                    "sl": "Land Ownership Structure in 16th c. 1:500,000",
                    "ru": "Land Ownership Structure in 16th c. 1:500,000",
                    "sq": "Land Ownership Structure in 16th c. 1:500,000"
                },
                scale: "1:500 000", years: "XVI w. (~1580)",
                provider: "Atlas Historyczny Polski / Instytut Historii PAN (IH PAN)",
                bounds: [[48.88, 14.49], [55, 24.34]]
            },
            "city_warszawa": {
                id: "city_warszawa", wms_layer: "warszawa_3857",
                title: {
                    "en": "Warsaw City Plan 1:25,000 (1944)",
                    "ro": "Planul Varșoviei 1:25 000 (1944)",
                    "de": "Warsaw City Plan 1:25,000 (1944)",
                    "fr": "Warsaw City Plan 1:25,000 (1944)",
                    "it": "Warsaw City Plan 1:25,000 (1944)",
                    "es": "Warsaw City Plan 1:25,000 (1944)",
                    "pl": "Plan Warszawy 1:25 000 (1944)",
                    "uk": "Warsaw City Plan 1:25,000 (1944)",
                    "hu": "Warsaw City Plan 1:25,000 (1944)",
                    "cs": "Warsaw City Plan 1:25,000 (1944)",
                    "sk": "Warsaw City Plan 1:25,000 (1944)",
                    "nl": "Warsaw City Plan 1:25,000 (1944)",
                    "bg": "Warsaw City Plan 1:25,000 (1944)",
                    "el": "Warsaw City Plan 1:25,000 (1944)",
                    "pt": "Warsaw City Plan 1:25,000 (1944)",
                    "da": "Warsaw City Plan 1:25,000 (1944)",
                    "sv": "Warsaw City Plan 1:25,000 (1944)",
                    "no": "Warsaw City Plan 1:25,000 (1944)",
                    "fi": "Warsaw City Plan 1:25,000 (1944)",
                    "et": "Warsaw City Plan 1:25,000 (1944)",
                    "lv": "Warsaw City Plan 1:25,000 (1944)",
                    "lt": "Warsaw City Plan 1:25,000 (1944)",
                    "hr": "Warsaw City Plan 1:25,000 (1944)",
                    "sr": "Warsaw City Plan 1:25,000 (1944)",
                    "sl": "Warsaw City Plan 1:25,000 (1944)",
                    "ru": "Warsaw City Plan 1:25,000 (1944)",
                    "sq": "Warsaw City Plan 1:25,000 (1944)"
                },
                scale: "1:25 000", years: "1944",
                provider: "Geographical Section General Staff (GSGS 4435) / WIG / CENAGIS IH PAN",
                bounds: [[52.16, 20.88], [52.3, 21.15]]
            },
            "city_krakow": {
                id: "city_krakow", wms_layer: "krakow_3857",
                title: {
                    "en": "Kraków City Plan 1:25,000 (1943)",
                    "ro": "Planul Cracoviei 1:25 000 (1943)",
                    "de": "Kraków City Plan 1:25,000 (1943)",
                    "fr": "Kraków City Plan 1:25,000 (1943)",
                    "it": "Kraków City Plan 1:25,000 (1943)",
                    "es": "Kraków City Plan 1:25,000 (1943)",
                    "pl": "Plan Krakowa 1:25 000 (1943)",
                    "uk": "Kraków City Plan 1:25,000 (1943)",
                    "hu": "Kraków City Plan 1:25,000 (1943)",
                    "cs": "Kraków City Plan 1:25,000 (1943)",
                    "sk": "Kraków City Plan 1:25,000 (1943)",
                    "nl": "Kraków City Plan 1:25,000 (1943)",
                    "bg": "Kraków City Plan 1:25,000 (1943)",
                    "el": "Kraków City Plan 1:25,000 (1943)",
                    "pt": "Kraków City Plan 1:25,000 (1943)",
                    "da": "Kraków City Plan 1:25,000 (1943)",
                    "sv": "Kraków City Plan 1:25,000 (1943)",
                    "no": "Kraków City Plan 1:25,000 (1943)",
                    "fi": "Kraków City Plan 1:25,000 (1943)",
                    "et": "Kraków City Plan 1:25,000 (1943)",
                    "lv": "Kraków City Plan 1:25,000 (1943)",
                    "lt": "Kraków City Plan 1:25,000 (1943)",
                    "hr": "Kraków City Plan 1:25,000 (1943)",
                    "sr": "Kraków City Plan 1:25,000 (1943)",
                    "sl": "Kraków City Plan 1:25,000 (1943)",
                    "ru": "Kraków City Plan 1:25,000 (1943)",
                    "sq": "Kraków City Plan 1:25,000 (1943)"
                },
                scale: "1:25 000", years: "1943",
                provider: "GSGS 4435 / WIG / CENAGIS IH PAN",
                bounds: [[49.99, 19.87], [50.1, 20]]
            },
            "city_gdansk": {
                id: "city_gdansk", wms_layer: "gdansk_3857",
                title: {
                    "en": "Gdańsk City Plan 1:25,000 (1944)",
                    "ro": "Planul Gdańskului 1:25 000 (1944)",
                    "de": "Gdańsk City Plan 1:25,000 (1944)",
                    "fr": "Gdańsk City Plan 1:25,000 (1944)",
                    "it": "Gdańsk City Plan 1:25,000 (1944)",
                    "es": "Gdańsk City Plan 1:25,000 (1944)",
                    "pl": "Plan Gdańska 1:25 000 (1944)",
                    "uk": "Gdańsk City Plan 1:25,000 (1944)",
                    "hu": "Gdańsk City Plan 1:25,000 (1944)",
                    "cs": "Gdańsk City Plan 1:25,000 (1944)",
                    "sk": "Gdańsk City Plan 1:25,000 (1944)",
                    "nl": "Gdańsk City Plan 1:25,000 (1944)",
                    "bg": "Gdańsk City Plan 1:25,000 (1944)",
                    "el": "Gdańsk City Plan 1:25,000 (1944)",
                    "pt": "Gdańsk City Plan 1:25,000 (1944)",
                    "da": "Gdańsk City Plan 1:25,000 (1944)",
                    "sv": "Gdańsk City Plan 1:25,000 (1944)",
                    "no": "Gdańsk City Plan 1:25,000 (1944)",
                    "fi": "Gdańsk City Plan 1:25,000 (1944)",
                    "et": "Gdańsk City Plan 1:25,000 (1944)",
                    "lv": "Gdańsk City Plan 1:25,000 (1944)",
                    "lt": "Gdańsk City Plan 1:25,000 (1944)",
                    "hr": "Gdańsk City Plan 1:25,000 (1944)",
                    "sr": "Gdańsk City Plan 1:25,000 (1944)",
                    "sl": "Gdańsk City Plan 1:25,000 (1944)",
                    "ru": "Gdańsk City Plan 1:25,000 (1944)",
                    "sq": "Gdańsk City Plan 1:25,000 (1944)"
                },
                scale: "1:25 000", years: "1944",
                provider: "GSGS 4496 / WIG / CENAGIS IH PAN",
                bounds: [[54.32, 18.59], [54.42, 18.7]]
            },
            "city_wroclaw": {
                id: "city_wroclaw", wms_layer: "wroclaw_3857",
                title: {
                    "en": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "ro": "Planul Wrocławului (Breslau) 1:25 000 (1944)",
                    "de": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "fr": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "it": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "es": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "pl": "Plan Wrocławia 1:25 000 (1944)",
                    "uk": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "hu": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "cs": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "sk": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "nl": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "bg": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "el": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "pt": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "da": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "sv": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "no": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "fi": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "et": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "lv": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "lt": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "hr": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "sr": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "sl": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "ru": "Wrocław (Breslau) City Plan 1:25,000 (1944)",
                    "sq": "Wrocław (Breslau) City Plan 1:25,000 (1944)"
                },
                scale: "1:25 000", years: "1944",
                provider: "GSGS 4480 / WIG / CENAGIS IH PAN",
                bounds: [[51.07, 16.98], [51.14, 17.1]]
            },
            "city_poznan": {
                id: "city_poznan", wms_layer: "poznan_3857",
                title: {
                    "en": "Poznań City Plan 1:25,000 (1943)",
                    "ro": "Planul Poznańului 1:25 000 (1943)",
                    "de": "Poznań City Plan 1:25,000 (1943)",
                    "fr": "Poznań City Plan 1:25,000 (1943)",
                    "it": "Poznań City Plan 1:25,000 (1943)",
                    "es": "Poznań City Plan 1:25,000 (1943)",
                    "pl": "Plan Poznania 1:25 000 (1943)",
                    "uk": "Poznań City Plan 1:25,000 (1943)",
                    "hu": "Poznań City Plan 1:25,000 (1943)",
                    "cs": "Poznań City Plan 1:25,000 (1943)",
                    "sk": "Poznań City Plan 1:25,000 (1943)",
                    "nl": "Poznań City Plan 1:25,000 (1943)",
                    "bg": "Poznań City Plan 1:25,000 (1943)",
                    "el": "Poznań City Plan 1:25,000 (1943)",
                    "pt": "Poznań City Plan 1:25,000 (1943)",
                    "da": "Poznań City Plan 1:25,000 (1943)",
                    "sv": "Poznań City Plan 1:25,000 (1943)",
                    "no": "Poznań City Plan 1:25,000 (1943)",
                    "fi": "Poznań City Plan 1:25,000 (1943)",
                    "et": "Poznań City Plan 1:25,000 (1943)",
                    "lv": "Poznań City Plan 1:25,000 (1943)",
                    "lt": "Poznań City Plan 1:25,000 (1943)",
                    "hr": "Poznań City Plan 1:25,000 (1943)",
                    "sr": "Poznań City Plan 1:25,000 (1943)",
                    "sl": "Poznań City Plan 1:25,000 (1943)",
                    "ru": "Poznań City Plan 1:25,000 (1943)",
                    "sq": "Poznań City Plan 1:25,000 (1943)"
                },
                scale: "1:25 000", years: "1943",
                provider: "GSGS 4435 / WIG / CENAGIS IH PAN",
                bounds: [[52.36, 16.86], [52.43, 17]]
            },
            "city_lodz": {
                id: "city_lodz", wms_layer: "lodz_3857",
                title: {
                    "en": "Łódź City Plan 1:25,000 (1943)",
                    "ro": "Planul orașului Łódź 1:25 000 (1943)",
                    "de": "Łódź City Plan 1:25,000 (1943)",
                    "fr": "Łódź City Plan 1:25,000 (1943)",
                    "it": "Łódź City Plan 1:25,000 (1943)",
                    "es": "Łódź City Plan 1:25,000 (1943)",
                    "pl": "Plan Łodzi 1:25 000 (1943)",
                    "uk": "Łódź City Plan 1:25,000 (1943)",
                    "hu": "Łódź City Plan 1:25,000 (1943)",
                    "cs": "Łódź City Plan 1:25,000 (1943)",
                    "sk": "Łódź City Plan 1:25,000 (1943)",
                    "nl": "Łódź City Plan 1:25,000 (1943)",
                    "bg": "Łódź City Plan 1:25,000 (1943)",
                    "el": "Łódź City Plan 1:25,000 (1943)",
                    "pt": "Łódź City Plan 1:25,000 (1943)",
                    "da": "Łódź City Plan 1:25,000 (1943)",
                    "sv": "Łódź City Plan 1:25,000 (1943)",
                    "no": "Łódź City Plan 1:25,000 (1943)",
                    "fi": "Łódź City Plan 1:25,000 (1943)",
                    "et": "Łódź City Plan 1:25,000 (1943)",
                    "lv": "Łódź City Plan 1:25,000 (1943)",
                    "lt": "Łódź City Plan 1:25,000 (1943)",
                    "hr": "Łódź City Plan 1:25,000 (1943)",
                    "sr": "Łódź City Plan 1:25,000 (1943)",
                    "sl": "Łódź City Plan 1:25,000 (1943)",
                    "ru": "Łódź City Plan 1:25,000 (1943)",
                    "sq": "Łódź City Plan 1:25,000 (1943)"
                },
                scale: "1:25 000", years: "1943",
                provider: "GSGS 4435 / WIG / CENAGIS IH PAN",
                bounds: [[51.64, 19.32], [51.87, 19.55]]
            },
            "city_katowice": {
                id: "city_katowice", wms_layer: "katowice_3857",
                title: {
                    "en": "Katowice City Plan 1:25,000 (1943)",
                    "ro": "Planul Katowice 1:25 000 (1943)",
                    "de": "Katowice City Plan 1:25,000 (1943)",
                    "fr": "Katowice City Plan 1:25,000 (1943)",
                    "it": "Katowice City Plan 1:25,000 (1943)",
                    "es": "Katowice City Plan 1:25,000 (1943)",
                    "pl": "Plan Katowic 1:25 000 (1943)",
                    "uk": "Katowice City Plan 1:25,000 (1943)",
                    "hu": "Katowice City Plan 1:25,000 (1943)",
                    "cs": "Katowice City Plan 1:25,000 (1943)",
                    "sk": "Katowice City Plan 1:25,000 (1943)",
                    "nl": "Katowice City Plan 1:25,000 (1943)",
                    "bg": "Katowice City Plan 1:25,000 (1943)",
                    "el": "Katowice City Plan 1:25,000 (1943)",
                    "pt": "Katowice City Plan 1:25,000 (1943)",
                    "da": "Katowice City Plan 1:25,000 (1943)",
                    "sv": "Katowice City Plan 1:25,000 (1943)",
                    "no": "Katowice City Plan 1:25,000 (1943)",
                    "fi": "Katowice City Plan 1:25,000 (1943)",
                    "et": "Katowice City Plan 1:25,000 (1943)",
                    "lv": "Katowice City Plan 1:25,000 (1943)",
                    "lt": "Katowice City Plan 1:25,000 (1943)",
                    "hr": "Katowice City Plan 1:25,000 (1943)",
                    "sr": "Katowice City Plan 1:25,000 (1943)",
                    "sl": "Katowice City Plan 1:25,000 (1943)",
                    "ru": "Katowice City Plan 1:25,000 (1943)",
                    "sq": "Katowice City Plan 1:25,000 (1943)"
                },
                scale: "1:25 000", years: "1943",
                provider: "GSGS 4435 / WIG / CENAGIS IH PAN",
                bounds: [[50.23, 18.98], [50.28, 19.08]]
            },
            "city_czestochowa": {
                id: "city_czestochowa", wms_layer: "czestochowa_3857",
                title: {
                    "en": "Częstochowa City Plan 1:25,000 (1943)",
                    "ro": "Planul Częstochowa 1:25 000 (1943)",
                    "de": "Częstochowa City Plan 1:25,000 (1943)",
                    "fr": "Częstochowa City Plan 1:25,000 (1943)",
                    "it": "Częstochowa City Plan 1:25,000 (1943)",
                    "es": "Częstochowa City Plan 1:25,000 (1943)",
                    "pl": "Plan Częstochowy 1:25 000 (1943)",
                    "uk": "Częstochowa City Plan 1:25,000 (1943)",
                    "hu": "Częstochowa City Plan 1:25,000 (1943)",
                    "cs": "Częstochowa City Plan 1:25,000 (1943)",
                    "sk": "Częstochowa City Plan 1:25,000 (1943)",
                    "nl": "Częstochowa City Plan 1:25,000 (1943)",
                    "bg": "Częstochowa City Plan 1:25,000 (1943)",
                    "el": "Częstochowa City Plan 1:25,000 (1943)",
                    "pt": "Częstochowa City Plan 1:25,000 (1943)",
                    "da": "Częstochowa City Plan 1:25,000 (1943)",
                    "sv": "Częstochowa City Plan 1:25,000 (1943)",
                    "no": "Częstochowa City Plan 1:25,000 (1943)",
                    "fi": "Częstochowa City Plan 1:25,000 (1943)",
                    "et": "Częstochowa City Plan 1:25,000 (1943)",
                    "lv": "Częstochowa City Plan 1:25,000 (1943)",
                    "lt": "Częstochowa City Plan 1:25,000 (1943)",
                    "hr": "Częstochowa City Plan 1:25,000 (1943)",
                    "sr": "Częstochowa City Plan 1:25,000 (1943)",
                    "sl": "Częstochowa City Plan 1:25,000 (1943)",
                    "ru": "Częstochowa City Plan 1:25,000 (1943)",
                    "sq": "Częstochowa City Plan 1:25,000 (1943)"
                },
                scale: "1:25 000", years: "1943",
                provider: "GSGS 4435 / WIG / CENAGIS IH PAN",
                bounds: [[50.77, 19.06], [50.83, 19.17]]
            },
            "city_bialystok": {
                id: "city_bialystok", wms_layer: "bialystok_3857",
                title: {
                    "en": "Białystok City Plan 1:25,000 (1943)",
                    "ro": "Planul Białystok 1:25 000 (1943)",
                    "de": "Białystok City Plan 1:25,000 (1943)",
                    "fr": "Białystok City Plan 1:25,000 (1943)",
                    "it": "Białystok City Plan 1:25,000 (1943)",
                    "es": "Białystok City Plan 1:25,000 (1943)",
                    "pl": "Plan Białegostoku 1:25 000 (1943)",
                    "uk": "Białystok City Plan 1:25,000 (1943)",
                    "hu": "Białystok City Plan 1:25,000 (1943)",
                    "cs": "Białystok City Plan 1:25,000 (1943)",
                    "sk": "Białystok City Plan 1:25,000 (1943)",
                    "nl": "Białystok City Plan 1:25,000 (1943)",
                    "bg": "Białystok City Plan 1:25,000 (1943)",
                    "el": "Białystok City Plan 1:25,000 (1943)",
                    "pt": "Białystok City Plan 1:25,000 (1943)",
                    "da": "Białystok City Plan 1:25,000 (1943)",
                    "sv": "Białystok City Plan 1:25,000 (1943)",
                    "no": "Białystok City Plan 1:25,000 (1943)",
                    "fi": "Białystok City Plan 1:25,000 (1943)",
                    "et": "Białystok City Plan 1:25,000 (1943)",
                    "lv": "Białystok City Plan 1:25,000 (1943)",
                    "lt": "Białystok City Plan 1:25,000 (1943)",
                    "hr": "Białystok City Plan 1:25,000 (1943)",
                    "sr": "Białystok City Plan 1:25,000 (1943)",
                    "sl": "Białystok City Plan 1:25,000 (1943)",
                    "ru": "Białystok City Plan 1:25,000 (1943)",
                    "sq": "Białystok City Plan 1:25,000 (1943)"
                },
                scale: "1:25 000", years: "1943",
                provider: "GSGS 4435 / WIG / CENAGIS IH PAN",
                bounds: [[53.09, 23.09], [53.16, 23.21]]
            },
            "city_bydgoszcz": {
                id: "city_bydgoszcz", wms_layer: "bydgoszcz_3857",
                title: {
                    "en": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "ro": "Planul Bydgoszcz 1:25 000 (1943)",
                    "de": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "fr": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "it": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "es": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "pl": "Plan Bydgoszczy 1:25 000 (1943)",
                    "uk": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "hu": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "cs": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "sk": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "nl": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "bg": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "el": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "pt": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "da": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "sv": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "no": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "fi": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "et": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "lv": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "lt": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "hr": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "sr": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "sl": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "ru": "Bydgoszcz City Plan 1:25,000 (1943)",
                    "sq": "Bydgoszcz City Plan 1:25,000 (1943)"
                },
                scale: "1:25 000", years: "1943",
                provider: "GSGS 4435 / WIG / CENAGIS IH PAN",
                bounds: [[53.1, 17.94], [53.15, 18.06]]
            },
            "city_torun": {
                id: "city_torun", wms_layer: "torun_3857",
                title: {
                    "en": "Toruń City Plan 1:25,000 (1943)",
                    "ro": "Planul Toruń 1:25 000 (1943)",
                    "de": "Toruń City Plan 1:25,000 (1943)",
                    "fr": "Toruń City Plan 1:25,000 (1943)",
                    "it": "Toruń City Plan 1:25,000 (1943)",
                    "es": "Toruń City Plan 1:25,000 (1943)",
                    "pl": "Plan Torunia 1:25 000 (1943)",
                    "uk": "Toruń City Plan 1:25,000 (1943)",
                    "hu": "Toruń City Plan 1:25,000 (1943)",
                    "cs": "Toruń City Plan 1:25,000 (1943)",
                    "sk": "Toruń City Plan 1:25,000 (1943)",
                    "nl": "Toruń City Plan 1:25,000 (1943)",
                    "bg": "Toruń City Plan 1:25,000 (1943)",
                    "el": "Toruń City Plan 1:25,000 (1943)",
                    "pt": "Toruń City Plan 1:25,000 (1943)",
                    "da": "Toruń City Plan 1:25,000 (1943)",
                    "sv": "Toruń City Plan 1:25,000 (1943)",
                    "no": "Toruń City Plan 1:25,000 (1943)",
                    "fi": "Toruń City Plan 1:25,000 (1943)",
                    "et": "Toruń City Plan 1:25,000 (1943)",
                    "lv": "Toruń City Plan 1:25,000 (1943)",
                    "lt": "Toruń City Plan 1:25,000 (1943)",
                    "hr": "Toruń City Plan 1:25,000 (1943)",
                    "sr": "Toruń City Plan 1:25,000 (1943)",
                    "sl": "Toruń City Plan 1:25,000 (1943)",
                    "ru": "Toruń City Plan 1:25,000 (1943)",
                    "sq": "Toruń City Plan 1:25,000 (1943)"
                },
                scale: "1:25 000", years: "1943",
                provider: "GSGS 4435 / WIG / CENAGIS IH PAN",
                bounds: [[52.98, 18.55], [53.05, 18.66]]
            },
            "city_lublin": {
                id: "city_lublin", wms_layer: "lublin_3857",
                title: {
                    "en": "Lublin City Plan 1:25,000 (1943)",
                    "ro": "Planul Lublin 1:25 000 (1943)",
                    "de": "Lublin City Plan 1:25,000 (1943)",
                    "fr": "Lublin City Plan 1:25,000 (1943)",
                    "it": "Lublin City Plan 1:25,000 (1943)",
                    "es": "Lublin City Plan 1:25,000 (1943)",
                    "pl": "Plan Lublina 1:25 000 (1943)",
                    "uk": "Lublin City Plan 1:25,000 (1943)",
                    "hu": "Lublin City Plan 1:25,000 (1943)",
                    "cs": "Lublin City Plan 1:25,000 (1943)",
                    "sk": "Lublin City Plan 1:25,000 (1943)",
                    "nl": "Lublin City Plan 1:25,000 (1943)",
                    "bg": "Lublin City Plan 1:25,000 (1943)",
                    "el": "Lublin City Plan 1:25,000 (1943)",
                    "pt": "Lublin City Plan 1:25,000 (1943)",
                    "da": "Lublin City Plan 1:25,000 (1943)",
                    "sv": "Lublin City Plan 1:25,000 (1943)",
                    "no": "Lublin City Plan 1:25,000 (1943)",
                    "fi": "Lublin City Plan 1:25,000 (1943)",
                    "et": "Lublin City Plan 1:25,000 (1943)",
                    "lv": "Lublin City Plan 1:25,000 (1943)",
                    "lt": "Lublin City Plan 1:25,000 (1943)",
                    "hr": "Lublin City Plan 1:25,000 (1943)",
                    "sr": "Lublin City Plan 1:25,000 (1943)",
                    "sl": "Lublin City Plan 1:25,000 (1943)",
                    "ru": "Lublin City Plan 1:25,000 (1943)",
                    "sq": "Lublin City Plan 1:25,000 (1943)"
                },
                scale: "1:25 000", years: "1943",
                provider: "GSGS 4435 / WIG / CENAGIS IH PAN",
                bounds: [[51.2, 22.52], [51.28, 22.62]]
            },
            "city_kielce": {
                id: "city_kielce", wms_layer: "kielce_3857",
                title: {
                    "en": "Kielce City Plan 1:25,000 (1943)",
                    "ro": "Planul Kielce 1:25 000 (1943)",
                    "de": "Kielce City Plan 1:25,000 (1943)",
                    "fr": "Kielce City Plan 1:25,000 (1943)",
                    "it": "Kielce City Plan 1:25,000 (1943)",
                    "es": "Kielce City Plan 1:25,000 (1943)",
                    "pl": "Plan Kielc 1:25 000 (1943)",
                    "uk": "Kielce City Plan 1:25,000 (1943)",
                    "hu": "Kielce City Plan 1:25,000 (1943)",
                    "cs": "Kielce City Plan 1:25,000 (1943)",
                    "sk": "Kielce City Plan 1:25,000 (1943)",
                    "nl": "Kielce City Plan 1:25,000 (1943)",
                    "bg": "Kielce City Plan 1:25,000 (1943)",
                    "el": "Kielce City Plan 1:25,000 (1943)",
                    "pt": "Kielce City Plan 1:25,000 (1943)",
                    "da": "Kielce City Plan 1:25,000 (1943)",
                    "sv": "Kielce City Plan 1:25,000 (1943)",
                    "no": "Kielce City Plan 1:25,000 (1943)",
                    "fi": "Kielce City Plan 1:25,000 (1943)",
                    "et": "Kielce City Plan 1:25,000 (1943)",
                    "lv": "Kielce City Plan 1:25,000 (1943)",
                    "lt": "Kielce City Plan 1:25,000 (1943)",
                    "hr": "Kielce City Plan 1:25,000 (1943)",
                    "sr": "Kielce City Plan 1:25,000 (1943)",
                    "sl": "Kielce City Plan 1:25,000 (1943)",
                    "ru": "Kielce City Plan 1:25,000 (1943)",
                    "sq": "Kielce City Plan 1:25,000 (1943)"
                },
                scale: "1:25 000", years: "1943",
                provider: "GSGS 4435 / WIG / CENAGIS IH PAN",
                bounds: [[50.83, 20.57], [50.89, 20.69]]
            },
            "city_radom": {
                id: "city_radom", wms_layer: "radom_3857",
                title: {
                    "en": "Radom City Plan 1:25,000 (1943)",
                    "ro": "Planul Radom 1:25 000 (1943)",
                    "de": "Radom City Plan 1:25,000 (1943)",
                    "fr": "Radom City Plan 1:25,000 (1943)",
                    "it": "Radom City Plan 1:25,000 (1943)",
                    "es": "Radom City Plan 1:25,000 (1943)",
                    "pl": "Plan Radomia 1:25 000 (1943)",
                    "uk": "Radom City Plan 1:25,000 (1943)",
                    "hu": "Radom City Plan 1:25,000 (1943)",
                    "cs": "Radom City Plan 1:25,000 (1943)",
                    "sk": "Radom City Plan 1:25,000 (1943)",
                    "nl": "Radom City Plan 1:25,000 (1943)",
                    "bg": "Radom City Plan 1:25,000 (1943)",
                    "el": "Radom City Plan 1:25,000 (1943)",
                    "pt": "Radom City Plan 1:25,000 (1943)",
                    "da": "Radom City Plan 1:25,000 (1943)",
                    "sv": "Radom City Plan 1:25,000 (1943)",
                    "no": "Radom City Plan 1:25,000 (1943)",
                    "fi": "Radom City Plan 1:25,000 (1943)",
                    "et": "Radom City Plan 1:25,000 (1943)",
                    "lv": "Radom City Plan 1:25,000 (1943)",
                    "lt": "Radom City Plan 1:25,000 (1943)",
                    "hr": "Radom City Plan 1:25,000 (1943)",
                    "sr": "Radom City Plan 1:25,000 (1943)",
                    "sl": "Radom City Plan 1:25,000 (1943)",
                    "ru": "Radom City Plan 1:25,000 (1943)",
                    "sq": "Radom City Plan 1:25,000 (1943)"
                },
                scale: "1:25 000", years: "1943",
                provider: "GSGS 4435 / WIG / CENAGIS IH PAN",
                bounds: [[51.36, 21.09], [51.42, 21.21]]
            },
            "city_rzeszow": {
                id: "city_rzeszow", wms_layer: "rzeszow_3857",
                title: {
                    "en": "Rzeszów City Plan 1:25,000 (1943)",
                    "ro": "Planul Rzeszów 1:25 000 (1943)",
                    "de": "Rzeszów City Plan 1:25,000 (1943)",
                    "fr": "Rzeszów City Plan 1:25,000 (1943)",
                    "it": "Rzeszów City Plan 1:25,000 (1943)",
                    "es": "Rzeszów City Plan 1:25,000 (1943)",
                    "pl": "Plan Rzeszowa 1:25 000 (1943)",
                    "uk": "Rzeszów City Plan 1:25,000 (1943)",
                    "hu": "Rzeszów City Plan 1:25,000 (1943)",
                    "cs": "Rzeszów City Plan 1:25,000 (1943)",
                    "sk": "Rzeszów City Plan 1:25,000 (1943)",
                    "nl": "Rzeszów City Plan 1:25,000 (1943)",
                    "bg": "Rzeszów City Plan 1:25,000 (1943)",
                    "el": "Rzeszów City Plan 1:25,000 (1943)",
                    "pt": "Rzeszów City Plan 1:25,000 (1943)",
                    "da": "Rzeszów City Plan 1:25,000 (1943)",
                    "sv": "Rzeszów City Plan 1:25,000 (1943)",
                    "no": "Rzeszów City Plan 1:25,000 (1943)",
                    "fi": "Rzeszów City Plan 1:25,000 (1943)",
                    "et": "Rzeszów City Plan 1:25,000 (1943)",
                    "lv": "Rzeszów City Plan 1:25,000 (1943)",
                    "lt": "Rzeszów City Plan 1:25,000 (1943)",
                    "hr": "Rzeszów City Plan 1:25,000 (1943)",
                    "sr": "Rzeszów City Plan 1:25,000 (1943)",
                    "sl": "Rzeszów City Plan 1:25,000 (1943)",
                    "ru": "Rzeszów City Plan 1:25,000 (1943)",
                    "sq": "Rzeszów City Plan 1:25,000 (1943)"
                },
                scale: "1:25 000", years: "1943",
                provider: "GSGS 4435 / WIG / CENAGIS IH PAN",
                bounds: [[50.01, 21.96], [50.07, 22.05]]
            },
            "city_tarnow": {
                id: "city_tarnow", wms_layer: "tarnow_3857",
                title: {
                    "en": "Tarnów City Plan 1:25,000 (1943)",
                    "ro": "Planul Tarnów 1:25 000 (1943)",
                    "de": "Tarnów City Plan 1:25,000 (1943)",
                    "fr": "Tarnów City Plan 1:25,000 (1943)",
                    "it": "Tarnów City Plan 1:25,000 (1943)",
                    "es": "Tarnów City Plan 1:25,000 (1943)",
                    "pl": "Plan Tarnowa 1:25 000 (1943)",
                    "uk": "Tarnów City Plan 1:25,000 (1943)",
                    "hu": "Tarnów City Plan 1:25,000 (1943)",
                    "cs": "Tarnów City Plan 1:25,000 (1943)",
                    "sk": "Tarnów City Plan 1:25,000 (1943)",
                    "nl": "Tarnów City Plan 1:25,000 (1943)",
                    "bg": "Tarnów City Plan 1:25,000 (1943)",
                    "el": "Tarnów City Plan 1:25,000 (1943)",
                    "pt": "Tarnów City Plan 1:25,000 (1943)",
                    "da": "Tarnów City Plan 1:25,000 (1943)",
                    "sv": "Tarnów City Plan 1:25,000 (1943)",
                    "no": "Tarnów City Plan 1:25,000 (1943)",
                    "fi": "Tarnów City Plan 1:25,000 (1943)",
                    "et": "Tarnów City Plan 1:25,000 (1943)",
                    "lv": "Tarnów City Plan 1:25,000 (1943)",
                    "lt": "Tarnów City Plan 1:25,000 (1943)",
                    "hr": "Tarnów City Plan 1:25,000 (1943)",
                    "sr": "Tarnów City Plan 1:25,000 (1943)",
                    "sl": "Tarnów City Plan 1:25,000 (1943)",
                    "ru": "Tarnów City Plan 1:25,000 (1943)",
                    "sq": "Tarnów City Plan 1:25,000 (1943)"
                },
                scale: "1:25 000", years: "1943",
                provider: "GSGS 4435 / WIG / CENAGIS IH PAN",
                bounds: [[49.99, 20.94], [50.03, 21.05]]
            },
            "city_grudziadz": {
                id: "city_grudziadz", wms_layer: "grudziadz_3857",
                title: {
                    "en": "Grudziądz City Plan 1:25,000 (1943)",
                    "ro": "Planul Grudziądz 1:25 000 (1943)",
                    "de": "Grudziądz City Plan 1:25,000 (1943)",
                    "fr": "Grudziądz City Plan 1:25,000 (1943)",
                    "it": "Grudziądz City Plan 1:25,000 (1943)",
                    "es": "Grudziądz City Plan 1:25,000 (1943)",
                    "pl": "Plan Grudziądza 1:25 000 (1943)",
                    "uk": "Grudziądz City Plan 1:25,000 (1943)",
                    "hu": "Grudziądz City Plan 1:25,000 (1943)",
                    "cs": "Grudziądz City Plan 1:25,000 (1943)",
                    "sk": "Grudziądz City Plan 1:25,000 (1943)",
                    "nl": "Grudziądz City Plan 1:25,000 (1943)",
                    "bg": "Grudziądz City Plan 1:25,000 (1943)",
                    "el": "Grudziądz City Plan 1:25,000 (1943)",
                    "pt": "Grudziądz City Plan 1:25,000 (1943)",
                    "da": "Grudziądz City Plan 1:25,000 (1943)",
                    "sv": "Grudziądz City Plan 1:25,000 (1943)",
                    "no": "Grudziądz City Plan 1:25,000 (1943)",
                    "fi": "Grudziądz City Plan 1:25,000 (1943)",
                    "et": "Grudziądz City Plan 1:25,000 (1943)",
                    "lv": "Grudziądz City Plan 1:25,000 (1943)",
                    "lt": "Grudziądz City Plan 1:25,000 (1943)",
                    "hr": "Grudziądz City Plan 1:25,000 (1943)",
                    "sr": "Grudziądz City Plan 1:25,000 (1943)",
                    "sl": "Grudziądz City Plan 1:25,000 (1943)",
                    "ru": "Grudziądz City Plan 1:25,000 (1943)",
                    "sq": "Grudziądz City Plan 1:25,000 (1943)"
                },
                scale: "1:25 000", years: "1943",
                provider: "GSGS 4435 / WIG / CENAGIS IH PAN",
                bounds: [[53.46, 18.72], [53.52, 18.8]]
            },
            "city_inowroclaw": {
                id: "city_inowroclaw", wms_layer: "inowroclaw_3857",
                title: {
                    "en": "Inowrocław City Plan 1:25,000 (1943)",
                    "ro": "Planul Inowrocław 1:25 000 (1943)",
                    "de": "Inowrocław City Plan 1:25,000 (1943)",
                    "fr": "Inowrocław City Plan 1:25,000 (1943)",
                    "it": "Inowrocław City Plan 1:25,000 (1943)",
                    "es": "Inowrocław City Plan 1:25,000 (1943)",
                    "pl": "Plan Inowrocławia 1:25 000 (1943)",
                    "uk": "Inowrocław City Plan 1:25,000 (1943)",
                    "hu": "Inowrocław City Plan 1:25,000 (1943)",
                    "cs": "Inowrocław City Plan 1:25,000 (1943)",
                    "sk": "Inowrocław City Plan 1:25,000 (1943)",
                    "nl": "Inowrocław City Plan 1:25,000 (1943)",
                    "bg": "Inowrocław City Plan 1:25,000 (1943)",
                    "el": "Inowrocław City Plan 1:25,000 (1943)",
                    "pt": "Inowrocław City Plan 1:25,000 (1943)",
                    "da": "Inowrocław City Plan 1:25,000 (1943)",
                    "sv": "Inowrocław City Plan 1:25,000 (1943)",
                    "no": "Inowrocław City Plan 1:25,000 (1943)",
                    "fi": "Inowrocław City Plan 1:25,000 (1943)",
                    "et": "Inowrocław City Plan 1:25,000 (1943)",
                    "lv": "Inowrocław City Plan 1:25,000 (1943)",
                    "lt": "Inowrocław City Plan 1:25,000 (1943)",
                    "hr": "Inowrocław City Plan 1:25,000 (1943)",
                    "sr": "Inowrocław City Plan 1:25,000 (1943)",
                    "sl": "Inowrocław City Plan 1:25,000 (1943)",
                    "ru": "Inowrocław City Plan 1:25,000 (1943)",
                    "sq": "Inowrocław City Plan 1:25,000 (1943)"
                },
                scale: "1:25 000", years: "1943",
                provider: "GSGS 4435 / WIG / CENAGIS IH PAN",
                bounds: [[52.78, 18.2], [52.82, 18.3]]
            },
            "city_jaslo": {
                id: "city_jaslo", wms_layer: "jaslo_3857",
                title: {
                    "en": "Jasło City Plan 1:25,000 (1943)",
                    "ro": "Planul Jasło 1:25 000 (1943)",
                    "de": "Jasło City Plan 1:25,000 (1943)",
                    "fr": "Jasło City Plan 1:25,000 (1943)",
                    "it": "Jasło City Plan 1:25,000 (1943)",
                    "es": "Jasło City Plan 1:25,000 (1943)",
                    "pl": "Plan Jasła 1:25 000 (1943)",
                    "uk": "Jasło City Plan 1:25,000 (1943)",
                    "hu": "Jasło City Plan 1:25,000 (1943)",
                    "cs": "Jasło City Plan 1:25,000 (1943)",
                    "sk": "Jasło City Plan 1:25,000 (1943)",
                    "nl": "Jasło City Plan 1:25,000 (1943)",
                    "bg": "Jasło City Plan 1:25,000 (1943)",
                    "el": "Jasło City Plan 1:25,000 (1943)",
                    "pt": "Jasło City Plan 1:25,000 (1943)",
                    "da": "Jasło City Plan 1:25,000 (1943)",
                    "sv": "Jasło City Plan 1:25,000 (1943)",
                    "no": "Jasło City Plan 1:25,000 (1943)",
                    "fi": "Jasło City Plan 1:25,000 (1943)",
                    "et": "Jasło City Plan 1:25,000 (1943)",
                    "lv": "Jasło City Plan 1:25,000 (1943)",
                    "lt": "Jasło City Plan 1:25,000 (1943)",
                    "hr": "Jasło City Plan 1:25,000 (1943)",
                    "sr": "Jasło City Plan 1:25,000 (1943)",
                    "sl": "Jasło City Plan 1:25,000 (1943)",
                    "ru": "Jasło City Plan 1:25,000 (1943)",
                    "sq": "Jasło City Plan 1:25,000 (1943)"
                },
                scale: "1:25 000", years: "1943",
                provider: "GSGS 4435 / WIG / CENAGIS IH PAN",
                bounds: [[49.71, 21.41], [49.79, 21.54]]
            },
            "city_siedlce": {
                id: "city_siedlce", wms_layer: "siedlce_3857",
                title: {
                    "en": "Siedlce City Plan 1:25,000 (1943)",
                    "ro": "Planul Siedlce 1:25 000 (1943)",
                    "de": "Siedlce City Plan 1:25,000 (1943)",
                    "fr": "Siedlce City Plan 1:25,000 (1943)",
                    "it": "Siedlce City Plan 1:25,000 (1943)",
                    "es": "Siedlce City Plan 1:25,000 (1943)",
                    "pl": "Plan Siedlec 1:25 000 (1943)",
                    "uk": "Siedlce City Plan 1:25,000 (1943)",
                    "hu": "Siedlce City Plan 1:25,000 (1943)",
                    "cs": "Siedlce City Plan 1:25,000 (1943)",
                    "sk": "Siedlce City Plan 1:25,000 (1943)",
                    "nl": "Siedlce City Plan 1:25,000 (1943)",
                    "bg": "Siedlce City Plan 1:25,000 (1943)",
                    "el": "Siedlce City Plan 1:25,000 (1943)",
                    "pt": "Siedlce City Plan 1:25,000 (1943)",
                    "da": "Siedlce City Plan 1:25,000 (1943)",
                    "sv": "Siedlce City Plan 1:25,000 (1943)",
                    "no": "Siedlce City Plan 1:25,000 (1943)",
                    "fi": "Siedlce City Plan 1:25,000 (1943)",
                    "et": "Siedlce City Plan 1:25,000 (1943)",
                    "lv": "Siedlce City Plan 1:25,000 (1943)",
                    "lt": "Siedlce City Plan 1:25,000 (1943)",
                    "hr": "Siedlce City Plan 1:25,000 (1943)",
                    "sr": "Siedlce City Plan 1:25,000 (1943)",
                    "sl": "Siedlce City Plan 1:25,000 (1943)",
                    "ru": "Siedlce City Plan 1:25,000 (1943)",
                    "sq": "Siedlce City Plan 1:25,000 (1943)"
                },
                scale: "1:25 000", years: "1943",
                provider: "GSGS 4435 / WIG / CENAGIS IH PAN",
                bounds: [[52.13, 22.21], [52.2, 22.33]]
            },
            "city_warszawa_lindley": {
                id: "city_warszawa_lindley", wms_layer: "lindley_3857",
                title: {
                    "en": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "ro": "Planul Lindley al Varșoviei 1:2 500 (1897–1901)",
                    "de": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "fr": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "it": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "es": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "pl": "Warszawa - mapa Lindleyów (1897-1901)",
                    "uk": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "hu": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "cs": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "sk": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "nl": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "bg": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "el": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "pt": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "da": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "sv": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "no": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "fi": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "et": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "lv": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "lt": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "hr": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "sr": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "sl": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "ru": "Lindley Warsaw Plan 1:2,500 (1897–1901)",
                    "sq": "Lindley Warsaw Plan 1:2,500 (1897–1901)"
                },
                scale: "1:2 500", years: "1897–1901",
                provider: "William Heerlein Lindley / Archiwum Państwowe w Warszawie / IH PAN",
                bounds: [[52.17, 20.94], [52.31, 21.08]]
            },
            "city_warszawa_1822": {
                id: "city_warszawa_1822", wms_layer: "warszawaOKI_2180",
                title: {
                    "en": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "ro": "Planul Capitalei Varșovia (Corpul de Ingineri) 1:4 800 (1822)",
                    "de": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "fr": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "it": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "es": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "pl": "Plan miasta stołecznego Warszawy (1822)",
                    "uk": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "hu": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "cs": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "sk": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "nl": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "bg": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "el": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "pt": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "da": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "sv": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "no": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "fi": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "et": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "lv": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "lt": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "hr": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "sr": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "sl": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "ru": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)",
                    "sq": "Warsaw City Plan (Corps of Engineers) 1:4,800 (1822)"
                },
                scale: "1:4 800", years: "1822",
                provider: "Oficerowie Korpusu Inżynierów (1818-1819, litogr. 1822) / AGAD / IH PAN",
                bounds: [[52.19, 20.95], [52.28, 21.07]]
            },
            "city_praga_1796": {
                id: "city_praga_1796", wms_layer: "rauch_2180",
                title: {
                    "en": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "ro": "Planul Suburbiei Praga (Varșovia) 1:7 200 (1796)",
                    "de": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "fr": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "it": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "es": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "pl": "Original Plan der Vorstadt Praga (1796)",
                    "uk": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "hu": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "cs": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "sk": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "nl": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "bg": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "el": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "pt": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "da": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "sv": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "no": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "fi": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "et": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "lv": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "lt": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "hr": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "sr": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "sl": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "ru": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)",
                    "sq": "Praga Suburb (Warsaw) Plan 1:7,200 (1796)"
                },
                scale: "1:7 200", years: "1796",
                provider: "Johann Georg Gustav von Rauch / Staatsbibliothek zu Berlin / IH PAN",
                bounds: [[52.22, 20.99], [52.28, 21.07]]
            }
        }
    };

    /* ═══════════════════════════════════════════════════════════════════════
     *  LAYERS
     * ═══════════════════════════════════════════════════════════════════════ */
    var LAYERS = [
        /* ───────────────────────────── base maps ──────────────────────────── */
        {
            id: 'base.imagery', group: 'base', z: 100, kind: 'xyz', base: true,
            title: {
                "en": "Satellite imagery (Esri World Imagery)",
                "ro": "Imagini satelitare (Esri World Imagery)",
                "de": "Satellit (Esri World Imagery)",
                "fr": "Satellite (Esri World Imagery)",
                "it": "Satellite (Esri World Imagery)",
                "es": "Satélite (Esri World Imagery)",
                "pl": "Satelita (Esri World Imagery)",
                "uk": "Супутник (Esri World Imagery)",
                "hu": "Műhold (Esri World Imagery)",
                "cs": "Satelit (Esri World Imagery)",
                "sk": "Satelit (Esri World Imagery)",
                "nl": "Satelliet (Esri World Imagery)",
                "bg": "Сателит (Esri World Imagery)",
                "el": "Δορυφόρος (Esri World Imagery)",
                "pt": "Satélite (Esri World Imagery)",
                "da": "Satellit (Esri World Imagery)",
                "sv": "Satellit (Esri World Imagery)",
                "no": "Satellitt (Esri World Imagery)",
                "fi": "Satelliitti (Esri World Imagery)",
                "et": "Satelliit (Esri World Imagery)",
                "lv": "Satelīts (Esri World Imagery)",
                "lt": "Palydovas (Esri World Imagery)",
                "hr": "Satelit (Esri World Imagery)",
                "sr": "Satelit (Esri World Imagery)",
                "sl": "Satelit (Esri World Imagery)",
                "ru": "Спутник (Esri World Imagery)",
                "sq": "Satellite imagery (Esri World Imagery)"
            },
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            tileSize: 256, minZoom: 1, maxZoom: 20, maxNativeZoom: 18, opacity: 1,
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
            cors: 'yes', proxy: 'never',
            ui: { var2d: '_satLayer', select: 'basemap' },
            notes: 'ArcGIS basemap stack — the 2D base of the working map and the 3D base behind the draped layers.'
        },
        {
            id: 'base.topographic', group: 'base', z: 101, kind: 'xyz', base: true,
            title: {
                "en": "Topographic (Esri World Topo)",
                "ro": "Hartă topografică (Esri World Topo)",
                "de": "Topographic (Esri World Topo)",
                "fr": "Topographic (Esri World Topo)",
                "it": "Topographic (Esri World Topo)",
                "es": "Topographic (Esri World Topo)",
                "pl": "Topographic (Esri World Topo)",
                "uk": "Topographic (Esri World Topo)",
                "hu": "Topographic (Esri World Topo)",
                "cs": "Topographic (Esri World Topo)",
                "sk": "Topographic (Esri World Topo)",
                "nl": "Topographic (Esri World Topo)",
                "bg": "Topographic (Esri World Topo)",
                "el": "Topographic (Esri World Topo)",
                "pt": "Topographic (Esri World Topo)",
                "da": "Topographic (Esri World Topo)",
                "sv": "Topographic (Esri World Topo)",
                "no": "Topographic (Esri World Topo)",
                "fi": "Topographic (Esri World Topo)",
                "et": "Topographic (Esri World Topo)",
                "lv": "Topographic (Esri World Topo)",
                "lt": "Topographic (Esri World Topo)",
                "hr": "Topographic (Esri World Topo)",
                "sr": "Topographic (Esri World Topo)",
                "sl": "Topographic (Esri World Topo)",
                "ru": "Topographic (Esri World Topo)",
                "sq": "Topographic (Esri World Topo)"
            },
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
            tileSize: 256, minZoom: 1, maxZoom: 20, maxNativeZoom: 18, opacity: 1,
            attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community',
            cors: 'yes', proxy: 'never',
            ui: { select: 'basemap' },
            notes: 'ArcGIS basemap stack (ARCGIS_BASEMAPS.topographic).'
        },
        {
            id: 'base.terrain-base', group: 'base', z: 102, kind: 'xyz', base: true,
            title: {
                "en": "Terrain base (Esri World Terrain Base)",
                "ro": "Relief de bază (Esri World Terrain Base)",
                "de": "Terrain base (Esri World Terrain Base)",
                "fr": "Terrain base (Esri World Terrain Base)",
                "it": "Terrain base (Esri World Terrain Base)",
                "es": "Terrain base (Esri World Terrain Base)",
                "pl": "Terrain base (Esri World Terrain Base)",
                "uk": "Terrain base (Esri World Terrain Base)",
                "hu": "Terrain base (Esri World Terrain Base)",
                "cs": "Terrain base (Esri World Terrain Base)",
                "sk": "Terrain base (Esri World Terrain Base)",
                "nl": "Terrain base (Esri World Terrain Base)",
                "bg": "Terrain base (Esri World Terrain Base)",
                "el": "Terrain base (Esri World Terrain Base)",
                "pt": "Terrain base (Esri World Terrain Base)",
                "da": "Terrain base (Esri World Terrain Base)",
                "sv": "Terrain base (Esri World Terrain Base)",
                "no": "Terrain base (Esri World Terrain Base)",
                "fi": "Terrain base (Esri World Terrain Base)",
                "et": "Terrain base (Esri World Terrain Base)",
                "lv": "Terrain base (Esri World Terrain Base)",
                "lt": "Terrain base (Esri World Terrain Base)",
                "hr": "Terrain base (Esri World Terrain Base)",
                "sr": "Terrain base (Esri World Terrain Base)",
                "sl": "Terrain base (Esri World Terrain Base)",
                "ru": "Terrain base (Esri World Terrain Base)",
                "sq": "Terrain base (Esri World Terrain Base)"
            },
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
            tileSize: 256, minZoom: 1, maxZoom: 20, maxNativeZoom: 9, opacity: 1,
            attribution: 'Tiles &copy; Esri — World Terrain Base',
            cors: 'yes', proxy: 'never',
            ui: { select: 'basemap' },
            notes: 'ArcGIS basemap stack (ARCGIS_BASEMAPS.terrain, layer 1/2 — maxNativeZoom 9).'
        },
        {
            id: 'base.terrain-relief', group: 'base', z: 103, kind: 'xyz', base: true,
            title: {
                "en": "Shaded relief (Esri World Shaded Relief)",
                "ro": "Relief umbrit (Esri World Shaded Relief)",
                "de": "Shaded relief (Esri World Shaded Relief)",
                "fr": "Shaded relief (Esri World Shaded Relief)",
                "it": "Shaded relief (Esri World Shaded Relief)",
                "es": "Shaded relief (Esri World Shaded Relief)",
                "pl": "Shaded relief (Esri World Shaded Relief)",
                "uk": "Shaded relief (Esri World Shaded Relief)",
                "hu": "Shaded relief (Esri World Shaded Relief)",
                "cs": "Shaded relief (Esri World Shaded Relief)",
                "sk": "Shaded relief (Esri World Shaded Relief)",
                "nl": "Shaded relief (Esri World Shaded Relief)",
                "bg": "Shaded relief (Esri World Shaded Relief)",
                "el": "Shaded relief (Esri World Shaded Relief)",
                "pt": "Shaded relief (Esri World Shaded Relief)",
                "da": "Shaded relief (Esri World Shaded Relief)",
                "sv": "Shaded relief (Esri World Shaded Relief)",
                "no": "Shaded relief (Esri World Shaded Relief)",
                "fi": "Shaded relief (Esri World Shaded Relief)",
                "et": "Shaded relief (Esri World Shaded Relief)",
                "lv": "Shaded relief (Esri World Shaded Relief)",
                "lt": "Shaded relief (Esri World Shaded Relief)",
                "hr": "Shaded relief (Esri World Shaded Relief)",
                "sr": "Shaded relief (Esri World Shaded Relief)",
                "sl": "Shaded relief (Esri World Shaded Relief)",
                "ru": "Shaded relief (Esri World Shaded Relief)",
                "sq": "Shaded relief (Esri World Shaded Relief)"
            },
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
            tileSize: 256, minZoom: 1, maxZoom: 20, maxNativeZoom: 9, opacity: 1,
            attribution: 'Tiles &copy; Esri — World Shaded Relief',
            cors: 'yes', proxy: 'never',
            ui: { select: 'basemap' },
            notes: 'ArcGIS basemap stack (ARCGIS_BASEMAPS.terrain, layer 2/2 — maxNativeZoom 9).'
        },
        {
            id: 'base.hillshade', group: 'base', z: 104, kind: 'xyz', base: true, optional: true,
            title: {
                "en": "World Hillshade (Esri)",
                "ro": "World Hillshade (Esri)",
                "de": "World Hillshade (Esri)",
                "fr": "World Hillshade (Esri)",
                "it": "World Hillshade (Esri)",
                "es": "World Hillshade (Esri)",
                "pl": "World Hillshade (Esri)",
                "uk": "World Hillshade (Esri)",
                "hu": "World Hillshade (Esri)",
                "cs": "World Hillshade (Esri)",
                "sk": "World Hillshade (Esri)",
                "nl": "World Hillshade (Esri)",
                "bg": "World Hillshade (Esri)",
                "el": "World Hillshade (Esri)",
                "pt": "World Hillshade (Esri)",
                "da": "World Hillshade (Esri)",
                "sv": "World Hillshade (Esri)",
                "no": "World Hillshade (Esri)",
                "fi": "World Hillshade (Esri)",
                "et": "World Hillshade (Esri)",
                "lv": "World Hillshade (Esri)",
                "lt": "World Hillshade (Esri)",
                "hr": "World Hillshade (Esri)",
                "sr": "World Hillshade (Esri)",
                "sl": "World Hillshade (Esri)",
                "ru": "World Hillshade (Esri)",
                "sq": "World Hillshade (Esri)"
            },
            url: 'https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
            tileSize: 256, minZoom: 0, maxZoom: 20, maxNativeZoom: 16, opacity: 0.55,
            attribution: 'Hillshade: Esri World Hillshade',
            cors: 'yes', proxy: 'never',
            ui: {},
            notes: 'Used by map3d hillshade.mode "service". Same raster as the ArcGIS SceneView atlas page.'
        },

        /* ──────────────────── historical maps — free tier ─────────────────── */
        {
            id: 'hist.austrian', group: 'hist-free', z: 640, kind: 'wms',
            title: {
                "en": "Austrian Map 1910",
                "ro": "Harta Austriacă 1910",
                "de": "Österreichische Karte 1910",
                "fr": "Carte autrichienne 1910",
                "it": "Mappa austriaca 1910",
                "es": "Mapa austríaco 1910",
                "pl": "Mapa austriacka 1910",
                "uk": "Австрійська карта 1910",
                "hu": "Osztrák térkép 1910",
                "cs": "Rakouská mapa 1910",
                "sk": "Rakúska mapa 1910",
                "nl": "Oostenrijkse kaart 1910",
                "bg": "Австрийска карта 1910",
                "el": "Austrian Map 1910",
                "pt": "Mapa austríaco 1910",
                "da": "Østrigsk kort 1910",
                "sv": "Österrikisk karta 1910",
                "no": "Austrian Map 1910",
                "fi": "Austrian Map 1910",
                "et": "Austrian Map 1910",
                "lv": "Austrian Map 1910",
                "lt": "Austrian Map 1910",
                "hr": "Austrijska karta 1910",
                "sr": "Austrijska karta 1910",
                "sl": "Austrijska karta 1910",
                "ru": "Австрийская карта 1910",
                "sq": "Austrian Map 1910"
            },
            url: 'https://services.geo-spatial.org/geoserver/eharta/wms',
            layer: 'eharta:mozaic_austrian_200k',
            format: 'image/png', transparent: true, version: '1.1.0', crs: 'EPSG:3857',
            tileSize: 256, minZoom: 0, maxZoom: 20, opacity: 0.80,
            attribution: '© geo-spatial.org / Harta Austriacă 1910',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'austrianMapToggle', slider: 'austrianMapOpacitySlider', pct: 'austrianMapPct', fn: 'toggleAustrianMap', var2d: '_austrianMapLayer', parent: 'histToggle' },
            notes: 'Mosaic of the 1:200 000 Austro-Hungarian survey. 2D asks WMS 1.1.0 (SRS=).'
        },
        {
            id: 'hist.firing-plans', group: 'hist-free', z: 641, kind: 'wms',
            title: {
                "en": "Firing Plans",
                "ro": "Planuri de Tragere",
                "de": "Firing Plans",
                "fr": "Firing Plans",
                "it": "Firing Plans",
                "es": "Firing Plans",
                "pl": "Firing Plans",
                "uk": "Firing Plans",
                "hu": "Firing Plans",
                "cs": "Firing Plans",
                "sk": "Firing Plans",
                "nl": "Firing Plans",
                "bg": "Firing Plans",
                "el": "Firing Plans",
                "pt": "Firing Plans",
                "da": "Firing Plans",
                "sv": "Firing Plans",
                "no": "Firing Plans",
                "fi": "Firing Plans",
                "et": "Firing Plans",
                "lv": "Firing Plans",
                "lt": "Firing Plans",
                "hr": "Firing Plans",
                "sr": "Firing Plans",
                "sl": "Firing Plans",
                "ru": "Firing Plans",
                "sq": "Firing Plans"
            },
            url: 'https://services.geo-spatial.org/geoserver/eharta/wms',
            layer: 'eharta:mozaic_planuri_tragere_20k',
            format: 'image/png', transparent: true, version: '1.1.0', crs: 'EPSG:3857',
            tileSize: 256, minZoom: 0, maxZoom: 20, opacity: 0.80,
            attribution: '© geo-spatial.org / Planuri de Tragere',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'firingPlansToggle', slider: 'firingPlansOpacitySlider', pct: 'firingPlansPct', fn: 'toggleFiringPlans', var2d: '_firingPlansLayer', parent: 'histToggle' },
            notes: '1:20 000 artillery firing plans (WWI-era archive mosaic).'
        },
        {
            id: 'hist.soviet-1970', group: 'hist-free', z: 642, kind: 'wms',
            title: {
                "en": "Soviet Map 1970",
                "ro": "Harta Sovietică 1970",
                "de": "Soviet Map 1970",
                "fr": "Soviet Map 1970",
                "it": "Soviet Map 1970",
                "es": "Soviet Map 1970",
                "pl": "Soviet Map 1970",
                "uk": "Soviet Map 1970",
                "hu": "Soviet Map 1970",
                "cs": "Soviet Map 1970",
                "sk": "Soviet Map 1970",
                "nl": "Soviet Map 1970",
                "bg": "Soviet Map 1970",
                "el": "Soviet Map 1970",
                "pt": "Soviet Map 1970",
                "da": "Soviet Map 1970",
                "sv": "Soviet Map 1970",
                "no": "Soviet Map 1970",
                "fi": "Soviet Map 1970",
                "et": "Soviet Map 1970",
                "lv": "Soviet Map 1970",
                "lt": "Soviet Map 1970",
                "hr": "Soviet Map 1970",
                "sr": "Soviet Map 1970",
                "sl": "Soviet Map 1970",
                "ru": "Soviet Map 1970",
                "sq": "Soviet Map 1970"
            },
            url: 'https://services.geo-spatial.org/geoserver/eharta/wms',
            layer: 'eharta:mozaic_soviet100k',
            format: 'image/png', transparent: true, version: '1.1.0', crs: 'EPSG:3857',
            tileSize: 256, minZoom: 0, maxZoom: 20, opacity: 0.80,
            attribution: '© geo-spatial.org / Harta Sovietică 1970',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'sovietMapToggle', slider: 'sovietMapOpacitySlider', pct: 'sovietMapPct', fn: 'toggleSovietMap', var2d: '_sovietMapLayer', parent: 'histToggle' },
            notes: 'Soviet 1:100 000 mosaic of the 1970s.'
        },

        /* ───────────────────── premium historical maps ─────────────────────── */
        {
            id: 'premium.josephine', group: 'hist-premium', z: 650, kind: 'xyz',
            title: {
                "en": "Josephine Map + (1780–1790)",
                "ro": "Harta Iosefină + (1780–1790)",
                "de": "Josephinische Landesaufnahme + (1780–1790)",
                "fr": "Carte Joséphine + (1780–1790)",
                "it": "Mappa Giuseppina + (1780–1790)",
                "es": "Mapa Josefino + (1780–1790)",
                "pl": "Mapa józefińska + (1780–1790)",
                "uk": "Йозефінська карта + (1780–1790)",
                "hu": "Jozefin térkép + (1780–1790)",
                "cs": "Josefské mapování + (1780–1790)",
                "sk": "Jozefínske mapovanie + (1780–1790)",
                "nl": "Jozefinische kaart + (1780–1790)",
                "bg": "Йозефинска карта + (1780–1790)",
                "el": "Josephine Map + (1780–1790)",
                "pt": "Mapeamento Josefino + (1780–1790)",
                "da": "Josefinske kort + (1780–1790)",
                "sv": "Josefinska kartor + (1780–1790)",
                "no": "Josephine Map + (1780–1790)",
                "fi": "Josephine Map + (1780–1790)",
                "et": "Josephine Map + (1780–1790)",
                "lv": "Josephine Map + (1780–1790)",
                "lt": "Josephine Map + (1780–1790)",
                "hr": "Jozefinska karta + (1780–1790)",
                "sr": "Jozefinska karta + (1780–1790)",
                "sl": "Jozefinska karta + (1780–1790)",
                "ru": "Карта Иосифа + (1780–1790)",
                "sq": "Josephine Map + (1780–1790)"
            },
            /* Cloudflare R2 is the primary 3D source: it is the full mosaic
             * (z ≤ 15, whole coverage), which is what the 2D view shows outside
             * the Josephine coverage polygon as well. Supabase Storage — the
             * sharper bucket the 2D view prefers INSIDE that polygon (native
             * z10–14) — stays available as the 'supabase' alternative. */
            url: 'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/Josephine/{z}/{x}/{y}.jpg',
            alt: {
                'supabase': 'https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/Harti/Joseph/{z}/{x}/{y}.png',
                'cloudflare': 'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/Josephine/{z}/{x}/{y}.jpg'
            },
            altMeta: {
                'supabase': { minNativeZoom: 10, maxNativeZoom: 14, cors: 'yes' }
            },
            tileSize: 256, minZoom: 8, maxZoom: 20, maxNativeZoom: 15, opacity: 0.80,
            attribution: '© Harta Iosefină 1780–1790 · Österreichisches Staatsarchiv / wnętrza (Cloudflare R2 / Supabase)',
            cors: 'yes', proxy: 'auto',
            ui: { toggle: 'josephineMapToggle', slider: 'josephineMapOpacitySlider', pct: 'josephineMapPct', var2d: '_jLayerRef', parent: 'histPremiumToggle' },
            notes: '2D switches between the Cloudflare R2 mirror (z≤15) and the Supabase bucket ' +
                '(native z10–14) by viewport test; both URLs come from here. 3D drapes the ' +
                'Cloudflare mosaic (the global one).'
        },
        {
            id: 'premium.bucovina', group: 'hist-premium', z: 641, kind: 'xyz',
            title: {
                "en": "Galicia & Bukovina (1861–1864)",
                "ro": "Galitia și Bucovina (1861–1864)",
                "de": "Galicia & Bukovina (1861–1864)",
                "fr": "Galicia & Bukovina (1861–1864)",
                "it": "Galicia & Bukovina (1861–1864)",
                "es": "Galicia & Bukovina (1861–1864)",
                "pl": "Galicia & Bukovina (1861–1864)",
                "uk": "Galicia & Bukovina (1861–1864)",
                "hu": "Galicia & Bukovina (1861–1864)",
                "cs": "Galicia & Bukovina (1861–1864)",
                "sk": "Galicia & Bukovina (1861–1864)",
                "nl": "Galicia & Bukovina (1861–1864)",
                "bg": "Galicia & Bukovina (1861–1864)",
                "el": "Galicia & Bukovina (1861–1864)",
                "pt": "Galicia & Bukovina (1861–1864)",
                "da": "Galicia & Bukovina (1861–1864)",
                "sv": "Galicia & Bukovina (1861–1864)",
                "no": "Galicia & Bukovina (1861–1864)",
                "fi": "Galicia & Bukovina (1861–1864)",
                "et": "Galicia & Bukovina (1861–1864)",
                "lv": "Galicia & Bukovina (1861–1864)",
                "lt": "Galicia & Bukovina (1861–1864)",
                "hr": "Galicia & Bukovina (1861–1864)",
                "sr": "Galicia & Bukovina (1861–1864)",
                "sl": "Galicia & Bukovina (1861–1864)",
                "ru": "Galicia & Bukovina (1861–1864)",
                "sq": "Galicia & Bukovina (1861–1864)"
            },
            url: 'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/Galitzien_and_Bukovina-1861-1864/Galitzien_and_Bukovina-1861-1864/{z}/{x}/{y}.jpg',
            tileSize: 256, minZoom: 8, maxZoom: 20, maxNativeZoom: 15, opacity: 0.80,
            attribution: '© Bucovina 1861-1864',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'bucovinaMapToggle', slider: 'bucovinaMapOpacitySlider', pct: 'bucovinaMapPct', fn: 'toggleBucovinaMap', var2d: '_bucovinaMapLayer', parent: 'histPremiumToggle', maxNativeZoomGlobal: 'BUCOVINA_TILE_MAX_NATIVE_Z' },
            notes: 'Own tile store (Cloudflare R2 public bucket); the 2D code keeps a window.<NAME>_TILE_MAX_NATIVE_Z override.'
        },
        {
            id: 'premium.austro-hungarian', group: 'hist-premium', z: 642, kind: 'xyz',
            title: {
                "en": "Austro-Hungarian Map (1869–1912)",
                "ro": "Harta Austro-Ungară (1869–1912)",
                "de": "Austro-Hungarian Map (1869–1912)",
                "fr": "Austro-Hungarian Map (1869–1912)",
                "it": "Austro-Hungarian Map (1869–1912)",
                "es": "Austro-Hungarian Map (1869–1912)",
                "pl": "Austro-Hungarian Map (1869–1912)",
                "uk": "Austro-Hungarian Map (1869–1912)",
                "hu": "Austro-Hungarian Map (1869–1912)",
                "cs": "Austro-Hungarian Map (1869–1912)",
                "sk": "Austro-Hungarian Map (1869–1912)",
                "nl": "Austro-Hungarian Map (1869–1912)",
                "bg": "Austro-Hungarian Map (1869–1912)",
                "el": "Austro-Hungarian Map (1869–1912)",
                "pt": "Austro-Hungarian Map (1869–1912)",
                "da": "Austro-Hungarian Map (1869–1912)",
                "sv": "Austro-Hungarian Map (1869–1912)",
                "no": "Austro-Hungarian Map (1869–1912)",
                "fi": "Austro-Hungarian Map (1869–1912)",
                "et": "Austro-Hungarian Map (1869–1912)",
                "lv": "Austro-Hungarian Map (1869–1912)",
                "lt": "Austro-Hungarian Map (1869–1912)",
                "hr": "Austro-Hungarian Map (1869–1912)",
                "sr": "Austro-Hungarian Map (1869–1912)",
                "sl": "Austro-Hungarian Map (1869–1912)",
                "ru": "Austro-Hungarian Map (1869–1912)",
                "sq": "Austro-Hungarian Map (1869–1912)"
            },
            url: 'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/Galitzien_and_Bukovina-1861-1864/1869-1912/{z}/{x}/{y}.jpg',
            tileSize: 256, minZoom: 8, maxZoom: 20, maxNativeZoom: 13, opacity: 0.80,
            attribution: '© Austro-Hungarian Map 1861-1864',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'austrohuMapToggle', slider: 'austrohuMapOpacitySlider', pct: 'austrohuMapPct', fn: 'toggleAustrohuMap', var2d: '_austrohuMapLayer', parent: 'histPremiumToggle', maxNativeZoomGlobal: 'AUSTROHU_TILE_MAX_NATIVE_Z' },
            notes: 'Own tile store (Cloudflare R2).'
        },
        {
            id: 'premium.moldova-1868', group: 'hist-premium', z: 643, kind: 'xyz',
            title: {
                "en": "Moldova 1868",
                "ro": "Moldova 1868",
                "de": "Moldau 1868",
                "fr": "Moldavie 1868",
                "it": "Moldavia 1868",
                "es": "Moldavia 1868",
                "pl": "Mołdawia 1868",
                "uk": "Молдова 1868",
                "hu": "Moldva 1868",
                "cs": "Moldávie 1868",
                "sk": "Moldavsko 1868",
                "nl": "Moldavië 1868",
                "bg": "Молдова 1868",
                "el": "Moldova 1868",
                "pt": "Moldávia 1868",
                "da": "Moldova 1868",
                "sv": "Moldova 1868",
                "no": "Moldova 1868",
                "fi": "Moldova 1868",
                "et": "Moldova 1868",
                "lv": "Moldova 1868",
                "lt": "Moldova 1868",
                "hr": "Moldavija 1868",
                "sr": "Moldavija 1868",
                "sl": "Moldavija 1868",
                "ru": "Молдавия 1868",
                "sq": "Moldova 1868"
            },
            url: 'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/Galitzien_and_Bukovina-1861-1864/moldova-1868/{z}/{x}/{y}.jpg',
            tileSize: 256, minZoom: 8, maxZoom: 20, maxNativeZoom: 13, opacity: 0.80,
            attribution: '© Moldova 1868',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'moldova1868MapToggle', slider: 'moldova1868MapOpacitySlider', pct: 'moldova1868MapPct', fn: 'toggleMoldova1868Map', var2d: '_moldova1868MapLayer', parent: 'histPremiumToggle', maxNativeZoomGlobal: 'MOLDOVA1868_TILE_MAX_NATIVE_Z' },
            notes: 'Own tile store (Cloudflare R2).'
        },
        {
            id: 'premium.moldova-wwii', group: 'hist-premium', z: 644, kind: 'xyz',
            title: {
                "en": "Moldova WWII",
                "ro": "Moldova WWII",
                "de": "Moldau II",
                "fr": "Moldavie II",
                "it": "Moldavia II",
                "es": "Moldavia II",
                "pl": "Mołdawia II",
                "uk": "Молдова II",
                "hu": "Moldva II",
                "cs": "Moldávie II",
                "sk": "Moldavsko II",
                "nl": "Moldavië II",
                "bg": "Молдова II",
                "el": "Moldova WWII",
                "pt": "Moldávia II",
                "da": "Moldova WWII",
                "sv": "Moldova WWII",
                "no": "Moldova WWII",
                "fi": "Moldova WWII",
                "et": "Moldova WWII",
                "lv": "Moldova WWII",
                "lt": "Moldova WWII",
                "hr": "Moldavija II",
                "sr": "Moldavija II",
                "sl": "Moldavija II",
                "ru": "Молдавия II",
                "sq": "Moldova WWII"
            },
            url: 'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/Galitzien_and_Bukovina-1861-1864/moldova-wwii/{z}/{x}/{y}.jpg',
            tileSize: 256, minZoom: 8, maxZoom: 20, maxNativeZoom: 13, opacity: 0.80,
            attribution: '© Moldova WWII',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'moldovaWwiiMapToggle', slider: 'moldovaWwiiMapOpacitySlider', pct: 'moldovaWwiiMapPct', fn: 'toggleMoldovaWwiiMap', var2d: '_moldovaWwiiMapLayer', parent: 'histPremiumToggle', maxNativeZoomGlobal: 'MOLDOVAWWII_TILE_MAX_NATIVE_Z' },
            notes: 'Own tile store (Cloudflare R2).'
        },
        {
            id: 'premium.polish-tactical-1933', group: 'hist-premium', z: 645, kind: 'xyz',
            title: {
                "en": "Polish Tactical Map 1933",
                "ro": "Harta tactică poloneză 1933",
                "de": "Polish Tactical Map 1933",
                "fr": "Polish Tactical Map 1933",
                "it": "Polish Tactical Map 1933",
                "es": "Polish Tactical Map 1933",
                "pl": "Polish Tactical Map 1933",
                "uk": "Polish Tactical Map 1933",
                "hu": "Polish Tactical Map 1933",
                "cs": "Polish Tactical Map 1933",
                "sk": "Polish Tactical Map 1933",
                "nl": "Polish Tactical Map 1933",
                "bg": "Polish Tactical Map 1933",
                "el": "Polish Tactical Map 1933",
                "pt": "Polish Tactical Map 1933",
                "da": "Polish Tactical Map 1933",
                "sv": "Polish Tactical Map 1933",
                "no": "Polish Tactical Map 1933",
                "fi": "Polish Tactical Map 1933",
                "et": "Polish Tactical Map 1933",
                "lv": "Polish Tactical Map 1933",
                "lt": "Polish Tactical Map 1933",
                "hr": "Polish Tactical Map 1933",
                "sr": "Polish Tactical Map 1933",
                "sl": "Polish Tactical Map 1933",
                "ru": "Polish Tactical Map 1933",
                "sq": "Polish Tactical Map 1933"
            },
            url: 'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/Galitzien_and_Bukovina-1861-1864/ukraine_zapad_pl-1933/{z}/{x}/{y}.jpg',
            tileSize: 256, minZoom: 8, maxZoom: 20, maxNativeZoom: 13, opacity: 0.80,
            attribution: '© Tactical Polish Map 1933',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'polishTactical1933MapToggle', slider: 'polishTactical1933MapOpacitySlider', pct: 'polishTactical1933MapPct', fn: 'togglePolishTactical1933Map', var2d: '_polishTactical1933MapLayer', parent: 'histPremiumToggle', maxNativeZoomGlobal: 'POLISHTACTICAL1933_TILE_MAX_NATIVE_Z' },
            notes: 'Own tile store (Cloudflare R2).'
        },
        {
            id: 'premium.ww1', group: 'hist-premium', z: 646, kind: 'xyz',
            title: {
                "en": "World War I Map",
                "ro": "Harta Primului Război Mondial",
                "de": "World War I Map",
                "fr": "World War I Map",
                "it": "World War I Map",
                "es": "World War I Map",
                "pl": "World War I Map",
                "uk": "World War I Map",
                "hu": "World War I Map",
                "cs": "World War I Map",
                "sk": "World War I Map",
                "nl": "World War I Map",
                "bg": "World War I Map",
                "el": "World War I Map",
                "pt": "World War I Map",
                "da": "World War I Map",
                "sv": "World War I Map",
                "no": "World War I Map",
                "fi": "World War I Map",
                "et": "World War I Map",
                "lv": "World War I Map",
                "lt": "World War I Map",
                "hr": "World War I Map",
                "sr": "World War I Map",
                "sl": "World War I Map",
                "ru": "World War I Map",
                "sq": "World War I Map"
            },
            url: 'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/Galitzien_and_Bukovina-1861-1864/ww1/{z}/{x}/{y}.jpg',
            tileSize: 256, minZoom: 8, maxZoom: 20, maxNativeZoom: 11, opacity: 0.80,
            attribution: '© WWI',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'ww1MapToggle', slider: 'ww1MapOpacitySlider', pct: 'ww1MapPct', fn: 'toggleWw1Map', var2d: '_ww1MapLayer', parent: 'histPremiumToggle', maxNativeZoomGlobal: 'WW1_TILE_MAX_NATIVE_Z' },
            notes: 'Own tile store (Cloudflare R2).'
        },
        {
            id: 'premium.ww2', group: 'hist-premium', z: 647, kind: 'xyz',
            title: {
                "en": "World War II Map",
                "ro": "Harta celui de-al Doilea Război Mondial",
                "de": "World War II Map",
                "fr": "World War II Map",
                "it": "World War II Map",
                "es": "World War II Map",
                "pl": "World War II Map",
                "uk": "World War II Map",
                "hu": "World War II Map",
                "cs": "World War II Map",
                "sk": "World War II Map",
                "nl": "World War II Map",
                "bg": "World War II Map",
                "el": "World War II Map",
                "pt": "World War II Map",
                "da": "World War II Map",
                "sv": "World War II Map",
                "no": "World War II Map",
                "fi": "World War II Map",
                "et": "World War II Map",
                "lv": "World War II Map",
                "lt": "World War II Map",
                "hr": "World War II Map",
                "sr": "World War II Map",
                "sl": "World War II Map",
                "ru": "World War II Map",
                "sq": "World War II Map"
            },
            url: 'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/Galitzien_and_Bukovina-1861-1864/ww2/{z}/{x}/{y}.jpg',
            tileSize: 256, minZoom: 8, maxZoom: 20, maxNativeZoom: 10, opacity: 0.80,
            attribution: '© WWII',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'ww2MapToggle', slider: 'ww2MapOpacitySlider', pct: 'ww2MapPct', fn: 'toggleWw2Map', var2d: '_ww2MapLayer', parent: 'histPremiumToggle', maxNativeZoomGlobal: 'WW2_TILE_MAX_NATIVE_Z' },
            notes: 'Own tile store (Cloudflare R2).'
        },
        {
            id: 'premium.banat', group: 'hist-premium', z: 649, kind: 'xyz',
            title: {
                "en": "Banat (historical map)",
                "ro": "Banat (hartă istorică)",
                "de": "Banat (historical map)",
                "fr": "Banat (historical map)",
                "it": "Banat (historical map)",
                "es": "Banat (historical map)",
                "pl": "Banat (historical map)",
                "uk": "Banat (historical map)",
                "hu": "Banat (historical map)",
                "cs": "Banat (historical map)",
                "sk": "Banat (historical map)",
                "nl": "Banat (historical map)",
                "bg": "Banat (historical map)",
                "el": "Banat (historical map)",
                "pt": "Banat (historical map)",
                "da": "Banat (historical map)",
                "sv": "Banat (historical map)",
                "no": "Banat (historical map)",
                "fi": "Banat (historical map)",
                "et": "Banat (historical map)",
                "lv": "Banat (historical map)",
                "lt": "Banat (historical map)",
                "hr": "Banat (historical map)",
                "sr": "Banat (historical map)",
                "sl": "Banat (historical map)",
                "ru": "Banat (historical map)",
                "sq": "Banat (historical map)"
            },
            url: 'https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/Harti/Banat/{z}/{x}/{y}.png',
            tileSize: 256, minZoom: 11, maxZoom: 20, maxNativeZoom: 15, opacity: 0.80,
            attribution: '© Banat 1769-1772',
            cors: 'yes', proxy: 'auto',
            ui: { toggle: 'banatMapToggle', slider: 'banatMapOpacitySlider', pct: 'banatMapPct', fn: 'toggleBanatMap', var2d: '_banatMapLayer', parent: 'histPremiumToggle', maxNativeZoomGlobal: 'BANAT_TILE_MAX_NATIVE_Z' },
            notes: 'Supabase Storage public bucket (CORS-enabled).'
        },
        {
            id: 'premium.walachia-1855', group: 'hist-premium', z: 650, kind: 'xyz',
            title: {
                "en": "Walachia 1855-1859",
                "ro": "Valahia 1855-1859",
                "de": "Walachia 1855-1859",
                "fr": "Walachia 1855-1859",
                "it": "Walachia 1855-1859",
                "es": "Walachia 1855-1859",
                "pl": "Walachia 1855-1859",
                "uk": "Walachia 1855-1859",
                "hu": "Walachia 1855-1859",
                "cs": "Walachia 1855-1859",
                "sk": "Walachia 1855-1859",
                "nl": "Walachia 1855-1859",
                "bg": "Walachia 1855-1859",
                "el": "Walachia 1855-1859",
                "pt": "Walachia 1855-1859",
                "da": "Walachia 1855-1859",
                "sv": "Walachia 1855-1859",
                "no": "Walachia 1855-1859",
                "fi": "Walachia 1855-1859",
                "et": "Walachia 1855-1859",
                "lv": "Walachia 1855-1859",
                "lt": "Walachia 1855-1859",
                "hr": "Walachia 1855-1859",
                "sr": "Walachia 1855-1859",
                "sl": "Walachia 1855-1859",
                "ru": "Walachia 1855-1859",
                "sq": "Walachia 1855-1859"
            },
            url: 'https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/Harti/charta/{z}/{x}/{y}.png',
            tileSize: 256, minZoom: 0, maxZoom: 20, maxNativeZoom: 14, opacity: 0.80,
            attribution: 'Valahia 1855-1859', cors: 'yes', proxy: 'auto',
            ui: { toggle: 'walachiaMapToggle', slider: 'walachiaMapOpacitySlider', pct: 'walachiaMapPct', fn: 'toggleWalachiaMap', var2d: '_walachiaMapLayer', parent: 'histPremiumToggle' },
            notes: 'Supabase Storage public bucket; zoom 14 is the only level indicated by the supplied tile URL. The layer-panel preview is the Szathmári sheet scan, not an XYZ tile.'
        },
        {
            id: 'premium.transylvania-1859', group: 'hist-premium', z: 652, kind: 'arcgis-image',
            title: {
                "en": "Transylvania 1859 (Siebenbürgen)",
                "ro": "Transilvania 1859 (Siebenbürgen)",
                "de": "Transylvania 1859 (Siebenbürgen)",
                "fr": "Transylvania 1859 (Siebenbürgen)",
                "it": "Transylvania 1859 (Siebenbürgen)",
                "es": "Transylvania 1859 (Siebenbürgen)",
                "pl": "Transylvania 1859 (Siebenbürgen)",
                "uk": "Transylvania 1859 (Siebenbürgen)",
                "hu": "Transylvania 1859 (Siebenbürgen)",
                "cs": "Transylvania 1859 (Siebenbürgen)",
                "sk": "Transylvania 1859 (Siebenbürgen)",
                "nl": "Transylvania 1859 (Siebenbürgen)",
                "bg": "Transylvania 1859 (Siebenbürgen)",
                "el": "Transylvania 1859 (Siebenbürgen)",
                "pt": "Transylvania 1859 (Siebenbürgen)",
                "da": "Transylvania 1859 (Siebenbürgen)",
                "sv": "Transylvania 1859 (Siebenbürgen)",
                "no": "Transylvania 1859 (Siebenbürgen)",
                "fi": "Transylvania 1859 (Siebenbürgen)",
                "et": "Transylvania 1859 (Siebenbürgen)",
                "lv": "Transylvania 1859 (Siebenbürgen)",
                "lt": "Transylvania 1859 (Siebenbürgen)",
                "hr": "Transylvania 1859 (Siebenbürgen)",
                "sr": "Transylvania 1859 (Siebenbürgen)",
                "sl": "Transylvania 1859 (Siebenbürgen)",
                "ru": "Transylvania 1859 (Siebenbürgen)",
                "sq": "Transylvania 1859 (Siebenbürgen)"
            },
            url: 'https://tiles.arcgis.com/tiles/t2AVhHhEnEvHcPF6/arcgis/rest/services/Siebenburgen_1859/MapServer/tile/{z}/{y}/{x}',
            tileSize: 256, minZoom: 7, maxZoom: 20, maxNativeZoom: 14, opacity: 0.80,
            bounds: [[45.2059, 22.2319], [47.7300, 26.7037]],
            attribution: '© Administrativ Karte des Grossfürstenthums Siebenbürgen (1859; 1:144 000) · Digitalizare și publicare: Universitatea „Ștefan cel Mare” din Suceava · Sursă: <a href="https://bukowina1856.eu" target="_blank" rel="noopener noreferrer">bukowina1856.eu</a>',
            cors: 'yes', proxy: 'auto',
            ui: { toggle: 'transylvania1859MapToggle', slider: 'transylvania1859MapOpacitySlider', pct: 'transylvania1859MapPct', fn: 'toggleTransylvania1859Map', var2d: '_transylvania1859MapLayer', parent: 'histPremiumToggle', maxNativeZoomGlobal: 'TRANSYLVANIA1859_TILE_MAX_NATIVE_Z' },
            notes: 'ArcGIS tiled raster service (Esri-hosted, CORS-enabled) clipped to the sheet footprint.'
        },
        {
            id: 'premium.galicia-1855', group: 'hist-premium', z: 653, kind: 'arcgis-image',
            title: {
                "en": "Galicia 1855 (Kummerer)",
                "ro": "Galitia 1855 (Kummerer)",
                "de": "Galicia 1855 (Kummerer)",
                "fr": "Galicia 1855 (Kummerer)",
                "it": "Galicia 1855 (Kummerer)",
                "es": "Galicia 1855 (Kummerer)",
                "pl": "Galicia 1855 (Kummerer)",
                "uk": "Galicia 1855 (Kummerer)",
                "hu": "Galicia 1855 (Kummerer)",
                "cs": "Galicia 1855 (Kummerer)",
                "sk": "Galicia 1855 (Kummerer)",
                "nl": "Galicia 1855 (Kummerer)",
                "bg": "Galicia 1855 (Kummerer)",
                "el": "Galicia 1855 (Kummerer)",
                "pt": "Galicia 1855 (Kummerer)",
                "da": "Galicia 1855 (Kummerer)",
                "sv": "Galicia 1855 (Kummerer)",
                "no": "Galicia 1855 (Kummerer)",
                "fi": "Galicia 1855 (Kummerer)",
                "et": "Galicia 1855 (Kummerer)",
                "lv": "Galicia 1855 (Kummerer)",
                "lt": "Galicia 1855 (Kummerer)",
                "hr": "Galicia 1855 (Kummerer)",
                "sr": "Galicia 1855 (Kummerer)",
                "sl": "Galicia 1855 (Kummerer)",
                "ru": "Galicia 1855 (Kummerer)",
                "sq": "Galicia 1855 (Kummerer)"
            },
            url: 'https://tiles.arcgis.com/tiles/t2AVhHhEnEvHcPF6/arcgis/rest/services/Kummerer_1855/MapServer/tile/{z}/{y}/{x}',
            tileSize: 256, minZoom: 6, maxZoom: 20, maxNativeZoom: 14, opacity: 0.80,
            attribution: '© Administrativ-Karte von Galizien und Lodomerien - Carl von Kummersberg 1855 · Digitalizare și publicare: Universitatea „Ștefan cel Mare” din Suceava · Sursă: <a href="https://bukowina1856.eu" target="_blank" rel="noopener noreferrer">bukowina1856.eu</a>',
            cors: 'yes', proxy: 'auto',
            ui: { toggle: 'galicia1855MapToggle', slider: 'galicia1855MapOpacitySlider', pct: 'galicia1855MapPct', fn: 'toggleGalicia1855Map', var2d: '_galicia1855MapLayer', parent: 'histPremiumToggle', maxNativeZoomGlobal: 'GALICIA1855_TILE_MAX_NATIVE_Z' },
            notes: 'ArcGIS tiled raster service (Esri-hosted, CORS-enabled).'
        },
        {
            id: 'premium.mitteleuropa', group: 'hist-premium', z: 654, kind: 'wms',
            title: {
                "en": "Central Europe (Übersichtskarte 1:300,000)",
                "ro": "Harta Europei Centrale (Übersichtskarte 1:300 000)",
                "de": "Central Europe (Übersichtskarte 1:300,000)",
                "fr": "Central Europe (Übersichtskarte 1:300,000)",
                "it": "Central Europe (Übersichtskarte 1:300,000)",
                "es": "Central Europe (Übersichtskarte 1:300,000)",
                "pl": "Central Europe (Übersichtskarte 1:300,000)",
                "uk": "Central Europe (Übersichtskarte 1:300,000)",
                "hu": "Central Europe (Übersichtskarte 1:300,000)",
                "cs": "Central Europe (Übersichtskarte 1:300,000)",
                "sk": "Central Europe (Übersichtskarte 1:300,000)",
                "nl": "Central Europe (Übersichtskarte 1:300,000)",
                "bg": "Central Europe (Übersichtskarte 1:300,000)",
                "el": "Central Europe (Übersichtskarte 1:300,000)",
                "pt": "Central Europe (Übersichtskarte 1:300,000)",
                "da": "Central Europe (Übersichtskarte 1:300,000)",
                "sv": "Central Europe (Übersichtskarte 1:300,000)",
                "no": "Central Europe (Übersichtskarte 1:300,000)",
                "fi": "Central Europe (Übersichtskarte 1:300,000)",
                "et": "Central Europe (Übersichtskarte 1:300,000)",
                "lv": "Central Europe (Übersichtskarte 1:300,000)",
                "lt": "Central Europe (Übersichtskarte 1:300,000)",
                "hr": "Central Europe (Übersichtskarte 1:300,000)",
                "sr": "Central Europe (Übersichtskarte 1:300,000)",
                "sl": "Central Europe (Übersichtskarte 1:300,000)",
                "ru": "Central Europe (Übersichtskarte 1:300,000)",
                "sq": "Central Europe (Übersichtskarte 1:300,000)"
            },
            /* The layer name comes from the catalogue entry, not from a copy of
             * it: this row and `cenagis.ukvme` must never point at different
             * mosaics (they did — see WMS_WMTS_LAYER_AUDIT.md §CENAGIS repoint). */
            url: CENAGIS.url, layer: CENAGIS.workspace + ':' + CENAGIS.maps.ukvme.wms_layer,
            format: 'image/png', transparent: true, version: '1.1.1', crs: 'EPSG:3857',
            tileSize: 256, minZoom: 0, maxZoom: 18, opacity: 0.80,
            attribution: '© Übersichtskarte von Mitteleuropa 1:300 000 (1893–1945) · CENAGIS / IH PAN',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'mitteleuropaMapToggle', slider: 'mitteleuropaMapOpacitySlider', pct: 'mitteleuropaMapPct', fn: 'toggleMitteleuropaMap', var2d: '_mitteleuropaMapLayer', parent: 'histPremiumToggle', wmsHealthKeys: ['mitteleuropa'] },
            notes: 'Premium wrapper around the CENAGIS catalogue sheet cenagis.ukvme (' + CENAGIS.maps.ukvme.wms_layer + '; the 3857 twin is unreadable at the source — 2026-10-15).'
        },
        {
            id: 'premium.chrzanowski', group: 'hist-premium', z: 655, kind: 'wms',
            title: {
                "en": "Charter of Old Poland (Chrzanowski 1859)",
                "ro": "Harta Vechii Polonii (Chrzanowski 1859)",
                "de": "Charter of Old Poland (Chrzanowski 1859)",
                "fr": "Charter of Old Poland (Chrzanowski 1859)",
                "it": "Charter of Old Poland (Chrzanowski 1859)",
                "es": "Charter of Old Poland (Chrzanowski 1859)",
                "pl": "Charter of Old Poland (Chrzanowski 1859)",
                "uk": "Charter of Old Poland (Chrzanowski 1859)",
                "hu": "Charter of Old Poland (Chrzanowski 1859)",
                "cs": "Charter of Old Poland (Chrzanowski 1859)",
                "sk": "Charter of Old Poland (Chrzanowski 1859)",
                "nl": "Charter of Old Poland (Chrzanowski 1859)",
                "bg": "Charter of Old Poland (Chrzanowski 1859)",
                "el": "Charter of Old Poland (Chrzanowski 1859)",
                "pt": "Charter of Old Poland (Chrzanowski 1859)",
                "da": "Charter of Old Poland (Chrzanowski 1859)",
                "sv": "Charter of Old Poland (Chrzanowski 1859)",
                "no": "Charter of Old Poland (Chrzanowski 1859)",
                "fi": "Charter of Old Poland (Chrzanowski 1859)",
                "et": "Charter of Old Poland (Chrzanowski 1859)",
                "lv": "Charter of Old Poland (Chrzanowski 1859)",
                "lt": "Charter of Old Poland (Chrzanowski 1859)",
                "hr": "Charter of Old Poland (Chrzanowski 1859)",
                "sr": "Charter of Old Poland (Chrzanowski 1859)",
                "sl": "Charter of Old Poland (Chrzanowski 1859)",
                "ru": "Charter of Old Poland (Chrzanowski 1859)",
                "sq": "Charter of Old Poland (Chrzanowski 1859)"
            },
            url: CENAGIS.url, layer: 'ihpan:chrzanowski_3857',
            format: 'image/png', transparent: true, version: '1.1.1', crs: 'EPSG:3857',
            tileSize: 256, minZoom: 0, maxZoom: 18, opacity: 0.80,
            attribution: '© Karta Dawnej Polski – Wojciech Chrzanowski (1859) · CENAGIS / IH PAN',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'chrzanowskiMapToggle', slider: 'chrzanowskiMapOpacitySlider', pct: 'chrzanowskiMapPct', fn: 'toggleChrzanowskiMap', var2d: '_chrzanowskiMapLayer', parent: 'histPremiumToggle', wmsHealthKeys: ['chrzanowski'] },
            notes: 'Premium wrapper around CENAGIS chrzanowski_3857.'
        },
        {
            id: 'premium.reymann', group: 'hist-premium', z: 656, kind: 'wms',
            title: {
                "en": "Reymann Special Map (1:200,000)",
                "ro": "Harta Specială Reymann (1:200 000)",
                "de": "Reymann Special Map (1:200,000)",
                "fr": "Reymann Special Map (1:200,000)",
                "it": "Reymann Special Map (1:200,000)",
                "es": "Reymann Special Map (1:200,000)",
                "pl": "Reymann Special Map (1:200,000)",
                "uk": "Reymann Special Map (1:200,000)",
                "hu": "Reymann Special Map (1:200,000)",
                "cs": "Reymann Special Map (1:200,000)",
                "sk": "Reymann Special Map (1:200,000)",
                "nl": "Reymann Special Map (1:200,000)",
                "bg": "Reymann Special Map (1:200,000)",
                "el": "Reymann Special Map (1:200,000)",
                "pt": "Reymann Special Map (1:200,000)",
                "da": "Reymann Special Map (1:200,000)",
                "sv": "Reymann Special Map (1:200,000)",
                "no": "Reymann Special Map (1:200,000)",
                "fi": "Reymann Special Map (1:200,000)",
                "et": "Reymann Special Map (1:200,000)",
                "lv": "Reymann Special Map (1:200,000)",
                "lt": "Reymann Special Map (1:200,000)",
                "hr": "Reymann Special Map (1:200,000)",
                "sr": "Reymann Special Map (1:200,000)",
                "sl": "Reymann Special Map (1:200,000)",
                "ru": "Reymann Special Map (1:200,000)",
                "sq": "Reymann Special Map (1:200,000)"
            },
            url: CENAGIS.url, layer: 'ihpan:reymann_3857',
            format: 'image/png', transparent: true, version: '1.1.1', crs: 'EPSG:3857',
            tileSize: 256, minZoom: 0, maxZoom: 18, opacity: 0.80,
            attribution: '© Reymann\'s Special-Karte von Central-Europa (1806–1908) · CENAGIS / IH PAN',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'reymannMapToggle', slider: 'reymannMapOpacitySlider', pct: 'reymannMapPct', fn: 'toggleReymannMap', var2d: '_reymannMapLayer', parent: 'histPremiumToggle', wmsHealthKeys: ['reymann'] },
            notes: 'Premium wrapper around CENAGIS reymann_3857.'
        },
        {
            id: 'premium.kdr-100k', group: 'hist-premium', z: 657, kind: 'wms',
            title: {
                "en": "Karte des Deutschen Reiches 1:100,000",
                "ro": "Harta Imperiului German 1:100 000 (KDR)",
                "de": "Karte des Deutschen Reiches 1:100,000",
                "fr": "Karte des Deutschen Reiches 1:100,000",
                "it": "Karte des Deutschen Reiches 1:100,000",
                "es": "Karte des Deutschen Reiches 1:100,000",
                "pl": "Karte des Deutschen Reiches 1:100,000",
                "uk": "Karte des Deutschen Reiches 1:100,000",
                "hu": "Karte des Deutschen Reiches 1:100,000",
                "cs": "Karte des Deutschen Reiches 1:100,000",
                "sk": "Karte des Deutschen Reiches 1:100,000",
                "nl": "Karte des Deutschen Reiches 1:100,000",
                "bg": "Karte des Deutschen Reiches 1:100,000",
                "el": "Karte des Deutschen Reiches 1:100,000",
                "pt": "Karte des Deutschen Reiches 1:100,000",
                "da": "Karte des Deutschen Reiches 1:100,000",
                "sv": "Karte des Deutschen Reiches 1:100,000",
                "no": "Karte des Deutschen Reiches 1:100,000",
                "fi": "Karte des Deutschen Reiches 1:100,000",
                "et": "Karte des Deutschen Reiches 1:100,000",
                "lv": "Karte des Deutschen Reiches 1:100,000",
                "lt": "Karte des Deutschen Reiches 1:100,000",
                "hr": "Karte des Deutschen Reiches 1:100,000",
                "sr": "Karte des Deutschen Reiches 1:100,000",
                "sl": "Karte des Deutschen Reiches 1:100,000",
                "ru": "Karte des Deutschen Reiches 1:100,000",
                "sq": "Karte des Deutschen Reiches 1:100,000"
            },
            /* Same catalogue-backed name as `cenagis.kdr` (see above). */
            url: CENAGIS.url, layer: CENAGIS.workspace + ':' + CENAGIS.maps.kdr.wms_layer,
            format: 'image/png', transparent: true, version: '1.1.1', crs: 'EPSG:3857',
            tileSize: 256, minZoom: 0, maxZoom: 18, opacity: 0.80,
            attribution: '© Karte des Deutschen Reiches 1:100 000 (1878–1945) · CENAGIS / IH PAN',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'kdr100kMapToggle', slider: 'kdr100kMapOpacitySlider', pct: 'kdr100kMapPct', fn: 'toggleKdr100kMap', var2d: '_kdr100kMapLayer', parent: 'histPremiumToggle', wmsHealthKeys: ['kdr100k'] },
            notes: 'Premium wrapper around the CENAGIS catalogue sheet cenagis.kdr (' + CENAGIS.maps.kdr.wms_layer + '; the 3857 twin is unreadable at the source — 2026-10-15).'
        },
        {
            id: 'premium.kdr-gb', group: 'hist-premium', z: 658, kind: 'wms',
            title: {
                "en": "German Grossblätter 1:100,000",
                "ro": "Harta Germană Grossblätter 1:100 000",
                "de": "German Grossblätter 1:100,000",
                "fr": "German Grossblätter 1:100,000",
                "it": "German Grossblätter 1:100,000",
                "es": "German Grossblätter 1:100,000",
                "pl": "German Grossblätter 1:100,000",
                "uk": "German Grossblätter 1:100,000",
                "hu": "German Grossblätter 1:100,000",
                "cs": "German Grossblätter 1:100,000",
                "sk": "German Grossblätter 1:100,000",
                "nl": "German Grossblätter 1:100,000",
                "bg": "German Grossblätter 1:100,000",
                "el": "German Grossblätter 1:100,000",
                "pt": "German Grossblätter 1:100,000",
                "da": "German Grossblätter 1:100,000",
                "sv": "German Grossblätter 1:100,000",
                "no": "German Grossblätter 1:100,000",
                "fi": "German Grossblätter 1:100,000",
                "et": "German Grossblätter 1:100,000",
                "lv": "German Grossblätter 1:100,000",
                "lt": "German Grossblätter 1:100,000",
                "hr": "German Grossblätter 1:100,000",
                "sr": "German Grossblätter 1:100,000",
                "sl": "German Grossblätter 1:100,000",
                "ru": "German Grossblätter 1:100,000",
                "sq": "German Grossblätter 1:100,000"
            },
            url: CENAGIS.url, layer: 'ihpan:kdr_gb_3857',
            format: 'image/png', transparent: true, version: '1.1.1', crs: 'EPSG:3857',
            tileSize: 256, minZoom: 0, maxZoom: 18, opacity: 0.80,
            attribution: '© Karte des Deutschen Reiches – Großblatt (1914–1944) · CENAGIS / IH PAN',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'kdrGbMapToggle', slider: 'kdrGbMapOpacitySlider', pct: 'kdrGbMapPct', fn: 'toggleKdrGbMap', var2d: '_kdrGbMapLayer', parent: 'histPremiumToggle', wmsHealthKeys: ['kdrGb'] },
            notes: 'Premium wrapper around CENAGIS kdr_gb_3857.'
        },
        {
            id: 'premium.wig-100k', group: 'hist-premium', z: 659, kind: 'wms',
            title: {
                "en": "WIG Tactical Map 1:100,000",
                "ro": "Harta tactică WIG 1:100 000",
                "de": "WIG Tactical Map 1:100,000",
                "fr": "WIG Tactical Map 1:100,000",
                "it": "WIG Tactical Map 1:100,000",
                "es": "WIG Tactical Map 1:100,000",
                "pl": "WIG Tactical Map 1:100,000",
                "uk": "WIG Tactical Map 1:100,000",
                "hu": "WIG Tactical Map 1:100,000",
                "cs": "WIG Tactical Map 1:100,000",
                "sk": "WIG Tactical Map 1:100,000",
                "nl": "WIG Tactical Map 1:100,000",
                "bg": "WIG Tactical Map 1:100,000",
                "el": "WIG Tactical Map 1:100,000",
                "pt": "WIG Tactical Map 1:100,000",
                "da": "WIG Tactical Map 1:100,000",
                "sv": "WIG Tactical Map 1:100,000",
                "no": "WIG Tactical Map 1:100,000",
                "fi": "WIG Tactical Map 1:100,000",
                "et": "WIG Tactical Map 1:100,000",
                "lv": "WIG Tactical Map 1:100,000",
                "lt": "WIG Tactical Map 1:100,000",
                "hr": "WIG Tactical Map 1:100,000",
                "sr": "WIG Tactical Map 1:100,000",
                "sl": "WIG Tactical Map 1:100,000",
                "ru": "WIG Tactical Map 1:100,000",
                "sq": "WIG Tactical Map 1:100,000"
            },
            url: CENAGIS.url, layer: 'ihpan:wig100k_3857',
            format: 'image/png', transparent: true, version: '1.1.1', crs: 'EPSG:3857',
            tileSize: 256, minZoom: 0, maxZoom: 18, opacity: 0.80,
            attribution: '© Wojskowy Instytut Geograficzny (WIG) 1:100 000 (1919–1939) · CENAGIS / IH PAN',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'wig100kMapToggle', slider: 'wig100kMapOpacitySlider', pct: 'wig100kMapPct', fn: 'toggleWig100kMap', var2d: '_wig100kMapLayer', parent: 'histPremiumToggle', wmsHealthKeys: ['wig100k'] },
            notes: 'Premium wrapper around CENAGIS wig100k_3857.'
        },

        /* ─────────── premium historical maps — United Kingdom (MapTiler) ──── */
        /* Eight Ordnance Survey / Bartholomew pyramids of the British Isles,
         * hosted by MapTiler from the National Library of Scotland collection
         * (maps.nls.uk). The MapTiler key is the same public key the 3D
         * terrain presets use. Zoom windows and bounds are read off each
         * service's TileJSON; the two PNG 'overlay' products carry
         * transparency, the JPG 'baselayer' products are opaque sheets. */
        {
            id: 'premium.uk-os-london-1893', group: 'hist-premium', z: 660, kind: 'xyz',
            title: {
                "en": "Ordnance Survey 1893-1896",
                "ro": "Ordnance Survey 1893-1896",
                "de": "Ordnance Survey 1893-1896",
                "fr": "Ordnance Survey 1893-1896",
                "it": "Ordnance Survey 1893-1896",
                "es": "Ordnance Survey 1893-1896",
                "pl": "Ordnance Survey 1893-1896",
                "uk": "Ordnance Survey 1893-1896",
                "hu": "Ordnance Survey 1893-1896",
                "cs": "Ordnance Survey 1893-1896",
                "sk": "Ordnance Survey 1893-1896",
                "nl": "Ordnance Survey 1893-1896",
                "bg": "Ordnance Survey 1893-1896",
                "el": "Ordnance Survey 1893-1896",
                "pt": "Ordnance Survey 1893-1896",
                "da": "Ordnance Survey 1893-1896",
                "sv": "Ordnance Survey 1893-1896",
                "no": "Ordnance Survey 1893-1896",
                "fi": "Ordnance Survey 1893-1896",
                "et": "Ordnance Survey 1893-1896",
                "lv": "Ordnance Survey 1893-1896",
                "lt": "Ordnance Survey 1893-1896",
                "hr": "Ordnance Survey 1893-1896",
                "sr": "Ordnance Survey 1893-1896",
                "sl": "Ordnance Survey 1893-1896",
                "ru": "Ordnance Survey 1893-1896",
                "sq": "Ordnance Survey 1893-1896"
            },
            url: 'https://api.maptiler.com/tiles/uk-oslondon1k1893/{z}/{x}/{y}.jpg?key=lJtTFcjiimg8ZwMPUfpf',
            tileSize: 256, minZoom: 9, maxZoom: 20, maxNativeZoom: 20, opacity: 0.80,
            bounds: [[51.347988, -0.370763], [51.6159, 0.1047]],
            attribution: '© <a href="https://maps.nls.uk/projects/subscription-api/" target="_blank" rel="noopener noreferrer">National Library of Scotland</a> · Ordnance Survey 1893–1896 · MapTiler',
            cors: 'yes', proxy: 'never',
            ui: { toggle: 'ukOsLondon1893MapToggle', slider: 'ukOsLondon1893MapOpacitySlider', pct: 'ukOsLondon1893MapPct', fn: 'toggleUkOsLondon1893Map', var2d: '_ukOsLondon1893MapLayer', parent: 'histPremiumToggle', maxNativeZoomGlobal: 'UKOSLONDON1893_TILE_MAX_NATIVE_Z' },
            notes: 'MapTiler uk-oslondon1k1893 — OS five-foot London (1:1,056), 729 sheets, survey of 1891–5. JPG baselayer, native z9–20.'
        },
        {
            id: 'premium.uk-os-gb-1919', group: 'hist-premium', z: 661, kind: 'xyz',
            title: {
                "en": "Ordnance Survey Historical Maps 1919-1947",
                "ro": "Ordnance Survey Historical Maps 1919-1947",
                "de": "Ordnance Survey Historical Maps 1919-1947",
                "fr": "Ordnance Survey Historical Maps 1919-1947",
                "it": "Ordnance Survey Historical Maps 1919-1947",
                "es": "Ordnance Survey Historical Maps 1919-1947",
                "pl": "Ordnance Survey Historical Maps 1919-1947",
                "uk": "Ordnance Survey Historical Maps 1919-1947",
                "hu": "Ordnance Survey Historical Maps 1919-1947",
                "cs": "Ordnance Survey Historical Maps 1919-1947",
                "sk": "Ordnance Survey Historical Maps 1919-1947",
                "nl": "Ordnance Survey Historical Maps 1919-1947",
                "bg": "Ordnance Survey Historical Maps 1919-1947",
                "el": "Ordnance Survey Historical Maps 1919-1947",
                "pt": "Ordnance Survey Historical Maps 1919-1947",
                "da": "Ordnance Survey Historical Maps 1919-1947",
                "sv": "Ordnance Survey Historical Maps 1919-1947",
                "no": "Ordnance Survey Historical Maps 1919-1947",
                "fi": "Ordnance Survey Historical Maps 1919-1947",
                "et": "Ordnance Survey Historical Maps 1919-1947",
                "lv": "Ordnance Survey Historical Maps 1919-1947",
                "lt": "Ordnance Survey Historical Maps 1919-1947",
                "hr": "Ordnance Survey Historical Maps 1919-1947",
                "sr": "Ordnance Survey Historical Maps 1919-1947",
                "sl": "Ordnance Survey Historical Maps 1919-1947",
                "ru": "Ordnance Survey Historical Maps 1919-1947",
                "sq": "Ordnance Survey Historical Maps 1919-1947"
            },
            url: 'https://api.maptiler.com/tiles/uk-osgb1919/{z}/{x}/{y}.jpg?key=lJtTFcjiimg8ZwMPUfpf',
            tileSize: 256, minZoom: 1, maxZoom: 20, maxNativeZoom: 14, opacity: 0.80,
            bounds: [[49.84945588, -9.25728709], [60.89106986, 2.12770424]],
            attribution: '© <a href="https://maps.nls.uk/projects/subscription-api/" target="_blank" rel="noopener noreferrer">National Library of Scotland</a> · Ordnance Survey 1919–1947 · MapTiler',
            cors: 'yes', proxy: 'never',
            ui: { toggle: 'ukOs1919MapToggle', slider: 'ukOs1919MapOpacitySlider', pct: 'ukOs1919MapPct', fn: 'toggleUkOs1919Map', var2d: '_ukOs1919MapLayer', parent: 'histPremiumToggle', maxNativeZoomGlobal: 'UKOS1919_TILE_MAX_NATIVE_Z' },
            notes: 'MapTiler uk-osgb1919 — UK Ordnance Survey Historical Maps 1919–1947. JPG baselayer, native z1–14.'
        },
        {
            id: 'premium.uk-os-10k-1888', group: 'hist-premium', z: 662, kind: 'xyz',
            title: {
                "en": "Ordnance Survey 1888-1913",
                "ro": "Ordnance Survey 1888-1913",
                "de": "Ordnance Survey 1888-1913",
                "fr": "Ordnance Survey 1888-1913",
                "it": "Ordnance Survey 1888-1913",
                "es": "Ordnance Survey 1888-1913",
                "pl": "Ordnance Survey 1888-1913",
                "uk": "Ordnance Survey 1888-1913",
                "hu": "Ordnance Survey 1888-1913",
                "cs": "Ordnance Survey 1888-1913",
                "sk": "Ordnance Survey 1888-1913",
                "nl": "Ordnance Survey 1888-1913",
                "bg": "Ordnance Survey 1888-1913",
                "el": "Ordnance Survey 1888-1913",
                "pt": "Ordnance Survey 1888-1913",
                "da": "Ordnance Survey 1888-1913",
                "sv": "Ordnance Survey 1888-1913",
                "no": "Ordnance Survey 1888-1913",
                "fi": "Ordnance Survey 1888-1913",
                "et": "Ordnance Survey 1888-1913",
                "lv": "Ordnance Survey 1888-1913",
                "lt": "Ordnance Survey 1888-1913",
                "hr": "Ordnance Survey 1888-1913",
                "sr": "Ordnance Survey 1888-1913",
                "sl": "Ordnance Survey 1888-1913",
                "ru": "Ordnance Survey 1888-1913",
                "sq": "Ordnance Survey 1888-1913"
            },
            url: 'https://api.maptiler.com/tiles/uk-osgb10k1888/{z}/{x}/{y}.jpg?key=lJtTFcjiimg8ZwMPUfpf',
            tileSize: 256, minZoom: 1, maxZoom: 20, maxNativeZoom: 17, opacity: 0.80,
            bounds: [[49.852539, -7.793077], [60.894042, 1.790425]],
            attribution: '© <a href="https://maps.nls.uk/projects/subscription-api/" target="_blank" rel="noopener noreferrer">National Library of Scotland</a> · Ordnance Survey County Series six-inch 1888–1913 · MapTiler',
            cors: 'yes', proxy: 'never',
            ui: { toggle: 'ukOs10k1888MapToggle', slider: 'ukOs10k1888MapOpacitySlider', pct: 'ukOs10k1888MapPct', fn: 'toggleUkOs10k1888Map', var2d: '_ukOs10k1888MapLayer', parent: 'histPremiumToggle', maxNativeZoomGlobal: 'UKOS10K1888_TILE_MAX_NATIVE_Z' },
            notes: 'MapTiler uk-osgb10k1888 — OS County Series six-inch to the mile (1:10,560), 2nd edition. JPG baselayer, native z1–17.'
        },
        {
            id: 'premium.uk-os-25k-1937', group: 'hist-premium', z: 663, kind: 'xyz',
            title: {
                "en": "Ordnance Survey 1937-1961",
                "ro": "Ordnance Survey 1937-1961",
                "de": "Ordnance Survey 1937-1961",
                "fr": "Ordnance Survey 1937-1961",
                "it": "Ordnance Survey 1937-1961",
                "es": "Ordnance Survey 1937-1961",
                "pl": "Ordnance Survey 1937-1961",
                "uk": "Ordnance Survey 1937-1961",
                "hu": "Ordnance Survey 1937-1961",
                "cs": "Ordnance Survey 1937-1961",
                "sk": "Ordnance Survey 1937-1961",
                "nl": "Ordnance Survey 1937-1961",
                "bg": "Ordnance Survey 1937-1961",
                "el": "Ordnance Survey 1937-1961",
                "pt": "Ordnance Survey 1937-1961",
                "da": "Ordnance Survey 1937-1961",
                "sv": "Ordnance Survey 1937-1961",
                "no": "Ordnance Survey 1937-1961",
                "fi": "Ordnance Survey 1937-1961",
                "et": "Ordnance Survey 1937-1961",
                "lv": "Ordnance Survey 1937-1961",
                "lt": "Ordnance Survey 1937-1961",
                "hr": "Ordnance Survey 1937-1961",
                "sr": "Ordnance Survey 1937-1961",
                "sl": "Ordnance Survey 1937-1961",
                "ru": "Ordnance Survey 1937-1961",
                "sq": "Ordnance Survey 1937-1961"
            },
            url: 'https://api.maptiler.com/tiles/uk-osgb25k1937/{z}/{x}/{y}.jpg?key=lJtTFcjiimg8ZwMPUfpf',
            tileSize: 256, minZoom: 1, maxZoom: 20, maxNativeZoom: 16, opacity: 0.80,
            bounds: [[49.79634, -6.48436], [58.718087, 1.856328]],
            attribution: '© <a href="https://maps.nls.uk/projects/subscription-api/" target="_blank" rel="noopener noreferrer">National Library of Scotland</a> · Ordnance Survey Provisional edition 1:25,000 1937–1961 · MapTiler',
            cors: 'yes', proxy: 'never',
            ui: { toggle: 'ukOs25k1937MapToggle', slider: 'ukOs25k1937MapOpacitySlider', pct: 'ukOs25k1937MapPct', fn: 'toggleUkOs25k1937Map', var2d: '_ukOs25k1937MapLayer', parent: 'histPremiumToggle', maxNativeZoomGlobal: 'UKOS25K1937_TILE_MAX_NATIVE_Z' },
            notes: 'MapTiler uk-osgb25k1937 — OS Provisional edition 1:25,000 (forerunner of Explorer/Outdoor Leisure). JPG baselayer, native z1–16.'
        },
        {
            id: 'premium.uk-os-hills-1885', group: 'hist-premium', z: 664, kind: 'xyz',
            title: {
                "en": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "ro": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "de": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "fr": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "it": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "es": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "pl": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "uk": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "hu": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "cs": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "sk": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "nl": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "bg": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "el": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "pt": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "da": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "sv": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "no": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "fi": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "et": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "lv": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "lt": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "hr": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "sr": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "sl": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "ru": "Ordnance Survey, 'Hills' edition, 1885-1903",
                "sq": "Ordnance Survey, 'Hills' edition, 1885-1903"
            },
            url: 'https://api.maptiler.com/tiles/uk-osgb63k1885/{z}/{x}/{y}.png?key=lJtTFcjiimg8ZwMPUfpf',
            tileSize: 256, minZoom: 1, maxZoom: 20, maxNativeZoom: 16, opacity: 0.80,
            bounds: [[49.767508, -8.208189], [61.003313, 1.885168]],
            attribution: '© <a href="https://maps.nls.uk/projects/subscription-api/" target="_blank" rel="noopener noreferrer">National Library of Scotland</a> · Ordnance Survey one-inch Hills edition 1885–1903 · MapTiler',
            cors: 'yes', proxy: 'never',
            ui: { toggle: 'ukOsHills1885MapToggle', slider: 'ukOsHills1885MapOpacitySlider', pct: 'ukOsHills1885MapPct', fn: 'toggleUkOsHills1885Map', var2d: '_ukOsHills1885MapLayer', parent: 'histPremiumToggle', maxNativeZoomGlobal: 'UKOSHILLS1885_TILE_MAX_NATIVE_Z' },
            notes: 'MapTiler uk-osgb63k1885 — OS one-inch (1:63,360) Revised New Series / Scotland 2nd edition (Hills). Transparent PNG overlay, native z1–16.'
        },
        {
            id: 'premium.uk-os-63k-1955', group: 'hist-premium', z: 665, kind: 'xyz',
            title: {
                "en": "Ordnance Survey 1955-1961",
                "ro": "Ordnance Survey 1955-1961",
                "de": "Ordnance Survey 1955-1961",
                "fr": "Ordnance Survey 1955-1961",
                "it": "Ordnance Survey 1955-1961",
                "es": "Ordnance Survey 1955-1961",
                "pl": "Ordnance Survey 1955-1961",
                "uk": "Ordnance Survey 1955-1961",
                "hu": "Ordnance Survey 1955-1961",
                "cs": "Ordnance Survey 1955-1961",
                "sk": "Ordnance Survey 1955-1961",
                "nl": "Ordnance Survey 1955-1961",
                "bg": "Ordnance Survey 1955-1961",
                "el": "Ordnance Survey 1955-1961",
                "pt": "Ordnance Survey 1955-1961",
                "da": "Ordnance Survey 1955-1961",
                "sv": "Ordnance Survey 1955-1961",
                "no": "Ordnance Survey 1955-1961",
                "fi": "Ordnance Survey 1955-1961",
                "et": "Ordnance Survey 1955-1961",
                "lv": "Ordnance Survey 1955-1961",
                "lt": "Ordnance Survey 1955-1961",
                "hr": "Ordnance Survey 1955-1961",
                "sr": "Ordnance Survey 1955-1961",
                "sl": "Ordnance Survey 1955-1961",
                "ru": "Ordnance Survey 1955-1961",
                "sq": "Ordnance Survey 1955-1961"
            },
            url: 'https://api.maptiler.com/tiles/uk-osgb63k1955/{z}/{x}/{y}.jpg?key=lJtTFcjiimg8ZwMPUfpf',
            tileSize: 256, minZoom: 1, maxZoom: 20, maxNativeZoom: 15, opacity: 0.80,
            bounds: [[49.853151, -8.684076], [60.87018, 1.845546]],
            attribution: '© <a href="https://maps.nls.uk/projects/subscription-api/" target="_blank" rel="noopener noreferrer">National Library of Scotland</a> · Ordnance Survey Seventh Series 1:63,360 1955–1961 · MapTiler',
            cors: 'yes', proxy: 'never',
            ui: { toggle: 'ukOs63k1955MapToggle', slider: 'ukOs63k1955MapOpacitySlider', pct: 'ukOs63k1955MapPct', fn: 'toggleUkOs63k1955Map', var2d: '_ukOs63k1955MapLayer', parent: 'histPremiumToggle', maxNativeZoomGlobal: 'UKOS63K1955_TILE_MAX_NATIVE_Z' },
            notes: 'MapTiler uk-osgb63k1955 — OS One-Inch Seventh Series (forerunner of Landranger). JPG baselayer, native z1–15.'
        },
        {
            id: 'premium.uk-os-1900s', group: 'hist-premium', z: 666, kind: 'xyz',
            title: {
                "en": "Ordnance Survey 1900s",
                "ro": "Ordnance Survey 1900s",
                "de": "Ordnance Survey 1900s",
                "fr": "Ordnance Survey 1900s",
                "it": "Ordnance Survey 1900s",
                "es": "Ordnance Survey 1900s",
                "pl": "Ordnance Survey 1900s",
                "uk": "Ordnance Survey 1900s",
                "hu": "Ordnance Survey 1900s",
                "cs": "Ordnance Survey 1900s",
                "sk": "Ordnance Survey 1900s",
                "nl": "Ordnance Survey 1900s",
                "bg": "Ordnance Survey 1900s",
                "el": "Ordnance Survey 1900s",
                "pt": "Ordnance Survey 1900s",
                "da": "Ordnance Survey 1900s",
                "sv": "Ordnance Survey 1900s",
                "no": "Ordnance Survey 1900s",
                "fi": "Ordnance Survey 1900s",
                "et": "Ordnance Survey 1900s",
                "lv": "Ordnance Survey 1900s",
                "lt": "Ordnance Survey 1900s",
                "hr": "Ordnance Survey 1900s",
                "sr": "Ordnance Survey 1900s",
                "sl": "Ordnance Survey 1900s",
                "ru": "Ordnance Survey 1900s",
                "sq": "Ordnance Survey 1900s"
            },
            /* 'hybrid' product: the TileJSON ships an extensionless template,
             * MapTiler content-negotiates the image format per tile. */
            url: 'https://api.maptiler.com/tiles/uk-osgb1888/{z}/{x}/{y}?key=lJtTFcjiimg8ZwMPUfpf',
            tileSize: 256, minZoom: 1, maxZoom: 20, maxNativeZoom: 17, opacity: 0.80,
            bounds: [[49.205882, -14.169172], [61.483786, 4.393046]],
            attribution: '© <a href="https://maps.nls.uk/projects/subscription-api/" target="_blank" rel="noopener noreferrer">National Library of Scotland</a> · Ordnance Survey seamless multi-scale series c.1900 · MapTiler',
            cors: 'yes', proxy: 'never',
            ui: { toggle: 'ukOs1900sMapToggle', slider: 'ukOs1900sMapOpacitySlider', pct: 'ukOs1900sMapPct', fn: 'toggleUkOs1900sMap', var2d: '_ukOs1900sMapLayer', parent: 'histPremiumToggle', maxNativeZoomGlobal: 'UKOS1900S_TILE_MAX_NATIVE_Z' },
            notes: 'MapTiler uk-osgb1888 — five seamless OS scales (1:1m–1:10,560) from around 1900. Hybrid format, extensionless tile template, native z1–17.'
        },
        {
            id: 'premium.uk-bartholomew-ireland-1940', group: 'hist-premium', z: 667, kind: 'xyz',
            title: {
                "en": "UK Bartholomew Ireland 1940s",
                "ro": "UK Bartholomew Ireland 1940s",
                "de": "UK Bartholomew Ireland 1940s",
                "fr": "UK Bartholomew Ireland 1940s",
                "it": "UK Bartholomew Ireland 1940s",
                "es": "UK Bartholomew Ireland 1940s",
                "pl": "UK Bartholomew Ireland 1940s",
                "uk": "UK Bartholomew Ireland 1940s",
                "hu": "UK Bartholomew Ireland 1940s",
                "cs": "UK Bartholomew Ireland 1940s",
                "sk": "UK Bartholomew Ireland 1940s",
                "nl": "UK Bartholomew Ireland 1940s",
                "bg": "UK Bartholomew Ireland 1940s",
                "el": "UK Bartholomew Ireland 1940s",
                "pt": "UK Bartholomew Ireland 1940s",
                "da": "UK Bartholomew Ireland 1940s",
                "sv": "UK Bartholomew Ireland 1940s",
                "no": "UK Bartholomew Ireland 1940s",
                "fi": "UK Bartholomew Ireland 1940s",
                "et": "UK Bartholomew Ireland 1940s",
                "lv": "UK Bartholomew Ireland 1940s",
                "lt": "UK Bartholomew Ireland 1940s",
                "hr": "UK Bartholomew Ireland 1940s",
                "sr": "UK Bartholomew Ireland 1940s",
                "sl": "UK Bartholomew Ireland 1940s",
                "ru": "UK Bartholomew Ireland 1940s",
                "sq": "UK Bartholomew Ireland 1940s"
            },
            url: 'https://api.maptiler.com/tiles/uk-baire250k1940/{z}/{x}/{y}.png?key=lJtTFcjiimg8ZwMPUfpf',
            tileSize: 256, minZoom: 5, maxZoom: 20, maxNativeZoom: 12, opacity: 0.80,
            bounds: [[51.312374, -10.670794], [55.451952, -5.358557]],
            attribution: '© <a href="https://maps.nls.uk/projects/subscription-api/" target="_blank" rel="noopener noreferrer">National Library of Scotland</a> · Bartholomew Ireland Quarter-Inch 1940s · MapTiler',
            cors: 'yes', proxy: 'never',
            ui: { toggle: 'ukBaire1940MapToggle', slider: 'ukBaire1940MapOpacitySlider', pct: 'ukBaire1940MapPct', fn: 'toggleUkBaire1940Map', var2d: '_ukBaire1940MapLayer', parent: 'histPremiumToggle', maxNativeZoomGlobal: 'UKBAIRE1940_TILE_MAX_NATIVE_Z' },
            notes: 'MapTiler uk-baire250k1940 — Bartholomew Quarter-Inch Ireland, maps published 1940. Transparent PNG overlay, native z5–12.'
        },

        /* ───────────────────────── CORONA (1960s) ──────────────────────────── */
        {
            id: 'sat.corona-60s', group: 'hist-sat', z: 648, kind: 'dynamic',
            title: {
                "en": "Satellite imagery 60s (CORONA)",
                "ro": "Imagini satelitare 60's (CORONA)",
                "de": "Satellit 60s (CORONA)",
                "fr": "Satellite 60s (CORONA)",
                "it": "Satellite 60s (CORONA)",
                "es": "Satélite 60s (CORONA)",
                "pl": "Satelita 60s (CORONA)",
                "uk": "Супутник 60s (CORONA)",
                "hu": "Műhold 60s (CORONA)",
                "cs": "Satelit 60s (CORONA)",
                "sk": "Satelit 60s (CORONA)",
                "nl": "Satelliet 60s (CORONA)",
                "bg": "Сателит 60s (CORONA)",
                "el": "Δορυφόρος 60s (CORONA)",
                "pt": "Satélite 60s (CORONA)",
                "da": "Satellit 60s (CORONA)",
                "sv": "Satellit 60s (CORONA)",
                "no": "Satellitt 60s (CORONA)",
                "fi": "Satelliitti 60s (CORONA)",
                "et": "Satelliit 60s (CORONA)",
                "lv": "Satelīts 60s (CORONA)",
                "lt": "Palydovas 60s (CORONA)",
                "hr": "Satelit 60s (CORONA)",
                "sr": "Satelit 60s (CORONA)",
                "sl": "Satelit 60s (CORONA)",
                "ru": "Спутник 60s (CORONA)",
                "sq": "Satellite imagery 60s (CORONA)"
            },
            /* One MapLibre raster source PER CORONA product, built at runtime from
             * the catalogue (js/corona-wms-layer.js) — see map3d-terrain.js. */
            url: 'https://geoserve.cast.uark.edu/geoserver/gwc/service/wms',
            layer: 'corona:<product>',
            format: 'image/png', transparent: true, version: '1.1.1', crs: 'EPSG:900913',
            params: { tiled: 'true' },
            tileSize: 256, minZoom: 8, maxZoom: 20, opacity: 0.85,
            cors: 'no', proxy: 'always',
            ui: { toggle: 'satellite60sMapToggle', slider: 'satellite60sMapOpacitySlider', pct: 'satellite60sMapPct', fn: 'toggleSatellite60sMap', var2d: '_sat60MapLayer', parent: 'histPremiumToggle' },
            notes: 'CAST University of Arkansas GeoWebCache (WMS-C). Sends no CORS header (SATELLITE_60s_FIX.md) ' +
                'so 3D always goes through the same-origin proxy. Pass mosaics at z8–z11, individual frames z12–z20.'
        },

        /* ──────────── historical / recent satellite mosaics (Copernicus) ──── */
        {
            id: 'sat.vhr-2012', group: 'sat-hist', z: 400, kind: 'wms', time: null,
            title: {
                "en": "Satellite 2012 (Copernicus VHR)",
                "ro": "Satelit 2012 (Copernicus VHR)",
                "de": "Satellite 2012 (Copernicus VHR)",
                "fr": "Satellite 2012 (Copernicus VHR)",
                "it": "Satellite 2012 (Copernicus VHR)",
                "es": "Satellite 2012 (Copernicus VHR)",
                "pl": "Satellite 2012 (Copernicus VHR)",
                "uk": "Satellite 2012 (Copernicus VHR)",
                "hu": "Satellite 2012 (Copernicus VHR)",
                "cs": "Satellite 2012 (Copernicus VHR)",
                "sk": "Satellite 2012 (Copernicus VHR)",
                "nl": "Satellite 2012 (Copernicus VHR)",
                "bg": "Satellite 2012 (Copernicus VHR)",
                "el": "Satellite 2012 (Copernicus VHR)",
                "pt": "Satellite 2012 (Copernicus VHR)",
                "da": "Satellite 2012 (Copernicus VHR)",
                "sv": "Satellite 2012 (Copernicus VHR)",
                "no": "Satellite 2012 (Copernicus VHR)",
                "fi": "Satellite 2012 (Copernicus VHR)",
                "et": "Satellite 2012 (Copernicus VHR)",
                "lv": "Satellite 2012 (Copernicus VHR)",
                "lt": "Satellite 2012 (Copernicus VHR)",
                "hr": "Satellite 2012 (Copernicus VHR)",
                "sr": "Satellite 2012 (Copernicus VHR)",
                "sl": "Satellite 2012 (Copernicus VHR)",
                "ru": "Satellite 2012 (Copernicus VHR)",
                "sq": "Satellite 2012 (Copernicus VHR)"
            },
            url: 'https://copernicus.discomap.eea.europa.eu/arcgis/services/GioLand/VeryHighResolution2012/MapServer/WMSServer',
            layer: 'Image', format: 'image/jpeg', transparent: false, version: '1.1.1', crs: 'EPSG:3857',
            tileSize: 256, minZoom: 1, maxZoom: 20, maxNativeZoom: 17, opacity: 1,
            attribution: "&copy; European Union's Copernicus Land Monitoring Service information",
            cors: 'no', proxy: 'always',
            ui: { select: 'satHistPeriod', slider: 'satHistOpacitySlider', pct: 'satHistOpacityPct', fn: 'setSatHistPeriod' },
            notes: 'EEA discomap ArcGIS WMSServer. The 2D code loads it without crossOrigin because ' +
                'discomap does not guarantee CORS headers — 3D therefore uses the proxy.'
        },
        {
            id: 'sat.vhr-2018', group: 'sat-hist', z: 401, kind: 'wms',
            title: {
                "en": "Satellite 2018 (Copernicus VHR)",
                "ro": "Satelit 2018 (Copernicus VHR)",
                "de": "Satellite 2018 (Copernicus VHR)",
                "fr": "Satellite 2018 (Copernicus VHR)",
                "it": "Satellite 2018 (Copernicus VHR)",
                "es": "Satellite 2018 (Copernicus VHR)",
                "pl": "Satellite 2018 (Copernicus VHR)",
                "uk": "Satellite 2018 (Copernicus VHR)",
                "hu": "Satellite 2018 (Copernicus VHR)",
                "cs": "Satellite 2018 (Copernicus VHR)",
                "sk": "Satellite 2018 (Copernicus VHR)",
                "nl": "Satellite 2018 (Copernicus VHR)",
                "bg": "Satellite 2018 (Copernicus VHR)",
                "el": "Satellite 2018 (Copernicus VHR)",
                "pt": "Satellite 2018 (Copernicus VHR)",
                "da": "Satellite 2018 (Copernicus VHR)",
                "sv": "Satellite 2018 (Copernicus VHR)",
                "no": "Satellite 2018 (Copernicus VHR)",
                "fi": "Satellite 2018 (Copernicus VHR)",
                "et": "Satellite 2018 (Copernicus VHR)",
                "lv": "Satellite 2018 (Copernicus VHR)",
                "lt": "Satellite 2018 (Copernicus VHR)",
                "hr": "Satellite 2018 (Copernicus VHR)",
                "sr": "Satellite 2018 (Copernicus VHR)",
                "sl": "Satellite 2018 (Copernicus VHR)",
                "ru": "Satellite 2018 (Copernicus VHR)",
                "sq": "Satellite 2018 (Copernicus VHR)"
            },
            url: 'https://image.discomap.eea.europa.eu/arcgis/services/GioLand/VHR_2018_WM/ImageServer/WMSServer',
            layer: 'VHR_2018_WM', format: 'image/jpeg', transparent: false, version: '1.1.1', crs: 'EPSG:3857',
            tileSize: 256, minZoom: 1, maxZoom: 20, maxNativeZoom: 17, opacity: 1,
            attribution: "&copy; European Union's Copernicus Land Monitoring Service information",
            cors: 'no', proxy: 'always',
            ui: { select: 'satHistPeriod', slider: 'satHistOpacitySlider', pct: 'satHistOpacityPct', fn: 'setSatHistPeriod' },
            notes: 'EEA discomap — no guaranteed CORS, 3D uses the proxy.'
        },
        {
            id: 'sat.vhr-2021', group: 'sat-hist', z: 402, kind: 'wms',
            title: {
                "en": "Satellite 2021 (Copernicus VHR)",
                "ro": "Satelit 2021 (Copernicus VHR)",
                "de": "Satellite 2021 (Copernicus VHR)",
                "fr": "Satellite 2021 (Copernicus VHR)",
                "it": "Satellite 2021 (Copernicus VHR)",
                "es": "Satellite 2021 (Copernicus VHR)",
                "pl": "Satellite 2021 (Copernicus VHR)",
                "uk": "Satellite 2021 (Copernicus VHR)",
                "hu": "Satellite 2021 (Copernicus VHR)",
                "cs": "Satellite 2021 (Copernicus VHR)",
                "sk": "Satellite 2021 (Copernicus VHR)",
                "nl": "Satellite 2021 (Copernicus VHR)",
                "bg": "Satellite 2021 (Copernicus VHR)",
                "el": "Satellite 2021 (Copernicus VHR)",
                "pt": "Satellite 2021 (Copernicus VHR)",
                "da": "Satellite 2021 (Copernicus VHR)",
                "sv": "Satellite 2021 (Copernicus VHR)",
                "no": "Satellite 2021 (Copernicus VHR)",
                "fi": "Satellite 2021 (Copernicus VHR)",
                "et": "Satellite 2021 (Copernicus VHR)",
                "lv": "Satellite 2021 (Copernicus VHR)",
                "lt": "Satellite 2021 (Copernicus VHR)",
                "hr": "Satellite 2021 (Copernicus VHR)",
                "sr": "Satellite 2021 (Copernicus VHR)",
                "sl": "Satellite 2021 (Copernicus VHR)",
                "ru": "Satellite 2021 (Copernicus VHR)",
                "sq": "Satellite 2021 (Copernicus VHR)"
            },
            url: 'https://image.discomap.eea.europa.eu/arcgis/services/GioLand/VHR_2021_LAEA/ImageServer/WMSServer',
            layer: 'VHR_2021_LAEA', format: 'image/jpeg', transparent: false, version: '1.1.1', crs: 'EPSG:3857',
            tileSize: 256, minZoom: 1, maxZoom: 20, maxNativeZoom: 17, opacity: 1,
            attribution: "&copy; European Union's Copernicus Land Monitoring Service information",
            cors: 'no', proxy: 'always',
            ui: { select: 'satHistPeriod', slider: 'satHistOpacitySlider', pct: 'satHistOpacityPct', fn: 'setSatHistPeriod' },
            notes: 'EEA discomap — source really is LAEA; the proxy asks for EPSG:3857 (WMS 1.1.1 SRS, ' +
                'ArcGIS reprojects server-side). If the service ever refuses, override crs to EPSG:3035 ' +
                'and the proxy will transform the tile bbox.'
        },

        /* ─────────────────────────────── LiDAR ─────────────────────────────── */
        {
            id: 'lidar.nl-ahn', group: 'lidar', z: 610, kind: 'dynamic',
            /* builder: how the module in js/ turns one tile into one URL. */
            builder: { module: 'AhnLidar', fn: 'exportImageUrl', kind: 'bbox' },   /* URL builder needs the tile bbox instead of z/x/y substitution */
            title: {
                "en": "Netherlands · AHN (DTM/DSM)",
                "ro": "Țările de Jos · AHN (DTM/DSM)",
                "de": "Netherlands · AHN (DTM/DSM)",
                "fr": "Netherlands · AHN (DTM/DSM)",
                "it": "Netherlands · AHN (DTM/DSM)",
                "es": "Netherlands · AHN (DTM/DSM)",
                "pl": "Netherlands · AHN (DTM/DSM)",
                "uk": "Netherlands · AHN (DTM/DSM)",
                "hu": "Netherlands · AHN (DTM/DSM)",
                "cs": "Netherlands · AHN (DTM/DSM)",
                "sk": "Netherlands · AHN (DTM/DSM)",
                "nl": "Netherlands · AHN (DTM/DSM)",
                "bg": "Netherlands · AHN (DTM/DSM)",
                "el": "Netherlands · AHN (DTM/DSM)",
                "pt": "Netherlands · AHN (DTM/DSM)",
                "da": "Netherlands · AHN (DTM/DSM)",
                "sv": "Netherlands · AHN (DTM/DSM)",
                "no": "Netherlands · AHN (DTM/DSM)",
                "fi": "Netherlands · AHN (DTM/DSM)",
                "et": "Netherlands · AHN (DTM/DSM)",
                "lv": "Netherlands · AHN (DTM/DSM)",
                "lt": "Netherlands · AHN (DTM/DSM)",
                "hr": "Netherlands · AHN (DTM/DSM)",
                "sr": "Netherlands · AHN (DTM/DSM)",
                "sl": "Netherlands · AHN (DTM/DSM)",
                "ru": "Netherlands · AHN (DTM/DSM)",
                "sq": "Netherlands · AHN (DTM/DSM)"
            },
            url: 'https://ahn.arcgisonline.nl/arcgis/rest/services/Hoogtebestand',
            layer: 'exportImage', format: 'image/png', transparent: true, version: '',
            tileSize: 256, minZoom: 6, maxZoom: 20, opacity: 1,
            attribution: '© AHN / Esri Nederland',
            cors: 'yes', proxy: 'auto',
            resolve: function () {
                var mod = root && root.AhnLidar;
                if (!mod || typeof mod.tileUrl !== 'function') return null;
                return { mode: moduleMode('netherlandsLidarModeSelect'), module: 'AhnLidar' };
            },
            ui: { toggle: 'lidarNlAhnToggle', select: 'netherlandsLidarModeSelect' },
            notes: 'ArcGIS ImageServer exportImage (hillshade/relief/slope/DSM renderers, mode dropdown). ' +
                'URL builder lives in js/ahn-layer.js — the registry points at it, nothing is duplicated.'
        },
        {
            id: 'lidar.no-hoydedata', group: 'lidar', z: 610, kind: 'dynamic',
            /* builder: how the module in js/ turns one tile into one URL. */
            builder: { module: 'Hoydedata', fn: 'exportImageUrl', kind: 'bbox' },   /* URL builder needs the tile bbox instead of z/x/y substitution */
            title: {
                "en": "Norway · Kartverket Høydedata",
                "ro": "Norvegia · Kartverket Høydedata",
                "de": "Norway · Kartverket Høydedata",
                "fr": "Norway · Kartverket Høydedata",
                "it": "Norway · Kartverket Høydedata",
                "es": "Norway · Kartverket Høydedata",
                "pl": "Norway · Kartverket Høydedata",
                "uk": "Norway · Kartverket Høydedata",
                "hu": "Norway · Kartverket Høydedata",
                "cs": "Norway · Kartverket Høydedata",
                "sk": "Norway · Kartverket Høydedata",
                "nl": "Norway · Kartverket Høydedata",
                "bg": "Norway · Kartverket Høydedata",
                "el": "Norway · Kartverket Høydedata",
                "pt": "Norway · Kartverket Høydedata",
                "da": "Norway · Kartverket Høydedata",
                "sv": "Norway · Kartverket Høydedata",
                "no": "Norway · Kartverket Høydedata",
                "fi": "Norway · Kartverket Høydedata",
                "et": "Norway · Kartverket Høydedata",
                "lv": "Norway · Kartverket Høydedata",
                "lt": "Norway · Kartverket Høydedata",
                "hr": "Norway · Kartverket Høydedata",
                "sr": "Norway · Kartverket Høydedata",
                "sl": "Norway · Kartverket Høydedata",
                "ru": "Norway · Kartverket Høydedata",
                "sq": "Norway · Kartverket Høydedata"
            },
            url: 'https://hoydedata.no/arcgis/rest/services',
            layer: 'exportImage', format: 'image/png', transparent: true,
            tileSize: 256, minZoom: 6, maxZoom: 20, opacity: 1,
            attribution: '© Kartverket (høydedata.no)',
            cors: 'yes', proxy: 'auto',
            resolve: function () {
                var mod = root && root.Hoydedata;
                if (!mod || typeof mod.tileUrl !== 'function') return null;
                return { mode: moduleMode('norwayLidarModeSelect'), module: 'Hoydedata' };
            },
            ui: { toggle: 'lidarNoHoydedataToggle', select: 'norwayLidarModeSelect' },
            notes: 'ArcGIS ImageServer (DTM/DSM/LAZ relief). URL builder: js/hoydedata-layer.js.'
        },
        {
            id: 'lidar.pl-nmt', group: 'lidar', z: 610, kind: 'dynamic',
            /* builder: how the module in js/ turns one tile into one URL. */
            builder: { module: 'GeoportalNMT', fn: 'tileUrl', kind: 'bbox' },   /* URL builder needs the tile bbox instead of z/x/y substitution */
            title: {
                "en": "Poland · GUGiK NMT (shading/hypsometry)",
                "ro": "Polonia · GUGiK NMT (cieniowanie/hipsometria)",
                "de": "Poland · GUGiK NMT (shading/hypsometry)",
                "fr": "Poland · GUGiK NMT (shading/hypsometry)",
                "it": "Poland · GUGiK NMT (shading/hypsometry)",
                "es": "Poland · GUGiK NMT (shading/hypsometry)",
                "pl": "Poland · GUGiK NMT (shading/hypsometry)",
                "uk": "Poland · GUGiK NMT (shading/hypsometry)",
                "hu": "Poland · GUGiK NMT (shading/hypsometry)",
                "cs": "Poland · GUGiK NMT (shading/hypsometry)",
                "sk": "Poland · GUGiK NMT (shading/hypsometry)",
                "nl": "Poland · GUGiK NMT (shading/hypsometry)",
                "bg": "Poland · GUGiK NMT (shading/hypsometry)",
                "el": "Poland · GUGiK NMT (shading/hypsometry)",
                "pt": "Poland · GUGiK NMT (shading/hypsometry)",
                "da": "Poland · GUGiK NMT (shading/hypsometry)",
                "sv": "Poland · GUGiK NMT (shading/hypsometry)",
                "no": "Poland · GUGiK NMT (shading/hypsometry)",
                "fi": "Poland · GUGiK NMT (shading/hypsometry)",
                "et": "Poland · GUGiK NMT (shading/hypsometry)",
                "lv": "Poland · GUGiK NMT (shading/hypsometry)",
                "lt": "Poland · GUGiK NMT (shading/hypsometry)",
                "hr": "Poland · GUGiK NMT (shading/hypsometry)",
                "sr": "Poland · GUGiK NMT (shading/hypsometry)",
                "sl": "Poland · GUGiK NMT (shading/hypsometry)",
                "ru": "Poland · GUGiK NMT (shading/hypsometry)",
                "sq": "Poland · GUGiK NMT (shading/hypsometry)"
            },
            url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/GRID1/WMS/',
            layer: 'Raster', format: 'image/png', transparent: true, version: '1.3.0',
            tileSize: 256, minZoom: 6, maxZoom: 20, opacity: 1,
            attribution: '© GUGiK / geoportal.gov.pl',
            cors: 'unknown', proxy: 'auto',
            resolve: function () {
                var mod = root && root.GeoportalNMT;
                if (!mod || typeof mod.tileUrl !== 'function') return null;
                return { mode: moduleMode('polandLidarModeSelect'), module: 'GeoportalNMT' };
            },
            ui: { toggle: 'lidarPlLidarToggle', select: 'polandLidarModeSelect' },
            notes: 'Geoportal Krajowy WMS (NMT GRID1). URL builder: js/geoportal-nmt-layer.js.'
        },
        {
            id: 'lidar.es-mdt', group: 'lidar', z: 610, kind: 'dynamic',
            /* builder: how the module in js/ turns one tile into one URL. */
            builder: { module: 'IgnMdt', fn: 'tileUrl', kind: 'bbox' },   /* URL builder needs the tile bbox instead of z/x/y substitution */
            title: {
                "en": "Spain · IGN MDT/LiDAR",
                "ro": "Spania · IGN MDT/LiDAR",
                "de": "Spain · IGN MDT/LiDAR",
                "fr": "Spain · IGN MDT/LiDAR",
                "it": "Spain · IGN MDT/LiDAR",
                "es": "Spain · IGN MDT/LiDAR",
                "pl": "Spain · IGN MDT/LiDAR",
                "uk": "Spain · IGN MDT/LiDAR",
                "hu": "Spain · IGN MDT/LiDAR",
                "cs": "Spain · IGN MDT/LiDAR",
                "sk": "Spain · IGN MDT/LiDAR",
                "nl": "Spain · IGN MDT/LiDAR",
                "bg": "Spain · IGN MDT/LiDAR",
                "el": "Spain · IGN MDT/LiDAR",
                "pt": "Spain · IGN MDT/LiDAR",
                "da": "Spain · IGN MDT/LiDAR",
                "sv": "Spain · IGN MDT/LiDAR",
                "no": "Spain · IGN MDT/LiDAR",
                "fi": "Spain · IGN MDT/LiDAR",
                "et": "Spain · IGN MDT/LiDAR",
                "lv": "Spain · IGN MDT/LiDAR",
                "lt": "Spain · IGN MDT/LiDAR",
                "hr": "Spain · IGN MDT/LiDAR",
                "sr": "Spain · IGN MDT/LiDAR",
                "sl": "Spain · IGN MDT/LiDAR",
                "ru": "Spain · IGN MDT/LiDAR",
                "sq": "Spain · IGN MDT/LiDAR"
            },
            url: 'https://wms-mapa-lidar.idee.es/lidar',
            layer: 'EL.GridCoverage', format: 'image/png', transparent: true,
            tileSize: 256, minZoom: 6, maxZoom: 20, opacity: 1,
            attribution: '© IGN España / IDEE',
            cors: 'unknown', proxy: 'auto',
            resolve: function () {
                var mod = root && root.IgnMdt;
                if (!mod || typeof mod.tileUrl !== 'function') return null;
                return { mode: moduleMode('spainLidarModeSelect'), module: 'IgnMdt' };
            },
            ui: { toggle: 'lidarEsLidarToggle', select: 'spainLidarModeSelect' },
            notes: 'IGN MDT WMS. URL builder: js/ign-mdt-layer.js (window.SPAIN_LIDAR_PROXY_URL supported).'
        },
        {
            id: 'lidar.ch-swisstopo', group: 'lidar', z: 610, kind: 'dynamic',
            /* builder: how the module in js/ turns one tile into one URL. */
            builder: { module: 'SwisstopoRelief', fn: 'tileUrl', kind: 'tile' },   /* URL builder takes z/x/y directly */
            title: {
                "en": "Switzerland · swisstopo relief",
                "ro": "Elveția · swisstopo relief",
                "de": "Switzerland · swisstopo relief",
                "fr": "Switzerland · swisstopo relief",
                "it": "Switzerland · swisstopo relief",
                "es": "Switzerland · swisstopo relief",
                "pl": "Switzerland · swisstopo relief",
                "uk": "Switzerland · swisstopo relief",
                "hu": "Switzerland · swisstopo relief",
                "cs": "Switzerland · swisstopo relief",
                "sk": "Switzerland · swisstopo relief",
                "nl": "Switzerland · swisstopo relief",
                "bg": "Switzerland · swisstopo relief",
                "el": "Switzerland · swisstopo relief",
                "pt": "Switzerland · swisstopo relief",
                "da": "Switzerland · swisstopo relief",
                "sv": "Switzerland · swisstopo relief",
                "no": "Switzerland · swisstopo relief",
                "fi": "Switzerland · swisstopo relief",
                "et": "Switzerland · swisstopo relief",
                "lv": "Switzerland · swisstopo relief",
                "lt": "Switzerland · swisstopo relief",
                "hr": "Switzerland · swisstopo relief",
                "sr": "Switzerland · swisstopo relief",
                "sl": "Switzerland · swisstopo relief",
                "ru": "Switzerland · swisstopo relief",
                "sq": "Switzerland · swisstopo relief"
            },
            url: 'https://wmts.geo.admin.ch',
            layer: '', format: 'image/png', transparent: true,
            tileSize: 256, minZoom: 6, maxZoom: 20, opacity: 1,
            attribution: '© swisstopo',
            cors: 'yes', proxy: 'auto',
            resolve: function () {
                var mod = root && root.SwisstopoRelief;
                if (!mod || typeof mod.tileUrl !== 'function') return null;
                return { mode: moduleMode('switzerlandLidarModeSelect'), module: 'SwisstopoRelief' };
            },
            ui: { toggle: 'lidarChLidarToggle', select: 'switzerlandLidarModeSelect' },
            notes: 'swisstopo WMTS (relief/hillshade). URL builder: js/swisstopo-relief-layer.js. CORS: * (SWITZERLAND_LIDAR_SWISSTOPO.md).'
        },
        {
            id: 'lidar.uk-ea', group: 'lidar', z: 610, kind: 'dynamic',
            /* builder: how the module in js/ turns one tile into one URL. */
            builder: { module: 'EaLidarWmts', fn: 'tileUrl', kind: 'tile' },   /* URL builder takes z/x/y directly */
            title: {
                "en": "UK · Environment Agency LiDAR",
                "ro": "Marea Britanie · Environment Agency LiDAR",
                "de": "UK · Environment Agency LiDAR",
                "fr": "UK · Environment Agency LiDAR",
                "it": "UK · Environment Agency LiDAR",
                "es": "UK · Environment Agency LiDAR",
                "pl": "UK · Environment Agency LiDAR",
                "uk": "UK · Environment Agency LiDAR",
                "hu": "UK · Environment Agency LiDAR",
                "cs": "UK · Environment Agency LiDAR",
                "sk": "UK · Environment Agency LiDAR",
                "nl": "UK · Environment Agency LiDAR",
                "bg": "UK · Environment Agency LiDAR",
                "el": "UK · Environment Agency LiDAR",
                "pt": "UK · Environment Agency LiDAR",
                "da": "UK · Environment Agency LiDAR",
                "sv": "UK · Environment Agency LiDAR",
                "no": "UK · Environment Agency LiDAR",
                "fi": "UK · Environment Agency LiDAR",
                "et": "UK · Environment Agency LiDAR",
                "lv": "UK · Environment Agency LiDAR",
                "lt": "UK · Environment Agency LiDAR",
                "hr": "UK · Environment Agency LiDAR",
                "sr": "UK · Environment Agency LiDAR",
                "sl": "UK · Environment Agency LiDAR",
                "ru": "UK · Environment Agency LiDAR",
                "sq": "UK · Environment Agency LiDAR"
            },
            url: 'https://environment.data.gov.uk/geoservices/datasets/13787b9a-26a4-4775-8523-806d13af58fc/wms',
            layer: '', format: 'image/png', transparent: true,
            tileSize: 256, minZoom: 6, maxZoom: 20, opacity: 1,
            attribution: '© Environment Agency (Open Government Licence)',
            cors: 'yes', proxy: 'auto',
            resolve: function () {
                var mod = root && root.EaLidarWmts;
                if (!mod || typeof mod.tileUrl !== 'function') return null;
                return { mode: moduleMode('ukLidarModeSelect'), module: 'EaLidarWmts' };
            },
            ui: { toggle: 'lidarUkLidarToggle', select: 'ukLidarModeSelect' },
            notes: 'EA WMTS (hillshade/DTM/DSM). URL builder: js/ea-lidar-wmts-layer.js. CORS: * on tiles (UK_LIDAR_EA_WMTS.md).'
        },
        {
            id: 'lidar.dk-dhm', group: 'lidar', z: 610, kind: 'dynamic',
            /* builder: how the module in js/ turns one tile into one URL. */
            builder: { module: 'DataforsyningenDHM', fn: 'tileUrl', kind: 'tile' },   /* URL builder takes z/x/y directly */
            title: {
                "en": "Denmark · Dataforsyningen DHM",
                "ro": "Danemarca · Dataforsyningen DHM",
                "de": "Denmark · Dataforsyningen DHM",
                "fr": "Denmark · Dataforsyningen DHM",
                "it": "Denmark · Dataforsyningen DHM",
                "es": "Denmark · Dataforsyningen DHM",
                "pl": "Denmark · Dataforsyningen DHM",
                "uk": "Denmark · Dataforsyningen DHM",
                "hu": "Denmark · Dataforsyningen DHM",
                "cs": "Denmark · Dataforsyningen DHM",
                "sk": "Denmark · Dataforsyningen DHM",
                "nl": "Denmark · Dataforsyningen DHM",
                "bg": "Denmark · Dataforsyningen DHM",
                "el": "Denmark · Dataforsyningen DHM",
                "pt": "Denmark · Dataforsyningen DHM",
                "da": "Denmark · Dataforsyningen DHM",
                "sv": "Denmark · Dataforsyningen DHM",
                "no": "Denmark · Dataforsyningen DHM",
                "fi": "Denmark · Dataforsyningen DHM",
                "et": "Denmark · Dataforsyningen DHM",
                "lv": "Denmark · Dataforsyningen DHM",
                "lt": "Denmark · Dataforsyningen DHM",
                "hr": "Denmark · Dataforsyningen DHM",
                "sr": "Denmark · Dataforsyningen DHM",
                "sl": "Denmark · Dataforsyningen DHM",
                "ru": "Denmark · Dataforsyningen DHM",
                "sq": "Denmark · Dataforsyningen DHM"
            },
            url: '/api/geo/dk-dhm',
            layer: 'dhm', format: 'image/png', transparent: true,
            tileSize: 256, minZoom: 6, maxZoom: 20, opacity: 1,
            attribution: '© Styrelsen for Dataforsyning og Infrastruktur (DHM)',
            cors: 'yes', proxy: 'never',
            resolve: function () {
                var mod = root && root.DataforsyningenDHM;
                if (!mod || typeof mod.tileUrl !== 'function') return null;
                return { mode: moduleMode('denmarkLidarModeSelect'), module: 'DataforsyningenDHM' };
            },
            ui: { toggle: 'lidarDkLidarToggle', select: 'denmarkLidarModeSelect' },
            notes: 'Goes through the existing Netlify token function /api/geo/dk-dhm (DATAFORSYNINGEN_TOKEN). ' +
                'The module already emits same-origin URLs, so 3D reuses them unchanged.'
        },
        {
            id: 'lidar.se-lantmateriet', group: 'lidar', z: 610, kind: 'dynamic',
            /* builder: how the module in js/ turns one tile into one URL. */
            builder: { module: 'LantmaterietHojdmodell', fn: 'tileUrl', kind: 'bbox' },   /* URL builder needs the tile bbox instead of z/x/y substitution */
            title: {
                "en": "Sweden · Lantmäteriet höjdmodell",
                "ro": "Suedia · Lantmäteriet höjdmodell",
                "de": "Sweden · Lantmäteriet höjdmodell",
                "fr": "Sweden · Lantmäteriet höjdmodell",
                "it": "Sweden · Lantmäteriet höjdmodell",
                "es": "Sweden · Lantmäteriet höjdmodell",
                "pl": "Sweden · Lantmäteriet höjdmodell",
                "uk": "Sweden · Lantmäteriet höjdmodell",
                "hu": "Sweden · Lantmäteriet höjdmodell",
                "cs": "Sweden · Lantmäteriet höjdmodell",
                "sk": "Sweden · Lantmäteriet höjdmodell",
                "nl": "Sweden · Lantmäteriet höjdmodell",
                "bg": "Sweden · Lantmäteriet höjdmodell",
                "el": "Sweden · Lantmäteriet höjdmodell",
                "pt": "Sweden · Lantmäteriet höjdmodell",
                "da": "Sweden · Lantmäteriet höjdmodell",
                "sv": "Sweden · Lantmäteriet höjdmodell",
                "no": "Sweden · Lantmäteriet höjdmodell",
                "fi": "Sweden · Lantmäteriet höjdmodell",
                "et": "Sweden · Lantmäteriet höjdmodell",
                "lv": "Sweden · Lantmäteriet höjdmodell",
                "lt": "Sweden · Lantmäteriet höjdmodell",
                "hr": "Sweden · Lantmäteriet höjdmodell",
                "sr": "Sweden · Lantmäteriet höjdmodell",
                "sl": "Sweden · Lantmäteriet höjdmodell",
                "ru": "Sweden · Lantmäteriet höjdmodell",
                "sq": "Sweden · Lantmäteriet höjdmodell"
            },
            url: '/api/geo/se-hojdmodell',
            layer: '', format: 'image/png', transparent: true,
            tileSize: 256, minZoom: 6, maxZoom: 20, opacity: 1,
            attribution: '© Lantmäteriet (höjdmodell)',
            cors: 'yes', proxy: 'never',
            resolve: function () {
                var mod = root && root.LantmaterietHojdmodell;
                if (!mod || typeof mod.tileUrl !== 'function') return null;
                return { mode: moduleMode('swedenLidarModeSelect'), module: 'LantmaterietHojdmodell' };
            },
            ui: { toggle: 'lidarSeLidarToggle', select: 'swedenLidarModeSelect' },
            notes: 'Licensed product: the existing Netlify function /api/geo/se-hojdmodell attaches the ' +
                'LANTMATERIET_WMS_* credentials server-side (never in the browser).'
        },
        {
            id: 'lidar.fr-mnh', group: 'lidar', z: 610, kind: 'wms',
            title: {
                "en": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "ro": "Franța · IGN LiDAR HD (MNT/MNS/MNH)",
                "de": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "fr": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "it": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "es": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "pl": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "uk": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "hu": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "cs": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "sk": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "nl": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "bg": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "el": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "pt": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "da": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "sv": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "no": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "fi": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "et": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "lv": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "lt": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "hr": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "sr": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "sl": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "ru": "France · IGN LiDAR HD (DTM/DSM/CHM)",
                "sq": "France · IGN LiDAR HD (DTM/DSM/CHM)"
            },
            url: 'https://data.geopf.fr/wms-r/wms',
            layer: 'IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW',
            /* One WMS, three products, switched from the 2D dropdown: the mode
             * table lives here and js/map-app.js reads it from this registry
             * (single definition, no drift). `layerOf()` resolves the current
             * mode at tile time in BOTH views. */
            modes: {
                terrain: {
                    label: 'MNT · Terrain',
                    layer: 'IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW'
                },
                surface: {
                    label: 'MNS · Surface',
                    layer: 'IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW'
                },
                height: {
                    label: 'MNH · Height',
                    layer: 'IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW'
                }
            },
            version: '1.3.0', crs: 'EPSG:3857',
            format: 'image/png', transparent: true,
            tileSize: 256, minZoom: 6, maxZoom: 20, opacity: 1,
            attribution: '© IGN France / Géoplateforme — LiDAR HD',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'lidarFrLidarToggle', select: 'franceLidarModeSelect' },
            notes: 'Géoplateforme LiDAR HD WMS 1.3.0 (EPSG:3857). The 2D map and the ' +
                '3D view both read the layer name for the selected product from `modes`.'
        },

        /* ─────────────────── vegetation phenology (WMTS + TIME) ───────────── */
        {
            id: 'vegfp.ppi', group: 'vegfp', z: 612, kind: 'wmts', timeAware: true,
            title: {
                "en": "Vegetation PPI (dekadal)",
                "ro": "Vegetație PPI (dekadal)",
                "de": "Vegetation PPI (dekadal)",
                "fr": "Vegetation PPI (dekadal)",
                "it": "Vegetation PPI (dekadal)",
                "es": "Vegetation PPI (dekadal)",
                "pl": "Vegetation PPI (dekadal)",
                "uk": "Vegetation PPI (dekadal)",
                "hu": "Vegetation PPI (dekadal)",
                "cs": "Vegetation PPI (dekadal)",
                "sk": "Vegetation PPI (dekadal)",
                "nl": "Vegetation PPI (dekadal)",
                "bg": "Vegetation PPI (dekadal)",
                "el": "Vegetation PPI (dekadal)",
                "pt": "Vegetation PPI (dekadal)",
                "da": "Vegetation PPI (dekadal)",
                "sv": "Vegetation PPI (dekadal)",
                "no": "Vegetation PPI (dekadal)",
                "fi": "Vegetation PPI (dekadal)",
                "et": "Vegetation PPI (dekadal)",
                "lv": "Vegetation PPI (dekadal)",
                "lt": "Vegetation PPI (dekadal)",
                "hr": "Vegetation PPI (dekadal)",
                "sr": "Vegetation PPI (dekadal)",
                "sl": "Vegetation PPI (dekadal)",
                "ru": "Vegetation PPI (dekadal)",
                "sq": "Vegetation PPI (dekadal)"
            },
            url: 'https://phenology.hrvpp2.vgt.vito.be/wmts',
            layer: 'CLMS_HRVPP_ST_PPI_10M', format: 'image/png', transparent: true, version: '1.0.0',
            crs: 'EPSG:3857', tileSize: 256,
            time: { param: 'TIME', value: '2024-07-01', from: 'vegfpPpiDate' },
            minZoom: 6, maxZoom: 20, maxNativeZoom: 15, opacity: 0.85,
            bounds: [[43.4, 19.9], [48.6, 30.1]],
            attribution: '© Copernicus Land Monitoring Service — HR-VPP (10 m)',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'vegfpPpiToggle', select: 'vegfpPpiDate' },
            notes: 'CLMS HR-VPP WMTS KVP GetTile, EPSG:3857 tile matrix — identical grid to the 3D tiles, ' +
                'so the time dimension maps 1:1. TIME is carried over from the same 2D dropdown.'
        },
        {
            id: 'vegfp.smx', group: 'vegfp', z: 612, kind: 'wmts', timeAware: true,
            title: {
                "en": "Vegetation SMX (season max)",
                "ro": "Vegetație SMX (max sezon)",
                "de": "Vegetation SMX (season max)",
                "fr": "Vegetation SMX (season max)",
                "it": "Vegetation SMX (season max)",
                "es": "Vegetation SMX (season max)",
                "pl": "Vegetation SMX (season max)",
                "uk": "Vegetation SMX (season max)",
                "hu": "Vegetation SMX (season max)",
                "cs": "Vegetation SMX (season max)",
                "sk": "Vegetation SMX (season max)",
                "nl": "Vegetation SMX (season max)",
                "bg": "Vegetation SMX (season max)",
                "el": "Vegetation SMX (season max)",
                "pt": "Vegetation SMX (season max)",
                "da": "Vegetation SMX (season max)",
                "sv": "Vegetation SMX (season max)",
                "no": "Vegetation SMX (season max)",
                "fi": "Vegetation SMX (season max)",
                "et": "Vegetation SMX (season max)",
                "lv": "Vegetation SMX (season max)",
                "lt": "Vegetation SMX (season max)",
                "hr": "Vegetation SMX (season max)",
                "sr": "Vegetation SMX (season max)",
                "sl": "Vegetation SMX (season max)",
                "ru": "Vegetation SMX (season max)",
                "sq": "Vegetation SMX (season max)"
            },
            url: 'https://phenology.hrvpp2.vgt.vito.be/wmts',
            layer: 'CLMS_HRVPP_VPP_MAXV_SEASON1_10M', format: 'image/png', transparent: true, version: '1.0.0',
            crs: 'EPSG:3857', tileSize: 256,
            time: { param: 'TIME', value: '2024-01-01', from: 'vegfpSmxYear' },
            minZoom: 6, maxZoom: 20, maxNativeZoom: 15, opacity: 0.85,
            bounds: [[43.4, 19.9], [48.6, 30.1]],
            attribution: '© Copernicus Land Monitoring Service — HR-VPP (10 m)',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'vegfpSmxToggle', select: 'vegfpSmxYear' },
            notes: 'WMTS time dimension = year (YYYY-01-01).'
        },
        {
            id: 'vegfp.sgu', group: 'vegfp', z: 612, kind: 'wmts', timeAware: true,
            title: {
                "en": "Vegetation SGU (season start)",
                "ro": "Vegetație SGU (start sezon)",
                "de": "Vegetation SGU (season start)",
                "fr": "Vegetation SGU (season start)",
                "it": "Vegetation SGU (season start)",
                "es": "Vegetation SGU (season start)",
                "pl": "Vegetation SGU (season start)",
                "uk": "Vegetation SGU (season start)",
                "hu": "Vegetation SGU (season start)",
                "cs": "Vegetation SGU (season start)",
                "sk": "Vegetation SGU (season start)",
                "nl": "Vegetation SGU (season start)",
                "bg": "Vegetation SGU (season start)",
                "el": "Vegetation SGU (season start)",
                "pt": "Vegetation SGU (season start)",
                "da": "Vegetation SGU (season start)",
                "sv": "Vegetation SGU (season start)",
                "no": "Vegetation SGU (season start)",
                "fi": "Vegetation SGU (season start)",
                "et": "Vegetation SGU (season start)",
                "lv": "Vegetation SGU (season start)",
                "lt": "Vegetation SGU (season start)",
                "hr": "Vegetation SGU (season start)",
                "sr": "Vegetation SGU (season start)",
                "sl": "Vegetation SGU (season start)",
                "ru": "Vegetation SGU (season start)",
                "sq": "Vegetation SGU (season start)"
            },
            url: 'https://phenology.hrvpp2.vgt.vito.be/wmts',
            layer: 'CLMS_HRVPP_VPP_LSLOPE_SEASON1_10M', format: 'image/png', transparent: true, version: '1.0.0',
            crs: 'EPSG:3857', tileSize: 256,
            time: { param: 'TIME', value: '2024-01-01', from: 'vegfpSguYear' },
            minZoom: 6, maxZoom: 20, maxNativeZoom: 15, opacity: 0.85,
            bounds: [[43.4, 19.9], [48.6, 30.1]],
            attribution: '© Copernicus Land Monitoring Service — HR-VPP (10 m)',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'vegfpSguToggle', select: 'vegfpSguYear' },
            notes: 'WMTS time dimension = year (YYYY-01-01).'
        },
        {
            id: 'vegfp.sgd', group: 'vegfp', z: 612, kind: 'wmts', timeAware: true,
            title: {
                "en": "Vegetation SGD (season end)",
                "ro": "Vegetație SGD (sfârșit sezon)",
                "de": "Vegetation SGD (season end)",
                "fr": "Vegetation SGD (season end)",
                "it": "Vegetation SGD (season end)",
                "es": "Vegetation SGD (season end)",
                "pl": "Vegetation SGD (season end)",
                "uk": "Vegetation SGD (season end)",
                "hu": "Vegetation SGD (season end)",
                "cs": "Vegetation SGD (season end)",
                "sk": "Vegetation SGD (season end)",
                "nl": "Vegetation SGD (season end)",
                "bg": "Vegetation SGD (season end)",
                "el": "Vegetation SGD (season end)",
                "pt": "Vegetation SGD (season end)",
                "da": "Vegetation SGD (season end)",
                "sv": "Vegetation SGD (season end)",
                "no": "Vegetation SGD (season end)",
                "fi": "Vegetation SGD (season end)",
                "et": "Vegetation SGD (season end)",
                "lv": "Vegetation SGD (season end)",
                "lt": "Vegetation SGD (season end)",
                "hr": "Vegetation SGD (season end)",
                "sr": "Vegetation SGD (season end)",
                "sl": "Vegetation SGD (season end)",
                "ru": "Vegetation SGD (season end)",
                "sq": "Vegetation SGD (season end)"
            },
            url: 'https://phenology.hrvpp2.vgt.vito.be/wmts',
            layer: 'CLMS_HRVPP_VPP_RSLOPE_SEASON1_10M', format: 'image/png', transparent: true, version: '1.0.0',
            crs: 'EPSG:3857', tileSize: 256,
            time: { param: 'TIME', value: '2024-01-01', from: 'vegfpSgdYear' },
            minZoom: 6, maxZoom: 20, maxNativeZoom: 15, opacity: 0.85,
            bounds: [[43.4, 19.9], [48.6, 30.1]],
            attribution: '© Copernicus Land Monitoring Service — HR-VPP (10 m)',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'vegfpSgdToggle', select: 'vegfpSgdYear' },
            notes: 'WMTS time dimension = year (YYYY-01-01).'
        },

        /* ──────────────────── analysis rasters (own tile stores) ──────────── */
        {
            id: 'apm.tiles', group: 'apm', z: 645, kind: 'xyz', optional: true,
            title: {
                "en": "APM 2.0 (archaeological potential)",
                "ro": "APM 2.0 (potențial arheologic)",
                "de": "APM 2.0 (archaeological potential)",
                "fr": "APM 2.0 (archaeological potential)",
                "it": "APM 2.0 (archaeological potential)",
                "es": "APM 2.0 (archaeological potential)",
                "pl": "APM 2.0 (archaeological potential)",
                "uk": "APM 2.0 (archaeological potential)",
                "hu": "APM 2.0 (archaeological potential)",
                "cs": "APM 2.0 (archaeological potential)",
                "sk": "APM 2.0 (archaeological potential)",
                "nl": "APM 2.0 (archaeological potential)",
                "bg": "APM 2.0 (archaeological potential)",
                "el": "APM 2.0 (archaeological potential)",
                "pt": "APM 2.0 (archaeological potential)",
                "da": "APM 2.0 (archaeological potential)",
                "sv": "APM 2.0 (archaeological potential)",
                "no": "APM 2.0 (archaeological potential)",
                "fi": "APM 2.0 (archaeological potential)",
                "et": "APM 2.0 (archaeological potential)",
                "lv": "APM 2.0 (archaeological potential)",
                "lt": "APM 2.0 (archaeological potential)",
                "hr": "APM 2.0 (archaeological potential)",
                "sr": "APM 2.0 (archaeological potential)",
                "sl": "APM 2.0 (archaeological potential)",
                "ru": "APM 2.0 (archaeological potential)",
                "sq": "APM 2.0 (archaeological potential)"
            },
            url: 'https://sclav.andreiroba2000.workers.dev/APM_TILES/{z}/{x}/{y}.png',
            tileSize: 256, minZoom: 0, maxZoom: 20, opacity: 0.85,
            attribution: 'DetectLab APM 2.0',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'apm20Toggle', slider: 'apm20OpacitySlider', pct: 'apm20Pct', fn: 'toggleApm20Layer' },
            notes: 'Analysis raster (own Cloudflare worker). Carried into 3D when its 2D switch is on.'
        },
        {
            id: 'uat.tiles', group: 'uat', z: 402, kind: 'xyz', optional: true,
            title: {
                "en": "UAT (administrative units)",
                "ro": "UAT (unități administrative)",
                "de": "UAT (administrative units)",
                "fr": "UAT (administrative units)",
                "it": "UAT (administrative units)",
                "es": "UAT (administrative units)",
                "pl": "UAT (administrative units)",
                "uk": "UAT (administrative units)",
                "hu": "UAT (administrative units)",
                "cs": "UAT (administrative units)",
                "sk": "UAT (administrative units)",
                "nl": "UAT (administrative units)",
                "bg": "UAT (administrative units)",
                "el": "UAT (administrative units)",
                "pt": "UAT (administrative units)",
                "da": "UAT (administrative units)",
                "sv": "UAT (administrative units)",
                "no": "UAT (administrative units)",
                "fi": "UAT (administrative units)",
                "et": "UAT (administrative units)",
                "lv": "UAT (administrative units)",
                "lt": "UAT (administrative units)",
                "hr": "UAT (administrative units)",
                "sr": "UAT (administrative units)",
                "sl": "UAT (administrative units)",
                "ru": "UAT (administrative units)",
                "sq": "UAT (administrative units)"
            },
            url: 'https://pub-638f9319d3994d9ba6b7c4ce178867fd.r2.dev/UAT/{z}/{x}/{y}.png',
            tileSize: 256, minZoom: 0, maxZoom: 20, opacity: 1,
            attribution: 'UAT — DetectLab',
            cors: 'unknown', proxy: 'auto',
            ui: { toggle: 'uatToggle', fn: 'toggleUatLayer' },
            notes: 'Administrative-boundary raster tiles (R2). URL override: window.UAT_TILE_URL.'
        },

        /* ───────────────────── dynamic 2D image overlays ──────────────────── */
        {
            id: 'overlay.image-overlays', group: 'image-overlay', z: 630, kind: 'dynamic', runtimeOverlays: true,
            title: {
                "en": "Dynamic image overlays",
                "ro": "Suprapuneri imagine dinamice",
                "de": "Dynamic image overlays",
                "fr": "Dynamic image overlays",
                "it": "Dynamic image overlays",
                "es": "Dynamic image overlays",
                "pl": "Dynamic image overlays",
                "uk": "Dynamic image overlays",
                "hu": "Dynamic image overlays",
                "cs": "Dynamic image overlays",
                "sk": "Dynamic image overlays",
                "nl": "Dynamic image overlays",
                "bg": "Dynamic image overlays",
                "el": "Dynamic image overlays",
                "pt": "Dynamic image overlays",
                "da": "Dynamic image overlays",
                "sv": "Dynamic image overlays",
                "no": "Dynamic image overlays",
                "fi": "Dynamic image overlays",
                "et": "Dynamic image overlays",
                "lv": "Dynamic image overlays",
                "lt": "Dynamic image overlays",
                "hr": "Dynamic image overlays",
                "sr": "Dynamic image overlays",
                "sl": "Dynamic image overlays",
                "ru": "Dynamic image overlays",
                "sq": "Dynamic image overlays"
            },
            url: '', layer: '', tileSize: 256, opacity: 0.80,
            attribution: '',
            cors: 'yes', proxy: 'never',
            ui: { runtime: true },
            notes: 'Any L.ImageOverlay the 2D app is showing (e.g. the per-locality “Harta Iosefină” ' +
                'Wikipedia sheet loaded by iosfree) is mirrored into 3D as an image source with the ' +
                'exact bounds from Leaflet — no georeferencing is invented.'
        }
    ];

    /* CENAGIS catalogue sheets → one LAYERS entry each (id prefix “cenagis.”). */
    (function expandCenagis() {
        var maps = CENAGIS.maps || {};
        Object.keys(maps).forEach(function (key) {
            var meta = maps[key];
            var layerName = CENAGIS.workspace + ':' + meta.wms_layer;
            /* The two EPSG:2180-only sheets cannot be served on the Web
             * Mercator grid: the proxy re-projects the tile bbox. */
            var nativeIs2180 = /_2180$/.test(meta.wms_layer);
            LAYERS.push({
                id: 'cenagis.' + key,
                cenagisKey: key,
                group: 'hist-premium',
                z: 635,                     /* all catalogue rows share the 2D pane z-index */
                kind: 'wms',
                title: meta.title,
                url: CENAGIS.url,
                layer: layerName,
                format: CENAGIS.format,
                transparent: CENAGIS.transparent,
                version: CENAGIS.version,
                crs: nativeIs2180 ? 'EPSG:2180' : 'EPSG:3857',
                reproject: nativeIs2180,
                tileSize: 256,
                minZoom: 0, maxZoom: 20, opacity: CENAGIS.opacity,
                bounds: meta.bounds,
                scale: meta.scale,
                years: meta.years,
                provider: meta.provider,
                attribution: '© ' + meta.provider + ' · <a href="https://pastmaps.cenagis.edu.pl" target="_blank" rel="noopener">CENAGIS</a> / <a href="https://atlasfontium.pl" target="_blank" rel="noopener">IH PAN</a>',
                cors: CENAGIS.cors,
                proxy: 'auto',
                ui: { selector: '.cenagis-toggle[data-map-key="' + key + '"]', sliderSelector: '.cenagis-opacity-slider[data-map-key="' + key + '"]', pctSelector: '.cenagis-pct[data-map-key="' + key + '"]', fn: 'DetectLabEuMaps.toggleCenagisLayer', fnKey: key, parent: 'histPremiumToggle', wmsHealthKeys: [key] },
                notes: nativeIs2180
                    ? 'EPSG:2180 sheet — the 3D tile proxy transforms the Web-Mercator tile bbox into PL-1992 ' +
                      'before calling GetMap, and the 2D map lets the GeoServer re-project its EPSG:3857 ' +
                      'GetMap instead (see MAP_3D_TERRAIN.md §Problem layers).' +
                      (meta.notes ? ' ' + meta.notes : '')
                    : 'CENAGIS/IH PAN sheet, EPSG:3857.'
            });
        });
    }());

    /* ── index ─────────────────────────────────────────────────────────────── */
    var BY_ID = {};
    LAYERS.forEach(function (def) { BY_ID[def.id] = def; });

    function cenagisCatalog() {
        /* Same shape js/historical-eu-maps.js has always used. */
        var out = {};
        Object.keys(CENAGIS.maps || {}).forEach(function (key) {
            var meta = CENAGIS.maps[key];
            out[key] = {
                id: meta.id || key,
                wms_layer: meta.wms_layer,
                title: meta.title,
                scale: meta.scale,
                years: meta.years,
                provider: meta.provider,
                bounds: clone(meta.bounds)
            };
        });
        return out;
    }

    function get(id) { return BY_ID[id] || null; }

    /* ═══════════════════════════════════════════════════════════════════════
     *  MIRROR STUBS — layers that only exist on the live 2D map
     * -----------------------------------------------------------------------
     *  The registry describes the services; the 2D map decides which of them
     *  are actually drawn. A layer the 2D app builds on its own (a plugin, a
     *  runtime overlay, a group the panel creates lazily, a layer registered
     *  from the console) has no definition here, and used to be invisible to
     *  everything that reads this registry — including the 3D view.
     *
     *  js/map3d-mirror.js describes exactly those layers. They are folded in
     *  as read-only stub definitions, so `list()`/`ordered()`/`diagnostics()`
     *  cover every visible layer. An explicit definition always wins.
     * ═══════════════════════════════════════════════════════════════════════ */
    var STUBS = { cache: null, at: 0 };

    var STUB_KIND = {
        raster: 'xyz',
        image: 'image-overlay',
        vector: 'geojson',
        markers: 'marker',
        cluster: 'cluster',
        heat: 'heatmap',
        video: 'video',
        unsupported: 'unsupported'
    };

    function mirrorStubs() {
        var mirror = root && root.DetectLabMirror;
        if (!mirror || typeof mirror.collect !== 'function' || typeof mirror.describe !== 'function') return [];
        var map = root._dlMap || root.map;
        if (!map || typeof map.eachLayer !== 'function') return [];
        /* `list()` is called from the status panel and the tests, so the walk
         * is cached for a second — the mirror itself is the source of truth,
         * this only avoids re-walking an unchanged map. */
        var now = Date.now();
        if (STUBS.cache && now - STUBS.at < 1000) return STUBS.cache;
        var out = [];
        try {
            var collected = mirror.collect(map);
            (collected.items || []).forEach(function (item) {
                if (!item || !item.key || BY_ID[item.key]) return;      /* explicit definition wins */
                out.push(stubDef(item));
            });
        } catch (e) { out = []; }
        STUBS.cache = out;
        STUBS.at = now;
        return out;
    }

    function stubDef(item) {
        var title = item.label || item.key;
        return {
            id: item.key,
            stub: true,                       /* mirrored from the live 2D map */
            group: 'mirror',
            z: item.z == null ? 1000 : item.z,
            kind: STUB_KIND[item.kind] || 'xyz',
            kind3d: item.kind,
            url: item.template || item.url || '',
            template: item.template || '',
            layer: '',
            opacity: item.opacity == null ? 1 : item.opacity,
            tileSize: item.tileSize || 256,
            minZoom: item.minzoom == null ? 0 : item.minzoom,
            maxZoom: item.maxzoom == null ? 20 : item.maxzoom,
            bounds: item.bounds || null,
            attribution: item.attribution || '',
            cors: 'unknown',
            proxy: 'auto',
            modes: null,
            ui: { mirror: true },
            title: ALL_LANG_TITLE(title),
            notes: 'mirrored from the live 2D map (' + item.kind + '); tile URLs are built by the 2D layer itself'
        };
    }

    var ALL_LANG_CODES = ['en','ro','de','fr','it','es','pl','uk','hu','cs','sk','nl','bg','el','pt','da','sv','no','fi','et','lv','lt','hr','sr','sl','ru','sq'];
    function ALL_LANG_TITLE(text) {
        var out = {};
        ALL_LANG_CODES.forEach(function (code) { out[code] = text; });
        return out;
    }

    /** Explicit definitions + everything the live 2D map is showing. */
    function list() { return LAYERS.concat(mirrorStubs()); }

    function byGroup(group) {
        return list().filter(function (def) { return def.group === group; });
    }

    /* Draw order for the 3D deck: base first, then the 2D pane z-index, then
     * the panel order — exactly what Leaflet does with its panes. */
    function ordered() {
        var all = list();
        return all.sort(function (a, b) {
            var za = a.z == null ? 1000 : a.z, zb = b.z == null ? 1000 : b.z;
            if (za !== zb) return za - zb;
            return all.indexOf(a) - all.indexOf(b);
        });
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *  MATCHING — which definition is a live 2D layer built from?
     * -----------------------------------------------------------------------
     *  Used by js/map3d-mirror.js when it translates a Leaflet layer: a layer
     *  that matches a definition inherits its title, attribution, CORS/proxy
     *  policy and zoom window instead of being an anonymous tile layer.
     *  Matching is deliberately strict (host + path + LAYERS), so a runtime
     *  layer of the user's own is never mistaken for a defined one.
     * ═══════════════════════════════════════════════════════════════════════ */
    function normalizeUrl(url) {
        return String(url || '')
            .replace(/^https?:\/\//i, '')
            .replace(/\{[^}]*\}/g, '{x}')
            .replace(/\?.*$/, '')
            .replace(/\/+$/, '')
            .toLowerCase();
    }

    function normalizeLayers(value) {
        return String(value || '').split(',').map(function (part) { return part.trim().toLowerCase(); })
            .filter(Boolean).sort().join(',');
    }

    function matchDef(probe) {
        if (!probe || !probe.url) return null;
        var url = normalizeUrl(probe.url);
        var layers = normalizeLayers(probe.layers);
        var version = probe.version == null ? '' : String(probe.version);
        for (var i = 0; i < LAYERS.length; i += 1) {
            var def = LAYERS[i];
            var candidates = [def.url].concat(Object.keys(def.alt || {}).map(function (key) { return def.alt[key]; }));
            for (var c = 0; c < candidates.length; c += 1) {
                if (normalizeUrl(candidates[c]) !== url) continue;
                var defLayers = normalizeLayers(def.layer || def.layers);
                /* A WMS/WMTS request carries its LAYERS: when both sides have
                 * one it must be the same service, so two definitions sharing
                 * an endpoint are never interchangeable. */
                if (layers && defLayers && layers !== defLayers) continue;
                if (version && def.version && String(def.version) !== version && layers && defLayers) continue;
                return def;                                            /* first exact hit wins */
            }
        }
        return null;
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *  HOST POLICY — may the 3D view fetch a host directly?
     *  Answers with what the definitions already declare about their hosts, so
     *  a tile request is routed (direct or via the same-origin proxy) without
     *  waiting for a failed request. 'unknown' = try direct, heal if it fails.
     * ═══════════════════════════════════════════════════════════════════════ */
    var HOSTS = null;

    function hostOf(def) {
        var url = def && (def.url || def.template || '');
        var m = String(url).match(/^https?:\/\/([^/?#]+)/i);
        return m ? m[1].toLowerCase() : '';
    }

    function hostPolicy() {
        if (HOSTS) return HOSTS;
        HOSTS = {};
        function note(host, cors, proxy) {
            if (!host) return;
            var verdict = (proxy === 'never') ? 'never'
                : (proxy === 'always' || cors === 'no') ? 'always'
                    : (cors === 'yes' ? 'never' : 'unknown');
            /* An explicit "never" is only overridden by an explicit "always". */
            if (!HOSTS[host] || verdict === 'always' || (HOSTS[host] === 'unknown' && verdict === 'never')) {
                HOSTS[host] = verdict;
            }
        }
        LAYERS.forEach(function (def) {
            note(hostOf(def), def.cors, def.proxy);
            Object.keys(def.alt || {}).forEach(function (key) {
                note(hostOf({ url: def.alt[key] }), def.cors, def.proxy);
            });
        });
        /* Hosts whose verdict is documented in MAP_3D_TERRAIN.md §“CORS /
         * transport” — kept here so the first 3D paint already takes the right
         * route instead of burning a wave of failed tiles. `auto`/`unknown`
         * hosts are deliberately absent: the viewer tries them directly and
         * heals to the proxy for the rest of the session. */
        note('server.arcgisonline.com', 'yes', 'never');
        note('services.arcgisonline.com', 'yes', 'never');
        note('tiles.arcgis.com', 'yes', 'never');
        note('s3.amazonaws.com', 'yes', 'never');
        note('api.maptiler.com', 'yes', 'never');
        note('image.discomap.eea.europa.eu', 'no', 'always');
        note('copernicus.discomap.eea.europa.eu', 'no', 'always');
        note('geoserve.cast.uark.edu', 'no', 'always');
        return HOSTS;
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *  URL / PARAMETER BUILDERS — shared by the 2D view, the 3D view and the
     *  proxy. Pure string work: no DOM, no fetch, safe in Node.
     * ═══════════════════════════════════════════════════════════════════════ */
    function lngLatTo3857(lng, lat) {
        var R = 6378137;
        var x = R * lng * Math.PI / 180;
        var y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
        return [x, y];
    }

    /** [minX, minY, maxX, maxY] of one raster tile on the Web-Mercator grid. */
    function tileBounds3857At(z, x, y) {
        var R = 6378137, half = Math.PI * R;
        var size = (2 * half) / Math.pow(2, z);
        var minX = -half + x * size;
        var maxY = half - y * size;
        return [minX, maxY - size, minX + size, maxY];
    }

    function boundsTo3857(bounds) {
        if (!bounds) return null;
        var sw = bounds[0], ne = bounds[1];
        var a = lngLatTo3857(sw[1], sw[0]);
        var b = lngLatTo3857(ne[1], ne[0]);
        return [a[0], a[1], b[0], b[1]];
    }

    /* Extra KVP params (custom params, TIME, plus anything a caller adds). */
    function extraParams(def, opts) {
        opts = opts || {};
        var parts = [];
        var params = def.params || {};
        Object.keys(params).forEach(function (key) {
            if (params[key] === '' || params[key] == null) return;
            parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
        });
        var time = opts.time != null ? opts.time : (def.time ? def.time.value : null);
        if (def.time && time != null && time !== '') {
            parts.push(encodeURIComponent(def.time.param || 'TIME') + '=' + encodeURIComponent(time));
        }
        return parts;
    }

    /**
     * WMS GetMap template for the 3D view.
     * Uses MapLibre's `{bbox-epsg-3857}` placeholder: every request is a
     * Web-Mercator tile, so WMS 1.3.0 axis order is always x,y (lon,lat),
     * which is exactly what the placeholder provides.
     */
    function wmsTemplate(def, opts) {
        opts = opts || {};
        var size = opts.tileSize || def.tileSize || 256;
        var query = [
            'service=WMS',
            'request=GetMap',
            'version=' + encodeURIComponent(def.version || '1.3.0'),
            'layers=' + encodeURIComponent(layerOf(def, opts)),
            'styles=',
            'format=' + encodeURIComponent(def.format || 'image/png'),
            'transparent=' + (def.transparent ? 'true' : 'false'),
            (String(def.version || '1.3.0') >= '1.3.0' ? 'crs=' : 'srs=') + encodeURIComponent(opts.crs || def.crs || 'EPSG:3857'),
            'width=' + size,
            'height=' + size,
            'bbox={bbox-epsg-3857}'
        ].concat(extraParams(def, opts));
        return def.url + (def.url.indexOf('?') === -1 ? '?' : '&') + query.join('&');
    }

    /** WMTS KVP GetTile template (time dimension included when declared). */
    function wmtsTemplate(def, opts) {
        opts = opts || {};
        var query = [
            'SERVICE=WMTS',
            'REQUEST=GetTile',
            'VERSION=' + encodeURIComponent(def.version || '1.0.0'),
            'LAYER=' + encodeURIComponent(def.layer || ''),
            'STYLE=',
            'FORMAT=' + encodeURIComponent(def.format || 'image/png'),
            'TILEMATRIXSET=' + encodeURIComponent(def.crs || 'EPSG:3857'),
            'TILEMATRIX=' + encodeURIComponent(def.crs || 'EPSG:3857') + '%3A{z}',
            'TILEROW={y}',
            'TILECOL={x}'
        ].concat(extraParams(def, opts));
        return def.url + (def.url.indexOf('?') === -1 ? '?' : '&') + query.join('&');
    }

    /** Direct (no proxy) tile template for a definition. */
    function directTemplate(def, opts) {
        opts = opts || {};
        var resolved = resolveDef(def, opts.modules);
        if (!resolved) return null;
        if (resolved.template) return resolved.template;
        if (resolved.kind === 'wms') return wmsTemplate(resolved, opts);
        if (resolved.kind === 'wmts') return wmtsTemplate(resolved, opts);
        var url = opts.url || resolved.url || '';
        if (!url) return null;
        if (resolved.scheme === 'tms') return url;   /* MapLibre flips y itself */
        return url;
    }

    /** Same-origin proxy template (used when CORS is missing / reprojection is needed). */
    function proxyTemplate(def, opts) {
        opts = opts || {};
        var cfg = config();
        if (!cfg.proxy || cfg.proxy.enabled === false) return null;
        var base = opts.proxyBase || cfg.proxy.base;
        var template = base + '?layer=' + encodeURIComponent(def.id) + '&z={z}&x={x}&y={y}';
        var time = opts.time != null ? opts.time : (def.time ? def.time.value : null);
        if (time != null && time !== '') template += '&t=' + encodeURIComponent(time);
        /* CORONA and other per-product services: one product per tile request. */
        if (opts.proxyProduct) template += '&p=' + encodeURIComponent(opts.proxyProduct);
        /* Country LiDAR layers switch product/renderer (hillshade/DTM/DSM/MNT/
         * MNS/MNH) from a 2D dropdown: the proxy must build the same mode's URL
         * as the 2D map, so the selection travels with the request. */
        if (def.modes || (def.kind === 'dynamic' && typeof def.resolve === 'function')) {
            var mode = opts.mode || modeOf(def, opts);
            if (mode) template += '&m=' + encodeURIComponent(mode);
        }
        return template;
    }

    /** Hostname of a definition's endpoint (probe/heal bookkeeping key). */
    function hostOf(def) {
        var url = (def && (def.url || (def.resolve && ''))) || '';
        var match = String(url).match(/^https?:\/\/([^/?#]+)/i);
        return match ? match[1].toLowerCase() : '';
    }

    /**
     * Should this layer go through the same-origin proxy?
     *   'always'   → yes (documented no-CORS hosts, reprojection, token)
     *   'never'    → no  (same-origin endpoints, known CORS-safe hosts)
     *   'auto'     → only when the definition needs reprojection, or when the
     *                runtime CORS probe / tile-error auto-heal put its host in
     *                opts.proxyHosts (see js/map3d-terrain.js).
     * opts.forceProxy === true|false overrides everything (tests, debugging).
     */
    function needsProxy(def, opts) {
        opts = opts || {};
        if (opts.forceProxy === true) return true;
        if (opts.forceProxy === false) return false;
        if (!def || def.proxy === 'never') return false;
        if (def.proxy === 'always') return true;
        if (def.reproject) return true;
        var host = hostOf(def);
        if (host && opts.proxyHosts && opts.proxyHosts.indexOf(host) !== -1) return true;
        if (opts.proxyHostsAll === true) return true;
        return false;
    }

    /** Tile templates for the 3D raster source of `def`. */
    function map3dTiles(def, opts) {
        opts = opts || {};
        var resolved = resolveDef(def, opts.modules);
        if (!resolved) {
            /* A dynamic definition whose browser module is not loaded. `def.url`
             * is the SERVICE endpoint, not a tile template: handing it to
             * MapLibre makes every tile of the layer request that one
             * un-substituted URL, fail, and leave nothing but the base map —
             * the exact “prepared, but only the base map is there” picture.
             * No template is the honest answer; both callers already handle it
             * (the mirror falls back to the live layer's own dl2d:// route, the
             * registry caller reports `unsupported: no tile template`). */
            return [];
        }
        var proxied = needsProxy(resolved, opts);
        var template;
        if (resolved.perTile && !proxied) {
            /* The module builds the URL from the tile bbox, which no static
             * template can express: MapLibre asks for
             * `dl3d://<layer id>/{z}/{x}/{y}` and js/map3d-terrain.js turns
             * each request into the module call (protocol handler below). */
            template = protocolTemplate(resolved);
        } else {
            template = proxied ? proxyTemplate(resolved, opts) : directTemplate(resolved, opts);
        }
        return template ? [template] : [];
    }

    /** MapLibre raster source object for a definition. */
    function rasterSource(def, opts) {
        opts = opts || {};
        var resolved = resolveDef(def, opts.modules) || def;
        var source = {
            type: 'raster',
            tiles: opts.tiles || map3dTiles(resolved, opts),
            tileSize: resolved.tileSize || 256,
            attribution: resolved.attribution || ''
        };
        if (resolved.scheme === 'tms') source.scheme = 'tms';
        /* MapLibre raster-source bounds are [west, south, east, north] in
         * DEGREES (its default is [-180, -85.051129, 180, 85.051129]) — the
         * registry stores Leaflet's [[south, west], [north, east]], so this is
         * a reorder, never a reprojection. */
        if (resolved.bounds && resolved.bounds.length === 2) {
            var sw = resolved.bounds[0], ne = resolved.bounds[1];
            source.bounds = [sw[1], sw[0], ne[1], ne[0]];
        }
        var minz = resolved.minZoom == null ? 0 : resolved.minZoom;
        var maxz = resolved.maxNativeZoom != null ? resolved.maxNativeZoom
            : (resolved.maxZoom == null ? 22 : resolved.maxZoom);
        source.minzoom = Math.max(0, minz);
        source.maxzoom = Math.min(22, maxz);
        if (resolved.maxZoom != null && resolved.maxNativeZoom != null && resolved.maxZoom > resolved.maxNativeZoom) {
            /* MapLibre keeps asking above maxzoom; harmless, the server answers
             * with the native level only when it supports it (2D behaviour is
             * identical: Leaflet over-zooms the same tiles). */
        }
        return source;
    }

    /* ── module-backed layers (LiDAR, …) ───────────────────────────────────── */
    function moduleMode(selectId) {
        try {
            if (typeof document === 'undefined' || !document.getElementById) return null;
            var el = document.getElementById(selectId);
            return el && el.value ? el.value : null;
        } catch (e) { return null; }
    }

    /**
     * Late binding for definitions whose URL builder, mode list and mode
     * default live in a country module (js/ahn-layer.js, js/hoydedata-layer.js,
     * js/geoportal-nmt-layer.js, js/ign-mdt-layer.js, …). Nothing is copied into
     * this file: the module stays the single owner of its URL.
     *
     * `def.builder` says HOW that module wants to be called:
     *   { fn: 'tileUrl',        kind: 'tile' } → fn(mode, z, x, y)
     *   { fn: 'tileUrl',        kind: 'bbox' } → fn(mode, bbox3857, size, crs)
     *   { fn: 'exportImageUrl', kind: 'bbox' } → fn(mode, bbox3857, size)
     * `kind: 'bbox'` builders cannot be expressed as a `{z}/{x}/{y}` template,
     * so the 3D view calls them per tile through the `dl3d://` protocol
     * registered in js/map3d-terrain.js (or, for no-CORS hosts, through the
     * tile proxy, which loads the very same module in Node).
     */
    function moduleBuilder(def) {
        if (!def || def.kind !== 'dynamic' || typeof def.resolve !== 'function') return null;
        var spec = def.builder;
        if (!spec || !spec.module || !spec.fn) return null;
        return { module: spec.module, fn: spec.fn, kind: spec.kind || 'tile' };
    }

    /** The module object backing a dynamic definition (browser or injected). */
    function moduleFor(name, modules) {
        if (modules && modules[name]) return modules[name];
        return (root && root[name]) || null;
    }

    /**
     * WMS layer name of a mode-switched definition (e.g. France LiDAR HD:
     * elevation / surface / height). Definitions without `modes` are returned
     * unchanged, so every other layer keeps its single `layer` string.
     */
    function layerOf(def, opts) {
        if (!def) return '';
        if (!def.modes) return def.layer || def.layers || '';
        var key = modeOf(def, opts) || Object.keys(def.modes)[0];
        var entry = def.modes[key] || {};
        return entry.layer || entry.layers || def.layer || '';
    }

    /**
     * Current mode key of a mode-switched layer: the live 2D dropdown wins in
     * the browser, the caller may override it (the tile proxy passes the mode
     * the client asked for), and the declaration's first mode is the last
     * resort.
     */
    function modeOf(def, opts) {
        opts = opts || {};
        if (opts.mode) return opts.mode;
        /* 1. the live 2D dropdown (browser); 2. the module's first mode. */
        var select = def && def.ui && def.ui.select;
        var live = select ? moduleMode(select) : null;
        if (live) return live;
        var b = moduleBuilder(def);
        var mod = moduleFor(b ? b.module : null, opts.modules);
        if (mod && typeof mod.modeKeys === 'function') {
            try { return mod.modeKeys()[0]; } catch (e) { /* ignore */ }
        }
        if (def && def.modes) {
            var keys = Object.keys(def.modes);
            if (keys.length) return keys[0];
        }
        return null;
    }

    /**
     * Exact upstream URL for ONE tile of a module-backed layer — the only way
     * to reach builders that need a bbox (WMS GetMap / ArcGIS exportImage).
     * Returns '' when the module is not loaded, so callers can report
     * "unsupported: module not loaded" instead of requesting a broken URL.
     */
    function tileUrlAt(def, z, x, y, opts) {
        opts = opts || {};
        var b = moduleBuilder(def);
        if (!b) return '';
        var mod = moduleFor(b.module, opts.modules);
        var fn = mod && mod[b.fn];
        if (typeof fn !== 'function') return '';
        var size = def.tileSize || 256;
        var crs = def.crs || 'EPSG:3857';
        var mode = modeOf(def, opts);
        try {
            if (b.kind === 'bbox') {
                return String(fn.call(mod, mode, tileBounds3857At(z, x, y), size, crs));
            }
            return String(fn.call(mod, mode, z, x, y));
        } catch (e) {
            return '';
        }
    }

    /** MapLibre custom-protocol template for a per-tile (bbox) builder. */
    function protocolTemplate(def) {
        return 'dl3d://' + def.id + '/{z}/{x}/{y}';
    }

    function resolveDef(def, modules) {
        if (!def) return null;
        if (def.kind !== 'dynamic' || !def.resolve) return def;
        var spec = moduleBuilder(def);
        if (!spec) return null;
        var mod = moduleFor(spec.module, modules);
        if (!mod) return null;                                        /* module not loaded (yet) */
        var fn = mod[spec.fn];
        if (typeof fn !== 'function') return null;
        var mode = modeOf(def, { modules: modules });
        var perTile = spec.kind === 'bbox';
        var template = null;
        if (!perTile) {
            try { template = fn(mode, '{z}', '{x}', '{y}'); } catch (e) { template = null; }
            if (!template) return null;
        }
        var modes = mod.MODES || {};
        var meta = (mode && modes[mode]) || {};
        return {
            id: def.id, group: def.group, z: def.z, kind: def.kind,
            title: def.title, attribution: def.attribution, opacity: def.opacity,
            url: template || def.url, template: template || '', mode: mode,
            perTile: perTile, builder: spec.kind || 'tile',
            bounds: def.bounds,
            minZoom: def.minZoom, maxZoom: def.maxZoom, maxNativeZoom: def.maxNativeZoom,
            tileSize: def.tileSize, cors: def.cors, proxy: def.proxy, notes: def.notes,
            modeLabel: meta.label || mode || ''
        };
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *  2D ADAPTERS — what js/map-app.js and js/historical-eu-maps.js use.
     * ═══════════════════════════════════════════════════════════════════════ */

    /**
     * Options for L.tileLayer.wms() — the service half of the definition.
     *
     * NOTE ON `crs`: Leaflet expects a CRS *object* here (it reads `.code` and
     * calls `.project()`), and the 2D map is Web Mercator throughout, so the
     * call site passes `crs: L.CRS.EPSG3857` when it wants it explicitly. The
     * `crs` field of a definition is a different thing: the CRS the SERVER is
     * asked for by the 3D view / the proxy (where it may be EPSG:2180).
     *
     * `extra` carries the view-specific wiring (pane, zoom window, bounds,
     * crossOrigin, …) — exactly the parts that legitimately differ per view.
     */
    function wms2dOptions(id, extra) {
        var def = get(id);
        if (!def) throw new Error('[layer-registry] unknown layer: ' + id);
        var opts = {
            layers: def.layer || def.layers,
            format: def.format || 'image/png',
            transparent: def.transparent !== false,
            version: def.version || '1.3.0',
            opacity: def.opacity == null ? 1 : def.opacity,
            attribution: def.attribution || ''
        };
        Object.keys(def.params || {}).forEach(function (key) { opts[key] = def.params[key]; });
        Object.keys(extra || {}).forEach(function (key) { opts[key] = extra[key]; });
        return opts;
    }

    /** Options for L.tileLayer() — XYZ / ArcGIS-tiled definitions. */
    function tile2dOptions(id, extra) {
        var def = get(id);
        if (!def) throw new Error('[layer-registry] unknown layer: ' + id);
        var opts = {
            tileSize: def.tileSize || 256,
            opacity: def.opacity == null ? 1 : def.opacity,
            attribution: def.attribution || ''
        };
        if (def.minNativeZoom != null) opts.minNativeZoom = def.minNativeZoom;
        if (def.maxNativeZoom != null) opts.maxNativeZoom = def.maxNativeZoom;
        Object.keys(extra || {}).forEach(function (key) { opts[key] = extra[key]; });
        return opts;
    }

    /** Endpoint of a definition; `altKey` selects a mirror (def.alt[key]). */
    function url2d(id, altKey) {
        var def = get(id);
        if (!def) throw new Error('[layer-registry] unknown layer: ' + id);
        if (altKey) {
            if (!def.alt || !def.alt[altKey]) {
                throw new Error('[layer-registry] ' + id + ' has no alt source "' + altKey + '"');
            }
            return def.alt[altKey];
        }
        return def.url;
    }

    /** The service-level fields of a definition (for call sites that need one). */
    function service(id) {
        var def = get(id);
        if (!def) throw new Error('[layer-registry] unknown layer: ' + id);
        return {
            url: def.url,
            layer: def.layer || def.layers || '',
            format: def.format || 'image/png',
            transparent: def.transparent !== false,
            version: def.version || '1.3.0',
            crs: def.crs || 'EPSG:3857',
            opacity: def.opacity == null ? 1 : def.opacity,
            attribution: def.attribution || '',
            bounds: def.bounds || null,
            time: def.time ? def.time.value : null
        };
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *  STATE — where a layer is ON and how opaque it is, read from the 2D UI
     *  (the only place layer state lives). Used by the 3D view so the two
     *  views can never disagree about what is active.
     * ═══════════════════════════════════════════════════════════════════════ */
    function doc() {
        try { return (root && root.document) || (typeof document !== 'undefined' ? document : null); }
        catch (e) { return null; }
    }

    function uiElement(def, kind) {
        var d = doc();
        if (!d) return null;
        var ui = def.ui || {};
        try {
            if (kind === 'toggle') {
                if (ui.toggle) return d.getElementById(ui.toggle);
                if (ui.selector) return d.querySelector(ui.selector);
            }
            if (kind === 'slider') {
                if (ui.slider) return d.getElementById(ui.slider);
                if (ui.sliderSelector) return d.querySelector(ui.sliderSelector);
            }
            if (kind === 'pct') {
                if (ui.pct) return d.getElementById(ui.pct);
                if (ui.pctSelector) return d.querySelector(ui.pctSelector);
            }
            if (kind === 'select') {
                if (ui.select) return d.getElementById(ui.select);
                if (ui.selectSelector) return d.querySelector(ui.selectSelector);
            }
        } catch (e) { return null; }
        return null;
    }

    /** Is the layer currently switched on in the 2D panel? */
    function is2dActive(def) {
        /* A mirrored (stub) layer only exists in this list while the live 2D
         * map is showing it — the mirror is the answer. */
        if (def.stub) {
            var mirror = root && root.DetectLabMirror;
            if (mirror && typeof mirror.layerByKey === 'function') return !!mirror.layerByKey(def.id);
            return false;
        }
        var el = uiElement(def, 'toggle');
        if (el) return !!el.checked;
        /* Layers without a switch of their own follow a select (satellite
         * periods) or the parent group (Josephine's LayerGroup reference). */
        /* Copernicus VHR periods share one slider, so they are identified by
         * the live Leaflet layer the 2D app keeps in window._satHistPeriods. */
        if (def.id.indexOf('sat.vhr-') === 0) {
            var periods = root._satHistPeriods;
            var key = def.id.replace('sat.vhr-', '');
            var livePeriod = periods && periods[key];
            var liveMap = root._dlMap;
            if (livePeriod && liveMap && typeof liveMap.hasLayer === 'function') {
                return liveMap.hasLayer(livePeriod);
            }
            return String(root._satPeriod || '') === key;
        }
        /* Layers driven by a runtime Leaflet layer object (Josephine's
         * viewport-switched LayerGroup, CORONA deck, …) are asked of the live
         * 2D map instead of a checkbox. */
        var ui = def.ui || {};
        if (ui.var2d) {
            var live = root[ui.var2d];
            var map = root._dlMap;
            if (live && map && typeof map.hasLayer === 'function') return map.hasLayer(live);
        }
        return false;
    }

    /** Current opacity of the layer, read from the 2D slider when present. */
    function opacityOf(def) {
        var slider = uiElement(def, 'slider');
        if (slider && slider.value !== '' && slider.value != null) {
            var v = Number(slider.value);
            if (!isNaN(v)) return Math.max(0, Math.min(1, v / 100));
        }
        var live = def.ui && def.ui.var2d ? root[def.ui.var2d] : null;
        if (live && typeof live.getOpacity === 'function') {
            try { return live.getOpacity(); } catch (e) { /* fall through */ }
        }
        return def.opacity == null ? 1 : def.opacity;
    }

    /** Current value of a time dimension (2D control wins over the default). */
    function timeOf(def) {
        if (!def.time) return null;
        var sel = uiElement(def, 'select');
        if (sel && sel.value) return sel.value;
        return def.time.value;
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *  DIAGNOSTICS — feed the 3D status panel, the tests and MAP_3D_TERRAIN.md
     * ═══════════════════════════════════════════════════════════════════════ */
    function layerStatus(def, opts) {
        opts = opts || {};
        var resolved = resolveDef(def, opts.modules);
        var status = {
            id: def.id,
            group: def.group,
            title: def.title && (def.title.en || def.title.ro) || def.id,
            kind: def.kind,
            url: (resolved && resolved.url) || def.url,
            layer: layerOf(def, opts),
            mode: def.modes ? modeOf(def, opts) : (resolved && resolved.mode) || undefined,
            modeKeys: def.modes ? Object.keys(def.modes) : undefined,
            crs: def.crs || 'EPSG:3857',
            cors: def.cors || 'unknown',
            proxy: def.proxy || 'auto',
            reproject: !!def.reproject,
            drape: true,
            active2d: is2dActive(def),
            opacity: opacityOf(def),
            zoom: [def.minZoom == null ? 0 : def.minZoom, def.maxZoom == null ? 20 : def.maxZoom],
            notes: def.notes || ''
        };
        if (def.runtimeOverlays) {
            status.kind = 'dynamic';
            status.notes = def.notes;
        }
        if (!resolved) {
            status.drape = false;
            var modName = def.builder && def.builder.module;
            status.reason = modName
                ? 'module ' + modName + ' not loaded — nothing to drape yet'
                : 'module not loaded (country LiDAR module) — nothing to drape yet';
        } else if (resolved.perTile) {
            /* bbox-driven builder: draped through the dl3d:// protocol (or the
             * proxy when the host has no CORS) — never silently skipped. */
            status.perTile = true;
            status.drape = true;
            status.reason = 'per-tile URL from ' + (def.builder && def.builder.fn ? def.builder.fn : 'tileUrl') +
                '() — draped tile by tile (protocol, or the proxy where CORS is missing)';
        }
        return status;
    }

    function diagnostics(opts) {
        opts = opts || {};
        var out = ordered().map(function (def) { return layerStatus(def, opts); });
        var cfg = config();
        return {
            version: VERSION,
            terrain: terrainSource(),
            exaggeration: cfg.terrain.exaggeration,
            hillshade: cfg.hillshade,
            proxy: cfg.proxy,
            layers: out,
            totals: {
                layers: out.length,
                draped: out.filter(function (s) { return s.drape; }).length,
                active2d: out.filter(function (s) { return s.active2d; }).length,
                viaProxy: out.filter(function (s) { return s.proxy === 'always' || s.proxy === 'auto' && (s.cors === 'no' || s.cors === 'unknown'); }).length,
                reprojected: out.filter(function (s) { return s.reproject; }).length
            }
        };
    }

    /* ═══════════════════════════════════════════════════════════════════════
     *  DRIFT GUARD — compares the registry with the live 2D Leaflet layers.
     *  Runs from the console / tests: it never mutates anything.
     * ═══════════════════════════════════════════════════════════════════════ */
    function verify2d() {
        var problems = [];
        ordered().forEach(function (def) {
            if (def.kind === 'dynamic' || !def.ui || !def.ui.var2d || def.ui.selector) return;
            var live = root[def.ui.var2d];
            if (!live || !live.options) return;                       /* not created yet */
            var o = live.options;
            if (def.kind === 'wms') {
                var liveLayers = o.layers;
                if (liveLayers && def.layer && liveLayers !== def.layer) {
                    problems.push(def.id + ': 2D LAYERS=' + liveLayers + ' vs registry ' + def.layer);
                }
                if (o.version && def.version && String(o.version) !== String(def.version)) {
                    problems.push(def.id + ': 2D version=' + o.version + ' vs registry ' + def.version);
                }
                if (o.format && def.format && o.format !== def.format) {
                    problems.push(def.id + ': 2D format=' + o.format + ' vs registry ' + def.format);
                }
            }
            var liveUrl = live._url || o.url;
            if (liveUrl && def.url && liveUrl !== def.url) {
                /* Leaflet normalises ?service=… order, so compare hosts+paths. */
                var a = String(liveUrl).split('?')[0], b = String(def.url).split('?')[0];
                if (a !== b) problems.push(def.id + ': 2D url=' + a + ' vs registry ' + b);
            }
        });
        return { ok: problems.length === 0, problems: problems };
    }

    var API = {
        VERSION: VERSION,
        GROUPS: GROUPS,
        TERRAIN_PROVIDERS: TERRAIN_PROVIDERS,
        DEFAULTS: MAP3D_DEFAULT,
        config: config,
        terrainSource: terrainSource,
        get: get,
        list: list,
        all: list,
        byGroup: byGroup,
        ordered: ordered,
        /* mirrored stub definitions + host routing policy */
        mirrorStubs: mirrorStubs,
        hostPolicy: hostPolicy,
        matchDef: matchDef,
        cenagisCatalog: cenagisCatalog,
        cenagis: { url: CENAGIS.url, version: CENAGIS.version, format: CENAGIS.format, transparent: CENAGIS.transparent, opacity: CENAGIS.opacity },
        resolve: resolveDef,
        register: function (def) {
            if (!def || !def.id) throw new Error('[layer-registry] register() needs an id');
            if (BY_ID[def.id]) throw new Error('[layer-registry] duplicate id: ' + def.id);
            if (!GROUPS[def.group]) throw new Error('[layer-registry] unknown group: ' + def.group);
            LAYERS.push(def);
            BY_ID[def.id] = def;
            return def;
        },
        /* builders */
        wmsTemplate: wmsTemplate,
        wmtsTemplate: wmtsTemplate,
        directTemplate: directTemplate,
        proxyTemplate: proxyTemplate,
        map3dTiles: map3dTiles,
        rasterSource: rasterSource,
        boundsTo3857: boundsTo3857,
        lngLatTo3857: lngLatTo3857,
        tileBounds3857At: tileBounds3857At,
        /* per-tile module builders (bbox-driven WMS / ArcGIS exportImage) */
        tileUrlAt: tileUrlAt,
        modeOf: modeOf,
        layerOf: layerOf,
        modes: function (id) {
            var def = get(id);
            return (def && def.modes) || null;
        },
        /* 2D adapters */
        wms2dOptions: wms2dOptions,
        tile2dOptions: tile2dOptions,
        url2d: url2d,
        service: service,
        /* state */
        is2dActive: is2dActive,
        opacityOf: opacityOf,
        timeOf: timeOf,
        /* reporting */
        layerStatus: layerStatus,
        diagnostics: diagnostics,
        verify2d: verify2d
    };
    /* ═══════════════════════════════════════════════════════════════════════
     *  ALBANIA ASIG CATALOGUE — mirrored from data/asig-layers.json.
     *  The catalogue holds the sections, titles and exact service names; the
     *  config (js/asig-albania-layers.config.js) adds the request rules. Each
     *  entry keeps the shared catalogue group/z-order it belongs to; the PANEL
     *  mounts every row in one Albania-only group (#albaniaRow) and the country
     *  filter shows them only while AL is the selected country — hence the
     *  `countries: ['AL']` attribution below.
     *
     *  Only rows the service can actually answer through WMS are registered:
     *    • the three tile-only products (Hillshade 2015 group, Dsm Hill Group,
     *      italiane 100k) are WMTS-only — there is no WMS layer to audit and
     *      the browser reprojects their tiles, so they are deliberately absent;
     *    • rows whose name is not in the catalogue yet (resolved at run time
     *      from GetCapabilities) have no LAYERS value, so they are skipped
     *      until the catalogue is regenerated from the export.
     *  The renderer owns the CRS fallback and the per-row failure reporting, so
     *  the global availability guard must not flip these independent switches.
     * ═══════════════════════════════════════════════════════════════════════ */
    (function registerAlbaniaLayers() {
        var cfg = null;
        try {
            cfg = root && root.ASIG_ALBANIA_CONFIG;
            if (!cfg && typeof require === 'function') cfg = require('./asig-albania-layers.config.js');
        } catch (e) { cfg = null; }
        if (!cfg || typeof cfg.enabledLayers !== 'function') return;
        var SELF_GUARD = 'js/asig-albania-layers.js detects image decode/tile errors, retries EPSG:4326 after ' +
            'the configured EPSG:3857 error burst, and reports persistent fallback failures on that layer row; ' +
            'the global guard must not toggle its independent control.';
        try {
            var skipped = [];
            cfg.enabledLayers().forEach(function (layer) {
                var id = 'albania.' + layer.id;
                if (BY_ID[id]) return;
                /* Tile-only rows and rows without a resolved name cannot be
                 * audited or proxied through WMS — see the block comment. */
                if (layer.kind === 'wmts') { skipped.push(layer.id + ' (WMTS-only)'); return; }
                if (!layer.layers) { skipped.push(layer.id + ' (name not in the catalogue yet)'); return; }
                API.register({
                    id: id,
                    group: layer.registryGroup,
                    z: layer.registryZ,
                    kind: 'wms',
                    title: layer.title,
                    url: (cfg.wms && cfg.wms.url) || (cfg.endpoints && cfg.endpoints.wms),
                    upstream: (cfg.endpoints && cfg.endpoints.wms) || (cfg.wms && cfg.wms.url),
                    layer: layer.layers,
                    format: layer.format,
                    transparent: !!layer.transparent,
                    version: (cfg.wms && cfg.wms.version) || '1.3.0',
                    crs: (cfg.wms && cfg.wms.crs) || 'EPSG:3857',
                    tileSize: (cfg.wms && cfg.wms.tileSize) || 256,
                    minZoom: layer.minZoom,
                    maxZoom: 20,
                    maxNativeZoom: layer.maxNativeZoom,
                    opacity: layer.opacity,
                    bounds: cfg.countryBounds,
                    /* The rows belong to Albania alone: js/asig-albania-layers.js
                     * hides the whole group for every other ISO (and in the
                     * global view), and map-app.js calls its filterForCountry. */
                    countries: [String(cfg.country || 'AL').toUpperCase()],
                    attribution: cfg.attribution,
                    provider: cfg.provider,
                    licence: cfg.licence,
                    requiresCredentials: [],
                    cors: 'unknown',
                    proxy: 'always',
                    guard: false,
                    selfGuarded: true,
                    selfGuardedReason: SELF_GUARD,
                    notes: layer.notes,
                    ui: {
                        toggle: 'albaniaToggle_' + layer.id,
                        slider: 'albaniaOpacity_' + layer.id,
                        pct: 'albaniaPct_' + layer.id,
                        selfGuarded: true,
                        configId: layer.id,
                        section: layer.section,
                        heritage: layer.kind === 'group'
                    }
                });
            });
            API.asigCatalogueSkips = function () { return skipped.slice(); };
        } catch (e) { /* a broken config must not take the catalogue down */ }
    }());

    /* ═══════════════════════════════════════════════════════════════════════
     *  DANISH LAYERS (Denmark) — mirrored from js/danish-layers.config.js
     * ───────────────────────────────────────────────────────────────────────
     * The config is the single description of every Danish layer; this block
     * only copies the enabled ones into the shared catalogue, so the 2D map's
     * diagnostics, the 3D status report and the offline audit
     * (tools/audit-wms-layers.mjs) treat them like any other layer. It runs in
     * the browser (the config is a plain script loaded first) and in Node (the
     * proxies and the tools require() the config), and it does nothing when the
     * config is not there — every other page keeps working unchanged.
     *
     * `url` is what the browser calls (a same-origin /api/geo/… route for the
     * credentialed layers, the provider itself for the public ones) and
     * `upstream` is the provider endpoint behind the proxy, for the docs.
     * `guard:false` + `selfGuarded` is deliberate: js/danish-layers.js owns
     * those rows (it probes the proxy, reports the missing credential, watches
     * the tiles and falls back to a public alternative), and the availability
     * guard must not switch a basemap off behind the visitor's back.          */
    (function registerDanishLayers() {
        var cfg = null;
        try {
            cfg = root && root.DANISH_LAYERS_CONFIG;
            if (!cfg && typeof require === 'function') cfg = require('./danish-layers.config.js');
        } catch (e) { cfg = null; }
        if (!cfg || typeof cfg.enabledLayers !== 'function') return;
        var SELF_GUARD = 'js/danish-layers.js owns this row: it probes the same-origin route once ' +
            '(a missing credential is reported in the row), watches the tiles and falls back to a ' +
            'public alternative — the switch must stay under the visitor\u2019s control.';
        try {
            cfg.enabledLayers().forEach(function (layer) {
                var id = 'danish.' + layer.id;
                if (BY_ID[id]) return;
                var isBase = layer.group === 'base';
                API.register({
                    id: id,
                    group: isBase ? 'danish-base' : 'danish-overlay',
                    z: isBase ? 399 : 406,
                    kind: layer.type === 'wms' ? 'wms' : (layer.type === 'wfs' ? 'wfs' : 'tile'),
                    title: layer.title,
                    url: layer.url,
                    upstream: layer.upstream,
                    layer: layer.layers,
                    format: layer.format,
                    transparent: !!layer.transparent,
                    version: layer.version,
                    crs: layer.crs,
                    tileSize: layer.tileSize,
                    minZoom: layer.minZoom,
                    maxZoom: layer.maxZoom,
                    maxNativeZoom: layer.maxNativeZoom,
                    opacity: layer.opacity,
                    attribution: layer.attribution,
                    provider: layer.provider,
                    licence: layer.licence,
                    requiresCredentials: layer.requiresCredentials || [],
                    cors: 'unknown',
                    proxy: 'auto',
                    guard: false,
                    selfGuarded: true,
                    selfGuardedReason: SELF_GUARD,
                    notes: layer.notes,
                    ui: {
                        toggle: 'danishToggle_' + layer.id,
                        slider: isBase ? undefined : 'danishOpacity_' + layer.id,
                        select: isBase ? 'danishBaseMap' : undefined,
                        selfGuarded: true,
                        configId: layer.id
                    }
                });
            });
        } catch (e) { /* a broken config must not take the catalogue down */ }
    }());

    /* ═══════════════════════════════════════════════════════════════════════
     *  FINNISH LAYERS (Finland) — mirrored from js/finland-layers.config.js
     * ───────────────────────────────────────────────────────────────────────
     * Same contract as the Albanian and Danish mirrors: the config is the
     * single description of every Finnish layer (MML WMTS rasters on the
     * ETRS-TM35FIN grid, MML HKP cadastral MVT, Museovirasto GetWFSFeatures
     * families, SYKE WMS, the Åland ArcGIS REST service and the local
     * GeoJSON conversions); this block only copies the ENABLED ones into the
     * shared catalogue so the diagnostics, the 3D status report and the
     * offline audit see them. It runs in the browser (the config script is
     * loaded first) and in Node (tools require() it), and does nothing when
     * the config is absent.
     *
     * `guard:false` + `selfGuarded` for the same reason as the other country
     * modules: js/finland-layers.js owns every row — it reprojects TM35FIN
     * tiles on canvases, decodes MVT, debounces the WFS boxes and switches
     * direct→proxy per layer — and the availability guard must not flip the
     * very switch that drives that state machine.                              */
    (function registerFinlandLayers() {
        var cfg = null;
        try {
            cfg = root && root.FINLAND_LAYERS_CONFIG;
            if (!cfg && typeof require === 'function') cfg = require('./finland-layers.config.js');
        } catch (e) { cfg = null; }
        if (!cfg || typeof cfg.enabledLayers !== 'function') return;
        var SELF_GUARD = 'js/finland-layers.js owns this row: direct requests are tried first, the ' +
            'layer falls back to the same-origin /api/geo/finland proxy after repeated failures, a ' +
            'failed tile degrades to a transparent pixel and persistent failures are reported in the ' +
            'row with a Retry — the switch must stay under the visitor\\\\u2019s control.';
        /* the registry's coarser kind taxonomy */
        var KIND = {
            'tm35-wmts': 'wmts',
            'mvt': 'tile',
            'wfs': 'wfs',
            'arcgis': 'arcgis-image',
            'geojson': 'dynamic'
        };
        var UPSTREAM_BASE = {
            'tm35-wmts': function (layer) { return layer.urlTemplate; },
            'mvt': function () { return 'https://hkp.maanmittauslaitos.fi/hkp/action?action_route=GetLayerTile'; },
            'wfs': function () { return 'https://kartta.museoverkko.fi/action?action_route=GetWFSFeatures'; },
            'wms': function (layer) {
                return (cfg.WMS_SERVICES && cfg.WMS_SERVICES[layer.service] && cfg.WMS_SERVICES[layer.service].url) || '';
            },
            'arcgis': function (layer) { return (cfg.endpoints && cfg.endpoints.alandRest) + '/' + layer.restService; },
            'geojson': function (layer) { return (cfg.endpoints && cfg.endpoints.supabase) + (layer.supabaseFile || ''); }
        };
        try {
            cfg.enabledLayers().forEach(function (layer) {
                var id = 'finland.' + layer.id;
                if (BY_ID[id]) return;
                var isVector = layer.kind === 'wfs' || layer.kind === 'mvt' || layer.kind === 'geojson';
                API.register({
                    id: id,
                    group: isVector ? 'finland-vector' : 'finland-raster',
                    z: isVector ? 409 : 408,
                    kind: KIND[layer.kind] || layer.kind,
                    title: layer.title,
                    url: UPSTREAM_BASE[layer.kind] ? UPSTREAM_BASE[layer.kind](layer) : '',
                    upstream: UPSTREAM_BASE[layer.kind] ? UPSTREAM_BASE[layer.kind](layer) : '',
                    layer: layer.layers || layer.layerNames && layer.layerNames.join(',') || null,
                    format: layer.format,
                    transparent: layer.transparent !== false,
                    version: layer.version,
                    crs: (layer.kind === 'tm35-wmts' || layer.kind === 'mvt') ? 'EPSG:3067'
                        : layer.kind === 'wfs' ? 'EPSG:4326'
                            : (layer.crs || 'EPSG:3857'),
                    tileSize: 256,
                    minZoom: layer.minZoom,
                    maxZoom: layer.maxZoom || 20,
                    maxNativeZoom: layer.maxNativeZoom || layer.maxNativeLevel,
                    opacity: layer.opacity,
                    bounds: cfg.countryBounds,
                    attribution: layer.attributionRow || cfg.attribution,
                    provider: cfg.provider,
                    licence: cfg.licence,
                    requiresCredentials: [],
                    cors: 'unknown',
                    proxy: 'auto',
                    guard: false,
                    selfGuarded: true,
                    selfGuardedReason: SELF_GUARD,
                    notes: layer.notes,
                    ui: {
                        toggle: 'finlandToggle_' + layer.id,
                        slider: 'finlandOpacity_' + layer.id,
                        pct: 'finlandPct_' + layer.id,
                        selfGuarded: true,
                        configId: layer.id
                    }
                });
            });
        } catch (e) { /* a broken config must not take the catalogue down */ }
    }());

    return API;
}));
