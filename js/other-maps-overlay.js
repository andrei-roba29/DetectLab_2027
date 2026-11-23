/* =====================================================================
 * other-maps-overlay.js — free-transform image overlays (Adobe-style)
 * ---------------------------------------------------------------------
 * A non-georeferenced sheet has no footprint on the ground, so it cannot be
 * a Leaflet layer: Leaflet positions layers geographically and its panes are
 * rewritten on every pan.  These overlays therefore keep their OWN transform
 * state (anchor + metres-per-pixel + rotation + opacity) and are painted as a
 * plain DOM element inside a dedicated pane:
 *
 *     translate3d(anchorLayerPoint) · rotate(θ) · scale(k) · translate(-size/2)
 *
 * Because the anchor is a real LatLng and the size is derived from metres per
 * image pixel, the sheet behaves like a map layer when the basemap moves —
 * while the user stays in full control of where, how big and how rotated it
 * sits, exactly like dragging one image over another in Photoshop.
 *
 * Quality and framing (the “it looks blurry and changes format on zoom” fix):
 *   * a FRESH sheet is framed into the viewport (longest side ≈ 70 % of the
 *     smaller edge, same rule as fitToView) instead of at an arbitrary
 *     ~4 km ground size that rendered as a blur at county zooms — so it
 *     loads in its natural format, at its best available sharpness;
 *   * the pyramid level is the one closest to 1 level pixel ≈ 1 screen
 *     pixel, upgraded one level (downscaling = crisp) when the visible tile
 *     window stays within MAX_SHARP_TILES;
 *   * when a zoom moves the sheet to a FINER level, the old tiles are kept
 *     as a blurred stand-in (repositioned by 2^Δ) until the new level has
 *     loaded, so the sheet never vanishes mid-zoom; going coarser just
 *     refetches the one or two coarse tiles;
 *   * every tile is painted at the level-pixel box it really covers: the
 *     Hungaricana pyramid pads the sheet inside a full 512 px cell, while a
 *     source that CROPS at the image edge (NLS IIIF) reports the narrower
 *     span through Tiles.tileSpan() — stretching such a bitmap into a square
 *     cell made the sheet change shape level by level (§8.2).
 *
 * Public API: window.DetectLabOtherMapsOverlay.createManager(map, opts) →
 *   add(record, state) / remove(id) / get(id) / list() / setActive(id)
 *   setAlignMode(on) / isAlignMode() / setOpacity(id, v) / setState(id, patch)
 *   centerOn(id) / fitToView(id) / clear() / setVisible(on)
 *   onStateChange(fn) / destroy()
 * ===================================================================== */
(function (root) {
    'use strict';

    var L = root.L;
    var Tiles = root.DetectLabOtherMapsTiles;
    var TILE = 512;
    /* Half-pixel bleed added to every painted tile so neighbouring tiles
     * overlap instead of leaving a hairline seam on fractional scales. */
    var TILE_BLEED = 0.6;

    /* Metres per image pixel — the slowest and the fastest sensible scale.
     * 0.02 m/px is a cadastral plan at field level, 400 m/px is a wall map of
     * a whole region; nothing useful lives outside that window. */
    var MPP_MIN = 0.02;
    var MPP_MAX = 400;
    var DEFAULT_GROUND_WIDTH_M = 4000;   // last-resort ground size (no viewport)
    var FIT_FRACTION = 0.7;              // “Încadrează”: longest side over the smaller viewport edge
    var MAX_SHARP_TILES = 36;            // tile budget (viewport-sized, pan-independent) for the sharp-level preference
    var STALE_FALLBACK_MS = 6000;        // stand-in tiles are dropped after this even if no tile settles
    var SNAP_DEG = 1.5;                  // rotation snaps near 0/90/180/270

    /* ── the georeference square ───────────────────────────────────────
     * A Hungaricana sheet carries a place name but no footprint, so the
     * user aligns it by hand.  To keep that alignment sane, each sheet is
     * confined to a square around the place it was added for: the sheet's
     * anchor may be dragged, rotated and scaled, but it may never leave
     * that square — so the sheet can only be georeferenced over the ground
     * it actually belongs to.  5 km is the default; an exceptional sheet
     * (a wide county map, an approximate place name) can be given a bigger
     * square from the “Overlay the map” panel. */
    var DEFAULT_GEOREF_KM = 5;           // default square side, in kilometres
    var GEOREF_MIN_KM = 1;               // smallest square the panel allows
    var GEOREF_MAX_KM = 200;             // largest square the panel allows
    var GEOREF_EARTH_R = 6378137;        // WGS84 semi-major axis (resolutionAt)

    var UI_SELECTOR = 'button, a, input, select, textarea, label, .leaflet-control, ' +
        '.leaflet-popup, .om-panel, .om-modal, .om-handle, .leaflet-marker-icon';

    function clamp(value, min, max) { return value < min ? min : (value > max ? max : value); }

    function normalizeDegrees(deg) {
        var value = (Number(deg) || 0) % 360;
        if (value > 180) value -= 360;
        if (value < -180) value += 360;
        return value;
    }

    function snapDegrees(deg) {
        var nearest = Math.round(deg / 90) * 90;
        return Math.abs(deg - nearest) <= SNAP_DEG ? normalizeDegrees(nearest) : deg;
    }

    /**
     * Clamp a LatLng into the axis-aligned square of side `sideKm` centred
     * on (centerLat, centerLng).  The offset is measured in ground metres
     * (equirectangular around the centre), so the square really is a 5 km
     * square on the ground at any latitude — not a 5 km box in degrees.
     * Returns the input unchanged when there is nothing to clamp (a zero
     * square, or non-finite coordinates).
     */
    function clampToSquare(lat, lng, centerLat, centerLng, sideKm) {
        var half = Math.max(0, Number(sideKm) || 0) * 1000 / 2;
        var dLat = Number(lat), dLng = Number(lng);
        var cLat = Number(centerLat), cLng = Number(centerLng);
        if (!isFinite(dLat) || !isFinite(dLng) || !isFinite(cLat) || !isFinite(cLng)) {
            return { lat: dLat, lng: dLng };
        }
        if (half <= 0) return { lat: dLat, lng: dLng };
        var mPerLat = Math.PI * GEOREF_EARTH_R / 180;              // ≈ 111 320 m/°
        var mPerLng = mPerLat * Math.cos(cLat * Math.PI / 180);    // shrinks with latitude
        var safeLng = Math.abs(mPerLng) < 1e-6 ? 1e-6 : mPerLng;
        var dx = (dLng - cLng) * safeLng;
        var dy = (dLat - cLat) * mPerLat;
        var cdx = clamp(dx, -half, half);
        var cdy = clamp(dy, -half, half);
        return {
            lat: cLat + cdy / mPerLat,
            lng: cLng + cdx / safeLng
        };
    }

    /* Metres covered by one CSS pixel at `lat` for the given zoom. */
    function resolutionAt(lat, zoom) {
        return 156543.03392804097 * Math.cos((Number(lat) || 0) * Math.PI / 180) /
            Math.pow(2, Number(zoom) || 0);
    }

    function resolution(map, lat) {
        return resolutionAt(lat, map.getZoom());
    }

    /**
     * Everything the painter needs for one frame, as pure maths.
     * `mpp` is metres per NATURAL image pixel; the pyramid level is chosen so
     * that one level pixel lands as close as possible to one screen pixel.
     *
     * STABILITY CONTRACT (see OTHER_MAPS.md §9): the level depends ONLY on the
     * zoom, the sheet's scale and its natural size — never on where the sheet
     * sits in the viewport or how it is rotated.  A sheet therefore looks the
     * same at a given zoom wherever you pan it, and only changes when the zoom
     * itself crosses a level boundary.
     *
     * When `view` (anchor + viewport rectangle in layer pixels) is given, the
     * planner may step UP one level — the one that DOWNSCALES the sheet onto
     * the screen (k ≤ 1, crisp) instead of upscaling it (k > 1, soft) — but
     * only while the tile budget for covering the VIEWPORT (its size, not its
     * position) stays within MAX_SHARP_TILES, so a whole-viewport crop of a
     * 40 000 px sheet at native scale never means hundreds of requests.
     */
    function planGeometry(o, view) {
        var res = resolutionAt(o.lat, o.zoom);
        var dW = o.w * o.mpp / res;
        var dH = o.h * o.mpp / res;
        var base = o.maxZoom + Math.log(o.mpp / res) / Math.LN2;
        var level = clamp(Math.round(base), 0, o.maxZoom);
        if (view) {
            var sharp = clamp(Math.ceil(base - 1e-9), 0, o.maxZoom);
            if (sharp > level) {
                var fine = geometryAt(o, res, dW, dH, sharp);
                if (viewportTileBudget(fine, view) <= MAX_SHARP_TILES) {
                    level = sharp;
                }
            }
        }
        return geometryAt(o, res, dW, dH, level);
    }

    /* Level size is kept EXACT (fractional) — o.w·2^Δ × o.h·2^Δ — rather than
     * rounded to whole pixels.  Rounding each axis separately made the painted
     * grid's height (hL·k) disagree with the framed box (dH) by up to half a
     * level pixel per axis, which moved with the pyramid level and so made an
     * elongated sheet change shape as you zoomed.  With exact sizes the scale
     * is one number, k = 2^(base−level), on both axes, at every zoom. */
    function geometryAt(o, res, dW, dH, level) {
        var factor = Math.pow(2, level - o.maxZoom);
        var wL = o.w * factor;
        var hL = o.h * factor;
        return {
            res: res,
            dW: dW,
            dH: dH,
            level: level,
            wL: wL,
            hL: hL,
            k: dW / wL,
            cols: Math.max(1, Math.ceil(wL / TILE)),
            rows: Math.max(1, Math.ceil(hL / TILE))
        };
    }

    /* How many tiles of `geom` could be needed to cover the viewport at any
     * pan position and any rotation: the viewport's diagonal, measured in the
     * level's own pixels, bounds the window on each axis (+2 for the edge
     * tiles).  Depends on the viewport SIZE only. */
    function viewportTileBudget(geom, view) {
        var vw = Math.max(0, view && view.size ? view.size.x : view.bottomRight.x - view.topLeft.x);
        var vh = Math.max(0, view && view.size ? view.size.y : view.bottomRight.y - view.topLeft.y);
        var diag = Math.sqrt(vw * vw + vh * vh) / geom.k;
        var nx = Math.min(geom.cols, Math.floor(diag / TILE) + 2);
        var ny = Math.min(geom.rows, Math.floor(diag / TILE) + 2);
        return nx * ny;
    }

    /**
     * Metres per natural pixel that make the sheet's longest side span
     * `FIT_FRACTION` of the smaller viewport edge at ground resolution `res`
     * — the same rule the “Încadrează / Fit” button applies. `null` when the
     * inputs cannot frame anything (missing size or empty viewport).
     */
    function fitScale(w, h, res, viewW, viewH) {
        var longest = Math.max(Number(w) || 0, Number(h) || 0);
        var target = Math.min(Number(viewW) || 0, Number(viewH) || 0) * FIT_FRACTION;
        if (!(longest > 0) || !(res > 0) || !(target > 0)) return null;
        return target * res / longest;
    }

    /**
     * Tile window of `geom` needed to cover the viewport rectangle, in the
     * element's own (level-pixel) coordinates.  This is the inverse of
     * translate(anchor) → rotate(θ) → scale(k) → translate(-size/2).
     */
    function visibleTileRange(geom, anchor, rotationDeg, topLeft, bottomRight) {
        var theta = (Number(rotationDeg) || 0) * Math.PI / 180;
        var cos = Math.cos(theta);
        var sin = Math.sin(theta);
        var corners = [
            { x: topLeft.x, y: topLeft.y },
            { x: bottomRight.x, y: topLeft.y },
            { x: bottomRight.x, y: bottomRight.y },
            { x: topLeft.x, y: bottomRight.y }
        ];
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (var i = 0; i < corners.length; i++) {
            var dx = corners[i].x - anchor.x;
            var dy = corners[i].y - anchor.y;
            var lx = (cos * dx + sin * dy) / geom.k + geom.wL / 2;
            var ly = (-sin * dx + cos * dy) / geom.k + geom.hL / 2;
            if (lx < minX) minX = lx;
            if (lx > maxX) maxX = lx;
            if (ly < minY) minY = ly;
            if (ly > maxY) maxY = ly;
        }
        return {
            x0: clamp(Math.floor(minX / TILE) - 1, 0, geom.cols - 1),
            x1: clamp(Math.floor(maxX / TILE) + 1, 0, geom.cols - 1),
            y0: clamp(Math.floor(minY / TILE) - 1, 0, geom.rows - 1),
            y1: clamp(Math.floor(maxY / TILE) + 1, 0, geom.rows - 1)
        };
    }

    function pointDistance(a, b) {
        var dx = a.x - b.x, dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function pointAngle(a, b) {
        return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    }

    /* ── manager ──────────────────────────────────────────────────────── */
    function createManager(map, options) {
        options = options || {};
        var paneName = options.pane || 'pane_other_maps_overlay';
        var pane = map.getPane(paneName) || map.createPane(paneName);
        if (options.zIndex) pane.style.zIndex = String(options.zIndex);
        pane.style.pointerEvents = 'none';

        var container = map.getContainer();
        var overlays = Object.create(null);
        var order = [];
        var activeId = null;
        var alignMode = false;
        var visible = true;
        var listeners = [];

        var state = {
            align: false,
            activeId: null
        };

        /* The settled zoom the overlays were last painted at (render runs
         * only on settled views — see renderAll), so the zoom-animation
         * transform can express every scale relative to it. */
        var lastZoom = null;
        var lastOrigin = null;

        /* ── overlay construction ─────────────────────────────────────── */
        function build(record) {
            var root_ = document.createElement('div');
            /* leaflet-zoom-animated: the 250 ms transform transition (and 0 0
             * origin) from css/leaflet.css, so applyZoomTransform's scale
             * glides with the tiles during a zoom animation, like the dots
             * canvas in js/other-maps.js. */
            root_.className = 'om-overlay leaflet-zoom-animated';
            root_.style.position = 'absolute';
            root_.style.left = '0';
            root_.style.top = '0';
            root_.style.width = '0';
            root_.style.height = '0';
            root_.style.transformOrigin = '0 0';
            root_.style.willChange = 'transform';
            root_.style.pointerEvents = 'none';

            var rotEl = document.createElement('div');
            rotEl.className = 'om-rot';
            rotEl.style.position = 'absolute';
            rotEl.style.left = '0';
            rotEl.style.top = '0';
            rotEl.style.transformOrigin = '0 0';
            root_.appendChild(rotEl);

            var gridEl = document.createElement('div');
            gridEl.className = 'om-grid';
            gridEl.style.position = 'absolute';
            gridEl.style.left = '0';
            gridEl.style.top = '0';
            gridEl.style.transformOrigin = '0 0';
            rotEl.appendChild(gridEl);

            var frameEl = document.createElement('div');
            frameEl.className = 'om-frame';
            frameEl.style.position = 'absolute';
            frameEl.style.left = '0';
            frameEl.style.top = '0';
            frameEl.style.transformOrigin = '0 0';
            frameEl.style.pointerEvents = 'none';
            frameEl.style.display = 'none';
            root_.appendChild(frameEl);

            var boxEl = document.createElement('div');
            boxEl.className = 'om-box';
            boxEl.style.position = 'absolute';
            frameEl.appendChild(boxEl);

            var handles = {};
            ['nw', 'ne', 'se', 'sw'].forEach(function (corner) {
                var handle = document.createElement('div');
                handle.className = 'om-handle om-handle-' + corner;
                handle.setAttribute('data-om-handle', corner);
                handle.style.pointerEvents = 'auto';
                boxEl.appendChild(handle);
                handles[corner] = handle;
            });
            var rotHandle = document.createElement('div');
            rotHandle.className = 'om-handle om-handle-rot';
            rotHandle.setAttribute('data-om-handle', 'rot');
            rotHandle.style.pointerEvents = 'auto';
            boxEl.appendChild(rotHandle);
            handles.rot = rotHandle;

            var line = document.createElement('div');
            line.className = 'om-rot-line';
            boxEl.appendChild(line);

            /* The georeference square is a geographic region, so it lives OUTSIDE
             * the sheet's transform (the root is translated/rotated/scaled by
             * the sheet).  It is painted in layer space around the place and,
             * like the sheet root, is a 0×0 anchor that carries
             * leaflet-zoom-animated so it glides with the tiles during a zoom
             * animation; the visible square is an inner box centred on that
             * anchor (translate(-50%,-50%)), exactly how the sheet's grid is
             * centred on the sheet root.  Appended to the pane before the
             * sheet root, so the sheet paints on top of it. */
            var georefEl = document.createElement('div');
            georefEl.className = 'om-georef leaflet-zoom-animated';
            georefEl.style.position = 'absolute';
            georefEl.style.left = '0';
            georefEl.style.top = '0';
            georefEl.style.width = '0';
            georefEl.style.height = '0';
            georefEl.style.transformOrigin = '0 0';
            georefEl.style.pointerEvents = 'none';
            georefEl.style.display = 'none';
            var georefInner = document.createElement('div');
            georefInner.className = 'om-georef-inner';
            georefInner.style.position = 'absolute';
            georefInner.style.left = '0';
            georefInner.style.top = '0';
            georefInner.style.transform = 'translate(-50%, -50%)';
            georefInner.style.pointerEvents = 'none';
            georefEl.appendChild(georefInner);
            pane.appendChild(georefEl);

            var ov = {
                id: record.id,
                record: record,
                root: root_,
                rotEl: rotEl,
                gridEl: gridEl,
                frameEl: frameEl,
                boxEl: boxEl,
                handles: handles,
                lineEl: line,
                georefEl: georefEl,
                georefInner: georefInner,
                tiles: Object.create(null),
                stale: null,           // previous-level stand-in while a finer level loads
                meta: null,
                geom: null,
                anchor: null,          // anchor LatLng in layer pixels (last paint)
                projectAnchor: null,   // anchor in project space (last paint)
                georefAnchor: null,    // georeference square centre in layer pixels
                georefProject: null,   // …in project space
                token: 0,
                center: { lat: Number(record.lat), lng: Number(record.lng) },
                state: {
                    lat: Number(record.lat),
                    lng: Number(record.lng),
                    mpp: null,          // set once the pyramid size is known
                    rotation: 0,
                    opacity: options.opacity == null ? 0.8 : Number(options.opacity),
                    boundsKm: DEFAULT_GEOREF_KM   // georeference square side
                }
            };
            return ov;
        }

        /* ── geometry ─────────────────────────────────────────────────── */
        /* The viewport in layer pixels, so the planner can bound the tile
         * window it asks for (the sharp-level preference). */
        function viewportRect() {
            var size = map.getSize();
            var c0 = map.containerPointToLayerPoint(L.point(0, 0));
            var c1 = map.containerPointToLayerPoint(L.point(size.x, 0));
            var c2 = map.containerPointToLayerPoint(size);
            var c3 = map.containerPointToLayerPoint(L.point(0, size.y));
            return {
                topLeft: L.point(
                    Math.min(c0.x, c1.x, c2.x, c3.x),
                    Math.min(c0.y, c1.y, c2.y, c3.y)
                ),
                bottomRight: L.point(
                    Math.max(c0.x, c1.x, c2.x, c3.x),
                    Math.max(c0.y, c1.y, c2.y, c3.y)
                ),
                /* Unrotated screen span so basemap bearing never flips the
                 * chosen pyramid level while `topLeft/bottomRight` still covers
                 * all four rotated viewport corners for tile fetching. */
                size: size
            };
        }

        function geometryFor(ov, anchor, view) {
            return planGeometry({
                lat: ov.state.lat,
                zoom: map.getZoom(),
                w: ov.meta.w,
                h: ov.meta.h,
                mpp: ov.state.mpp,
                maxZoom: ov.meta.maxZoom
            }, {
                anchor: anchor,
                rotation: ov.state.rotation,
                topLeft: view.topLeft,
                bottomRight: view.bottomRight,
                size: view.size
            });
        }

        function anchorPoint(ov) {
            return map.latLngToLayerPoint(L.latLng(ov.state.lat, ov.state.lng));
        }

        /* ── tiles ────────────────────────────────────────────────────── */
        function syncTiles(ov, view) {
            var g = ov.geom;
            if (!g) return;
            var range = visibleTileRange(g, ov.anchor, ov.state.rotation, view.topLeft, view.bottomRight);
            var x0 = range.x0, x1 = range.x1, y0 = range.y0, y1 = range.y1;

            var wanted = Object.create(null);
            var token = ov.token;
            for (var x = x0; x <= x1; x++) {
                for (var y = y0; y <= y1; y++) {
                    var key = g.level + ':' + x + ':' + y;
                    wanted[key] = true;
                    if (ov.tiles[key]) continue;
                    addTile(ov, key, x, y, g.level, token);
                }
            }
            Object.keys(ov.tiles).forEach(function (key) {
                if (wanted[key]) return;
                var img = ov.tiles[key];
                delete ov.tiles[key];
                if (img && img.parentNode) img.parentNode.removeChild(img);
            });
        }

        /* Paint one tile at the level-pixel box it really covers.
         *
         * Region-scaled sources (NLS IIIF, Josephine Commons canvases) extract
         * an explicit natural-pixel region per tile and report its exact
         * fractional span via `Tiles.tileSpan`.  Pre-cut pyramids (Hungaricana
         * ECW) reconcile every decoded bitmap's `naturalWidth × naturalHeight`
         * against `Tiles.tileSpanFor` via `Tiles.measuredTileSpan`: cropped
         * edge bitmaps are painted at their exact clamped span (never blown up
         * to a 512 px square cell), while padded 512 px cells stay at 512 px
         * so `.om-grid { overflow: hidden }` trims only the margin.  Stand-in
         * tiles carry `staleScale = 2^(currentLevel − tileLevel)` so even a
         * late span/load update keeps them locked to the sheet border. */
        function sizeTile(img, w, h) {
            if (!img || !img._om) return;
            var spanW = w > 0 ? w : TILE;
            var spanH = h > 0 ? h : TILE;
            var scale = img._om.staleScale || 1;
            img._om.w = spanW;
            img._om.h = spanH;
            img.style.left = (img._om.x * TILE * scale) + 'px';
            img.style.top = (img._om.y * TILE * scale) + 'px';
            img.style.width = (spanW * scale + TILE_BLEED) + 'px';
            img.style.height = (spanH * scale + TILE_BLEED) + 'px';
        }

        function isPreTiledSource(ov) {
            if (!Tiles || typeof Tiles.isRegionScaled !== 'function') return false;
            return !Tiles.isRegionScaled(ov.record);
        }

        function isEdgeCell(meta, x, y, level) {
            if (!meta || !Tiles || typeof Tiles.tileSpanFor !== 'function') return false;
            var exp = Tiles.tileSpanFor(meta, x, y, level);
            return exp.w < TILE || exp.h < TILE;
        }

        /* Measure a decoded pre-cut tile bitmap and lock its painted CSS size
         * to the exact level-pixel box it covers before it is shown. */
        function reconcileTileBitmap(ov, img) {
            if (!ov || !ov.meta || !img || !img._om) return;
            if (!isPreTiledSource(ov) || typeof Tiles.measuredTileSpan !== 'function') return;
            var nw = Number(img.naturalWidth) || 0;
            var nh = Number(img.naturalHeight) || 0;
            if (!(nw > 0 && nh > 0)) return;
            var measured = Tiles.measuredTileSpan(
                ov.meta, img._om.x, img._om.y, img._om.level, nw, nh
            );
            if (measured.edgeMode) {
                ov.meta.edgeMode = measured.edgeMode;
                if (typeof Tiles.noteEdgeMode === 'function') {
                    Tiles.noteEdgeMode(ov.record, measured.edgeMode);
                }
            }
            sizeTile(img, measured.w, measured.h);
        }

        /* If `add()` had to frame the sheet with a guessed fallback size
         * (transient info.json / imagesize outage) and a subsequent tile call
         * succeeded in resolving the true pyramid metadata, upgrade `ov.meta`
         * immediately so the grid box and tile spans agree 1:1. */
        function adoptResolvedMeta(ov) {
            if (!ov || !ov.metaFallback || !Tiles || typeof Tiles.peekMeta !== 'function') {
                return false;
            }
            var real = Tiles.peekMeta(ov.record);
            if (!real || !(real.w > 0 && real.h > 0)) return false;
            var prevW = ov.meta && ov.meta.w > 0 ? ov.meta.w : real.w;
            ov.meta = real;
            ov.metaFallback = false;
            if (ov.userTransformed && ov.state.mpp > 0) {
                ov.state.mpp = clamp(ov.state.mpp * (prevW / real.w), MPP_MIN, MPP_MAX);
            } else {
                var fit = fitMppFor(ov);
                if (fit != null) ov.state.mpp = fit;
            }
            ov.geom = null;
            clearTiles(ov);
            render(ov);
            emitChange(ov);
            return true;
        }

        function addTile(ov, key, x, y, level, token) {
            var img = document.createElement('img');
            img.className = 'om-tile';
            img.style.position = 'absolute';
            img.style.left = (x * TILE) + 'px';
            img.style.top = (y * TILE) + 'px';
            img.style.width = (TILE + TILE_BLEED) + 'px';
            img.style.height = (TILE + TILE_BLEED) + 'px';
            img.draggable = false;
            img.alt = '';
            /* Hold an edge tile of a pre-cut pyramid invisible while its first
             * bitmap downloads so it never flashes stretched for a frame before
             * `reconcileTileBitmap` reads `naturalWidth × naturalHeight`. */
            var knownMode = ov.meta && ov.meta.edgeMode
                ? ov.meta.edgeMode
                : (Tiles && typeof Tiles.edgeModeOf === 'function' ? Tiles.edgeModeOf(ov.record) : null);
            if (knownMode && ov.meta && !ov.meta.edgeMode) ov.meta.edgeMode = knownMode;
            if (isPreTiledSource(ov) && !knownMode && isEdgeCell(ov.meta, x, y, level)) {
                img.style.visibility = 'hidden';
            }
            /* Where this tile lives in the pyramid, and how much of the level
             * it covers — stand-in promotion scales position and span by
             * `staleScale = 2^(currentLevel − level)`. */
            img._om = { x: x, y: y, level: level, w: TILE, h: TILE, loaded: false, staleScale: 1 };
            ov.tiles[key] = img;
            ov.gridEl.appendChild(img);
            /* Reconcile decoded bitmap size first, then reveal and retire any
             * outgoing stand-in once every wanted tile has settled. */
            img.addEventListener('load', function () {
                img._om.loaded = true;
                reconcileTileBitmap(ov, img);
                img.style.visibility = '';
                markStaleSettled(ov, key);
            });
            if (!Tiles || typeof Tiles.tileUrl !== 'function') {
                img.addEventListener('error', function () {
                    img.style.visibility = '';
                    markStaleSettled(ov, key);
                });
                return;
            }
            function stale() { return ov.token !== token || !img.parentNode; }
            var primaryUrl = '';
            var retried = false;
            function settleFailed() {
                img.style.visibility = '';
                markStaleSettled(ov, key);
            }
            function fallback() {
                /* Retry once only when it is geometrically safe:
                 *  - Hungaricana hash-order disambiguation ONLY at (0, 0, 1),
                 *    where `zxy` and `xyz` cannot collide with another level;
                 *  - Region-scaled sources with a canonical alternate URL
                 *    (NLS IIIF width-only `{tw},` fallback). */
                if (retried || stale() || typeof Tiles.tileUrlAlt !== 'function') {
                    settleFailed();
                    return;
                }
                var flipOrder = typeof Tiles.canFlipOrder === 'function' &&
                    Tiles.canFlipOrder(ov.record, x, y, level);
                var altCapable = flipOrder || !isPreTiledSource(ov);
                if (!altCapable) {
                    settleFailed();
                    return;
                }
                retried = true;
                Tiles.tileUrlAlt(ov.record, x, y, level).then(function (altUrl) {
                    if (stale() || !altUrl || altUrl === primaryUrl) {
                        settleFailed();
                        return;
                    }
                    if (flipOrder) {
                        img.addEventListener('load', function () {
                            Tiles.noteOrder(Tiles.alternateOrder());
                        }, { once: true });
                    }
                    img.addEventListener('error', settleFailed, { once: true });
                    img.src = altUrl;
                }).catch(settleFailed);
            }
            function spanPromise() {
                if (typeof Tiles.tileSpan !== 'function') return Promise.resolve(null);
                try {
                    return Promise.resolve(Tiles.tileSpan(ov.record, x, y, level))
                        .catch(function () { return null; });
                } catch (e) {
                    return Promise.resolve(null);
                }
            }
            Promise.all([Tiles.tileUrl(ov.record, x, y, level), spanPromise()]).then(function (res) {
                if (ov.metaFallback && adoptResolvedMeta(ov)) return;
                if (stale()) return;
                var span = res[1];
                if (span && span.w > 0 && span.h > 0) sizeTile(img, span.w, span.h);
                primaryUrl = res[0] || '';
                if (!primaryUrl) {
                    settleFailed();
                    return;
                }
                img.addEventListener('error', fallback, { once: true });
                img.src = primaryUrl;
            }).catch(fallback);
        }

        /* ── the previous level, as a stand-in across level transitions ──
         * Rescales retained tiles by `2^(targetLevel − tileLevel)` — using
         * each tile's own level and exact span — so the image stays pinned
         * inside `.om-box` while the new level's remote tiles download, across
         * single-step zooms, rapid wheel/handle scales and zoom-outs alike. */
        function applyStaleScale(img, targetLevel) {
            if (!img || !img._om) return;
            var d = Math.pow(2, targetLevel - img._om.level);
            img._om.staleScale = d;
            img.className = 'om-tile om-tile-stale';
            img.style.left = (img._om.x * TILE * d) + 'px';
            img.style.top = (img._om.y * TILE * d) + 'px';
            img.style.width = (((img._om.w || TILE) * d) + TILE_BLEED) + 'px';
            img.style.height = (((img._om.h || TILE) * d) + TILE_BLEED) + 'px';
        }

        function promoteStale(ov, oldLevel) {
            var targetLevel = ov.geom.level;
            var goingFiner = targetLevel > oldLevel;
            var current = ov.tiles;
            ov.tiles = Object.create(null);

            var currentKeys = Object.keys(current);
            var loadedCurrent = currentKeys.filter(function (k) {
                return current[k] && current[k]._om && current[k]._om.loaded;
            });
            var prevStale = ov.stale;
            var loadedPrev = prevStale ? Object.keys(prevStale.imgs).filter(function (k) {
                return prevStale.imgs[k] && prevStale.imgs[k]._om && prevStale.imgs[k]._om.loaded;
            }) : [];

            var kept = Object.create(null);
            if (!goingFiner) {
                /* Going coarser: keep only already-decoded bitmaps scaled down
                 * by 2^Δ while the coarser tile loads; drop unloaded tags so
                 * a cold grid starts clean with no lingering stand-in. */
                loadedCurrent.forEach(function (k) {
                    kept[k] = current[k];
                    delete current[k];
                });
                if (!loadedCurrent.length && loadedPrev.length) {
                    loadedPrev.forEach(function (k) {
                        kept[k] = prevStale.imgs[k];
                        delete prevStale.imgs[k];
                    });
                }
                Object.keys(current).forEach(function (k) {
                    var el = current[k];
                    if (el && el.parentNode) el.parentNode.removeChild(el);
                });
                dropStale(ov);
                if (!Object.keys(kept).length) {
                    ov.token++;
                    return;
                }
            } else if (!loadedCurrent.length && loadedPrev.length) {
                /* Rapid multi-level zoom/scale in: keep the decoded stand-in
                 * from the earlier level and discard empty intermediate tags. */
                loadedPrev.forEach(function (k) {
                    kept[k] = prevStale.imgs[k];
                    delete prevStale.imgs[k];
                });
                currentKeys.forEach(function (k) {
                    var el = current[k];
                    if (el && el.parentNode) el.parentNode.removeChild(el);
                });
                dropStale(ov);
            } else {
                dropStale(ov);
                currentKeys.forEach(function (k) {
                    var el = current[k];
                    if (!el || !el._om) return;
                    if (loadedCurrent.length && !el._om.loaded) {
                        if (el.parentNode) el.parentNode.removeChild(el);
                        return;
                    }
                    kept[k] = el;
                });
            }

            var keptKeys = Object.keys(kept);
            if (!keptKeys.length) return;
            keptKeys.forEach(function (k) { applyStaleScale(kept[k], targetLevel); });
            var stale = { level: oldLevel, imgs: kept, settled: {} };
            stale.timer = root.setTimeout(function () { dropStale(ov); }, STALE_FALLBACK_MS);
            ov.stale = stale;
        }

        function dropStale(ov) {
            if (!ov.stale) return;
            if (ov.stale.timer) root.clearTimeout(ov.stale.timer);
            Object.keys(ov.stale.imgs).forEach(function (key) {
                var img = ov.stale.imgs[key];
                if (img && img.parentNode) img.parentNode.removeChild(img);
            });
            ov.stale = null;
        }

        function markStaleSettled(ov, key) {
            if (!ov.stale || !ov.tiles[key]) return;
            ov.stale.settled[key] = true;
            var pending = Object.keys(ov.tiles).some(function (k) { return !ov.stale.settled[k]; });
            if (!pending) dropStale(ov);
        }

        function clearTiles(ov) {
            dropStale(ov);
            Object.keys(ov.tiles).forEach(function (key) {
                var img = ov.tiles[key];
                if (img && img.parentNode) img.parentNode.removeChild(img);
            });
            ov.tiles = Object.create(null);
            ov.token++;
        }

        /* ── painting ─────────────────────────────────────────────────── */
        /* Paint the georeference square in layer space: its centre is the
         * place the sheet belongs to, its side is `boundsKm` km on the ground
         * (metres / resolution).  The element's local origin is its centre
         * (negative half-size margins), the same contract the sheet root uses,
         * so applyZoomTransform can scale it around the centre. */
        function renderGeoref(ov) {
            var el = ov && ov.georefEl;
            var inner = ov && ov.georefInner;
            if (!el || !inner) return;
            var halfM = Math.max(0, Number(ov.state.boundsKm) || 0) * 1000 / 2;
            var home = map.latLngToLayerPoint(L.latLng(ov.center.lat, ov.center.lng));
            var halfPx = halfM / resolution(map, ov.center.lat);
            inner.style.width = (halfPx * 2) + 'px';
            inner.style.height = (halfPx * 2) + 'px';
            ov.georefAnchor = home;
            if (typeof map.project === 'function') {
                ov.georefProject = map.project(L.latLng(ov.center.lat, ov.center.lng), map.getZoom());
            }
            el.style.transform = 'translate3d(' + home.x + 'px,' + home.y + 'px,0)';
        }

        function render(ov) {
            if (!ov || !ov.meta || !ov.root.parentNode) return;
            var view = viewportRect();
            var a = anchorPoint(ov);
            var g = geometryFor(ov, a, view);
            var levelChanged = !ov.geom || ov.geom.level !== g.level;
            var oldLevel = ov.geom ? ov.geom.level : null;
            ov.geom = g;
            ov.anchor = a;
            /* Project-space position of the anchor as just painted (render
             * only runs on settled views).  applyZoomTransform scales around
             * it, the same contract the dots canvas uses — it also absorbs
             * the half-pixel rounding latLngToLayerPoint bakes into `a`. */
            if (typeof map.project === 'function') {
                ov.projectAnchor = map.project(L.latLng(ov.state.lat, ov.state.lng), map.getZoom());
            }
            lastZoom = map.getZoom();
            if (typeof map.getPixelOrigin === 'function') lastOrigin = map.getPixelOrigin();

            renderGeoref(ov);

            ov.root.style.transform = 'translate3d(' + a.x + 'px,' + a.y + 'px,0)';
            ov.root.style.opacity = String(ov.state.opacity);
            ov.rotEl.style.transform = 'rotate(' + ov.state.rotation + 'deg)';
            ov.gridEl.style.width = g.wL + 'px';
            ov.gridEl.style.height = g.hL + 'px';
            ov.gridEl.style.transform = 'scale(' + g.k + ') translate(' +
                (-g.wL / 2) + 'px,' + (-g.hL / 2) + 'px)';

            if (levelChanged) {
                if (oldLevel != null) {
                    /* Finer: promote the outgoing level scaled up by 2^Δ.
                     * Coarser: retain only already-decoded tiles scaled down
                     * by 2^Δ (cold grids drop cleanly with no stand-in). */
                    promoteStale(ov, oldLevel);
                } else {
                    clearTiles(ov);
                }
            }

            if (ov.frameEl.style.display !== 'none') {
                ov.frameEl.style.transform = 'rotate(' + ov.state.rotation + 'deg)';
                ov.boxEl.style.width = g.dW + 'px';
                ov.boxEl.style.height = g.dH + 'px';
                ov.boxEl.style.left = (-g.dW / 2) + 'px';
                ov.boxEl.style.top = (-g.dH / 2) + 'px';
            }
            syncTiles(ov, view);
        }

        /* Keep the sheets locked to the tiles during a zoom animation, the
         * same way the dots canvas does (js/other-maps.js): the map pane is
         * stationary while the tile containers CSS-scale for 250 ms, so each
         * sheet root gets the matching transform
         *     translate(scale·bitmapAnchor − newPixelOrigin) · scale
         * — Web Mercator project space is linear in zoom, and bitmapAnchor is
         * the integer centre the content was last drawn against, so every
         * point of the sheet lands at its exact target-zoom position.  The
         * 250 ms glide comes from `.leaflet-zoom-anim .leaflet-zoom-animated`
         * (css/leaflet.css).  A settled render() resets the root transform,
         * so it never lingers. */
        function applyZoomTransform(center, zoom) {
            if (lastZoom == null || lastOrigin == null || typeof map._getNewPixelOrigin !== 'function') return;
            var scale = map.getZoomScale(zoom, lastZoom);
            var newOrigin = map._getNewPixelOrigin(center, zoom);
            order.forEach(function (id) {
                var ov = overlays[id];
                if (!ov || !ov.anchor) return;
                /* The bitmap anchor is the integer centre the content was last
                 * drawn against (the layer anchor plus the pixel origin of
                 * that settled view).  Scaling that rather than the unrounded
                 * project() centre is what keeps the animated end exactly on
                 * the settled position, so the sheet does not drift a pixel
                 * and snap back at the end of the CSS transition. */
                var bitmapAnchor = lastOrigin.add(ov.anchor);
                var offset = bitmapAnchor.multiplyBy(scale).subtract(newOrigin)._round();
                ov.root.style.transform = 'translate3d(' + offset.x + 'px,' + offset.y + 'px,0) ' +
                    'scale(' + scale + ')';
                /* The georeference square is geographic too: scale it around
                 * its own centre (the place) with the same transform. */
                if (ov.georefEl && ov.georefAnchor) {
                    var georefBitmap = lastOrigin.add(ov.georefAnchor);
                    var gOffset = georefBitmap.multiplyBy(scale).subtract(newOrigin)._round();
                    ov.georefEl.style.transform = 'translate3d(' + gOffset.x + 'px,' + gOffset.y + 'px,0) ' +
                        'scale(' + scale + ')';
                }
            });
        }

        function renderAll() {
            if (map._animatingZoom) return;
            /* A pinch is rescaled from the last settled frame by
             * applyZoomTransform on every 'zoom' event; redrawing mid-pinch
             * would fight that transform (same guard as the dots canvas). */
            if (map.touchZoom && map.touchZoom._zooming) return;
            order.forEach(function (id) { render(overlays[id]); });
        }

        /* ── lifecycle ────────────────────────────────────────────────── */
        function add(record, savedState) {
            if (!record || !record.path) return Promise.resolve(null);
            var existing = overlays[record.id];
            if (existing) {
                if (savedState) applyState(existing, savedState);
                setActive(record.id);
                return Promise.resolve(existing);
            }
            var ov = build(record);
            overlays[record.id] = ov;
            order.push(record.id);
            pane.appendChild(ov.root);
            if (savedState) applyState(ov, savedState);

            var hint = { w: record.w, h: record.h };
            return Tiles.resolve(record, hint).then(function (meta) {
                ov.meta = meta;
                ov.metaFallback = false;
                if (ov.state.mpp == null || !isFinite(ov.state.mpp)) {
                    // Fresh sheet: frame it into the viewport (longest side ≈
                    // FIT_FRACTION of the smaller edge) so it loads in its
                    // natural format and at the best quality the current view
                    // allows — instead of at an arbitrary ~4 km ground size
                    // that, at county zooms, renders as a small blur.
                    var fit = fitMppFor(ov);
                    ov.state.mpp = fit != null
                        ? fit
                        : clamp(DEFAULT_GROUND_WIDTH_M / Math.max(meta.w, meta.h, 1), MPP_MIN, MPP_MAX);
                }
                render(ov);
                emitChange(ov);
                setActive(record.id);
                return ov;
            }).catch(function (err) {
                console.warn('[OtherMaps] cannot read pyramid for', record.id, err);
                ov.meta = { w: 4000, h: 3000, maxZoom: 4 };
                ov.metaFallback = true;
                if (ov.state.mpp == null || !isFinite(ov.state.mpp)) {
                    // Even an unresolvable sheet is framed with its guessed
                    // size rather than dropped at an arbitrary ground scale.
                    var fit = fitMppFor(ov);
                    ov.state.mpp = fit != null ? fit : 1;
                }
                render(ov);
                emitChange(ov);
                setActive(record.id);
                return ov;
            });
        }

        function remove(id) {
            var ov = overlays[id];
            if (!ov) return;
            clearTiles(ov);
            if (ov.root.parentNode) ov.root.parentNode.removeChild(ov.root);
            if (ov.georefEl && ov.georefEl.parentNode) ov.georefEl.parentNode.removeChild(ov.georefEl);
            delete overlays[id];
            order = order.filter(function (item) { return item !== id; });
            if (activeId === id) {
                activeId = order.length ? order[order.length - 1] : null;
                if (!activeId) setAlignMode(false);
            }
            paintFrames();
            emitChange(null);
        }

        function clear() {
            order.slice().forEach(remove);
        }

        function applyState(ov, patch) {
            if (!ov || !patch) return;
            if (patch.boundsKm != null && isFinite(patch.boundsKm)) {
                ov.state.boundsKm = clamp(Number(patch.boundsKm), GEOREF_MIN_KM, GEOREF_MAX_KM);
            }
            /* The anchor never leaves the georeference square — enforced on
             * every path that writes lat/lng (a drag, a restore, a bounds
             * change), so the sheet is always georeferenceable inside it. */
            if (isFinite(patch.lat) || isFinite(patch.lng)) {
                var c = clampToSquare(
                    isFinite(patch.lat) ? Number(patch.lat) : ov.state.lat,
                    isFinite(patch.lng) ? Number(patch.lng) : ov.state.lng,
                    ov.center.lat, ov.center.lng, ov.state.boundsKm);
                ov.state.lat = c.lat;
                ov.state.lng = c.lng;
            }
            if (isFinite(patch.mpp)) {
                ov.state.mpp = clamp(Number(patch.mpp), MPP_MIN, MPP_MAX);
                ov.userTransformed = true;
            }
            if (isFinite(patch.rotation)) ov.state.rotation = normalizeDegrees(Number(patch.rotation));
            if (isFinite(patch.opacity)) ov.state.opacity = clamp(Number(patch.opacity), 0, 1);
        }

        function setState(id, patch, options) {
            var ov = overlays[id];
            if (!ov) return null;
            applyState(ov, patch);
            render(ov);
            if (!options || options.silent !== true) emitChange(ov);
            return ov.state;
        }

        function setOpacity(id, value) {
            return setState(id, { opacity: value });
        }

        /* The layer slider is a single master opacity: it must reach every
         * added sheet, not only the active one.  Without this a sheet restored
         * from the previous session kept its saved opacity and stayed visible
         * when the user dragged the layer to 0%. */
        function setOpacityAll(value) {
            var v = clamp(Number(value), 0, 1);
            if (!isFinite(v)) return null;
            order.forEach(function (id) {
                var ov = overlays[id];
                if (!ov) return;
                ov.state.opacity = v;
                // Opacity is painted once on the root: tiles, frame, handles
                // and georeference square all fade together.  No geometry or
                // tile work is needed for a slider move.
                if (ov.root) ov.root.style.opacity = String(v);
            });
            emitChange(activeId ? overlays[activeId] : null);
            return v;
        }

        /* Change the georeference square side for one sheet and keep the
         * anchor inside it: enlarging leaves the anchor where it is, shrinking
         * pulls it back to the nearest edge of the new square. */
        function setBoundsKm(id, km) {
            var ov = overlays[id];
            if (!ov) return null;
            var value = clamp(Number(km) || DEFAULT_GEOREF_KM, GEOREF_MIN_KM, GEOREF_MAX_KM);
            ov.state.boundsKm = value;
            var c = clampToSquare(ov.state.lat, ov.state.lng, ov.center.lat, ov.center.lng, value);
            ov.state.lat = c.lat;
            ov.state.lng = c.lng;
            renderGeoref(ov);
            render(ov);
            emitChange(ov);
            return value;
        }

        function getBoundsKm(id) {
            var ov = overlays[id];
            return ov ? ov.state.boundsKm : null;
        }

        function setActive(id) {
            if (activeId === id) { paintFrames(); return; }
            activeId = overlays[id] ? id : null;
            paintFrames();
            if (options.onActiveChange) options.onActiveChange(activeId);
        }

        function active() { return activeId ? overlays[activeId] : null; }

        function paintFrames() {
            order.forEach(function (id) {
                var ov = overlays[id];
                var isActive = id === activeId;
                /* The dashed border marks the active sheet so a sheet left at
                 * opacity 0 — or with the panel closed — can still be found;
                 * the interactive handles and the georeference square only
                 * exist in align mode. */
                var showBorder = isActive;
                var showHandles = isActive && alignMode;
                ov.frameEl.style.display = (showBorder || showHandles) ? '' : 'none';
                ov.boxEl.style.display = showBorder ? '' : 'none';
                Object.keys(ov.handles).forEach(function (key) {
                    ov.handles[key].style.display = showHandles ? '' : 'none';
                });
                if (ov.lineEl) ov.lineEl.style.display = showHandles ? '' : 'none';
                if (showBorder && ov.geom) {
                    ov.frameEl.style.transform = 'rotate(' + ov.state.rotation + 'deg)';
                    ov.boxEl.style.width = ov.geom.dW + 'px';
                    ov.boxEl.style.height = ov.geom.dH + 'px';
                    ov.boxEl.style.left = (-ov.geom.dW / 2) + 'px';
                    ov.boxEl.style.top = (-ov.geom.dH / 2) + 'px';
                }
                ov.root.classList.toggle('om-active', isActive);
                if (ov.georefEl) ov.georefEl.style.display = showHandles ? '' : 'none';
            });
        }

        function setAlignMode(on) {
            var wanted = !!on && !!active();
            if (wanted === alignMode) { paintFrames(); return alignMode; }
            alignMode = wanted;
            state.align = wanted;
            try {
                if (alignMode) {
                    if (map.dragging && map.dragging.enabled()) map.dragging.disable();
                    if (map.doubleClickZoom && map.doubleClickZoom.enabled()) map.doubleClickZoom.disable();
                    if (map.scrollWheelZoom && map.scrollWheelZoom.enabled()) map.scrollWheelZoom.disable();
                    if (map.touchZoom && map.touchZoom.enabled()) map.touchZoom.disable();
                    if (map.boxZoom && map.boxZoom.enabled()) map.boxZoom.disable();
                } else {
                    if (map.dragging && !map.dragging.enabled()) map.dragging.enable();
                    if (map.doubleClickZoom && !map.doubleClickZoom.enabled()) map.doubleClickZoom.enable();
                    if (map.scrollWheelZoom && !map.scrollWheelZoom.enabled()) map.scrollWheelZoom.enable();
                    if (map.touchZoom && !map.touchZoom.enabled()) map.touchZoom.enable();
                    if (map.boxZoom && !map.boxZoom.enabled()) map.boxZoom.enable();
                }
            } catch (e) { /* handler state is best-effort */ }
            container.classList.toggle('om-align-active', alignMode);
            paintFrames();
            if (options.onAlignChange) options.onAlignChange(alignMode);
            return alignMode;
        }

        function setVisible(on) {
            visible = !!on;
            pane.style.display = visible ? '' : 'none';
            if (!visible) setAlignMode(false);
            else renderAll();
        }

        function centerOn(id) {
            var ov = overlays[id];
            if (!ov) return;
            var center = map.getCenter();
            setState(id, { lat: center.lat, lng: center.lng });
        }

        /* The “Încadrează” scale for this overlay right now: the sheet's
         * longest side spans FIT_FRACTION of the smaller viewport edge. */
        function fitMppFor(ov) {
            if (!ov || !ov.meta) return null;
            var size = map.getSize();
            var mpp = fitScale(ov.meta.w, ov.meta.h, resolution(map, ov.state.lat), size.x, size.y);
            if (mpp == null) {
                // The map has no viewport yet — fall back to the old default.
                mpp = DEFAULT_GROUND_WIDTH_M / Math.max(ov.meta.w, ov.meta.h, 1);
            }
            return clamp(mpp, MPP_MIN, MPP_MAX);
        }

        function fitToView(id) {
            var ov = overlays[id];
            if (!ov || !ov.meta) return null;
            var res = setState(id, { mpp: fitMppFor(ov) });
            ov.userTransformed = false;
            return res;
        }

        function groundWidth(id) {
            var ov = overlays[id];
            if (!ov || !ov.meta) return 0;
            return ov.meta.w * ov.state.mpp;
        }

        /* Back to the day it was added: the sheet's own coordinates, no
         * rotation and framed into the viewport (the fit is the fresh state). */
        function reset(id) {
            var ov = overlays[id];
            if (!ov) return null;
            ov.state.lat = Number(ov.record.lat);
            ov.state.lng = Number(ov.record.lng);
            ov.state.rotation = 0;
            ov.userTransformed = false;
            var fit = fitMppFor(ov);
            if (fit == null) {
                var base = ov.meta ? Math.max(ov.meta.w, ov.meta.h) : 4000;
                fit = DEFAULT_GROUND_WIDTH_M / base;
            }
            ov.state.mpp = clamp(fit, MPP_MIN, MPP_MAX);
            render(ov);
            emitChange(ov);
            return ov.state;
        }

        function emitChange(ov) {
            var payload = ov ? publicState(ov) : null;
            listeners.forEach(function (fn) {
                try { fn(payload, snapshot()); } catch (e) { console.warn(e); }
            });
        }

        function publicState(ov) {
            return {
                id: ov.id,
                path: ov.record.path,
                lat: ov.state.lat,
                lng: ov.state.lng,
                mpp: ov.state.mpp,
                rotation: ov.state.rotation,
                opacity: ov.state.opacity,
                boundsKm: ov.state.boundsKm
            };
        }

        function snapshot() {
            return {
                activeId: activeId,
                align: alignMode,
                overlays: order.map(function (id) { return publicState(overlays[id]); })
            };
        }

        function onStateChange(fn) {
            if (typeof fn === 'function') listeners.push(fn);
            return function () { listeners = listeners.filter(function (item) { return item !== fn; }); };
        }

        /* ── gestures ─────────────────────────────────────────────────── */
        var pointers = Object.create(null);
        var pointerCount = 0;
        var gesture = null;

        function isUiTarget(target) {
            var node = target;
            while (node && node !== container) {
                if (node.nodeType === 1 && node.matches && node.matches(UI_SELECTOR)) return true;
                node = node.parentNode;
            }
            return node !== container;
        }

        function containerPoint(event) {
            var rect = container.getBoundingClientRect();
            return L.point(event.clientX - rect.left, event.clientY - rect.top);
        }

        function beginGesture(kind, pointerId, event) {
            var ov = active();
            if (!ov) return;
            var point = containerPoint(event);
            var center = map.latLngToContainerPoint(L.latLng(ov.state.lat, ov.state.lng));
            gesture = {
                kind: kind,
                ov: ov,
                start: {
                    lat: ov.state.lat,
                    lng: ov.state.lng,
                    mpp: ov.state.mpp,
                    rotation: ov.state.rotation
                },
                origin: point,
                center: center,
                distance: pointDistance(center, point),
                angle: pointAngle(center, point)
            };
        }

        function beginPinch() {
            var ov = active();
            if (!ov) return;
            var ids = Object.keys(pointers);
            if (ids.length < 2) return;
            var a = pointers[ids[0]];
            var b = pointers[ids[1]];
            var center = map.latLngToContainerPoint(L.latLng(ov.state.lat, ov.state.lng));
            gesture = {
                kind: 'pinch',
                ov: ov,
                start: {
                    lat: ov.state.lat,
                    lng: ov.state.lng,
                    mpp: ov.state.mpp,
                    rotation: ov.state.rotation
                },
                origin: L.point((a.x + b.x) / 2, (a.y + b.y) / 2),
                center: center,
                distance: Math.max(1, pointDistance(a, b)),
                angle: pointAngle(a, b)
            };
        }

        function applyMove(ov, delta) {
            var target = map.containerPointToLatLng(L.point(gesture.origin.x + delta.x, gesture.origin.y + delta.y));
            var c = clampToSquare(target.lat, target.lng, ov.center.lat, ov.center.lng, ov.state.boundsKm);
            ov.state.lat = c.lat;
            ov.state.lng = c.lng;
        }

        function onPointerDown(event) {
            if (!alignMode || !active()) return;
            var handleKind = event.target && event.target.getAttribute
                ? event.target.getAttribute('data-om-handle') : null;
            pointers[event.pointerId] = containerPoint(event);
            pointerCount++;
            if (handleKind) {
                beginGesture(handleKind === 'rot' ? 'rotate' : 'scale', event.pointerId, event);
                try { event.target.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (isUiTarget(event.target)) { delete pointers[event.pointerId]; pointerCount--; return; }
            if (pointerCount === 1) {
                beginGesture('move', event.pointerId, event);
                try { container.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
                event.preventDefault();
                event.stopPropagation();
            } else if (pointerCount === 2) {
                beginPinch();
            }
        }

        function onPointerMove(event) {
            if (!gesture) return;
            if (pointers[event.pointerId]) pointers[event.pointerId] = containerPoint(event);
            var ov = gesture.ov;
            if (!ov) return;

            if (gesture.kind === 'pinch' && pointerCount >= 2) {
                var ids = Object.keys(pointers);
                var a = pointers[ids[0]];
                var b = pointers[ids[1]];
                var distance = Math.max(1, pointDistance(a, b));
                var angle = pointAngle(a, b);
                var mid = L.point((a.x + b.x) / 2, (a.y + b.y) / 2);
                ov.state.mpp = clamp(gesture.start.mpp * (distance / gesture.distance), MPP_MIN, MPP_MAX);
                ov.userTransformed = true;
                ov.state.rotation = snapDegrees(normalizeDegrees(
                    gesture.start.rotation + (angle - gesture.angle)));
                applyMove(ov, L.point(mid.x - gesture.origin.x, mid.y - gesture.origin.y));
            } else if (gesture.kind === 'move') {
                var point = containerPoint(event);
                applyMove(ov, L.point(point.x - gesture.origin.x, point.y - gesture.origin.y));
            } else if (gesture.kind === 'scale') {
                var p = containerPoint(event);
                var radius = Math.max(8, pointDistance(gesture.center, p));
                ov.state.mpp = clamp(gesture.start.mpp * (radius / Math.max(8, gesture.distance)), MPP_MIN, MPP_MAX);
                ov.userTransformed = true;
            } else if (gesture.kind === 'rotate') {
                var rp = containerPoint(event);
                var angleNow = pointAngle(gesture.center, rp);
                ov.state.rotation = snapDegrees(normalizeDegrees(
                    gesture.start.rotation + (angleNow - gesture.angle)));
            } else {
                return;
            }
            render(ov);
            if (options.onTransform) options.onTransform(publicState(ov));
        }

        function onPointerUp(event) {
            delete pointers[event.pointerId];
            pointerCount = Math.max(0, pointerCount - 1);
            if (pointerCount === 0) {
                if (gesture) {
                    emitChange(gesture.ov);
                    gesture = null;
                }
            } else if (pointerCount === 1 && gesture && gesture.kind === 'pinch') {
                // One finger left: continue as a plain move without a jump.
                var ov = gesture.ov;
                var remaining = Object.keys(pointers)[0];
                gesture = {
                    kind: 'move',
                    ov: ov,
                    start: { lat: ov.state.lat, lng: ov.state.lng, mpp: ov.state.mpp, rotation: ov.state.rotation },
                    origin: pointers[remaining],
                    center: gesture.center,
                    distance: 0,
                    angle: 0
                };
            }
        }

        function onWheel(event) {
            if (!alignMode) return;
            var ov = active();
            if (!ov) return;
            event.preventDefault();
            if (event.shiftKey) {
                ov.state.rotation = snapDegrees(normalizeDegrees(ov.state.rotation + event.deltaY * 0.12));
            } else {
                var factor = Math.exp(-event.deltaY * 0.0015);
                ov.state.mpp = clamp(ov.state.mpp * factor, MPP_MIN, MPP_MAX);
                ov.userTransformed = true;
            }
            render(ov);
            emitChange(ov);
        }

        /* ── map wiring ───────────────────────────────────────────────── */
        function onMove() { renderAll(); }

        /* Zoom animations keep the sheets locked to the tiles — the same
         * contract as the dots canvas in js/other-maps.js: button /
         * double-tap / wheel arrive as zoomanim, touch pinch as 'zoom' with
         * e.pinch (Leaflet fires no move/zoom events during the 250 ms
         * animation, so without these handlers the sheets sit still and
         * snap back at zoomend).  onMove redraws and resets the transforms
         * once the view settles. */
        function onZoomAnim(e) {
            if (e && e.center != null && e.zoom != null) applyZoomTransform(e.center, e.zoom);
        }

        function onZoom(e) {
            if (e && e.pinch) applyZoomTransform(map.getCenter(), map.getZoom());
        }

        function onResize() { renderAll(); }

        map.on('move', onMove);
        map.on('moveend', onMove);
        map.on('zoomend', onMove);
        map.on('viewreset', onMove);
        map.on('resize', onResize);
        map.on('zoomanim', onZoomAnim);
        map.on('zoom', onZoom);

        container.addEventListener('pointerdown', onPointerDown, true);
        /* A sheet drag captures the pointer on the map container, so the
         * resulting pointermove/up events target that container, not this
         * overlay root (which is a sibling inside a Leaflet pane). Listen on
         * the capture target and let handle events bubble up to it as well. */
        container.addEventListener('pointermove', onPointerMove, { passive: true });
        container.addEventListener('pointerup', onPointerUp);
        container.addEventListener('pointercancel', onPointerUp);
        container.addEventListener('wheel', onWheel, { passive: false });

        function destroy() {
            setAlignMode(false);
            map.off('move', onMove);
            map.off('moveend', onMove);
            map.off('zoomend', onMove);
            map.off('viewreset', onMove);
            map.off('resize', onResize);
            map.off('zoomanim', onZoomAnim);
            map.off('zoom', onZoom);
            container.removeEventListener('pointerdown', onPointerDown, true);
            container.removeEventListener('pointermove', onPointerMove);
            container.removeEventListener('pointerup', onPointerUp);
            container.removeEventListener('pointercancel', onPointerUp);
            container.removeEventListener('wheel', onWheel);
            clear();
        }

        return {
            pane: pane,
            add: add,
            remove: remove,
            clear: clear,
            get: function (id) { return overlays[id] || null; },
            has: function (id) { return !!overlays[id]; },
            list: function () { return order.map(function (id) { return overlays[id]; }); },
            state: function (id) { return overlays[id] ? publicState(overlays[id]) : null; },
            setActive: setActive,
            getActiveId: function () { return activeId; },
            setAlignMode: setAlignMode,
            isAlignMode: function () { return alignMode; },
            setOpacity: setOpacity,
            setOpacityAll: setOpacityAll,
            setState: setState,
            setBoundsKm: setBoundsKm,
            getBoundsKm: getBoundsKm,
            setVisible: setVisible,
            centerOn: centerOn,
            fitToView: fitToView,
            reset: reset,
            groundWidth: groundWidth,
            groundHeight: function (id) {
                var ov = overlays[id];
                return ov && ov.meta ? ov.meta.h * ov.state.mpp : 0;
            },
            onStateChange: onStateChange,
            snapshot: snapshot,
            renderAll: renderAll,
            destroy: destroy,
            limits: {
                mppMin: MPP_MIN,
                mppMax: MPP_MAX,
                georefMinKm: GEOREF_MIN_KM,
                georefMaxKm: GEOREF_MAX_KM,
                georefDefaultKm: DEFAULT_GEOREF_KM
            }
        };
    }

    root.DetectLabOtherMapsOverlay = {
        createManager: createManager,
        resolution: resolution,
        resolutionAt: resolutionAt,
        planGeometry: planGeometry,
        visibleTileRange: visibleTileRange,
        fitScale: fitScale,
        normalizeDegrees: normalizeDegrees,
        snapDegrees: snapDegrees,
        clampToSquare: clampToSquare,
        tileSize: TILE,
        fitFraction: FIT_FRACTION,
        maxSharpTiles: MAX_SHARP_TILES,
        georefDefaultKm: DEFAULT_GEOREF_KM,
        georefMinKm: GEOREF_MIN_KM,
        georefMaxKm: GEOREF_MAX_KM,
        limits: {
            mppMin: MPP_MIN,
            mppMax: MPP_MAX,
            georefMinKm: GEOREF_MIN_KM,
            georefMaxKm: GEOREF_MAX_KM,
            georefDefaultKm: DEFAULT_GEOREF_KM
        }
    };
}(typeof window !== 'undefined' ? window : this));
