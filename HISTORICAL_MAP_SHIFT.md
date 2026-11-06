# Mutarea hărților istorice peste harta de bază (long-press)

**Cerere:** toate hărțile istorice disponibile (gratuite și premium) să poată
fi mutate peste harta de bază astfel: ții apăsat oriunde pe hartă → apare un
switch; switch ON → harta istorică poate fi trasă în orice direcție, dar nu
exagerat; ții apăsat din nou și oprești switch-ul → LOCK, poziția rămâne.

## Cum funcționează (`js/hist-shift.js` + `css/hist-shift.css`)

1. **Long-press (~550 ms, fără mișcare > 10 px)** oriunde pe hartă (nu pe
   butoane/marker-e/panouri) deschide panoul „Mută harta istorică", cu
   switch-ul, lista straturilor istorice active și deplasarea curentă.
2. **Switch ON (mod mutare):** handler-ul `dragging` al hărții de bază e
   dezactivat, iar drag-ul pe ecran mută harta istorică selectată (implicit
   cea de deasupra; poate fi aleasă din lista din panou). Deplasarea maximă
   e **3 km** (magnitudine, EPSG:3857) — permite corecții mai mari de
   georeferențiere, păstrând o limită de siguranță.
3. **Long-press din nou / switch OFF / × = LOCK:** drag-ul revine la harta de
   bază, iar poziția rămâne. Deplasarea e salvată per strat în
   `localStorage` (`dlHistShift.v1`) și reaplicată la pornirea stratului și
   la fiecare zoom. Butonul „Resetează poziția" o aduce la (0, 0).

## De ce merge pe TOATE hărțile istorice

Niciun strat nu e reimplementat. Modulul descoperă pe harta live layerele
al căror URL/LAYERS se potrivesc cu o definiție din registru
(`js/layer-registry.js`) din grupurile `hist-free`, `hist-premium` (inclusiv
catalogul CENAGIS) și `hist-sat` (CORONA anii '60), plus pane-urile speciale
`pane_josephine` (premium, sursă dublă Cloudflare/Supabase) și `iosfreePane`
(Harta Iosefină gratuită, image-overlay). Mutarea e o transformare CSS pe
pane-ul stratului, deci e independentă de tipul serviciului: WMS, WMTS, XYZ,
ArcGIS sau imagine. Deplasarea e ținută în **metri proiectați**, nu pixeli,
așa că poziția geografică rămâne aceeași la orice zoom.

API: `window.DetectLabHistShift` — `attach/activeTargets/setEnabled/
isEnabled/getOffset/setOffset/reset/showPanel`, `MAX_OFFSET_M = 3000`.

Regresie: `node test-hist-shift.js` (descoperire gratuit+premium, clamp,
persistență, long-press, drag, lock, reset). Asset-uri versionate
`20261014-hist-shift`, cache SW `v205-hist-shift`.

**Corecție (2026-10-20):** mutarea nu funcționa deloc dacă sliderul
stratului era adăugat pe ecranul principal — `isUiTarget()` potrivea cu
`closest()` clasele de stare `*docked*`/`*panel*` puse pe `<body>` de
oglinzile verticale, deci orice apăsare pe hartă era tratată drept UI.
Vezi `HIST_SHIFT_DOCKED_SLIDER.md` (asset
`20261020-hist-shift-docked-slider`, cache SW `v241`).

**Extindere (2026-10-31):** limita crește de la 300 m la 3 km (metri
proiectați EPSG:3857), în orice direcție. Pozițiile deja salvate rămân
valabile; lock-ul și resetarea nu se schimbă. Asset JS
`20261031-hist-shift-range`, cache SW `v344-hist-shift-range`.

## §5. Aceeași poziție în 3D (2026-11-06)

**Cerere:** „când schimbi poziția unei hărți istorice, să fie ajustată la fel
și în vizualizarea 3D".

Vizualizarea 3D e alt renderer (MapLibre peste DEM) și nu poate vedea un
`transform` CSS pus pe un pane Leaflet. Deplasarea circulă deci ca **date**:

1. `js/hist-shift.js` anunță fiecare schimbare prin evenimentul
   `detectlab:histshiftchange` pe `window`, cu `{ pane, offset, offsets,
   maxOffsetM }` (la `setOffset`, la `reset` și la fiecare pas de drag).
   Sursa de adevăr rămâne una singură: offsetul per pane, în metri proiectați
   EPSG:3857, salvat în `localStorage['dlHistShift.v1']`.
2. `js/map3d-mirror.js` citește offsetul panoului (`shiftForPane`) și îl pune
   în template-ul de tile: `dl2d://<cheie>/{z}/{x}/{y}?hs=<x>,<y>`; pentru
   image-overlay-uri mută cele patru colțuri cu aceiași metri (longitudinea
   direct, latitudinea în mercator-y, ca să rămână aceeași proiecție).
3. `js/map3d-terrain.js` compune fiecare tile cerut de MapLibre din vecinii
   pe care îi acoperă fereastra mutată (`shiftMosaic`): o fereastră de exact
   un tile atinge cel mult **două tile-uri per axă** (deci maximum 4 cereri),
   oricât de mare ar fi corecția — un offset de 3 km nu înseamnă 400 de
   tile-uri, ci aceleași patru, cu 20 de indici mai încolo. Tile-ul compus e
   ținut în cache sub URL-ul cu offset, deci o repanare nu costă nimic.
   Straturile fără offset merg pe drumul de dinainte (o cerere per tile,
   template-ul din registru).

Rezultatul: o poziție aliniată o dată e aceeași în ambele vizualizări, la
orice zoom, pentru hărți gratuite și premium. `reset` în 2D (sau
`DetectLabHistShift.reset(pane)` prin API, cu 3D deschis) readuce stratul pe
poziția reală și în 3D, imediat — viewer-ul ascultă evenimentul și își reface
deck-ul; în plus, semnătura polling-ului de 1,5 s include offseturile, deci
schimbarea e prinsă și fără eveniment.

Diagnostic: `DetectLabMap3D.status()` → `historyShift` (offseturile aplicate)
și `shiftedTiles` (câte tile-uri au fost compuse); fiecare strat are `pane` și
`shift` în status.

Regresie: `node test-hist-shift-3d.js` (evenimentul, metri→pixeli la 256 și
512, mozaicul și limita lui, colțurile, tile-ul compus pixel cu pixel, cache,
protocolul `dl2d://` cu și fără offset, status). Asset-uri versionate
`20261106-hist-shift-3d` (hist-shift, mirror, terrain), cache SW
`v412-hist-shift-3d`.
