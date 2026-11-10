/*!
 * Small, observational TRAIN loading preview: four real sites, one canvas, no I/O.
 * Not a map layer or a model progress meter. Never waits, fits the camera, fetches,
 * changes tools/layers, or retains DEM tiles. Removed as soon as the run finishes.
 * @typedef {{type:'start', total:number, limit:number}|{type:'sample', index:number,
 * valid:boolean, lat:number, lon:number, altitude:number, slope:number, aspect:number,
 * curvature:number, nearest:Object|null, patch:Object|null}|{type:'reference',
 * index:number, included:boolean, soilPercentile:number|null}} PreviewObservation
 */
(function (root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DetectLabApmLoadingPreview = api;
})(typeof window !== 'undefined' ? window : this, function (root) {
    'use strict';
    var LIMIT = 4, PHASE_MS = 2400, FRAME_MS = 1000 / 30;

    function create(options) {
        var doc = root.document, T = options.t, host = options.host;
        var samples = new Array(LIMIT), total = 0, limit = LIMIT, stopped = false;
        var phase = 0, cursor = 0, phaseAt = root.performance.now(), lastFrame = -Infinity, raf = null;
        var phases = ['water', 'relief', 'soil'];
        var reduce = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
        var lowPower = !!(root.navigator.connection && root.navigator.connection.saveData);
        function node(tag, cls, parent) {
            var n = doc.createElement(tag); n.className = cls; if (parent) parent.appendChild(n); return n;
        }
        var box = node('section', 'apm-loading-preview', host);
        box.setAttribute('aria-label', T('preview.title'));
        var head = node('div', 'apm-preview-head', box);
        var title = node('strong', '', head); title.textContent = T('preview.title'); title.dataset.previewKey = 'preview.title';
        function button(key, parent, action) {
            var b = node('button', 'apm-btn apm-preview-button', parent);
            b.type = 'button'; b.dataset.previewKey = key; b.textContent = T(key); b.addEventListener('click', action); return b;
        }
        button('preview.skip', head, function () { stop(); if (options.onSkip) options.onSkip(); });
        button('run.cancel', head, function () { if (options.onCancel) options.onCancel(); });
        var stage = node('div', 'apm-note', box);
        stage.textContent = T('preview.wait');
        var scope = node('div', 'apm-note', box);
        var siteName = node('div', 'apm-preview-site', box);
        var tabs = node('div', 'apm-preview-tabs', box), tabButtons = [];
        phases.forEach(function (p, i) {
            var b = button('preview.' + p, tabs, function () { phase = i; phaseAt = root.performance.now(); renderText(); paint(1); });
            b.setAttribute('aria-pressed', String(i === phase)); tabButtons.push(b);
        });
        var canvas = node('canvas', 'apm-preview-canvas', box);
        canvas.setAttribute('aria-hidden', 'true');
        var ctx = canvas.getContext('2d');
        if (!ctx) { box.remove(); throw new Error('Canvas unavailable'); }
        var values = node('div', 'apm-preview-values', box);
        var method = node('p', 'apm-preview-method', box);
        var foot = node('div', 'apm-preview-foot', box);
        button('preview.next', foot, function () { cursor++; phaseAt = root.performance.now(); renderText(); paint(1); });
        var caveat = node('small', '', foot); caveat.textContent = T('preview.scope'); caveat.dataset.previewKey = 'preview.scope';
        var live = node('div', 'apm-preview-live', box);
        live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
        var lastAnnouncement = -Infinity, stageKey = 'preview.wait', stageVars = null;
        function available() { return samples.filter(function (s) { return s && s.valid && s.patch; }); }
        function selected() { var a = available(); return a.length ? a[cursor % a.length] : null; }
        function number(v, digits) { return typeof v === 'number' && isFinite(v) ? v.toFixed(digits == null ? 1 : digits) : '—'; }
        function staticMode() { return lowPower || !!(reduce && reduce.matches); }
        function renderText() {
            var a = available(), s = selected(), p = phases[phase];
            scope.textContent = T('preview.subset', { n: a.length, total: total, limit: limit });
            tabButtons.forEach(function (b, i) { b.setAttribute('aria-pressed', String(i === phase)); });
            siteName.textContent = s ? (s.name || s.id || T('preview.site')) + ' · ' + number(s.lat, 5) + ', ' + number(s.lon, 5) : T('preview.wait');
            if (!s) { values.textContent = ''; method.textContent = T('preview.noSamples'); return; }
            var water = s.nearest;
            values.textContent = T('preview.values', { altitude: number(s.altitude), slope: number(s.slope),
                aspect: s.slope >= s.minSlopeDeg ? number(s.aspect, 0) + '°' : T('preview.flat'),
                distance: water ? number(water.distanceM, 0) + ' m (' + T('water.' + water.waterClass) + ')' : '—' });
            var reference = s.included === false ? T('preview.excluded') : s.included === true ? T('preview.percentile', { n: number(s.soilPercentile * 100, 0) }) : T('preview.referenceWait');
            method.textContent = T('preview.method.' + p, { radius: number(s.radiusM, 0), curvature: number(s.curvature, 6) }) + ' ' +
                (p === 'water' && !water ? T('preview.noWater') : '') + (p === 'soil' ? ' ' + reference : '') +
                (s.smoothed ? ' ' + T('preview.smoothed') : '');
            if (root.performance.now() - lastAnnouncement >= 2400) {
                live.textContent = T('preview.' + p) + '. ' + values.textContent;
                lastAnnouncement = root.performance.now();
            }
        }
        var width = 320, height = 132;
        function resize() {
            if (stopped) return;
            width = Math.max(120, Math.min(400, canvas.getBoundingClientRect().width || 320));
            var dpr = Math.min(2, root.devicePixelRatio || 1);
            canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0); paint(1);
        }
        function line(x1, y1, x2, y2, colour, dashed) {
            ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.setLineDash(dashed ? [4, 4] : []);
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
        }
        function dot(x, y, r) { ctx.fillStyle = '#f4f1ff'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
        function label(text, x, y) { ctx.fillStyle = '#eeeaf7'; ctx.font = '11px system-ui, sans-serif'; ctx.fillText(text, x, y); }
        function paint(fraction) {
            if (stopped) return;
            try {
            ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#151722'; ctx.fillRect(0, 0, width, height);
            var s = selected();
            if (!s) { label(T('preview.wait'), 10, 65); return; }
            if (phase === 0) paintWater(s, fraction);
            else if (phase === 1) paintRelief(s, fraction);
            else paintSoil(s, fraction);
            } catch (ignore) { stop(); }
        }
        function paintWater(s, f) {
            var water = s.nearest;
            if (!water) { label(T('preview.noWater'), 10, 55); return; }
            // Same local equirectangular metric as nearestWaterM; true geometry, no decorative water.
            var mpd = root.DetectLabApmCore.metresPerDegree(s.lat);
            var dx = (water.point.lon - s.lon) * mpd.lon, dy = (water.point.lat - s.lat) * mpd.lat;
            var span = Math.max(50, Math.abs(dx), Math.abs(dy)) * 1.5;
            var scale = Math.min(width - 64, height - 42) / span;
            var ox = width / 2 - dx * scale / 2, oy = height / 2 + dy * scale / 2;
            function point(p) { return [ox + (p[0] - s.lon) * mpd.lon * scale, oy - (p[1] - s.lat) * mpd.lat * scale]; }
            var a = point(water.segment[0]), b = point(water.segment[1]), end = point([water.point.lon, water.point.lat]);
            ctx.save(); ctx.beginPath(); ctx.rect(8, 18, width - 16, height - 36); ctx.clip();
            line(a[0], a[1], b[0], b[1], '#b5a2d5', false);
            line(ox, oy, ox + (end[0] - ox) * f, oy + (end[1] - oy) * f, '#eeeaf7', true);
            dot(ox, oy, 4); dot(end[0], end[1], 3); ctx.restore();
            label('N ↑', 8, 13); label(number(water.distanceM, 0) + ' m', width / 2 - 20, height - 7);
            label(T('preview.site'), Math.max(8, Math.min(width - 60, ox + 6)), Math.max(27, Math.min(height - 20, oy - 6)));
        }
        function paintRelief(s, f) {
            var patch = s.patch, z = patch.elevation.slice(36, 45), finite = z.filter(function (v) { return v !== null && isFinite(v); });
            if (!finite.length) return;
            var lo = Math.min.apply(null, finite), hi = Math.max.apply(null, finite), range = Math.max(1, hi - lo);
            var right = Math.max(0, Math.min(8, f * 8));
            ctx.strokeStyle = '#b5a2d5'; ctx.lineWidth = 2; ctx.beginPath(); var started = false;
            z.forEach(function (v, i) { if (v === null) { started = false; return; } var x = 25 + i / 8 * (width - 50), y = 100 - (v - lo) / range * 70;
                if (started) ctx.lineTo(x, y); else ctx.moveTo(x, y); started = true;
            }); ctx.stroke();
            z.forEach(function (v, i) { if (v !== null && i <= right) dot(25 + i / 8 * (width - 50), 100 - (v - lo) / range * 70, i === 4 ? 4 : 2); });
            label(number(hi) + ' m', 5, 14); label(number(lo) + ' m', 5, 116);
            label('W ← ' + number(8 * patch.dxM, 0) + ' m → E', width / 2 - 55, 130);
        }
        function paintSoil(s, f) {
            var a = s.patch.curvature, max = a.reduce(function (v, x) { return x === null ? v : Math.max(v, Math.abs(x)); }, 0) || 1;
            var size = 11, left = (width - 99) / 2;
            a.forEach(function (v, i) {
                if (v === null) return;
                var tone = Math.round(95 + Math.max(-1, Math.min(1, v / max)) * 65);
                ctx.fillStyle = 'rgb(' + tone + ',' + tone + ',' + Math.min(255, tone + 25) + ')';
                ctx.fillRect(left + (i % 9) * size, 10 + Math.floor(i / 9) * size, size - 1, size - 1);
            });
            ctx.strokeStyle = '#f4f1ff'; ctx.lineWidth = 2; ctx.strokeRect(left + 4 * size, 10 + 4 * size, size - 1, size - 1);
            var row = Math.min(8, Math.floor(f * 9)); line(left - 4, 10 + row * size, left + 99, 10 + row * size, '#b5a2d5', true);
            label(T('preview.concavity'), 6, 128); label('N ↑', 8, 14);
        }
        function schedule() {
            if (!stopped && raf === null && !doc.hidden && !staticMode() && available().length) raf = root.requestAnimationFrame(tick);
        }
        function tick(now) {
            raf = null;
            if (stopped || doc.hidden || staticMode()) return;
            if (now - phaseAt >= PHASE_MS) { phase = (phase + 1) % 3; if (!phase) cursor++; phaseAt = now; renderText(); }
            if (now - lastFrame >= FRAME_MS) { paint(Math.min(1, (now - phaseAt) / 1500)); lastFrame = now; }
            schedule();
        }
        function refresh() {
            if (stopped) return;
            box.setAttribute('aria-label', T('preview.title'));
            box.querySelectorAll('[data-preview-key]').forEach(function(n) { n.textContent = T(n.dataset.previewKey); });
            stage.textContent = T(stageKey, stageVars); renderText(); paint(1);
        }
        function visibility() {
            if (raf !== null) { root.cancelAnimationFrame(raf); raf = null; }
            phaseAt = root.performance.now(); paint(1); schedule();
        }
        function stop() {
            if (stopped) return;
            stopped = true;
            if (raf !== null) root.cancelAnimationFrame(raf); raf = null;
            root.removeEventListener('resize', resize); root.removeEventListener('pagehide', stop);
            doc.removeEventListener('visibilitychange', visibility);
            doc.removeEventListener('detectlab:langchange', refresh);
            doc.removeEventListener('detectlab:hostchange', resize);
            if (reduce && reduce.removeEventListener) reduce.removeEventListener('change', visibility);
            samples.length = 0; box.remove();
            // Release the backing store, not just the DOM node.
            canvas.width = canvas.height = 0;
            if (options.onStop) options.onStop();
        }
        function update(event) {
            if (stopped) return;
            if (event.type === 'start') { total = event.total; limit = Math.min(LIMIT, event.limit); }
            else if (Number.isInteger(event.index) && event.index >= 0 && event.index < limit) {
                if (event.type === 'sample') samples[event.index] = Object.assign({}, event);
                else if (event.type === 'reference' && samples[event.index]) samples[event.index] = Object.assign({}, samples[event.index], event);
            }
            renderText(); paint(1); schedule();
        }
        root.addEventListener('resize', resize); root.addEventListener('pagehide', stop);
        doc.addEventListener('visibilitychange', visibility);
        doc.addEventListener('detectlab:langchange', refresh);
        // The panel can move this widget into a wider window (the run overlay);
        // it re-measures instead of drawing at the old width.
        doc.addEventListener('detectlab:hostchange', resize);
        if (reduce && reduce.addEventListener) reduce.addEventListener('change', visibility);
        renderText(); resize();
        return { update: update, stop: stop, setStage: function (key, vars) { if (!stopped) { stageKey = key; stageVars = vars; stage.textContent = T(key, vars); } } };
    }
    return { create: create, LIMIT: LIMIT };
});
