# Ferestrele redimensionate nu mai coboară sub „© Leafleet” în PWA (Android)

## Problema

În aplicația instalată pe Android, când trăgeam de mânerul de redimensionare
(grip-ul `⇕` de sus) al ferestrei **APM Next Gen**, fereastra „cădea” sub
padding-ul de jos al ecranului, sub nivelul etichetei **© Leafleet** și al
indicatorului de gesturi. Același lucru se putea întâmpla cu orice fereastră
care are grip: offline maps, RVT, LiDAR in 3D, info cards, panoul meteo etc.

## Cauza

`css/window-resize.css` aplica, pentru **orice** fereastră redimensionată:

```css
.dl-window-resized {
    top: auto !important;
    bottom: 0 !important;   /* ← problema */
}
```

`bottom: 0` ștergea offset-ul propriu al fiecărei ferestre. În PWA, `.map-frame`
are înălțimea `--pwa-viewport-h` = înălțimea fizică a ecranului, adică
viewport-ul paginei **plus** `--pwa-bleed` (partea acoperită de bara de gesturi).
Deci `bottom: 0` punea fereastra exact la marginea de jos a frame-ului — sub
ecranul vizibil. Eticheta „© Leafleet” este ridicată cu
`4px + var(--pwa-bleed)`, iar ferestrele au propriile clearances:

| Fereastră | `bottom` propriu în PWA |
| --- | --- |
| `.apm-panel` | `16px + max(44px + bleed, safe-area)` ≈ `60px + bleed` |
| `.offline-map-panel` | `8px + 44px + bleed` |
| `#rvt-body` / `.m3d-focus-card` | padding-ul containerului (`60px + bleed`) |
| `#iosBldSettingsPanel` | `124px + 44px + bleed` |

În plus, `bounds()` limita înălțimea doar la `viewport - 16`, fără să scadă
acest clearance: la înălțime maximă, partea de sus a ferestrei ieșea din ecran.

## Rezolvarea (generică, pentru toate ferestrele cu grip)

1. **Drag-ul schimbă doar `height`.** Regula globală `bottom: 0` a fost
   eliminată. Fiecare fereastră își păstrează propriul `bottom`, inclusiv
   `calc()`-urile care conțin `--pwa-bleed` și `env(safe-area-inset-bottom)` —
   deci se actualizează singure la rotire / când OS-ul stabilizează viewport-ul.
   Doar ferestrele întinse între ambele margini (`inset:0`, ex. chat-ul
   full-screen) primesc clasa `.dl-window-release-top` (`top: auto`), ca
   înălțimea explicită să aibă efect; `bottom`-ul lor rămâne intact.
   Decizia se face în `js/window-resize.js` (`readAnchor()` / `releaseTop()`)
   și e memorată per fereastră, ca să nu oscileze la fiecare `pointermove`.

2. **Înălțimea e limitată la spațiul liber de deasupra ferestrei.**
   `bounds(panel, bottom)` calculează acum
   `min(viewport - 16, frame - 16, frame - bottom - 16)`. Un drag „la maxim”
   împinge marginea de **sus** a ferestrei în sus, niciodată marginea de jos în
   jos. Valoarea coincide cu `max-height`-ul declarat de componente
   (`calc(100% - 16px - clearance)`), pe care JS-ul îl înlocuiește cu `!important`.

3. **Gardă PWA pentru toate ferestrele.** Dacă o fereastră ancorată jos are un
   `bottom` mai mic decât linia etichetei, primește clasa
   `.dl-window-bottom-safe`:

   ```css
   body.is-pwa .dl-window-resized.dl-window-bottom-safe {
       bottom: calc(12px + var(--pwa-bleed, 0px) + env(safe-area-inset-bottom, 0px)) !important;
   }
   ```

   Expresia e „live” (urmează `--pwa-bleed` și safe-area-ul dispozitivului), iar
   JS-ul o compară cu offset-ul real, măsurat printr-un probe invizibil. Nu se
   scrie niciodată un `bottom` inline, deci poziționarea proprie a componentei
   (inclusiv cele cu `!important`, ex. `#weatherPanel`) nu este alterată.
   Overlay-urile full-screen (`inset:0`) sunt excluse: ele au propriul padding
   pentru safe area și trebuie să acopere ecranul.

4. **Re-măsurare la `resize` / `orientationchange` / `visualViewport.resize`:**
   înălțimea și garda se recalculează, deci `--pwa-bleed` nou (rotire, apariția
   tastaturii, stabilizarea shell-ului standalone) nu lasă ferestre vechi în
   poziții greșite.

## Fișiere

| Fișier | Modificare |
| --- | --- |
| `css/window-resize.css` | fără `bottom:0` global; `.dl-window-release-top`; garda `body.is-pwa … .dl-window-bottom-safe` |
| `js/window-resize.js` | `readAnchor`, `releaseTop`, `pwaFloor`, `clearBottomGuard`, `bounds(panel, bottom)`, reflow |
| `index.html`, `sw.js` | re-tag `?v=20261102-pwa-window-resize-bottom-clearance` pentru CSS + JS, adăugate în `PRECACHE_URLS`, `CACHE_NAME` → `detectlab-v385-pwa-window-resize-bottom-clearance` (PWA-urile deja instalate primesc fix-ul) |
| `test-pwa-window-resize-clearance.js` | test de regresie (jsdom): APM, offline maps, overlay `inset:0`, ieșirea din PWA, rotire |
| `test-window-resize.js`, `test-apm-exclusions.js`, `test-apm-train-performance.js` | tag-urile / numele cache-ului actualizate |

## Teste

```bash
node test-pwa-window-resize-clearance.js
node test-window-resize.js
```

Verificare manuală pe Android (PWA instalată): deschide **APM Next Gen**, trage
grip-ul în sus până la maxim și apoi în jos — marginea de jos rămâne deasupra
etichetei **© Leafleet**; repetă cu Offline Maps, RVT, LiDAR in 3D, info card și
chat. Rotirea ecranului păstrează aceeași gardă.
