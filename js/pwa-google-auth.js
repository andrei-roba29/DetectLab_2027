/* Google OAuth for an installed app: the app owns the PKCE verifier and the
   session. The external window never shows a code to the user and the login
   form never asks for one.

   The one-time authorization code comes back on the first path that works:

     1. postMessage from the callback window, when the OS kept the opener;
     2. the same-origin handoff record the callback window writes when the
        opener was severed (iOS standalone, Android Custom Tab). The app reads
        it as soon as it is back in front, or on the storage event.

   If neither path arrives before the attempt expires, the form simply says
   "try again" — there is nothing to copy or paste. */
(function () {
    'use strict';
    var attempt = null;
    var lifetime = 10 * 60 * 1000;
    // A tap on "Continue with Google" only replaces a pending attempt once the
    // old one has clearly been abandoned, so a slow consent screen is safe.
    var replaceAfter = 120 * 1000;
    // Must match HANDOFF_KEY in google-auth-callback.html.
    var HANDOFF_KEY = 'detectlab-google-handoff';

    function isStandalone() {
        return window.navigator.standalone === true || !!(window.matchMedia &&
            (window.matchMedia('(display-mode: standalone)').matches ||
             window.matchMedia('(display-mode: fullscreen)').matches ||
             window.matchMedia('(display-mode: minimal-ui)').matches));
    }

    function readHandoff() {
        try {
            var raw = window.localStorage.getItem(HANDOFF_KEY);
            if (!raw) return null;
            var data = JSON.parse(raw);
            return data && typeof data === 'object' ? data : null;
        } catch (_) {
            return null;
        }
    }

    function clearHandoff() {
        try { window.localStorage.removeItem(HANDOFF_KEY); } catch (_) {}
    }

    function stop(a, close) {
        if (attempt !== a) return;
        attempt = null;
        clearTimeout(a.timer);
        if (a.watch) clearInterval(a.watch);
        window.removeEventListener('message', a.listener);
        window.removeEventListener('storage', a.onStorage);
        window.removeEventListener('focus', a.onWake);
        window.removeEventListener('pageshow', a.onWake);
        if (a.onVisibility) document.removeEventListener('visibilitychange', a.onVisibility);
        // The temporary client must not keep its own copy of the session.
        try {
            a.client.auth._removeSession && a.client.auth._removeSession();
        } catch (_) {}
        if (close && a.popup) { try { a.popup.close(); } catch (_) {} }
    }

    async function complete(a, code) {
        if (attempt !== a || a.busy) return;
        if (Date.now() >= a.expires) {
            stop(a, true);
            a.message('Google sign-in expired. Please try again.');
            return;
        }
        if (typeof code !== 'string' || !code.trim() || code.length > 2048) {
            stop(a, true);
            a.message('Google sign-in could not be completed. Please try again or use email and password.');
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

    // Pick up a code the callback window left in the shared origin storage.
    async function adopt(a) {
        if (attempt !== a || a.busy) return false;
        var handoff = readHandoff();
        if (!handoff || handoff.nonce !== a.nonce) return false;
        clearHandoff();
        if (Date.now() - (Number(handoff.at) || 0) > lifetime) return false;
        if (handoff.error) {
            stop(a, true);
            a.message('Google sign-in was cancelled or failed. Please try again.');
            return true;
        }
        await complete(a, handoff.code);
        return true;
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
            if (Date.now() - attempt.started < replaceAfter) {
                message('A Google sign-in is already in progress. Finish it in the Google window.');
                return;
            }
            stop(attempt, true);
            clearHandoff();
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
        clearHandoff();
        var a = { popup: popup, nonce: nonce, message: message, success: success,
            started: Date.now(), expires: Date.now() + lifetime, busy: false };
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
                complete(a, data.code);
            }
        };
        window.addEventListener('message', a.listener);
        a.onStorage = function (event) {
            if (event && event.key && event.key !== HANDOFF_KEY) return;
            adopt(a);
        };
        window.addEventListener('storage', a.onStorage);
        a.onWake = function () { adopt(a); };
        window.addEventListener('focus', a.onWake);
        window.addEventListener('pageshow', a.onWake);
        a.onVisibility = function () { if (!document.hidden) adopt(a); };
        document.addEventListener('visibilitychange', a.onVisibility);
        a.watch = setInterval(function () {
            if (attempt !== a || a.busy) return;
            adopt(a);
        }, 1500);
        a.timer = setTimeout(function () {
            if (attempt === a && !a.busy) { stop(a, true); message('Google sign-in expired. Please try again.'); }
        }, lifetime);
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
            // travel through storage and must remain bound to a secret verifier.
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

    // Left in place for callers that start a sign-in and then leave the form.
    window.cancelGooglePopup = cancel;
    window.DetectLabGooglePopup = { isStandalone: isStandalone, start: start, cancel: cancel };
})();
