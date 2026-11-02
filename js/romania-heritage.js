/* Romanian Heritage is a switch-only group. Each source owns its switch
 * and opacity. The existing Patrimoniu APIs/ids still mean ARCHAEOLOGY so
 * Detect mode and map-side opacity mirrors never enable the nature source.
 * See ROMANIA_HERITAGE_SUBLAYERS.md. */
(function (root) {
    'use strict';
    var doc = root.document;
    if (!doc) return;
    var TAG = '20261102-ro-heritage';
    var SOURCE = 'https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/Harti/ariinaturaleprotejate.gpkg';
    var MIN_ZOOM = 8;
    var rawToggle = root.togglePatrimoniuLayer;
    var rawOpacity = root.setPatrimoniuOpacity;
    var map = root._dlMap;
    if (!map || typeof rawToggle !== 'function' || typeof rawOpacity !== 'function') return;

    var state = {
        archaeology: !!(el('patrimoniuToggle') && el('patrimoniuToggle').checked),
        natural: false,
        remembered: { archaeology: true, natural: true },
        naturalOpacity: 55,
        layer: null, renderer: null, reader: null, aborter: null,
        epoch: 0, view: 0, busy: false, pending: false, timer: null,
        status: '', count: 0, expanded: true,
        collection: null, dataRevision: 0, mirrorCache: null
    };
    var scripts = {};
    var TEXT = {
        title: { ro: 'Arii naturale protejate', en: 'Natural protected sites' },
        archaeology: { ro: 'Patrimoniu arheologic', en: 'Archeological heritage' },
        loading: { ro: 'Se încarcă ariile din zona vizibilă…', en: 'Loading protected sites in this view…' },
        zoom: { ro: 'Mărește harta la nivelul 8 pentru a vedea ariile protejate.', en: 'Zoom to level 8 to see protected sites.' },
        unavailable: { ro: 'Datele nu sunt disponibile. Oprește și repornește substratul pentru a reîncerca.', en: 'Data unavailable. Switch this sublayer off and on to retry.' },
        partial: { ro: 'Afișare parțială — mărește harta pentru toate ariile din zonă.', en: 'Partial view — zoom in to see all protected sites in this area.' },
        none: { ro: 'Nicio arie protejată în zona vizibilă.', en: 'No protected sites in this view.' },
        shown: { ro: 'arii protejate în zona vizibilă', en: 'protected sites in this view' },
        info: {
            ro: 'Poligoanele ariilor naturale protejate din fișierul GeoPackage furnizat, găzduit în Supabase (Harti/ariinaturaleprotejate.gpkg). Se încarcă doar datele pentru zona vizibilă, de la nivelul de zoom 8. Verde: contur și suprafață protejată. Verifică statutul și restricțiile la autoritatea competentă; harta nu acordă drept de acces sau de detecție.',
            en: 'Protected natural-area polygons from the supplied GeoPackage, hosted in Supabase (Harti/ariinaturaleprotejate.gpkg). Only data for the visible map area is loaded, from zoom 8. Green: protected boundary and area. Verify current status and restrictions with the responsible authority; this map grants no permission to enter or detect.'
        }
    };
    function el(id) { return doc.getElementById(id); }
    function tr(pair) {
        var lang = typeof root._currentLang === 'function' ? root._currentLang() : doc.documentElement.lang;
        return String(lang || '').toLowerCase().indexOf('ro') === 0 ? pair.ro : pair.en;
    }
    function clamp(value) { var n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0; }
    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function any() { return state.archaeology || state.natural; }
    function remember() {
        if (any()) state.remembered = { archaeology: state.archaeology, natural: state.natural };
    }
    function syncUI() {
        if (el('heritageToggle')) el('heritageToggle').checked = any();
        if (el('patrimoniuToggle')) el('patrimoniuToggle').checked = state.archaeology;
        if (el('naturalProtectedToggle')) el('naturalProtectedToggle').checked = state.natural;
        if (el('archaeologicalHeritageRow')) el('archaeologicalHeritageRow').classList.toggle('is-active', state.archaeology);
        if (el('naturalProtectedRow')) el('naturalProtectedRow').classList.toggle('is-active', state.natural);
        if (el('naturalProtectedOpacitySlider')) el('naturalProtectedOpacitySlider').value = state.naturalOpacity;
        if (el('naturalProtectedPct')) el('naturalProtectedPct').textContent = state.naturalOpacity + '%';
    }
    function status(code, count) {
        state.status = code;
        state.count = count || 0;
        var node = el('naturalProtectedStatus');
        if (!node) return;
        node.textContent = !code ? '' : code === 'shown' ? count + ' ' + tr(TEXT.shown) : tr(TEXT[code]);
        node.hidden = !code;
        node.classList.toggle('is-error', code === 'unavailable');
    }
    function archaeologyName() {
        var title = tr(TEXT.archaeology);
        [root._heritage3dBridge, root._patrimoniuLayer, root._patrimoniuWmsFallback].forEach(function (layer) {
            if (layer && layer.options) layer.options.name = title;
        });
    }
    function applyArchaeology(on) {
        state.archaeology = !!on;
        rawToggle(state.archaeology);
        archaeologyName();
    }
    function naturalStyle() {
        var o = state.naturalOpacity / 100;
        return { color: '#55b88a', weight: 2, opacity: 0.95 * o, fillColor: '#55b88a', fillOpacity: 0.32 * o };
    }
    function popup(feature) {
        var properties = feature.properties || {};
        var rows = Object.keys(properties).filter(function (key) {
            return properties[key] != null && properties[key] !== '' && !(properties[key] instanceof Uint8Array);
        }).slice(0, 14).map(function (key) {
            return '<div><b>' + esc(key) + ':</b> ' + esc(String(properties[key]).slice(0, 500)) + '</div>';
        });
        return '<div class="ro-natural-popup"><strong>' + esc(tr(TEXT.title)) + '</strong>' + rows.join('') + '</div>';
    }
    function clearNaturalData() {
        state.collection = null;
        state.dataRevision++;
        state.mirrorCache = null;
        if (state.layer) state.layer.clearLayers();
    }
    function mirrorFeatures() {
        var stamp = [state.dataRevision, state.naturalOpacity, tr(TEXT.title)].join('|');
        if (state.mirrorCache && state.mirrorCache.stamp === stamp) return state.mirrorCache;
        var features = ((state.collection && state.collection.features) || []).map(function (feature) {
            return { type: 'Feature', id: feature.id, geometry: feature.geometry,
                properties: Object.assign({}, feature.properties, naturalStyle(), { radius: 5, popup: popup(feature) }) };
        });
        state.mirrorCache = { stamp: stamp, label: tr(TEXT.title), geojson: { type: 'FeatureCollection', features: features } };
        return state.mirrorCache;
    }
    function ensureLayer() {
        if (state.layer) return state.layer;
        if (!map.getPane('pane_natural_protected')) {
            map.createPane('pane_natural_protected');
            // Below archaeological pins/radii and all event/location markers.
            map.getPane('pane_natural_protected').style.zIndex = 405;
        }
        state.renderer = root.L.canvas({ pane: 'pane_natural_protected', padding: 0.25 });
        state.layer = root.L.geoJSON(null, {
            pane: 'pane_natural_protected', renderer: state.renderer,
            name: tr(TEXT.title), attribution: 'Arii naturale protejate · Harti/ariinaturaleprotejate.gpkg',
            style: naturalStyle,
            pointToLayer: function (feature, latlng) {
                return root.L.circleMarker(latlng, Object.assign({ radius: 5, renderer: state.renderer, pane: 'pane_natural_protected' }, naturalStyle()));
            },
            onEachFeature: function (feature, layer) {
                // Leaflet registers a GeoJSON group's children on the map too.
                // The parent offers them once, with their paint + popup, to 3D.
                function owned(child) {
                    child._dl3dSkip = true;
                    if (typeof child.eachLayer === 'function') child.eachLayer(owned);
                }
                owned(layer);
                layer.options.name = tr(TEXT.title);
                layer.bindPopup(function () { return popup(feature); }, { maxWidth: 340 });
            }
        });
        state.layer._dl3dFeatures = mirrorFeatures;
        root._naturalProtectedLayer = state.layer;
        return state.layer;
    }
    function script(path) {
        if (scripts[path]) return scripts[path];
        scripts[path] = new Promise(function (resolve, reject) {
            var node = doc.createElement('script');
            var timer = setTimeout(function () { node.remove(); delete scripts[path]; reject(new Error('geopackage_asset_timeout')); }, 20000);
            node.src = path; node.async = true;
            node.onload = function () { clearTimeout(timer); resolve(); };
            node.onerror = function () { clearTimeout(timer); node.remove(); delete scripts[path]; reject(new Error('geopackage_asset_unavailable')); };
            doc.head.appendChild(node);
        });
        return scripts[path];
    }
    async function readerAPI() {
        // A partial/failed first load can leave the reader global installed
        // before Comlink or Proj4 is ready. Retry each missing dependency,
        // rather than treating that one global as proof the runtime is ready.
        var loads = [];
        if (!root.Comlink) loads.push(script('js/vendor/geopackage/comlink.js'));
        if (!root.proj4) loads.push(script('js/vendor/geopackage/proj4.js'));
        if (!root.DetectLabGeoPackage) loads.push(script('js/geopackage-reader.js?v=' + TAG));
        await Promise.all(loads);
        if (!root.Comlink || !root.proj4 || !root.DetectLabGeoPackage) throw new Error('geopackage_asset_unavailable');
        return root.DetectLabGeoPackage;
    }
    function stopNatural() {
        state.epoch++;
        state.view++;
        clearTimeout(state.timer);
        state.busy = false; state.pending = false;
        if (state.aborter) state.aborter.abort();
        if (state.reader) state.reader.close();
        state.aborter = null; state.reader = null;
        if (state.layer) map.removeLayer(state.layer);
        clearNaturalData();
        status('');
    }
    async function loadNatural() {
        if (!state.natural) return;
        if (state.busy) { state.pending = true; return; }
        if (map.getZoom() < MIN_ZOOM) {
            clearNaturalData();
            status('zoom'); return;
        }
        state.busy = true; state.pending = false;
        var epoch = state.epoch, revision = state.view;
        status('loading');
        try {
            if (!state.reader) {
                var api = await readerAPI();
                if (epoch !== state.epoch || !state.natural) return;
                state.aborter = new AbortController();
                var reader = await api.open(SOURCE + '?v=' + TAG, {
                    signal: state.aborter.signal,
                    workerUrl: new URL('js/geopackage-worker.js?v=' + TAG, doc.baseURI).href,
                    wasmUrl: new URL('js/vendor/geopackage/sql-wasm.wasm', doc.baseURI).href
                });
                if (epoch !== state.epoch || !state.natural) { reader.close(); return; }
                state.reader = reader;
            }
            // map-rotate.js makes getBounds() cover all four visible corners.
            var bounds = map.getBounds();
            var bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
            var fc = await state.reader.features(bbox, 250);
            // A late query may never resurrect an off layer or replace a newer
            // viewport. One pending update coalesces an entire pan/zoom gesture.
            if (epoch !== state.epoch || revision !== state.view || !state.natural) return;
            var layer = ensureLayer();
            clearNaturalData();
            state.collection = fc;
            layer.addData(fc);
            if (!map.hasLayer(layer)) layer.addTo(map);
            status(fc.truncated ? 'partial' : fc.features.length ? 'shown' : 'none', fc.features.length);
        } catch (error) {
            if (epoch !== state.epoch || !state.natural || error.name === 'AbortError') return;
            clearNaturalData();
            if (state.reader) state.reader.close();
            state.reader = null;
            status('unavailable');
            if (root.console) root.console.warn('[Romanian heritage] Natural protected sites:', error);
        } finally {
            if (epoch === state.epoch) {
                state.busy = false;
                if (state.pending && state.natural) schedule();
            }
        }
    }
    function schedule() {
        state.view++;
        clearTimeout(state.timer);
        if (state.natural) state.timer = setTimeout(loadNatural, 180);
    }
    function applyNatural(on) {
        if (state.natural === !!on) return;
        state.natural = !!on;
        if (on) {
            if (!state.naturalOpacity) state.naturalOpacity = 55;
            ensureLayer().addTo(map);
            schedule();
        } else stopNatural();
    }

    root.toggleRomanianHeritage = function (on) {
        if (on) {
            var selected = state.remembered;
            applyArchaeology(selected.archaeology);
            applyNatural(selected.natural);
        } else {
            remember();
            applyArchaeology(false);
            applyNatural(false);
        }
        syncUI();
    };
    root.togglePatrimoniuLayer = function (on) {
        applyArchaeology(on);
        remember(); syncUI();
    };
    root.setPatrimoniuOpacity = function (value) {
        var val = clamp(value), slider = el('patrimoniuOpacitySlider');
        if (slider) slider.value = val;
        applyArchaeology(val > 0);
        rawOpacity(val);
        remember(); syncUI();
    };
    root.toggleNaturalProtectedSites = function (on) {
        applyNatural(on);
        remember(); syncUI();
    };
    root.setNaturalProtectedOpacity = function (value) {
        state.naturalOpacity = clamp(value);
        applyNatural(state.naturalOpacity > 0);
        if (state.layer) state.layer.setStyle(naturalStyle);
        remember(); syncUI();
    };
    root.toggleRomanianHeritageSubLayers = function () {
        state.expanded = !state.expanded;
        var column = el('heritageSubLayers'), button = el('heritageExpandBtn'), icon = el('heritageExpandIcon');
        if (column) { column.hidden = !state.expanded; column.style.display = state.expanded ? 'flex' : 'none'; }
        if (button) button.setAttribute('aria-expanded', String(state.expanded));
        if (icon) icon.style.transform = state.expanded ? '' : 'rotate(-90deg)';
    };
    root.showNaturalProtectedInfo = function () {
        if (typeof root.showLayerInfo === 'function') root.showLayerInfo(tr(TEXT.title), 'Supabase · Harti/ariinaturaleprotejate.gpkg', tr(TEXT.info));
    };
    map.on('moveend zoomend', schedule);
    doc.addEventListener('detectlab:langchange', function () {
        archaeologyName();
        status(state.status, state.count);
        if (state.layer) {
            state.layer.options.name = tr(TEXT.title);
            state.layer.eachLayer(function (layer) { layer.options.name = tr(TEXT.title); });
        }
    });
    root.DetectLabRomanianHeritage = {
        source: SOURCE, minZoom: MIN_ZOOM,
        refresh: schedule,
        state: function () { return { archaeology: state.archaeology, natural: state.natural, naturalOpacity: state.naturalOpacity }; }
    };
    archaeologyName();
    syncUI();
})(typeof window !== 'undefined' ? window : globalThis);
