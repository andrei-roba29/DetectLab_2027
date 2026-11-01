/* iOS only opens the software keyboard for a direct user gesture. A delayed
 * focus can leave a field focused without a keyboard, making a later tap on
 * that same field unreliable. Let the user tap the field instead. */
(function () {
    'use strict';
    var nav = window.navigator || {};
    var ios = /iPad|iPhone|iPod/i.test(nav.userAgent || '') ||
        (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1);
    // In standalone WebKit a text field can retain DOM focus after the
    // software keyboard was dismissed (only the previous/next/Done accessory
    // remains). A second native tap on an ALREADY focused field then does
    // nothing. Re-arm it during that tap's trusted click; never synthesize a
    // click, prevent the tap, or change focus while the keyboard is open.
    // Keep the baseline from before editing: innerHeight can itself shrink
    // with the keyboard on some iOS versions.
    if (ios) {
        var idleHeight = 0;
        var wasFocusedOnPointerDown = null;
        function editable(el) {
            if (!el || el.nodeType !== 1 || el.disabled || el.readOnly) return false;
            if (el.tagName === 'TEXTAREA') return true;
            if (el.tagName !== 'INPUT') return false;
            return /^(text|search|email|password|tel|url|number)$/.test((el.type || 'text').toLowerCase());
        }
        function viewportHeight() {
            return window.visualViewport ? window.visualViewport.height : window.innerHeight;
        }
        function keyboardVisible() {
            return idleHeight > 0 && viewportHeight() < idleHeight - 120;
        }
        function recordIdleHeight() {
            if (!editable(document.activeElement)) {
                idleHeight = Math.max(idleHeight, viewportHeight() || 0);
            }
        }
        recordIdleHeight();
        window.addEventListener('resize', recordIdleHeight);
        if (window.visualViewport) window.visualViewport.addEventListener('resize', recordIdleHeight);
        document.addEventListener('pointerdown', function (e) {
            wasFocusedOnPointerDown = editable(e.target) && document.activeElement === e.target ? e.target : null;
        }, true);
        document.addEventListener('click', function (e) {
            var input = wasFocusedOnPointerDown;
            wasFocusedOnPointerDown = null;
            if (!input || e.target !== input || document.activeElement !== input || keyboardVisible()) return;
            input.blur();
            input.focus(); // still inside the real user gesture on iOS
        }, true);
        document.addEventListener('focusout', function () {
            // The keyboard may still be animating; don't mistake its reduced
            // visual viewport for a new idle baseline.
            setTimeout(recordIdleHeight, 350);
        }, true);
    }
    window.DetectLabInputFocus = {
        autoFocus: function (input, previousActive) {
            if (ios || !input || typeof input.focus !== 'function') return;
            // Do not steal focus from a field or button the user already chose
            // while an asynchronous dialog was loading.
            var active = document.activeElement;
            if (active && active !== document.body && active !== document.documentElement && active !== input && active !== previousActive) return;
            input.focus();
        }
    };
})();
