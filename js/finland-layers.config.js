/* ══════════════════════════════════════════════════════════════════════════
 * DetectLab — Finland (heritage · cadastral · terrain) data layers · THE CONFIG
 * ──────────────────────────────────────────────────────────────────────────
 * Every Finnish layer the map can draw is described HERE and nowhere else.
 * js/finland-layers.js renders the panel rows, builds the Leaflet layers and
 * runs every request from this list; adding, removing, re-labelling or
 * re-zoom-limiting a layer is a change to this file only — no map code has to
 * be touched. js/layer-registry.js mirrors the enabled entries (ids
 * `finland.<id>`) into the shared catalogue for the diagnostics, the 3D
 * status report and the offline audit (tools/audit-wms-layers.mjs).
 *
 * Sources (all verified live on 2026-10-17 unless a `status` says otherwise —
 * see FINLAND_LAYERS.md for the full verification report):
 *
 *   Maanmittauslaitos (MML, National Land Survey of Finland)
 *     • WMTS rasters on the ETRS-TM35FIN TileMatrixSet (EPSG:3067, origin
 *       −548576 8388608, resolutions 8192/2^level, 256 px tiles, levels 0–15).
 *       The brief's karttamoottori tile URLs answer "Forbidden" to every
 *       non-browser client tested (2026-10-17); the browser path is tried
 *       first and a same-origin proxy fallback follows.
 *     • HKP cadastral service — GetLayerTile returns MAPBOX VECTOR TILES
 *       (protobuf, not rasters!) on the same TM35FIN grid, x=TileCol,
 *       y=TileRow, z=TileMatrix. Decoded and reprojected client-side.
 *     • The documented, API-key equivalent of the WMTS is
 *       https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/… with
 *       a free self-service key (env MML_API_KEY on the proxy, never here).
 *
 *   Museovirasto (Finnish Heritage Agency) — kartta.museoverkko.fi (an Oskari
 *     app). The public vector route is
 *       /action?action_route=GetWFSFeatures&id=<layer id>&srs=EPSG:4326&bbox=…
 *     which returns GeoJSON (srs=EPSG:4326 confirmed live; the default is
 *     EPSG:3067 metres). The id→table map below was probed layer by layer:
 *     the 24 Muinaisjäännösrekisteri tables sit in blocks of three
 *     (pisteet / alakohteet / alueet). 18 of the 24 are public; the
 *     havaintokohteet and muut kulttuuriperintökohteet blocks answer
 *     "User doesn't have permissions" (130, 131, 153, 154) or
 *     "Failed to retrieve features" (132) and are listed as blocked.
 *     Museovirasto's own OGC WFS ("kulttuuriympäristöaineistot") requires a
 *     Museoverkko account, so it is NOT usable on a public site.
 *     GetLayerTile (raster tiles, e.g. maastokartta id=17) currently answers
 *     {"error":"Problematic response from actual service"} / HTTP 500 — the
 *     layer is wired up, degrades visibly and retries.
 *
 *   SYKE (Finnish Environment Institute) — paikkatiedot.ymparisto.fi GeoServer
 *     WMS. Native EPSG:3067, but GetMap in EPSG:3857 is confirmed live, so
 *     every tile is a per-tile GetMap on the map's own projection (the same
 *     pattern as the Albanian and Polish layers). GetFeatureInfo-style popups
 *     are not needed: the two services are paired with live WFS for identify.
 *
 *   Ålands landskapsregering — kartor.regeringen.ax (ArcGIS Server 11.5).
 *     The CSW record da0e5eb9-… points at INSPIRE/ALR_Skyddsomraden (WMS,
 *     layer PS.ProtectedSitesArchaeological, CC BY 4.0, EPSG:3067); the
 *     richer Kulturarv/Fornminnen MapServer (Fornminnen, Skyddsområden,
 *     Maritima fornminnen, Krigstida lämningar) is used instead, via its
 *     REST export endpoint which renders EPSG:3857 tiles directly (verified
 *     live) plus f=geojson queries for the click-to-identify popups.
 *     Åland's monuments are NOT in the mainland Muinaisjäännösrekisteri
 *     (the provincial administration keeps its own register), so this layer
 *     adds features rather than duplicating them.
 *
 *   Supabase-hosted GeoPackages (bucket Harti/Finlanda) — cannot be reached
 *     from this checkout's sandbox, so tools/finland-convert-gpkg.mjs
 *     downloads, inspects, reprojects to EPSG:4326 GeoJSON and (optionally)
 *     uploads them back; the "Local files" group reads those conversions.
 *
 * Field reference (every leaf layer carries all of them, `null` where not
 * applicable, so the shape never changes):
 *   id          stable id; the panel row, the registry entry (`finland.<id>`)
 *              and localStorage all use it
 *   title       { fi, en } — Finnish source name + English label (the panel
 *              shows English; the Finnish original rides along in popups)
 *   kind        'tm35-wmts' | 'wms' | 'wfs' | 'mvt' | 'arcgis' | 'geojson'
 *  group        one of the GROUPS ids below (panel section)
 *  subGroup     optional caption inside a section (SYKE families, register
 *              categories)
 *   …service-specific fields documented inline below
 *   minZoom     below this zoom the row shows a "zoom in" hint and nothing
 *              is requested
 *   maxZoom     how far the map may zoom (browser upscaling beyond
 *              maxNativeZoom / maxNativeLevel)
 *   opacity     initial opacity 0–1 (rasters; the hillshade starts at 0.55)
 *   defaultOn   switched on by the group master switch when the visitor has
 *              not chosen yet — nothing is ever requested before a switch
 *   enabled     false → the row is still listed but marked and never drawn
 *              (blocked / duplicate layers stay documented, never silent)
 *  status       'ok' | 'unverified' | 'blocked' | 'degraded' | 'needs-conversion'
 *              | 'duplicate' — what FINLAND_LAYERS.md reports per layer
 *  statusNote   the honest one-liner shown in the row when status ≠ ok
 *  attribution  REQUIRED credit, rendered in the map attribution while on
 *  description  one-paragraph ⓘ popup text (plain text)
 *  popup        { fields: [[fiKey, enLabel], …], link: {field, label} }
 *  style        vector drawing (color, weight, fill, dash, radius, label)
 * ══════════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
    'use strict';
    var api = factory(root);
    /* Node (the registry mirror, the proxy, the audit tool, the tests) gets
     * the very same object, so a layer can never be described twice. */
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (root) {
        root.FINLAND_LAYERS_CONFIG = api;
        root.FINLAND_LAYERS = api;
    }
}(typeof window !== 'undefined' ? window
    : typeof self !== 'undefined' ? self
        : typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    /* ── shared credits ─────────────────────────────────────────────────── */

    var CC = 'https://creativecommons.org/licenses/by/4.0/';
    var ATTR = {
        mml: 'Korkeusmalli © <a href="https://www.maanmittauslaitos.fi/en" target="_blank" rel="noopener">' +
            'Maanmittauslaitos</a> (CC BY 4.0)',
        mmlCadastral: 'Kiinteistötietojen karttapalvelu © <a href="https://www.maanmittauslaitos.fi/en" ' +
            'target="_blank" rel="noopener">Maanmittauslaitos</a>',
        museoTopo: 'Maastokartta © <a href="https://www.museovirasto.fi/en" target="_blank" rel="noopener">' +
            'Museovirasto</a>, taustakartta © Maanmittauslaitos',
        museo: 'Data: <a href="https://www.museovirasto.fi/en" target="_blank" rel="noopener">Museovirasto</a>, ' +
            'Muinaisjäännösrekisteri (CC BY 4.0)',
        syke: '© <a href="https://www.syke.fi/en-US" target="_blank" rel="noopener">Suomen ympäristökeskus (SYKE)</a> (CC BY 4.0)',
        aland: '© <a href="https://regeringen.ax/ax-kulturmiljo/" target="_blank" rel="noopener">' +
            'Ålands landskapsregering</a> (CC BY 4.0)',
        local: 'Own data (Supabase-hosted Museovirasto/RKY/VARK conversions)'
    };

    /* Finnish attribute names → English popup labels. One map for every
     * Finnish source (Museovirasto, MML HKP). Kept here so the grouping and
     * the translation live in this file only. */
    var FIELD_LABELS = {
        'Kohdetunnus': 'Site ID',
        'Kohde_ID': 'Site ID',
        'Kohdenimi': 'Name',
        'Kunta': 'Municipality',
        'Tyyppi': 'Type',
        'Alatyyppi': 'Subtype',
        'Ajoitus': 'Dating',
        'Ajoitustarkenne': 'Dating detail',
        'Paikannustapa': 'Positioning method',
        'Paikannustarkkuus': 'Positioning accuracy',
        'Alakohde_nimi': 'Sub-site name',
        'Alakohde_ID': 'Sub-site ID',
        'Kohteen_tiedot': 'Register entry',
        'Luotu': 'Created',
        'Muokattu': 'Modified',
        'Suojeluväline': 'Protection instrument',
        'Suojeluvaline': 'Protection instrument',
        'Suojelun_tila': 'Protection status',
        'Rakennus_nimi': 'Building name',
        'Rakennus_ID': 'Building ID',
        'Selite': 'Note',
        'Toimija': 'Actor',
        'Hanke_ID': 'Project ID',
        'Hankkeen_kohde': 'Project target',
        'Hanke_nimi': 'Project name',
        'Hanke_vuosi': 'Project year',
        'Tutkimuslaji': 'Research type',
        'Alue_tyyppi': 'Area type',
        'Alue_selite': 'Area description',
        'kiinteistotunnus': 'Property ID',
        'kiinteistotunnuksenEsitysmuoto': 'Property ID (display)',
        'kiinteistorajalaji': 'Boundary class',
        'lahdeaineisto': 'Source data',
        'id': 'ID'
    };

    /* Popup field order per source family (Finnish key → English label). */
    var POPUP = {
        register: {
            fields: [
                ['Kohdenimi', 'Name'],
                ['Kohdetunnus', 'Site ID'],
                ['Tyyppi', 'Type'],
                ['Alatyyppi', 'Subtype'],
                ['Ajoitus', 'Dating'],
                ['Ajoitustarkenne', 'Dating detail'],
                ['Paikannustapa', 'Positioning method'],
                ['Paikannustarkkuus', 'Positioning accuracy'],
                ['Alakohde_nimi', 'Sub-site name'],
                ['Kunta', 'Municipality']
            ],
            link: { field: 'Kohteen_tiedot', label: 'KYPPI register entry' }
        },
        subsite: {
            fields: [
                ['Alakohde_nimi', 'Sub-site name'],
                ['Kohdenimi', 'Site name'],
                ['Kohdetunnus', 'Site ID'],
                ['Tyyppi', 'Type'],
                ['Alatyyppi', 'Subtype'],
                ['Alakohde_ID', 'Sub-site ID'],
                ['Kunta', 'Municipality']
            ],
            link: { field: 'Kohteen_tiedot', label: 'KYPPI register entry' }
        },
        building: {
            fields: [
                ['Kohdenimi', 'Name'],
                ['Rakennus_nimi', 'Building name'],
                ['Suojeluväline', 'Protection instrument'],
                ['Suojeluvaline', 'Protection instrument'],
                ['Suojelun_tila', 'Protection status'],
                ['Kohde_ID', 'Site ID'],
                ['Rakennus_ID', 'Building ID'],
                ['Selite', 'Note']
            ],
            link: { field: 'Kohteen_tiedot', label: 'KYPPI register entry' }
        },
        cadastral: {
            fields: [
                ['kiinteistotunnuksenEsitysmuoto', 'Property ID'],
                ['kiinteistotunnus', 'Property ID (national format)'],
                ['kiinteistorajalaji', 'Boundary class'],
                ['lahdeaineisto', 'Source data'],
                ['id', 'ID']
            ],
            link: null
        },
        aland: {
            fields: [
                ['NAMN', 'Name'],
                ['KOMMUN', 'Municipality'],
                ['TYP', 'Type'],
                ['DATERING', 'Dating'],
                ['BESKRIVN', 'Description']
            ],
            link: null
        },
        generic: { fields: [], link: null }
    };

    /* KYPPI (Kulttuuriympäristön palveluikkuna) — the register portal. The
     * features already carry full links in Kohteen_tiedot; this is only the
     * fallback builder for datasets that carry a bare Kohdetunnus. */
    var KYPSI_PORTAL = 'https://www.kyppi.fi/palveluikkuna/mjreki/read/asp/r_default.aspx';

    var CONFIG = {
        version: '20261017-finland-v1',

        /* Country this group belongs to. Drives the country filter (rows are
         * shown when Finland is the selected country) and coverage checks. */
        country: 'FI',
        countryBounds: [[59.45, 19.08], [70.09, 31.59]],   /* mainland + Åland */

        /* Only used by the “Go to Finland” button of the group row. */
        view: { center: [60.171, 24.937], zoom: 10, label: {
            "en": "Helsinki",
            "ro": "Helsinki",
            "de": "Helsinki",
            "fr": "Helsinki",
            "it": "Helsinki",
            "es": "Helsinki",
            "pl": "Helsinki",
            "uk": "Helsinki",
            "hu": "Helsinki",
            "cs": "Helsinki",
            "sk": "Helsinki",
            "nl": "Helsinki",
            "bg": "Helsinki",
            "el": "Helsinki",
            "pt": "Helsinki",
            "da": "Helsinki",
            "sv": "Helsinki",
            "no": "Helsinki",
            "fi": "Helsinki",
            "et": "Helsinki",
            "lv": "Helsinki",
            "lt": "Helsinki",
            "hr": "Helsinki",
            "sr": "Helsinki",
            "sl": "Helsinki",
            "ru": "Helsinki",
            "sq": "Helsinki"
        } },

        /* Panel group row. */
        groupLabel: {
            "en": "Finland · Finnish maps",
            "ro": "Finlanda · hărți finlandeze",
            "de": "Finland · Finnish maps",
            "fr": "Finland · Finnish maps",
            "it": "Finland · Finnish maps",
            "es": "Finland · Finnish maps",
            "pl": "Finland · Finnish maps",
            "uk": "Finland · Finnish maps",
            "hu": "Finland · Finnish maps",
            "cs": "Finland · Finnish maps",
            "sk": "Finland · Finnish maps",
            "nl": "Finland · Finnish maps",
            "bg": "Finland · Finnish maps",
            "el": "Finland · Finnish maps",
            "pt": "Finland · Finnish maps",
            "da": "Finland · finske kort",
            "sv": "Finland · Finnish maps",
            "no": "Finland · Finnish maps",
            "fi": "Suomi · Suomen karttatasot",
            "et": "Finland · Finnish maps",
            "lv": "Finland · Finnish maps",
            "lt": "Finland · Finnish maps",
            "hr": "Finland · Finnish maps",
            "sr": "Finland · Finnish maps",
            "sl": "Finland · Finnish maps",
            "ru": "Finland · Finnish maps",
            "sq": "Finland · Finnish maps"
        },
        groupInfo: {
            en: 'Finnish national and heritage layers: Maanmittauslaitos LiDAR hillshade and Museovirasto topographic map ' +
                '(reprojected in the browser from the ETRS-TM35FIN grid), the cadastral map with property IDs (vector tiles, ' +
                'reprojected live), Museovirasto’s ancient-monuments register with its eight categories, protected buildings, ' +
                'SYKE’s nature-conservation / Natura 2000 / specially-protected built-heritage sites, the Åland ancient-monuments ' +
                'register, and locally hosted RKY / VARK datasets. Every source is credited on the map while its layer is on. ' +
                'Location accuracy of the monument register is about ±50 m on average (±15 m for new GPS measurements); ' +
                'point-only sites have no defined extent.',
            fi: 'Suomalaisia kansallisia ja kulttuuriperintötasoja: Maanmittauslaitoksen laserkeilausvinovarjostus ja ' +
                'Museoviraston maastokartta (ETRS-TM35FIN-ruudukosta selaimessa uudelleenprojisoituna), kiinteistökartta ' +
                'kiinteistötunnuksineen (vektorilaatoitusa, reprojisoituna), Museoviraston muinaisjäännösrekisteri kahdeksanineen ' +
                'kohderyhmineen, suojellut rakennukset, SYKEn luonnonsuojelu- / Natura 2000- ja erityislailla suojellut kohteet, ' +
                'Ahvenanmaan muinaisjäännösrekisteri sekä paikallisesti isännöidyt RKY- ja VARK-aineistot.'
        },

        /* ── endpoints (documentation + the machinery's defaults) ─────────── */

        endpoints: {
            /* Rasters in EPSG:3067 on the ETRS-TM35FIN TileMatrixSet. */
            mmlWmts: 'https://karttamoottori.maanmittauslaitos.fi/maasto/wmts/1.0.0',
            /* Official, documented, API-key WMTS (free self-service key):
             * the proxy uses it when MML_API_KEY is configured. */
            mmlOpenWmts: 'https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0',
            museoTiles: 'https://kartta.museoverkko.fi/action',
            hkpTiles: 'https://hkp.maanmittauslaitos.fi/hkp/action',
            museoWfs: 'https://kartta.museoverkko.fi/action',
            sykeBuilt: 'https://paikkatiedot.ymparisto.fi/geoserver/syke_rakennussuojelukohteet/wms',
            sykeBuiltWfs: 'https://paikkatiedot.ymparisto.fi/geoserver/syke_rakennussuojelukohteet/wfs',
            sykeInspire: 'https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wms',
            sykeInspireWfs: 'https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs',
            alandRest: 'https://kartor.regeringen.ax/arcgis/rest/services',
            alandWms: 'https://kartor.regeringen.ax/arcgis/services/Kulturarv/Fornminnen/MapServer/WMSServer',
            alandCswRecord: 'https://www.paikkatietohakemisto.fi/geonetwork/srv/fin/csw?elementSetName=full' +
                '&id=da0e5eb9-029a-4d9f-96a6-a7b4a5dc7c3d&outputSchema=http://www.isotc211.org/2005/gmd' +
                '&Request=GetRecordById&service=CSW&version=2.0.2',
            supabase: 'https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/Harti/Finlanda/',
            localBase: 'data/finland/',
            capabilities: {
                sykeBuilt: 'https://paikkatiedot.ymparisto.fi/geoserver/syke_rakennussuojelukohteet/wms?request=GetCapabilities&service=WMS',
                sykeInspire: 'https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wms?request=GetCapabilities&service=WMS',
                aland: 'https://kartor.regeringen.ax/arcgis/services/Kulturarv/Fornminnen/MapServer/WMSServer?request=GetCapabilities&service=WMS'
            },
            nativeCrs: 'EPSG:3067',
            nativeTileMatrixSet: 'ETRS-TM35FIN',
            /* The permit-gated official alternative — documented, not used. */
            museoOfficialWfs: 'Museoviraston kulttuuriympäristöaineistot WFS — requires a Museoverkko ' +
                'account / separate permission (paikkatieto@museovirasto.fi); not usable on a public site.'
        },

        /* Same-origin proxy (Netlify function / Express route) used when a
         * direct browser request is blocked (CORS or referrer). Direct is
         * always tried first; the proxy is the fallback, never the default. */
        proxy: {
            path: '/api/geo/finland',
            sources: ['mml-hillshade', 'mml-hillshade-open', 'museo-tile', 'hkp-tile',
                'museo-wfs', 'syke', 'aland', 'aland-query']
        },

        /* ── panel sections ──────────────────────────────────────────────── */

        GROUPS: [
            { id: 'terrain', label: {
                "en": "Terrain",
                "ro": "Terrain",
                "de": "Terrain",
                "fr": "Terrain",
                "it": "Terrain",
                "es": "Terrain",
                "pl": "Terrain",
                "uk": "Terrain",
                "hu": "Terrain",
                "cs": "Terrain",
                "sk": "Terrain",
                "nl": "Terrain",
                "bg": "Terrain",
                "el": "Terrain",
                "pt": "Terrain",
                "da": "Terrain",
                "sv": "Terrain",
                "no": "Terrain",
                "fi": "Maasto ja terreeni",
                "et": "Terrain",
                "lv": "Terrain",
                "lt": "Terrain",
                "hr": "Terrain",
                "sr": "Terrain",
                "sl": "Terrain",
                "ru": "Terrain",
                "sq": "Terrain"
            } },
            { id: 'cadastral', label: {
                "en": "Cadastral",
                "ro": "Cadastral",
                "de": "Cadastral",
                "fr": "Cadastral",
                "it": "Cadastral",
                "es": "Cadastral",
                "pl": "Cadastral",
                "uk": "Cadastral",
                "hu": "Cadastral",
                "cs": "Cadastral",
                "sk": "Cadastral",
                "nl": "Cadastral",
                "bg": "Cadastral",
                "el": "Cadastral",
                "pt": "Cadastral",
                "da": "Cadastral",
                "sv": "Cadastral",
                "no": "Cadastral",
                "fi": "Kiinteistöt",
                "et": "Cadastral",
                "lv": "Cadastral",
                "lt": "Cadastral",
                "hr": "Cadastral",
                "sr": "Cadastral",
                "sl": "Cadastral",
                "ru": "Cadastral",
                "sq": "Cadastral"
            } },
            { id: 'protected', label: {
                "en": "Protected sites",
                "ro": "Protected sites",
                "de": "Protected sites",
                "fr": "Protected sites",
                "it": "Protected sites",
                "es": "Protected sites",
                "pl": "Protected sites",
                "uk": "Protected sites",
                "hu": "Protected sites",
                "cs": "Protected sites",
                "sk": "Protected sites",
                "nl": "Protected sites",
                "bg": "Protected sites",
                "el": "Protected sites",
                "pt": "Protected sites",
                "da": "Protected sites",
                "sv": "Protected sites",
                "no": "Protected sites",
                "fi": "Suojellut kohteet",
                "et": "Protected sites",
                "lv": "Protected sites",
                "lt": "Protected sites",
                "hr": "Protected sites",
                "sr": "Protected sites",
                "sl": "Protected sites",
                "ru": "Protected sites",
                "sq": "Protected sites"
            } },
            { id: 'aland', label: {
                "en": "Åland",
                "ro": "Åland",
                "de": "Åland",
                "fr": "Åland",
                "it": "Åland",
                "es": "Åland",
                "pl": "Åland",
                "uk": "Åland",
                "hu": "Åland",
                "cs": "Åland",
                "sk": "Åland",
                "nl": "Åland",
                "bg": "Åland",
                "el": "Åland",
                "pt": "Åland",
                "da": "Åland",
                "sv": "Åland",
                "no": "Åland",
                "fi": "Ahvenanmaa",
                "et": "Åland",
                "lv": "Åland",
                "lt": "Åland",
                "hr": "Åland",
                "sr": "Åland",
                "sl": "Åland",
                "ru": "Åland",
                "sq": "Åland"
            } },
            { id: 'local', label: {
                "en": "Local files (Supabase)",
                "ro": "Local files (Supabase)",
                "de": "Local files (Supabase)",
                "fr": "Local files (Supabase)",
                "it": "Local files (Supabase)",
                "es": "Local files (Supabase)",
                "pl": "Local files (Supabase)",
                "uk": "Local files (Supabase)",
                "hu": "Local files (Supabase)",
                "cs": "Local files (Supabase)",
                "sk": "Local files (Supabase)",
                "nl": "Local files (Supabase)",
                "bg": "Local files (Supabase)",
                "el": "Local files (Supabase)",
                "pt": "Local files (Supabase)",
                "da": "Local files (Supabase)",
                "sv": "Local files (Supabase)",
                "no": "Local files (Supabase)",
                "fi": "Paikalliset aineistot (Supabase)",
                "et": "Local files (Supabase)",
                "lv": "Local files (Supabase)",
                "lt": "Local files (Supabase)",
                "hr": "Local files (Supabase)",
                "sr": "Local files (Supabase)",
                "sl": "Local files (Supabase)",
                "ru": "Local files (Supabase)",
                "sq": "Local files (Supabase)"
            } }
        ],

        /* The register categories, in the panel order requested by the brief.
 * Each drives a collapsible sub-section with a legend swatch. */
        REGISTER_CATEGORIES: [
            { id: 'kiiteat', table: 'kiinteat_muinaisjaannokset', label: {
                "en": "Immovable ancient relics",
                "ro": "Immovable ancient relics",
                "de": "Immovable ancient relics",
                "fr": "Immovable ancient relics",
                "it": "Immovable ancient relics",
                "es": "Immovable ancient relics",
                "pl": "Immovable ancient relics",
                "uk": "Immovable ancient relics",
                "hu": "Immovable ancient relics",
                "cs": "Immovable ancient relics",
                "sk": "Immovable ancient relics",
                "nl": "Immovable ancient relics",
                "bg": "Immovable ancient relics",
                "el": "Immovable ancient relics",
                "pt": "Immovable ancient relics",
                "da": "Immovable ancient relics",
                "sv": "Immovable ancient relics",
                "no": "Immovable ancient relics",
                "fi": "Kiinteät muinaisjäännökset",
                "et": "Immovable ancient relics",
                "lv": "Immovable ancient relics",
                "lt": "Immovable ancient relics",
                "hr": "Immovable ancient relics",
                "sr": "Immovable ancient relics",
                "sl": "Immovable ancient relics",
                "ru": "Immovable ancient relics",
                "sq": "Immovable ancient relics"
            }, color: '#e01b24', note: { en: 'Protected fixed ancient monuments under the Antiquities Act 295/1963. Points for all sites; some also have digitised area delineations; sub-sites carry the site type detail.' } },
            { id: 'mahdolliset', table: 'mahdolliset_muinaisjaannokset', label: {
                "en": "Possible ancient relics",
                "ro": "Possible ancient relics",
                "de": "Possible ancient relics",
                "fr": "Possible ancient relics",
                "it": "Possible ancient relics",
                "es": "Possible ancient relics",
                "pl": "Possible ancient relics",
                "uk": "Possible ancient relics",
                "hu": "Possible ancient relics",
                "cs": "Possible ancient relics",
                "sk": "Possible ancient relics",
                "nl": "Possible ancient relics",
                "bg": "Possible ancient relics",
                "el": "Possible ancient relics",
                "pt": "Possible ancient relics",
                "da": "Possible ancient relics",
                "sv": "Possible ancient relics",
                "no": "Possible ancient relics",
                "fi": "Mahdolliset muinaisjäännökset",
                "et": "Possible ancient relics",
                "lv": "Possible ancient relics",
                "lt": "Possible ancient relics",
                "hr": "Possible ancient relics",
                "sr": "Possible ancient relics",
                "sl": "Possible ancient relics",
                "ru": "Possible ancient relics",
                "sq": "Possible ancient relics"
            }, color: '#f39c1b', note: null },
            { id: 'poistetut', table: 'poistetut_kiinteat_muinaisjaannokset', label: {
                "en": "Removed immovable ancient relics",
                "ro": "Removed immovable ancient relics",
                "de": "Removed immovable ancient relics",
                "fr": "Removed immovable ancient relics",
                "it": "Removed immovable ancient relics",
                "es": "Removed immovable ancient relics",
                "pl": "Removed immovable ancient relics",
                "uk": "Removed immovable ancient relics",
                "hu": "Removed immovable ancient relics",
                "cs": "Removed immovable ancient relics",
                "sk": "Removed immovable ancient relics",
                "nl": "Removed immovable ancient relics",
                "bg": "Removed immovable ancient relics",
                "el": "Removed immovable ancient relics",
                "pt": "Removed immovable ancient relics",
                "da": "Removed immovable ancient relics",
                "sv": "Removed immovable ancient relics",
                "no": "Removed immovable ancient relics",
                "fi": "Poistetut kiinteät muinaisjäännökset",
                "et": "Removed immovable ancient relics",
                "lv": "Removed immovable ancient relics",
                "lt": "Removed immovable ancient relics",
                "hr": "Removed immovable ancient relics",
                "sr": "Removed immovable ancient relics",
                "sl": "Removed immovable ancient relics",
                "ru": "Removed immovable ancient relics",
                "sq": "Removed immovable ancient relics"
            }, color: '#9aa0a6', note: { en: 'Deregistered sites — not protected any more.' } },
            { id: 'loytopaikat', table: 'loytopaikat', label: {
                "en": "Places of discovery",
                "ro": "Places of discovery",
                "de": "Places of discovery",
                "fr": "Places of discovery",
                "it": "Places of discovery",
                "es": "Places of discovery",
                "pl": "Places of discovery",
                "uk": "Places of discovery",
                "hu": "Places of discovery",
                "cs": "Places of discovery",
                "sk": "Places of discovery",
                "nl": "Places of discovery",
                "bg": "Places of discovery",
                "el": "Places of discovery",
                "pt": "Places of discovery",
                "da": "Places of discovery",
                "sv": "Places of discovery",
                "no": "Places of discovery",
                "fi": "Löytöpaikat",
                "et": "Places of discovery",
                "lv": "Places of discovery",
                "lt": "Places of discovery",
                "hr": "Places of discovery",
                "sr": "Places of discovery",
                "sl": "Places of discovery",
                "ru": "Places of discovery",
                "sq": "Places of discovery"
            }, color: '#17a2a2', note: null },
            { id: 'havainnot', table: 'havaintokohteet', label: {
                "en": "Observation sites / targets / objects",
                "ro": "Observation sites / targets / objects",
                "de": "Observation sites / targets / objects",
                "fr": "Observation sites / targets / objects",
                "it": "Observation sites / targets / objects",
                "es": "Observation sites / targets / objects",
                "pl": "Observation sites / targets / objects",
                "uk": "Observation sites / targets / objects",
                "hu": "Observation sites / targets / objects",
                "cs": "Observation sites / targets / objects",
                "sk": "Observation sites / targets / objects",
                "nl": "Observation sites / targets / objects",
                "bg": "Observation sites / targets / objects",
                "el": "Observation sites / targets / objects",
                "pt": "Observation sites / targets / objects",
                "da": "Observation sites / targets / objects",
                "sv": "Observation sites / targets / objects",
                "no": "Observation sites / targets / objects",
                "fi": "Havaintokohteet",
                "et": "Observation sites / targets / objects",
                "lv": "Observation sites / targets / objects",
                "lt": "Observation sites / targets / objects",
                "hr": "Observation sites / targets / objects",
                "sr": "Observation sites / targets / objects",
                "sl": "Observation sites / targets / objects",
                "ru": "Observation sites / targets / objects",
                "sq": "Observation sites / targets / objects"
            }, color: '#6b8fb3', blocked: true },
            { id: 'luonnonmuodostumat', table: 'luonnonmuodostumat', label: {
                "en": "Natural formations",
                "ro": "Natural formations",
                "de": "Natural formations",
                "fr": "Natural formations",
                "it": "Natural formations",
                "es": "Natural formations",
                "pl": "Natural formations",
                "uk": "Natural formations",
                "hu": "Natural formations",
                "cs": "Natural formations",
                "sk": "Natural formations",
                "nl": "Natural formations",
                "bg": "Natural formations",
                "el": "Natural formations",
                "pt": "Natural formations",
                "da": "Natural formations",
                "sv": "Natural formations",
                "no": "Natural formations",
                "fi": "Luonnonmuodostumat",
                "et": "Natural formations",
                "lv": "Natural formations",
                "lt": "Natural formations",
                "hr": "Natural formations",
                "sr": "Natural formations",
                "sl": "Natural formations",
                "ru": "Natural formations",
                "sq": "Natural formations"
            }, color: '#3e9e4f', note: null },
            { id: 'muut_kulttuuri', table: 'muut_kulttuuriperintokohteet', label: {
                "en": "Other cultural heritage sites",
                "ro": "Other cultural heritage sites",
                "de": "Other cultural heritage sites",
                "fr": "Other cultural heritage sites",
                "it": "Other cultural heritage sites",
                "es": "Other cultural heritage sites",
                "pl": "Other cultural heritage sites",
                "uk": "Other cultural heritage sites",
                "hu": "Other cultural heritage sites",
                "cs": "Other cultural heritage sites",
                "sk": "Other cultural heritage sites",
                "nl": "Other cultural heritage sites",
                "bg": "Other cultural heritage sites",
                "el": "Other cultural heritage sites",
                "pt": "Other cultural heritage sites",
                "da": "Other cultural heritage sites",
                "sv": "Other cultural heritage sites",
                "no": "Other cultural heritage sites",
                "fi": "Muut kulttuuriperintökohteet",
                "et": "Other cultural heritage sites",
                "lv": "Other cultural heritage sites",
                "lt": "Other cultural heritage sites",
                "hr": "Other cultural heritage sites",
                "sr": "Other cultural heritage sites",
                "sl": "Other cultural heritage sites",
                "ru": "Other cultural heritage sites",
                "sq": "Other cultural heritage sites"
            }, color: '#b36b4b', blocked: true },
            { id: 'muut', table: 'muut_kohteet', label: {
                "en": "Other items / other destinations",
                "ro": "Other items / other destinations",
                "de": "Other items / other destinations",
                "fr": "Other items / other destinations",
                "it": "Other items / other destinations",
                "es": "Other items / other destinations",
                "pl": "Other items / other destinations",
                "uk": "Other items / other destinations",
                "hu": "Other items / other destinations",
                "cs": "Other items / other destinations",
                "sk": "Other items / other destinations",
                "nl": "Other items / other destinations",
                "bg": "Other items / other destinations",
                "el": "Other items / other destinations",
                "pt": "Other items / other destinations",
                "da": "Other items / other destinations",
                "sv": "Other items / other destinations",
                "no": "Other items / other destinations",
                "fi": "Muut kohteet",
                "et": "Other items / other destinations",
                "lv": "Other items / other destinations",
                "lt": "Other items / other destinations",
                "hr": "Other items / other destinations",
                "sr": "Other items / other destinations",
                "sl": "Other items / other destinations",
                "ru": "Other items / other destinations",
                "sq": "Other items / other destinations"
            }, color: '#8b6fc9', note: { en: 'Wrecks, jetties and other registered items outside the protected categories.' } }
        ],

        providers: {
            mml: 'Maanmittauslaitos (National Land Survey of Finland)',
            museo: 'Museovirasto (Finnish Heritage Agency)',
            syke: 'Suomen ympäristökeskus (SYKE, Finnish Environment Institute)',
            aland: 'Ålands landskapsregering',
            own: 'Own data (Supabase)'
        },

        licence: 'CC BY 4.0 (MML/Museovirasto/SYKE/Åland open data); MML cadastral service terms; own data',

        attribution: 'Data: Museovirasto (CC BY 4.0), Maanmittauslaitos, SYKE, Ålands landskapsregering',

        fieldLabels: FIELD_LABELS,
        popup: POPUP,
        kyppiPortal: KYPSI_PORTAL,

        /** @type {Array} */ layers: [

            /* ══════════════════════════════════════════════════════════════
             * A · TERRAIN
             * ══════════════════════════════════════════════════════════════ */

            {
                /* 1. LiDAR hillshade — Maanmittauslaitos WMTS (EPSG:3067,
                 * ETRS-TM35FIN grid), reprojected per tile on a canvas like
                 * the Danish DHM layer. karttamoottori answers "Forbidden"
                 * to non-browser clients, so: direct tiles first (plain
                 * <img> needs no CORS), proxy fallback after repeated tile
                 * errors, and the proxy switches to the official
                 * avoin-karttakuva WMTS when MML_API_KEY is configured. */
                id: 'mml-hillshade',
                title: {
                    "en": "Finland · MML LiDAR hillshade",
                    "ro": "Finland · MML LiDAR hillshade",
                    "de": "Finland · MML LiDAR hillshade",
                    "fr": "Finland · MML LiDAR hillshade",
                    "it": "Finland · MML LiDAR hillshade",
                    "es": "Finland · MML LiDAR hillshade",
                    "pl": "Finland · MML LiDAR hillshade",
                    "uk": "Finland · MML LiDAR hillshade",
                    "hu": "Finland · MML LiDAR hillshade",
                    "cs": "Finland · MML LiDAR hillshade",
                    "sk": "Finland · MML LiDAR hillshade",
                    "nl": "Finland · MML LiDAR hillshade",
                    "bg": "Finland · MML LiDAR hillshade",
                    "el": "Finland · MML LiDAR hillshade",
                    "pt": "Finland · MML LiDAR hillshade",
                    "da": "Finland · MML LiDAR hillshade",
                    "sv": "Finland · MML LiDAR hillshade",
                    "no": "Finland · MML LiDAR hillshade",
                    "fi": "Maanmittauslaitos · korkeusmalli_vinovalo (laserkeilaus)",
                    "et": "Finland · MML LiDAR hillshade",
                    "lv": "Finland · MML LiDAR hillshade",
                    "lt": "Finland · MML LiDAR hillshade",
                    "hr": "Finland · MML LiDAR hillshade",
                    "sr": "Finland · MML LiDAR hillshade",
                    "sl": "Finland · MML LiDAR hillshade",
                    "ru": "Finland · MML LiDAR hillshade",
                    "sq": "Finland · MML LiDAR hillshade"
                },
                kind: 'tm35-wmts',
                group: 'terrain',
                urlTemplate: 'https://karttamoottori.maanmittauslaitos.fi/maasto/wmts/1.0.0/' +
                    'korkeusmalli_vinovalo/default/ETRS-TM35FIN/{z}/{row}/{col}.png',
                proxySrc: 'mml-hillshade',
                openProxySrc: 'mml-hillshade-open',   /* + MML_API_KEY server-side */
                format: 'image/png',
                transparent: true,
                minZoom: 5,
                maxZoom: 20,
                maxNativeLevel: 15,        /* TM35FIN level 15 = 0.25 m/px */
                opacity: 0.55,
                defaultOn: true,
                enabled: true,
                status: 'unverified',
                statusNote: 'karttamoottori answers “Forbidden” to every non-browser client tested; ' +
                    'the browser path is tried first and the same-origin proxy (/api/geo/finland) takes over on errors — ' +
                    'with MML_API_KEY set the proxy uses the official avoin-karttakuva WMTS instead.',
                attribution: ATTR.mml,
                attributionRow: 'Korkeusmalli © Maanmittauslaitos (CC BY 4.0)',
                description: 'Hillshade of the national airborne laser scanning elevation model, streamed live from ' +
                    'Maanmittauslaitos’ WMTS as an overlay (default opacity 55%). The service publishes the national ' +
                    'ETRS-TM35FIN grid (EPSG:3067), not Web Mercator, so every tile is reprojected onto a canvas in the ' +
                    'browser — the relief therefore lines up with the basemap to well under a pixel. Free open data, CC BY 4.0.',
                notes: 'TM35FIN grid; REST template order is {z}/{TileRow}/{TileCol}.'
            },
            {
                /* 2. Topographic map — Museovirasto museoverkko WMTS proxy
                 * (id=17, layer=maastokartta). Captured live from the app,
                 * but the route currently answers HTTP 500 with
                 * {"error":"Problematic response from actual service"} — its
                 * own upstream (MML) is failing for foreign/server requests.
                 * Wired, visibly degraded, retried, proxy-fallbackable. */
                id: 'maastokartta',
                title: {
                    "en": "Finland · topographic map (maastokartta)",
                    "ro": "Finland · topographic map (maastokartta)",
                    "de": "Finland · topographic map (maastokartta)",
                    "fr": "Finland · topographic map (maastokartta)",
                    "it": "Finland · topographic map (maastokartta)",
                    "es": "Finland · topographic map (maastokartta)",
                    "pl": "Finland · topographic map (maastokartta)",
                    "uk": "Finland · topographic map (maastokartta)",
                    "hu": "Finland · topographic map (maastokartta)",
                    "cs": "Finland · topographic map (maastokartta)",
                    "sk": "Finland · topographic map (maastokartta)",
                    "nl": "Finland · topographic map (maastokartta)",
                    "bg": "Finland · topographic map (maastokartta)",
                    "el": "Finland · topographic map (maastokartta)",
                    "pt": "Finland · topographic map (maastokartta)",
                    "da": "Finland · topographic map (maastokartta)",
                    "sv": "Finland · topographic map (maastokartta)",
                    "no": "Finland · topographic map (maastokartta)",
                    "fi": "Maastokartta (Museoviraston museoverkko)",
                    "et": "Finland · topographic map (maastokartta)",
                    "lv": "Finland · topographic map (maastokartta)",
                    "lt": "Finland · topographic map (maastokartta)",
                    "hr": "Finland · topographic map (maastokartta)",
                    "sr": "Finland · topographic map (maastokartta)",
                    "sl": "Finland · topographic map (maastokartta)",
                    "ru": "Finland · topographic map (maastokartta)",
                    "sq": "Finland · topographic map (maastokartta)"
                },
                kind: 'tm35-wmts',
                group: 'terrain',
                urlTemplate: 'https://kartta.museoverkko.fi/action?action_route=GetLayerTile&id=17' +
                    '&layer=maastokartta&style=default&tilematrixset=ETRS-TM35FIN&Service=WMTS&Request=GetTile' +
                    '&Version=1.0.0&Format=image%2Fpng&TileMatrix={z}&TileCol={col}&TileRow={row}',
                proxySrc: 'museo-tile',
                format: 'image/png',
                transparent: false,
                minZoom: 5,
                maxZoom: 20,
                maxNativeLevel: 15,
                opacity: 1,
                defaultOn: false,
                enabled: true,
                status: 'degraded',
                statusNote: 'The service answers HTTP 500 (“Problematic response from actual service”) for every ' +
                    'tile tested on 2026-10-17 — its upstream is failing. The layer is fully wired (same TM35FIN ' +
                    'machinery as the hillshade), shows the failure in its row and retries; the /api/geo/finland ' +
                    'proxy takes over automatically when a server-side fetch succeeds.',
                attribution: ATTR.museoTopo,
                attributionRow: 'Maastokartta © Museovirasto; taustakartta © Maanmittauslaitos',
                description: 'Museovirasto’s copy of the Maanmittauslaitos 1:20k/1:50k topographic map, served as ' +
                    'WMTS tiles on the national ETRS-TM35FIN grid and reprojected per tile in the browser like the ' +
                    'LiDAR hillshade. Use it as an alternate base map under the heritage overlays.',
                notes: 'Sample tile: TileMatrix=11&TileCol=991&TileRow=1158 → TM35FIN tile (11, col 991, row 1158) ≈ 64.94 N 26.30 E (Lapland), which is how the grid was confirmed.'
            },

            /* ══════════════════════════════════════════════════════════════
             * B · CADASTRAL (MML HKP — Mapbox Vector Tiles, EPSG:3067 grid)
             * ══════════════════════════════════════════════════════════════ */

            {
                /* 3. Cadastral boundaries — hkp id=623 returns MVT whose
                 * layers include KiinteistorajanSijaintitiedot (boundary
                 * lines). Drawn onto canvas tiles after reprojecting every
                 * vertex from the TM35FIN tile to the mercator tile. */
                id: 'hkp-rajat',
                title: {
                    "en": "Finland · cadastral boundaries",
                    "ro": "Finland · cadastral boundaries",
                    "de": "Finland · cadastral boundaries",
                    "fr": "Finland · cadastral boundaries",
                    "it": "Finland · cadastral boundaries",
                    "es": "Finland · cadastral boundaries",
                    "pl": "Finland · cadastral boundaries",
                    "uk": "Finland · cadastral boundaries",
                    "hu": "Finland · cadastral boundaries",
                    "cs": "Finland · cadastral boundaries",
                    "sk": "Finland · cadastral boundaries",
                    "nl": "Finland · cadastral boundaries",
                    "bg": "Finland · cadastral boundaries",
                    "el": "Finland · cadastral boundaries",
                    "pt": "Finland · cadastral boundaries",
                    "da": "Finland · cadastral boundaries",
                    "sv": "Finland · cadastral boundaries",
                    "no": "Finland · cadastral boundaries",
                    "fi": "Kiinteistörajat (MML kiinteistötietojen karttapalvelu)",
                    "et": "Finland · cadastral boundaries",
                    "lv": "Finland · cadastral boundaries",
                    "lt": "Finland · cadastral boundaries",
                    "hr": "Finland · cadastral boundaries",
                    "sr": "Finland · cadastral boundaries",
                    "sl": "Finland · cadastral boundaries",
                    "ru": "Finland · cadastral boundaries",
                    "sq": "Finland · cadastral boundaries"
                },
                kind: 'mvt',
                group: 'cadastral',
                hkpId: 623,
                layerNames: ['KiinteistorajanSijaintitiedot'],
                style: { color: '#ffd24d', weight: 2, dash: null, fill: false },
                minZoom: 12,
                maxZoom: 20,
                opacity: 1,
                defaultOn: false,
                enabled: true,
                status: 'ok',
                attribution: ATTR.mmlCadastral,
                attributionRow: 'Kiinteistötietojen karttapalvelu © Maanmittauslaitos',
                popup: POPUP.cadastral,
                description: 'Parcel and registered-unit boundary lines from Maanmittauslaitos’ cadastral map service. ' +
                    'The HKP endpoint serves Mapbox Vector Tiles on the ETRS-TM35FIN grid; they are decoded and reprojected ' +
                    'in the browser, so the lines stay crisp at every zoom. Click a parcel for its property identifier.',
                notes: 'Sample tile ?id=623&x=248&y=316&z=9 decodes to protobuf layer KiinteistorajanSijaintitiedot at TM35FIN (9, 248, 316) ≈ 64.8 N 28.0 E.'
            },
            {
                /* 4. Property IDs — hkp id=819 (PalstanSijaintitiedot parcels
                 * + KiinteistotunnuksenSijaintitiedot label points with
                 * kiinteistotunnus / kiinteistotunnuksenEsitysmuoto, e.g.
                 * “630-401-13-0”). Labels only exist at high zoom. */
                id: 'hkp-tunnukset',
                title: {
                    "en": "Finland · property IDs (labels)",
                    "ro": "Finland · property IDs (labels)",
                    "de": "Finland · property IDs (labels)",
                    "fr": "Finland · property IDs (labels)",
                    "it": "Finland · property IDs (labels)",
                    "es": "Finland · property IDs (labels)",
                    "pl": "Finland · property IDs (labels)",
                    "uk": "Finland · property IDs (labels)",
                    "hu": "Finland · property IDs (labels)",
                    "cs": "Finland · property IDs (labels)",
                    "sk": "Finland · property IDs (labels)",
                    "nl": "Finland · property IDs (labels)",
                    "bg": "Finland · property IDs (labels)",
                    "el": "Finland · property IDs (labels)",
                    "pt": "Finland · property IDs (labels)",
                    "da": "Finland · property IDs (labels)",
                    "sv": "Finland · property IDs (labels)",
                    "no": "Finland · property IDs (labels)",
                    "fi": "Kiinteistötunnukset (rekisteritunnus kartalla)",
                    "et": "Finland · property IDs (labels)",
                    "lv": "Finland · property IDs (labels)",
                    "lt": "Finland · property IDs (labels)",
                    "hr": "Finland · property IDs (labels)",
                    "sr": "Finland · property IDs (labels)",
                    "sl": "Finland · property IDs (labels)",
                    "ru": "Finland · property IDs (labels)",
                    "sq": "Finland · property IDs (labels)"
                },
                kind: 'mvt',
                group: 'cadastral',
                hkpId: 819,
                layerNames: ['PalstanSijaintitiedot', 'KiinteistotunnuksenSijaintitiedot'],
                labelField: 'kiinteistotunnuksenEsitysmuoto',
                labelFallbackField: 'kiinteistotunnus',
                style: { color: '#ffd24d', weight: 1, fill: true, fillColor: '#ffd24d', fillOpacity: 0.06 },
                labelStyle: { color: '#fff2c4', font: '11px sans-serif', stroke: 'rgba(0,0,0,0.85)' },
                minZoom: 15,
                maxZoom: 20,
                opacity: 1,
                defaultOn: false,
                enabled: true,
                status: 'ok',
                attribution: ATTR.mmlCadastral,
                attributionRow: 'Kiinteistötietojen karttapalvelu © Maanmittauslaitos',
                popup: POPUP.cadastral,
                description: 'Property identifiers (kiinteistotunnus, e.g. 630-401-13-0) drawn on the parcels they ' +
                    'belong to, from the cadastral map service’s vector tiles. The register only labels from high zoom — ' +
                    'the row asks you to zoom in below z15.',
                notes: 'Sample tile ?id=819&x=4019&y=5032&z=13 contains PalstanSijaintitiedot with kiinteistotunnus “63040100130000” and display form “630-401-13-0”.'
            },

            /* ══════════════════════════════════════════════════════════════
             * C · PROTECTED SITES
             * ══════════════════════════════════════════════════════════════ */

            /* C.5 — Built heritage objects (special legislation), SYKE. */
            {
                id: 'syke-rakennussuojelu-kohde',
                title: {
                    "en": "Finland · protected built heritage, sites (SYKE)",
                    "ro": "Finland · protected built heritage, sites (SYKE)",
                    "de": "Finland · protected built heritage, sites (SYKE)",
                    "fr": "Finland · protected built heritage, sites (SYKE)",
                    "it": "Finland · protected built heritage, sites (SYKE)",
                    "es": "Finland · protected built heritage, sites (SYKE)",
                    "pl": "Finland · protected built heritage, sites (SYKE)",
                    "uk": "Finland · protected built heritage, sites (SYKE)",
                    "hu": "Finland · protected built heritage, sites (SYKE)",
                    "cs": "Finland · protected built heritage, sites (SYKE)",
                    "sk": "Finland · protected built heritage, sites (SYKE)",
                    "nl": "Finland · protected built heritage, sites (SYKE)",
                    "bg": "Finland · protected built heritage, sites (SYKE)",
                    "el": "Finland · protected built heritage, sites (SYKE)",
                    "pt": "Finland · protected built heritage, sites (SYKE)",
                    "da": "Finland · protected built heritage, sites (SYKE)",
                    "sv": "Finland · protected built heritage, sites (SYKE)",
                    "no": "Finland · protected built heritage, sites (SYKE)",
                    "fi": "Suojellut rakennusperintökohteet (erityislait) — pisteet",
                    "et": "Finland · protected built heritage, sites (SYKE)",
                    "lv": "Finland · protected built heritage, sites (SYKE)",
                    "lt": "Finland · protected built heritage, sites (SYKE)",
                    "hr": "Finland · protected built heritage, sites (SYKE)",
                    "sr": "Finland · protected built heritage, sites (SYKE)",
                    "sl": "Finland · protected built heritage, sites (SYKE)",
                    "ru": "Finland · protected built heritage, sites (SYKE)",
                    "sq": "Finland · protected built heritage, sites (SYKE)"
                },
                kind: 'wms',
                group: 'protected',
                subGroup: 'built',
                service: 'sykeBuilt',
                layers: 'Rakennussuojelukohteet',
                version: '1.1.1',
                crs: 'EPSG:3857',
                format: 'image/png',
                transparent: true,
                minZoom: 8,
                maxZoom: 20,
                maxNativeZoom: 18,
                opacity: 1,
                defaultOn: false,
                enabled: true,
                status: 'ok',
                attribution: ATTR.syke,
                attributionRow: 'Rakennussuojelukohteet © SYKE (CC BY 4.0)',
                description: 'Buildings protected under special legislation (the Building Protection Act, the Church Act, ' +
                    'the Orthodox Church Act and the decree on state-owned buildings), as maintained by the ELY Centres and ' +
                    'published by SYKE. Rendered as per-tile WMS GetMap in the map’s own projection; click a site and the ' +
                    'matching live WFS features are fetched for the popup.',
                notes: 'GetMap in EPSG:3857 verified live 2026-10-17 (server answers image/png). Native EPSG:3067.'
            },
            {
                id: 'syke-rakennussuojelu-alue',
                title: {
                    "en": "Finland · protected built heritage, areas (SYKE)",
                    "ro": "Finland · protected built heritage, areas (SYKE)",
                    "de": "Finland · protected built heritage, areas (SYKE)",
                    "fr": "Finland · protected built heritage, areas (SYKE)",
                    "it": "Finland · protected built heritage, areas (SYKE)",
                    "es": "Finland · protected built heritage, areas (SYKE)",
                    "pl": "Finland · protected built heritage, areas (SYKE)",
                    "uk": "Finland · protected built heritage, areas (SYKE)",
                    "hu": "Finland · protected built heritage, areas (SYKE)",
                    "cs": "Finland · protected built heritage, areas (SYKE)",
                    "sk": "Finland · protected built heritage, areas (SYKE)",
                    "nl": "Finland · protected built heritage, areas (SYKE)",
                    "bg": "Finland · protected built heritage, areas (SYKE)",
                    "el": "Finland · protected built heritage, areas (SYKE)",
                    "pt": "Finland · protected built heritage, areas (SYKE)",
                    "da": "Finland · protected built heritage, areas (SYKE)",
                    "sv": "Finland · protected built heritage, areas (SYKE)",
                    "no": "Finland · protected built heritage, areas (SYKE)",
                    "fi": "Suojellut rakennusperintökohteet (erityislait) — alueet",
                    "et": "Finland · protected built heritage, areas (SYKE)",
                    "lv": "Finland · protected built heritage, areas (SYKE)",
                    "lt": "Finland · protected built heritage, areas (SYKE)",
                    "hr": "Finland · protected built heritage, areas (SYKE)",
                    "sr": "Finland · protected built heritage, areas (SYKE)",
                    "sl": "Finland · protected built heritage, areas (SYKE)",
                    "ru": "Finland · protected built heritage, areas (SYKE)",
                    "sq": "Finland · protected built heritage, areas (SYKE)"
                },
                kind: 'wms',
                group: 'protected',
                subGroup: 'built',
                service: 'sykeBuilt',
                layers: 'Rakennussuojelualueet',
                version: '1.1.1',
                crs: 'EPSG:3857',
                format: 'image/png',
                transparent: true,
                minZoom: 8,
                maxZoom: 20,
                maxNativeZoom: 18,
                opacity: 1,
                defaultOn: false,
                enabled: true,
                status: 'ok',
                attribution: ATTR.syke,
                attributionRow: 'Rakennussuojelualueet © SYKE (CC BY 4.0)',
                description: 'Area delineations of the specially-protected built-heritage sites (same register as the ' +
                    'site layer; some protections are drawn as areas rather than points).',
                notes: null
            },

            /* C.6 — Nature protected areas, Natura 2000 and protected built
             * heritage (INSPIRE), SYKE. All 12 published sublayers exposed. */
            {
                id: 'syke-ps-eramaa',
                title: {
                    "en": "Finland · wilderness areas (SYKE INSPIRE)",
                    "ro": "Finland · wilderness areas (SYKE INSPIRE)",
                    "de": "Finland · wilderness areas (SYKE INSPIRE)",
                    "fr": "Finland · wilderness areas (SYKE INSPIRE)",
                    "it": "Finland · wilderness areas (SYKE INSPIRE)",
                    "es": "Finland · wilderness areas (SYKE INSPIRE)",
                    "pl": "Finland · wilderness areas (SYKE INSPIRE)",
                    "uk": "Finland · wilderness areas (SYKE INSPIRE)",
                    "hu": "Finland · wilderness areas (SYKE INSPIRE)",
                    "cs": "Finland · wilderness areas (SYKE INSPIRE)",
                    "sk": "Finland · wilderness areas (SYKE INSPIRE)",
                    "nl": "Finland · wilderness areas (SYKE INSPIRE)",
                    "bg": "Finland · wilderness areas (SYKE INSPIRE)",
                    "el": "Finland · wilderness areas (SYKE INSPIRE)",
                    "pt": "Finland · wilderness areas (SYKE INSPIRE)",
                    "da": "Finland · wilderness areas (SYKE INSPIRE)",
                    "sv": "Finland · wilderness areas (SYKE INSPIRE)",
                    "no": "Finland · wilderness areas (SYKE INSPIRE)",
                    "fi": "Erämaa-alueet",
                    "et": "Finland · wilderness areas (SYKE INSPIRE)",
                    "lv": "Finland · wilderness areas (SYKE INSPIRE)",
                    "lt": "Finland · wilderness areas (SYKE INSPIRE)",
                    "hr": "Finland · wilderness areas (SYKE INSPIRE)",
                    "sr": "Finland · wilderness areas (SYKE INSPIRE)",
                    "sl": "Finland · wilderness areas (SYKE INSPIRE)",
                    "ru": "Finland · wilderness areas (SYKE INSPIRE)",
                    "sq": "Finland · wilderness areas (SYKE INSPIRE)"
                },
                kind: 'wms', group: 'protected', subGroup: 'inspire-nature', service: 'sykeInspire',
                layers: 'PS.ProtectedSitesEramaaAlueEramaa', version: '1.1.1', crs: 'EPSG:3857',
                format: 'image/png', transparent: true, minZoom: 5, maxZoom: 20, maxNativeZoom: 18,
                opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                attribution: ATTR.syke, attributionRow: 'Erämaa-alueet © SYKE (CC BY 4.0)',
                description: 'The twelve official wilderness-reserve areas (erämaa-alueet) established by the Wilderness Act.',
                notes: null
            },
            {
                id: 'syke-ps-valtion-luonnonsuojelu',
                title: {
                    "en": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "ro": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "de": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "fr": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "it": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "es": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "pl": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "uk": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "hu": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "cs": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "sk": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "nl": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "bg": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "el": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "pt": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "da": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "sv": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "no": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "fi": "Valtion omistamat luonnonsuojelualueet",
                    "et": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "lv": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "lt": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "hr": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "sr": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "sl": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "ru": "Finland · state-owned nature conservation areas (SYKE INSPIRE)",
                    "sq": "Finland · state-owned nature conservation areas (SYKE INSPIRE)"
                },
                kind: 'wms', group: 'protected', subGroup: 'inspire-nature', service: 'sykeInspire',
                layers: 'PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue', version: '1.1.1', crs: 'EPSG:3857',
                format: 'image/png', transparent: true, minZoom: 5, maxZoom: 20, maxNativeZoom: 18,
                opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                attribution: ATTR.syke, attributionRow: 'Luonnonsuojelualueet © SYKE (CC BY 4.0)',
                description: 'Nature conservation areas on state-owned land (national parks, strict nature reserves and other state reserves).',
                notes: null
            },
            {
                id: 'syke-ps-yksityismaiden-luonnonsuojelu',
                title: {
                    "en": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "ro": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "de": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "fr": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "it": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "es": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "pl": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "uk": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "hu": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "cs": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "sk": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "nl": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "bg": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "el": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "pt": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "da": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "sv": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "no": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "fi": "Yksityisten mailla olevat luonnonsuojelualueet",
                    "et": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "lv": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "lt": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "hr": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "sr": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "sl": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "ru": "Finland · private-land nature conservation areas (SYKE INSPIRE)",
                    "sq": "Finland · private-land nature conservation areas (SYKE INSPIRE)"
                },
                kind: 'wms', group: 'protected', subGroup: 'inspire-nature', service: 'sykeInspire',
                layers: 'PS.ProtectedSitesYksityistenMaillaOlevaLuonnonsuojelualue', version: '1.1.1', crs: 'EPSG:3857',
                format: 'image/png', transparent: true, minZoom: 5, maxZoom: 20, maxNativeZoom: 18,
                opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                attribution: ATTR.syke, attributionRow: 'Luonnonsuojelualueet © SYKE (CC BY 4.0)',
                description: 'Nature conservation areas established on private land (e.g. private nature reserves and conservation agreements).',
                notes: null
            },
            {
                id: 'syke-ps-natura-sci',
                title: {
                    "en": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "ro": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "de": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "fr": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "it": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "es": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "pl": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "uk": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "hu": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "cs": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "sk": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "nl": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "bg": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "el": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "pt": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "da": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "sv": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "no": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "fi": "Natura 2000 · ehdotetut SCI-alueet",
                    "et": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "lv": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "lt": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "hr": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "sr": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "sl": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "ru": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)",
                    "sq": "Finland · Natura 2000 proposed Sites of Community Importance (SYKE)"
                },
                kind: 'wms', group: 'protected', subGroup: 'inspire-natura', service: 'sykeInspire',
                layers: 'PS.ProtectedSitesProposedSiteOfCommunityImportance', version: '1.1.1', crs: 'EPSG:3857',
                format: 'image/png', transparent: true, minZoom: 5, maxZoom: 20, maxNativeZoom: 18,
                opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                attribution: ATTR.syke, attributionRow: 'Natura 2000 © SYKE (CC BY 4.0)',
                description: 'Natura 2000 areas proposed as Sites of Community Importance (pSCI) under the Habitats Directive.',
                notes: null
            },
            {
                id: 'syke-ps-natura-sac',
                title: {
                    "en": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "ro": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "de": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "fr": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "it": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "es": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "pl": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "uk": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "hu": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "cs": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "sk": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "nl": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "bg": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "el": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "pt": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "da": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "sv": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "no": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "fi": "Natura 2000 · SAC-alueet",
                    "et": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "lv": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "lt": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "hr": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "sr": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "sl": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "ru": "Finland · Natura 2000 Special Areas of Conservation (SYKE)",
                    "sq": "Finland · Natura 2000 Special Areas of Conservation (SYKE)"
                },
                kind: 'wms', group: 'protected', subGroup: 'inspire-natura', service: 'sykeInspire',
                layers: 'PS.ProtectedSitesSpecialAreaOfConservation', version: '1.1.1', crs: 'EPSG:3857',
                format: 'image/png', transparent: true, minZoom: 5, maxZoom: 20, maxNativeZoom: 18,
                opacity: 1, defaultOn: true, enabled: true, status: 'ok',
                attribution: ATTR.syke, attributionRow: 'Natura 2000 © SYKE (CC BY 4.0)',
                description: 'Natura 2000 Special Areas of Conservation (SAC, Habitats Directive) — the core habitat-protection network.',
                notes: 'GetMap verified live 2026-10-17 (fetch of a 256 px EPSG:3857 tile returns image data).'
            },
            {
                id: 'syke-ps-natura-spa',
                title: {
                    "en": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "ro": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "de": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "fr": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "it": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "es": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "pl": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "uk": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "hu": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "cs": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "sk": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "nl": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "bg": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "el": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "pt": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "da": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "sv": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "no": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "fi": "Natura 2000 · SPA-alueet",
                    "et": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "lv": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "lt": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "hr": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "sr": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "sl": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "ru": "Finland · Natura 2000 Special Protection Areas (SYKE)",
                    "sq": "Finland · Natura 2000 Special Protection Areas (SYKE)"
                },
                kind: 'wms', group: 'protected', subGroup: 'inspire-natura', service: 'sykeInspire',
                layers: 'PS.ProtectedSitesSpecialProtectionArea', version: '1.1.1', crs: 'EPSG:3857',
                format: 'image/png', transparent: true, minZoom: 5, maxZoom: 20, maxNativeZoom: 18,
                opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                attribution: ATTR.syke, attributionRow: 'Natura 2000 © SYKE (CC BY 4.0)',
                description: 'Natura 2000 Special Protection Areas (SPA, Birds Directive).',
                notes: null
            },
            {
                id: 'syke-ps-asetus-valtion',
                title: {
                    "en": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "ro": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "de": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "fr": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "it": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "es": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "pl": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "uk": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "hu": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "cs": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "sk": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "nl": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "bg": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "el": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "pt": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "da": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "sv": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "no": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "fi": "Asetus valtion omistamien rakennusten suojelusta · pisteet",
                    "et": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "lv": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "lt": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "hr": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "sr": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "sl": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "ru": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)",
                    "sq": "Finland · state-owned protected buildings, sites (SYKE INSPIRE)"
                },
                kind: 'wms', group: 'protected', subGroup: 'inspire-built', service: 'sykeInspire',
                layers: 'PS.ProtectedSitesAsetusValtionOmistamienRakennustenSuojelusta', version: '1.1.1', crs: 'EPSG:3857',
                format: 'image/png', transparent: true, minZoom: 8, maxZoom: 20, maxNativeZoom: 18,
                opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                attribution: ATTR.syke, attributionRow: 'Suojellut rakennukset © SYKE (CC BY 4.0)',
                description: 'State-owned buildings protected by decree (Asetus valtion omistamien rakennusten suojelusta, e.g. decree 480/85).',
                notes: null
            },
            {
                id: 'syke-ps-asetus-valtion-alue',
                title: {
                    "en": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "ro": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "de": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "fr": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "it": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "es": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "pl": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "uk": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "hu": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "cs": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "sk": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "nl": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "bg": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "el": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "pt": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "da": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "sv": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "no": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "fi": "Asetus valtion omistamien rakennusten suojelusta · alueet",
                    "et": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "lv": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "lt": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "hr": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "sr": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "sl": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "ru": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)",
                    "sq": "Finland · state-owned protected buildings, areas (SYKE INSPIRE)"
                },
                kind: 'wms', group: 'protected', subGroup: 'inspire-built', service: 'sykeInspire',
                layers: 'PS.ProtectedSitesAsetusValtionOmistamienRakennustenSuojelustaPolygons', version: '1.1.1', crs: 'EPSG:3857',
                format: 'image/png', transparent: true, minZoom: 8, maxZoom: 20, maxNativeZoom: 18,
                opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                attribution: ATTR.syke, attributionRow: 'Suojellut rakennukset © SYKE (CC BY 4.0)',
                description: 'Area delineations of the decree-protected state-owned buildings.',
                notes: null
            },
            {
                id: 'syke-ps-kirkkolaki',
                title: {
                    "en": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "ro": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "de": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "fr": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "it": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "es": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "pl": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "uk": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "hu": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "cs": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "sk": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "nl": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "bg": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "el": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "pt": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "da": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "sv": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "no": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "fi": "Kirkkolailla suojellut kohteet",
                    "et": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "lv": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "lt": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "hr": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "sr": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "sl": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "ru": "Finland · Church Act protected sites (SYKE INSPIRE)",
                    "sq": "Finland · Church Act protected sites (SYKE INSPIRE)"
                },
                kind: 'wms', group: 'protected', subGroup: 'inspire-built', service: 'sykeInspire',
                layers: 'PS.ProtectedSitesKirkkolaillaSuojellutKohteet', version: '1.1.1', crs: 'EPSG:3857',
                format: 'image/png', transparent: true, minZoom: 8, maxZoom: 20, maxNativeZoom: 18,
                opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                attribution: ATTR.syke, attributionRow: 'Suojellut rakennukset © SYKE (CC BY 4.0)',
                description: 'Buildings and church sites protected under the Church Act (kirkkolaki).',
                notes: null
            },
            {
                id: 'syke-ps-ortodoksikirkko',
                title: {
                    "en": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "ro": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "de": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "fr": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "it": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "es": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "pl": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "uk": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "hu": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "cs": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "sk": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "nl": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "bg": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "el": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "pt": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "da": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "sv": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "no": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "fi": "Lailla ortodoksisesta kirkosta suojellut kohteet",
                    "et": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "lv": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "lt": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "hr": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "sr": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "sl": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "ru": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)",
                    "sq": "Finland · Orthodox Church Act protected sites (SYKE INSPIRE)"
                },
                kind: 'wms', group: 'protected', subGroup: 'inspire-built', service: 'sykeInspire',
                layers: 'PS.ProtectedSitesLaillaOrtodoksisestaKirkoistaSuojellutKohteet', version: '1.1.1', crs: 'EPSG:3857',
                format: 'image/png', transparent: true, minZoom: 8, maxZoom: 20, maxNativeZoom: 18,
                opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                attribution: ATTR.syke, attributionRow: 'Suojellut rakennukset © SYKE (CC BY 4.0)',
                description: 'Buildings protected under the Act on the Orthodox Church.',
                notes: null
            },
            {
                id: 'syke-ps-rakennusperintolaki',
                title: {
                    "en": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "ro": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "de": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "fr": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "it": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "es": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "pl": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "uk": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "hu": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "cs": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "sk": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "nl": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "bg": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "el": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "pt": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "da": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "sv": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "no": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "fi": "Rakennussuojelulain kohteet · pisteet",
                    "et": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "lv": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "lt": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "hr": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "sr": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "sl": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "ru": "Finland · Building Protection Act sites (SYKE INSPIRE)",
                    "sq": "Finland · Building Protection Act sites (SYKE INSPIRE)"
                },
                kind: 'wms', group: 'protected', subGroup: 'inspire-built', service: 'sykeInspire',
                layers: 'PS.ProtectedSitesLaillaRakennusperinnonSuojelemisestaSuojeltuKohde', version: '1.1.1', crs: 'EPSG:3857',
                format: 'image/png', transparent: true, minZoom: 8, maxZoom: 20, maxNativeZoom: 18,
                opacity: 1, defaultOn: false, enabled: true, status: 'duplicate',
                statusNote: 'Same register as “protected built heritage, sites (SYKE)” above — both services publish ' +
                    'the Building Protection Act layer. Off by default; switch one of the two, not both.',
                attribution: ATTR.syke, attributionRow: 'Suojellut rakennukset © SYKE (CC BY 4.0)',
                description: 'Buildings protected under the Building Protection Act (laki rakennusperinnön suojelemisesta), ' +
                    'published both by this INSPIRE service and by the dedicated Rakennussuojelukohteet service — this copy ' +
                    'is the same data.',
                notes: 'Extents of this layer and syke-rakennussuojelu-kohde are identical in both capabilities docs.'
            },
            {
                id: 'syke-ps-rakennusperintolaki-alue',
                title: {
                    "en": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "ro": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "de": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "fr": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "it": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "es": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "pl": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "uk": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "hu": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "cs": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "sk": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "nl": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "bg": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "el": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "pt": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "da": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "sv": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "no": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "fi": "Rakennussuojelulain kohteet · alueet",
                    "et": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "lv": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "lt": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "hr": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "sr": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "sl": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "ru": "Finland · Building Protection Act areas (SYKE INSPIRE)",
                    "sq": "Finland · Building Protection Act areas (SYKE INSPIRE)"
                },
                kind: 'wms', group: 'protected', subGroup: 'inspire-built', service: 'sykeInspire',
                layers: 'PS.ProtectedSitesLaillaRakennusperinnonSuojelemisestaSuojeltuKohdePolygons', version: '1.1.1', crs: 'EPSG:3857',
                format: 'image/png', transparent: true, minZoom: 8, maxZoom: 20, maxNativeZoom: 18,
                opacity: 1, defaultOn: false, enabled: true, status: 'duplicate',
                statusNote: 'Same register as “protected built heritage, areas (SYKE)” above.',
                attribution: ATTR.syke, attributionRow: 'Suojellut rakennukset © SYKE (CC BY 4.0)',
                description: 'Area delineations of Building Protection Act sites — the same data the dedicated ' +
                    'Rakennussuojelualueet service publishes.',
                notes: null
            },

            /* C.7/C.8 — Muinaisjäännösrekisteri via museoverkko GetWFSFeatures.
             * One entry per geometry table; subGroup = the register category.
             * ids 133–135, 136–138, 139–141, 142–144, 145–147, 148–150 are
             * blocks of {pisteet, alakohteet, alueet}; the last two
             * categories are blocked on the public route (documented below). */

            {
                id: 'mj-kiinteat-pisteet',
                title: {
                    "en": "Immovable ancient relics · points",
                    "ro": "Immovable ancient relics · points",
                    "de": "Immovable ancient relics · points",
                    "fr": "Immovable ancient relics · points",
                    "it": "Immovable ancient relics · points",
                    "es": "Immovable ancient relics · points",
                    "pl": "Immovable ancient relics · points",
                    "uk": "Immovable ancient relics · points",
                    "hu": "Immovable ancient relics · points",
                    "cs": "Immovable ancient relics · points",
                    "sk": "Immovable ancient relics · points",
                    "nl": "Immovable ancient relics · points",
                    "bg": "Immovable ancient relics · points",
                    "el": "Immovable ancient relics · points",
                    "pt": "Immovable ancient relics · points",
                    "da": "Immovable ancient relics · points",
                    "sv": "Immovable ancient relics · points",
                    "no": "Immovable ancient relics · points",
                    "fi": "Kiinteät muinaisjäännökset · pisteet",
                    "et": "Immovable ancient relics · points",
                    "lv": "Immovable ancient relics · points",
                    "lt": "Immovable ancient relics · points",
                    "hr": "Immovable ancient relics · points",
                    "sr": "Immovable ancient relics · points",
                    "sl": "Immovable ancient relics · points",
                    "ru": "Immovable ancient relics · points",
                    "sq": "Immovable ancient relics · points"
                },
                kind: 'wfs', group: 'protected', subGroup: 'kiiteat',
                wfsId: 133, table: 'kiinteat_muinaisjaannokset_pisteet', geom: 'point',
                minZoom: 10, maxZoom: 20, opacity: 1, defaultOn: true, enabled: true, status: 'ok',
                verified: true,
                attribution: ATTR.museo, attributionRow: 'Muinaisjäännösrekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.register,
                description: 'All fixed ancient monuments protected under the Antiquities Act (muinaismuistolaki 295/1963) — ' +
                    'the core of the Muinaisjäännösrekisteri. Points exist for every registered site; location accuracy is ' +
                    'about ±50 m on average (±15 m for new GPS measurements).',
                notes: 'Verified live 2026-10-17: GeoJSON in EPSG:4326 with KYPPI links per feature.'
            },
            {
                id: 'mj-kiinteat-alakohteet',
                title: {
                    "en": "Immovable ancient relics · sub-sites",
                    "ro": "Immovable ancient relics · sub-sites",
                    "de": "Immovable ancient relics · sub-sites",
                    "fr": "Immovable ancient relics · sub-sites",
                    "it": "Immovable ancient relics · sub-sites",
                    "es": "Immovable ancient relics · sub-sites",
                    "pl": "Immovable ancient relics · sub-sites",
                    "uk": "Immovable ancient relics · sub-sites",
                    "hu": "Immovable ancient relics · sub-sites",
                    "cs": "Immovable ancient relics · sub-sites",
                    "sk": "Immovable ancient relics · sub-sites",
                    "nl": "Immovable ancient relics · sub-sites",
                    "bg": "Immovable ancient relics · sub-sites",
                    "el": "Immovable ancient relics · sub-sites",
                    "pt": "Immovable ancient relics · sub-sites",
                    "da": "Immovable ancient relics · sub-sites",
                    "sv": "Immovable ancient relics · sub-sites",
                    "no": "Immovable ancient relics · sub-sites",
                    "fi": "Kiinteät muinaisjäännökset · alakohteet",
                    "et": "Immovable ancient relics · sub-sites",
                    "lv": "Immovable ancient relics · sub-sites",
                    "lt": "Immovable ancient relics · sub-sites",
                    "hr": "Immovable ancient relics · sub-sites",
                    "sr": "Immovable ancient relics · sub-sites",
                    "sl": "Immovable ancient relics · sub-sites",
                    "ru": "Immovable ancient relics · sub-sites",
                    "sq": "Immovable ancient relics · sub-sites"
                },
                kind: 'wfs', group: 'protected', subGroup: 'kiiteat',
                wfsId: 134, table: 'kiinteat_muinaisjaannokset_alakohteet', geom: 'point',
                minZoom: 12, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                verified: true,
                attribution: ATTR.museo, attributionRow: 'Muinaisjäännösrekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.subsite,
                description: 'Sub-sites of the protected monuments (a single monument can hold several named sub-sites with ' +
                    'their own types). Shown from z12 because dense urban areas carry thousands of them.',
                notes: 'Verified live 2026-10-17.'
            },
            {
                id: 'mj-kiinteat-alueet',
                title: {
                    "en": "Immovable ancient relics · areas",
                    "ro": "Immovable ancient relics · areas",
                    "de": "Immovable ancient relics · areas",
                    "fr": "Immovable ancient relics · areas",
                    "it": "Immovable ancient relics · areas",
                    "es": "Immovable ancient relics · areas",
                    "pl": "Immovable ancient relics · areas",
                    "uk": "Immovable ancient relics · areas",
                    "hu": "Immovable ancient relics · areas",
                    "cs": "Immovable ancient relics · areas",
                    "sk": "Immovable ancient relics · areas",
                    "nl": "Immovable ancient relics · areas",
                    "bg": "Immovable ancient relics · areas",
                    "el": "Immovable ancient relics · areas",
                    "pt": "Immovable ancient relics · areas",
                    "da": "Immovable ancient relics · areas",
                    "sv": "Immovable ancient relics · areas",
                    "no": "Immovable ancient relics · areas",
                    "fi": "Kiinteät muinaisjäännökset · aluerajaukset",
                    "et": "Immovable ancient relics · areas",
                    "lv": "Immovable ancient relics · areas",
                    "lt": "Immovable ancient relics · areas",
                    "hr": "Immovable ancient relics · areas",
                    "sr": "Immovable ancient relics · areas",
                    "sl": "Immovable ancient relics · areas",
                    "ru": "Immovable ancient relics · areas",
                    "sq": "Immovable ancient relics · areas"
                },
                kind: 'wfs', group: 'protected', subGroup: 'kiiteat',
                wfsId: 135, table: 'kiinteat_muinaisjaannokset_alueet', geom: 'polygon',
                minZoom: 9, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                verified: true,
                attribution: ATTR.museo, attributionRow: 'Muinaisjäännösrekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.register,
                description: 'Digitised area delineations of protected monuments (only some monuments have an area; ' +
                    'point-only sites have no defined extent).',
                notes: 'Verified live 2026-10-17 (Helsinki WWI defence works).'
            },
            {
                id: 'mj-mahdolliset-pisteet',
                title: {
                    "en": "Possible ancient relics · points",
                    "ro": "Possible ancient relics · points",
                    "de": "Possible ancient relics · points",
                    "fr": "Possible ancient relics · points",
                    "it": "Possible ancient relics · points",
                    "es": "Possible ancient relics · points",
                    "pl": "Possible ancient relics · points",
                    "uk": "Possible ancient relics · points",
                    "hu": "Possible ancient relics · points",
                    "cs": "Possible ancient relics · points",
                    "sk": "Possible ancient relics · points",
                    "nl": "Possible ancient relics · points",
                    "bg": "Possible ancient relics · points",
                    "el": "Possible ancient relics · points",
                    "pt": "Possible ancient relics · points",
                    "da": "Possible ancient relics · points",
                    "sv": "Possible ancient relics · points",
                    "no": "Possible ancient relics · points",
                    "fi": "Mahdolliset muinaisjäännökset · pisteet",
                    "et": "Possible ancient relics · points",
                    "lv": "Possible ancient relics · points",
                    "lt": "Possible ancient relics · points",
                    "hr": "Possible ancient relics · points",
                    "sr": "Possible ancient relics · points",
                    "sl": "Possible ancient relics · points",
                    "ru": "Possible ancient relics · points",
                    "sq": "Possible ancient relics · points"
                },
                kind: 'wfs', group: 'protected', subGroup: 'mahdolliset',
                wfsId: 142, table: 'mahdolliset_muinaisjaannokset_pisteet', geom: 'point',
                minZoom: 10, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                verified: true,
                attribution: ATTR.museo, attributionRow: 'Muinaisjäännösrekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.register,
                description: 'Sites suspected to be ancient monuments — protected until investigated, but not confirmed.',
                notes: 'Verified live 2026-10-17.'
            },
            {
                id: 'mj-mahdolliset-alakohteet',
                title: {
                    "en": "Possible ancient relics · sub-sites",
                    "ro": "Possible ancient relics · sub-sites",
                    "de": "Possible ancient relics · sub-sites",
                    "fr": "Possible ancient relics · sub-sites",
                    "it": "Possible ancient relics · sub-sites",
                    "es": "Possible ancient relics · sub-sites",
                    "pl": "Possible ancient relics · sub-sites",
                    "uk": "Possible ancient relics · sub-sites",
                    "hu": "Possible ancient relics · sub-sites",
                    "cs": "Possible ancient relics · sub-sites",
                    "sk": "Possible ancient relics · sub-sites",
                    "nl": "Possible ancient relics · sub-sites",
                    "bg": "Possible ancient relics · sub-sites",
                    "el": "Possible ancient relics · sub-sites",
                    "pt": "Possible ancient relics · sub-sites",
                    "da": "Possible ancient relics · sub-sites",
                    "sv": "Possible ancient relics · sub-sites",
                    "no": "Possible ancient relics · sub-sites",
                    "fi": "Mahdolliset muinaisjäännökset · alakohteet",
                    "et": "Possible ancient relics · sub-sites",
                    "lv": "Possible ancient relics · sub-sites",
                    "lt": "Possible ancient relics · sub-sites",
                    "hr": "Possible ancient relics · sub-sites",
                    "sr": "Possible ancient relics · sub-sites",
                    "sl": "Possible ancient relics · sub-sites",
                    "ru": "Possible ancient relics · sub-sites",
                    "sq": "Possible ancient relics · sub-sites"
                },
                kind: 'wfs', group: 'protected', subGroup: 'mahdolliset',
                wfsId: 143, table: 'mahdolliset_muinaisjaannokset_alakohteet', geom: 'point',
                minZoom: 12, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'unverified',
                verified: false,
                attribution: ATTR.museo, attributionRow: 'Muinaisjäännösrekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.subsite,
                description: 'Sub-sites of the suspected monuments.',
                notes: 'id inferred from the verified {pisteet, alakohteet, alueet} block pattern (142–144); empty in the Helsinki probe box, so the table name is confirmed only by the pattern — tools/verify-finland-layers.mjs settles it.'
            },
            {
                id: 'mj-mahdolliset-alueet',
                title: {
                    "en": "Possible ancient relics · areas",
                    "ro": "Possible ancient relics · areas",
                    "de": "Possible ancient relics · areas",
                    "fr": "Possible ancient relics · areas",
                    "it": "Possible ancient relics · areas",
                    "es": "Possible ancient relics · areas",
                    "pl": "Possible ancient relics · areas",
                    "uk": "Possible ancient relics · areas",
                    "hu": "Possible ancient relics · areas",
                    "cs": "Possible ancient relics · areas",
                    "sk": "Possible ancient relics · areas",
                    "nl": "Possible ancient relics · areas",
                    "bg": "Possible ancient relics · areas",
                    "el": "Possible ancient relics · areas",
                    "pt": "Possible ancient relics · areas",
                    "da": "Possible ancient relics · areas",
                    "sv": "Possible ancient relics · areas",
                    "no": "Possible ancient relics · areas",
                    "fi": "Mahdolliset muinaisjäännökset · aluerajaukset",
                    "et": "Possible ancient relics · areas",
                    "lv": "Possible ancient relics · areas",
                    "lt": "Possible ancient relics · areas",
                    "hr": "Possible ancient relics · areas",
                    "sr": "Possible ancient relics · areas",
                    "sl": "Possible ancient relics · areas",
                    "ru": "Possible ancient relics · areas",
                    "sq": "Possible ancient relics · areas"
                },
                kind: 'wfs', group: 'protected', subGroup: 'mahdolliset',
                wfsId: 144, table: 'mahdolliset_muinaisjaannokset_alueet', geom: 'polygon',
                minZoom: 9, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'unverified',
                verified: false,
                attribution: ATTR.museo, attributionRow: 'Muinaisjäännösrekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.register,
                description: 'Area delineations of suspected monuments.',
                notes: 'id inferred from the block pattern (142–144); see tools/verify-finland-layers.mjs.'
            },
            {
                id: 'mj-poistetut-pisteet',
                title: {
                    "en": "Removed immovable ancient relics · points",
                    "ro": "Removed immovable ancient relics · points",
                    "de": "Removed immovable ancient relics · points",
                    "fr": "Removed immovable ancient relics · points",
                    "it": "Removed immovable ancient relics · points",
                    "es": "Removed immovable ancient relics · points",
                    "pl": "Removed immovable ancient relics · points",
                    "uk": "Removed immovable ancient relics · points",
                    "hu": "Removed immovable ancient relics · points",
                    "cs": "Removed immovable ancient relics · points",
                    "sk": "Removed immovable ancient relics · points",
                    "nl": "Removed immovable ancient relics · points",
                    "bg": "Removed immovable ancient relics · points",
                    "el": "Removed immovable ancient relics · points",
                    "pt": "Removed immovable ancient relics · points",
                    "da": "Removed immovable ancient relics · points",
                    "sv": "Removed immovable ancient relics · points",
                    "no": "Removed immovable ancient relics · points",
                    "fi": "Poistetut kiinteät muinaisjäännökset · pisteet",
                    "et": "Removed immovable ancient relics · points",
                    "lv": "Removed immovable ancient relics · points",
                    "lt": "Removed immovable ancient relics · points",
                    "hr": "Removed immovable ancient relics · points",
                    "sr": "Removed immovable ancient relics · points",
                    "sl": "Removed immovable ancient relics · points",
                    "ru": "Removed immovable ancient relics · points",
                    "sq": "Removed immovable ancient relics · points"
                },
                kind: 'wfs', group: 'protected', subGroup: 'poistetut',
                wfsId: 148, table: 'poistetut_kiinteat_muinaisjaannokset_pisteet', geom: 'point',
                minZoom: 10, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                verified: true,
                attribution: ATTR.museo, attributionRow: 'Muinaisjäännösrekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.register,
                description: 'Monuments that were deregistered (usually because investigation showed nothing protected ' +
                    'remains). Drawn greyed out.',
                notes: 'Verified live 2026-10-17.'
            },
            {
                id: 'mj-poistetut-alakohteet',
                title: {
                    "en": "Removed immovable ancient relics · sub-sites",
                    "ro": "Removed immovable ancient relics · sub-sites",
                    "de": "Removed immovable ancient relics · sub-sites",
                    "fr": "Removed immovable ancient relics · sub-sites",
                    "it": "Removed immovable ancient relics · sub-sites",
                    "es": "Removed immovable ancient relics · sub-sites",
                    "pl": "Removed immovable ancient relics · sub-sites",
                    "uk": "Removed immovable ancient relics · sub-sites",
                    "hu": "Removed immovable ancient relics · sub-sites",
                    "cs": "Removed immovable ancient relics · sub-sites",
                    "sk": "Removed immovable ancient relics · sub-sites",
                    "nl": "Removed immovable ancient relics · sub-sites",
                    "bg": "Removed immovable ancient relics · sub-sites",
                    "el": "Removed immovable ancient relics · sub-sites",
                    "pt": "Removed immovable ancient relics · sub-sites",
                    "da": "Removed immovable ancient relics · sub-sites",
                    "sv": "Removed immovable ancient relics · sub-sites",
                    "no": "Removed immovable ancient relics · sub-sites",
                    "fi": "Poistetut kiinteät muinaisjäännökset · alakohteet",
                    "et": "Removed immovable ancient relics · sub-sites",
                    "lv": "Removed immovable ancient relics · sub-sites",
                    "lt": "Removed immovable ancient relics · sub-sites",
                    "hr": "Removed immovable ancient relics · sub-sites",
                    "sr": "Removed immovable ancient relics · sub-sites",
                    "sl": "Removed immovable ancient relics · sub-sites",
                    "ru": "Removed immovable ancient relics · sub-sites",
                    "sq": "Removed immovable ancient relics · sub-sites"
                },
                kind: 'wfs', group: 'protected', subGroup: 'poistetut',
                wfsId: 149, table: 'poistetut_kiinteat_muinaisjaannokset_alakohteet', geom: 'point',
                minZoom: 12, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                verified: true,
                attribution: ATTR.museo, attributionRow: 'Muinaisjäännösrekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.subsite,
                description: 'Sub-sites of the deregistered monuments.',
                notes: 'Verified live 2026-10-17.'
            },
            {
                id: 'mj-poistetut-alueet',
                title: {
                    "en": "Removed immovable ancient relics · areas",
                    "ro": "Removed immovable ancient relics · areas",
                    "de": "Removed immovable ancient relics · areas",
                    "fr": "Removed immovable ancient relics · areas",
                    "it": "Removed immovable ancient relics · areas",
                    "es": "Removed immovable ancient relics · areas",
                    "pl": "Removed immovable ancient relics · areas",
                    "uk": "Removed immovable ancient relics · areas",
                    "hu": "Removed immovable ancient relics · areas",
                    "cs": "Removed immovable ancient relics · areas",
                    "sk": "Removed immovable ancient relics · areas",
                    "nl": "Removed immovable ancient relics · areas",
                    "bg": "Removed immovable ancient relics · areas",
                    "el": "Removed immovable ancient relics · areas",
                    "pt": "Removed immovable ancient relics · areas",
                    "da": "Removed immovable ancient relics · areas",
                    "sv": "Removed immovable ancient relics · areas",
                    "no": "Removed immovable ancient relics · areas",
                    "fi": "Poistetut kiinteät muinaisjäännökset · aluerajaukset",
                    "et": "Removed immovable ancient relics · areas",
                    "lv": "Removed immovable ancient relics · areas",
                    "lt": "Removed immovable ancient relics · areas",
                    "hr": "Removed immovable ancient relics · areas",
                    "sr": "Removed immovable ancient relics · areas",
                    "sl": "Removed immovable ancient relics · areas",
                    "ru": "Removed immovable ancient relics · areas",
                    "sq": "Removed immovable ancient relics · areas"
                },
                kind: 'wfs', group: 'protected', subGroup: 'poistetut',
                wfsId: 150, table: 'poistetut_kiinteat_muinaisjaannokset_alueet', geom: 'polygon',
                minZoom: 9, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                verified: true,
                attribution: ATTR.museo, attributionRow: 'Muinaisjäännösrekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.register,
                description: 'Area delineations of deregistered monuments (the brief’s original id=151 example turned out ' +
                    'to be project areas — the real table is id=150).',
                notes: 'Verified live 2026-10-17.'
            },
            {
                id: 'mj-loytopaikat-pisteet',
                title: {
                    "en": "Places of discovery · points",
                    "ro": "Places of discovery · points",
                    "de": "Places of discovery · points",
                    "fr": "Places of discovery · points",
                    "it": "Places of discovery · points",
                    "es": "Places of discovery · points",
                    "pl": "Places of discovery · points",
                    "uk": "Places of discovery · points",
                    "hu": "Places of discovery · points",
                    "cs": "Places of discovery · points",
                    "sk": "Places of discovery · points",
                    "nl": "Places of discovery · points",
                    "bg": "Places of discovery · points",
                    "el": "Places of discovery · points",
                    "pt": "Places of discovery · points",
                    "da": "Places of discovery · points",
                    "sv": "Places of discovery · points",
                    "no": "Places of discovery · points",
                    "fi": "Löytöpaikat · pisteet",
                    "et": "Places of discovery · points",
                    "lv": "Places of discovery · points",
                    "lt": "Places of discovery · points",
                    "hr": "Places of discovery · points",
                    "sr": "Places of discovery · points",
                    "sl": "Places of discovery · points",
                    "ru": "Places of discovery · points",
                    "sq": "Places of discovery · points"
                },
                kind: 'wfs', group: 'protected', subGroup: 'loytopaikat',
                wfsId: 139, table: 'loytopaikat_pisteet', geom: 'point',
                minZoom: 10, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                verified: true,
                attribution: ATTR.museo, attributionRow: 'Muinaisjäännösrekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.register,
                description: 'Find spots — places where artefacts or stray finds were made (loose finds, wrecks, ballast sites).',
                notes: 'Verified live 2026-10-17.'
            },
            {
                id: 'mj-loytopaikat-alakohteet',
                title: {
                    "en": "Places of discovery · sub-sites",
                    "ro": "Places of discovery · sub-sites",
                    "de": "Places of discovery · sub-sites",
                    "fr": "Places of discovery · sub-sites",
                    "it": "Places of discovery · sub-sites",
                    "es": "Places of discovery · sub-sites",
                    "pl": "Places of discovery · sub-sites",
                    "uk": "Places of discovery · sub-sites",
                    "hu": "Places of discovery · sub-sites",
                    "cs": "Places of discovery · sub-sites",
                    "sk": "Places of discovery · sub-sites",
                    "nl": "Places of discovery · sub-sites",
                    "bg": "Places of discovery · sub-sites",
                    "el": "Places of discovery · sub-sites",
                    "pt": "Places of discovery · sub-sites",
                    "da": "Places of discovery · sub-sites",
                    "sv": "Places of discovery · sub-sites",
                    "no": "Places of discovery · sub-sites",
                    "fi": "Löytöpaikat · alakohteet",
                    "et": "Places of discovery · sub-sites",
                    "lv": "Places of discovery · sub-sites",
                    "lt": "Places of discovery · sub-sites",
                    "hr": "Places of discovery · sub-sites",
                    "sr": "Places of discovery · sub-sites",
                    "sl": "Places of discovery · sub-sites",
                    "ru": "Places of discovery · sub-sites",
                    "sq": "Places of discovery · sub-sites"
                },
                kind: 'wfs', group: 'protected', subGroup: 'loytopaikat',
                wfsId: 140, table: 'loytopaikat_alakohteet', geom: 'point',
                minZoom: 12, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'unverified',
                verified: false,
                attribution: ATTR.museo, attributionRow: 'Muinaisjäännösrekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.subsite,
                description: 'Individual find contexts within the find spots.',
                notes: 'id inferred from the block pattern (139–141).'
            },
            {
                id: 'mj-loytopaikat-alueet',
                title: {
                    "en": "Places of discovery · areas",
                    "ro": "Places of discovery · areas",
                    "de": "Places of discovery · areas",
                    "fr": "Places of discovery · areas",
                    "it": "Places of discovery · areas",
                    "es": "Places of discovery · areas",
                    "pl": "Places of discovery · areas",
                    "uk": "Places of discovery · areas",
                    "hu": "Places of discovery · areas",
                    "cs": "Places of discovery · areas",
                    "sk": "Places of discovery · areas",
                    "nl": "Places of discovery · areas",
                    "bg": "Places of discovery · areas",
                    "el": "Places of discovery · areas",
                    "pt": "Places of discovery · areas",
                    "da": "Places of discovery · areas",
                    "sv": "Places of discovery · areas",
                    "no": "Places of discovery · areas",
                    "fi": "Löytöpaikat · aluerajaukset",
                    "et": "Places of discovery · areas",
                    "lv": "Places of discovery · areas",
                    "lt": "Places of discovery · areas",
                    "hr": "Places of discovery · areas",
                    "sr": "Places of discovery · areas",
                    "sl": "Places of discovery · areas",
                    "ru": "Places of discovery · areas",
                    "sq": "Places of discovery · areas"
                },
                kind: 'wfs', group: 'protected', subGroup: 'loytopaikat',
                wfsId: 141, table: 'loytopaikat_alueet', geom: 'polygon',
                minZoom: 9, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'unverified',
                verified: false,
                attribution: ATTR.museo, attributionRow: 'Muinaisjäännösrekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.register,
                description: 'Area delineations of find spots.',
                notes: 'id inferred from the block pattern (139–141).'
            },
            {
                id: 'mj-luonnonmuodostumat-pisteet',
                title: {
                    "en": "Natural formations · points",
                    "ro": "Natural formations · points",
                    "de": "Natural formations · points",
                    "fr": "Natural formations · points",
                    "it": "Natural formations · points",
                    "es": "Natural formations · points",
                    "pl": "Natural formations · points",
                    "uk": "Natural formations · points",
                    "hu": "Natural formations · points",
                    "cs": "Natural formations · points",
                    "sk": "Natural formations · points",
                    "nl": "Natural formations · points",
                    "bg": "Natural formations · points",
                    "el": "Natural formations · points",
                    "pt": "Natural formations · points",
                    "da": "Natural formations · points",
                    "sv": "Natural formations · points",
                    "no": "Natural formations · points",
                    "fi": "Luonnonmuodostumat · pisteet",
                    "et": "Natural formations · points",
                    "lv": "Natural formations · points",
                    "lt": "Natural formations · points",
                    "hr": "Natural formations · points",
                    "sr": "Natural formations · points",
                    "sl": "Natural formations · points",
                    "ru": "Natural formations · points",
                    "sq": "Natural formations · points"
                },
                kind: 'wfs', group: 'protected', subGroup: 'luonnonmuodostumat',
                wfsId: 136, table: 'luonnonmuodostumat_pisteet', geom: 'point',
                minZoom: 10, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                verified: true,
                attribution: ATTR.museo, attributionRow: 'Muinaisjäännösrekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.register,
                description: 'Natural formations recorded in the register (sacred stones, giant’s kettles and related ' +
                    'landscape features).',
                notes: 'Verified live 2026-10-17 (Northern Ostrobothnia box).'
            },
            {
                id: 'mj-luonnonmuodostumat-alakohteet',
                title: {
                    "en": "Natural formations · sub-sites",
                    "ro": "Natural formations · sub-sites",
                    "de": "Natural formations · sub-sites",
                    "fr": "Natural formations · sub-sites",
                    "it": "Natural formations · sub-sites",
                    "es": "Natural formations · sub-sites",
                    "pl": "Natural formations · sub-sites",
                    "uk": "Natural formations · sub-sites",
                    "hu": "Natural formations · sub-sites",
                    "cs": "Natural formations · sub-sites",
                    "sk": "Natural formations · sub-sites",
                    "nl": "Natural formations · sub-sites",
                    "bg": "Natural formations · sub-sites",
                    "el": "Natural formations · sub-sites",
                    "pt": "Natural formations · sub-sites",
                    "da": "Natural formations · sub-sites",
                    "sv": "Natural formations · sub-sites",
                    "no": "Natural formations · sub-sites",
                    "fi": "Luonnonmuodostumat · alakohteet",
                    "et": "Natural formations · sub-sites",
                    "lv": "Natural formations · sub-sites",
                    "lt": "Natural formations · sub-sites",
                    "hr": "Natural formations · sub-sites",
                    "sr": "Natural formations · sub-sites",
                    "sl": "Natural formations · sub-sites",
                    "ru": "Natural formations · sub-sites",
                    "sq": "Natural formations · sub-sites"
                },
                kind: 'wfs', group: 'protected', subGroup: 'luonnonmuodostumat',
                wfsId: 137, table: 'luonnonmuodostumat_alakohteet', geom: 'point',
                minZoom: 12, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'unverified',
                verified: false,
                attribution: ATTR.museo, attributionRow: 'Muinaisjäännösrekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.subsite,
                description: 'Sub-sites of the recorded natural formations.',
                notes: 'id inferred from the block pattern (136–138).'
            },
            {
                id: 'mj-luonnonmuodostumat-alueet',
                title: {
                    "en": "Natural formations · areas",
                    "ro": "Natural formations · areas",
                    "de": "Natural formations · areas",
                    "fr": "Natural formations · areas",
                    "it": "Natural formations · areas",
                    "es": "Natural formations · areas",
                    "pl": "Natural formations · areas",
                    "uk": "Natural formations · areas",
                    "hu": "Natural formations · areas",
                    "cs": "Natural formations · areas",
                    "sk": "Natural formations · areas",
                    "nl": "Natural formations · areas",
                    "bg": "Natural formations · areas",
                    "el": "Natural formations · areas",
                    "pt": "Natural formations · areas",
                    "da": "Natural formations · areas",
                    "sv": "Natural formations · areas",
                    "no": "Natural formations · areas",
                    "fi": "Luonnonmuodostumat · aluerajaukset",
                    "et": "Natural formations · areas",
                    "lv": "Natural formations · areas",
                    "lt": "Natural formations · areas",
                    "hr": "Natural formations · areas",
                    "sr": "Natural formations · areas",
                    "sl": "Natural formations · areas",
                    "ru": "Natural formations · areas",
                    "sq": "Natural formations · areas"
                },
                kind: 'wfs', group: 'protected', subGroup: 'luonnonmuodostumat',
                wfsId: 138, table: 'luonnonmuodostumat_alueet', geom: 'polygon',
                minZoom: 9, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'unverified',
                verified: false,
                attribution: ATTR.museo, attributionRow: 'Muinaisjäännösrekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.register,
                description: 'Area delineations of the recorded natural formations.',
                notes: 'id inferred from the block pattern (136–138).'
            },
            {
                id: 'mj-muut-pisteet',
                title: {
                    "en": "Other items · points",
                    "ro": "Other items · points",
                    "de": "Other items · points",
                    "fr": "Other items · points",
                    "it": "Other items · points",
                    "es": "Other items · points",
                    "pl": "Other items · points",
                    "uk": "Other items · points",
                    "hu": "Other items · points",
                    "cs": "Other items · points",
                    "sk": "Other items · points",
                    "nl": "Other items · points",
                    "bg": "Other items · points",
                    "el": "Other items · points",
                    "pt": "Other items · points",
                    "da": "Other items · points",
                    "sv": "Other items · points",
                    "no": "Other items · points",
                    "fi": "Muut kohteet · pisteet",
                    "et": "Other items · points",
                    "lv": "Other items · points",
                    "lt": "Other items · points",
                    "hr": "Other items · points",
                    "sr": "Other items · points",
                    "sl": "Other items · points",
                    "ru": "Other items · points",
                    "sq": "Other items · points"
                },
                kind: 'wfs', group: 'protected', subGroup: 'muut',
                wfsId: 145, table: 'muut_kohteet_pisteet', geom: 'point',
                minZoom: 10, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                verified: true,
                attribution: ATTR.museo, attributionRow: 'Muinaisjäännösrekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.register,
                description: 'Other registered items — mostly wrecks, jetties and harbour structures outside the ' +
                    'protected categories.',
                notes: 'Verified live 2026-10-17.'
            },
            {
                id: 'mj-muut-alakohteet',
                title: {
                    "en": "Other items · sub-items",
                    "ro": "Other items · sub-items",
                    "de": "Other items · sub-items",
                    "fr": "Other items · sub-items",
                    "it": "Other items · sub-items",
                    "es": "Other items · sub-items",
                    "pl": "Other items · sub-items",
                    "uk": "Other items · sub-items",
                    "hu": "Other items · sub-items",
                    "cs": "Other items · sub-items",
                    "sk": "Other items · sub-items",
                    "nl": "Other items · sub-items",
                    "bg": "Other items · sub-items",
                    "el": "Other items · sub-items",
                    "pt": "Other items · sub-items",
                    "da": "Other items · sub-items",
                    "sv": "Other items · sub-items",
                    "no": "Other items · sub-items",
                    "fi": "Muut kohteet · alakohteet",
                    "et": "Other items · sub-items",
                    "lv": "Other items · sub-items",
                    "lt": "Other items · sub-items",
                    "hr": "Other items · sub-items",
                    "sr": "Other items · sub-items",
                    "sl": "Other items · sub-items",
                    "ru": "Other items · sub-items",
                    "sq": "Other items · sub-items"
                },
                kind: 'wfs', group: 'protected', subGroup: 'muut',
                wfsId: 146, table: 'muut_kohteet_alakohteet', geom: 'point',
                minZoom: 12, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'unverified',
                verified: false,
                attribution: ATTR.museo, attributionRow: 'Muinaisjäännösrekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.subsite,
                description: 'Sub-items of the other registered items.',
                notes: 'id inferred from the block pattern (145–147).'
            },
            {
                id: 'mj-muut-alueet',
                title: {
                    "en": "Other items · areas",
                    "ro": "Other items · areas",
                    "de": "Other items · areas",
                    "fr": "Other items · areas",
                    "it": "Other items · areas",
                    "es": "Other items · areas",
                    "pl": "Other items · areas",
                    "uk": "Other items · areas",
                    "hu": "Other items · areas",
                    "cs": "Other items · areas",
                    "sk": "Other items · areas",
                    "nl": "Other items · areas",
                    "bg": "Other items · areas",
                    "el": "Other items · areas",
                    "pt": "Other items · areas",
                    "da": "Other items · areas",
                    "sv": "Other items · areas",
                    "no": "Other items · areas",
                    "fi": "Muut kohteet · aluerajaukset",
                    "et": "Other items · areas",
                    "lv": "Other items · areas",
                    "lt": "Other items · areas",
                    "hr": "Other items · areas",
                    "sr": "Other items · areas",
                    "sl": "Other items · areas",
                    "ru": "Other items · areas",
                    "sq": "Other items · areas"
                },
                kind: 'wfs', group: 'protected', subGroup: 'muut',
                wfsId: 147, table: 'muut_kohteet_alueet', geom: 'polygon',
                minZoom: 9, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'unverified',
                verified: false,
                attribution: ATTR.museo, attributionRow: 'Muinaisjäännösrekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.register,
                description: 'Area delineations of the other registered items.',
                notes: 'id inferred from the block pattern (145–147).'
            },

            /* The two register categories that are NOT public on
             * GetWFSFeatures — listed, explained, never silently dropped. */
            {
                id: 'mj-havaintokohteet',
                title: {
                    "en": "Observation sites / targets / objects (blocked)",
                    "ro": "Observation sites / targets / objects (blocked)",
                    "de": "Observation sites / targets / objects (blocked)",
                    "fr": "Observation sites / targets / objects (blocked)",
                    "it": "Observation sites / targets / objects (blocked)",
                    "es": "Observation sites / targets / objects (blocked)",
                    "pl": "Observation sites / targets / objects (blocked)",
                    "uk": "Observation sites / targets / objects (blocked)",
                    "hu": "Observation sites / targets / objects (blocked)",
                    "cs": "Observation sites / targets / objects (blocked)",
                    "sk": "Observation sites / targets / objects (blocked)",
                    "nl": "Observation sites / targets / objects (blocked)",
                    "bg": "Observation sites / targets / objects (blocked)",
                    "el": "Observation sites / targets / objects (blocked)",
                    "pt": "Observation sites / targets / objects (blocked)",
                    "da": "Observation sites / targets / objects (blocked)",
                    "sv": "Observation sites / targets / objects (blocked)",
                    "no": "Observation sites / targets / objects (blocked)",
                    "fi": "Havaintokohteet (ei julkinen rajapinnassa)",
                    "et": "Observation sites / targets / objects (blocked)",
                    "lv": "Observation sites / targets / objects (blocked)",
                    "lt": "Observation sites / targets / objects (blocked)",
                    "hr": "Observation sites / targets / objects (blocked)",
                    "sr": "Observation sites / targets / objects (blocked)",
                    "sl": "Observation sites / targets / objects (blocked)",
                    "ru": "Observation sites / targets / objects (blocked)",
                    "sq": "Observation sites / targets / objects (blocked)"
                },
                kind: 'wfs', group: 'protected', subGroup: 'havainnot',
                wfsId: 130, table: 'havaintokohteet', geom: 'mixed',
                minZoom: 10, maxZoom: 20, opacity: 1, defaultOn: false, enabled: false, status: 'blocked',
                statusNote: 'ids 130–132 of the public route are not accessible: 130 and 131 answer ' +
                    '“User doesn’t have permissions for requested layer”, 132 answers “Failed to retrieve features”. ' +
                    'Museovirasto’s own OGC WFS for these tables needs a Museoverkko account. Ask ' +
                    'paikkatieto@museovirasto.fi if you need them.',
                attribution: ATTR.museo, attributionRow: 'Muinaisjäännösrekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.register,
                description: 'Observation targets/objects recorded in the register. Not reachable through the public ' +
                    'browser route — see the status note.',
                notes: 'Probed 2026-10-17.'
            },
            {
                id: 'mj-muut-kulttuuriperintokohteet',
                title: {
                    "en": "Other cultural heritage sites (blocked)",
                    "ro": "Other cultural heritage sites (blocked)",
                    "de": "Other cultural heritage sites (blocked)",
                    "fr": "Other cultural heritage sites (blocked)",
                    "it": "Other cultural heritage sites (blocked)",
                    "es": "Other cultural heritage sites (blocked)",
                    "pl": "Other cultural heritage sites (blocked)",
                    "uk": "Other cultural heritage sites (blocked)",
                    "hu": "Other cultural heritage sites (blocked)",
                    "cs": "Other cultural heritage sites (blocked)",
                    "sk": "Other cultural heritage sites (blocked)",
                    "nl": "Other cultural heritage sites (blocked)",
                    "bg": "Other cultural heritage sites (blocked)",
                    "el": "Other cultural heritage sites (blocked)",
                    "pt": "Other cultural heritage sites (blocked)",
                    "da": "Other cultural heritage sites (blocked)",
                    "sv": "Other cultural heritage sites (blocked)",
                    "no": "Other cultural heritage sites (blocked)",
                    "fi": "Muut kulttuuriperintökohteet (ei julkisia rajapinnassa)",
                    "et": "Other cultural heritage sites (blocked)",
                    "lv": "Other cultural heritage sites (blocked)",
                    "lt": "Other cultural heritage sites (blocked)",
                    "hr": "Other cultural heritage sites (blocked)",
                    "sr": "Other cultural heritage sites (blocked)",
                    "sl": "Other cultural heritage sites (blocked)",
                    "ru": "Other cultural heritage sites (blocked)",
                    "sq": "Other cultural heritage sites (blocked)"
                },
                kind: 'wfs', group: 'protected', subGroup: 'muut_kulttuuri',
                wfsId: 153, table: 'muut_kulttuuriperintokohteet', geom: 'mixed',
                minZoom: 10, maxZoom: 20, opacity: 1, defaultOn: false, enabled: false, status: 'blocked',
                statusNote: 'ids 153–154 of the public route answer “User doesn’t have permissions for requested layer”. ' +
                    'Museovirasto’s own OGC WFS needs a Museoverkko account. Ask paikkatieto@museovirasto.fi.',
                attribution: ATTR.museo, attributionRow: 'Muinaisjäännösrekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.register,
                description: 'Other cultural-heritage sites in the register (e.g. recent-history sites). Not reachable ' +
                    'through the public browser route — see the status note.',
                notes: 'Probed 2026-10-17.'
            },

            /* Bonus (needed for the Supabase comparison): the protected-
             * buildings register itself, live. id 155 points + 156 areas. */
            {
                id: 'mv-rakennusperinto-piste',
                title: {
                    "en": "Finland · protected buildings register, sites (Museovirasto)",
                    "ro": "Finland · protected buildings register, sites (Museovirasto)",
                    "de": "Finland · protected buildings register, sites (Museovirasto)",
                    "fr": "Finland · protected buildings register, sites (Museovirasto)",
                    "it": "Finland · protected buildings register, sites (Museovirasto)",
                    "es": "Finland · protected buildings register, sites (Museovirasto)",
                    "pl": "Finland · protected buildings register, sites (Museovirasto)",
                    "uk": "Finland · protected buildings register, sites (Museovirasto)",
                    "hu": "Finland · protected buildings register, sites (Museovirasto)",
                    "cs": "Finland · protected buildings register, sites (Museovirasto)",
                    "sk": "Finland · protected buildings register, sites (Museovirasto)",
                    "nl": "Finland · protected buildings register, sites (Museovirasto)",
                    "bg": "Finland · protected buildings register, sites (Museovirasto)",
                    "el": "Finland · protected buildings register, sites (Museovirasto)",
                    "pt": "Finland · protected buildings register, sites (Museovirasto)",
                    "da": "Finland · protected buildings register, sites (Museovirasto)",
                    "sv": "Finland · protected buildings register, sites (Museovirasto)",
                    "no": "Finland · protected buildings register, sites (Museovirasto)",
                    "fi": "Rakennusperintörekisteri · suojellut rakennukset (pisteet)",
                    "et": "Finland · protected buildings register, sites (Museovirasto)",
                    "lv": "Finland · protected buildings register, sites (Museovirasto)",
                    "lt": "Finland · protected buildings register, sites (Museovirasto)",
                    "hr": "Finland · protected buildings register, sites (Museovirasto)",
                    "sr": "Finland · protected buildings register, sites (Museovirasto)",
                    "sl": "Finland · protected buildings register, sites (Museovirasto)",
                    "ru": "Finland · protected buildings register, sites (Museovirasto)",
                    "sq": "Finland · protected buildings register, sites (Museovirasto)"
                },
                kind: 'wfs', group: 'protected', subGroup: 'rakennusperinto',
                wfsId: 155, table: 'rakennusperinto_suojellut_piste', geom: 'point',
                minZoom: 11, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                verified: true,
                attribution: ATTR.museo, attributionRow: 'Rakennusperintörekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.building,
                description: 'The Museovirasto protected-buildings register itself — every protection instrument ' +
                    '(decrees, the Church and Orthodox Church Acts, the railway agreement, the Building Protection Act), ' +
                    'so a superset of the SYKE “special legislation” layers. Click a building for its protection ' +
                    'instrument and KYPPI entry.',
                notes: 'Verified live 2026-10-17 (Ateneum, Eduskuntatalo, Kansallismuseo…).'
            },
            {
                id: 'mv-rakennusperinto-alue',
                title: {
                    "en": "Finland · protected buildings register, areas (Museovirasto)",
                    "ro": "Finland · protected buildings register, areas (Museovirasto)",
                    "de": "Finland · protected buildings register, areas (Museovirasto)",
                    "fr": "Finland · protected buildings register, areas (Museovirasto)",
                    "it": "Finland · protected buildings register, areas (Museovirasto)",
                    "es": "Finland · protected buildings register, areas (Museovirasto)",
                    "pl": "Finland · protected buildings register, areas (Museovirasto)",
                    "uk": "Finland · protected buildings register, areas (Museovirasto)",
                    "hu": "Finland · protected buildings register, areas (Museovirasto)",
                    "cs": "Finland · protected buildings register, areas (Museovirasto)",
                    "sk": "Finland · protected buildings register, areas (Museovirasto)",
                    "nl": "Finland · protected buildings register, areas (Museovirasto)",
                    "bg": "Finland · protected buildings register, areas (Museovirasto)",
                    "el": "Finland · protected buildings register, areas (Museovirasto)",
                    "pt": "Finland · protected buildings register, areas (Museovirasto)",
                    "da": "Finland · protected buildings register, areas (Museovirasto)",
                    "sv": "Finland · protected buildings register, areas (Museovirasto)",
                    "no": "Finland · protected buildings register, areas (Museovirasto)",
                    "fi": "Rakennusperintörekisteri · suojellut rakennukset (alueet)",
                    "et": "Finland · protected buildings register, areas (Museovirasto)",
                    "lv": "Finland · protected buildings register, areas (Museovirasto)",
                    "lt": "Finland · protected buildings register, areas (Museovirasto)",
                    "hr": "Finland · protected buildings register, areas (Museovirasto)",
                    "sr": "Finland · protected buildings register, areas (Museovirasto)",
                    "sl": "Finland · protected buildings register, areas (Museovirasto)",
                    "ru": "Finland · protected buildings register, areas (Museovirasto)",
                    "sq": "Finland · protected buildings register, areas (Museovirasto)"
                },
                kind: 'wfs', group: 'protected', subGroup: 'rakennusperinto',
                wfsId: 156, table: 'rakennusperinto_suojellut_alue', geom: 'polygon',
                minZoom: 10, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                verified: true,
                attribution: ATTR.museo, attributionRow: 'Rakennusperintörekisteri © Museovirasto (CC BY 4.0)',
                popup: POPUP.building,
                description: 'Area delineations of the protected buildings (“suojelurajaus”; several copied from SYKE’s ' +
                    'interface).',
                notes: 'Verified live 2026-10-17 (Tarvaspää, Villa Kleineh, Olympiastadion…).'
            },

            /* ══════════════════════════════════════════════════════════════
             * D · ÅLAND — Kulturarv/Fornminnen (ArcGIS Server)
             * ══════════════════════════════════════════════════════════════ */

            {
                id: 'aland-fornminnen',
                title: {
                    "en": "Åland · ancient monuments",
                    "ro": "Åland · ancient monuments",
                    "de": "Åland · ancient monuments",
                    "fr": "Åland · ancient monuments",
                    "it": "Åland · ancient monuments",
                    "es": "Åland · ancient monuments",
                    "pl": "Åland · ancient monuments",
                    "uk": "Åland · ancient monuments",
                    "hu": "Åland · ancient monuments",
                    "cs": "Åland · ancient monuments",
                    "sk": "Åland · ancient monuments",
                    "nl": "Åland · ancient monuments",
                    "bg": "Åland · ancient monuments",
                    "el": "Åland · ancient monuments",
                    "pt": "Åland · ancient monuments",
                    "da": "Åland · ancient monuments",
                    "sv": "Åland · ancient monuments",
                    "no": "Åland · ancient monuments",
                    "fi": "Ahvenanmaa · muinaisjäännökset (fornlämningar)",
                    "et": "Åland · ancient monuments",
                    "lv": "Åland · ancient monuments",
                    "lt": "Åland · ancient monuments",
                    "hr": "Åland · ancient monuments",
                    "sr": "Åland · ancient monuments",
                    "sl": "Åland · ancient monuments",
                    "ru": "Åland · ancient monuments",
                    "sq": "Åland · ancient monuments"
                },
                kind: 'arcgis', group: 'aland',
                restService: 'Kulturarv/Fornminnen/MapServer', layerId: 1,
                minZoom: 8, maxZoom: 20, maxNativeZoom: 19, opacity: 1, defaultOn: true, enabled: true, status: 'ok',
                attribution: ATTR.aland, attributionRow: 'Fornminnen © Ålands landskapsregering (CC BY 4.0)',
                popup: POPUP.aland,
                description: 'The Åland ancient-monuments register kept by the provincial government’s Culture Office ' +
                    '(municipality, village, monument type and dating; scale ≈ 1:20 000). Åland’s monuments are NOT part ' +
                    'of the mainland Muinaisjäännösrekisteri, so this layer adds sites the Finnish layers cannot show. ' +
                    'Rendered from the ArcGIS REST export endpoint in the map’s own projection; clicking fetches the ' +
                    'matching GeoJSON features for the popup.',
                notes: 'REST export with bboxSR=3857 verified live 2026-10-17 (f=json returns image 256×256 metadata). CSW record da0e5eb9-… lists the INSPIRE WMS twin.'
            },
            {
                id: 'aland-skyddsomraden',
                title: {
                    "en": "Åland · monument protection areas",
                    "ro": "Åland · monument protection areas",
                    "de": "Åland · monument protection areas",
                    "fr": "Åland · monument protection areas",
                    "it": "Åland · monument protection areas",
                    "es": "Åland · monument protection areas",
                    "pl": "Åland · monument protection areas",
                    "uk": "Åland · monument protection areas",
                    "hu": "Åland · monument protection areas",
                    "cs": "Åland · monument protection areas",
                    "sk": "Åland · monument protection areas",
                    "nl": "Åland · monument protection areas",
                    "bg": "Åland · monument protection areas",
                    "el": "Åland · monument protection areas",
                    "pt": "Åland · monument protection areas",
                    "da": "Åland · monument protection areas",
                    "sv": "Åland · monument protection areas",
                    "no": "Åland · monument protection areas",
                    "fi": "Ahvenanmaa · suojelualueet (fornminneskyddsområden)",
                    "et": "Åland · monument protection areas",
                    "lv": "Åland · monument protection areas",
                    "lt": "Åland · monument protection areas",
                    "hr": "Åland · monument protection areas",
                    "sr": "Åland · monument protection areas",
                    "sl": "Åland · monument protection areas",
                    "ru": "Åland · monument protection areas",
                    "sq": "Åland · monument protection areas"
                },
                kind: 'arcgis', group: 'aland',
                restService: 'Kulturarv/Fornminnen/MapServer', layerId: 0,
                minZoom: 8, maxZoom: 20, maxNativeZoom: 19, opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                attribution: ATTR.aland, attributionRow: 'Skyddsområden © Ålands landskapsregering (CC BY 4.0)',
                popup: POPUP.aland,
                description: 'Protected-area delineations around Åland’s ancient monuments.',
                notes: null
            },
            {
                id: 'aland-maritima',
                title: {
                    "en": "Åland · maritime ancient monuments",
                    "ro": "Åland · maritime ancient monuments",
                    "de": "Åland · maritime ancient monuments",
                    "fr": "Åland · maritime ancient monuments",
                    "it": "Åland · maritime ancient monuments",
                    "es": "Åland · maritime ancient monuments",
                    "pl": "Åland · maritime ancient monuments",
                    "uk": "Åland · maritime ancient monuments",
                    "hu": "Åland · maritime ancient monuments",
                    "cs": "Åland · maritime ancient monuments",
                    "sk": "Åland · maritime ancient monuments",
                    "nl": "Åland · maritime ancient monuments",
                    "bg": "Åland · maritime ancient monuments",
                    "el": "Åland · maritime ancient monuments",
                    "pt": "Åland · maritime ancient monuments",
                    "da": "Åland · maritime ancient monuments",
                    "sv": "Åland · maritime ancient monuments",
                    "no": "Åland · maritime ancient monuments",
                    "fi": "Ahvenanmaa · merelliset muinaisjäännökset",
                    "et": "Åland · maritime ancient monuments",
                    "lv": "Åland · maritime ancient monuments",
                    "lt": "Åland · maritime ancient monuments",
                    "hr": "Åland · maritime ancient monuments",
                    "sr": "Åland · maritime ancient monuments",
                    "sl": "Åland · maritime ancient monuments",
                    "ru": "Åland · maritime ancient monuments",
                    "sq": "Åland · maritime ancient monuments"
                },
                kind: 'arcgis', group: 'aland',
                restService: 'Kulturarv/Fornminnen/MapServer', layerId: 5,
                minZoom: 8, maxZoom: 20, maxNativeZoom: 19, opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                attribution: ATTR.aland, attributionRow: 'Maritima fornminnen © Ålands landskapsregering (CC BY 4.0)',
                popup: POPUP.aland,
                description: 'Maritime heritage sites (wrecks and underwater remains) around Åland.',
                notes: null
            },
            {
                id: 'aland-krigstida',
                title: {
                    "en": "Åland · wartime remains",
                    "ro": "Åland · wartime remains",
                    "de": "Åland · wartime remains",
                    "fr": "Åland · wartime remains",
                    "it": "Åland · wartime remains",
                    "es": "Åland · wartime remains",
                    "pl": "Åland · wartime remains",
                    "uk": "Åland · wartime remains",
                    "hu": "Åland · wartime remains",
                    "cs": "Åland · wartime remains",
                    "sk": "Åland · wartime remains",
                    "nl": "Åland · wartime remains",
                    "bg": "Åland · wartime remains",
                    "el": "Åland · wartime remains",
                    "pt": "Åland · wartime remains",
                    "da": "Åland · wartime remains",
                    "sv": "Åland · wartime remains",
                    "no": "Åland · wartime remains",
                    "fi": "Ahvenanmaa · sotaaikaiset jäännökset",
                    "et": "Åland · wartime remains",
                    "lv": "Åland · wartime remains",
                    "lt": "Åland · wartime remains",
                    "hr": "Åland · wartime remains",
                    "sr": "Åland · wartime remains",
                    "sl": "Åland · wartime remains",
                    "ru": "Åland · wartime remains",
                    "sq": "Åland · wartime remains"
                },
                kind: 'arcgis', group: 'aland',
                restService: 'Kulturarv/Fornminnen/MapServer', layerId: 6,
                minZoom: 8, maxZoom: 20, maxNativeZoom: 19, opacity: 1, defaultOn: false, enabled: true, status: 'ok',
                attribution: ATTR.aland, attributionRow: 'Krigstida lämningar © Ålands landskapsregering (CC BY 4.0)',
                popup: POPUP.aland,
                description: 'First/Second World War fortification remains around Åland (not visible by default in the ' +
                    'province’s own map either).',
                notes: null
            },

            /* ══════════════════════════════════════════════════════════════
             * E · LOCAL FILES (Supabase-hosted GeoPackages, converted)
             * ══════════════════════════════════════════════════════════════ */

            {
                id: 'local-rky-alue',
                title: {
                    "en": "Finland · RKY built environments of national significance · areas (local file)",
                    "ro": "Finland · RKY built environments of national significance · areas (local file)",
                    "de": "Finland · RKY built environments of national significance · areas (local file)",
                    "fr": "Finland · RKY built environments of national significance · areas (local file)",
                    "it": "Finland · RKY built environments of national significance · areas (local file)",
                    "es": "Finland · RKY built environments of national significance · areas (local file)",
                    "pl": "Finland · RKY built environments of national significance · areas (local file)",
                    "uk": "Finland · RKY built environments of national significance · areas (local file)",
                    "hu": "Finland · RKY built environments of national significance · areas (local file)",
                    "cs": "Finland · RKY built environments of national significance · areas (local file)",
                    "sk": "Finland · RKY built environments of national significance · areas (local file)",
                    "nl": "Finland · RKY built environments of national significance · areas (local file)",
                    "bg": "Finland · RKY built environments of national significance · areas (local file)",
                    "el": "Finland · RKY built environments of national significance · areas (local file)",
                    "pt": "Finland · RKY built environments of national significance · areas (local file)",
                    "da": "Finland · RKY built environments of national significance · areas (local file)",
                    "sv": "Finland · RKY built environments of national significance · areas (local file)",
                    "no": "Finland · RKY built environments of national significance · areas (local file)",
                    "fi": "RKY · valtakunnallisesti merkittävät rakennetut kulttuuriympäristöt · alueet",
                    "et": "Finland · RKY built environments of national significance · areas (local file)",
                    "lv": "Finland · RKY built environments of national significance · areas (local file)",
                    "lt": "Finland · RKY built environments of national significance · areas (local file)",
                    "hr": "Finland · RKY built environments of national significance · areas (local file)",
                    "sr": "Finland · RKY built environments of national significance · areas (local file)",
                    "sl": "Finland · RKY built environments of national significance · areas (local file)",
                    "ru": "Finland · RKY built environments of national significance · areas (local file)",
                    "sq": "Finland · RKY built environments of national significance · areas (local file)"
                },
                kind: 'geojson', group: 'local',
                file: 'rky_inspire_alue', supabaseFile: 'converted/rky_inspire_alue.geojson',
                geom: 'polygon', style: { color: '#c9a227', weight: 2, fill: true, fillOpacity: 0.08 },
                minZoom: 6, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'needs-conversion',
                statusNote: 'GeoPackage conversion not run yet — run node tools/finland-convert-gpkg.mjs where the ' +
                    'Supabase bucket is reachable (see FINLAND_LAYERS.md §local-files).',
                attribution: ATTR.local, attributionRow: 'RKY-aineisto (omaa konversiota, lähde Museovirasto)',
                popup: POPUP.generic,
                description: 'RKY — the nationally significant built cultural environments (valtakunnallisesti merkittävät ' +
                    'rakennetut kulttuuriympäristöt), areas. Served from the local GeoJSON conversion of the Supabase ' +
                    'GeoPackage (no public live vector service exists for RKY; Museovirasto’s WFS for it is permit-gated).',
                notes: 'Source: rky_inspire_alue.gpkg (INSPIRE schema). QML styling not provided for the areas file.'
            },
            {
                id: 'local-rky-piste',
                title: {
                    "en": "Finland · RKY sites (local file)",
                    "ro": "Finland · RKY sites (local file)",
                    "de": "Finland · RKY sites (local file)",
                    "fr": "Finland · RKY sites (local file)",
                    "it": "Finland · RKY sites (local file)",
                    "es": "Finland · RKY sites (local file)",
                    "pl": "Finland · RKY sites (local file)",
                    "uk": "Finland · RKY sites (local file)",
                    "hu": "Finland · RKY sites (local file)",
                    "cs": "Finland · RKY sites (local file)",
                    "sk": "Finland · RKY sites (local file)",
                    "nl": "Finland · RKY sites (local file)",
                    "bg": "Finland · RKY sites (local file)",
                    "el": "Finland · RKY sites (local file)",
                    "pt": "Finland · RKY sites (local file)",
                    "da": "Finland · RKY sites (local file)",
                    "sv": "Finland · RKY sites (local file)",
                    "no": "Finland · RKY sites (local file)",
                    "fi": "RKY · pisteet",
                    "et": "Finland · RKY sites (local file)",
                    "lv": "Finland · RKY sites (local file)",
                    "lt": "Finland · RKY sites (local file)",
                    "hr": "Finland · RKY sites (local file)",
                    "sr": "Finland · RKY sites (local file)",
                    "sl": "Finland · RKY sites (local file)",
                    "ru": "Finland · RKY sites (local file)",
                    "sq": "Finland · RKY sites (local file)"
                },
                kind: 'geojson', group: 'local',
                file: 'rky_piste', supabaseFile: 'converted/rky_piste.geojson',
                geom: 'point', style: { color: '#c9a227', weight: 2, radius: 5, fill: true, fillOpacity: 0.5 },
                minZoom: 8, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'needs-conversion',
                statusNote: 'GeoPackage conversion not run yet — run node tools/finland-convert-gpkg.mjs.',
                attribution: ATTR.local, attributionRow: 'RKY-aineisto (omaa konversiota, lähde Museovirasto)',
                popup: POPUP.generic,
                description: 'RKY sites as points (the non-INSPIRE rky_piste.gpkg variant, which carries the fuller ' +
                    'attribute set; rky_inspire_piste.gpkg is the same geometry in the INSPIRE schema and is not ' +
                    'converted separately).',
                notes: 'rky_piste.qml is read by the conversion script for the colour scheme.'
            },
            {
                id: 'local-rky-viiva',
                title: {
                    "en": "Finland · RKY lines (local file)",
                    "ro": "Finland · RKY lines (local file)",
                    "de": "Finland · RKY lines (local file)",
                    "fr": "Finland · RKY lines (local file)",
                    "it": "Finland · RKY lines (local file)",
                    "es": "Finland · RKY lines (local file)",
                    "pl": "Finland · RKY lines (local file)",
                    "uk": "Finland · RKY lines (local file)",
                    "hu": "Finland · RKY lines (local file)",
                    "cs": "Finland · RKY lines (local file)",
                    "sk": "Finland · RKY lines (local file)",
                    "nl": "Finland · RKY lines (local file)",
                    "bg": "Finland · RKY lines (local file)",
                    "el": "Finland · RKY lines (local file)",
                    "pt": "Finland · RKY lines (local file)",
                    "da": "Finland · RKY lines (local file)",
                    "sv": "Finland · RKY lines (local file)",
                    "no": "Finland · RKY lines (local file)",
                    "fi": "RKY · viivat (esim. reitit, kanavat)",
                    "et": "Finland · RKY lines (local file)",
                    "lv": "Finland · RKY lines (local file)",
                    "lt": "Finland · RKY lines (local file)",
                    "hr": "Finland · RKY lines (local file)",
                    "sr": "Finland · RKY lines (local file)",
                    "sl": "Finland · RKY lines (local file)",
                    "ru": "Finland · RKY lines (local file)",
                    "sq": "Finland · RKY lines (local file)"
                },
                kind: 'geojson', group: 'local',
                file: 'rky_viiva', supabaseFile: 'converted/rky_viiva.geojson',
                geom: 'line', style: { color: '#c9a227', weight: 3, dash: '6,4' },
                minZoom: 8, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'needs-conversion',
                statusNote: 'GeoPackage conversion not run yet — run node tools/finland-convert-gpkg.mjs.',
                attribution: ATTR.local, attributionRow: 'RKY-aineisto (omaa konversiota, lähde Museovirasto)',
                popup: POPUP.generic,
                description: 'Linear RKY environments (routes, canals, roads). rky_viiva.qml is read by the conversion ' +
                    'script for the styling.',
                notes: null
            },
            {
                id: 'local-vark-alue',
                title: {
                    "en": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "ro": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "de": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "fr": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "it": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "es": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "pl": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "uk": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "hu": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "cs": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "sk": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "nl": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "bg": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "el": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "pt": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "da": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "sv": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "no": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "fi": "VARK · arkeologiset kulttuuriympäristöt · aluerajaukset",
                    "et": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "lv": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "lt": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "hr": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "sr": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "sl": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "ru": "Finland · VARK archaeological cultural environments · areas (local file)",
                    "sq": "Finland · VARK archaeological cultural environments · areas (local file)"
                },
                kind: 'geojson', group: 'local',
                file: 'VARK_aluerajaukset', supabaseFile: 'converted/VARK_aluerajaukset.geojson',
                geom: 'polygon', style: { color: '#e07b39', weight: 2, fill: true, fillOpacity: 0.08 },
                minZoom: 6, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'needs-conversion',
                statusNote: 'GeoPackage conversion not run yet — run node tools/finland-convert-gpkg.mjs.',
                attribution: ATTR.local, attributionRow: 'VARK-aineisto (omaa konversiota, lähde Museovirasto)',
                popup: POPUP.generic,
                description: 'VARK — nationally important archaeological cultural environments ' +
                    '(valtakunnallisesti arvokkaat arkeologisen kulttuuriperinnön kohteet), area delineations from the ' +
                    'Supabase GeoPackage conversion.',
                notes: null
            },
            {
                id: 'local-vark-piste',
                title: {
                    "en": "Finland · VARK centroids (local file)",
                    "ro": "Finland · VARK centroids (local file)",
                    "de": "Finland · VARK centroids (local file)",
                    "fr": "Finland · VARK centroids (local file)",
                    "it": "Finland · VARK centroids (local file)",
                    "es": "Finland · VARK centroids (local file)",
                    "pl": "Finland · VARK centroids (local file)",
                    "uk": "Finland · VARK centroids (local file)",
                    "hu": "Finland · VARK centroids (local file)",
                    "cs": "Finland · VARK centroids (local file)",
                    "sk": "Finland · VARK centroids (local file)",
                    "nl": "Finland · VARK centroids (local file)",
                    "bg": "Finland · VARK centroids (local file)",
                    "el": "Finland · VARK centroids (local file)",
                    "pt": "Finland · VARK centroids (local file)",
                    "da": "Finland · VARK centroids (local file)",
                    "sv": "Finland · VARK centroids (local file)",
                    "no": "Finland · VARK centroids (local file)",
                    "fi": "VARK · keskipisteet",
                    "et": "Finland · VARK centroids (local file)",
                    "lv": "Finland · VARK centroids (local file)",
                    "lt": "Finland · VARK centroids (local file)",
                    "hr": "Finland · VARK centroids (local file)",
                    "sr": "Finland · VARK centroids (local file)",
                    "sl": "Finland · VARK centroids (local file)",
                    "ru": "Finland · VARK centroids (local file)",
                    "sq": "Finland · VARK centroids (local file)"
                },
                kind: 'geojson', group: 'local',
                file: 'VARK_keskipisteet', supabaseFile: 'converted/VARK_keskipisteet.geojson',
                geom: 'point', style: { color: '#e07b39', weight: 2, radius: 5, fill: true, fillOpacity: 0.5 },
                minZoom: 8, maxZoom: 20, opacity: 1, defaultOn: false, enabled: true, status: 'needs-conversion',
                statusNote: 'GeoPackage conversion not run yet — run node tools/finland-convert-gpkg.mjs.',
                attribution: ATTR.local, attributionRow: 'VARK-aineisto (omaa konversiota, lähde Museovirasto)',
                popup: POPUP.generic,
                description: 'Centroids of the VARK areas.',
                notes: null
            },
            {
                id: 'local-arkeologiset-alakohteet',
                title: {
                    "en": "Archaeological sub-sites, points (local file · duplicate)",
                    "ro": "Archaeological sub-sites, points (local file · duplicate)",
                    "de": "Archaeological sub-sites, points (local file · duplicate)",
                    "fr": "Archaeological sub-sites, points (local file · duplicate)",
                    "it": "Archaeological sub-sites, points (local file · duplicate)",
                    "es": "Archaeological sub-sites, points (local file · duplicate)",
                    "pl": "Archaeological sub-sites, points (local file · duplicate)",
                    "uk": "Archaeological sub-sites, points (local file · duplicate)",
                    "hu": "Archaeological sub-sites, points (local file · duplicate)",
                    "cs": "Archaeological sub-sites, points (local file · duplicate)",
                    "sk": "Archaeological sub-sites, points (local file · duplicate)",
                    "nl": "Archaeological sub-sites, points (local file · duplicate)",
                    "bg": "Archaeological sub-sites, points (local file · duplicate)",
                    "el": "Archaeological sub-sites, points (local file · duplicate)",
                    "pt": "Archaeological sub-sites, points (local file · duplicate)",
                    "da": "Archaeological sub-sites, points (local file · duplicate)",
                    "sv": "Archaeological sub-sites, points (local file · duplicate)",
                    "no": "Archaeological sub-sites, points (local file · duplicate)",
                    "fi": "Arkeologisten kohteiden alakohteet (pisteet) — kaksoiskappale",
                    "et": "Archaeological sub-sites, points (local file · duplicate)",
                    "lv": "Archaeological sub-sites, points (local file · duplicate)",
                    "lt": "Archaeological sub-sites, points (local file · duplicate)",
                    "hr": "Archaeological sub-sites, points (local file · duplicate)",
                    "sr": "Archaeological sub-sites, points (local file · duplicate)",
                    "sl": "Archaeological sub-sites, points (local file · duplicate)",
                    "ru": "Archaeological sub-sites, points (local file · duplicate)",
                    "sq": "Archaeological sub-sites, points (local file · duplicate)"
                },
                kind: 'geojson', group: 'local',
                file: 'arkeologiset_kohteet_alakohteet_piste', supabaseFile: 'converted/arkeologiset_kohteet_alakohteet_piste.geojson',
                geom: 'point', style: { color: '#8b6fc9', weight: 2, radius: 4, fill: true, fillOpacity: 0.5 },
                minZoom: 12, maxZoom: 20, opacity: 1, defaultOn: false, enabled: false, status: 'duplicate',
                statusNote: 'Duplicates the live museoverkko sub-site layers (mj-*-alakohteet): the conversion report ' +
                    'should be compared against those before enabling. Kept here for offline use.',
                attribution: ATTR.local, attributionRow: 'Museoviraston alakohteet (omaa konversiota)',
                popup: POPUP.subsite,
                description: 'The register’s sub-sites as one file. The same sub-sites are already served live by the ' +
                    'museoverkko layers, so this row stays off unless you want a static copy.',
                notes: null
            },
            {
                id: 'local-suojellut-alue',
                title: {
                    "en": "Protected buildings, areas (Supabase · duplicate)",
                    "ro": "Protected buildings, areas (Supabase · duplicate)",
                    "de": "Protected buildings, areas (Supabase · duplicate)",
                    "fr": "Protected buildings, areas (Supabase · duplicate)",
                    "it": "Protected buildings, areas (Supabase · duplicate)",
                    "es": "Protected buildings, areas (Supabase · duplicate)",
                    "pl": "Protected buildings, areas (Supabase · duplicate)",
                    "uk": "Protected buildings, areas (Supabase · duplicate)",
                    "hu": "Protected buildings, areas (Supabase · duplicate)",
                    "cs": "Protected buildings, areas (Supabase · duplicate)",
                    "sk": "Protected buildings, areas (Supabase · duplicate)",
                    "nl": "Protected buildings, areas (Supabase · duplicate)",
                    "bg": "Protected buildings, areas (Supabase · duplicate)",
                    "el": "Protected buildings, areas (Supabase · duplicate)",
                    "pt": "Protected buildings, areas (Supabase · duplicate)",
                    "da": "Protected buildings, areas (Supabase · duplicate)",
                    "sv": "Protected buildings, areas (Supabase · duplicate)",
                    "no": "Protected buildings, areas (Supabase · duplicate)",
                    "fi": "Suojellut rakennukset · alueet (Supabase) — kaksoiskappale",
                    "et": "Protected buildings, areas (Supabase · duplicate)",
                    "lv": "Protected buildings, areas (Supabase · duplicate)",
                    "lt": "Protected buildings, areas (Supabase · duplicate)",
                    "hr": "Protected buildings, areas (Supabase · duplicate)",
                    "sr": "Protected buildings, areas (Supabase · duplicate)",
                    "sl": "Protected buildings, areas (Supabase · duplicate)",
                    "ru": "Protected buildings, areas (Supabase · duplicate)",
                    "sq": "Protected buildings, areas (Supabase · duplicate)"
                },
                kind: 'geojson', group: 'local',
                file: 'suojellut_rakennukset_alue', supabaseFile: 'converted/suojellut_rakennukset_alue.geojson',
                geom: 'polygon', style: { color: '#d16ba5', weight: 2, fill: true, fillOpacity: 0.08 },
                minZoom: 10, maxZoom: 20, opacity: 1, defaultOn: false, enabled: false, status: 'duplicate',
                statusNote: 'Same register as the live Museovirasto protected-buildings layers (mv-rakennusperinto-alue) ' +
                    'and the SYKE built-heritage service — dropped as a duplicate per the brief’s rule. The conversion ' +
                    'report confirms the feature counts when the script runs.',
                attribution: ATTR.local, attributionRow: 'Rakennusperintörekisteri (omaa konversiota)',
                popup: POPUP.building,
                description: 'Protected-buildings areas from the Supabase GeoPackage — superseded by the live ' +
                    'Museovirasto/SYKE services.',
                notes: null
            },
            {
                id: 'local-suojellut-piste',
                title: {
                    "en": "Protected buildings, points (Supabase · duplicate)",
                    "ro": "Protected buildings, points (Supabase · duplicate)",
                    "de": "Protected buildings, points (Supabase · duplicate)",
                    "fr": "Protected buildings, points (Supabase · duplicate)",
                    "it": "Protected buildings, points (Supabase · duplicate)",
                    "es": "Protected buildings, points (Supabase · duplicate)",
                    "pl": "Protected buildings, points (Supabase · duplicate)",
                    "uk": "Protected buildings, points (Supabase · duplicate)",
                    "hu": "Protected buildings, points (Supabase · duplicate)",
                    "cs": "Protected buildings, points (Supabase · duplicate)",
                    "sk": "Protected buildings, points (Supabase · duplicate)",
                    "nl": "Protected buildings, points (Supabase · duplicate)",
                    "bg": "Protected buildings, points (Supabase · duplicate)",
                    "el": "Protected buildings, points (Supabase · duplicate)",
                    "pt": "Protected buildings, points (Supabase · duplicate)",
                    "da": "Protected buildings, points (Supabase · duplicate)",
                    "sv": "Protected buildings, points (Supabase · duplicate)",
                    "no": "Protected buildings, points (Supabase · duplicate)",
                    "fi": "Suojellut rakennukset · pisteet (Supabase) — kaksoiskappale",
                    "et": "Protected buildings, points (Supabase · duplicate)",
                    "lv": "Protected buildings, points (Supabase · duplicate)",
                    "lt": "Protected buildings, points (Supabase · duplicate)",
                    "hr": "Protected buildings, points (Supabase · duplicate)",
                    "sr": "Protected buildings, points (Supabase · duplicate)",
                    "sl": "Protected buildings, points (Supabase · duplicate)",
                    "ru": "Protected buildings, points (Supabase · duplicate)",
                    "sq": "Protected buildings, points (Supabase · duplicate)"
                },
                kind: 'geojson', group: 'local',
                file: 'suojellut_rakennukset_piste', supabaseFile: 'converted/suojellut_rakennukset_piste.geojson',
                geom: 'point', style: { color: '#d16ba5', weight: 2, radius: 5, fill: true, fillOpacity: 0.5 },
                minZoom: 11, maxZoom: 20, opacity: 1, defaultOn: false, enabled: false, status: 'duplicate',
                statusNote: 'Same register as the live Museovirasto protected-buildings layers (mv-rakennusperinto-piste) ' +
                    'and SYKE’s service — dropped as a duplicate.',
                attribution: ATTR.local, attributionRow: 'Rakennusperintörekisteri (omaa konversiota)',
                popup: POPUP.building,
                description: 'Protected-buildings points from the Supabase GeoPackage — superseded by the live services.',
                notes: null
            }
        ]
    };

    /* ── helpers the panel, the proxy and the tools all use ─────────────── */

    function byId(id) {
        for (var i = 0; i < CONFIG.layers.length; i++) {
            if (CONFIG.layers[i].id === id) return CONFIG.layers[i];
        }
        return null;
    }

    function enabledLayers() {
        return CONFIG.layers.filter(function (layer) { return layer.enabled !== false; });
    }

    function layersOfKind(kind) {
        return CONFIG.layers.filter(function (layer) { return layer.kind === kind; });
    }

    function layersOfGroup(groupId) {
        return CONFIG.layers.filter(function (layer) { return layer.group === groupId; });
    }

    function subGroupsOf(groupId) {
        var seen = {}, out = [];
        CONFIG.layers.forEach(function (layer) {
            if (layer.group !== groupId || !layer.subGroup) return;
            if (!seen[layer.subGroup]) { seen[layer.subGroup] = true; out.push(layer.subGroup); }
        });
        return out;
    }

    function categoryById(catId) {
        return (CONFIG.REGISTER_CATEGORIES || []).filter(function (c) { return c.id === catId; })[0] || null;
    }

    /* The SYKE WMS endpoints, by the config's service key. */
    function wmsUrl(serviceKey) {
        return CONFIG.endpoints[serviceKey] || null;
    }

    var WMS_SERVICES = {
        sykeBuilt: {
            url: 'https://paikkatiedot.ymparisto.fi/geoserver/syke_rakennussuojelukohteet/wms',
            proxySrc: 'syke',
            attribution: ATTR.syke
        },
        sykeInspire: {
            url: 'https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wms',
            proxySrc: 'syke',
            attribution: ATTR.syke
        }
    };

    /* Labels for the collapsible sub-sections inside “Protected sites”. */
    var SUBGROUP_LABELS = {
        built: { fi: 'Rakennusperintö (erityislait) — SYKE', en: 'Built heritage (special legislation) — SYKE' },
        'inspire-nature': { fi: 'Luonnonsuojelu ja erämaat — SYKE INSPIRE', en: 'Nature conservation & wilderness — SYKE INSPIRE' },
        'inspire-natura': { fi: 'Natura 2000 — SYKE INSPIRE', en: 'Natura 2000 — SYKE INSPIRE' },
        'inspire-built': { fi: 'Erityislailla suojellut rakennukset — SYKE INSPIRE', en: 'Specially-protected built heritage — SYKE INSPIRE' },
        rakennusperinto: { fi: 'Suojellut rakennukset — Museoviraston rekisteri', en: 'Protected buildings — Museovirasto register' },
        kiiteat: { fi: 'Kiinteät muinaisjäännökset', en: 'Immovable ancient relics' },
        mahdolliset: { fi: 'Mahdolliset muinaisjäännökset', en: 'Possible ancient relics' },
        poistetut: { fi: 'Poistetut kiinteät muinaisjäännökset', en: 'Removed immovable ancient relics' },
        loytopaikat: { fi: 'Löytöpaikat', en: 'Places of discovery' },
        havainnot: { fi: 'Havaintokohteet', en: 'Observation sites / targets / objects' },
        luonnonmuodostumat: { fi: 'Luonnonmuodostumat', en: 'Natural formations' },
        muut_kulttuuri: { fi: 'Muut kulttuuriperintökohteet', en: 'Other cultural heritage sites' },
        muut: { fi: 'Muut kohteet', en: 'Other items / other destinations' }
    };

    var api = {
        version: CONFIG.version,
        CONFIG: CONFIG,
        layers: CONFIG.layers,
        groups: CONFIG.GROUPS,
        byId: byId,
        enabledLayers: enabledLayers,
        layersOfKind: layersOfKind,
        layersOfGroup: layersOfGroup,
        subGroupsOf: subGroupsOf,
        categoryById: categoryById,
        wmsUrl: wmsUrl,
        WMS_SERVICES: WMS_SERVICES,
        SUBGROUP_LABELS: SUBGROUP_LABELS,
        FIELD_LABELS: FIELD_LABELS,
        REGISTER_CATEGORIES: CONFIG.REGISTER_CATEGORIES,
        endpoints: CONFIG.endpoints,
        attributionParts: ATTR,
        country: CONFIG.country,
        countryBounds: CONFIG.countryBounds,
        view: CONFIG.view,
        groupLabel: CONFIG.groupLabel,
        groupInfo: CONFIG.groupInfo,
        provider: 'Maanmittauslaitos · Museovirasto · SYKE · Ålands landskapsregering',
        licence: CONFIG.licence
    };

    return api;
}));
