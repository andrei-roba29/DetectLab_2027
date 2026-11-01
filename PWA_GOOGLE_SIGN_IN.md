# Google sign-in in the installed PWA

## What changed

The checked-out base commit did **not** contain the previously mentioned GIS
implementation. Both Google buttons called `signInWithOAuth` in the main
window, which navigated the installed app to Supabase and Google. The return
could land in a browser context with browser controls and, particularly on iOS,
separate app/browser storage. Hiding page controls cannot fix that.

For standalone, fullscreen or minimal-ui launches, Google sign-in now opens a
separate window synchronously from the button click. Supabase's PKCE flow is
started by a temporary client in the original app; its verifier stays in
memory there. The callback returns only the one-time authorization code via
`postMessage`, checked against the popup, origin and a random per-attempt
nonce. The app exchanges it and installs the resulting session in the regular
Supabase client, which persists it and emits the normal auth event. The Google
window may legitimately show browser controls; the original app is never
navigated away. Normal browser Google OAuth and email/password are unchanged.

Some OS/browser combinations isolate or sever the window opener. If automatic
return is unavailable, the callback displays the one-time code for the user to
copy into the waiting original app. The code is short-lived and PKCE-bound to
that attempt; it is still sensitive and must not be shared. The callback clears
its URL, uses no third-party resources, and is excluded from the service worker
cache; Netlify sends `no-store` and `no-referrer` headers. Do not log callback
URLs or authorization codes in hosting/analytics infrastructure. No tokens or
Google secrets are sent through the callback. Cancel, blocked popups, failed
exchanges and timeout leave the app in place. The temporary client never
persists or refreshes its own copy of the session.

This is not a guarantee that every platform will automatically return to the
app. If the OS discards/reloads the original PWA while Google is open, its
in-memory verifier is lost: return to the app and start again. If popups or
clipboard access are blocked, allow popups or use email/password. No web app can
remove browser chrome from an external Google window or force the OS to reopen
an installed app. Manual transfer is a fallback, not a seamless universal link.

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
   Cross-Origin-Opener-Policy that breaks popups unless the manual fallback is
   acceptable. Web Crypto and HTTPS (or localhost for development) are needed.

## Verification

Automated: `node test-pwa-google-auth.js` and `node test-pwa-shell-refresh.js`.
The tests exercise mocked popup and callback behavior, not a real Google login.

**Real devices have not been tested here.** Before release, after configuring
both providers and deploying, verify on each production origin:

- Install from Chrome on Android and from Safari → Add to Home Screen on iOS;
  launch from the icon, start Google login, complete consent, and confirm the
  authenticated map is in the *original* standalone app, not merely the browser
  callback. Close/reopen the app and confirm the session persists. Check both
  login and registration tabs and an existing account.
- If the popup does not reconnect, copy its one-time code into the app and
  confirm the session persists. Check that a different or expired attempt's
  code fails and that no Google credential is exposed in app logs/history.
- Cancel Google consent, close the popup, explicitly cancel in the app, retry,
  block popups, go offline, and allow the attempt to expire; confirm the app
  remains usable and no unintended session appears. Closing a popup alone does
  not cancel the attempt, so the manual fallback remains possible; use Cancel.
- Test normal browser Google login, email/password login and logout, plus iOS
  app suspension/relaunch and Android Back. Check callback behavior with
  deployed headers, service worker updates, cookies/privacy restrictions,
  different default browsers and a new install. If automatic handoff is broken,
  record OS/browser versions and whether the manual fallback worked.
