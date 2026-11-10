/*!
 * Full-screen run overlay for the APM Next-Gen engine.
 *
 * The animation sits in the middle of the screen, the page behind it is blurred,
 * and the loading bar sits directly under the animation. Two callers share it:
 * the APM Next-Gen panel (its TRAIN run) and the archaeological report (when the
 * report asks this engine to run its TRAIN / custom baseline).
 *
 * Pure DOM and CSS: no I/O, no timers, no map access, no state of its own beyond
 * the single open overlay. If the browser cannot blur, the scrim is opaque
 * instead of blurred — the animation and the bar stay exactly where they are.
 */
(function (root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DetectLabApmRunOverlay = api;
})(typeof window !== 'undefined' ? window : this, function (root) {
    'use strict';
    var current = null;

    function el(doc, tag, cls) {
        var n = doc.createElement(tag);
        if (cls) n.className = cls;
        return n;
    }

    function number(v) {
        var n = Number(v);
        if (!isFinite(n)) return 0;
        return Math.max(0, Math.min(100, Math.round(n)));
    }

    function isOpen() { return !!(current && current.el && current.el.parentNode); }

    function close() {
        if (!current) return;
        var c = current;
        current = null;
        // Hand borrowed nodes back to their owner: detached, never destroyed.
        if (c.animationHost && c.animationHost.parentNode) c.animationHost.parentNode.removeChild(c.animationHost);
        try { c.onClose && c.onClose(); } catch (ignore) {}
        if (c.el && c.el.parentNode) c.el.parentNode.removeChild(c.el);
    }

    /** opts: { t, titleKey, onCancel, onClose, animationHost } */
    function create(opts) {
        opts = opts || {};
        var doc = root.document;
        if (!doc || !doc.body) return null;
        var T = typeof opts.t === 'function' ? opts.t : function (k) { return k; };
        close();                                   // one overlay at a time

        var titleKey = opts.titleKey || 'run.overlayTitle';
        var box = el(doc, 'div', 'apm-run-overlay');
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-label', T(titleKey));
        box.setAttribute('data-run-overlay', titleKey);

        var card = el(doc, 'section', 'apm-run-card');
        box.appendChild(card);

        // 1. the animation
        var visual = el(doc, 'div', 'apm-run-visual');
        visual.setAttribute('aria-hidden', 'true');
        for (var i = 0; i < 3; i++) visual.appendChild(el(doc, 'span', 'apm-run-ring'));
        visual.appendChild(el(doc, 'span', 'apm-run-sweep'));
        visual.appendChild(el(doc, 'span', 'apm-run-core'));
        card.appendChild(visual);

        // An optional richer animation (the panel's real-site preview) replaces
        // the rings rather than sitting next to them.
        var live = el(doc, 'div', 'apm-run-live');
        card.appendChild(live);
        function setAnimation(node) {
            if (!node) return false;
            live.appendChild(node);
            visual.hidden = true;
            card.classList.add('is-live');
            if (current) current.animationHost = node;
            return true;
        }
        if (opts.animationHost) setAnimation(opts.animationHost);

        var title = el(doc, 'h3', 'apm-run-title');
        title.textContent = T(titleKey);
        title.dataset.runKey = titleKey;
        card.appendChild(title);

        var step = el(doc, 'div', 'apm-run-step');
        step.setAttribute('role', 'status');
        step.setAttribute('aria-live', 'polite');
        card.appendChild(step);

        // 2. the loading bar, directly under the animation
        var bar = el(doc, 'div', 'apm-run-bar');
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
        bar.setAttribute('aria-valuenow', '0');
        var fill = el(doc, 'div', 'apm-run-fill');
        bar.appendChild(fill);
        card.appendChild(bar);

        var meta = el(doc, 'div', 'apm-run-meta');
        var pct = el(doc, 'span', 'apm-run-pct');
        pct.textContent = '0%';
        meta.appendChild(pct);
        if (typeof opts.onCancel === 'function') {
            var cancel = el(doc, 'button', 'apm-btn apm-run-cancel');
            cancel.type = 'button';
            cancel.textContent = T('run.cancel');
            cancel.dataset.runKey = 'run.cancel';
            cancel.addEventListener('click', function () { opts.onCancel(); });
            meta.appendChild(cancel);
        }
        card.appendChild(meta);

        doc.body.appendChild(box);
        current = { el: box, onClose: opts.onClose, animationHost: opts.animationHost || null };

        return {
            el: box,
            // Mount a richer animation (the panel's real-site preview) only once
            // the caller knows it really started: a failed widget leaves the
            // rings in place instead of an empty card.
            setAnimation: setAnimation,
            update: function (state) {
                state = state || {};
                var v = number(state.pct);
                fill.style.width = v + '%';
                bar.setAttribute('aria-valuenow', String(v));
                pct.textContent = v + '%';
                var label = state.label == null ? '' : String(state.label);
                if (label && label !== step.textContent) step.textContent = label;
                if (label) bar.setAttribute('aria-valuetext', label);
            },
            close: close,
            isOpen: isOpen
        };
    }

    return { create: create, close: close, isOpen: isOpen };
});
