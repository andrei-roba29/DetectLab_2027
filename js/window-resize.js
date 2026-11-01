/* Shared vertical resize grip for map windows and application dialogs. */
(function () {
    'use strict';

    // Target the visible window, not its backdrop or map-sized positioning host.
    // The layers window (.transp-panel / #transpPanel) is deliberately absent:
    // it is anchored top→bottom of the map frame and gets no resize grip.
    // Login/register, account management, Friends and Events also stay grip-free.
    var selector = [
        '#iosBldSettingsPanel', '#iosfreeModalInner',
        '.country-dock-panel', '.hist-shift-panel', '.om-panel',
        '.offline-map-panel', '.offline-library', '.apm-panel', '#rvt-body',
        '#map3d-focus .m3d-focus-card', '.om-modal-card', '.layer-info-box',
        '.ios-modal-card', '.babel-dialog', '.premium-box',
        '.terms-box', '.nearby-dialog',
        '#weatherPanel', '.site-alert-box', '.pwa-help-card', '.dl-tut-card',
        '.fr-chat-panel', '.fr-modal-box',
        '#eventChatModal > div',
        '#createEventModal > div', '#inquiryModal > div',
        '#manageEventModal > div', '#eventNotifModal > div'
    ].join(',');
    var active = null;
    var MIN_HEIGHT = 96;

    function bounds(panel) {
        var viewport = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        var max = Math.max(MIN_HEIGHT, (viewport || document.documentElement.clientHeight || 600) - 16);
        var frame = panel.closest('.map-frame');
        if (frame) {
            var frameHeight = frame.getBoundingClientRect().height;
            if (frameHeight > 0) max = Math.min(max, Math.max(MIN_HEIGHT, frameHeight - 16));
        }
        return { min: Math.min(MIN_HEIGHT, max), max: max };
    }

    function applyHeight(panel, handle, value) {
        var limit = bounds(panel);
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
            var limit = bounds(panel);
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
        window.addEventListener('resize', function () {
            document.querySelectorAll('.dl-window-resized').forEach(function (panel) {
                var handle = panel.querySelector(':scope > .dl-window-resize-handle');
                if (handle) applyHeight(panel, handle, parseFloat(panel.style.height) || panel.getBoundingClientRect().height);
            });
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
