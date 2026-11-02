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
        var lastHeight = 0;
        var lastWidth = 0;
        var settleTimer = null;
        var closingKeyboard = false;
        var nativeEditing = false;
        function markEditing(value) {
            nativeEditing = value;
            document.documentElement.classList.toggle('dl-ios-editing', value);
            document.body.classList.toggle('dl-ios-editing', value);
        }
        function sizeMap() {
            if (editing()) {
                markEditing(true);
                return; // keyboard/viewport animation is not rotation
            }
            if (closingKeyboard) return;
            var height = Math.round(window.innerHeight || 0);
            var width = Math.round(window.innerWidth || 0);
            var viewport = window.visualViewport;
            // A blur can precede the keyboard's closing animation. Never save
            // that transient short viewport as the map's new full-screen size.
            // A width change, unlike keyboard animation, is a real rotation.
            var rotated = lastWidth && width && width !== lastWidth;
            var visibleHeight = viewport && viewport.height > 0 ? viewport.height : height;
            if (nativeEditing && !rotated && lastHeight && visibleHeight < lastHeight - 120) return;
            if (height <= 0) return;
            markEditing(false);
            if (height !== lastHeight || width !== lastWidth) {
                lastHeight = height;
                lastWidth = width;
                var root = document.documentElement;
                root.style.setProperty('--dl-ios-screen-h', height + 'px');
                root.style.setProperty('--pwa-viewport-h', height + 'px');
                root.style.setProperty('--pwa-bleed', '0px');
                window.dispatchEvent(new Event('dl:ios-map-resized'));
            }
            // WebKit can retain a document scroll offset after it scrolled a
            // native field above the keyboard. Do not let that offset expose
            // the page background below the map. Never scroll a focused field.
            if (window.scrollX || window.scrollY || (viewport && viewport.offsetTop)) {
                window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
            }
        }
        function scheduleSize(delay) {
            clearTimeout(settleTimer);
            settleTimer = setTimeout(function () {
                closingKeyboard = false;
                sizeMap();
            }, delay);
        }
        sizeMap();
        window.addEventListener('resize', function () { scheduleSize(closingKeyboard ? 700 : 120); });
        window.addEventListener('orientationchange', function () {
            // The old orientation's innerHeight can persist for one task.
            scheduleSize(closingKeyboard ? 700 : 300);
        });
        window.addEventListener('pageshow', function () { scheduleSize(300); });
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', function () { scheduleSize(closingKeyboard ? 700 : 120); });
            window.visualViewport.addEventListener('scroll', function () { scheduleSize(closingKeyboard ? 700 : 120); });
        }
        document.addEventListener('focusin', function () {
            if (!editing()) return;
            clearTimeout(settleTimer);
            closingKeyboard = false;
            markEditing(true);
        }, true);
        document.addEventListener('focusout', function () {
            if (!nativeEditing) return;
            // Keep native document scrolling until the keyboard has actually
            // settled. Switching between fields must not lock the next field.
            closingKeyboard = true;
            scheduleSize(700);
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
