/* =====================================================================
 * layer-panel-rows.js — the rows inside the layers window
 * ---------------------------------------------------------------------
 * The window (#transpPanel) is one glass pane since the 2026-10-25 release
 * and so are its rows. Two jobs live here, because both of them need to
 * know which *layer* a row belongs to and neither can be expressed in CSS:
 *
 *   1. GLASS — every nested row the catalogue renders inside a
 *      `*SubLayers` accordion is tagged `.dl-sublayer-row`, so it takes the
 *      same translucent violet box as a top-level `.transp-layer-row` and as
 *      the map controls (`--ctl-*`, css/styles.css § Layer rows). The
 *      CENAGIS catalogue rows are tagged the same way; their generator
 *      (js/historical-eu-maps.js) still writes its own dark inline box, which
 *      is removed here instead of being fought with `!important`.
 *
 *   2. TILE PHOTO — every historical-map sublayer row carries a photo of one
 *      of its OWN tiles as the row background, mean-ed out under a violet
 *      wash so the switch, the slider, the info button and the labels stay
 *      readable on top of it. The URL comes from the layer's own definition
 *      in js/layer-registry.js — its tile template for XYZ / ArcGIS
 *      pyramids, a GetMap window for WMS mosaics — never from a second copy
 *      of the endpoints. A sheet whose pyramid has no reliable preview tile
 *      (Valahia) uses the supplied scan in SHEET_PHOTOS instead. The row is
 *      only given the photo once the image has actually loaded, so a service
 *      that is down leaves a plain glass row instead of an empty frame (and
 *      never retries on every sweep).
 *
 *      Which rows are historical-map rows is the registry's answer, not a
 *      list kept here: the two Romanian groups (`hist-free`,
 *      `hist-premium`), plus any layer whose own country config files it
 *      under a Historical maps section — mirrored as `panelGroup:
 *      'historical'` (Denmark: js/danish-layers.config.js →
 *      js/layer-registry.js → js/danish-layers.js, which tags the rows it
 *      generates with `data-preview-layer="danish.<id>"`). A Danish sheet
 *      previews through the same-origin /api/geo/dk-dtk25 proxy that draws
 *      it, so the token stays server-side for the row photo too. Albania's
 *      WMTS-only historical rows opt in with `data-preview-wmts` and use the
 *      catalogue's own EPSG:4326 matrix URL.
 *
 *  Rows opt in with `data-preview-layer="<registry id>"`; the CENAGIS
 *  catalogue rows carry `data-map-id="<catalogue key>"` instead, and are
 *  resolved as `cenagis.<key>`.
 * ===================================================================== */
(function (root) {
    'use strict';

    var DOC = root && root.document;
    if (!DOC) return;

    /* ── Anchors for layers whose definition carries no bounding box ──────
     * A town that is well inside the sheet's own footprint: for a row
     * backdrop all that matters is that the tile really is one of that
     * sheet's tiles (never a neighbouring mosaic, never a blank ocean
     * corner). Everything with a `bounds` box uses the centre of the box
     * instead — see centreOf().
     *
     * The Danish sheets are mirrored into the registry without a box, and
     * their country-wide one (54.4–57.8 N, 8.0–15.6 E) would centre in the
     * Kattegat anyway: water, on every one of the historical series. So each
     * of the six gets a town that its own series really covers — the
     * Prussian measuring-table sheets (1877–1920) only exist for the South
     * Jutland they were drawn in, which is why theirs is Aabenraa and not
     * Aarhus. */
    var ANCHORS = {
        'hist.austrian':               { lat: 46.777, lng: 23.599 },   /* Cluj-Napoca */
        'hist.firing-plans':           { lat: 45.657, lng: 25.601 },   /* Brașov */
        'hist.soviet-1970':            { lat: 47.158, lng: 27.601 },   /* Iași */
        'premium.josephine':           { lat: 46.777, lng: 23.599 },   /* Cluj-Napoca */
        'premium.bucovina':            { lat: 47.986, lng: 24.260 },   /* within the Bucovina sheet */
        'premium.austro-hungarian':    { lat: 48.000, lng: 24.200 },   /* within the shared Galicia–Bucovina sheet */
        'premium.moldova-1868':        { lat: 47.158, lng: 27.601 },   /* Iași */
        'premium.moldova-wwii':        { lat: 47.158, lng: 27.601 },   /* Iași */
        'premium.polish-tactical-1933': { lat: 49.842, lng: 24.031 },  /* Lviv */
        'premium.ww1':                 { lat: 49.783, lng: 22.768 },   /* Przemyśl */
        'premium.ww2':                 { lat: 49.783, lng: 22.768 },   /* Przemyśl */
        'premium.walachia-1855':       { lat: 44.4268, lng: 26.1025 }, /* Bucharest */
        'premium.banat':               { lat: 45.748, lng: 21.208 },   /* Timișoara */
        'premium.galicia-1855':        { lat: 49.842, lng: 24.031 },   /* Lviv */
        'premium.mitteleuropa':        { lat: 52.232, lng: 21.006 },   /* Warsaw */
        'premium.chrzanowski':         { lat: 50.062, lng: 19.937 },   /* Kraków */
        'premium.reymann':             { lat: 52.406, lng: 16.925 },   /* Poznań */
        'premium.kdr-100k':            { lat: 52.520, lng: 13.405 },   /* Berlin */
        'premium.kdr-gb':              { lat: 52.232, lng: 21.006 },   /* Warsaw */
        'premium.wig-100k':            { lat: 52.232, lng: 21.006 },   /* Warsaw */
        /* Denmark — the Historical maps section of js/danish-layers.config.js */
        'danish.dtk25':                { lat: 56.153, lng: 10.204 },   /* Aarhus (the config's own DK view) */
        'danish.hist_hoeje':           { lat: 56.153, lng: 10.204 },   /* Aarhus · høje målebordsblade 1842–1899 */
        'danish.hist_lave':            { lat: 55.404, lng: 10.403 },   /* Odense · lave målebordsblade 1901–1971 */
        'danish.hist_preussen':        { lat: 55.041, lng: 9.421 },    /* Aabenraa · preussiske blade 1877–1920 */
        'danish.topo4cm_1953_1976':    { lat: 57.049, lng: 9.922 },    /* Aalborg · 4 cm-kort 1953–1976 */
        'danish.topo4cm_1980_2001':    { lat: 55.676, lng: 12.568 }    /* Copenhagen · 4 cm-kort 1980–2001 */
    };

    /* A full sheet scan used as the row photo when the XYZ pyramid has no
     * reliable preview tile. The map itself still uses the layer template. */
    var SHEET_PHOTOS = {
        'premium.walachia-1855': 'https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/Harti/szathm-ri-s-series-1-57-600-5-l.jpg'
    };

    /* Preview-only candidates for sheets with sparse or uncertain pyramids.
     * Coordinates for the four R2 sheets are inside their coverage rectangles
     * in map-app.js. Try different locations and native zooms before nearby
     * tiles; do not infer the availability of a whole pyramid from one tile.
     *
     * A WMS mosaic may use the same table for its own reason: the scanned
     * Danish series are sheet-by-sheet, so one town can sit in a gap. There
     * `zooms` is ignored — the GetMap window is SPAN_METERS wide everywhere —
     * and each point becomes one more candidate the loader tries in order. */
    var SPARSE_PREVIEWS = {
        'premium.moldova-1868': { points: [[47.158, 27.601], [46.57, 27.91], [45.44, 28.05]], zooms: [12, 11, 10, 13, 9, 8] },
        'premium.polish-tactical-1933': { points: [[48.10, 25.90], [48.10, 24.00], [47.95, 27.00]], zooms: [12, 11, 10, 13, 9, 8] },
        'premium.ww1': { points: [[45.44, 28.05], [44.4268, 26.1025], [47.158, 27.601]], zooms: [10, 9, 11, 8] },
        'premium.ww2': { points: [[44.4268, 26.1025], [45.44, 28.05], [47.158, 27.601]], zooms: [10, 9, 8] },
        /* Odense, Copenhagen, Aalborg — the 1842–1899 high sheets. */
        'danish.hist_hoeje': { points: [[55.404, 10.403], [55.676, 12.568], [57.049, 9.922]] },
        /* Sønderborg, Haderslev, Tønder — all inside Prussian Schleswig. */
        'danish.hist_preussen': { points: [[54.913, 9.792], [55.250, 9.489], [54.933, 9.083]] }
    };

    var TILE_ZOOM = 13;      /* mid detail: recognisable, small, and inside
                              * every sheet's native window                  */
    var SPAN_METERS = 9000;  /* WMS preview window: roughly one town         */
    var WMS_WIDTH = 168;
    var WMS_HEIGHT = 96;
    var HISTORICAL_GROUPS = { 'hist-free': true, 'hist-premium': true };

    /* Is this definition a historical map sheet — the kind of row that gets a
     * photo of one of its own tiles? The two Romanian groups, plus any layer
     * whose own country config files it under a Historical maps section
     * (mirrored into the registry as `panelGroup: 'historical'` — Denmark's
     * målebordsblade, 4 cm-kort and DTK25 today). Asking the registry keeps
     * this module from carrying a second list of layers: a new sheet added to
     * js/danish-layers.config.js is photographed the moment it is rendered. */
    function isHistoricalSheet(def) {
        if (!def) return false;
        if (HISTORICAL_GROUPS[def.group] === true) return true;
        return def.panelGroup === 'historical';
    }

    var READY = {};          /* url → the tile really loaded, paint it at once */
    var BROKEN = {};         /* url → it failed once, never ask again          */
    var PENDING = [];        /* in-flight Image()s — keeps them alive         */
    var QUEUE = [];          /* rows waiting for a free request slot          */
    var IN_FLIGHT = 0;
    var MAX_IN_FLIGHT = 4;   /* a whole catalogue opens at once; do not open a
                              * dozen parallel sockets per sheet host         */
    var timers = { sweep: 0, glass: 0 };

    function registry() {
        var r = root.DetectLabLayers;
        return (r && typeof r.get === 'function') ? r : null;
    }

    /* ── geometry ──────────────────────────────────────────────────────── */
    function mercator(lat, lng) {
        var world = 20037508.342789244;
        return { x: lng * world / 180, y: world * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI };
    }

    function tileX(lng, z) {
        return Math.floor((lng + 180) / 360 * Math.pow(2, z));
    }

    function tileY(lat, z) {
        var rad = lat * Math.PI / 180;
        return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, z));
    }

    function centreOf(def) {
        var anchor = ANCHORS[def.id];
        if (anchor) return anchor;
        var b = def.bounds;
        if (b && b.length === 2 && b[0] && b[1] &&
            typeof b[0][0] === 'number' && typeof b[1][0] === 'number') {
            return { lat: (b[0][0] + b[1][0]) / 2, lng: (b[0][1] + b[1][1]) / 2 };
        }
        return null;
    }

    function zoomOf(def) {
        var z = Math.min(def.maxNativeZoom || def.maxZoom || TILE_ZOOM, TILE_ZOOM);
        if (def.minZoom != null && z < def.minZoom) z = def.minZoom;
        if (def.maxZoom != null && z > def.maxZoom) z = def.maxZoom;
        return Math.max(0, Math.min(22, Math.round(z)));
    }

    /* ── the row photo URL ─────────────────────────────────────────────── */

    /* A WMS mosaic's row photo: a small GetMap over one point of the sheet,
     * asked the way the map itself asks it — EPSG:3857, `srs=` for 1.1.x and
     * `crs=` for 1.3.0, the layer's own FORMAT and TRANSPARENT — and sent to
     * the layer's own endpoint. For the token-gated Danish sheets that
     * endpoint is the same-origin /api/geo/dk-dtk25 proxy, so the row photo
     * never needs (and never sees) a credential either. */
    function wmsPreviewUrl(def, centre) {
        var m = mercator(centre.lat, centre.lng);
        var half = SPAN_METERS / 2;
        var version = String(def.version || '1.1.1');
        var axis = version.indexOf('1.3') === 0 ? 'crs' : 'srs';
        var bbox = [m.x - half, m.y - half, m.x + half, m.y + half].map(function (n) {
            return n.toFixed(1);
        }).join(',');
        var params = [
            'service=WMS', 'request=GetMap', 'version=' + version,
            'layers=' + encodeURIComponent(def.layer || ''), 'styles=',
            'format=' + encodeURIComponent(def.format || 'image/png'),
            'transparent=' + (def.transparent === false ? 'false' : 'true'),
            axis + '=EPSG:3857', 'bbox=' + bbox,
            'width=' + WMS_WIDTH, 'height=' + WMS_HEIGHT
        ];
        return String(def.url) + (String(def.url).indexOf('?') === -1 ? '?' : '&') + params.join('&');
    }

    function urlsFor(id) {
        var reg = registry();
        if (!reg) return [];
        var def = reg.get(id);
        if (!isHistoricalSheet(def)) return [];
        /* An explicit sheet scan is the preview. Do not fall through to an
           XYZ tile that may 404 or come back transparent. */
        if (SHEET_PHOTOS[id]) return [SHEET_PHOTOS[id]];
        var centre = centreOf(def);
        if (!centre || !def.url) return [];

        if (def.kind === 'xyz' || def.kind === 'arcgis-image') {
            var sparse = SPARSE_PREVIEWS[id];
            if (sparse) {
                var previewTiles = (sparse.tiles || []).slice();
                (sparse.zooms || []).forEach(function (level) {
                    (sparse.points || []).forEach(function (point) {
                        previewTiles.push([level, tileX(point[1], level), tileY(point[0], level)]);
                    });
                });
                return previewTiles.map(function (tile) {
                    return String(def.url).replace(/\{(z|x|y)\}/g, function (match, key) {
                        return tile[key === 'z' ? 0 : key === 'x' ? 1 : 2];
                    });
                }).filter(function (url, index, urls) { return urls.indexOf(url) === index; });
            }
            var z = zoomOf(def);
            var cx = tileX(centre.lng, z);
            var cy = tileY(centre.lat, z);
            var candidates = [];
            var bounds = def.bounds;
            var minX = cx - 2, maxX = cx + 2, minY = cy - 2, maxY = cy + 2;
            if (bounds && bounds.length === 2) {
                minX = tileX(bounds[0][1], z);
                maxX = tileX(bounds[1][1], z);
                minY = tileY(bounds[1][0], z);
                maxY = tileY(bounds[0][0], z);
            }
            for (var x = minX; x <= maxX; x++) {
                for (var y = minY; y <= maxY; y++) {
                    candidates.push({ x: x, y: y, distance: Math.abs(x - cx) + Math.abs(y - cy) });
                }
            }
            /* Some historical sheets have ragged edges or imperfect catalogue
               bounds. Probe the closest tiles first, then a few neighbours so
               one missing/transparent center tile cannot leave the row blank. */
            candidates.sort(function (a, b) { return a.distance - b.distance; });
            candidates = candidates.slice(0, 25);
            return candidates.map(function (tile) {
                return String(def.url).replace(/\{(z|x|y)\}/g, function (match, key) {
                    if (key === 'z') return z;
                    return key === 'x' ? tile.x : tile.y;
                });
            });
        }

        if (def.kind === 'wms') {
            /* One GetMap window per candidate town. The loader asks them in
               order and paints the first answer, so a scanned series with a
               gap over the anchor town still photographs its row; a mosaic
               with no extra points gets the single window it always got. */
            var points = [centre];
            var wmsCandidates = SPARSE_PREVIEWS[id];
            if (wmsCandidates && wmsCandidates.points) {
                wmsCandidates.points.forEach(function (point) {
                    points.push({ lat: point[0], lng: point[1] });
                });
            }
            return points.map(function (point) { return wmsPreviewUrl(def, point); })
                .filter(function (url, index, urls) { return urls.indexOf(url) === index; });
        }

        return [];
    }

    function urlFor(id) {
        var urls = urlsFor(id);
        return urls.length ? urls[0] : null;
    }

    /* Albania's three tile-only products are not WMS registry layers, but
     * their panel rows still need a real map tile. Use the catalogue's WMTS
     * URL builder and one tile covering Tirana on its EPSG:4326 matrix. */
    function wmtsPreviewUrl(layerName) {
        var cfg = root.ASIG_ALBANIA_CONFIG;
        if (!cfg || !cfg.wmtsTileUrl || !layerName) return null;
        var z = 8;
        var lat = 41.3275, lng = 19.8187;
        var col = Math.floor((lng + 180) / 360 * Math.pow(2, z + 1));
        var row = Math.floor((90 - lat) / 180 * Math.pow(2, z));
        return cfg.wmtsTileUrl(layerName, z, col, row);
    }

    /* ── DOM helpers ───────────────────────────────────────────────────── */
    function panel() {
        return DOC.getElementById('transpPanel');
    }

    function isVisible(row, host) {
        if (!row.getClientRects || !row.getClientRects().length) return false;
        /* A collapsed accordion is not `display:none`: its rows keep their
           layout boxes, they are only clipped by an ancestor with no height.
           Asking for a photo of a row nobody can see would fire 45 CENAGIS
           GetMaps (and 26 sheet tiles) every time the window is opened. */
        var style = root.getComputedStyle;
        if (typeof style !== 'function') return true;
        for (var node = row; node && node !== host; node = node.parentElement) {
            var cs = style.call(root, node);
            if (!cs) break;
            if (cs.display === 'none' || cs.visibility === 'hidden') return false;
            if ((cs.overflow === 'hidden' || cs.overflowY === 'hidden') && parseFloat(cs.height) < 2) return false;
        }
        return true;
    }

    /* The row of a nested control is the direct child of a `*SubLayers`
       container that contains it — that is exactly the box the panel draws a
       background for. */
    function subRowFor(control, host) {
        var node = control && control.parentElement;
        while (node && node !== host) {
            var up = node.parentElement;
            if (up && up.id && /SubLayers$/.test(up.id)) return node;
            node = up;
        }
        return null;
    }

    function markGlass() {
        var host = panel();
        if (!host) return 0;
        var tagged = 0;

        var controls = host.querySelectorAll('[id$="SubLayers"] input[type="range"], [id$="SubLayers"] .apm-toggle-switch input');
        Array.prototype.forEach.call(controls, function (control) {
            var row = subRowFor(control, host);
            if (row && !row.classList.contains('dl-sublayer-row')) {
                row.classList.add('dl-sublayer-row');
                tagged++;
            }
        });

        /* CENAGIS catalogue rows: generated with their own dark inline box
           (`style="background:rgba(0,0,0,.22);border:…;border-radius:5px;padding:6px"`
           in js/historical-eu-maps.js). The whole attribute goes: a style
           parser is free to expand those shorthands into longhands, so
           removing property by property would leave half a box behind, and
           the row material wants to own all of it anyway. */
        Array.prototype.forEach.call(host.querySelectorAll('.cenagis-map-row'), function (row) {
            /* Only strip the generator's inline box once. Later sweeps must
               preserve --row-preview, which paint() stores in the same style. */
            if (!row.classList.contains('dl-sublayer-row')) {
                row.removeAttribute('style');
                row.classList.add('dl-sublayer-row');
            }
        });

        return tagged;
    }

    function paint(row, url) {
        row.style.setProperty('--row-preview', 'url("' + url + '")');
        row.setAttribute('data-row-preview', '');
        row.setAttribute('data-row-preview-state', 'ok');
    }

    function attach(row, urls) {
        /* Retain candidates for a row: map-sheet edges are often ragged, so a
           404 at the anchor tile should try nearby tiles from the same map. */
        var first = urls[0];
        if (READY[first]) {
            paint(row, first);
            return;
        }
        row.setAttribute('data-row-preview-state', 'pending');
        QUEUE.push({ row: row, urls: urls, index: 0 });
        pump();
    }

    function pump() {
        while (IN_FLIGHT < MAX_IN_FLIGHT && QUEUE.length) load(QUEUE.shift());
    }

    function load(job) {
        var row = job.row;
        while (job.index < job.urls.length && BROKEN[job.urls[job.index]]) job.index++;
        var url = job.urls[job.index];
        if (!url) {
            row.setAttribute('data-row-preview-state', 'failed');
            pump();
            return;
        }
        if (READY[url]) {
            paint(row, url);
            return;
        }
        var img = new root.Image();
        var released = false;
        IN_FLIGHT++;
        function release() {
            if (released) return;
            released = true;
            IN_FLIGHT--;
            var at = PENDING.indexOf(img);
            if (at !== -1) PENDING.splice(at, 1);
            pump();
        }
        img.onload = function () {
            release();
            READY[url] = true;
            paint(row, url);
        };
        img.onerror = function () {
            release();
            BROKEN[url] = true;
            job.index++;
            if (job.index < job.urls.length) QUEUE.unshift(job);
            else row.setAttribute('data-row-preview-state', 'failed');
            pump();
        };
        PENDING.push(img);
        img.src = url;
    }

    function sweep() {
        var host = panel();
        if (!host || !host.classList.contains('open')) return 0;
        markGlass();

        var rows = host.querySelectorAll('[data-preview-layer], [data-preview-wmts], .cenagis-map-row[data-map-id]');
        var started = 0;
        Array.prototype.forEach.call(rows, function (row) {
            if (row.hasAttribute('data-row-preview') || row.hasAttribute('data-row-preview-state')) return;
            if (!isVisible(row, host)) return;    /* collapsed accordion / hidden tab */
            var id = row.getAttribute('data-preview-layer');
            var wmtsName = row.getAttribute('data-preview-wmts');
            if (!id && !wmtsName) id = 'cenagis.' + row.getAttribute('data-map-id');
            var urls = wmtsName ? [wmtsPreviewUrl(wmtsName)].filter(Boolean) : urlsFor(id);
            if (!urls.length) {
                row.setAttribute('data-row-preview-state', 'unavailable');
                return;
            }
            started++;
            attach(row, urls);
        });
        return started;
    }

    function later(kind, fn, delay) {
        if (timers[kind]) root.clearTimeout(timers[kind]);
        timers[kind] = root.setTimeout(function () {
            timers[kind] = 0;
            fn();
        }, delay || 60);
    }

    function schedule() {
        later('sweep', sweep);
    }

    function observe() {
        var host = panel();
        if (!host || typeof root.MutationObserver !== 'function') return;

        /* Opening the window, switching tabs, expanding an accordion — and
           anything that makes a row visible from inside the panel. The whole
           subtree is watched, not just the pane, because the country filter
           hides and shows rows by class on the ROWS
           (`country-layer-unavailable`, toggled by js/danish-layers.js,
           js/finland-layers.js, js/asig-albania-layers.js …) while the
           visitor's click lands on the country dock outside the pane: a
           Denmark-only sheet row would otherwise stay unphotographed until
           the next click inside the window. Every callback is debounced and a
           sweep skips the rows it already painted, so the extra mutations
           (a layer switched on, a photo applied) cost one cheap pass. */
        new root.MutationObserver(function () {
            later('glass', markGlass, 40);
            schedule();
        }).observe(host, {
            attributes: true, attributeFilter: ['class', 'style', 'open'], subtree: true
        });

        /* The CENAGIS catalogue is re-rendered on every country change. */
        var eu = DOC.getElementById('histEuMapsSection');
        if (eu) {
            new root.MutationObserver(function () {
                later('glass', markGlass, 40);
                schedule();
            }).observe(eu, { childList: true });
        }

        host.addEventListener('click', schedule, true);
        /* Accordions expand with a transition; sweep once it settles so the
           rows that were clipped a moment ago get their photo. */
        host.addEventListener('transitionend', schedule, true);
    }

    function init() {
        markGlass();
        observe();
        if (panel() && panel().classList.contains('open')) sweep();
        DOC.addEventListener('detectlab:langchange', function () {
            later('sweep', sweep, 200);
        });
    }

    root.DetectLabPanelRows = {
        anchors: ANCHORS,
        sheetPhotos: SHEET_PHOTOS,
        sparsePreviews: SPARSE_PREVIEWS,
        isHistoricalSheet: isHistoricalSheet,
        urlFor: urlFor,
        urlsFor: urlsFor,
        wmtsPreviewUrl: wmtsPreviewUrl,
        markGlass: markGlass,
        sweep: sweep,
        tileZoom: TILE_ZOOM,
        spanMeters: SPAN_METERS
    };

    if (DOC.readyState === 'loading') {
        DOC.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}(typeof window !== 'undefined' ? window : this));
