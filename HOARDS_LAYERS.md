# Halde „Hoards" — tezaure monetare și depozite de metale prețioase (PREMIUM, toate țările)

Grupul **Hoards** este un strat premium disponibil în **fiecare** țară (și în
vederea globală, fără țară selectată). Este construit din șapte straturi
ArcGIS **FeatureServer** publicate de DARMC (Digital Atlas of Roman and Medieval
Civilizations, Harvard University) în serviciul
`DARMC_Archaeological_Studies`.

Fișier principal: **`js/hoards-layers.js`**. Rândurile panoului sunt generate
acolo; grupul (titlu, ⓘ, chevron, comutator master, slider de opacitate) stă în
`index.html` (`#hoardsRow` → `#hoardsSubLayers`), stilizat în `css/styles.css`
secțiunea „Hoards".

## Cele șapte cataloguri

| # | strat FeatureServer | rând în panou | culoare | zoom minim |
|---|---|---|---|---|
| 8 | `.../FeatureServer/8` | Carolingian coin hoards, 769–814 CE | `#e8c15a` | 4 |
| 9 | `.../FeatureServer/9` | Carolingian coin hoards, 815–840 CE | `#dfa03f` | 4 |
| 10 | `.../FeatureServer/10` | Carolingian coin hoards, 841–900 CE | `#d07a3c` | 4 |
| 11 | `.../FeatureServer/11` | Carolingian coin hoards, after 900 CE | `#b4553f` | 4 |
| 12 | `.../FeatureServer/12` | Gallic coin hoards, 200–300 CE | `#8fae56` | 4 |
| 15 | `.../FeatureServer/15` | Late Roman precious-metal deposits, 200–700 CE (equivalent gold weight) | `#f0d97a` | 4 |
| 16 | `.../FeatureServer/16` | Late Roman precious-metal deposits, 200–700 CE (deposit date) | `#a98bd6` | 4 |

Serviciul complet:

```
https://services1.arcgis.com/qN3V93cYGMKQCOxL/arcgis/rest/services/DARMC_Archaeological_Studies/FeatureServer
```

**Stratul 8 este listat o singură dată.** Cererea inițială îl conținea de două
ori (a opta intrare repeta prima); un strat poate avea un singur comutator, un
singur slider și un singur ⓘ, deci dublura a fost eliminată, nu duplicată în
panou. `test-hoards-layers.js` verifică exact lista `8, 9, 10, 11, 12, 15, 16`.

## De ce „toate țările"

Spre deosebire de catalogurile naționale (Danemarca, Finlanda, Albania,
registrele din Regatul Unit), tezaurele DARMC nu aparțin unei singure țări:
aceleași straturi acoperă toate țările din setul de date. Grupul **nu are
atribuire de țară și nici înregistrare de bounds**, iar
`js/map-app.js` → `filterLayersForCountry()` lasă neschimbate rândurile fără
atribuire (regula de acoperire nu se aplică). În plus,
`js/hoards-layers.js` → `filter()` șterge explicit orice
`.country-layer-unavailable` de pe grup și de pe rânduri la
`detectlab:country-selected` / `detectlab:country-cleared`.

Rezultat: pentru GB, RO, FR, DE, IT, ES, PL, US, JP, AU și pentru vederea
globală grupul rămâne vizibil. CSS-ul **nu** conține nicio regulă de tip
`#transpPanel #hoardsRow.country-layer-unavailable` — absența porții este
intenționată, nu o scăpare.

## Interfață

```
┌ ◉ Hoards                                          ⓘ   ⌄   [●] ┐
│ Opacitate  PREMIUM                                    85%     │
│ ────────────────────●────────────────────────────────────────  │
│  ┌ ● Carolingian coin hoards — 769–814 CE      DARMC   [●] ┐   │
│  │ Opacitate                                        ⓘ  85% │   │
│  │ ──────────────────●────────────────────────────────────── │   │
│  │ (stare: „412 elemente" / „Zoom la 4+" / eroare)          │   │
│  └──────────────────────────────────────────────────────────┘   │
│  … încă șase rânduri, fiecare cu comutatorul, sliderul,          │
│    procentul, linia de stare și ⓘ-ul propriu                    │
└─────────────────────────────────────────────────────────────────┘
```

- **Master switch** — pornește/oprește toate cele șapte cataloguri (starea
  comutatorului este `checked` când toate sunt pornite, `indeterminate` când
  doar o parte).
- **Slider de grup** — copiază opacitatea în toate rândurile și **recolorează**
  geometria existentă; nu reinteroghează serverul.
- **Fiecare rând** are propriul comutator, propriul slider, propriul badge `%`,
  propria linie de stare și propriul ⓘ (perioadă, furnizor, licență, zoom
  minim, număr de înregistrări).
- **Chevron** — pliază/desfășoară coloana; după animație, `max-height` este
  eliberat (`none`), ca niciun rând să nu fie tăiat la schimbarea limbii sau la
  zoom-ul de browser (același bug reparat în panoul de hărți istorice).

Rândurile sunt marcate `data-category="premium"` (grupul la fel), deci apar
**numai în tabul Premium**. Modulul reaplică tabul curent după fiecare click pe
tab-uri și după fiecare reconstrucție (schimbare de limbă), pentru că
`switchLayerTab()` din `js/map-app.js` rulează doar la click/încărcare.

## Poartă premium

Grupul și fiecare rând generat sunt `data-category="premium"`, deci:

- `js/subscriptions.js` blochează, în faza de captură, orice control interactiv
  din interiorul unui `.transp-layer-row[data-category="premium"]` pentru
  utilizatorii fără abonament și deschide fereastra de membership (tabul
  Premium rămâne navigabil, ca utilizatorul să vadă ce ar primi);
- `toggleHoardsLayers` este adăugat în `PREMIUM_TOGGLE_FNS`, deci comutatorul
  master este împachetat și pentru apelurile programatice;
- modulul se apără singur: `premiumAllowed()` consultă `window._dlIsPremium()`
  înainte de orice pornire (`setSource`, `toggleAll`), iar `denyPremium()`
  stinge tot ce ar fi fost pornit, golește starea și deschide fereastra de
  membership. **Oprirea nu este niciodată blocată.**
- la `detectlab:authchange` (logout / plan expirat) toate catalogurile pornite
  sunt oprite, ca niciun strat premium să nu rămână desenat pe hartă.

## Interogări, performanță, erori

- Nimic nu este cerut până când un rând nu este pornit.
- Fiecare cerere este **numai pentru zona vizibilă**:
  `f=geojson` (fallback automat la `f=json`, convertit în GeoJSON),
  `geometry=<west,south,east,north>`, `geometryType=esriGeometryEnvelope`,
  `inSR=4326`, `outSR=4326`, `spatialRel=esriSpatialRelIntersects`,
  `resultRecordCount=6000`.
- Reinterogare pe `moveend` / `zoomend`, cu debounce de 220 ms; cererea în curs
  este anulată (`AbortController`) când rândul este oprit.
- Sub zoom-ul minim al rândului stratul este golit și linia de stare scrie
  „Zoom la 4+"; nu se trimite nicio cerere.
- `exceededTransferLimit` este raportat ca „parțial — mărește pentru restul",
  nu ascuns.
- O eroare de rețea / serviciu scrie „Temporar indisponibil" pe rând și un
  `console.warn`; nu aruncă excepții și nu golește harta.
- Geometrie: punctele devin `circleMarker` (în panoul propriu `pane_hoards`,
  z-index 622, deasupra registrelor de patrimoniu), iar linii/poligoane primesc
  contur + umplere translucidă în culoarea stratului — dacă DARMC schimbă
  geometria, stratul se desenează în continuare.
- Stratul „equivalent gold weight" scalează raza markerului după atributul
  numeric de greutate găsit în răspuns (numele coloanei este **descoperit** din
  date, niciodată presupus) și redesenează după prima interogare.

## Popup

Popup-ul afișează **atributele brute** ale înregistrării (până la 8 coloane
utile), nu o schemă inventată: DARMC publică coloane diferite per strat, iar o
mapare ghicită ar putea afișa alt secol ca „dată". Sunt eliminate doar câmpurile
tehnice (`OBJECTID`, `Shape__Area`, `Shape__Length`, `GlobalID`, câmpurile cu
`_` la început). Titlul folosește primul câmp de tip nume disponibil
(`Name`, `Site`, `Findspot`, `Title`…), altfel numele catalogului.

## i18n

- Titlul grupului: `layer_hoards` în `js/translations.js` (toate cele 25 de
  limbi ale meniului).
- Titlurile catalogurilor sunt compuse în modul din tabele de fraze
  (`PHRASE.carolingian`, `.gallic`, `.lateRoman`, `.after`, `.goldWeight`,
  `.depositDate`) pentru toate cele 25 de limbi —
  `test-layer-title-coverage.js` (care include acum `js/hoards-layers.js`)
  impune completitudinea.
- Textele ⓘ există în EN + RO; celelalte limbi primesc engleza prin fallback,
  ca în restul aplicației.
- La `detectlab:langchange` panoul se reconstruiește, păstrând starea
  comutatoarelor, opacitățile și datele deja încărcate (nu se reinteroghează).

## API public

`window.DetectLabHoards`: `SERVICE`, `sources`, `source(id)`, `isActive(id)`,
`setSource(id, on)` / `toggle`, `setSourceOpacity(id, value)`,
`setGroupOpacity(value)`, `toggleAll(on)`, `setExpanded(on)`, `groupInfo()`,
`sourceInfo(id)`, `filterForCountry(iso)`, `premiumAllowed()`, `refresh()`,
`statusOf(id)`.

Handlere inline folosite de `index.html`: `toggleHoardsLayers(checked)`,
`setHoardsOpacity(value)`, `setHoardsSourceOpacity(id, value)`,
`toggleHoardsSubLayers()`, `showHoardsGroupInfo()`, `showHoardsSourceInfo(id)`.

## Cache / Service Worker

`sw.js` pre-cachează modulul, foaia de stil și dicționarul cu aceleași URL-uri
versionate pe care le cere `index.html` (`?v=20261106-hoards`); cache-ul
shell-ului este ridicat la `detectlab-v411-hoards`. Gazdele `*.arcgis.com` sunt
deja în `PASSTHROUGH_HOSTS`, deci cererile FeatureServer nu intră niciodată în
cache-ul de shell.

## Licență / citare

© DARMC (Digital Atlas of Roman and Medieval Civilizations), Harvard
University. Seriile de tezaure sunt publicate de DARMC după:

- Coupland, S. (2011), *A Checklist of Carolingian Coin Hoards 751–987*,
  Numismatic Chronicle 171 — tezaurele carolingiene;
- Haupt, P. (2001) — tezaurele galice;
- Hobbs, R. (2006) — depozitele de metale prețioase din epoca romană târzie.

Serviciul este public și CORS-enabled (fără cheie, token sau proxy). Termenii
de reutilizare ai DARMC trebuie verificați înainte de o publicare comercială a
datelor; aplicația afișează atribuirea în fiecare rând (ⓘ și creditul din
popup).

## Test

```bash
node test-hoards-layers.js
```

Verifică: marcajul premium din `index.html`, absența oricărei porți de țară,
cele șapte straturi (cu ID-urile exacte și stratul 8 o singură dată), rândurile
generate (comutator/slider/procent/stare/ⓘ proprii), forma interogării
(viewport, EPSG:4326, intersects), comportamentul la `exceededTransferLimit`,
la eroare, la fallback-ul Esri JSON și la oprire, faptul că sliderul de
opacitate nu reinteroghează, vizibilitatea pentru orice ISO și în vederea
globală, poarta premium (inclusiv logout-ul), traducerile și cache-busting-ul.
