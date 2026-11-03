/* Shared vertical resize grip for map windows and application dialogs. */
(function () {
    'use strict';

    // Target the visible window, not its backdrop or map-sized positioning host.
    // The layers window (.transp-panel / #transpPanel) is deliberately absent:
    // it is anchored top→bottom of the map frame and gets no resize grip.
    // Login/register, account management, Friends, friend chats, Events and tutorial slides
    // also stay grip-free.
    var selector = [
        '#iosBldSettingsPanel', '#iosfreeModalInner',
        '.country-dock-panel', '.hist-shift-panel', '.om-panel',
        '.offline-map-panel', '.offline-library', '.apm-panel', '.arch-report-panel', '#rvt-body',
        '#map3d-focus .m3d-focus-card', '.om-modal-card', '.layer-info-box',
        '.ios-modal-card', '.babel-dialog', '.premium-box',
        '.terms-box', '.nearby-dialog',
        '#weatherPanel', '.site-alert-box', '.pwa-help-card',
        '.fr-modal-box',
        '#eventChatModal > div',
        '#createEventModal > div', '#inquiryModal > div',
        '#manageEventModal > div', '#eventNotifModal > div'
    ].join(',');
    var active = null;
    var MIN_HEIGHT = 96;
    var TOP_GUARD = 16;

    /* The "© Leafleet" tag sits 4px + --pwa-bleed above the map container's
       bottom edge in the installed app (index.html). A resized window keeps a
       little air above that line, plus the device's bottom safe-area inset.
       The floor is applied by a CSS class so no inline `bottom` is touched;
       see the old blanket `bottom:0` rule this replaces in css/window-resize.css. */
    var PWA_BOTTOM_FLOOR = 'calc(12px + var(--pwa-bleed, 0px) + env(safe-area-inset-bottom, 0px))';
    var floorProbe = null;

    function isPwa() {
        return !!(document.body && document.body.classList.contains('is-pwa'));
    }

    /* Ask CSS to resolve var()/env() for us. The probe is invisible, has no
       children and is reused; jsdom / old engines fall back to a plain
       12px + --pwa-bleed measurement. */
    function pwaFloor() {
        if (!isPwa()) return 0;
        if (!floorProbe || !floorProbe.isConnected) {
            floorProbe = document.createElement('div');
            floorProbe.setAttribute('aria-hidden', 'true');
            floorProbe.className = 'dl-window-resize-safe-probe';
            floorProbe.style.cssText = 'position:absolute;left:0;top:0;width:0;visibility:hidden;pointer-events:none;box-sizing:border-box;';
            floorProbe.style.setProperty('height', PWA_BOTTOM_FLOOR, 'important');
            document.body.appendChild(floorProbe);
        }
        var measured = floorProbe.getBoundingClientRect().height;
        if (measured > 0) return measured;
        var bleed = parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--pwa-bleed')) || 0;
        return 12 + Math.max(0, bleed);
    }

    /* A vertical translate (top:50% + translateY(-50%)) keeps the window
       centred as its height changes, so its `top` is not a fixed anchor. */
    function hasVerticalShift(cs) {
        var matrix = /matrix(3d)?\(([^)]+)\)/.exec(cs.transform || '');
        if (matrix) {
            var parts = matrix[2].split(',').map(function (v) { return parseFloat(v); });
            var ty = matrix[1] ? parts[13] : parts[5];
            if (Math.abs(ty || 0) > 0.5) return true;
        }
        var translate = (cs.translate || '').trim();
        if (translate && translate !== 'none') {
            var bits = translate.split(/\s+/);
            if (bits.length > 1 && Math.abs(parseFloat(bits[1]) || 0) > 0.5) return true;
        }
        return false;
    }

    /* Read the geometry the window's OWN stylesheet gave it, before any of our
       resize classes are applied. A `bottom` of `auto` means the window is
       top-anchored or flows inside a flex dialog: no bottom clearance to keep. */
    function readAnchor(panel) {
        var cs = window.getComputedStyle(panel);
        var positioned = cs.position === 'absolute' || cs.position === 'fixed';
        var bottomValue = parseFloat(cs.bottom);
        var hasBottom = positioned && isFinite(bottomValue) && (cs.bottom || '').indexOf('%') === -1;
        var topValue = parseFloat(cs.top);
        var hasTop = positioned && isFinite(topValue) && cs.top !== 'auto';
        // A plain px `top` is an anchor too: the window may not grow past the
        // bottom edge. Percentage / transform-centred tops (top:50% +
        // translateY(-50%)) stay centred as the height changes, so they are
        // deliberately left out of this clamp.
        var topPx = hasTop && !hasVerticalShift(cs) && (cs.top || '').indexOf('%') === -1
            ? Math.max(0, topValue) : 0;
        return {
            positioned: positioned,
            edges: hasTop && hasBottom,
            bottom: hasBottom ? Math.max(0, bottomValue) : null,
            top: topPx
        };
    }

    /* Only a window stretched between BOTH edges (top AND bottom defined, e.g.
       an inset:0 chat panel) needs `top` released for the explicit height to
       take effect. The decision is cached: after the release, computed `top`
       reads `auto`, so re-deciding on every pointermove would oscillate. */
    function releaseTop(panel, anchor) {
        if (!panel.dataset.dlResizeAnchor) {
            panel.dataset.dlResizeAnchor = anchor.edges ? 'edges' : (anchor.bottom === null ? 'top' : 'bottom');
        }
        return panel.dataset.dlResizeAnchor === 'edges';
    }

    /* The floor is applied by a class (css/window-resize.css), never by an
       inline `bottom`: several components position their window with an inline
       offset and that value must survive every drag unchanged. Removing the
       class before reading the geometry also keeps the comparison stable
       across pointermove events (no lift → no lift oscillation). */
    function clearBottomGuard(panel) {
        panel.classList.remove('dl-window-bottom-safe');
    }

    function bounds(panel, geometry) {
        geometry = geometry || {};
        var viewport = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        viewport = viewport || document.documentElement.clientHeight || 600;
        var frame = panel.closest('.map-frame');
        var frameHeight = frame ? frame.getBoundingClientRect().height : 0;
        // `bottom` is measured from the containing block's bottom edge. In a
        // PWA that block is the map frame, whose height is --pwa-viewport-h
        // (the visible viewport PLUS --pwa-bleed).
        var blockHeight = frameHeight > 0 ? frameHeight : viewport;
        var clearance = Math.max(0, geometry.bottom || 0);
        // On desktop APM mirrors LiDAR's flex card. Its 16px bottom inset is
        // host padding rather than an absolute anchor, so use the same resize
        // bounds as that card while leaving PWA/mobile anchors unchanged.
        var topOffset = Math.max(0, geometry.top || 0);
        if (panel.id === 'apmNextPanel' && !isPwa() &&
            window.matchMedia('(min-width: 721px)').matches) {
            clearance = 0;
            topOffset = 0; // computed `top: auto` can resolve to a pixel position
        }
        var max = Math.max(MIN_HEIGHT, viewport - TOP_GUARD);
        if (frameHeight > 0) {
            max = Math.min(max, Math.max(MIN_HEIGHT, frameHeight - TOP_GUARD));
        }
        // Growing a bottom-anchored window must push its TOP up, never push its
        // BOTTOM down into the safe-area padding / under the © Leafleet tag.
        // Keep both its designed bottom clearance and a small top margin free.
        max = Math.min(max, Math.max(MIN_HEIGHT, blockHeight - clearance - TOP_GUARD));
        // A window anchored at a fixed px `top` grows downwards: cap it before
        // it can reach the bottom padding.
        if (topOffset > 0) {
            max = Math.min(max, Math.max(MIN_HEIGHT, blockHeight - topOffset - TOP_GUARD));
        }
        return { min: Math.min(MIN_HEIGHT, max), max: max };
    }

    function applyHeight(panel, handle, value) {
        // Always re-read the live CSS geometry: --pwa-bleed and the safe-area
        // insets change on rotation / when the OS settles the standalone shell.
        clearBottomGuard(panel);
        var anchor = readAnchor(panel);
        var stretched = releaseTop(panel, anchor);
        var floor = pwaFloor();
        var bottom = anchor.bottom === null ? 0 : anchor.bottom;
        // PWA safety net for EVERY draggable window: a bottom-anchored window
        // whose own clearance is smaller than the © Leafleet line is lifted to
        // that line. Stretched (top+bottom) overlays are excluded — they cover
        // the screen on purpose and carry their own safe-area padding.
        var lift = floor > 0 && anchor.positioned && !stretched &&
            anchor.bottom !== null && bottom < floor;
        if (lift) {
            panel.classList.add('dl-window-bottom-safe');
            bottom = floor;
        }

        var limit = bounds(panel, { bottom: bottom, top: anchor.top });
        var height = Math.round(Math.max(limit.min, Math.min(limit.max, value)));
        var oldHeight = panel.getBoundingClientRect().height;
        var parentStyle = panel.parentElement && window.getComputedStyle(panel.parentElement);
        // A centred flex dialog normally shrinks around its centre. Offset it
        // by half the change so its bottom stays put while the top is dragged.
        if (oldHeight && parentStyle && parentStyle.display === 'flex' &&
            parentStyle.alignItems === 'center' && parentStyle.flexDirection !== 'column') {
            var shift = parseFloat(panel.style.getPropertyValue('--dl-resize-shift')) || 0;
            panel.style.setProperty('--dl-resize-shift', (shift + (oldHeight - height) / 2) + 'px');
            panel.classList.add('dl-window-resize-centered');
        }
        panel.classList.add('dl-window-resized');
        if (stretched) panel.classList.add('dl-window-release-top');
        panel.classList.toggle('dl-window-compact', height < 260);
        panel.style.setProperty('height', height + 'px', 'important');
        panel.style.setProperty('min-height', '0', 'important');
        panel.style.setProperty('max-height', limit.max + 'px', 'important');
        handle.setAttribute('aria-valuemin', String(limit.min));
        handle.setAttribute('aria-valuemax', String(Math.round(limit.max)));
        handle.setAttribute('aria-valuenow', String(height));
    }

    function start(event, panel, handle) {
        if (event.button !== undefined && event.button !== 0) return;
        var height = panel.getBoundingClientRect().height;
        if (!height) return;
        event.preventDefault();
        event.stopPropagation();
        active = { panel: panel, handle: handle, pointerId: event.pointerId, y: event.clientY, height: height };
        if (handle.setPointerCapture) {
            try { handle.setPointerCapture(event.pointerId); } catch (_) { /* detached or unsupported */ }
        }
    }

    function move(event) {
        if (!active || event.pointerId !== active.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        applyHeight(active.panel, active.handle, active.height + active.y - event.clientY);
    }
    function end(event) {
        if (!active || event.pointerId !== active.pointerId) return;
        event.stopPropagation();
        active = null;
    }
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', function () { active = null; });

    function attach(panel) {
        var existing = panel.querySelector(':scope > .dl-window-resize-handle');
        // A panel can be re-rendered with innerHTML; restore its grip if needed.
        if (existing) return;
        var handle = document.createElement('div');
        handle.className = 'dl-window-resize-handle';
        // Put the grip on the outer top edge even when the card has padding.
        var inset = parseFloat(window.getComputedStyle(panel).paddingTop) || 0;
        handle.style.setProperty('--dl-window-top-inset', inset + 'px');
        handle.tabIndex = 0;
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'horizontal');
        var initialLimits = bounds(panel);
        handle.setAttribute('aria-valuemin', String(initialLimits.min));
        handle.setAttribute('aria-valuemax', String(Math.round(initialLimits.max)));
        handle.setAttribute('aria-valuenow', String(Math.round(panel.getBoundingClientRect().height || initialLimits.min)));
        handle.addEventListener('focus', function () {
            var height = panel.getBoundingClientRect().height;
            if (height) handle.setAttribute('aria-valuenow', String(Math.round(height)));
        });
        handle.addEventListener('lostpointercapture', function (e) {
            if (active && active.pointerId === e.pointerId) active = null;
        });
        var ro = (typeof window._currentLang === 'function' ? window._currentLang() : document.documentElement.lang) === 'ro';
        var label = ro ? 'Redimensionează fereastra pe verticală' : 'Resize window vertically';
        handle.setAttribute('aria-label', label);
        handle.title = ro ? 'Trage în sus sau în jos pentru redimensionare' : 'Drag up or down to resize';
        handle.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        handle.addEventListener('pointerdown', function (e) { start(e, panel, handle); });
        handle.addEventListener('keydown', function (e) {
            var height = panel.getBoundingClientRect().height;
            var limit = bounds(panel, readAnchor(panel));
            var value;
            if (e.key === 'ArrowUp') value = height + (e.shiftKey ? 48 : 16);
            else if (e.key === 'ArrowDown') value = height - (e.shiftKey ? 48 : 16);
            else if (e.key === 'Home') value = limit.min;
            else if (e.key === 'End') value = limit.max;
            else return;
            e.preventDefault(); e.stopPropagation();
            applyHeight(panel, handle, value);
        });
        panel.insertBefore(handle, panel.firstChild);
    }

    function scan(node) {
        if (node.nodeType !== 1) return;
        if (node.matches(selector)) attach(node);
        // Most mutations are map tiles or text: avoid querying leaf nodes.
        if (node.firstElementChild) node.querySelectorAll(selector).forEach(attach);
    }
    function init() {
        document.querySelectorAll(selector).forEach(attach);
        var observer = new MutationObserver(function (records) {
            records.forEach(function (record) {
                if (record.target.nodeType === 1 && record.target.matches(selector)) attach(record.target);
                record.addedNodes.forEach(scan);
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
        // Rotation / orientationchange / the OS settling the standalone shell
        // change --pwa-bleed and the safe-area insets. Re-apply the height so
        // the clamp and the PWA floor are computed against the new geometry.
        function reflow() {
            document.querySelectorAll('.dl-window-resized').forEach(function (panel) {
                var handle = panel.querySelector(':scope > .dl-window-resize-handle');
                if (handle) applyHeight(panel, handle, parseFloat(panel.style.height) || panel.getBoundingClientRect().height);
            });
        }
        window.addEventListener('resize', reflow);
        window.addEventListener('orientationchange', reflow);
        if (window.visualViewport) window.visualViewport.addEventListener('resize', reflow);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
