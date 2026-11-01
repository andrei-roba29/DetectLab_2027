/* iOS only opens the software keyboard for a direct user gesture. A delayed
 * focus can leave a field focused without a keyboard, making a later tap on
 * that same field unreliable. Let the user tap the field instead. */
(function () {
    'use strict';
    var nav = window.navigator || {};
    var ios = /iPad|iPhone|iPod/i.test(nav.userAgent || '') ||
        (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1);
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
