/* The iOS standalone WebKit keyboard is not a DOM element. Do not try to
 * focus it asynchronously, draw replacement keys, or change the map layout
 * during a tap. Unlike the desktop/Android PWA, the installed iOS app must
 * keep its map in document flow and use the layout viewport, not the physical
 * screen.height, so WebKit can present and scroll to native text controls. */
(function () {
    'use strict';
    var nav = window.navigator || {};
    var ios = /iPad|iPhone|iPod/i.test(nav.userAgent || '') ||
        (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1);
    var installed = false;
    try {
        installed = nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    } catch (_) { installed = nav.standalone === true; }
    if (ios && installed) {
        document.documentElement.classList.add('dl-ios-native-layout');
        document.body.classList.add('dl-ios-native-layout');
        function editing() {
            var el = document.activeElement;
            if (!el || el.nodeType !== 1) return false;
            if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
            return el.tagName === 'INPUT' &&
                /^(text|search|email|password|tel|url|number|date|datetime-local|month|time|week)$/.test((el.type || 'text').toLowerCase());
        }
        function sizeMap() {
            if (editing()) return; // keyboard/viewport animation is not rotation
            var height = window.innerHeight;
            if (height > 0) {
                document.documentElement.style.setProperty('--dl-ios-screen-h', Math.round(height) + 'px');
                window.dispatchEvent(new Event('dl:ios-map-resized'));
            }
        }
        sizeMap();
        window.addEventListener('orientationchange', function () {
            // The old orientation's innerHeight can persist for one task.
            setTimeout(sizeMap, 300);
        });
        window.addEventListener('pageshow', sizeMap);
        document.addEventListener('focusout', function () {
            // A rotation made while typing was deliberately ignored; apply
            // its new viewport only once the native keyboard has settled.
            setTimeout(sizeMap, 700);
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
