/* iOS WebKit sometimes leaves an editable field focused in the installed PWA
 * with only the Previous / Next / Done accessory bar and no software keys.
 * Focus tricks cannot force the OS keyboard open. If the visual viewport has
 * not shrunk after a real tap, offer a local, on-page keyboard as a fallback.
 * It does not store or transmit the contents of the field. */
(function () {
    'use strict';
    var nav = window.navigator || {};
    var ios = /iPad|iPhone|iPod/i.test(nav.userAgent || '') ||
        (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1);

    function editable(el) {
        if (!el || el.nodeType !== 1 || el.disabled || el.readOnly) return false;
        if (el.tagName === 'TEXTAREA') return true;
        return el.tagName === 'INPUT' &&
            /^(text|search|email|password|tel|url|number)$/.test((el.type || 'text').toLowerCase());
    }

    function isInstalled() {
        try {
            return nav.standalone === true ||
                window.matchMedia('(display-mode: standalone)').matches ||
                /[?&]pwa=1(?:&|$)/.test(window.location.search);
        } catch (_) { return nav.standalone === true; }
    }

    if (ios && isInstalled()) {
        var idleHeight = 0;
        var focusedField = null;
        var pending = null;
        var keyboard = null;
        var toggle = null;
        var manual = false;
        var upper = false;
        var symbols = false;
        var rows = [
            ['qwertyuiop', 'asdfghjkl', '⇧zxcvbnm⌫'],
            ['1234567890', '@#$%&*-+()', '⇧.,?!:/_⌫']
        ];
        function viewportHeight() {
            return (window.visualViewport && window.visualViewport.height) || window.innerHeight || 0;
        }
        function nativeKeyboardVisible() {
            return idleHeight > 0 && viewportHeight() < idleHeight - 120;
        }
        function saveIdleHeight() {
            if (!editable(document.activeElement)) {
                // Replace, rather than max: a rotated phone has a shorter
                // legitimate idle viewport in landscape.
                idleHeight = viewportHeight();
            }
        }
        function hide() {
            clearTimeout(pending);
            if (keyboard) keyboard.hidden = true;
            document.body.style.removeProperty('--dl-keyboard-bottom');
            document.documentElement.classList.remove('dl-fallback-typing');
            document.body.classList.remove('dl-fallback-typing');
        }
        function showToggle() {
            if (!toggle) {
                toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.id = 'dlKeyboardToggle';
                toggle.textContent = '⌨ Tastatură';
                toggle.setAttribute('aria-label', 'Arată tastatura pe ecran');
                var togglePointerAt = 0;
                function toggleKeyboard() {
                    manual = true;
                    if (keyboard && !keyboard.hidden) hide();
                    else show(true);
                }
                toggle.addEventListener('pointerdown', function (e) {
                    e.preventDefault(); // do not blur the current input
                    togglePointerAt = Date.now();
                    toggleKeyboard();
                });
                toggle.addEventListener('click', function (e) {
                    e.preventDefault();
                    if (Date.now() - togglePointerAt < 500) return;
                    toggleKeyboard(); // accessibility / browsers without Pointer Events
                });
                document.body.appendChild(toggle);
            }
            toggle.hidden = false;
        }
        function insert(text) {
            var field = focusedField;
            if (!field || !field.isConnected) return;
            var start = field.selectionStart, end = field.selectionEnd;
            if (start == null || end == null) {
                field.value += text;
            } else {
                field.setRangeText(text, start, end, 'end');
            }
            field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        }
        function press(key) {
            var field = focusedField;
            if (!field || !field.isConnected) return;
            if (key === '⇧') { upper = !upper; renderKeys(); return; }
            if (key === '123' || key === 'ABC') { symbols = !symbols; renderKeys(); return; }
            if (key === '⌫') {
                var start = field.selectionStart, end = field.selectionEnd;
                if (start == null || end == null) {
                    field.value = field.value.slice(0, -1);
                } else {
                    if (start === end) start = Math.max(0, start - 1);
                    field.setRangeText('', start, end, 'end');
                }
                field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                return;
            }
            if (key === 'Done') { hide(); field.blur(); return; }
            if (key === 'Enter') {
                var event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
                if (field.dispatchEvent(event) && field.tagName === 'TEXTAREA') insert('\n');
                return;
            }
            insert(key === 'Space' ? ' ' : (upper ? key.toUpperCase() : key));
            if (upper) { upper = false; renderKeys(); }
        }
        function makeKey(label, wide) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'dl-fallback-key' + (wide ? ' dl-fallback-wide' : '');
            button.textContent = label === 'Space' ? 'space' : label;
            button.setAttribute('aria-label', label === '⌫' ? 'Backspace' : label === '⇧' ? 'Shift' : label);
            // Keep the caret / selection in the input. No preventDefault on
            // the input's own touchstart, so native focus remains possible.
            var pointerAt = 0;
            button.addEventListener('pointerdown', function (e) {
                e.preventDefault(); // keep selection; some iOS versions suppress click
                pointerAt = Date.now();
                press(label);
            });
            button.addEventListener('click', function (e) {
                e.preventDefault();
                if (Date.now() - pointerAt >= 500) press(label);
            });
            return button;
        }
        function renderKeys() {
            if (!keyboard) return;
            while (keyboard.firstChild) keyboard.removeChild(keyboard.firstChild);
            var header = document.createElement('div');
            header.className = 'dl-fallback-header';
            var caption = document.createElement('span');
            caption.textContent = 'Keyboard';
            header.appendChild(caption);
            header.appendChild(makeKey('Done'));
            keyboard.appendChild(header);
            rows[symbols ? 1 : 0].forEach(function (line) {
                var row = document.createElement('div');
                row.className = 'dl-fallback-row';
                Array.from(line).forEach(function (key) {
                    row.appendChild(makeKey(upper ? key.toUpperCase() : key));
                });
                keyboard.appendChild(row);
            });
            var last = document.createElement('div');
            last.className = 'dl-fallback-row';
            last.appendChild(makeKey(symbols ? 'ABC' : '123'));
            last.appendChild(makeKey('Space', true));
            last.appendChild(makeKey('Enter'));
            keyboard.appendChild(last);
        }
        function show(force) {
            if (!focusedField || document.activeElement !== focusedField || (!force && nativeKeyboardVisible())) return;
            if (!keyboard) {
                keyboard = document.createElement('div');
                keyboard.id = 'dlFallbackKeyboard';
                keyboard.setAttribute('role', 'group');
                keyboard.setAttribute('aria-label', 'On-screen keyboard');
                document.body.appendChild(keyboard);
            }
            renderKeys();
            // A standalone PWA may keep the layout viewport at full height
            // while its visual viewport stops above an empty native keyboard
            // area. Place the fallback in the VISIBLE part, not behind it.
            var view = window.visualViewport;
            var bottom = view ? Math.max(0, (window.innerHeight || view.height) - view.offsetTop - view.height) : 0;
            keyboard.style.bottom = bottom + 'px';
            document.body.style.setProperty('--dl-keyboard-bottom', bottom + 'px');
            keyboard.hidden = false;
            document.documentElement.classList.add('dl-fallback-typing');
            document.body.classList.add('dl-fallback-typing');
        }
        function schedule(field) {
            clearTimeout(pending);
            focusedField = field;
            showToggle();
            if (manual) return;
            if (nativeKeyboardVisible()) { hide(); return; }
            pending = setTimeout(show, 700); // allow the native animation first
        }
        saveIdleHeight();
        document.addEventListener('focusin', function (e) {
            if (editable(e.target)) schedule(e.target);
        }, true);
        document.addEventListener('focusout', function (e) {
            if (e.target !== focusedField) return;
            clearTimeout(pending);
            // Switching between fields must not flash the map between them.
            setTimeout(function () {
                if (editable(document.activeElement)) { schedule(document.activeElement); return; }
                focusedField = null;
                manual = false;
                hide();
                if (toggle) toggle.hidden = true;
                setTimeout(saveIdleHeight, 350);
            }, 0);
        }, true);
        document.addEventListener('pointerdown', function (e) {
            // Retapping a focused field after the OS dropped the keyboard also
            // opens the fallback (no blur/focus cycle that could fight WebKit).
            if (editable(e.target) && document.activeElement === e.target && !nativeKeyboardVisible()) {
                schedule(e.target);
            }
        }, true);
        function onResize() {
            if (manual) {
                if (keyboard && !keyboard.hidden) show(true); // track visual viewport
                return; // explicit fallback also covers a false native-size signal
            }
            if (nativeKeyboardVisible()) hide();
            else if (editable(document.activeElement)) schedule(document.activeElement);
            else saveIdleHeight();
        }
        window.addEventListener('resize', onResize);
        if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
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
