/* Native iOS keyboard: don't replace it with DOM keys or retry focus. An
 * installed PWA locks the document for its full-screen map; WebKit must be
 * allowed to scroll the document when a real text control receives focus.
 * Unlock BEFORE the touch produces focus, keep the map geometry frozen while
 * editing, and restore the map shell only after the keyboard has closed. */
(function () {
    'use strict';
    var nav = window.navigator || {};
    var ios = /iPad|iPhone|iPod/i.test(nav.userAgent || '') ||
        (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1);
    function isInstalled() {
        try {
            return nav.standalone === true ||
                window.matchMedia('(display-mode: standalone)').matches ||
                /[?&]pwa=1(?:&|$)/.test(window.location.search);
        } catch (_) { return nav.standalone === true; }
    }
    if (ios && isInstalled()) {
        var restoreTimer;
        function editable(el) {
            if (!el || el.nodeType !== 1 || el.disabled || el.readOnly) return false;
            if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
            return el.tagName === 'INPUT' &&
                /^(text|search|email|password|tel|url|number|date|datetime-local|month|time|week)$/.test((el.type || 'text').toLowerCase());
        }
        function unlock() {
            clearTimeout(restoreTimer);
            document.documentElement.classList.add('dl-native-typing');
            document.body.classList.add('dl-native-typing');
        }
        function restore() {
            if (editable(document.activeElement)) return; // moving between fields
            document.documentElement.classList.remove('dl-native-typing');
            document.body.classList.remove('dl-native-typing');
            // The PWA map fit skipped keyboard resizes; measure it once the
            // original scroll/position rules have been restored.
            window.dispatchEvent(new Event('dl:input-session-end'));
        }
        // Capture the very first touch, before WebKit decides whether it can
        // present its native keyboard. Do not cancel the touch or focus event.
        document.addEventListener('touchstart', function (e) {
            if (editable(e.target)) unlock();
        }, { capture: true, passive: true });
        document.addEventListener('focusin', function (e) {
            if (editable(e.target)) unlock();
        }, true);
        document.addEventListener('focusout', function (e) {
            if (!editable(e.target)) return;
            clearTimeout(restoreTimer);
            restoreTimer = setTimeout(restore, 650);
        }, true);
    }
    window.DetectLabInputFocus = {
        autoFocus: function (input, previousActive) {
            if (ios || !input || typeof input.focus !== 'function') return;
            var active = document.activeElement;
            if (active && active !== document.body && active !== document.documentElement &&
                active !== input && active !== previousActive) return;
            input.focus();
        }
    };
})();
