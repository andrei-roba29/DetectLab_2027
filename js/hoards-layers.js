/*
 * js/hoards-layers.js
 * ───────────────────────────────────────────────────────────────────────────
 * DetectLab · „Hoards / Tezaure” — a PREMIUM archaeological group for every
 * country on the globe.
 *
 * The seven catalogues are DARMC's (Digital Atlas of Roman and Medieval
 * Civilizations, Harvard University) published ArcGIS FeatureServer layers in
 * the `DARMC_Archaeological_Studies` service:
 *
 *   8   Carolingian coin hoards, 769–814 CE
 *   9   Carolingian coin hoards, 815–840 CE
 *   10  Carolingian coin hoards, 841–900 CE
 *   11  Carolingian coin hoards, after 900 CE
 *   12  Gallic coin hoards, 200–300 CE
 *   15  Late Roman precious-metal deposits, 200–700 CE (equivalent gold weight)
 *   16  Late Roman precious-metal deposits, 200–700 CE (deposit date)
 *
 * Layer 8 is the same hoard catalogue the user listed twice; the panel shows
 * it once (an id can only own one switch, one slider and one ⓘ).
 *
 * What this file does
 *   The group is one Romania-style `.transp-layer-row` in the PREMIUM tab of
 *   the layers window (index.html: #hoardsRow → #hoardsSubLayers). It carries
 *   a title, a group ⓘ, an expand chevron, a master switch and a group opacity
 *   slider. Every catalogue below it is a full sublayer row of its own — its
 *   own pill switch, its own opacity slider, its own percentage badge, its own
 *   status line (feature count / zoom hint / failure) and its own ⓘ that names
 *   that period's dates, provider and licence.
 *
 * All countries
 *   Unlike the national catalogues (Denmark, Finland, Albania, the UK
 *   registers) the DARMC hoards are not owned by one country: they cover every
 *   country in the dataset. The group therefore carries NO country
 *   attribution — `js/map-app.js` filterLayersForCountry() leaves rows with
 *   neither a country list nor a bounds record untouched, and `filter()` below
 *   keeps the group visible for every ISO, including the global (no country)
 *   view. The group is premium, so it is listed only in the Premium tab.
 *
 * Premium gate
 *   `data-category="premium"` already makes js/subscriptions.js block pointer
 *   interaction inside the row for free users; this module additionally guards
 *   its own API (premiumAllowed()) so no programmatic caller can switch a
 *   catalogue on, and it switches everything off when the plan lapses
 *   (detectlab:authchange). Switching OFF is never blocked.
 *
 * Laziness, viewport queries, failures
 *   Nothing is requested until a row is switched on. A source only asks its
 *   own FeatureServer for the visible map area (`esriGeometryEnvelope` +
 *   `esriSpatialRelIntersects`, f=geojson first, legacy f=json converted as a
 *   fallback), re-queries on moveend/zoomend with a short debounce, aborts the
 *   in-flight request when it is switched off, and stays silent below its own
 *   minimum zoom. The row's status line reports the feature count, the zoom
 *   hint or “temporarily unavailable” — never a stack trace. A partial answer
 *   (ArcGIS `exceededTransferLimit`) is reported as such instead of silently
 *   showing half the records.
 *
 * Geometry
 *   FeatureServer 15/16 publish the deposits the same way the coin hoards are
 *   published — as point features — but the renderer does not assume it:
 *   points become circle markers, lines and polygons get a translucent fill of
 *   the layer's own colour, so a change of geometry upstream still draws. The
 *   "equivalent gold weight" layer scales a marker's radius by its own weight
 *   field when the response carries one (see weightScale()).
 *
 * Public API — `window.DetectLabHoards`
 *   sources, source, isActive, setSource (alias toggle), setSourceOpacity,
 *   setGroupOpacity, toggleAll, setExpanded, groupInfo, sourceInfo,
 *   filterForCountry, premiumAllowed, refresh, statusOf. The inline handlers in
 *   index.html (`toggleHoardsLayers`, `setHoardsOpacity`,
 *   `toggleHoardsSubLayers`, `showHoardsGroupInfo`) are the same functions.
 */
(function (window, document) {
    'use strict';
    if (!window || !document || !window.L) return;

    /* ── the service ─────────────────────────────────────────────────────── */

    var SERVICE = 'https://services1.arcgis.com/qN3V93cYGMKQCOxL/arcgis/rest/services/DARMC_Archaeological_Studies/FeatureServer/';
    var PROVIDER = 'DARMC · Harvard University';
    var LICENCE = '© DARMC (Digital Atlas of Roman and Medieval Civilizations), Harvard University';

    /* The language codes the app offers (js/layer-registry.js ALL_LANG_CODES,
     * minus the legacy Russian pack). Every generated label is complete in all
     * of them — test-layer-title-coverage.js enforces it. */
    var LANGS = ['en', 'ro', 'de', 'fr', 'it', 'es', 'pl', 'uk', 'hu', 'cs', 'sk',
        'nl', 'bg', 'el', 'pt', 'da', 'sv', 'no', 'fi', 'et', 'lv', 'lt', 'hr', 'sr', 'sl'];

    /* The three catalogue names + the two date-qualified variants. Kept as
     * separate phrase tables so a label can be composed for every language
     * without repeating 25 × 7 literals. */
    var PHRASE = {
        carolingian: {
            en: 'Carolingian coin hoards', ro: 'Tezaure monetare carolingiene',
            de: 'Karolingische Münzhortfunde', fr: 'Trésors monétaires carolingiens',
            it: 'Ripostigli monetali carolingi', es: 'Tesoros monetarios carolingios',
            pl: 'Skarby monet karolińskich', uk: 'Каролінзькі монетні скарби',
            hu: 'Karoling éremkincsek', cs: 'Karolinské mincovní depoty',
            sk: 'Karolínske mincové depoty', nl: 'Karolingische muntschatten',
            bg: 'Каролингски монетни съкровища', el: 'Καρολίγγειοι θησαυροί νομισμάτων',
            pt: 'Tesouros monetários carolíngios', da: 'Karolingiske møntskatte',
            sv: 'Karolingiska myntskatter', no: 'Karolingiske myntskatter',
            fi: 'Karolingilaiset raha-aarteet', et: 'Karolingide mündiaarded',
            lv: 'Karolingu monētu depozīti', lt: 'Karolingų monetų lobiai',
            hr: 'Karolinške ostave novca', sr: 'Каролиншке оставе новца',
            sl: 'Karolinški denarni zakladi'
        },
        gallic: {
            en: 'Gallic coin hoards', ro: 'Tezaure monetare galice',
            de: 'Gallische Münzhortfunde', fr: 'Trésors monétaires gaulois',
            it: 'Ripostigli monetali gallici', es: 'Tesoros monetarios galos',
            pl: 'Skarby monet galijskich', uk: 'Галльські монетні скарби',
            hu: 'Gall éremkincsek', cs: 'Galští mincovní depoty',
            sk: 'Galské mincové depoty', nl: 'Gallische muntschatten',
            bg: 'Галски монетни съкровища', el: 'Γαλατικοί θησαυροί νομισμάτων',
            pt: 'Tesouros monetários gauleses', da: 'Galliske møntskatte',
            sv: 'Galliska myntskatter', no: 'Galliske myntskatter',
            fi: 'Gallialaiset raha-aarteet', et: 'Gallia mündiaarded',
            lv: 'Galju monētu depozīti', lt: 'Galų monetų lobiai',
            hr: 'Galske ostave novca', sr: 'Галске оставе новца',
            sl: 'Galski denarni zakladi'
        },
        lateRoman: {
            en: 'Late Roman precious-metal deposits', ro: 'Depozite de metale prețioase din epoca romană târzie',
            de: 'Spätrömische Edelmetallhorte', fr: 'Dépôts de métaux précieux de l’Antiquité tardive',
            it: 'Depositi di metalli preziosi tardo-romani', es: 'Depósitos de metales preciosos tardo-romanos',
            pl: 'Późnorzymskie depozyty metali szlachetnych', uk: 'Пізньоримські депозити дорогоцінних металів',
            hu: 'Késő római nemesfém depók', cs: 'Pozdně římské depoty drahých kovů',
            sk: 'Neskororímske depoty drahých kovov', nl: 'Laatromeinse edelmetaaldepots',
            bg: 'Късноримски депозити от благородни метали', el: 'Ύστερες ρωμαϊκές αποθέσεις πολύτιμων μετάλλων',
            pt: 'Depósitos de metais preciosos do Baixo Império', da: 'Senromerske ædelmetaldepoter',
            sv: 'Senromerska ädelmetallfynd', no: 'Senromerske edelmetalldepoter',
            fi: 'Myöhäisroomalaiset jalometallilöydöt', et: 'Hilis-Rooma väärismetallide ladestused',
            lv: 'Vēlās Romas dārgmetālu depozīti', lt: 'Vėlyvosios Romos tauriųjų metalų depozitai',
            hr: 'Kasnorimske ostave plemenitih metala', sr: 'Касноримске оставе племенитих метала',
            sl: 'Poznorimski depoziti plemenitih kovin'
        },
        after: {
            en: 'after', ro: 'după', de: 'nach', fr: 'après', it: 'dopo', es: 'después de',
            pl: 'po', uk: 'після', hu: 'után', cs: 'po', sk: 'po', nl: 'na', bg: 'след',
            el: 'μετά το', pt: 'depois de', da: 'efter', sv: 'efter', no: 'etter',
            fi: 'jälkeen', et: 'pärast', lv: 'pēc', lt: 'po', hr: 'nakon', sr: 'после',
            sl: 'po'
        },
        goldWeight: {
            en: 'equivalent gold weight', ro: 'echivalent greutate aur',
            de: 'Goldäquivalentgewicht', fr: 'équivalent-poids en or',
            it: 'peso equivalente in oro', es: 'peso equivalente en oro',
            pl: 'równoważnik masy złota', uk: 'еквівалент маси золота',
            hu: 'arany egyenérték tömeg', cs: 'ekvivalent hmotnosti zlata',
            sk: 'ekvivalent hmotnosti zlata', nl: 'goudgewichtequivalent',
            bg: 'еквивалент на тегло в злато', el: 'ισοδύναμο βάρος χρυσού',
            pt: 'equivalente em peso de ouro', da: 'ækvivalent guldvægt',
            sv: 'motsvarande guldvikt', no: 'tilsvarende gullvekt',
            fi: 'kultapainon ekvivalentti', et: 'kulla ekvivalentkaal',
            lv: 'zelta svara ekvivalents', lt: 'aukso svorio ekvivalentas',
            hr: 'ekvivalent težine zlata', sr: 'еквивалент тежине злата',
            sl: 'ekvivalent zlata po teži'
        },
        depositDate: {
            en: 'deposit date', ro: 'datarea depozitului', de: 'Deponierungsdatum',
            fr: 'date d’enfouissement', it: 'data di deposizione', es: 'fecha de depósito',
            pl: 'data zdeponowania', uk: 'дата депонування', hu: 'elrejtés dátuma',
            cs: 'datum uložení', sk: 'dátum uloženia', nl: 'depositiedatum',
            bg: 'дата на депозиране', el: 'ημερομηνία απόθεσης', pt: 'data de depósito',
            da: 'deponeringsdato', sv: 'deponeringsdatum', no: 'deponeringsdato',
            fi: 'tallettamispäivä', et: 'ladestamise kuupäev', lv: 'deponēšanas datums',
            lt: 'deponavimo data', hr: 'datum ostavljanja', sr: 'датум остављања',
            sl: 'datum odložitve'
        }
    };

    /* Compose a translated label: `<phrase> — <tail>` in every language. The
     * tail is a date range / qualifier; digits and en-dashes travel as-is. */
    function labelOf(phraseKey, tail) {
        var out = {};
        LANGS.forEach(function (code) {
            out[code] = PHRASE[phraseKey][code] + ' — ' + tail;
        });
        return out;
    }
    /** Suffix whose qualifier itself is translated, e.g. “200–700 (gold weight)”. */
    function labelWithQualifier(phraseKey, range, qualifierKey) {
        var out = {};
        LANGS.forEach(function (code) {
            out[code] = PHRASE[phraseKey][code] + ' — ' + range + ' (' + PHRASE[qualifierKey][code] + ')';
        });
        return out;
    }

    /* ── the seven catalogues ────────────────────────────────────────────── */

    var SOURCES = [
        {
            id: 'carolingian-769-814',
            layerId: 8,
            label: labelOf('carolingian', '769–814 CE'),
            provider: PROVIDER,
            colour: '#e8c15a',
            minZoom: 4,
            attribution: LICENCE + ' · Coupland (2011), A Checklist of Carolingian Coin Hoards 751–987',
            info: {
                en: 'Carolingian coin hoards deposited between 769 and 814 CE (the reign of Charlemagne). One record per hoard, queried live from DARMC’s ArcGIS FeatureServer for the visible map area.',
                ro: 'Tezaure monetare carolingiene depuse între 769 și 814 d.Hr. (domnia lui Carol cel Mare). O înregistrare per tezaur, interogată live din ArcGIS FeatureServer al DARMC pentru zona vizibilă a hărții.'
            }
        },
        {
            id: 'carolingian-815-840',
            layerId: 9,
            label: labelOf('carolingian', '815–840 CE'),
            provider: PROVIDER,
            colour: '#dfa03f',
            minZoom: 4,
            attribution: LICENCE + ' · Coupland (2011), A Checklist of Carolingian Coin Hoards 751–987',
            info: {
                en: 'Carolingian coin hoards deposited between 815 and 840 CE (Louis the Pious). One record per hoard, queried live from DARMC’s ArcGIS FeatureServer for the visible map area.',
                ro: 'Tezaure monetare carolingiene depuse între 815 și 840 d.Hr. (Ludovic cel Pios). O înregistrare per tezaur, interogată live din ArcGIS FeatureServer al DARMC pentru zona vizibilă a hărții.'
            }
        },
        {
            id: 'carolingian-841-900',
            layerId: 10,
            label: labelOf('carolingian', '841–900 CE'),
            provider: PROVIDER,
            colour: '#d07a3c',
            minZoom: 4,
            attribution: LICENCE + ' · Coupland (2011), A Checklist of Carolingian Coin Hoards 751–987',
            info: {
                en: 'Carolingian coin hoards deposited between 841 and 900 CE — the partitioned empire and its successors. One record per hoard, queried live from DARMC’s ArcGIS FeatureServer for the visible map area.',
                ro: 'Tezaure monetare carolingiene depuse între 841 și 900 d.Hr. — imperiul împărțit și succesorii lui. O înregistrare per tezaur, interogată live din ArcGIS FeatureServer al DARMC pentru zona vizibilă a hărții.'
            }
        },
        {
            id: 'carolingian-after-900',
            layerId: 11,
            label: (function () {
                var out = {};
                LANGS.forEach(function (code) {
                    out[code] = PHRASE.carolingian[code] + ' — ' + PHRASE.after[code] + ' 900 CE';
                });
                return out;
            }()),
            provider: PROVIDER,
            colour: '#b4553f',
            minZoom: 4,
            attribution: LICENCE + ' · Coupland (2011), A Checklist of Carolingian Coin Hoards 751–987',
            info: {
                en: 'Carolingian coin hoards deposited after 900 CE — the latest group in the checklist, deposited when Carolingian coins were already circulating alongside new issues. Queried live from DARMC’s ArcGIS FeatureServer for the visible map area.',
                ro: 'Tezaure monetare carolingiene depuse după 900 d.Hr. — ultimul grup din listă, depus când monedele carolingiene circulau deja alături de emisiuni noi. Interogat live din ArcGIS FeatureServer al DARMC pentru zona vizibilă a hărții.'
            }
        },
        {
            id: 'gallic-200-300',
            layerId: 12,
            label: labelOf('gallic', '200–300 CE'),
            provider: PROVIDER,
            colour: '#8fae56',
            minZoom: 4,
            attribution: LICENCE + ' · Haupt (2001)',
            info: {
                en: 'Gallic coin hoards deposited between 200 and 300 CE, i.e. the decades before and during the Gallic Empire. One record per hoard, queried live from DARMC’s ArcGIS FeatureServer for the visible map area.',
                ro: 'Tezaure monetare galice depuse între 200 și 300 d.Hr., adică deceniile dinaintea și din timpul Imperiului Galic. O înregistrare per tezaur, interogată live din ArcGIS FeatureServer al DARMC pentru zona vizibilă a hărții.'
            }
        },
        {
            id: 'late-roman-gold-weight',
            layerId: 15,
            label: labelWithQualifier('lateRoman', '200–700 CE', 'goldWeight'),
            provider: PROVIDER,
            colour: '#f0d97a',
            minZoom: 4,
            weightScale: true,
            attribution: LICENCE + ' · Hobbs (2006), Late Roman precious metal deposits',
            info: {
                en: 'Late Roman precious-metal deposits (200–700 CE), drawn by their equivalent gold weight: the heavier the deposit’s gold equivalent, the larger the marker. Values are queried live from DARMC’s ArcGIS FeatureServer for the visible map area; the popup prints the raw attributes.',
                ro: 'Depozite de metale prețioase din epoca romană târzie (200–700 d.Hr.), desenate după echivalentul lor în aur: cu cât echivalentul este mai mare, cu atât markerul este mai mare. Valorile sunt interogate live din ArcGIS FeatureServer al DARMC pentru zona vizibilă a hărții; popup-ul afișează atributele brute.'
            }
        },
        {
            id: 'late-roman-deposit-date',
            layerId: 16,
            label: labelWithQualifier('lateRoman', '200–700 CE', 'depositDate'),
            provider: PROVIDER,
            colour: '#a98bd6',
            minZoom: 4,
            attribution: LICENCE + ' · Hobbs (2006), Late Roman precious metal deposits',
            info: {
                en: 'The same Late Roman precious-metal deposits (200–700 CE) drawn as a time series: this is DARMC’s deposit-date view of the catalogue. Queried live from DARMC’s ArcGIS FeatureServer for the visible map area; the popup prints the raw attributes.',
                ro: 'Aceleleași depozite de metale prețioase din epoca romană târzie (200–700 d.Hr.), desenate ca serie temporală: este vedere după datarea depozitului din catalogul DARMC. Interogată live din ArcGIS FeatureServer al DARMC pentru zona vizibilă a hărții; popup-ul afișează atributele brute.'
            }
        }
    ];

    /* The few labels this module generates itself. Everything static in the
     * group markup (title, switch titles) lives in index.html with data-key
     * attributes and therefore travels through js/translations.js. */
    var TEXT = {
        toggle: { en: 'Toggle', ro: 'Comută' },
        layerInfo: { en: 'Layer info', ro: 'Informații strat' },
        opacity: { en: 'Opacity', ro: 'Opacitate' },
        loading: { en: 'Loading…', ro: 'Se încarcă…' },
        unavailable: { en: 'Temporarily unavailable', ro: 'Temporar indisponibil' },
        zoomTo: { en: 'Zoom to', ro: 'Zoom la' },
        features: { en: 'features', ro: 'elemente' },
        none: { en: 'No records in this view', ro: 'Nicio înregistrare în această zonă' },
        partial: { en: 'partial — zoom in for the rest', ro: 'parțial — mărește pentru restul' },
        provider: { en: 'Provider', ro: 'Furnizor' },
        zoomLimit: { en: 'shown from zoom', ro: 'afișat de la zoom' },
        noValue: { en: 'no value', ro: 'fără valoare' },
        groupInfo: {
            en: 'Seven DARMC (Harvard) catalogues of coin hoards and precious-metal deposits, from Gaul under the Gallic Empire to the Carolingian empire and the late Roman West. Every catalogue has its own on/off switch, its own opacity slider and its own ⓘ (dates, provider, licence, zoom limit). Records are requested for the visible map area only while a catalogue is switched on — switch on several to compare periods.',
            ro: 'Șapte cataloguri DARMC (Harvard) de tezaure monetare și depozite de metale prețioase, din Galia Imperiului Galic până în imperiul carolingian și Occidentul roman târziu. Fiecare catalog are propriul comutator, propriul slider de opacitate și propriul ⓘ (perioadă, furnizor, licență, nivel de zoom). Înregistrările sunt cerute doar pentru zona vizibilă a hărții, doar cât timp catalogul este pornit — pornește mai multe pentru a compara perioadele.'
        }
    };

    var GROUP_ID = 'hoardsRow';
    var MOUNT_ID = 'hoardsSubLayers';
    var PANE = 'pane_hoards';
    var PANE_Z = 622;
    var DEFAULT_OPACITY = 85;
    var DEBOUNCE_MS = 220;
    var MAX_RECORDS = 6000;
    var MIN_RADIUS = 4;
    var MAX_RADIUS = 15;

    /* ── state ───────────────────────────────────────────────────────────── */

    var state = {
        map: null,
        active: {},       /* source id → switch on */
        opacity: {},      /* source id → 0…100 */
        groupOpacity: DEFAULT_OPACITY,
        layers: {},       /* source id → L.GeoJSON */
        aborters: {},
        counts: {},
        status: {},
        statusKind: {},
        expanded: true,
        timer: null,
        rows: {},
        weightField: {}   /* source id → discovered weight attribute name */
    };

    /* ── small helpers ───────────────────────────────────────────────────── */

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function lang() {
        try {
            if (typeof window._currentLang === 'function') return String(window._currentLang() || 'en');
        } catch (e) { /* private mode / translations not loaded yet */ }
        var htmlLang = document.documentElement && document.documentElement.getAttribute('lang');
        return String(htmlLang || 'en');
    }
    function tr(pair) {
        if (!pair) return '';
        if (typeof pair === 'string') return pair;
        var l = lang().toLowerCase();
        return pair[l] || pair.en || pair.ro || '';
    }

    function source(id) {
        for (var i = 0; i < SOURCES.length; i++) if (SOURCES[i].id === id) return SOURCES[i];
        return null;
    }
    function label(s) { return tr(s.label); }
    function clampi(value) {
        var n = Number(value);
        if (!isFinite(n)) return DEFAULT_OPACITY;
        return Math.max(0, Math.min(100, Math.round(n)));
    }
    function opacityPct(s) {
        var v = state.opacity[s.id];
        return v === undefined ? DEFAULT_OPACITY : v;
    }
    function opacityFactor(s) { return opacityPct(s) / 100; }
    function getMap() { return window._dlMap || window.map || window._map || null; }

    function showInfo(title, credits, description) {
        if (typeof window.showLayerInfo === 'function') {
            window.showLayerInfo(title, credits, description);
            return true;
        }
        return false;
    }

    /* Premium gate. The group and its rows are `data-category="premium"`, so
     * js/subscriptions.js already blocks pointer interaction inside the row for
     * free users (its capture-phase click handler opens the membership modal).
     * That only covers UI events, so the programmatic API guards itself too:
     * a free user can never switch a catalogue on from the console, a deep
     * link or another module. Turning a catalogue OFF is always allowed. */
    function premiumAllowed() {
        try {
            if (typeof window._dlIsPremium === 'function') return !!window._dlIsPremium();
        } catch (e) { /* subscription layer unavailable → do not block */ }
        return true;
    }

    function denyPremium() {
        SOURCES.forEach(function (s) {
            state.active[s.id] = false;
            var layer = state.layers[s.id];
            if (layer && state.map && state.map.hasLayer(layer)) state.map.removeLayer(layer);
            if (layer && typeof layer.clearLayers === 'function') layer.clearLayers();
            setStatus(s.id, '');
        });
        syncUI();
        applyCurrentTab();
        /* The subscription layer normally opens the modal itself; if the click
         * never reached it (programmatic call), ask for the membership window
         * directly. */
        if (typeof window.openPremiumModal === 'function') {
            try { window.openPremiumModal(); } catch (e) { /* never break on upsell */ }
        }
    }

    /* ── attributes and popups ───────────────────────────────────────────── */

    var HIDDEN_FIELDS = /^(objectid|fid|shape|shape_?length|shape_?area|geometry|globalid)$/i;
    var TITLE_FIELDS = ['Name', 'NAME', 'name', 'Title', 'TITLE', 'Hoard', 'HOARD',
        'Site', 'SITE', 'Findspot', 'FindSpot', 'FINDSPOT', 'Label', 'LABEL', 'Description'];
    var WEIGHT_FIELDS = /(equival.*gold|gold.*equival|weight|gewicht|poids|peso|gold)/i;

    function prettifyField(key) {
        return String(key)
            .replace(/[_-]+/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/\s+/g, ' ')
            .replace(/^./, function (c) { return c.toUpperCase(); });
    }

    function formatValue(value) {
        if (value === null || value === undefined || value === '') return '';
        if (typeof value === 'number') {
            if (!isFinite(value)) return '';
            return (Math.abs(value) >= 1000)
                ? value.toLocaleString(lang() === 'ro' ? 'ro-RO' : 'en-GB')
                : String(value);
        }
        if (typeof value === 'boolean') return value ? '✓' : '—';
        var text = String(value);
        if (text === 'Null' || text === 'NULL' || text === 'null') return '';
        return text;
    }

    function titleOf(feature, s) {
        var p = (feature && feature.properties) || {};
        for (var i = 0; i < TITLE_FIELDS.length; i++) {
            var v = formatValue(p[TITLE_FIELDS[i]]);
            if (v) return v;
        }
        return label(s);
    }

    /* The popup prints the record's own attributes instead of inventing a
     * schema: DARMC publishes different columns per layer, and a guessed
     * mapping would print the wrong century as "date". `_date`, `_ms` and
     * similar ArcGIS bookkeeping columns are dropped. */
    function popup(feature, s) {
        var p = (feature && feature.properties) || {};
        var rows = [];
        Object.keys(p).forEach(function (key) {
            if (rows.length >= 8) return;
            if (HIDDEN_FIELDS.test(key)) return;
            if (/^_/.test(key)) return;
            var value = formatValue(p[key]);
            if (!value) return;
            rows.push('<span class="hoards-popup-row"><b>' + esc(prettifyField(key)) + ':</b> ' + esc(value) + '</span>');
        });
        var body = rows.length
            ? rows.join('')
            : '<span class="hoards-popup-row">' + esc(tr(TEXT.noValue)) + '</span>';
        return '<strong>' + esc(titleOf(feature, s)) + '</strong>' +
            '<span class="hoards-popup-source">' + esc(label(s)) + '</span>' + body;
    }

    /* Equivalent-gold-weight layers: scale the marker by the record's own
     * weight attribute when the service publishes one. The attribute name is
     * discovered from the first response (never hard-coded) and remembered. */
    function discoverWeightField(id, features) {
        if (state.weightField[id]) return state.weightField[id];
        for (var i = 0; i < features.length; i++) {
            var p = features[i] && features[i].properties;
            if (!p) continue;
            var keys = Object.keys(p);
            for (var k = 0; k < keys.length; k++) {
                if (WEIGHT_FIELDS.test(keys[k]) && isFinite(Number(p[keys[k]]))) {
                    state.weightField[id] = keys[k];
                    return keys[k];
                }
            }
        }
        return null;
    }

    function weightScale(s, feature) {
        if (!s.weightScale) return { radius: 6, weight: 1 };
        var field = state.weightField[s.id];
        var value = field && feature && feature.properties ? Number(feature.properties[field]) : NaN;
        if (!isFinite(value) || value <= 0) return { radius: 5, weight: 1 };
        var radius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, 3 + Math.sqrt(value) * 1.6));
        return { radius: radius, weight: value > 40 ? 1.6 : (value > 10 ? 1.2 : 1) };
    }

    /* ── map geometry style (the same colour language as the rows) ───────── */

    function styleFor(s, feature) {
        var o = opacityFactor(s);
        var kind = feature && feature.geometry && feature.geometry.type;
        if (kind === 'Point' || kind === 'MultiPoint') {
            var scale = weightScale(s, feature);
            return {
                radius: scale.radius,
                weight: scale.weight,
                color: '#ffffff',
                opacity: 0.85 * o,
                fillColor: s.colour,
                fillOpacity: 0.9 * o
            };
        }
        return {
            color: s.colour,
            weight: 1.5,
            opacity: 0.9 * o,
            fillColor: s.colour,
            fillOpacity: 0.2 * o
        };
    }

    function ensureLayer(s) {
        if (state.layers[s.id]) return state.layers[s.id];
        state.layers[s.id] = window.L.geoJSON(null, {
            pane: PANE,
            style: function (feature) { return styleFor(s, feature); },
            pointToLayer: function (feature, latlng) {
                return window.L.circleMarker(latlng, window.L.Util.extend({ pane: PANE }, styleFor(s, feature)));
            },
            onEachFeature: function (feature, layer) { layer.bindPopup(popup(feature, s)); }
        });
        return state.layers[s.id];
    }

    /* The slider repaints the existing geometry instead of re-querying it. */
    function applyOpacity(s) {
        var layer = state.layers[s.id];
        if (!layer || typeof layer.eachLayer !== 'function') return;
        layer.eachLayer(function (child) {
            if (child && typeof child.setStyle === 'function') child.setStyle(styleFor(s, child.feature));
        });
    }

    /* ── status line ─────────────────────────────────────────────────────── */

    function paintStatus(node, text, kind) {
        if (!node) return;
        node.textContent = text || '';
        node.style.display = text ? 'block' : 'none';
        node.className = 'hoards-status' + (kind ? ' is-' + kind : '');
        node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    }

    function setStatus(id, text, kind) {
        state.status[id] = text || '';
        state.statusKind[id] = kind || '';
        paintStatus(document.getElementById('hoardsStatus-' + id), text, kind);
    }

    function countStatus(id, count, partial) {
        if (!count) {
            setStatus(id, tr(TEXT.none), 'hint');
            return;
        }
        setStatus(id, count.toLocaleString() + ' ' + tr(TEXT.features) +
            (partial ? ' · ' + tr(TEXT.partial) : ''), 'count');
    }

    /* ── ArcGIS responses ────────────────────────────────────────────────── */

    /* f=geojson is the fast path. Older/edge deployments answer with the
     * classic Esri JSON (`features[].geometry.x / .paths / .rings`), so the
     * same response is converted rather than shown as “no records”. */
    function esriToGeoJSON(data) {
        if (!data) return { type: 'FeatureCollection', features: [] };
        if (data.type === 'FeatureCollection') return data;
        var features = (data.features || []).map(function (item) {
            var attributes = item.attributes || {};
            var geometry = item.geometry || null;
            var geo = null;
            if (geometry) {
                if (geometry.x !== undefined && geometry.y !== undefined) {
                    geo = { type: 'Point', coordinates: [geometry.x, geometry.y] };
                } else if (geometry.points) {
                    geo = { type: 'MultiPoint', coordinates: geometry.points };
                } else if (geometry.paths) {
                    geo = { type: 'MultiLineString', coordinates: geometry.paths };
                } else if (geometry.rings) {
                    geo = { type: 'Polygon', coordinates: geometry.rings };
                }
            }
            return { type: 'Feature', properties: attributes, geometry: geo };
        }).filter(function (feature) { return !!feature.geometry; });
        return { type: 'FeatureCollection', features: features };
    }

    /* ── fetching (viewport only, cancellable, per source) ───────────────── */

    function queryUrl(s, format) {
        var b = state.map.getBounds();
        var params = new window.URLSearchParams({
            f: format,
            where: '1=1',
            outFields: '*',
            returnGeometry: 'true',
            geometry: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(','),
            geometryType: 'esriGeometryEnvelope',
            inSR: '4326',
            outSR: '4326',
            spatialRel: 'esriSpatialRelIntersects',
            resultRecordCount: String(MAX_RECORDS)
        });
        return SERVICE + s.layerId + '/query?' + params.toString();
    }

    function fetchJson(url, requestOptions) {
        return fetch(url, requestOptions).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        });
    }

    function load(s) {
        if (!state.map || !state.active[s.id]) return;

        if (state.map.getZoom() < s.minZoom) {
            ensureLayer(s).clearLayers();
            state.counts[s.id] = 0;
            setStatus(s.id, tr(TEXT.zoomTo) + ' ' + s.minZoom + '+', 'hint');
            return;
        }

        if (state.aborters[s.id]) state.aborters[s.id].abort();
        var controller = window.AbortController ? new window.AbortController() : null;
        state.aborters[s.id] = controller;
        var requestOptions = controller ? { signal: controller.signal } : {};

        setStatus(s.id, tr(TEXT.loading), 'loading');

        fetchJson(queryUrl(s, 'geojson'), requestOptions).then(function (data) {
            if (data && data.error) throw new Error(data.error.message || 'ArcGIS error');
            return data;
        }).catch(function (err) {
            if (err && err.name === 'AbortError') throw err;
            /* f=geojson unsupported → retry the same viewport as classic JSON. */
            return fetchJson(queryUrl(s, 'json'), requestOptions).then(function (data) {
                if (data && data.error) throw new Error(data.error.message || 'ArcGIS error');
                return data;
            });
        }).then(function (data) {
            if (!state.active[s.id]) return;
            var collection = esriToGeoJSON(data);
            var features = collection.features || [];
            var layer = ensureLayer(s);
            layer.clearLayers();
            layer.addData(collection);
            discoverWeightField(s.id, features);
            state.counts[s.id] = features.length;
            countStatus(s.id, features.length, !!(data && data.exceededTransferLimit));
            /* The radius depends on the weight field discovered above, so
             * repaint once now that the field is known. */
            if (s.weightScale) applyOpacity(s);
        }).catch(function (err) {
            if (err && err.name === 'AbortError') return;
            if (!state.active[s.id]) return;
            setStatus(s.id, tr(TEXT.unavailable), 'error');
            if (window.console) window.console.warn('[Hoards] ' + s.id, err);
        });
    }

    function refresh() {
        window.clearTimeout(state.timer);
        state.timer = window.setTimeout(function () {
            SOURCES.forEach(function (s) { if (state.active[s.id]) load(s); });
        }, DEBOUNCE_MS);
    }

    /* ── switching ───────────────────────────────────────────────────────── */

    function setSource(id, on, silent) {
        var s = source(id);
        if (!s) return;
        if (on && !premiumAllowed()) {
            denyPremium();
            return;
        }
        state.active[id] = !!on;
        if (!state.map) {
            if (!silent) syncUI();
            return;
        }
        var layer = ensureLayer(s);
        if (on) {
            if (!state.map.hasLayer(layer)) layer.addTo(state.map);
            load(s);
        } else {
            if (state.aborters[id]) state.aborters[id].abort();
            state.counts[id] = 0;
            if (state.map.hasLayer(layer)) state.map.removeLayer(layer);
            layer.clearLayers();
            setStatus(id, '');
        }
        if (!silent) syncUI();
    }

    function toggleAll(on) {
        if (on && !premiumAllowed()) {
            denyPremium();
            return;
        }
        SOURCES.forEach(function (s) { setSource(s.id, !!on, true); });
        syncUI();
    }

    function setSourceOpacity(id, value) {
        var s = source(id);
        if (!s) return;
        state.opacity[id] = clampi(value);
        applyOpacity(s);
        var pct = document.getElementById('hoardsPct-' + id);
        if (pct) pct.textContent = state.opacity[id] + '%';
        var slider = document.getElementById('hoardsOpacity-' + id);
        if (slider && String(slider.value) !== String(state.opacity[id])) slider.value = String(state.opacity[id]);
    }

    function setGroupOpacity(value) {
        state.groupOpacity = clampi(value);
        SOURCES.forEach(function (s) {
            state.opacity[s.id] = state.groupOpacity;
            applyOpacity(s);
        });
        syncUI();
    }

    /* ── the panel ───────────────────────────────────────────────────────── */

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (key) {
            if (key === 'text') node.textContent = attrs[key];
            else if (key === 'html') node.innerHTML = attrs[key];
            else if (key === 'style') node.setAttribute('style', attrs[key]);
            else if (attrs[key] !== undefined && attrs[key] !== null) node.setAttribute(key, attrs[key]);
        });
        (children || []).forEach(function (child) { if (child) node.appendChild(child); });
        return node;
    }

    var INFO_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" />' +
        '<circle cx="12" cy="7.5" r="1.3" fill="currentColor" />' +
        '<rect x="10.8" y="10.5" width="2.4" height="7" rx="1.2" fill="currentColor" /></svg>';

    /* One row per catalogue: title + provider on the left, the pill switch on
     * the right, then the shared “Opacity ⓘ 85%” line and the shared slider —
     * the exact shape of Romania's sublayers and the UK heritage rows. */
    function buildRow(s) {
        var title = label(s);
        var isOn = !!state.active[s.id];

        var input = el('input', {
            type: 'checkbox',
            id: 'hoardsToggle-' + s.id,
            'data-hoards-input': s.id,
            'aria-label': title
        });
        input.checked = isOn;
        input.addEventListener('change', function () { setSource(s.id, input.checked); });

        var toggle = el('label', {
            class: 'apm-toggle-switch',
            title: tr(TEXT.toggle) + ' ' + title,
            style: 'transform:scale(0.85);transform-origin:right center;flex-shrink:0;'
        }, [input, el('span', { class: 'apm-toggle-track' })]);

        var head = el('div', { class: 'hoards-head' }, [
            el('span', { class: 'hoards-title-wrap' }, [
                el('i', { class: 'hoards-dot', style: 'background:' + s.colour, 'aria-hidden': 'true' }),
                el('span', { class: 'hoards-title', text: title }),
                el('span', { class: 'hoards-provider', text: 'DARMC' })
            ]),
            toggle
        ]);

        var info = el('button', {
            type: 'button',
            class: 'layer-info-btn',
            'data-hoards-info': s.id,
            title: tr(TEXT.layerInfo) + ' — ' + title,
            'aria-label': tr(TEXT.layerInfo) + ' — ' + title,
            html: INFO_ICON
        });
        info.addEventListener('click', function (event) {
            if (event && event.preventDefault) event.preventDefault();
            if (event && event.stopPropagation) event.stopPropagation();
            sourceInfo(s.id);
        });

        var pct = el('span', {
            class: 'pct hoards-pct',
            id: 'hoardsPct-' + s.id,
            text: opacityPct(s) + '%'
        });

        var opacityLine = el('div', { class: 'transp-layer-label hoards-opacity-line' }, [
            el('span', { style: 'font-size:0.72rem;opacity:0.6', text: tr(TEXT.opacity) }),
            el('span', { style: 'display:flex;align-items:center;gap:5px' }, [info, pct])
        ]);

        var slider = el('input', {
            type: 'range',
            class: 'transp-slider hoards-slider',
            id: 'hoardsOpacity-' + s.id,
            min: '0', max: '100', step: '1',
            value: String(opacityPct(s)),
            'aria-label': tr(TEXT.opacity) + ' — ' + title
        });
        slider.addEventListener('input', function () { setSourceOpacity(s.id, slider.value); });

        var status = el('div', {
            class: 'hoards-status',
            id: 'hoardsStatus-' + s.id,
            role: 'status',
            style: 'display:none;'
        });

        var row = el('div', {
            /* PREMIUM, like every row of the historical-map catalogue: the
             * Free/Premium tabs re-mark `.active` on this node, and the CSS gate
             * hides it outside the Premium tab. */
            class: 'hoards-sublayer dl-sublayer-row' + (isOn ? ' is-active' : ''),
            id: 'hoardsLayer-' + s.id,
            'data-category': 'premium',
            'data-hoards-source': s.id
        }, [head, opacityLine, slider, status]);

        state.rows[s.id] = { row: row, input: input, slider: slider, pct: pct, status: status };
        /* A rebuild (language switch) must not lose the row's status line: the
         * node is not in the document yet, so paint it directly. */
        if (state.status[s.id]) paintStatus(status, state.status[s.id], state.statusKind[s.id]);
        return row;
    }

    function buildPanel() {
        var mount = document.getElementById(MOUNT_ID);
        if (!mount) return;
        mount.innerHTML = '';
        state.rows = {};
        SOURCES.forEach(function (s) { mount.appendChild(buildRow(s)); });
        /* The rows just created carry no `.active` marker yet, and
         * switchLayerTab() only runs on a tab click / page load, so re-apply
         * the current tab immediately. */
        applyCurrentTab();
        syncUI();
        setExpanded(state.expanded, true);
    }

    function currentTab() {
        try {
            var btn = document.querySelector('.transp-panel-tabs button.active');
            if (btn) {
                if (btn.dataset && btn.dataset.tab) return btn.dataset.tab;
                if (btn.getAttribute) return btn.getAttribute('data-tab') || 'free';
            }
        } catch (e) { /* the tab bar is best-effort; Free is the default */ }
        return 'free';
    }

    /* The Free/Premium tabs gate every `[data-category]` node through the
     * `.active` marker js/map-app.js's switchLayerTab() keeps on it. This is
     * the same contract for the nodes this module owns (the group row and the
     * seven catalogue rows), so the hoards belong to the Premium tab only. */
    function applyCurrentTab() {
        var tab = currentTab();
        var nodes = [document.getElementById(GROUP_ID)];
        SOURCES.forEach(function (s) { nodes.push(document.getElementById('hoardsLayer-' + s.id)); });
        nodes.forEach(function (node) {
            if (!node || !node.classList) return;
            var category = node.getAttribute ? node.getAttribute('data-category') : null;
            if (!category) return;
            node.classList.toggle('active', category === tab);
        });
    }

    function setExpanded(on, immediate) {
        state.expanded = !!on;
        var body = document.getElementById(MOUNT_ID);
        var icon = document.getElementById('hoardsExpandIcon');
        var button = document.getElementById('hoardsExpandBtn');
        if (icon) icon.style.transform = on ? 'rotate(0deg)' : 'rotate(-90deg)';
        if (button) button.setAttribute('aria-expanded', on ? 'true' : 'false');
        if (!body) return;

        if (immediate) {
            body.style.transition = 'none';
            body.style.maxHeight = on ? 'none' : '0px';
            body.style.opacity = on ? '1' : '0';
            body.style.marginTop = on ? '8px' : '0';
            /* Force the layout here so the next animated change starts from
             * the value written above, then hand the transition back. */
            void body.offsetHeight;
            window.setTimeout(function () { body.style.transition = ''; }, 30);
            return;
        }

        if (on) {
            body.style.maxHeight = (body.scrollHeight || 6000) + 'px';
            body.style.opacity = '1';
            body.style.marginTop = '8px';
            /* Release the measured ceiling once the animation is over: a fixed
             * max-height would clip the last row after a font/locale change or
             * a browser-zoom resize. */
            window.setTimeout(function () {
                if (state.expanded) body.style.maxHeight = 'none';
            }, 340);
        } else {
            body.style.maxHeight = (body.scrollHeight || 6000) + 'px';
            body.style.opacity = '1';
            /* Reflow before collapsing so the transition starts from a
             * measurable value instead of `none`. */
            void body.offsetHeight;
            body.style.maxHeight = '0px';
            body.style.opacity = '0';
            body.style.marginTop = '0';
        }
    }

    /* Every control reflects one state object: the master switch (checked,
     * unchecked or indeterminate), each row's switch and slider, each
     * percentage badge and the group slider. */
    function syncUI() {
        var on = SOURCES.filter(function (s) { return !!state.active[s.id]; }).length;
        var master = document.getElementById('hoardsToggle');
        if (master) {
            master.checked = on === SOURCES.length && on > 0;
            master.indeterminate = on > 0 && on < SOURCES.length;
        }

        SOURCES.forEach(function (s) {
            var entry = state.rows[s.id];
            var isOn = !!state.active[s.id];
            if (entry) {
                if (entry.input) entry.input.checked = isOn;
                if (entry.row) entry.row.classList.toggle('is-active', isOn);
                if (entry.slider) entry.slider.value = String(opacityPct(s));
                if (entry.pct) entry.pct.textContent = opacityPct(s) + '%';
            } else {
                var cb = document.getElementById('hoardsToggle-' + s.id);
                if (cb) cb.checked = isOn;
                var row = document.getElementById('hoardsLayer-' + s.id);
                if (row) row.classList.toggle('is-active', isOn);
                var slider = document.getElementById('hoardsOpacity-' + s.id);
                if (slider) slider.value = String(opacityPct(s));
                var pct = document.getElementById('hoardsPct-' + s.id);
                if (pct) pct.textContent = opacityPct(s) + '%';
            }
        });

        var groupSlider = document.getElementById('hoardsOpacitySlider');
        if (groupSlider) groupSlider.value = String(state.groupOpacity);
        var groupPct = document.getElementById('hoardsPct');
        if (groupPct) groupPct.textContent = state.groupOpacity + '%';
    }

    /* ── the two ⓘ — the group's and each catalogue's own ────────────────── */

    function groupInfo() {
        showInfo('Hoards',
            LICENCE + ' · coin hoards after Coupland (2011) and Haupt (2001), precious-metal deposits after Hobbs (2006)',
            tr(TEXT.groupInfo));
    }

    function sourceInfo(id) {
        var s = source(id);
        if (!s) return;
        var bits = [tr(s.info)];
        bits.push(tr(TEXT.provider) + ': ' + s.provider);
        bits.push(tr(TEXT.zoomLimit) + ' ' + s.minZoom);
        var count = state.counts[s.id];
        if (count) bits.push(count.toLocaleString() + ' ' + tr(TEXT.features));
        else if (state.status[s.id]) bits.push(state.status[s.id]);
        else bits.push(tr(TEXT.none));
        showInfo(label(s), s.attribution, bits.join(' · '));
    }

    /* ── every country ───────────────────────────────────────────────────── */

    /* The DARMC catalogues are not owned by one country, so the group is kept
     * visible for every ISO and in the global view. The function exists (and is
     * wired to the country events) so the panel's state is explicit rather than
     * accidental: no row is ever left carrying a stale country gate. */
    function filter(iso) {  /* eslint-disable-line no-unused-vars */
        var row = document.getElementById(GROUP_ID);
        if (row) {
            row.classList.remove('country-layer-unavailable');
            row.setAttribute('aria-hidden', row.classList.contains('viewport-layer-unavailable') ? 'true' : 'false');
        }
        SOURCES.forEach(function (s) {
            var node = document.getElementById('hoardsLayer-' + s.id);
            if (node) node.classList.remove('country-layer-unavailable');
        });
        applyCurrentTab();
    }

    /* ── attach to the map (the map is created after this file loads) ────── */

    function attach(map) {
        if (!map || state.map === map) return;
        state.map = map;
        if (typeof map.createPane === 'function') {
            if (typeof map.getPane === 'function' && !map.getPane(PANE)) map.createPane(PANE);
            var pane = map.getPane && map.getPane(PANE);
            if (pane && pane.style) pane.style.zIndex = String(PANE_Z);
        }
        map.on('moveend zoomend', refresh);
        SOURCES.forEach(function (s) {
            if (!state.active[s.id]) return;
            var layer = ensureLayer(s);
            if (!map.hasLayer(layer)) layer.addTo(map);
            load(s);
        });
    }

    function start() {
        buildPanel();
        filter();
        var tries = 0;
        var timer = window.setInterval(function () {
            var map = getMap();
            if (map) {
                window.clearInterval(timer);
                attach(map);
                return;
            }
            if (++tries > 240) window.clearInterval(timer);
        }, 250);
    }

    /* Signing out (or a lapsed plan) must not leave premium catalogues drawing
     * on the map: switch them off, keep the rows, and let the tab gate hide
     * them again. Signing in never turns anything on by itself. */
    window.addEventListener('detectlab:authchange', function () {
        if (premiumAllowed()) { syncUI(); return; }
        var anyOn = SOURCES.some(function (s) { return !!state.active[s.id]; });
        if (anyOn) SOURCES.forEach(function (s) { setSource(s.id, false, true); });
        syncUI();
        applyCurrentTab();
    });

    document.addEventListener('detectlab:country-selected', function (event) {
        var detail = event && event.detail;
        filter(typeof detail === 'string' ? detail : detail && (detail.iso || detail.code || detail.country));
    });
    document.addEventListener('detectlab:country-cleared', function () { filter(null); });

    /* Language switch: the static markup is translated through data-key, the
     * rows this module builds re-render their own labels (state untouched). */
    document.addEventListener('detectlab:langchange', function () {
        try { buildPanel(); } catch (err) { /* never break the panel on i18n */ }
    });

    /* Tab clicks rewrite every `[data-category]` node, so re-assert ours after
     * the shared handler has run (map-app.js's switchLayerTab() is the owner). */
    document.addEventListener('click', function (event) {
        var target = event && event.target;
        if (!target) return;
        if (target.nodeType === 3) target = target.parentNode;
        if (!target || typeof target.closest !== 'function') return;
        if (!target.closest('.transp-panel-tabs')) return;
        window.setTimeout(function () { applyCurrentTab(); }, 0);
    }, true);

    /* ── public API + the inline handlers index.html uses ────────────────── */

    window.DetectLabHoards = {
        SERVICE: SERVICE,
        sources: SOURCES,
        source: source,
        isActive: function (id) { return !!state.active[id]; },
        setSource: setSource,
        toggle: setSource,
        setSourceOpacity: setSourceOpacity,
        setGroupOpacity: setGroupOpacity,
        toggleAll: toggleAll,
        setExpanded: setExpanded,
        groupInfo: groupInfo,
        sourceInfo: sourceInfo,
        filterForCountry: filter,
        premiumAllowed: premiumAllowed,
        refresh: refresh,
        statusOf: function (id) {
            return {
                text: state.status[id] || '',
                kind: state.statusKind[id] || '',
                count: state.counts[id] || 0
            };
        }
    };

    window.toggleHoardsLayers = function (on) { toggleAll(on); };
    window.setHoardsOpacity = function (value) { setGroupOpacity(value); };
    window.setHoardsSourceOpacity = function (id, value) { setSourceOpacity(id, value); };
    window.toggleHoardsSubLayers = function () { setExpanded(!state.expanded); };
    window.showHoardsGroupInfo = function () { groupInfo(); };
    window.showHoardsSourceInfo = function (id) { sourceInfo(id); };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
}(typeof window !== 'undefined' ? window : null, typeof document !== 'undefined' ? document : null));
