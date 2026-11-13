# Cloudflare Dashboard checklist — DetectLab Pages migration

Everything that **cannot** be done from the repository. Companion to
[`CLOUDFLARE_MIGRATION.md`](CLOUDFLARE_MIGRATION.md), which explains why each
step is here.

> **Ground rules for this migration**
> * Netlify stays live on `detectlab.ro` and `detectlab.eu`. Do not detach,
>   pause or reconfigure the Netlify site at any point.
> * Do not change production DNS until §6 has passed on a `*.pages.dev` preview.
> * Never type a real secret into a chat, an issue, a commit or a build log. Copy
> * Secret values from the existing Netlify site configuration.
> * `detectlab.ro` and `detectlab.eu` are separate markets (`DOMAIN_SETUP.md`).
>   No rule, redirect or domain setting may ever send one to the other.

---

## 1. Create the Pages project

| Step | Where | Value |
|---|---|---|
| 1.1 | Dashboard → **Workers & Pages** → **Create** → **Pages** → *Connect to Git* | pick the `DetectLab` repository |
| 1.2 | Project name | `detectlab-4i1` — **confirm this against the Dashboard first** (see below). It must match `name` in `wrangler.jsonc`. |
| 1.3 | Production branch | `main` |
| 1.4 | **Framework preset** | `None` |
| 1.5 | **Build command** | `node tools/cloudflare-build.mjs` |
| 1.6 | **Build output directory** | `cloudflare-dist` |
| 1.7 | Root directory | `.` (leave at the repository root) |
| 1.8 | Build variables | `NODE_VERSION = 22` |
| 1.8a | Settings → **Builds & deployments** → **Assets** → *HTML handling* | **`none`** — must match `assets.html_handling` in `wrangler.jsonc`. With the default (`auto-trailing-slash`) `/google-auth-callback.html` becomes a 308 again and `sw.js` precaches nothing (`CLOUDFLARE_MIGRATION.md` §6.2). |
| 1.8b | same page → *404 handling* | **`404-page`** — must match `assets.not_found_handling`, with `cloudflare/404.html` published (§6.3). |

> **1.2 — the project slug is inferred, not confirmed.** The sandbox that prepared
> this migration had no Cloudflare credentials (`wrangler whoami` → *"You are not
> authenticated"*) and no route to `api.cloudflare.com`, so the Dashboard could not
> be read. `detectlab-4i1` comes from the repository itself:
> `netlify/lib/map3d-country-modules.mjs:141` (present at HEAD `27dd935`, before this
> migration) hard-codes `https://detectlab-4i1.pages.dev/` as the `location` of the
> server-side country-module sandbox, and that is the **only** `*.pages.dev` hostname
> anywhere in the repository at HEAD. A Pages project's apex preview domain is
> `<project-name>.pages.dev`.
>
> - [ ] **1.2a Read the real name**: Dashboard → **Workers & Pages** → the existing
>       project → its `*.pages.dev` URL. If the project already exists, **do not
>       create a second one** — set `name` in `wrangler.jsonc` to the existing slug
>       instead, and update this row.
> - [ ] **1.2b If no Pages project exists yet**, `detectlab-4i1` is free to use, and
>       step 1.1 creates it with that name.
> - [ ] **1.2c** `node test-cloudflare-config.mjs` — group 11 fails if `wrangler.jsonc`,
>       this document, `CLOUDFLARE_MIGRATION.md` §7.1 and the hostname in
>       `netlify/lib/map3d-country-modules.mjs` disagree.
>
> Nothing else in the migration depends on the slug: `functions/_middleware.js`
> canonicalises only `www.detectlab.ro` and `www.detectlab.eu` and passes every
> `*.pages.dev` preview host straight through, and the build output directory stays
> `cloudflare-dist` either way.

Expected build log — three steps, in this order:

```
── step 1/3 — generated Cloudflare modules (parity gate)
✓ 7 parity groups verified …
── step 2/3 — CORONA Europe catalogue (same script Netlify runs)
✓ … or: = CAST unreachable and no committed snapshot: the deployment continues
── step 3/3 — assemble cloudflare-dist/
✓ 565 files (36.50 MB) → cloudflare-dist/
  _headers / _redirects / _routes.json / 404.html copied from cloudflare/
```

A **step 2 failure is not a build failure**: the CORONA script is tolerated
exactly like `netlify.toml`'s `node tools/build-corona-europe-catalog.mjs || true`.
A **step 1 failure is** — it means a generated module drifted from its canonical
source. Fix it with `node tools/sync-cloudflare-generated.mjs` and commit, never
by editing `functions/_generated/*` by hand.

- [ ] 1.9 Confirm the deployment URL is `https://<hash>.detectlab-4i1.pages.dev` and
      that the site renders there (map, layer list, no console errors).
- [ ] 1.10 Confirm the OAuth callback is a **direct 200, not a redirect**, on the
      preview host — this is the check that `html_handling` really is `none`:

      ```bash
      curl -sI https://<hash>.detectlab-4i1.pages.dev/google-auth-callback.html | head -6
      #   HTTP/2 200                       ← NOT 308, and no location: header
      #   cache-control: no-store
      #   referrer-policy: no-referrer
      #   x-robots-tag: noindex, nofollow
      ```

      then `node tools/cloudflare-smoke.mjs --url=https://<hash>.detectlab-4i1.pages.dev`
      (350 checks; group 2 covers both callback spellings, bare and with
      `?code=…&state=…`, plus `HEAD`, plus every `.html` document `sw.js` precaches).

---

## 2. Secrets and environment variables

Dashboard → **Workers & Pages** → `detectlab-4i1` → **Settings** → **Variables and Secrets**.
Set each one for **Production** *and* **Preview**, with the value already used on
Netlify (Netlify → Site configuration → Environment variables). Full table with
rationale: `CLOUDFLARE_MIGRATION.md` §5.

| Variable | Type | Required | Used by |
|---|---|---|---|
| `DATAFORSYNINGEN_TOKEN` | **Encrypt** | yes, for the two Danish DHM/DTK25 layers | `/api/geo/dk-dhm`, `/api/geo/dk-dtk25` |
| `DATAFORDELER_USERNAME` | **Encrypt** | yes, for the Danish orthophoto | `/api/geo/dk-orto` |
| `DATAFORDELER_PASSWORD` | **Encrypt** | yes, for the Danish orthophoto | `/api/geo/dk-orto` |
| `DATAFORDELER_USER` | **Encrypt** | only if the deployment still uses the legacy alias | `/api/geo/dk-orto` |
| `LANTMATERIET_WMS_USER` | **Encrypt** | Basic-auth scheme for Sweden | `/api/geo/se-hojdmodell` |
| `LANTMATERIET_WMS_PASSWORD` | **Encrypt** | Basic-auth scheme for Sweden | `/api/geo/se-hojdmodell` |
| `LANTMATERIET_WMS_TOKEN` | **Encrypt** | Bearer scheme for Sweden (alternative to the two above) | `/api/geo/se-hojdmodell` |
| `LANTMATERIET_WMS_URL` | Text | optional override of the licensed endpoint | `/api/geo/se-hojdmodell` |
| `MML_API_KEY` | **Encrypt** | optional — only `src=mml-hillshade-open` | `/api/geo/finland` |
| `DANISH_PROXY_ALLOWED_ORIGINS` | Text | optional, exact origins, no wildcards | `dk-dtk25`, `dk-orto`, `dk-heritage` |
| `FINLAND_PROXY_ALLOWED_ORIGINS` | Text | optional, exact origins, no wildcards | `/api/geo/finland` |

Recommended plain values for the two origin lists (they are public origin names,
not credentials):

```
DANISH_PROXY_ALLOWED_ORIGINS = https://detectlab.ro,https://detectlab.eu
FINLAND_PROXY_ALLOWED_ORIGINS = https://detectlab.ro,https://detectlab.eu
```

Add the `*.pages.dev` preview origin **only** while validating, and remove it
afterwards. Do **not** create Stripe or Supabase variables here: they belong to
the Express backend and to the public frontend config, not to these Functions.

- [ ] 2.1 All mandatory secrets set for Production **and** Preview.
- [ ] 2.2 No secret value committed to the repository (`.dev.vars` is git-ignored;
      `test-cloudflare-config.mjs` asserts no tracked file changed).
- [ ] 2.3 Redeploy so the bindings are picked up, then check
      `/api/geo/dk-dhm?request=GetTile&layer=dhm_terraen_skyggekort&format=image/jpeg&tilematrixset=view1&tilematrix=7&tilecol=1&tilerow=1`
      returns a JPEG (200) and **not** 503 `service_unavailable`.

---

## 3. Redirect Rules — `www` → apex (one rule per zone)

Cloudflare Pages `_redirects` cannot match a hostname, so the static site's
`www` canonicalisation lives here. Functions already handle the nine API paths
(`functions/_middleware.js`); these two rules cover every other URL.

**Rules → Redirect Rules → Create rule**, once **in each zone**:

### 3.1 Zone `detectlab.ro`

| Field | Value |
|---|---|
| Rule name | `www → apex (RO)` |
| If incoming requests match | Custom filter expression |
| Field / Operator / Value | `Hostname` **equals** `www.detectlab.ro` |
| Then | **Dynamic** redirect |
| Expression | `concat("https://detectlab.ro", http.request.uri.path)` |
| Status code | `301` |
| Preserve query string | **enabled** |
| Preserve path suffix | **enabled** (the expression already carries the full path) |

### 3.2 Zone `detectlab.eu`

| Field | Value |
|---|---|
| Rule name | `www → apex (EU)` |
| If incoming requests match | Custom filter expression |
| Field / Operator / Value | `Hostname` **equals** `www.detectlab.eu` |
| Then | **Dynamic** redirect |
| Expression | `concat("https://detectlab.eu", http.request.uri.path)` |
| Status code | `301` |
| Preserve query string | **enabled** |

### 3.3 Hard constraints

- [ ] Each rule lives **only** in its own zone and hardcodes **its own** apex.
- [ ] No rule uses a wildcard, `ends_with`, `contains`, or a variable hostname —
      nothing may ever send `detectlab.ro` traffic to `detectlab.eu` or back.
- [ ] No catch-all rule (`http.request.uri.path` conditions, `/*` rewrites) is
      added anywhere: `CLOUDFLARE_MIGRATION.md` §6.1 requires that only the nine
      API paths reach a Function and that everything else is served as an asset.
- [ ] The two rules are the **only** redirect rules in either zone (a rule list
      is evaluated top-down; an earlier rule would win).

### 3.4 Verify (from a machine that can resolve the preview host)

```bash
curl -sI https://<hash>.detectlab-4i1.pages.dev/api/map3d/tile?layer=base.imagery&z=1&x=0&y=0 \
     -H 'Host: www.detectlab.ro' | head -3        # Function-level rule: 301 → detectlab.ro
node tools/cloudflare-smoke.mjs --url=https://<hash>.detectlab-4i1.pages.dev
```

Once the zone rules exist, the smoke test's note
*"www on a STATIC path is not redirected by the deployment"* turns into a hard
assertion and must pass.

---

## 4. Custom domains — **only after §6 passes**

- [ ] 4.1 Leave `detectlab.ro` and `detectlab.eu` on Netlify. Do not add them to
      the Pages project yet.
- [ ] 4.2 When the decision is made to move **one** domain, add it under
      Workers & Pages → `detectlab-4i1` → **Custom domains**. Cloudflare will propose
      the DNS change; **review it before accepting** — if the zone is already on
      Cloudflare DNS, the record currently points at Netlify and must be replaced
      deliberately, not silently.
- [ ] 4.3 Move one domain at a time (`.eu` first is the lower-risk order), and
      keep the other on Netlify until the moved one has been watched for a few
      days.
- [ ] 4.4 Do not remove the Netlify domain configuration even after both move:
      it is the rollback path (`CLOUDFLARE_MIGRATION.md` §10).
- [ ] 4.5 `www.detectlab.ro` / `www.detectlab.eu`: keep whatever DNS arrangement
      `DOMAIN_SETUP.md` describes today. The rules in §3 canonicalise them; they
      must still resolve.

---

## 5. Third-party allow-lists for the preview origin (temporary)

While validating on `https://<hash>.detectlab-4i1.pages.dev`:

- [ ] 5.1 **Supabase** → Authentication → URL Configuration → *Redirect URLs*:
      add `https://<hash>.detectlab-4i1.pages.dev/google-auth-callback.html`.
      `PWA_GOOGLE_SIGN_IN.md` §3 warns that a `redirect_to` not on that list is
      silently replaced with the project Site URL (`https://detectlab.ro`), which
      is how a login started on another origin ends up on the Romanian domain.
- [ ] 5.2 The same page must list the preview origin in
      `window.DetectLabOAuthOrigins` if a Google sign-in is to be *started* there
      (`PWA_GOOGLE_SIGN_IN.md` §4) — set it in the preview HTML only, never in a
      committed file, or accept that Google sign-in cannot start on the preview.
- [ ] 5.3 **Google Cloud Console** → OAuth client → authorised redirect URIs:
      add the preview callback URL if the flow is to complete there.
- [ ] 5.4 Remove all three preview entries again once validation is done. The
      production entries for `detectlab.ro` and `detectlab.eu` must stay exactly
      as they are.
- [ ] 5.5 Nothing to do for Stripe (the Express backend owns it), for the tile
      providers (they allow-list nothing), or for MapLibre/Leaflet CDNs.

---

## 6. Validation on the preview deployment

Run these against `https://<hash>.detectlab-4i1.pages.dev`. The first command is the
same 326-check suite that was run locally in workerd; it auto-detects that this
runtime *can* reach the upstream providers and therefore holds the upstream calls
to their real expectations.

```bash
node tools/cloudflare-smoke.mjs --url=https://<hash>.detectlab-4i1.pages.dev
```

- [ ] 6.1 Smoke suite: **all checks pass, zero notes about degraded upstreams**.
- [ ] 6.2 Real tiles: open the map, enable a LiDAR layer for each of the eight
      countries (NL, NO, PL, ES, CH, UK, DK, SE) and confirm imagery renders —
      these are the modules that had to be compiled in
      (`CLOUDFLARE_MIGRATION.md` §4.3).
- [ ] 6.3 Danish layers: DHM skyggekort, DTK25, orthophoto and heritage
      (`fortidsminder`) all draw; no 401/503 in the network tab.
- [ ] 6.4 Swedish `se-hojdmodell`, Finnish `mml-hillshade-open`, Albanian
      `asig-heritage` all draw.
- [ ] 6.5 CORONA: `/api/corona/rasters?bbox=-25,34,60,72` returns 200 JSON with
      `X-DetectLab-Corona-Cache: live` (first call may be `miss`); the satellite
      CORONA layer draws. If CAST was down at build time, confirm the layer still
      works from the runtime proxy or the frontend fallback.
- [ ] 6.6 Cache pin: a tile response carries
      `CDN-Cache-Control: public, s-maxage=604800, stale-while-revalidate=86400`
      and the same value in `Cloudflare-CDN-Cache-Control`; the second request for
      the same tile is a CDN hit.
- [ ] 6.7 **A real Google sign-in**, start to finish, on the preview origin:
      the popup opens, lands on `/google-auth-callback.html`, is redirected to
      `/google-auth-callback`, hands the code back to the opener, and the Supabase
      session appears. Then in DevTools → Application → Cache Storage confirm
      **no** `/google-auth-callback*` entry exists.
- [ ] 6.8 OAuth callback headers on the rendered page:
      `curl -sIL https://<hash>.detectlab-4i1.pages.dev/google-auth-callback.html`
      shows `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
      `X-Robots-Tag: noindex, nofollow` on **both** the redirect and the final
      response, each exactly once.
- [ ] 6.9 PWA: install the app, go offline, reopen — the shell, the layer list and
      a previously viewed area still work; `sw.js` installs with no precache
      failure (every precached URL — 759 today, including
      `/rvt_service/methods.json` — exists on this host).
- [ ] 6.10 404s: `/netlify.toml`, `/api/does-not-exist` and any mistyped path
      return **404** with the DetectLab error page — never the app shell with 200.
- [ ] 6.11 `www` canonicalisation: `https://www.detectlab.ro/` → 301 →
      `https://detectlab.ro/` **with the query string preserved**, and likewise
      for `.eu`; neither crosses to the other market.
- [ ] 6.12 Checkout / Stripe: the pricing page opens and a test checkout
      completes, returning to the correct apex domain.
- [ ] 6.13 Both markets: repeat 6.2–6.12 with the `.eu` origin in
      `DANISH_PROXY_ALLOWED_ORIGINS` / `FINLAND_PROXY_ALLOWED_ORIGINS` removed and
      re-added, confirming the origin allow-list behaves as documented.

---

## 7. Settings to check — and deliberately leave alone

- [ ] 7.1 **Settings → Runtime → fail-open/fail-closed**: leave at the account
      default. The nine routes are explicit in `_routes.json`, so either behaviour
      is safe; changing it is out of scope.
- [ ] 7.2 **Caching → Configuration**: do not add a Cache Rule, an Edge TTL
      override or a "Cache Everything" rule. The Functions set their own
      `CDN-Cache-Control` (7-day tile pins) and `_headers` covers the static side;
      an extra rule would fight both.
- [ ] 7.3 **Scrape Shield / Email Obfuscation / Mirage / Rocket Loader /
      Auto Minify**: keep **off** for this project. Rocket Loader and Mirage in
      particular rewrite HTML and images that the map, the service worker and the
      Google sign-in popup depend on.
- [ ] 7.4 **Security → WAF**: no custom rule may block `/api/**` or the tile
      hosts. If a managed rule interferes during validation, create an exception
      for the nine paths rather than disabling protection.
- [ ] 7.5 **SSL/TLS**: Full (strict), as required for a Pages custom domain.
- [ ] 7.6 **Do not** add a `Content-Security-Policy`, `Permissions-Policy`,
      `Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy` response
      header transform. `CLOUDFLARE_MIGRATION.md` §6.2 records why each one would
      break the existing frontend.
- [ ] 7.7 **Do not** enable `nodejs_compat` for this project. Nothing needs it
      (§4.2), and enabling it would widen the runtime surface of every Function.

---

## 8. Cutover and rollback

- [ ] 8.1 §6 fully green on the preview, for both markets.
- [ ] 8.2 Decide the order and move **one** custom domain (§4). Watch logs and
      error rates for a few days.
- [ ] 8.3 Move the second domain.
- [ ] 8.4 Remove the temporary third-party preview entries (§5.4).
- [ ] 8.5 Keep the Netlify site configured and deployable for at least one
      release cycle: it is the rollback path and costs nothing to keep.
- [ ] 8.6 Rollback (if ever needed): point the domain's DNS back at Netlify per
      `DOMAIN_SETUP.md`, or remove the custom domain from the Pages project. No
      repository change is required, and the Netlify build was never modified —
      `CLOUDFLARE_MIGRATION.md` §10.
