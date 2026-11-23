/* =====================================================================
 * other-maps-tiles.js — tile dispatcher for “Other maps”
 * ---------------------------------------------------------------------
 * This file owns the Hungaricana ECW pyramid reader and, since the NLS
 * source was added, also the per-source dispatch table (registerSource):
 * a record carrying a known `source` is routed to its own adapter
 * (js/other-maps-nls.js for the National Library of Scotland IIIF service),
 * while a plain path string or a sourceless record stays on the legacy
 * Hungaricana path below.  Every Hungaricana function keeps its original
 * signature and behaviour byte-for-byte.
 *
 * The non-georeferenced sheets on maps.hungaricana.hu are served as an ECW
 * tile pyramid from static-cdn.hungaricana.hu.  A tile is addressed by a
 * 32-character hash rather than by /z/x/y:
 *
 *     https://static-cdn.hungaricana.hu/tile/image/<path>/<hash>
 *
 * where <path> is the ECW path of the sheet (e.g.
 * maps/mol/s011/s11_0647/s11_0647.ecw) and
 *
 *     hash = AES-128-CBC(key "dGhpcyBpcyBubyBr", iv 0) of
 *            `${sumAscii(path) % 100}|${z}|${x}|${y}` padded with '*' to
 *            16 bytes, first 16 ciphertext bytes, hex.
 *
 * (The scheme was reverse-engineered by dezoomify — lovasoa/dezoomify,
 * issue #346 — and is re-implemented here with the WebCrypto API so the
 * app can paint these sheets itself, at any rotation, without a plugin.)
 *
 * The pyramid's natural size is published by a sibling endpoint
 * (`/tile/imagesize/<path>` → {width, height}).  That endpoint is not
 * guaranteed to be readable from a browser (CORS), so the module also has a
 * probe fallback: it asks for tile (0,0,z) with growing z to find the
 * deepest level, then walks the top row / left column to count tiles.  Both
 * results are cached in localStorage so a sheet is probed once, not on
 * every visit.
 *
 * Public API: window.DetectLabOtherMapsTiles —
 *   thumbUrl(path)              → small preview (no hash needed)
 *   recordUrl(id)               → human-readable Hungaricana page
 *   tileUrl(path, x, y, z)      → Promise<string>
 *   tileSpan(record, x, y, z)   → {w,h} level pixels a tile really covers
 *   tileSpanFor(meta, x, y, z)  → the same maths for a cropped-tile source
 *   resolve(path, hint)         → Promise<{w, h, maxZoom, probed}>
 *   clearCache()
 * ===================================================================== */
(function (root) {
    'use strict';

    var DEFAULT_BASES = {
        tile: 'https://static-cdn.hungaricana.hu/tile/image/',
        thumb: 'https://static-cdn.hungaricana.hu/tile/thumb/',
        size: 'https://static-cdn.hungaricana.hu/tile/imagesize/',
        record: 'https://maps.hungaricana.hu/en/'
    };

    var TILE_SIZE = 512;
    var MAX_LEVEL = 12;
    var MAX_PROBE_SPAN = 256;
    var PROBE_TIMEOUT_MS = 12000;
    var AES_KEY = 'dGhpcyBpcyBubyBr';
    var CACHE_KEY = 'dlOtherMaps.pyramid.v2';
    var LEGACY_CACHE_KEYS = ['dlOtherMaps.pyramid.v1', 'dlOtherMaps.pyramid.v1.order'];
    var EDGE_MODES = { CROPPED: 'cropped', PADDED: 'padded' };

    var bases = Object.assign({}, DEFAULT_BASES);
    var _keyPromise = null;
    var _hashCache = Object.create(null);
    var _metaCache = Object.create(null);
    var _inflight = Object.create(null);

    /* Drop stale v1 pyramid caches on upgrade: v1 rounded probed sheets up to
     * whole 512 px cells and could flip the hash order on out-of-bounds edge
     * probes, leaving distorted dimensions in localStorage across reloads. */
    function purgeLegacyStorage() {
        try {
            if (!root.localStorage) return;
            for (var i = 0; i < LEGACY_CACHE_KEYS.length; i++) {
                root.localStorage.removeItem(LEGACY_CACHE_KEYS[i]);
            }
        } catch (e) { /* private mode / restricted storage */ }
    }
    purgeLegacyStorage();

    /* ── tiny helpers ─────────────────────────────────────────────────── */
    function encodeUtf8(text) {
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
        var bytes = [];
        var value = String(text);
        for (var i = 0; i < value.length; i++) {
            var code = value.charCodeAt(i);
            if (code < 0x80) bytes.push(code);
            else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
            else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        }
        return new Uint8Array(bytes);
    }

    function toHex(bytes) {
        var out = '';
        for (var i = 0; i < bytes.length; i++) {
            var hex = bytes[i].toString(16);
            out += hex.length === 1 ? '0' + hex : hex;
        }
        return out;
    }

    /* Same value dezoomify uses: the sum of the UTF-16 code units, mod 100. */
    function pathSum(path) {
        var sum = 0;
        var value = String(path || '');
        for (var i = 0; i < value.length; i++) sum += value.charCodeAt(i);
        return sum;
    }

    function readStore() {
        try {
            var raw = root.localStorage && root.localStorage.getItem(CACHE_KEY);
            return raw ? JSON.parse(raw) || {} : {};
        } catch (e) { return {}; }
    }

    function writeStore(store) {
        try {
            if (root.localStorage) root.localStorage.setItem(CACHE_KEY, JSON.stringify(store));
        } catch (e) { /* private mode / quota — the probe simply re-runs */ }
    }

    function validEdgeMode(mode) {
        return mode === EDGE_MODES.CROPPED || mode === EDGE_MODES.PADDED ? mode : null;
    }

    function cachedMeta(path) {
        if (!path) return null;
        if (_metaCache[path]) return _metaCache[path];
        var store = readStore();
        var entry = store[path];
        if (entry && entry.w && entry.h && isFinite(entry.maxZoom)) {
            _metaCache[path] = {
                w: entry.w,
                h: entry.h,
                maxZoom: entry.maxZoom,
                edgeMode: validEdgeMode(entry.edgeMode),
                cached: true
            };
            return _metaCache[path];
        }
        return null;
    }

    function rememberMeta(path, meta) {
        if (!path || !meta) return;
        var mode = validEdgeMode(meta.edgeMode);
        if (mode) meta.edgeMode = mode;
        _metaCache[path] = meta;
        try {
            var store = readStore();
            var saved = { w: meta.w, h: meta.h, maxZoom: meta.maxZoom };
            if (mode) saved.edgeMode = mode;
            store[path] = saved;
            writeStore(store);
        } catch (e) { /* ignore */ }
    }

    function setSheetEdgeMode(path, mode) {
        var valid = validEdgeMode(mode);
        if (!path || !valid) return null;
        var meta = cachedMeta(path);
        if (!meta) return valid;
        if (meta.edgeMode === valid) return valid;
        meta.edgeMode = valid;
        rememberMeta(path, meta);
        return valid;
    }

    /* ── the tile hash ────────────────────────────────────────────────── */
    function aesKey() {
        if (_keyPromise) return _keyPromise;
        if (!(root.crypto && root.crypto.subtle && typeof root.crypto.subtle.importKey === 'function')) {
            _keyPromise = Promise.reject(new Error('WebCrypto unavailable (needs https or localhost)'));
        } else {
            _keyPromise = root.crypto.subtle.importKey(
                'raw', encodeUtf8(AES_KEY), { name: 'AES-CBC' }, false, ['encrypt']
            );
        }
        return _keyPromise;
    }

    /* dezoomify documents the plaintext as `sum|x|y|z` in issue #346 but the
     * implementation it shipped (legacy/dezoomers/hungaricana.js and
     * dezoomify-rs) encrypts `sum|z|x|y`.  Rather than bet on one reading of
     * a note, the module has both orders, uses the one that answered last and
     * flips over on the first failure. */
    var ORDERS = {
        zxy: function (sum, x, y, z) { return sum + '|' + z + '|' + x + '|' + y; },
        xyz: function (sum, x, y, z) { return sum + '|' + x + '|' + y + '|' + z; }
    };
    var _order = (function () {
        try { return root.localStorage && root.localStorage.getItem(CACHE_KEY + '.order') === 'xyz' ? 'xyz' : 'zxy'; }
        catch (e) { return 'zxy'; }
    })();

    function preferredOrder() { return _order; }
    function alternateOrder() { return _order === 'zxy' ? 'xyz' : 'zxy'; }

    function noteOrder(order) {
        if (!ORDERS[order] || order === _order) return;
        _order = order;
        _hashCache = Object.create(null);
        try { if (root.localStorage) root.localStorage.setItem(CACHE_KEY + '.order', order); } catch (e) { /* ignore */ }
    }

    function hashFor(path, x, y, z, order) {
        var cacheKey = (order || _order) + '|' + path + '|' + z + '|' + x + '|' + y;
        if (_hashCache[cacheKey]) return _hashCache[cacheKey];

        var plaintext = ORDERS[order || _order](pathSum(path) % 100, x, y, z);
        while (plaintext.length < 16) plaintext += '*';

        var promise = aesKey().then(function (key) {
            return root.crypto.subtle.encrypt(
                { name: 'AES-CBC', iv: new Uint8Array(16) }, key, encodeUtf8(plaintext)
            );
        }).then(function (buffer) {
            // AES-CBC appends a full pad block; the first ciphertext block is
            // the value the portal expects.
            return toHex(new Uint8Array(buffer).slice(0, 16));
        });
        _hashCache[cacheKey] = promise;
        return promise;
    }

    function tileUrlWithOrder(order) {
        return function (path, x, y, z) {
            if (!path) return Promise.resolve('');
            return hashFor(path, x, y, z, order).then(function (hash) {
                return bases.tile + path + '/' + hash;
            });
        };
    }

    function tileUrl(path, x, y, z) { return tileUrlWithOrder(_order)(path, x, y, z); }
    function tileUrlAlt(path, x, y, z) { return tileUrlWithOrder(alternateOrder())(path, x, y, z); }

    /* ── size discovery ───────────────────────────────────────────────── */
    function maxZoomFor(width, height) {
        var longest = Math.max(Number(width) || 0, Number(height) || 0);
        var zoom = 0;
        var covered = TILE_SIZE;
        while (covered < longest && zoom < MAX_LEVEL) { covered *= 2; zoom++; }
        return zoom;
    }

    function imageConstructor() {
        if (root && typeof root.Image === 'function') return root.Image;
        if (typeof Image === 'function') return Image;
        return null;
    }

    /* Fetch one tile via <img> and return its decoded bitmap size {w, h}, or
     * null on 404 / timeout.  Unlike fetch(), <img> works without CORS headers
     * AND reveals naturalWidth/naturalHeight so edge-tile cropping recovers
     * the sheet's exact pixel size to the single pixel. */
    function probeTile(url) {
        var Img = imageConstructor();
        if (!Img || !url) return Promise.resolve(null);
        return new Promise(function (resolve) {
            var img = new Img();
            var settled = false;
            var timer = root.setTimeout(function () { done(null); }, PROBE_TIMEOUT_MS);
            function done(dims) {
                if (settled) return;
                settled = true;
                if (timer) root.clearTimeout(timer);
                img.onload = img.onerror = null;
                resolve(dims);
            }
            img.onload = function () {
                var nw = Number(img.naturalWidth) || 0;
                var nh = Number(img.naturalHeight) || 0;
                done(nw > 0 && nh > 0 ? { w: nw, h: nh } : null);
            };
            img.onerror = function () { done(null); };
            img.src = url;
        });
    }

    /* Coordinate (0, 0, 1) is the ONLY safe place to disambiguate `sum|z|x|y`
     * from `sum|x|y|z`: level 0 is always a single 1 × 1 tile, so (x=0, y=1)
     * never exists at z=0, whereas (x=0, y=0) always exists at z=1 for any
     * sheet past 512 px.  Flipping on an arbitrary out-of-bounds edge tile
     * such as (x=3, y=0, z=3) sends `sum|3|0|3`, hits the real tile (x=0, y=3)
     * at z=3, inflates the probed width and corrupts the stored hash order. */
    function isOrderProbeCoord(x, y, z) {
        return Number(x) === 0 && Number(y) === 0 && Number(z) === 1;
    }

    function probeCoord(path, x, y, z, allowOrderFlip) {
        return tileUrl(path, x, y, z).then(probeTile).then(function (dims) {
            if (dims || !allowOrderFlip) return dims;
            var alt = alternateOrder();
            return tileUrlWithOrder(alt)(path, x, y, z).then(probeTile).then(function (altDims) {
                if (altDims) noteOrder(alt);
                return altDims;
            });
        });
    }

    /* Binary-search the top row (axis='x') or left column (axis='y') of the
     * deepest level to find BOTH the exact tile count and the decoded pixel
     * size of the last tile.  Takes at most maxZoom requests (≤ 6 for typical
     * archival scans) instead of walking up to 64 tiles linearly. */
    function probeAxis(path, maxZoom, axis, originTile) {
        if (maxZoom <= 0) {
            return Promise.resolve({ count: 1, last: originTile });
        }
        var lo = 0;
        var loTile = originTile;
        var hi = Math.min(MAX_PROBE_SPAN, Math.pow(2, maxZoom) + 1);
        function step() {
            if (lo + 1 >= hi) {
                return Promise.resolve({ count: lo + 1, last: loTile });
            }
            var mid = Math.floor((lo + hi) / 2);
            var x = axis === 'x' ? mid : 0;
            var y = axis === 'x' ? 0 : mid;
            return probeCoord(path, x, y, maxZoom, false).then(function (dims) {
                if (dims) {
                    lo = mid;
                    loTile = dims;
                } else {
                    hi = mid;
                }
                return step();
            });
        }
        return step();
    }

    function probePyramid(path) {
        var origins = [];
        var level = 0;
        function nextLevel() {
            if (level > MAX_LEVEL) return Promise.resolve();
            return probeCoord(path, 0, 0, level, isOrderProbeCoord(0, 0, level))
                .then(function (dims) {
                    if (!dims) return;
                    origins.push(dims);
                    level++;
                    return nextLevel();
                });
        }
        return nextLevel().then(function () {
            if (!origins.length) {
                throw new Error('Hungaricana pyramid unreachable for ' + path);
            }
            var maxZoom = origins.length - 1;
            var rootTile = origins[0];
            var deepestOrigin = origins[maxZoom];
            return Promise.all([
                probeAxis(path, maxZoom, 'x', deepestOrigin),
                probeAxis(path, maxZoom, 'y', deepestOrigin)
            ]).then(function (axes) {
                var xr = axes[0], yr = axes[1];
                var lastW = xr.last && xr.last.w > 0 ? Math.min(TILE_SIZE, xr.last.w) : TILE_SIZE;
                var lastH = yr.last && yr.last.h > 0 ? Math.min(TILE_SIZE, yr.last.h) : TILE_SIZE;
                /* Exact to the pixel when the server crops edge tiles
                 * ((cols−1)·512 + lastW = W), and exact grid extent
                 * (cols·512) when the server pads every cell to 512 × 512. */
                var w = Math.max(1, (xr.count - 1) * TILE_SIZE + lastW);
                var h = Math.max(1, (yr.count - 1) * TILE_SIZE + lastH);
                var edgeMode = null;
                if (lastW < TILE_SIZE || lastH < TILE_SIZE ||
                    rootTile.w < TILE_SIZE || rootTile.h < TILE_SIZE) {
                    edgeMode = EDGE_MODES.CROPPED;
                } else if (rootTile.w === TILE_SIZE && rootTile.h === TILE_SIZE &&
                           maxZoom > 0 && xr.count !== yr.count) {
                    /* A non-square grid whose 1 × 1 root tile still decoded at
                     * 512 × 512 must pad its shorter axis inside the cell. */
                    edgeMode = EDGE_MODES.PADDED;
                }
                var result = { w: w, h: h, maxZoom: maxZoom, probed: true };
                if (edgeMode) result.edgeMode = edgeMode;
                return result;
            });
        });
    }

    /* Guard the narrow boundary where truncated Zoomify tier halving (dim >> 1)
     * stops one level earlier than exact halving (e.g. 8193..8207 px). */
    function isTruncatedBoundary(w, h, maxZoom) {
        if (maxZoom <= 0) return false;
        var longest = Math.max(w, h);
        var shifted = Math.floor(longest / Math.pow(2, maxZoom - 1));
        return longest > TILE_SIZE * Math.pow(2, maxZoom - 1) && shifted === TILE_SIZE;
    }

    function fetchSize(path) {
        if (typeof root.fetch !== 'function') return Promise.resolve(null);
        return root.fetch(bases.size + path, { mode: 'cors', cache: 'force-cache' })
            .then(function (response) {
                if (!response || !response.ok) return null;
                return response.json();
            })
            .then(function (json) {
                var w = Number(json && json.width) || 0;
                var h = Number(json && json.height) || 0;
                if (!(w > 0 && h > 0)) return null;
                var maxZoom = maxZoomFor(w, h);
                var meta = { w: w, h: h, maxZoom: maxZoom, probed: false };
                if (imageConstructor() && isTruncatedBoundary(w, h, maxZoom)) {
                    return probeCoord(path, 0, 0, maxZoom, false).then(function (dims) {
                        if (dims) return meta;
                        /* Confirm the server actually answered on maxZoom − 1
                         * so a transient network drop never lowers maxZoom. */
                        return probeCoord(path, 0, 0, maxZoom - 1, false).then(function (prev) {
                            if (prev) meta.maxZoom = Math.max(0, maxZoom - 1);
                            return meta;
                        });
                    });
                }
                return meta;
            })
            .catch(function () { return null; });
    }

    /**
     * Resolve the natural pixel size of a sheet.
     * @param {string} path  ECW path of the sheet.
     * @param {{w?:number,h?:number}} [hint] size already known from the catalogue.
     */
    function resolve(path, hint) {
        if (!path) return Promise.reject(new Error('missing sheet path'));
        var cached = cachedMeta(path);
        if (cached) return Promise.resolve(cached);
        if (_inflight[path]) return _inflight[path];

        var task;
        if (hint && hint.w && hint.h) {
            var size = { w: Number(hint.w), h: Number(hint.h), maxZoom: maxZoomFor(hint.w, hint.h), probed: false };
            rememberMeta(path, size);
            task = Promise.resolve(size);
        } else {
            task = fetchSize(path).then(function (meta) {
                if (meta) return meta;
                return probePyramid(path);
            }).then(function (meta) {
                rememberMeta(path, meta);
                return meta;
            });
        }
        _inflight[path] = task;
        task.then(function () { delete _inflight[path]; },
            function () { delete _inflight[path]; });
        return task;
    }

    /**
     * Level-pixel box covered by tile (x, y) of a `meta` pyramid.
     *
     * Level `level` is `w / 2^(maxZoom − level)` pixels wide and split into
     * TILE_SIZE cells; the last column / row is clipped to the image, so its
     * bitmap comes back narrower than a cell.  Sources that CROP their tiles
     * (NLS IIIF regions, the Josephine Wikimedia canvases) report this span
     * through their `tileSpan`, and the overlay paints the bitmap at exactly
     * that size — stretching it into a square cell distorted the sheet by a
     * different factor at every pyramid level (see OTHER_MAPS.md §8.2).
     *
     * @param {{w:number,h:number,maxZoom:number}} meta pyramid size
     * @returns {{w:number,h:number}} span in level pixels, both axes
     */
    function tileSpanFor(meta, x, y, level) {
        var zoomDelta = (Number(meta && meta.maxZoom) || 0) - (Number(level) || 0);
        var scale = Math.pow(2, zoomDelta);
        var wLevel = Math.max(1, (Number(meta && meta.w) || 0) / scale);
        var hLevel = Math.max(1, (Number(meta && meta.h) || 0) / scale);
        return {
            w: Math.max(0, Math.min(TILE_SIZE, wLevel - (Number(x) || 0) * TILE_SIZE)),
            h: Math.max(0, Math.min(TILE_SIZE, hLevel - (Number(y) || 0) * TILE_SIZE))
        };
    }

    /**
     * Reconcile the exact level-pixel box of a pre-cut server tile from its
     * decoded bitmap dimensions (`img.naturalWidth` × `img.naturalHeight`).
     *
     * Hungaricana's Zoomify-style ECW tiler crops edge tiles (including the
     * whole root tile at level 0) to the sheet edge rather than padding them
     * to 512 × 512.  Stretching a cropped edge bitmap across a full 512 px
     * cell magnifies and shifts the scan inside `.om-box` by a different
     * factor at every pyramid level.  Conversely, if a server DOES pad an
     * edge cell to 512 × 512 (`natural === 512` where `expected < 510`), the
     * bitmap must stay at 512 px so `.om-grid { overflow: hidden }` trims
     * only the padding.  Checking both against `tileSpanFor` gives exact
     * 0.0 px registration across every level for BOTH cropped and padded
     * pyramids without guessing ahead of time.
     *
     * @param {{w:number,h:number,maxZoom:number,edgeMode?:string}} meta
     * @returns {{w:number,h:number,edgeMode:string|null}}
     */
    function measuredTileSpan(meta, x, y, level, naturalW, naturalH) {
        var exp = meta ? tileSpanFor(meta, x, y, level) : { w: TILE_SIZE, h: TILE_SIZE };
        var nw = Number(naturalW) || 0;
        var nh = Number(naturalH) || 0;
        var knownMode = meta ? validEdgeMode(meta.edgeMode) : null;

        function resolveAxis(expected, natural) {
            var e = expected > 0 ? expected : TILE_SIZE;
            if (!(natural > 0)) return e;
            /* An interior cell always spans the full 512 px grid step so it
             * joins seamlessly with the neighbour placed at (idx + 1)·512. */
            if (e >= TILE_SIZE) return TILE_SIZE;
            if (natural < TILE_SIZE) {
                /* Cropped edge tile: floor / bit-shift / round / ceil on the
                 * server stays within < 1 px of the exact fractional span `e`.
                 * Using `e` eliminates sub-pixel drift between levels; a
                 * wider mismatch falls back to the bitmap's own pixel size so
                 * it is never stretched to 512 px. */
                return Math.abs(natural - e) <= 2 ? e : natural;
            }
            if (natural === TILE_SIZE) {
                /* A near-full cropped edge (e.g. 511.5 px rounded to 512)
                 * keeps its exact fractional span once cropping is known;
                 * otherwise a 512 px bitmap on a narrow edge cell is padded
                 * and stays at 512 px so the grid clip trims the margin. */
                if (knownMode === EDGE_MODES.CROPPED && TILE_SIZE - e <= 2) return e;
                return TILE_SIZE;
            }
            return e;
        }

        var xCropped = nw > 0 && nw < TILE_SIZE && exp.w < TILE_SIZE;
        var yCropped = nh > 0 && nh < TILE_SIZE && exp.h < TILE_SIZE;
        var xPadded = nw === TILE_SIZE && exp.w > 0 && exp.w < TILE_SIZE - 2;
        var yPadded = nh === TILE_SIZE && exp.h > 0 && exp.h < TILE_SIZE - 2;
        var detected = null;
        if ((xCropped || yCropped) && !xPadded && !yPadded) {
            detected = EDGE_MODES.CROPPED;
        } else if ((xPadded || yPadded) && !xCropped && !yCropped) {
            detected = EDGE_MODES.PADDED;
        }
        return {
            w: resolveAxis(exp.w, nw),
            h: resolveAxis(exp.h, nh),
            edgeMode: detected
        };
    }

    /* ── multi-source registry ──────────────────────────────────────────
     * Other maps can be served by more than one portal.  Each source
     * registers an adapter implementing tileUrl / thumbUrl / recordUrl /
     * resolve for its own records (js/other-maps-nls.js is the NLS IIIF
     * adapter).  A record object carrying a known `source` routes to that
     * adapter; a plain path string, a sourceless record, or `source ===
     * 'hungaricana'` stays on the Hungaricana ECW pyramid. */
    var sources = Object.create(null);

    function registerSource(name, adapter) {
        if (name && adapter) sources[name] = adapter;
    }

    function sourceAdapter(arg) {
        if (arg && typeof arg === 'object' && arg.source && sources[arg.source]) {
            return sources[arg.source];
        }
        return null;
    }

    /* True when the source extracts and scales an explicit natural-pixel
     * region (rx, ry, rw, rh) per tile (NLS IIIF and Josephine Commons
     * canvases).  Those tiles ALWAYS cover exact tileSpanFor(meta, x, y, z),
     * even if the server rounds the output JPEG by 1 px.  False for pre-cut
     * server grids (Hungaricana ECW), whose bitmap size distinguishes cropped
     * from padded edge cells. */
    function dispatchIsRegionScaled(arg) {
        var adapter = sourceAdapter(arg);
        return !!(adapter && adapter.regionScaled);
    }

    /* Legacy callers pass ECW path strings; source callers pass the whole
     * record.  Normalise the latter to the path the Hungaricana helpers key
     * their caches on. */
    function asPath(arg) {
        return arg && typeof arg === 'object' ? arg.path : arg;
    }

    function dispatchPeekMeta(arg) {
        var adapter = sourceAdapter(arg);
        if (adapter && typeof adapter.peekMeta === 'function') {
            return adapter.peekMeta(arg);
        }
        if (adapter) return null;
        return cachedMeta(asPath(arg));
    }

    function dispatchEdgeModeOf(arg) {
        if (dispatchIsRegionScaled(arg)) return EDGE_MODES.CROPPED;
        var meta = cachedMeta(asPath(arg));
        return meta ? validEdgeMode(meta.edgeMode) : null;
    }

    function dispatchNoteEdgeMode(arg, mode) {
        if (sourceAdapter(arg)) return null;
        return setSheetEdgeMode(asPath(arg), mode);
    }

    /* Only allow a Hungaricana hash-order flip on (0, 0, 1) — never on an
     * arbitrary failed edge tile where `xyz` could fetch a wrong-level tile
     * and poison `_order` for every subsequent request. */
    function dispatchCanFlipOrder(arg, x, y, z) {
        if (sourceAdapter(arg)) return false;
        return isOrderProbeCoord(x, y, z);
    }

    function dispatchTileUrl(arg, x, y, z) {
        var adapter = sourceAdapter(arg);
        if (adapter) return adapter.tileUrl(arg, x, y, z);
        return tileUrl(asPath(arg), x, y, z);
    }

    function dispatchTileUrlAlt(arg, x, y, z) {
        var adapter = sourceAdapter(arg);
        if (adapter) {
            if (typeof adapter.tileUrlAlt === 'function') {
                return adapter.tileUrlAlt(arg, x, y, z);
            }
            return adapter.tileUrl(arg, x, y, z);
        }
        return tileUrlAlt(asPath(arg), x, y, z);
    }

    /* Level-pixel box that one tile really covers.
     *  - Region-scaled adapters (NLS IIIF, Josephine) expose `tileSpan` →
     *    exact `tileSpanFor(meta, x, y, z)`.
     *  - Hungaricana ECW reports exact `tileSpanFor(meta, x, y, z)` once a
     *    sheet's edge cropping has been observed (either during `probePyramid`
     *    or on the first decoded edge tile), and `{512, 512}` when the sheet
     *    is padded or not yet observed (the overlay reconciles every pre-cut
     *    tile's actual `naturalWidth × naturalHeight` on load before reveal). */
    function dispatchTileSpan(arg, x, y, z) {
        var adapter = sourceAdapter(arg);
        if (adapter && typeof adapter.tileSpan === 'function') {
            return adapter.tileSpan(arg, x, y, z);
        }
        var meta = cachedMeta(asPath(arg));
        if (meta && meta.edgeMode === EDGE_MODES.CROPPED) {
            return tileSpanFor(meta, x, y, z);
        }
        return { w: TILE_SIZE, h: TILE_SIZE };
    }

    function dispatchThumbUrl(arg) {
        var adapter = sourceAdapter(arg);
        if (adapter) return adapter.thumbUrl(arg);
        var path = asPath(arg);
        return path ? bases.thumb + path : '';
    }

    function dispatchRecordUrl(arg) {
        var adapter = sourceAdapter(arg);
        if (adapter) return adapter.recordUrl(arg);
        var id = arg && typeof arg === 'object' ? (arg.id || arg.path) : arg;
        if (!id) return bases.record;
        return bases.record + id + '/view/';
    }

    function dispatchResolve(arg, hint) {
        var adapter = sourceAdapter(arg);
        if (adapter) return adapter.resolve(arg, hint);
        return resolve(asPath(arg), hint);
    }

    root.DetectLabOtherMapsTiles = {
        TILE_SIZE: TILE_SIZE,
        MAX_LEVEL: MAX_LEVEL,
        CACHE_KEY: CACHE_KEY,
        EDGE_MODES: EDGE_MODES,
        registerSource: registerSource,
        source: function (name) { return sources[name] || null; },
        configure: function (overrides) {
            Object.assign(bases, DEFAULT_BASES, overrides || {});
        },
        bases: function () { return Object.assign({}, bases); },
        thumbUrl: dispatchThumbUrl,
        recordUrl: dispatchRecordUrl,
        tileUrl: dispatchTileUrl,
        tileUrlAlt: dispatchTileUrlAlt,
        tileSpan: dispatchTileSpan,
        tileSpanFor: tileSpanFor,
        measuredTileSpan: measuredTileSpan,
        isRegionScaled: dispatchIsRegionScaled,
        peekMeta: dispatchPeekMeta,
        edgeModeOf: dispatchEdgeModeOf,
        noteEdgeMode: dispatchNoteEdgeMode,
        canFlipOrder: dispatchCanFlipOrder,
        preferredOrder: preferredOrder,
        alternateOrder: alternateOrder,
        noteOrder: noteOrder,
        maxZoomFor: maxZoomFor,
        resolve: dispatchResolve,
        clearCache: function () {
            _hashCache = Object.create(null);
            _metaCache = Object.create(null);
            _order = 'zxy';
            purgeLegacyStorage();
            try {
                if (root.localStorage) {
                    root.localStorage.removeItem(CACHE_KEY);
                    root.localStorage.removeItem(CACHE_KEY + '.order');
                }
            } catch (e) { /* ignore */ }
        }
    };
}(typeof window !== 'undefined' ? window : this));
