# PWA: săgeata și panoul ferestrelor minimizate coboară 1 mm

## Cerința

Săgeata de jos (`.apm-dock-tab`) și panoul ferestrelor minimizate
(`.apm-dock-list`) trebuie coborâte cu **1 mm**, doar în **aplicația instalată (PWA)**.
Pe web nu se schimbă nimic.

## Soluție

`css/next-gen-apm.css`, blocul `body.is-pwa .apm-dock`:

```css
body.is-pwa .apm-dock {
    bottom: calc(4px + var(--pwa-bleed, 0px));
    transform: translate(-50%, 2mm);   /* 1 mm de bază + 1 mm PWA */
}
```

Săgeata și panoul sunt copii ai aceluiași container `.apm-dock`, deci se mișcă
împreună. Web-ul păstrează `translate(-50%, 1mm)` din regula de bază.

Versiunea CSS este `css/next-gen-apm.css?v=20261102-pwa-dock-1mm`, actualizată în
`index.html` și în lista de precache din `sw.js`. `CACHE_NAME` este
`detectlab-v400-pwa-dock-1mm`, ca PWA-ul instalat să preia stilul nou.

## Verificare

`node test-map-window-dock.js` verifică regula PWA (`2mm`), regula de bază
pentru web (`1mm`) și tag-ul de cache.
