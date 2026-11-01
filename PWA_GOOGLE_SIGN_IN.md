# Google sign-in in the installed PWA

## What changed

The checked-out base commit did **not** contain the earlier GIS implementation.
Both Google buttons called `signInWithOAuth` in the main window, which navigated
the installed app to Supabase and Google. The return could land in a browser
context with browser controls and, particularly on iOS, separate app/browser
storage. Hiding page controls cannot fix that.

For standalone, fullscreen or minimal-ui launches, Google sign-in now opens a
separate window synchronously from the button click. Supabase's PKCE flow is
started by a temporary client in the original app; its verifier stays in memory
there. The Google window may legitimately show browser controls; the original
app is never navigated away.

**The result comes back by itself. The user never sees or pastes a code.** The
callback returns the one-time authorization code on the first path available:

1. `postMessage` to the opener, checked against the popup, origin and a random
   per-attempt nonce. The app exchanges the code and installs the resulting
   session in the regular Supabase client, which persists it and emits the
   normal auth event.
2. A same-origin handoff record (`localStorage['detectlab-google-handoff']`,
   `{nonce, code|error, at}`) written by the callback window for the case where
   the OS isolated or severed the opener (iOS standalone, Android Custom Tab).
   The app reads that record on the `storage` event, on `focus`, on `pageshow`,
   on `visibilitychange` and on a 1.5 s poll while an attempt is open, takes the
   code only when the nonce matches the attempt in progress, deletes the record
   and exchanges the code with the verifier it still holds.

If neither path arrives before the 10-minute lifetime, the form says the
sign-in did not finish and offers a retry — there is no "one-time sign-in code"
field, no Complete button and no Cancel button in the login/register form, and
the callback page shows no code either. Normal browser Google OAuth and
email/password are unchanged.

The code is short-lived and PKCE-bound to that attempt; it is not a Google
credential, but it is still sensitive and must not be shared or logged. The
callback clears its URL, uses no third-party resources, and is excluded from the
service worker cache; Netlify sends `no-store` and `no-referrer` headers. Do not
log callback URLs or authorization codes in hosting/analytics infrastructure. No
tokens or Google secrets are sent through the callback. Failed exchanges,
blocked popups and timeout leave the app in place. The temporary client never
persists or refreshes its own copy of the session and is dropped when the
attempt ends.

This is still not a guarantee that every platform will reach the app
automatically. If the OS discards/reloads the original PWA while Google is open,
its in-memory verifier is lost, and the handoff record cannot be exchanged:
return to the app and start again. If the callback window runs in a browser
profile that shares no storage with the installed app (iOS standalone, where
`window.open` leaves the app for Safari), the record never arrives either — the
form then reports that the sign-in did not finish and email/password remains the
fallback. No web app can remove browser chrome from an external Google window or
force the OS to reopen an installed app with the same storage.

## Deployment configuration

1. Enable Google in Supabase Authentication → Providers, using the existing
   Google web OAuth client ID and secret. Keep the secret only in Supabase, not
   in the repository or browser. Leave nonce validation enabled; this flow uses
   Supabase OAuth/PKCE rather than a GIS ID-token exchange.
2. In Google Cloud, configure the OAuth consent screen and its publishing/test
   users as appropriate. Add the Supabase provider callback
   `https://dacboefvooxgsngxkavx.supabase.co/auth/v1/callback` to the Google web
   client's **Authorized redirect URIs**. Use the actual project callback if
   deploying another Supabase project. The DetectLab callback below is a
   Supabase redirect URL, not the Google redirect URI.
3. In Supabase Authentication → URL Configuration → Redirect URLs, add
   `https://detectlab.ro/google-auth-callback.html**` and
   `https://detectlab.eu/google-auth-callback.html**`. The wildcard is needed
   for the unpredictable `?nonce=...` query. Retain existing site and browser
   redirect entries. For preview/staging, explicitly allow that HTTPS origin's
   callback too; do not allow arbitrary origins. Verify the deployed Supabase
   wildcard rules against a real login; an unallowed redirect may fall back to
   Site URL and the app cannot receive the code.
4. Serve `google-auth-callback.html` at the same exact origin as the PWA,
   without canonicalizing it to another host or redirecting to the app shell.
   On non-Netlify hosts also configure `Cache-Control: no-store` and
   `Referrer-Policy: no-referrer` for the callback. Do not set a
   Cross-Origin-Opener-Policy that breaks popups. Web Crypto and HTTPS (or
   localhost for development) are needed.
5. `localStorage` must stay usable on both the app origin and the callback page
   (the handoff record). A browser that blocks site storage for this origin
   leaves only the `postMessage` path.

## Verification

Automated: `node test-pwa-google-auth.js` and `node test-pwa-shell-refresh.js`.
The tests exercise mocked popup, handoff and callback behaviour, not a real
Google login.

**Real devices have not been tested here.** Before release, after configuring
both providers and deploying, verify on each production origin:

- Install from Chrome on Android and from Safari → Add to Home Screen on iOS;
  launch from the icon, start Google login, complete consent, and confirm the
  authenticated map is in the *original* standalone app, not merely the browser
  callback. Close/reopen the app and confirm the session persists. Check both
  login and registration tabs and an existing account.
- Confirm no code prompt appears anywhere: not in the login/register form and
  not on the callback page. If the popup does not reconnect, returning to the
  app must be enough (focus/visibility/storage path).
- Cancel Google consent, close the popup, retry, block popups, go offline, and
  allow the attempt to expire; confirm the app remains usable, that a stale or
  foreign handoff record is ignored, and that no unintended session appears.
- Test normal browser Google login, email/password login and logout, plus iOS
  app suspension/relaunch and Android Back. Check callback behavior with
  deployed headers, service worker updates, cookies/privacy restrictions,
  different default browsers and a new install. If the automatic handoff is
  broken, record OS/browser versions and whether the storage path was reachable.
