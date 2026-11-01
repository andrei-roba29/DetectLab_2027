/* Temporary text-entry keyboard for installed iOS PWA WebKit, which on some
 * devices shows only the native Previous/Next/Done accessory bar. This does
 * not try to open or replace the OS keyboard. No typed text is stored here. */
(function () {
    'use strict';
    var nav = window.navigator || {};
    var ios = /iPad|iPhone|iPod/i.test(nav.userAgent || '') ||
        (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1);
    var installed = false;
    try {
        installed = nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    } catch (_) { installed = nav.standalone === true; }
    if (!ios || !installed) return;

    var field = null, keyboard = null, shift = false, symbols = false;
    function editable(el) {
        if (!el || el.nodeType !== 1 || el.disabled || el.readOnly) return false;
        if (el.tagName === 'TEXTAREA') return true;
        return el.tagName === 'INPUT' &&
            /^(text|search|email|password|tel|url|number)$/.test((el.type || 'text').toLowerCase());
    }
    function position() {
        if (!keyboard || keyboard.hidden) return;
        var vv = window.visualViewport;
        // The OS already reserves its own area below the visible viewport.
        // Move our keys into view, but do not add another spacer or subtract
        // the OS area from the app. A matching backdrop covers exposed map.
        var reserved = vv ? Math.max(0, Math.round((window.innerHeight || vv.height) - (vv.offsetTop || 0) - vv.height)) : 0;
        keyboard.style.bottom = reserved + 'px';
        keyboard.style.setProperty('--dl-os-reserved', reserved + 'px');
    }
    function inputEvent() {
        field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
    function replace(text, backspace) {
        if (!field || !field.isConnected) return;
        var start = field.selectionStart, end = field.selectionEnd;
        if (start == null || end == null) {
            field.value = backspace ? field.value.slice(0, -1) : field.value + text;
        } else {
            if (backspace && start === end) start = Math.max(0, start - 1);
            field.setRangeText(backspace ? '' : text, start, end, 'end');
        }
        inputEvent();
    }
    function press(key) {
        if (!field || !field.isConnected) return;
        if (key === '⇧') { shift = !shift; render(); return; }
        if (key === '123' || key === 'ABC') { symbols = !symbols; render(); return; }
        if (key === '⌫') { replace('', true); return; }
        if (key === 'Done') { field.blur(); return; }
        if (key === 'Enter') {
            var event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
            if (field.dispatchEvent(event) && field.tagName === 'TEXTAREA') replace('\n', false);
            return;
        }
        replace(key === 'Space' ? ' ' : shift ? key.toUpperCase() : key, false);
        if (shift) { shift = false; render(); }
    }
    function button(key, wide) {
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'dl-ios-key' + (wide ? ' dl-ios-key-wide' : '');
        el.textContent = key === 'Space' ? 'space' : key;
        el.setAttribute('aria-label', key === '⌫' ? 'Backspace' : key === '⇧' ? 'Shift' : key);
        var pointerAt = 0;
        el.addEventListener('pointerdown', function (e) {
            e.preventDefault(); // preserve caret; click can be suppressed on iOS
            pointerAt = Date.now();
            press(key);
        });
        el.addEventListener('click', function (e) {
            e.preventDefault();
            if (Date.now() - pointerAt > 500) press(key); // VoiceOver / keyboard activation
        });
        return el;
    }
    function render() {
        if (!keyboard) return;
        while (keyboard.firstChild) keyboard.removeChild(keyboard.firstChild);
        var header = document.createElement('div');
        header.className = 'dl-ios-key-row dl-ios-key-header';
        var title = document.createElement('span');
        title.textContent = 'Tastatură';
        header.appendChild(title);
        header.appendChild(button('Done'));
        keyboard.appendChild(header);
        var lines = symbols ? ['1234567890', '@#$%&*-+()', '⇧.,?!:/_⌫'] :
            ['qwertyuiop', 'asdfghjkl', '⇧zxcvbnm⌫'];
        lines.forEach(function (line) {
            var row = document.createElement('div');
            row.className = 'dl-ios-key-row';
            Array.from(line).forEach(function (key) {
                row.appendChild(button(shift ? key.toUpperCase() : key));
            });
            keyboard.appendChild(row);
        });
        var bottom = document.createElement('div');
        bottom.className = 'dl-ios-key-row';
        bottom.appendChild(button(symbols ? 'ABC' : '123'));
        bottom.appendChild(button('Space', true));
        bottom.appendChild(button('Enter'));
        keyboard.appendChild(bottom);
    }
    function show(el) {
        field = el;
        if (!keyboard) {
            keyboard = document.createElement('div');
            keyboard.id = 'dlIosKeyboard';
            keyboard.setAttribute('role', 'group');
            keyboard.setAttribute('aria-label', 'Tastatură pe ecran');
            document.body.appendChild(keyboard);
        }
        render();
        keyboard.hidden = false;
        document.body.style.setProperty('--dl-ios-keys-height', keyboard.offsetHeight + 'px');
        position();
    }
    document.addEventListener('focusin', function (e) {
        if (editable(e.target)) show(e.target);
    }, true);
    document.addEventListener('focusout', function (e) {
        if (e.target !== field) return;
        setTimeout(function () {
            if (editable(document.activeElement)) { show(document.activeElement); return; }
            field = null;
            if (keyboard) keyboard.hidden = true;
            document.body.style.removeProperty('--dl-ios-keys-height');
        }, 0);
    }, true);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', position);
        window.visualViewport.addEventListener('scroll', position);
    }
    window.addEventListener('resize', position);
})();
