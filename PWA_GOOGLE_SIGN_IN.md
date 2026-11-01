# Google sign-in in the installed PWA

## What changed

The checked-out base commit did **not** contain the earlier GIS implementation.
Both Google buttons called `signInWithOAuth` in the main window, which navigated
the installed app to Supabase and Google. The return could land in a browser
context with browser controls and, particularly on iOS, separate app/browser
storage. Hiding page controls cannot fix that.

For standalone, fullscreen or minimal-ui launches, Google sign-in now opens a
separate window synchronously from the button click. On installed iOS, the PKCE
URL is prepared in memory when the login modal opens. The URL is then used in
a **top-level, out-of-scope navigation** from the user's tap: iOS kept even a
direct `window.open(url, '_blank')` inside an auxiliary PWA window with no
usable keyboard. If preparation has not finished yet, the user is asked to tap
again; no blank popup is opened. This is an attempt to let WebKit hand the
external OAuth URL to Safari, **not a way to force Safari**: a web app cannot
choose which browser context iOS opens. On Android the original blank-window
flow stays unchanged. If iOS navigates the PWA itself rather than opening
Safari, the in-memory PKCE verifier will be lost on return. Even when Safari
opens, its storage may be isolated from the installed PWA; this flow is not
verified as a reliable sign-in until a real iPhone confirms both keyboard AND
session handoff. Supabase's PKCE flow is
started by a temporary client in the original app; its verifier stays in memory
there. The Google window may legitimately show browser controls; the original
app is never navigated away.

**The result comes back by itself. The user never sees or pastes a code.** The
callback returns the one-time authorization code on the first path available:

1. `postMessage` to the opener, checked against the popup, origin and a random
   per-attempt nonce. The app exchanges the code and installs the resulting
   session in the regular Supabase client, which persists it and emits the
   normal auth event.
   The redirect URL is the plain, exact `https://<origin>/google-auth-callback.html`;
   the nonce travels through same-origin storage
   (`localStorage['detectlab-google-attempt']`), not through the query string, so a
   redirect that Supabase normalises cannot drop the correlation either.
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
email/password are unchanged. Google sign-in is not offered on an origin that is
not in `window.DetectLabOAuthOrigins` (default `detectlab.ro` and `detectlab.eu`):
starting it there would be rewritten to the project Site URL and would hand the
user to another domain instead of signing them in.

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
3. In Supabase Authentication → URL Configuration, the redirect allow-list is
   what decides the domain a Google sign-in comes back to. **A `redirect_to`
   that is not on that list is silently replaced with the project Site URL** —
   which is `https://detectlab.ro`, so a login started on `detectlab.eu` (or on
   a preview deploy) finished on the Romanian domain, in a browser window, and
   could not be completed there. Add the plain callback path for every origin
   that must work:

   - `https://detectlab.ro/google-auth-callback.html`
   - `https://detectlab.eu/google-auth-callback.html`

   Exact entries are enough now: the redirect URL carries no `?nonce=…` any
   more, so no wildcard is required. Add the exact
   `https://<preview-host>/google-auth-callback.html` for any staging/preview
   origin you test on (and set `window.DetectLabOAuthOrigins` to include it —
   see below). Keep the existing site/browser redirect entries. Verify against a
   real login: a missing entry shows up as the sign-in landing on the Site URL.
4. Origins. The client refuses to start Google OAuth on an origin that is not
   listed, because the fallback described above cannot be completed there.
   The default list is `['https://detectlab.ro', 'https://detectlab.eu']`;
   extend it before `js/auth.js` loads on another deployment:

   ```html
   <script>window.DetectLabOAuthOrigins = ['https://detectlab.ro', 'https://detectlab.eu', 'https://staging.example'];</script>
   ```

5. Serve `google-auth-callback.html` at the same exact origin as the PWA,
   without canonicalizing it to another host or redirecting to the app shell.
   On non-Netlify hosts also configure `Cache-Control: no-store` and
   `Referrer-Policy: no-referrer` for the callback. Do not set a
   Cross-Origin-Opener-Policy that breaks popups. Web Crypto and HTTPS (or
   localhost for development) are needed.
6. `localStorage` must stay usable on both the app origin and the callback page
   (the handoff record, and the attempt record that carries the nonce). A
   browser that blocks site storage for this origin leaves only the
   `postMessage` path, and the callback hands the code over without a nonce.

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
- Start the sign-in on `detectlab.eu` and confirm the Google window returns to
  `detectlab.eu` — the URL bar of the callback window must not show
  `detectlab.ro`. Same for any preview origin that was explicitly allow-listed.
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
