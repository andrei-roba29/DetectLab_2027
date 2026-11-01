/* Google OAuth for an installed app: the app owns the PKCE verifier and session.
   The external window only returns a one-time authorization code. */
(function () {
    'use strict';
    var attempt = null;
    var lifetime = 10 * 60 * 1000;

    function isStandalone() {
        return window.navigator.standalone === true || !!(window.matchMedia &&
            (window.matchMedia('(display-mode: standalone)').matches ||
             window.matchMedia('(display-mode: fullscreen)').matches ||
             window.matchMedia('(display-mode: minimal-ui)').matches));
    }
    function help(show) {
        var el = document.getElementById('googlePopupHelp');
        if (el) el.hidden = !show;
        var input = document.getElementById('googlePopupCode');
        if (input) input.value = '';
    }
    function stop(a, close) {
        if (attempt !== a) return;
        attempt = null;
        clearTimeout(a.timer);
        window.removeEventListener('message', a.listener);
        help(false);
        if (close && a.popup) { try { a.popup.close(); } catch (_) {} }
    }
    async function finish(a, code) {
        if (attempt !== a || a.busy) return;
        if (Date.now() >= a.expires) {
            stop(a, true);
            a.message('Google sign-in expired. Please try again.');
            return;
        }
        if (typeof code !== 'string' || !code.trim() || code.length > 2048) {
            a.message('Enter the one-time code from the Google sign-in window.');
            return;
        }
        a.busy = true;
        a.message('Completing Google sign-in…', 'success');
        try {
            var result = await a.client.auth.exchangeCodeForSession(code.trim());
            if (attempt !== a) return;
            if (result.error || !result.data || !result.data.session) throw new Error('Exchange failed');
            var session = result.data.session;
            // setSession installs the session in the normal app client, which emits
            // the same SIGNED_IN event used by password login and persists it there.
            var installed = await window.supabaseClient.auth.setSession({
                access_token: session.access_token, refresh_token: session.refresh_token
            });
            if (attempt !== a) return;
            if (installed.error || !installed.data || !installed.data.session) throw new Error('Session failed');
            stop(a, true);
            a.success();
        } catch (_) {
            if (attempt !== a) return;
            stop(a, true);
            a.message('Google sign-in could not be completed. Please try again or use email and password.');
        }
    }
    function cancel() {
        if (!attempt) return;
        var a = attempt;
        if (a.busy) { a.message('Finishing sign-in. Please wait.', 'success'); return; }
        stop(a, true);
        a.message('Google sign-in cancelled.');
    }
    async function start(message, success) {
        if (attempt) {
            message('A Google sign-in is already in progress. Complete or cancel it first.');
            return;
        }
        if (!window.crypto || !window.crypto.getRandomValues || !window.crypto.subtle ||
            !window.crypto.subtle.digest || !window.createGooglePopupClient) {
            message('Google sign-in is unavailable here. Please use email and password.');
            return;
        }
        var bytes = new Uint8Array(16);
        try { window.crypto.getRandomValues(bytes); } catch (_) {
            message('Google sign-in is unavailable here. Please use email and password.');
            return;
        }
        var nonce = Array.prototype.map.call(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
        // Must happen synchronously in the user's click, before any await.
        var popup;
        try { popup = window.open('about:blank', '_blank'); } catch (_) { popup = null; }
        if (!popup) {
            message('The sign-in window was blocked. Allow pop-ups and try again, or use email and password.');
            return;
        }
        var a = { popup: popup, nonce: nonce, message: message, success: success,
            expires: Date.now() + lifetime, busy: false };
        attempt = a;
        a.listener = function (event) {
            var data = event.data;
            if (attempt !== a || event.origin !== window.location.origin || event.source !== popup ||
                !data || data.type !== 'detectlab-google-callback' || data.nonce !== nonce) return;
            try { popup.postMessage({ type: 'detectlab-google-ack', nonce: nonce }, window.location.origin); } catch (_) {}
            if (data.error) {
                stop(a, true);
                message('Google sign-in was cancelled or failed. Please try again.');
            } else {
                finish(a, data.code);
            }
        };
        window.addEventListener('message', a.listener);
        a.timer = setTimeout(function () {
            if (attempt === a && !a.busy) { stop(a, true); message('Google sign-in expired. Please try again.'); }
        }, lifetime);
        help(true);
        message('Continue in the Google window, then return to the installed app.', 'success');
        try {
            a.client = window.createGooglePopupClient();
            var callback = window.location.origin + '/google-auth-callback.html?nonce=' + nonce;
            var result = await a.client.auth.signInWithOAuth({ provider: 'google', options: {
                redirectTo: callback, skipBrowserRedirect: true,
                queryParams: { access_type: 'offline', prompt: 'consent' }
            }});
            if (attempt !== a) return;
            if (result.error || !result.data || !result.data.url) throw new Error('OAuth start failed');
            // Never allow the SDK's insecure plain-PKCE fallback: the code may
            // be copied by the user and must remain bound to a secret verifier.
            var authorize = new URL(result.data.url);
            if (authorize.searchParams.get('code_challenge_method') !== 's256' ||
                !authorize.searchParams.get('code_challenge')) throw new Error('PKCE unavailable');
            popup.location.replace(result.data.url);
        } catch (_) {
            if (attempt !== a) return;
            stop(a, true);
            message('Could not open Google sign-in. Please try again or use email and password.');
        }
    }
    window.finishGooglePopupCode = function () {
        var input = document.getElementById('googlePopupCode');
        if (attempt) finish(attempt, input ? input.value : '');
    };
    window.cancelGooglePopup = cancel;
    window.DetectLabGooglePopup = { isStandalone: isStandalone, start: start };
})();
