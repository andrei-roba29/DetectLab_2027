/* ──────────────────────────────────────────────────────────────
   DetectLab — Mini tutorial (slides)
   ------------------------------------------------------------
   A "?" button in the top-right corner of the map opens a 13-slide
   walkthrough drawn on top of the live UI:

     1–2. map controls, detection, storage and account (PWA + desktop)
     3. the Friends panel: unified people search, requests and chats
     4–5. layers, on-map sliders and the FREE / PREMIUM catalogue
     6–8. 3D gestures, LiDAR scope/settings and analysis actions
     9–10. APM Next-Gen MANUAL, TRAIN, results and limitations
     11–12. historical-map alignment and everyday shortcuts
     13. tips for optimal performance

   Feature cards explain workflows without starting analyses, changing
   layers, entering 3D or requesting Premium/authentication on the user's behalf.
   Everything is purple with a transparent, blurred background.
   Targets are resolved at runtime from the real DOM, so the guide
   automatically adapts to whichever controls exist (PWA vs desktop).
   ────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    // ── i18n helpers ─────────────────────────────────────────────
    function lang() {
        try {
            if (typeof window._currentLang === 'function') {
                var l = window._currentLang();
                return l === 'en' ? 'en' : 'ro';
            }
        } catch (e) { /* storage/priv mode */ }
        return 'ro';
    }

    function tr(o) {
        if (o == null) return '';
        if (typeof o === 'string') return o;
        return o[lang()] || o.ro || o.en || '';
    }

    var UI = {
        help_title:  { ro: 'Ghid rapid', en: 'Quick guide' },
        prev:        { ro: 'Înapoi', en: 'Back' },
        next:        { ro: 'Înainte', en: 'Next' },
        close:       { ro: 'Închide ghidul', en: 'Close guide' },
        finish:      { ro: 'Am înțeles', en: 'Got it' },
        hint:        { ro: 'Atinge oriunde pentru slide-ul următor', en: 'Tap anywhere for the next slide' },
        free_tab:    { ro: 'GRATIS', en: 'FREE' },
        prem_tab:    { ro: 'PREMIUM', en: 'PREMIUM' }
    };

    // ── Slide definitions ────────────────────────────────────────
    // `sel` may be a CSS selector or an array of selectors (first match wins).
    var STEPS = [
        {
            id: 'left',
            title: { ro: 'Butoanele din stânga', en: 'The left-side buttons' },
            type: 'targets',
            placement: 'right',
            targets: [
                {
                    sel: '#detectlab-map .leaflet-control-zoom',
                    title: { ro: 'Zoom + / −', en: 'Zoom + / −' },
                    desc: {
                        ro: 'Mărește sau micșorează harta. Unele straturi apar doar de la un anumit nivel de zoom.',
                        en: 'Zoom the map in or out. Some layers only appear from a certain zoom level.'
                    }
                },
                {
                    sel: '#btnLiveLocation',
                    title: { ro: 'Locația mea', en: 'My location' },
                    desc: {
                        ro: 'Pornește / oprește urmărirea GPS în timp real. La prima poziție, harta se centrează și mărește dacă este nevoie; apoi poți micșora sau deplasa harta fără ca următoarele actualizări GPS să o readucă. Pe site, butonul stă în coloana din stânga; în aplicația instalată îl găsești în dreapta-jos, deasupra contului. Locația live poate porni și din comutatorul Detectare sau din lupa „Detectoriști din zonă”.',
                        en: 'Start / stop real-time GPS tracking. On the first fix, the map centres on you and zooms in if needed; afterwards you can zoom out or pan without later GPS updates moving the map back. On the website, the button is in the left-hand column; in the installed app it is at the bottom-right, above the account button. Live location can also start from the Detect switch or the "Detectorists nearby" magnifier.'
                    }
                },
                {
                    sel: '#btnMeasure',
                    title: { ro: 'Măsurare distanță', en: 'Measure distance' },
                    desc: {
                        ro: 'Atinge puncte pe hartă și afli distanța dintre ele (m / km). Apasă din nou pentru a opri.',
                        en: 'Tap points on the map to get the distance between them (m / km). Press again to stop.'
                    }
                },
                {
                    sel: '#btnCoord',
                    title: { ro: 'Coordonate', en: 'Coordinates' },
                    desc: {
                        ro: 'Alege un punct pe hartă și îi vezi coordonatele exacte; le poți copia, salva ca pin sau crea un eveniment din el.',
                        en: 'Pick a point on the map to see its exact coordinates; you can copy them, save them as a pin, or create an event from it.'
                    }
                },
                {
                    sel: '#btnTrack',
                    title: { ro: 'Înregistrare traseu', en: 'Record trail' },
                    desc: {
                        ro: 'Înregistrează pe hartă traseul parcurs pe teren, cu distanța și durata sesiunii.',
                        en: 'Record the trail you walk in the field on the map, with distance and session time.'
                    }
                },
                {
                    sel: '#btnOfflineMaps',
                    title: { ro: 'Hărți offline', en: 'Offline maps' },
                    desc: {
                        ro: 'Activează butonul, desenează un poligon de maximum 100 km², alege straturile disponibile, nivelul de zoom și descarcă-le pentru teren fără internet. Închide poligonul atingând primul punct sau apăsând „Finalizează”; dacă nu e mulțumit de formă, alege „Desenează alt poligon”. Cât timp o hartă offline e activă, un ✕ centrat jos o dezactivează.',
                        en: 'Activate the button, draw a polygon of up to 100 km², choose the available layers and the zoom level, then download them for use without internet. Close the polygon by tapping its first corner or pressing “Finish”; if the shape is not right, press “Draw another polygon”. While an offline map is active, a centred ✕ at the bottom leaves it.'
                    }
                },
                {
                    sel: '#detectlab-map .detectlab-compass',
                    title: { ro: 'Busolă', en: 'Compass' },
                    desc: {
                        ro: 'Arată nordul și urmărește rotirea hărții. Atinge busola ca să readuci harta la nord (0°), sau trage de ea la stânga/dreapta ca s-o rotești — exact ca în Google Earth. Nu există blocare a rotirii. În aplicația instalată, sub busolă găsești și comutatorul Detectare.',
                        en: 'Shows north and follows the map as it turns. Tap the compass to bring the map back to north (0°), or drag it left/right to rotate the view — just like Google Earth. There is no rotation lock. In the installed app, the Detect switch sits under the compass too.'
                    }
                }
            ],
            notes: [
                {
                    ico: '📅',
                    text: {
                        ro: '<b>Creare eveniment:</b> cu butonul Coordonate (sau dintr-un pin salvat) marchezi un punct, apoi apeși „Creează un eveniment”. Poți face evenimentul public sau anonim (cu cod de invitație).',
                        en: '<b>Create an event:</b> with the Coordinates button (or from a saved pin) mark a point, then tap “Create event”. You can make it public or anonymous (with an invite code).'
                    }
                },
                {
                    ico: '🎟',
                    text: {
                        ro: '<b>Participare la evenimente:</b> evenimentele publice apar pe hartă ca un coif — atinge-l și trimite o cerere de participare. Pentru evenimente anonime, deschide Contul tău → Evenimente și introdu codul primit.',
                        en: '<b>Join events:</b> public events appear on the map as a helmet — tap it and send a join request. For anonymous events, open Your account → Events and enter the code you were given.'
                    }
                }
            ]
        },
        {
            id: 'bottom',
            title: { ro: 'Detectare, stocare și cont', en: 'Detection, storage & account' },
            type: 'targets',
            placement: 'top',
            targets: [
                {
                    sel: ['#pwaDetectBtn', '#detectWrap'],
                    title: { ro: 'Detectare activitate', en: 'Activity detection' },
                    desc: {
                        ro: 'Te avertizează în timp real când te apropii de un sit arheologic sau de zona lui de protecție. În aplicația instalată, comutatorul e sub busolă, stânga-jos.',
                        en: 'Get real-time warnings when you approach an archaeological site or its protection zone. In the installed app, the switch sits under the compass, at the bottom-left.'
                    }
                },
                {
                    sel: '#savedLocationsBtn',
                    title: { ro: 'Locații salvate', en: 'Saved locations' },
                    desc: {
                        ro: 'Deschide lista coordonatelor salvate; atinge una și harta sare direct la ea. Aici găsești și categoria „Hărți offline”, de unde activezi sau ștergi hărțile salvate local.',
                        en: 'Open the list of saved coordinates; tap one and the map jumps straight to it. This button also contains “Offline maps”, where you activate or delete maps saved locally.'
                    }
                },
                {
                    sel: ['#pwaNearbyBtn', '#nearbyDetectorsBtn'],
                    title: { ro: 'Detectoriști din zonă', en: 'Detectorists nearby' },
                    desc: {
                        ro: 'Vezi ceilalți detectoriști activi în apropiere. Lupa pornește doar locația live — nu îți aprinde și comutatorul Detectare; ca să fii și tu de văzut pentru ceilalți, e de ajuns locația live plus răspunsul „Da” la întrebarea de vizibilitate. În aplicația instalată, butonul cu lupă stă în coloana de iconițe din stânga hărții. Atinge un pin și, din cartonașul lui, poți trimite o cerere de prietenie cu „＋ Adaugă prieten”.',
                        en: 'See other detectorists active nearby. The magnifier starts the live location only — it never switches your Detect mode on; to be visible to the others as well, live location plus the "Yes" answer to the visibility prompt is enough. In the installed app, the magnifier button sits in the icon column on the left of the map. Tap a pin and, from its card, you can send a friend request with "＋ Add friend".'
                    }
                },
                {
                    // The installed app has a separate account control beneath
                    // live location; pick whichever account control is visible.
                    sel: ['#navUser', '#pwaUserItem'],
                    title: { ro: 'Contul tău', en: 'Your account' },
                    desc: {
                        ro: 'Autentificare, administrarea contului și a abonamentului, evenimente și delogare, plus Limbă (română / engleză), Stocare (pin-uri, trasee și hărți salvate) și intrarea spre Prieteni (căutare, cereri, chat). Meniul contului stă în bara de sus a site-ului; în aplicația instalată, butonul contului este în dreapta-jos, sub locația live. Butonul 🎯 pornește doar locația live, nu deschide meniul contului.',
                        en: 'Log in, manage your account and subscription, events and log out, plus Language (Romanian / English), Storage (pins, trails and saved maps) and the entry to Friends (search, requests, chat). The account menu lives in the website\'s top bar; in the installed app, its button is at the bottom-right, below live location. The 🎯 button controls live location only; it does not open the account menu.'
                    }
                },
                {
                    sel: '#fullscreenBtn',
                    title: { ro: 'Ecran complet', en: 'Full screen' },
                    desc: {
                        ro: 'Extinde harta pe tot ecranul.',
                        en: 'Expand the map to the full screen.'
                    }
                }
            ]
        },
        {
            id: 'friends',
            title: { ro: 'Prieteni', en: 'Friends' },
            type: 'targets',
            placement: 'below',
            openFriends: true,
            requiresAuth: true,
            authNote: {
                ro: 'Panoul Prieteni apare după autentificare. Din meniul contului deschizi Prieteni: cauți detectoriști după nume, e-mail sau localitate (merge și parțial, fără diacritice), trimiți cereri de prietenie și discuți pe chat.',
                en: 'The Friends panel appears after you sign in. From the account menu you open Friends: search detectorists by name, e-mail or place (partial works, diacritics optional), send friend requests and chat.'
            },
            targets: [
                {
                    sel: '#frSearchInput',
                    title: { ro: 'Caută detectoriști', en: 'Search detectorists' },
                    desc: {
                        ro: 'Caută după nume, e-mail, localitate sau ID: merge și parțial („mihai” îl găsește pe Mihai), fără diacritice („muresan” îl găsește pe Mureșan), iar la mai multe cuvinte fiecare trebuie potrivită undeva („ana cluj”).',
                        en: 'Search by name, e-mail, place or id: partial works (“mihai” finds Mihai), diacritics are optional (“muresan” finds Mureșan), and with several words each must match somewhere (“ana cluj”).'
                    }
                },
                {
                    sel: '#frCountySelect',
                    title: { ro: 'Filtru județ', en: 'County filter' },
                    desc: {
                        ro: 'Restrânge rezultatele căutării la un singur județ.',
                        en: 'Narrow the search results to a single county.'
                    }
                },
                {
                    sel: '#friendsManagerPanel .fr-tab[data-tab="friends"]',
                    title: { ro: 'Prietenii tăi', en: 'Your friends' },
                    desc: {
                        ro: 'Lista prietenilor tăi, cu butonul de chat pentru fiecare. Căutarea de detectoriști are acum propriul ei tab, „Caută prieteni”.',
                        en: 'Your friend list, with a chat button for each. Searching for detectorists now has its own tab, “Search friends”.'
                    }
                },
                {
                    sel: '#friendsManagerPanel .fr-tab[data-tab="requests"]',
                    title: { ro: 'Cereri', en: 'Requests' },
                    desc: {
                        ro: 'Aici accepți sau refuzi cererile primite și vezi cererile trimise de tine.',
                        en: 'Accept or decline incoming requests here, and see the ones you sent.'
                    }
                },
                {
                    sel: '#friendsManagerPanel .fr-tab[data-tab="chats"]',
                    title: { ro: 'Chat-uri', en: 'Chats' },
                    desc: {
                        ro: 'Discuții private cu prietenii și grupuri. Din cartonașul unui detectorist de pe hartă ajungi direct la chat cu „💬 Trimite mesaj”.',
                        en: 'Private chats with friends and groups. From a detectorist’s map card you jump straight to chat with “💬 Send message”.'
                    }
                }
            ]
        },
        {
            id: 'layers',
            title: { ro: 'Panoul cu straturi', en: 'The layers panel' },
            type: 'targets',
            placement: 'left',
            openPanel: true,
            targets: [
                {
                    sel: ['#transpPanel .transp-layer-row.active .apm-toggle-switch', '#transpPanel .apm-toggle-switch'],
                    title: { ro: 'Switch ON / OFF', en: 'ON / OFF switch' },
                    desc: {
                        ro: 'Pornește sau oprește afișarea stratului pe hartă.',
                        en: 'Turn the layer on or off on the map.'
                    }
                },
                {
                    sel: ['#apmOpacitySlider', '#transpPanel .transp-slider'],
                    title: { ro: 'Slider de opacitate', en: 'Opacity slider' },
                    desc: {
                        ro: 'Reglează transparența stratului, de la 0% la 100%, ca să vezi și ce e dedesubt.',
                        en: 'Adjust the layer transparency from 0% to 100% so you can see what lies beneath.'
                    }
                }
            ],
            notes: [
                {
                    ico: '↕',
                    text: {
                        ro: '<b>Slidere pe hartă:</b> atinge intenționat cardul unui strat ca să-i afișezi comenzile verticale; stratul se poate activa automat. Poți păstra două seturi de comenzi pentru comparație. În PWA, derularea listei sau atingerea sliderului din panou nu adaugă o comandă nouă. ✕ închide comanda și oprește stratul asociat (cu excepția bazei satelit permanente).',
                        en: '<b>On-map sliders:</b> deliberately tap a layer card to show its vertical controls; this may switch the layer on automatically. Keep two sets of controls for comparison. In the PWA, scrolling the list or touching its panel slider does not add a new control. ✕ closes the control and switches its layer off (except the permanent satellite base).'
                    }
                },
                {
                    ico: '<span class="dl-tut-swatch"></span>',
                    text: {
                        ro: '<b>Încadrare verde:</b> fiecare strat care are acoperire pe ecran în acel moment este încadrat cu verde neon — așa știi imediat ce straturi îți sunt utile în zona vizibilă.',
                        en: '<b>Green frame:</b> every layer that has coverage on the current screen is framed in neon green — so you instantly know which layers are useful for the visible area.'
                    }
                }
            ]
        },
        {
            id: 'catalog',
            title: { ro: 'Straturile disponibile', en: 'Available layers' },
            type: 'catalog'
        },
        {
            id: 'view3d',
            title: { ro: "Explorarea în 3D", en: "Exploring in 3D" },
            type: 'guide',
            sections: [
                {
                    title: { ro: "Intrare și ieșire", en: "Enter and leave" },
                    desc: {
                        ro: "Alege țara și zona în 2D, activează straturile dorite, apoi apasă 3D. Pe desktop, butonul este jos, în centru; în PWA, în 2D se află deasupra butonului hărții de bază, în stânga-jos. Când ești în 3D, butonul 2D revine jos, în centru. Apasă-l pentru a reveni la harta normală.",
                        en: "Choose your country and area in 2D, turn on the layers you need, then press 3D. On desktop the button is at the bottom-centre; in the PWA, while in 2D, it sits above the base-map button at the bottom-left. In 3D the 2D button moves to the bottom-centre. Press it to return to the normal map."
                    }
                },
                {
                    title: { ro: "Mișcarea camerei", en: "Move the camera" },
                    desc: {
                        ro: "Pe desktop: trage pentru deplasare, folosește rotița pentru zoom și trage cu butonul drept sau Ctrl/⌘ pentru rotire și înclinare. Shift + săgeți rotește din tastatură. Pe telefon: un deget deplasează, două degete măresc sau rotesc; trage vertical cu două degete pentru înclinare. Nu există slidere de unghi sau exagerare a reliefului.",
                        en: "On desktop: drag to pan, use the wheel to zoom, and right-drag or Ctrl/⌘+drag to rotate and tilt. Shift + arrow keys rotates from the keyboard. On a phone: one finger pans, two fingers pinch or twist to zoom or rotate; drag vertically with two fingers to tilt. There are no camera-angle or terrain-exaggeration sliders."
                    }
                },
                {
                    title: { ro: "Bază, resetare și reîncărcare", en: "Base map, reset and refresh" },
                    desc: {
                        ro: "Schimbă baza între Imagery, Topographic și Terrain din selectorul ArcGIS. „Resetează” reia poziția și orientarea hărții 2D. ↻ pregătește tile-urile raster active non-LiDAR pe o rază de 1 km în jurul centrului 3D; nu descarcă întreaga țară și nu înlocuiește pregătirea LiDAR.",
                        en: "Switch between Imagery, Topographic and Terrain in the ArcGIS picker. Reset returns to the 2D camera position and orientation. ↻ prepares active non-LiDAR raster tiles within 1 km of the current 3D centre; it does not download the entire country or replace LiDAR preparation."
                    }
                },
                {
                    title: { ro: "Ce reprezintă relieful", en: "What the terrain represents" },
                    desc: {
                        ro: "Straturile compatibile se suprapun pe relieful DEM. O imagine LiDAR umbrită nu transformă automat terenul 3D într-un model de înălțime de aceeași rezoluție. Acoperirea și detaliul depind de sursă; folosește legenda și verifică în 2D când ai dubii.",
                        en: "Compatible layers are draped over DEM terrain. A shaded LiDAR image does not automatically make the 3D terrain an elevation model of the same resolution. Coverage and detail depend on the source; check the legend and compare in 2D when in doubt."
                    }
                },
            ]
        },
        {
            id: 'lidar3d',
            title: { ro: "LiDAR: 3D și setări", en: "LiDAR: 3D and settings" },
            type: 'guide',
            sections: [
                {
                    title: { ro: "Straturi întregi sau doar 1 km", en: "Whole layers or only 1 km" },
                    desc: {
                        ro: "Cu LiDAR activ, intrarea în 3D deschide alegerea straturilor. „Straturi întregi” încarcă la cerere, pe măsură ce explorezi. „Doar 1 km” pregătește un disc cu raza de 1 km: alege straturile, punctul și așteaptă progresul înainte de intrare. Cercul marchează limita pregătită, nu o lipsă de date.",
                        en: "With LiDAR active, entering 3D opens a layer-selection dialog. Whole layers loads on demand as you explore. Only 1 km prepares a disc with a 1 km radius: select layers, pick the point and wait for preparation before entering. The circle marks the prepared boundary, not missing data."
                    }
                },
                {
                    title: { ro: "Setări de imagine", en: "Image settings" },
                    desc: {
                        ro: "Activează substratul LiDAR și deschide Setări. Alege și pregătește o zonă cu raza de 1 km, apoi compară efectele fotografice și ajustează expunerea, umbrele, contrastul sau claritatea. Zona din afara cercului rămâne neschimbată. Efectele folosesc imagini: nu sunt măsurători de înălțime și nici dovezi arheologice.",
                        en: "Enable the LiDAR sublayer and open Settings. Choose and prefetch a 1 km radius area, then compare photographic looks and adjust exposure, shadows, contrast or sharpness. Outside the circle the original stays unchanged. These effects process imagery: they are not height measurements or archaeological evidence."
                    }
                },
                {
                    title: { ro: "Trecerea între 2D și 3D", en: "Moving between 2D and 3D" },
                    desc: {
                        ro: "Poți folosi zona efectului ca punct de pornire pentru alegerea LiDAR în 3D sau alege alta. 3D își încarcă propriile date; efectul 2D nu devine teren numeric. La ieșirea din 3D, efectele și ajustările LiDAR se resetează. Filtrele RVT reale și profilul de teren necesită un DTM numeric compatibil, nu doar imaginea afișată.",
                        en: "Use the image-effect area as a starting point for the 3D LiDAR selection, or choose another. 3D loads its own data; the 2D effect does not become numeric terrain. Leaving 3D resets LiDAR effects and adjustments. True RVT filters and a ground profile require a compatible numeric DTM, not just the displayed image."
                    }
                },
            ]
        },
        {
            id: 'analysis',
            title: { ro: "Analiză pe hartă", en: "Map analysis" },
            type: 'guide',
            sections: [
                {
                    title: { ro: "Punct, rază, apoi acțiune", en: "Point, radius, then action" },
                    desc: {
                        ro: "Pentru instrumentele cu rază, alege punctul pe hartă și reglează distanța din panou sau din comanda verticală. Folosește acțiunea instrumentului selectat: Scanare, Detectare sau Generează raport. Comenzile apar lângă slidere și, în 3D, deasupra comenzilor camerei; modificarea razei nu înseamnă că ai rulat din nou analiza.",
                        en: "For radius-based tools, choose a map point and adjust the distance in the panel or vertical control. Use the selected tool’s action: Scan, Detect or Generate report. Actions sit beside the sliders and, in 3D, above the camera controls; changing the radius does not mean you have rerun the analysis."
                    }
                },
                {
                    title: { ro: "Potențial arheologic și rapoarte", en: "Archaeological potential and reports" },
                    desc: {
                        ro: "Stratul „Zone cu potențial arheologic” analizează distribuția siturilor cunoscute din jurul pinului mov (sau al centrului hărții dacă nu ai pin). Atinge un rezultat pentru scor și detalii. Nu este același model cu APM Next-Gen. Rapoartele și datele istorice trebuie citite împreună cu sursele și limitele lor.",
                        en: "The Archaeological potential areas layer analyses known-site distribution around the purple pin (or the map centre if there is no pin). Tap a result for its score and details. This is not the same model as APM Next-Gen. Read reports and historical information together with their sources and limitations."
                    }
                },
                {
                    title: { ro: "Verifică înainte de teren", en: "Check before fieldwork" },
                    desc: {
                        ro: "Scorurile, contururile și rapoartele sunt indicii pentru cercetare, nu confirmări ale unor descoperiri. Un loc fără marker nu este automat liber de patrimoniu. Respectă zonele protejate, autorizațiile și regulile locale; harta nu acordă drept de detecție sau săpătură.",
                        en: "Scores, outlines and reports are research leads, not confirmed discoveries. A place without a marker is not automatically free of heritage restrictions. Respect protected areas, permissions and local rules; the map grants no right to detect or excavate."
                    }
                },
            ]
        },
        {
            id: 'apmmanual',
            title: { ro: "APM Next-Gen: MANUAL", en: "APM Next-Gen: MANUAL" },
            type: 'guide',
            sections: [
                {
                    title: { ro: "Unde îl găsești", en: "Where to find it" },
                    desc: {
                        ro: "În lista de straturi → Premium, pornește APM Next-Gen și deschide panoul lui, pe desktop sau în PWA. Este o funcție Premium separată de APM și APM 2.0. Alege MANUAL, apasă „Alege punct pe hartă”, apoi atinge centrul zonei studiate.",
                        en: "In the layer list → Premium, enable APM Next-Gen and open its panel, on desktop or in the PWA. It is a Premium feature separate from APM and APM 2.0. Choose MANUAL, press Pick point on map, then tap the centre of your study area."
                    }
                },
                {
                    title: { ro: "Rază și factori", en: "Radius and factors" },
                    desc: {
                        ro: "Alege o rază de 1–10 km (implicit 5 km). Reglează ponderile pentru relief și distanța față de apă; proxy-ul de sol are implicit pondere 0 și nu este o hartă de sol măsurată. În Avansat poți ajusta pragurile, aria minimă și curbele. Rulează modelul după modificări și urmărește mesajele de progres sau lipsă de date.",
                        en: "Choose a radius of 1–10 km (default 5 km). Adjust terrain and water-distance weights; the soil proxy defaults to weight 0 and is not a measured soil map. Advanced settings include thresholds, minimum area and editable curves. Run the model after changes and watch progress or missing-data messages."
                    }
                },
                {
                    title: { ro: "Citește rezultatul corect", en: "Read the result correctly" },
                    desc: {
                        ro: "Harta termică arată scorul continuu, de la bleumarin spre roșu. Doar clasa cu potențial foarte ridicat primește contururi; este normal să nu apară niciun contur. Legenda arată pragurile rulării. Scorurile sunt potențial relativ, nu probabilități calibrate de descoperire.",
                        en: "The heatmap shows a continuous score from navy to red. Only the very-high-potential class receives outlines; a run may legitimately have none. The legend shows the run’s thresholds. Scores indicate relative potential, not calibrated discovery probabilities."
                    }
                },
                {
                    title: { ro: "Export și curățare", en: "Export and clear" },
                    desc: {
                        ro: "Exportă contururile GeoJSON pentru zonele cu potențial foarte ridicat; exportul nu conține imaginea hărții termice sau rasterul complet. Folosește „Șterge rezultatul” ori oprește APM Next-Gen pentru a elimina rezultatul. Poți anula o rulare în curs.",
                        en: "Export hotspot GeoJSON saves very-high-potential outlines, not the heatmap image or full raster. Use Clear result or switch APM Next-Gen off to remove the result. You can cancel a running analysis."
                    }
                },
            ]
        },
        {
            id: 'apmtrain',
            title: { ro: "APM Next-Gen: TRAIN", en: "APM Next-Gen: TRAIN" },
            type: 'guide',
            sections: [
                {
                    title: { ro: "Învață din situri cunoscute", en: "Learn from known sites" },
                    desc: {
                        ro: "Alege punctul, apoi TRAIN: zona de antrenare are raza fixă de 50 km. Sursa integrată este repertoriul României, cu poziții exacte; în afara României încarcă explicit un CSV compatibil. Dacă sursa nu răspunde, reîncearcă sau folosește CSV — nu se schimbă automat cu altă sursă.",
                        en: "Pick a point, then TRAIN: training uses a fixed 50 km radius. The built-in source is the Romanian repertory with exact-position records; outside Romania, explicitly upload a compatible CSV. If the source fails, retry or use CSV — it is not silently replaced by another source."
                    }
                },
                {
                    title: { ro: "Perioadă și calitatea datelor", en: "Period and data quality" },
                    desc: {
                        ro: "Implicit sunt folosite toate perioadele; poți restrânge la o perioadă locală. Verifică numărul de situri utilizabile, excluderile și avertismentele înainte de antrenare. Perioadele deduse din denumiri și regulile de excludere a siturilor care nu sunt așezări sunt aproximative, nu clasificări arheologice verificate.",
                        en: "All periods is the default; optionally narrow to a local period. Check usable-site counts, exclusions and warnings before training. Periods inferred from names and rules excluding non-settlements are approximate, not verified archaeological classifications."
                    }
                },
                {
                    title: { ro: "Validare și situri atipice", en: "Validation and unusual sites" },
                    desc: {
                        ro: "TRAIN învață curbele din situri, deci nu le editezi ca în MANUAL. Compară diagnosticele AUC/Kvamme robust și simplu, nu doar culorile. Markerii gri arată situri cu pondere redusă; citește motivul și restaurează un sit sau toate siturile pentru reantrenare din datele păstrate. Un sit atipic nu înseamnă un sit greșit.",
                        en: "TRAIN learns curves from sites rather than letting you edit them as in MANUAL. Compare robust and plain AUC/Kvamme diagnostics, not just the colours. Grey markers identify down-weighted sites; read the reason and restore one or all to refit from cached samples. An unusual site is not necessarily an incorrect site."
                    }
                },
                {
                    title: { ro: "Limite și export", en: "Limits and export" },
                    desc: {
                        ro: "Rezultatul folosește aceeași hartă termică și aceleași contururi de potențial foarte ridicat ca MANUAL. Exportul GeoJSON păstrează contururile și proveniența. Datele puține, perioadele incerte și acoperirea incompletă pot limita analiza; niciun scor nu înlocuiește verificarea arheologică sau regulile de protecție.",
                        en: "Results use the same heatmap and very-high-potential outlines as MANUAL. GeoJSON exports preserve outlines and provenance. Sparse data, uncertain periods and incomplete coverage can limit analysis; no score replaces archaeological verification or protection rules."
                    }
                },
            ]
        },
        {
            id: 'historical',
            title: { ro: "Truc: aliniază hărțile istorice", en: "Tip: align historical maps" },
            type: 'guide',
            sections: [
                {
                    title: { ro: "Ține apăsat pe harta 2D", en: "Long-press the 2D map" },
                    desc: {
                        ro: "Activează o hartă istorică, apoi ține apăsat aproximativ o jumătate de secundă într-un loc liber al hărții 2D, nu pe butoane, markere sau panouri. Merge cu mouse-ul și cu degetul, inclusiv când sliderul stratului este deja pe ecran. Se deschide „Mută harta istorică”.",
                        en: "Enable a historical map, then hold for about half a second on an empty part of the 2D map, not on buttons, markers or panels. This works with mouse or touch, even with the layer’s slider already on screen. Move historical map opens."
                    }
                },
                {
                    title: { ro: "Alege stratul și deblochează", en: "Choose the layer and unlock" },
                    desc: {
                        ro: "Dacă ai mai multe hărți istorice active, selectează harta dorită din listă. Pornește comutatorul și trage pentru a muta doar suprapunerea, fără baza de dedesubt. Poți corecta deplasarea cu până la 3 km în orice direcție; folosește opacitatea pentru a potrivi drumuri, râuri sau alte repere stabile.",
                        en: "If several historical maps are active, choose the one you want from the list. Turn the switch on and drag to move only the overlay, not the base map. Shift it by up to 3 km in any direction; use opacity to align roads, rivers or other stable landmarks."
                    }
                },
                {
                    title: { ro: "Blochează, păstrează, resetează", en: "Lock, keep, reset" },
                    desc: {
                        ro: "Oprește comutatorul sau închide panoul cu ✕ ca să blochezi poziția și să deplasezi din nou harta de bază. Poziția se păstrează local pentru fiecare strat, inclusiv după zoom și redeschidere. „Resetează poziția” anulează corecția. Funcționează cu hărți gratuite, Premium și imaginile CORONA disponibile.",
                        en: "Switch off or close the panel with ✕ to lock the position and pan the base map again. The offset is saved locally per layer, surviving zoom and reopening. Reset position removes the correction. This works with available free and Premium historical maps and CORONA imagery."
                    }
                },
                {
                    title: { ro: "„Alte hărți” este un flux separat", en: "Other maps is a separate workflow" },
                    desc: {
                        ro: "În Premium → Hărți istorice → Alte hărți, punctele verzi deschid scanările disponibile. Adaugă o foaie și folosește comenzile ei pentru mutare, rotire și scară. Aceste scanări nu sunt deja georeferențiate: potrivirea manuală este orientativă și nu repară deformările hârtiei.",
                        en: "In Premium → Historical maps → Other maps, green points open available scans. Add a sheet and use its own move, rotation and scale controls. These scans are not already georeferenced: manual alignment is approximate and does not correct paper distortion."
                    }
                },
            ]
        },
        {
            id: 'tricks',
            title: { ro: "Alte scurtături utile", en: "More useful shortcuts" },
            type: 'guide',
            sections: [
                {
                    title: { ro: "Caută un loc sau coordonate", en: "Search a place or coordinates" },
                    desc: {
                        ro: "Folosește căutarea pentru localități sau coordonate; înainte de o analiză verifică țara și punctul ales. Căutarea unei destinații din 3D revine în 2D pentru a o afișa. Butonul Coordonate îți permite să copiezi un punct, să-l salvezi sau să creezi un eveniment.",
                        en: "Use search for places or coordinates; check the selected country and point before analysis. Searching for a destination in 3D returns to 2D to show it. Coordinates lets you copy a point, save it or create an event."
                    }
                },
                {
                    title: { ro: "Compară straturi și perioade", en: "Compare layers and periods" },
                    desc: {
                        ro: "Păstrează două comenzi verticale pe hartă pentru a compara opacități, raze sau perioade fără să redeschizi panoul. Butonul ✕ închide comanda și oprește doar stratul asociat, fără să-l afecteze pe celălalt (baza satelit rămâne activă). Pentru satelit, bătălii și Amprenta Vegetației, verifică și perioada selectată, nu doar transparența.",
                        en: "Keep two vertical controls on the map to compare opacity, radius or periods without reopening the panel. A control’s ✕ closes it and switches off only its associated layer, leaving the other control alone (the satellite base stays on). For satellite, battles and Vegetation Fingerprint, check the selected time period as well as transparency."
                    }
                },
                {
                    title: { ro: "Acoperire și ferestre", en: "Coverage and windows" },
                    desc: {
                        ro: "Alege țara înainte să cauți straturi locale și urmărește cadrul verde de acoperire. Extinde grupurile pentru substraturi și folosește ⓘ pentru surse. Unde este disponibil, minimizează o fereastră și redeschide-o din sertarul de ferestre, în loc să pierzi zona studiată sub panouri.",
                        en: "Choose the country before looking for local layers and watch the green coverage frame. Expand groups for sublayers and use ⓘ for sources. Where available, minimise a window and reopen it from the window drawer instead of covering your study area with panels."
                    }
                },
                {
                    title: { ro: "Pregătește terenul fără internet", en: "Prepare for fieldwork offline" },
                    desc: {
                        ro: "Descarcă zona offline cât ai internet (maximum 100 km²) și verifică straturile salvate înainte de plecare. Le găsești în Stocare → Hărți offline; expiră după 10 zile. Descărcarea tile-urilor nu face automat disponibile offline analizele APM, antrenarea, chat-ul sau toate sursele externe.",
                        en: "Download your offline area while online (up to 100 km²) and check saved layers before leaving. Find them in Storage → Offline maps; they expire after 10 days. Downloaded tiles do not automatically make APM analysis, training, chat or every external source work offline."
                    }
                },
            ]
        },
        {
            id: 'performance',
            title: { ro: 'Sfaturi pentru performanță optimă', en: 'Tips for optimal performance' },
            type: 'performance'
        }
    ];

    // ── Layer catalogue ────────────────────────────────
    var CATALOG = {
        free: [
            {
                name: { ro: 'APM Layer', en: 'APM Layer' },
                desc: {
                    ro: "Model orientativ de potențial arheologic bazat pe factori de mediu. Citește legenda și compară cu sursele locale; scorul nu confirmă existența unui sit.",
                    en: "Indicative archaeological potential model based on environmental factors. Read the legend and compare local sources; a score does not confirm a site."
                }
            },
            {
                name: { ro: 'Satelit', en: 'Satellite' },
                desc: {
                    ro: "Bază Imagery ArcGIS; poți alege și Topographic sau Terrain. Unde sunt disponibile, comenzile de istoric permit compararea imaginilor din perioade diferite.",
                    en: "ArcGIS Imagery base; Topographic and Terrain are also available. Where provided, history controls let you compare imagery from different periods."
                }
            },
            {
                name: { ro: 'Localități OSM', en: 'OSM Places' },
                desc: { ro: 'Denumirile localităților.', en: 'The names of the localities.' }
            },
            {
                name: { ro: 'UAT', en: 'UAT' },
                desc: { ro: 'Unități administrativ teritoriale.', en: 'Administrative-territorial units.' }
            },
            {
                name: { ro: 'Patrimoniu', en: 'Heritage' },
                desc: {
                    ro: "Situri arheologice și zone de protecție din sursele disponibile pentru țara selectată. Extinde grupul pentru substraturi și atinge markerii pentru detalii; acoperirea nu este o garanție juridică.",
                    en: "Archaeological sites and protection zones from the sources available for the selected country. Expand the group for sublayers and tap markers for details; coverage is not a legal guarantee."
                }
            },
            {
                name: { ro: 'Hărți istorice', en: 'Historical Maps' },
                desc: {
                    ro: "Hărți și foi istorice gratuite, în funcție de țară și acoperire. Pentru Iosefina gratuită folosește „Caută aici” pentru foaia locală. Pentru aliniere, ține apăsat pe harta 2D și folosește „Mută harta istorică”.",
                    en: "Free historical maps and sheets, depending on country and coverage. For the free Josephine map, use Search here to find a local sheet. To align an overlay, long-press the 2D map and use Move historical map."
                }
            },
            {
                name: { ro: 'LIDAR', en: 'LIDAR' },
                desc: {
                    ro: "Relief umbrit și alte vizualizări LiDAR, cu rezoluții și acoperire diferite pentru fiecare sursă. Extinde substraturile pentru Setări și efecte de imagine; în 3D alege straturi întregi sau un disc cu raza de 1 km.",
                    en: "Hillshade and other LiDAR visualisations, with source-dependent resolution and coverage. Expand sublayers for Settings and image effects; in 3D choose whole layers or a 1 km radius disc."
                }
            },
            {
                name: { ro: 'Hărți offline', en: 'Offline maps' },
                desc: {
                    ro: 'Desenează o zonă de maximum 100 km², alege straturile disponibile și descarcă tile-urile pe dispozitiv. Harta expiră automat după 10 zile; în butonul cu card SD apare categoria Hărți offline.',
                    en: 'Draw an area of up to 100 km², choose the available layers and download their tiles to the device. The map expires automatically after 10 days; the SD-card button contains the Offline maps category.'
                }
            }
        ],
        premium: [
            {
                name: { ro: "APM Next-Gen", en: "APM Next-Gen" },
                desc: {
                    ro: "MANUAL: punct, rază de 1–10 km și ponderi editabile. TRAIN: situri dintr-o rază de 50 km, perioadă și validare. Rezultate ca hartă termică, contururi de potențial foarte ridicat și export GeoJSON; vezi pașii dedicați din ghid.",
                    en: "MANUAL: point, 1–10 km radius and editable weights. TRAIN: sites within 50 km, period selection and validation. Outputs a heatmap, very-high-potential outlines and GeoJSON export; see the dedicated guide steps."
                }
            },
            {
                name: { ro: "Amprenta Vegetației", en: "Vegetation Fingerprint" },
                desc: {
                    ro: "Straturi Copernicus pentru România: PPI, maxim sezonier, înverzire și ofilire. Alege substratul și perioada pentru a compara tipare ale vegetației; acestea nu confirmă structuri îngropate.",
                    en: "Copernicus layers for Romania: PPI, seasonal maximum, green-up and green-down. Choose a sublayer and period to compare vegetation patterns; these do not confirm buried structures."
                }
            },
            {
                name: { ro: "Alte hărți", en: "Other maps" },
                desc: {
                    ro: "În grupul Hărți istorice: punctele verzi deschid foi scanate pe care le poți adăuga, deplasa, roti și redimensiona manual.",
                    en: "Inside Historical maps: green points open scanned sheets you can add, move, rotate and resize manually."
                }
            },
            {
                name: { ro: 'Biblioteca din Babel', en: 'Library of Babel' },
                desc: {
                    ro: "Caută o localitate sau un sit în mai multe surse istorice și de patrimoniu. Consultă proveniența fiecărui rezultat și dezambiguizează localitățile cu același nume.",
                    en: "Search for a locality or site across multiple historical and heritage sources. Check each result’s provenance and disambiguate places with the same name."
                }
            },
            {
                name: { ro: 'APM 2.0', en: 'APM 2.0' },
                desc: {
                    ro: "Strat de potențial arheologic cu legendă proprie. „Ajutor de căutare” conturează zone cu scor ridicat. Este diferit de APM Next-Gen, care are modurile MANUAL și TRAIN.",
                    en: "Archaeological potential layer with its own legend. Search help outlines high-scoring areas. It is distinct from APM Next-Gen, which provides MANUAL and TRAIN modes."
                }
            },
            {
                name: { ro: 'Imperiul roman', en: 'Roman Empire' },
                desc: {
                    ro: "Drumuri și repere romane disponibile în atlas: castre, vile și alte obiective. Verifică detaliile și sursa; traseele istorice sunt orientative, nu drumuri actuale garantate.",
                    en: "Roman roads and landmarks available in the atlas, including forts, villas and other sites. Check details and sources; historical routes are indicative, not guaranteed present-day roads."
                }
            },
            {
                name: { ro: 'Bătălii', en: 'Battles' },
                desc: {
                    ro: 'Conține cele mai importante conflicte militare de pe teritoriul României, începând cu sec. VIII î.Hr. până în prezent (folosește sliderul pentru a schimba secolul).',
                    en: 'Contains the most important military conflicts on Romanian territory, from the 8th century BC to the present day (use the slider to change the century).'
                }
            },
            {
                name: { ro: 'Hărți istorice', en: 'Historical maps' },
                desc: {
                    ro: 'Hărți istorice regionale și naționale, în funcție de țara selectată și acoperirea sursei. Extinde grupul pentru foi și colecții; compară cu baza folosind opacitatea și alinierea manuală.',
                    en: 'Regional and national historical maps, depending on the selected country and source coverage. Expand the group for sheets and collections; compare with the base using opacity and manual alignment.'
                }
            },
            {
                name: { ro: 'Imagini satelitare anii ’60', en: "Satellite imagery 60's" },
                desc: {
                    ro: "Imagini CORONA din anii ’60, unde există acoperire. Compară cu baza actuală prin opacitate; deplasarea poate fi corectată din „Mută harta istorică” în 2D.",
                    en: "1960s CORONA imagery where coverage exists. Compare with the modern base using opacity; correct an offset with Move historical map in 2D."
                }
            },
            {
                name: { ro: 'LIDAR Scanner', en: 'LIDAR Scanner' },
                desc: {
                    ro: "Alege punctul și raza, apoi apasă Scanare pentru rezultatele și adnotările disponibile. Verifică fiecare indiciu în imaginile sursă: o anomalie nu este o descoperire confirmată.",
                    en: "Pick the point and radius, then press Scan for available results and annotations. Check each lead against the source imagery: an anomaly is not a confirmed discovery."
                }
            },
            {
                name: { ro: 'Zone cu potențial arheologic', en: 'Archaeological Potential Sites' }, // reproduces existing UI button spelling (Archeological)
                desc: {
                    ro: 'Se folosește de siturile arheologice existente pentru a triangula și a descoperi zone din proximitatea siturilor cu potențial arheologic (fiecărei zone îi este atribuit un scor).',
                    en: 'Uses the existing archaeological sites to triangulate and discover zones with archaeological potential in their proximity (each zone gets a score).'
                }
            },
            {
                name: { ro: 'Raport arheologic', en: 'Archaeological Report' }, // reproduces existing UI button spelling (Archeological)
                desc: {
                    ro: 'Returnează până la 3 zone cu potențial arheologic, făcând o medie ponderată între rezultatele straturilor APM 2.0, Zone cu potențial arheologic, LIDAR Scanner și Imperiul Roman. Rezultatul final poate fi descărcat ca PDF cu explicații detaliate.',
                    en: 'Returns up to 3 zones with archaeological potential by computing a weighted average of the results from the APM 2.0, Archaeological Potential Sites, LIDAR Scanner and Roman Empire layers. The final result can be downloaded as a PDF with detailed explanations.'
                }
            }
        ]
    };

    var PERF = {
        title: { ro: 'Sfaturi pentru performanță optimă', en: 'Tips for optimal performance' },
        body: {
            ro: 'LiDAR, imaginile istorice și straturile naționale detaliate pot necesita multe descărcări. Activează doar sursele necesare, apropie-te de zona de interes și așteaptă încărcarea înainte de a schimba din nou vederea. În 3D, discul LiDAR de 1 km limitează zona pregătită; straturile întregi continuă să se încarce în timpul explorării.',
            en: 'LiDAR, historical imagery and detailed national layers can require many downloads. Enable only the sources you need, zoom to your study area and let loading finish before changing the view again. In 3D, the 1 km LiDAR disc limits the prepared area; whole layers keep loading as you explore.'
        },
        tip: {
            ro: 'Compară straturile grele <b>pe rând</b>. Dacă încărcarea eșuează, verifică acoperirea, conexiunea și mesajul sursei; încearcă o zonă mai mică. APM Next-Gen și sursele externe au nevoie de internet. Redeschide oricând acest ghid cu <b>?</b>; folosește săgețile sau punctele pentru pași și derulează în interiorul cartonașelor.',
            en: 'Compare heavy layers <b>one at a time</b>. If loading fails, check coverage, connectivity and the source message; try a smaller area. APM Next-Gen and external sources need internet. Reopen this guide anytime with <b>?</b>; use arrows or dots for steps and scroll inside cards.'
        }
    };

    // ── Slide transition timing ──────────────────────────────────
    // The outgoing slide fades/slides out first, then the incoming one
    // fades/slides in from the opposite side — no hard cut between slides.
    var LEAVE_MS = 170;   // must stay in sync with .dl-tut-leaving (css/tutorial.css)
    var PANEL_MAX_WAIT = 420;

    function reduceMotion() {
        try {
            return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        } catch (e) { return false; }
    }

    // ── State ────────────────────────────────────────────────────
    var state = {
        open: false,
        idx: 0,
        tab: 'free',
        openedPanel: false,
        panelTabRestore: null,
        openedFriends: false,
        // Transition bookkeeping:
        seq: 0,            // invalidates pending timeouts when the user moves fast
        quiet: false,      // repaint in place (no entrance animation) — resize etc.
        panelOpening: false,
        friendsOpening: false,
        suppressTap: false // a swipe just navigated — ignore the tap that follows
    };

    var root = null, scrim = null, svg = null, stage = null,
        bar = null, dots = null, titleEl = null,
        btnPrev = null, btnNext = null;

    // ── Small DOM helpers ────────────────────────────────────────
    function el(tag, cls, parent) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (parent) parent.appendChild(n);
        return n;
    }

    function svgEl(tag, parent) {
        var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
        if (parent) parent.appendChild(n);
        return n;
    }

    function pick(sel) {
        var list = Array.isArray(sel) ? sel : [sel];
        for (var i = 0; i < list.length; i++) {
            var n;
            try { n = document.querySelector(list[i]); } catch (e) { n = null; }
            if (n && isVisible(n)) return n;
        }
        return null;
    }

    function isVisible(n) {
        if (!n) return false;
        var r = n.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        var st = window.getComputedStyle(n);
        if (st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) < 0.05) return false;
        if (n.closest && n.closest('.auth-hidden')) return false;
        return true;
    }

    function vw() { return window.innerWidth || document.documentElement.clientWidth; }
    function vh() { return window.innerHeight || document.documentElement.clientHeight; }

    function isPwa() {
        return !!(document.body && document.body.classList.contains('is-pwa'));
    }

    var TUTORIAL_VIDEO_URL = 'https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/Harti/TUTORIAL.MOV';

    function stopTutorialVideo() {
        var v = document.getElementById('dlTutVideo');
        if (!v) return;
        try { v.pause(); } catch (e) { /* ignore */ }
    }

    // ── Overlay construction ─────────────────────────────────────
    function build() {
        if (root) return;

        root = el('div', 'dl-tut');
        root.id = 'dlTutorial';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');

        scrim = el('div', 'dl-tut-scrim', root);

        svg = svgEl('svg', root);
        svg.setAttribute('class', 'dl-tut-arrows');
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

        stage = el('div', 'dl-tut-stage', root);
        stage.style.cssText = 'position:absolute;inset:0;pointer-events:none;';

        bar = el('div', 'dl-tut-bar', root);

        btnPrev = el('button', 'dl-tut-nav-btn', bar);
        btnPrev.type = 'button';
        btnPrev.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 5 8 12 15 19"/></svg>';
        btnPrev.addEventListener('click', function (e) { e.stopPropagation(); go(state.idx - 1); });

        dots = el('div', 'dl-tut-dots', bar);

        btnNext = el('button', 'dl-tut-nav-btn', bar);
        btnNext.type = 'button';
        btnNext.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 5 16 12 9 19"/></svg>';
        btnNext.addEventListener('click', function (e) { e.stopPropagation(); go(state.idx + 1); });

        el('div', 'dl-tut-sep', bar);

        var btnClose = el('button', 'dl-tut-nav-btn dl-tut-close', bar);
        btnClose.type = 'button';
        btnClose.innerHTML = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
        btnClose.addEventListener('click', function (e) { e.stopPropagation(); close(); });

        titleEl = el('div', 'dl-tut-title', root);

        STEPS.forEach(function (s, i) {
            var d = el('button', 'dl-tut-dot', dots);
            d.type = 'button';
            d.addEventListener('click', function (e) { e.stopPropagation(); go(i); });
        });

        initSwipe();

        // Advance when tapping the empty (blurred) area.
        scrim.addEventListener('click', function (e) {
            e.stopPropagation();
            if (state.suppressTap) return;   // the gesture already moved us
            go(state.idx + 1);
        });

        // Never let a click inside the guide reach the page underneath
        // (the layers panel closes itself on any outside click).
        root.addEventListener('click', function (e) { e.stopPropagation(); }, false);
        root.addEventListener('mousedown', function (e) { e.stopPropagation(); }, false);
        root.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });

        document.body.appendChild(root);

        window.addEventListener('resize', onResize);
        window.addEventListener('orientationchange', onResize);
        window.addEventListener('scroll', onResize, { passive: true });
        document.addEventListener('detectlab:langchange', function () {
            if (!state.open) return;
            state.quiet = false;
            render(0);
        });
        document.addEventListener('keydown', function (e) {
            if (!state.open) return;
            if (e.key === 'Escape') { close(); }
            else if (e.key === 'ArrowRight') { go(state.idx + 1); }
            else if (e.key === 'ArrowLeft') { go(state.idx - 1); }
        });
    }

    /* ── Swipe / drag between slides ──────────────────────────────
       Dragging the blurred area follows the finger and either snaps back or
       continues into a normal slide transition, so moving between slides
       never feels like a hard cut. */
    var SWIPE_MIN = 56;

    function initSwipe() {
        var sx = 0, sy = 0, dx = 0, active = false, decided = false;

        function paintDrag(px) {
            var k = 0.42;                       // rubber-band factor
            var op = String(Math.max(0.3, 1 - Math.abs(px) / 460));
            [stage, svg].forEach(function (n) {
                n.style.transition = 'none';
                n.style.transform = 'translateX(' + (px * k) + 'px)';
                n.style.opacity = op;
            });
        }

        function releaseDrag() {
            [stage, svg].forEach(function (n) {
                n.style.transition = '';
                n.style.transform = '';
                n.style.opacity = '';
            });
        }

        function reset() {
            if (!active) return;
            active = false;
            dx = 0;
            releaseDrag();
        }

        scrim.addEventListener('touchstart', function (e) {
            if (!state.open || !e.touches || e.touches.length !== 1) return;
            sx = e.touches[0].clientX;
            sy = e.touches[0].clientY;
            dx = 0;
            active = true;
            decided = false;
        }, { passive: true });

        scrim.addEventListener('touchmove', function (e) {
            if (!active || !e.touches || e.touches.length !== 1) return;
            var mx = e.touches[0].clientX - sx;
            var my = e.touches[0].clientY - sy;
            if (!decided) {
                if (Math.abs(mx) < 12 && Math.abs(my) < 12) return;
                if (Math.abs(my) > Math.abs(mx)) { active = false; return; }  // vertical scroll
                decided = true;
            }
            dx = mx;
            paintDrag(mx);
        }, { passive: true });

        scrim.addEventListener('touchend', function () {
            if (!active) return;
            var moved = dx;
            active = false;
            dx = 0;
            if (decided && Math.abs(moved) > SWIPE_MIN) {
                state.suppressTap = true;
                var dir = moved < 0 ? 1 : -1;    // swipe left → next slide
                releaseDrag();                   // hand the position back to CSS
                go(state.idx + dir);
                setTimeout(function () { state.suppressTap = false; }, 380);
            } else {
                reset();
            }
        }, { passive: true });

        scrim.addEventListener('touchcancel', reset, { passive: true });
    }

    var resizeTimer = null;
    function onResize() {
        if (!state.open || root.classList.contains('dl-tut-closing')) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            // Quiet repaint: the slide is already on screen, re-running the
            // entrance animation on every resize frame would only flicker.
            state.quiet = true;
            render(0);
        }, 120);
    }

    // ── Layers panel handling ──────────────────────────
    function panelIsOpen() {
        var p = document.getElementById('transpPanel');
        return !!(p && p.classList.contains('open'));
    }

    function ensurePanel(open) {
        var p = document.getElementById('transpPanel');
        if (!p) return;
        if (open && !panelIsOpen()) {
            if (typeof window.toggleTranspPanel === 'function') {
                window.toggleTranspPanel();
                state.openedPanel = true;
                state.panelOpening = true;
            }
            // The guide always demonstrates on the free tab (APM Layer row).
            var freeTab = document.querySelector('.transp-panel-tabs .tab-btn.active');
            state.panelTabRestore = freeTab ? freeTab.getAttribute('data-tab') : null;
            if (state.panelTabRestore && state.panelTabRestore !== 'free' &&
                typeof window.switchLayerTab === 'function') {
                window.switchLayerTab('free');
            }
        } else if (!open && state.openedPanel) {
            if (typeof window.toggleTranspPanel === 'function') window.toggleTranspPanel();
            state.openedPanel = false;
            state.panelOpening = false;
            if (state.panelTabRestore && state.panelTabRestore !== 'free' &&
                typeof window.switchLayerTab === 'function') {
                window.switchLayerTab(state.panelTabRestore);
            }
            state.panelTabRestore = null;
        }
    }

    /* The layers panel slides in with its own 0.35s transition — measuring
       the controls before it lands produces rings that sit in the wrong
       place and then jump. Wait for the panel to settle (with a hard cap so
       the guide can never get stuck on an invisible slide). */
    function whenPanelSettled(cb) {
        var p = document.getElementById('transpPanel');
        var fired = false, timer = null;

        function fire() {
            if (fired) return;
            fired = true;
            state.panelOpening = false;
            if (timer) clearTimeout(timer);
            if (p) p.removeEventListener('transitionend', onEnd);
            try { cb(); } catch (e) { /* keep the guide usable no matter what */ }
        }

        function onEnd(e) {
            if (!p || e.target !== p) return;
            var prop = e.propertyName || '';
            if (prop && prop.indexOf('transform') === -1) return;
            fire();
        }

        if (p) p.addEventListener('transitionend', onEnd);
        timer = setTimeout(fire, PANEL_MAX_WAIT);
    }

    // ── Friends panel handling (slide 3) ─────────────────────────
    function signedIn() {
        try {
            var u = (typeof window._authUser === 'function') ? window._authUser() : null;
            return !!(u && u.id);
        } catch (e) { return false; }
    }

    function friendsPanelIsOpen() {
        return !!document.getElementById('friendsManagerPanel');
    }

    /* Mirrors ensurePanel(): the guide demonstrates on the friends search tab
       (the search bar the first arrow points at lives there since the panel
       split „Caută prieteni” / „Prietenii tăi”), and only ever closes a panel
       it opened itself. Signed-out visitors never get openFriends() called on
       them — that would pop the auth modal over the guide; they see the
       step's authNote instead. */
    function ensureFriends(open) {
        if (open && !friendsPanelIsOpen()) {
            if (!signedIn()) return;
            if (typeof window.openFriends === 'function') {
                window.openFriends('search');
                state.openedFriends = true;
                state.friendsOpening = true;
            }
        } else if (open && friendsPanelIsOpen()) {
            try {
                var tab = document.querySelector('#friendsManagerPanel .fr-tab[data-tab="search"]');
                if (tab && typeof tab.click === 'function') tab.click();
            } catch (e) { /* keep the guide usable no matter what */ }
        } else if (!open && state.openedFriends) {
            if (typeof window._closeFriendsPanel === 'function') window._closeFriendsPanel();
            state.openedFriends = false;
            state.friendsOpening = false;
        }
    }

    /* openFriends() renders after its async refreshAll() lands, so — unlike
       the layers panel — there is no transition to wait for: poll for the
       search input instead, with a hard cap so the guide can never get stuck
       on an invisible slide. */
    var FRIENDS_MAX_WAIT = 6000;
    function whenFriendsReady(cb) {
        var waited = 0, fired = false, timer = null;

        function fire() {
            if (fired) return;
            fired = true;
            state.friendsOpening = false;
            if (timer) clearInterval(timer);
            try { cb(); } catch (e) { /* keep the guide usable no matter what */ }
        }

        timer = setInterval(function () {
            if (!state.open) { fire(); return; }
            var input = null;
            try { input = document.querySelector('#frSearchInput'); } catch (e) { input = null; }
            if (input && isVisible(input)) { fire(); return; }
            waited += 120;
            if (waited >= FRIENDS_MAX_WAIT) fire();
        }, 120);
    }

    // ── Geometry helpers ─────────────────────────────────────────
    function roundRectPath(x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        return 'M' + (x + r) + ',' + y +
            'h' + (w - 2 * r) +
            'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r +
            'v' + (h - 2 * r) +
            'a' + r + ',' + r + ' 0 0 1 ' + (-r) + ',' + r +
            'h' + (-(w - 2 * r)) +
            'a' + r + ',' + r + ' 0 0 1 ' + (-r) + ',' + (-r) +
            'v' + (-(h - 2 * r)) +
            'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + (-r) + 'z';
    }

    /* Punch the highlighted controls out of the blurred scrim so they
       stay perfectly sharp while everything else is blurred. */
    function applyScrimHoles(rects) {
        if (!scrim) return;
        if (!rects.length) { root.classList.remove('dl-tut-morph'); resetScrim(); return; }

        // Two clip paths can only be interpolated when they list the same
        // number of shapes — only then is the morph worth its repaint cost.
        var prev = scrim.getAttribute('data-holes');
        root.classList.toggle('dl-tut-morph', prev !== null && prev === String(rects.length));
        scrim.setAttribute('data-holes', String(rects.length));

        var d = 'M0,0H' + vw() + 'V' + vh() + 'H0Z';
        rects.forEach(function (r) {
            d += roundRectPath(r.x, r.y, r.w, r.h, 10);
        });
        var val = 'path(evenodd, "' + d + '")';
        scrim.style.clipPath = val;
        scrim.style.webkitClipPath = val;
    }

    /* Sequential packing of boxes inside [minY, maxY]. */
    function packVertical(items, minY, maxY, gap) {
        items.sort(function (a, b) { return a.pref - b.pref; });
        var y = minY;
        items.forEach(function (it) {
            it.y = Math.max(it.pref, y);
            y = it.y + it.h + gap;
        });
        if (y - gap > maxY) {
            var yy = maxY;
            for (var i = items.length - 1; i >= 0; i--) {
                items[i].y = Math.min(items[i].y, yy - items[i].h);
                yy = items[i].y - gap;
            }
            var yy2 = minY;
            for (var j = 0; j < items.length; j++) {
                if (items[j].y < yy2) items[j].y = yy2;
                yy2 = items[j].y + items[j].h + gap;
            }
        }
    }

    /* Point on the border of `box` in the direction of (tx, ty). */
    function edgePoint(box, tx, ty) {
        var cx = box.x + box.w / 2, cy = box.y + box.h / 2;
        var dx = tx - cx, dy = ty - cy;
        if (!dx && !dy) return { x: cx, y: cy };
        var sx = dx !== 0 ? (box.w / 2) / Math.abs(dx) : Infinity;
        var sy = dy !== 0 ? (box.h / 2) / Math.abs(dy) : Infinity;
        var s = Math.min(sx, sy);
        return { x: cx + dx * s, y: cy + dy * s };
    }

    function drawArrow(start, target, delay) {
        var end = edgePoint(target, start.x, start.y);
        // stop a few px before the ring
        var vx = end.x - start.x, vy = end.y - start.y;
        var len = Math.sqrt(vx * vx + vy * vy) || 1;
        end = { x: end.x - (vx / len) * 9, y: end.y - (vy / len) * 9 };

        // gentle curve, perpendicular offset proportional to length
        var mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
        var off = Math.min(26, len * 0.18);
        var ctrl = { x: mx - (vy / len) * off, y: my + (vx / len) * off };

        var path = svgEl('path', svg);
        path.setAttribute('class', 'dl-tut-arrow-path');
        path.setAttribute('d', 'M' + start.x + ',' + start.y + ' Q' + ctrl.x + ',' + ctrl.y + ' ' + end.x + ',' + end.y);

        // Draw the line at a constant speed: the dash pattern must match the
        // real length of the curve, otherwise short arrows stay invisible for
        // most of the animation and then snap on in the last few frames.
        var drawMs = 300;
        try {
            var len = path.getTotalLength();
            if (len && isFinite(len) && len > 0) {
                path.style.strokeDasharray = len + ' ' + len;
                path.style.strokeDashoffset = len;
                drawMs = Math.min(640, Math.max(240, len * 1.15));
            }
        } catch (e) { /* getTotalLength unsupported — CSS fallback applies */ }
        path.style.animationDuration = drawMs + 'ms';
        if (delay) path.style.animationDelay = delay + 'ms';

        // arrow head, oriented along the tangent at the end point
        var ang = Math.atan2(end.y - ctrl.y, end.x - ctrl.x);
        var s = 8;
        var p1 = end;
        var p2 = { x: end.x - s * Math.cos(ang - 0.42), y: end.y - s * Math.sin(ang - 0.42) };
        var p3 = { x: end.x - s * Math.cos(ang + 0.42), y: end.y - s * Math.sin(ang + 0.42) };
        var head = svgEl('polygon', svg);
        head.setAttribute('class', 'dl-tut-arrow-head');
        head.setAttribute('points', p1.x + ',' + p1.y + ' ' + p2.x + ',' + p2.y + ' ' + p3.x + ',' + p3.y);
        head.style.animationDelay = ((delay || 0) + drawMs * 0.62) + 'ms';
    }

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    /* Where the arrow leaves its callout, depending on which side of the
       highlighted control the callout column sits on. */
    function anchorFor(placement, box, target) {
        var tcx = target.x + target.w / 2;
        if (placement === 'top')   return { x: clamp(tcx, box.x + 16, box.x + box.w - 16), y: box.y + box.h };
        if (placement === 'below') return { x: clamp(tcx, box.x + 16, box.x + box.w - 16), y: box.y };
        if (placement === 'left')  return { x: box.x + box.w, y: box.y + box.h / 2 };
        return { x: box.x, y: box.y + box.h / 2 }; // 'right'
    }

    function addRing(r, num) {
        var pad = 5;
        var n = el('div', 'dl-tut-ring', stage);
        n.style.left = (r.x - pad) + 'px';
        n.style.top = (r.y - pad) + 'px';
        n.style.width = (r.w + pad * 2) + 'px';
        n.style.height = (r.h + pad * 2) + 'px';
        if (num != null) {
            var badge = el('span', 'dl-tut-ring-num', n);
            badge.textContent = String(num);
        }
        return n;
    }

    // ── Rendering ────────────────────────────────────────────────
    function resetScrim() {
        if (!scrim) return;
        root.classList.remove('dl-tut-morph');
        scrim.removeAttribute('data-holes');
        scrim.style.clipPath = '';
        scrim.style.webkitClipPath = '';
    }

    /* `keepScrim` leaves the current holes in place: paint() then swaps them
       in a single write, which lets the scrim morph smoothly from the old
       highlight to the new one instead of blinking through a hole-less frame. */
    function clearStage(keepScrim) {
        stopTutorialVideo();
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        stage.innerHTML = '';
        if (!keepScrim) resetScrim();
        root.classList.remove('compact');
    }

    /* Toolbar / title / dots — updated the moment the slide starts leaving so
       the chrome never lags behind the click. */
    function syncChrome(step) {
        titleEl.innerHTML = (state.idx + 1) + '/' + STEPS.length + ' · ' + tr(step.title);
        btnPrev.disabled = state.idx === 0;
        btnNext.disabled = state.idx === STEPS.length - 1;
        btnPrev.title = tr(UI.prev);
        btnNext.title = tr(UI.next);
        Array.prototype.forEach.call(dots.children, function (d, i) {
            d.classList.toggle('active', i === state.idx);
            d.title = tr(STEPS[i].title);
            d.setAttribute('aria-label', (i + 1) + '/' + STEPS.length + ' · ' + d.title);
            if (i === state.idx) d.setAttribute('aria-current', 'step');
            else d.removeAttribute('aria-current');
        });
    }

    /* dir: 1 → forward, -1 → back, 0 / undefined → no transition (first
       paint, resize, language change, reduced motion). */
    function render(dir) {
        if (!root) return;
        var step = STEPS[state.idx];

        state.seq++;
        var seq = state.seq;

        // The layers panel is only needed on its own slide — start opening it
        // right away so it animates in behind the outgoing slide.
        ensurePanel(!!step.openPanel);
        // Same for the Friends panel on its own slide (signed-in users only;
        // signed-out visitors get the step's authNote instead).
        ensureFriends(!!step.openFriends);

        if (!dir || reduceMotion()) {
            commit(step);
            return;
        }

        // Phase 1 — fade/slide the current slide out in the travel direction.
        root.style.setProperty('--dl-tut-out', (dir > 0 ? -26 : 26) + 'px');
        root.style.setProperty('--dl-tut-in', (dir > 0 ? 26 : -26) + 'px');
        root.classList.add('dl-tut-leaving');

        setTimeout(function () {
            if (!state.open || seq !== state.seq) return;
            commit(step);
        }, LEAVE_MS);
    }

    /* Phase 2 — build the new slide off-screen (opacity 0), then hand it back
       to the CSS transition so it glides into place. */
    function commit(step) {
        if (!root) return;
        var seq = state.seq;
        var quiet = !!state.quiet;

        if (quiet) {
            root.classList.remove('dl-tut-leaving', 'dl-tut-entering');
        } else {
            root.classList.remove('dl-tut-leaving');
            root.classList.add('dl-tut-entering');
        }
        root.classList.toggle('dl-tut-quiet', quiet);

        syncChrome(step);
        svg.setAttribute('viewBox', '0 0 ' + vw() + ' ' + vh());

        function reveal() {
            if (!state.open || seq !== state.seq || STEPS[state.idx] !== step) return;
            paint(step);
            if (quiet) return;
            // Flush the "entering" state, then let the transition run.
            void stage.offsetWidth;
            requestAnimationFrame(function () {
                if (state.open && seq === state.seq) root.classList.remove('dl-tut-entering');
            });
        }

        if (step.openPanel && state.panelOpening) whenPanelSettled(reveal);
        else if (step.openFriends && state.friendsOpening) whenFriendsReady(reveal);
        else reveal();
    }

    function paint(step) {
        clearStage(true);
        svg.setAttribute('viewBox', '0 0 ' + vw() + ' ' + vh());

        if (step.type === 'targets') {
            paintTargets(step);          // replaces the scrim holes itself
        } else {
            resetScrim();
            if (step.type === 'catalog') paintCatalog(step);
            else if (step.type === 'guide') paintGuide(step);
            else if (step.type === 'performance') paintPerformance(step);
        }
    }

    function barBottom() {
        var r = bar.getBoundingClientRect();
        var t = titleEl.getBoundingClientRect();
        return Math.max(r.bottom, t.bottom) + 10;
    }

    function paintTargets(step) {
        // The Friends slide needs a signed-in account: opening the panel for
        // a visitor would pop the auth modal over the guide, so they get an
        // explanatory note pointing at the account menu instead.
        if (step.requiresAuth && !signedIn()) {
            resetScrim();
            var auth = el('div', 'dl-tut-note', stage);
            auth.style.cssText += 'left:50%;top:50%;transform:translate(-50%,-50%);width:min(340px,calc(100% - 32px));text-align:center;';
            auth.innerHTML = '<div class="dl-tut-note-item"><span class="dl-tut-note-ico">👥</span><span>' +
                tr(step.authNote) + '</span></div>';
            return;
        }

        var found = [];
        step.targets.forEach(function (t) {
            var node = pick(t.sel);
            if (!node) return;
            var ringNode = node;
            if (t.ring) {
                var closest = node.closest ? node.closest(t.ring) : null;
                ringNode = closest || (node.parentNode && node.parentNode.querySelector ? (node.parentNode.querySelector(t.ring) || node) : node);
            }
            var r = ringNode.getBoundingClientRect();
            found.push({
                def: t,
                rect: { x: r.left, y: r.top, w: r.width, h: r.height }
            });
        });

        if (!found.length) {
            resetScrim();
            var empty = el('div', 'dl-tut-note', stage);
            empty.style.cssText += 'left:50%;top:50%;transform:translate(-50%,-50%);width:min(320px,calc(100% - 32px));text-align:center;';
            empty.innerHTML = lang() === 'en'
                ? 'These controls are not available on this screen.'
                : 'Aceste butoane nu sunt disponibile pe acest ecran.';
            return;
        }

        var top = barBottom();
        var bottom = vh() - 12;
        var placement = step.placement;

        // Union of every target — used by the "below" placement.
        var uni = found.reduce(function (a, f) {
            return {
                x1: Math.min(a.x1, f.rect.x),
                y1: Math.min(a.y1, f.rect.y),
                x2: Math.max(a.x2, f.rect.x + f.rect.w),
                y2: Math.max(a.y2, f.rect.y + f.rect.h)
            };
        }, { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity });

        // On narrow screens there is no usable room beside the layers panel,
        // so the callouts drop underneath the highlighted row instead.
        if (placement === 'left' && (uni.x1 - 30) < 190) placement = 'below';

        // PWA floating controls: number each button left-to-right so the callout
        // clearly maps to its control even when arrows cross.
        var numberBar = placement === 'top' && isPwa();
        var nums = [];
        if (numberBar) {
            found.map(function (f, i) { return i; })
                .sort(function (a, b) { return found[a].rect.x - found[b].rect.x; })
                .forEach(function (idx, n) { nums[idx] = n + 1; });
        }

        // Build the callouts first so we can measure their heights.
        var boxes = found.map(function (f, i) {
            var c = el('div', 'dl-tut-callout', stage);
            var numHtml = numberBar && nums[i]
                ? '<span class="dl-tut-c-num">' + nums[i] + '</span>'
                : '';
            c.innerHTML =
                '<span class="dl-tut-c-title">' + numHtml + tr(f.def.title) + '</span>' +
                '<span class="dl-tut-c-desc">' + tr(f.def.desc) + '</span>';
            return { node: c, f: f, num: nums[i] || null };
        });

        // Stagger the callouts so the slide unfolds instead of popping in one
        // single block.
        boxes.forEach(function (b, i) {
            b.node.style.animationDelay = Math.round(Math.min(i * 45, 220)) + 'ms';
        });

        if (numberBar) root.classList.add('compact');

        var note = null;
        if (step.notes && step.notes.length) {
            note = el('div', 'dl-tut-note', stage);
            note.style.animationDelay = Math.round(Math.min(boxes.length * 45, 220) + 60) + 'ms';
            note.innerHTML = step.notes.map(function (n) {
                return '<div class="dl-tut-note-item"><span class="dl-tut-note-ico">' + n.ico + '</span><span>' + tr(n.text) + '</span></div>';
            }).join('');
        }

        // ── Column geometry ──
        var colX, colW;
        if (placement === 'right') {
            var maxRight = Math.max.apply(null, found.map(function (f) { return f.rect.x + f.rect.w; }));
            colX = Math.min(maxRight + 18, vw() * 0.36);
            colW = Math.min(300, vw() - colX - 12);
            if (colW < 150) { colX = 12; colW = vw() - 24; }
        } else if (placement === 'left') {
            colW = Math.min(300, Math.max(150, uni.x1 - 30));
            colX = Math.max(12, uni.x1 - colW - 18);
        } else if (placement === 'below') {
            colW = Math.min(360, vw() - 24);
            colX = Math.max(12, Math.min((uni.x1 + uni.x2) / 2 - colW / 2, vw() - colW - 12));
        } else { // 'top' — detection / storage / account slide
            colW = Math.min(340, vw() - 24);
            colX = (vw() - colW) / 2;
        }

        boxes.forEach(function (b) {
            b.node.style.left = colX + 'px';
            b.node.style.width = colW + 'px';
        });
        if (note) {
            note.style.left = colX + 'px';
            note.style.width = colW + 'px';
        }

        // Measure — shrink everything if the column would not fit.
        function totalHeight() {
            var t = 0;
            boxes.forEach(function (b) { t += b.node.offsetHeight; });
            if (note) t += note.offsetHeight + 10;
            return t + (boxes.length - 1) * 8;
        }

        var minTargetTop = uni.y1;
        var avail;
        if (placement === 'top') avail = (minTargetTop - 16) - top;
        else if (placement === 'below') avail = bottom - Math.max(top, uni.y2 + 24);
        else avail = bottom - top;

        if (totalHeight() > avail) root.classList.add('compact');

        // ── Vertical placement ──
        var items = boxes.map(function (b) {
            var h = b.node.offsetHeight;
            var pref;
            if (placement === 'top' || placement === 'below') pref = 0; // resolved below
            else pref = b.f.rect.y + b.f.rect.h / 2 - h / 2;
            return { box: b, h: h, pref: pref };
        });

        var noteH = note ? note.offsetHeight : 0;

        if (placement === 'top') {
            // Order the callouts left-to-right by the x of their target and
            // stack them upwards from just above the topmost target.
            var lowerBound = Math.max(top, minTargetTop - 16);
            items.sort(function (a, b) { return a.box.f.rect.x - b.box.f.rect.x; });

            if (numberBar && items.length >= 2) {
                // Two columns over the map: left targets → left column,
                // right targets → right column. Arrows stay mostly vertical.
                var split = Math.ceil(items.length / 2);
                var leftCol = items.slice(0, split);
                var rightCol = items.slice(split);
                var colW2 = Math.min(200, Math.max(136, Math.floor((vw() - 24) / 2)));
                var leftX = 8;
                var rightX = vw() - colW2 - 8;

                function layoutBarCol(col, x) {
                    col.forEach(function (it) {
                        it.x = x;
                        it.w = colW2;
                        it.box.node.style.left = x + 'px';
                        it.box.node.style.width = colW2 + 'px';
                    });
                    col.forEach(function (it) { it.h = it.box.node.offsetHeight; });
                    var yy = lowerBound;
                    for (var ci = col.length - 1; ci >= 0; ci--) {
                        yy -= col[ci].h;
                        col[ci].y = yy;
                        yy -= 6;
                    }
                    if (col.length && col[0].y < top) {
                        var sh = top - col[0].y;
                        col.forEach(function (it) { it.y += sh; });
                    }
                }
                layoutBarCol(leftCol, leftX);
                layoutBarCol(rightCol, rightX);
            } else {
                var y = lowerBound;
                for (var i = items.length - 1; i >= 0; i--) {
                    y -= items[i].h;
                    items[i].y = y;
                    y -= 8;
                }
                if (items.length && items[0].y < top) {
                    var shift = top - items[0].y;
                    items.forEach(function (it) { it.y += shift; });
                }
            }
        } else if (placement === 'below') {
            // Stack downwards, starting just under the highlighted controls.
            items.sort(function (a, b) { return a.box.f.rect.y - b.box.f.rect.y; });
            var yb = Math.max(top, uni.y2 + 26);
            items.forEach(function (it) {
                it.y = yb;
                yb += it.h + 8;
            });
            var overflow = (yb - 8 + (noteH ? noteH + 10 : 0)) - bottom;
            if (overflow > 0) {
                items.forEach(function (it) { it.y = Math.max(top, it.y - overflow); });
            }
        } else {
            var maxY = bottom - (noteH ? noteH + 10 : 0);
            packVertical(items, top, maxY, 8);
        }

        items.forEach(function (it) {
            if (it.x == null) { it.x = colX; it.w = colW; }
            it.box.node.style.top = Math.round(it.y) + 'px';
        });

        if (note) {
            var lastBottom = items.reduce(function (m, it) { return Math.max(m, it.y + it.h); }, top);
            note.style.top = Math.round(Math.min(lastBottom + 10, bottom - noteH)) + 'px';
        }

        // ── Rings, holes and arrows ──
        var holes = [];
        found.forEach(function (f, fi) {
            addRing(f.rect, numberBar ? nums[fi] : null);
            holes.push({ x: f.rect.x - 5, y: f.rect.y - 5, w: f.rect.w + 10, h: f.rect.h + 10 });
        });
        applyScrimHoles(holes);

        // Arrows start drawing only once their callout has landed.
        items.forEach(function (it, i) {
            var box = { x: it.x, y: it.y, w: it.w, h: it.h };
            drawArrow(anchorFor(placement, box, it.box.f.rect), it.box.f.rect,
                140 + Math.round(Math.min(i * 45, 220)));
        });
    }

    function cardShell(extraClass) {
        var top = barBottom();
        var card = el('div', 'dl-tut-card' + (extraClass ? ' ' + extraClass : ''), stage);
        card.style.pointerEvents = 'auto';
        card.style.top = top + 'px';
        card.style.maxHeight = (vh() - top - 16) + 'px';
        card.addEventListener('click', function (e) { e.stopPropagation(); });
        return card;
    }

    // Text-only feature walkthroughs: scroll inside the card on touch and
    // desktop, without swallowing navigation or activating the real tools.
    function paintGuide(step) {
        var card = cardShell();
        var body = el('div', 'dl-tut-card-body', card);
        body.tabIndex = 0;
        body.setAttribute('role', 'region');
        body.setAttribute('aria-label', tr(step.title));
        step.sections.forEach(function (section) {
            var row = el('div', 'dl-tut-layer', body);
            el('span', 'dl-tut-layer-name', row).textContent = tr(section.title);
            el('span', 'dl-tut-layer-desc', row).textContent = tr(section.desc);
        });
    }

    function paintCatalog(step) {
        var card = cardShell();

        var tabs = el('div', 'dl-tut-card-tabs', card);
        var body = el('div', 'dl-tut-card-body', card);

        function fill() {
            var list = CATALOG[state.tab] || [];
            body.innerHTML = list.map(function (l) {
                return '<div class="dl-tut-layer">' +
                    '<span class="dl-tut-layer-name">' + tr(l.name) + '</span>' +
                    '<span class="dl-tut-layer-desc">' + tr(l.desc) + '</span>' +
                    '</div>';
            }).join('');
            body.scrollTop = 0;
        }

        [['free', UI.free_tab, ''], ['premium', UI.prem_tab, ' premium']].forEach(function (t) {
            var b = el('button', 'dl-tut-tab' + t[2] + (state.tab === t[0] ? ' active' : ''), tabs);
            b.type = 'button';
            b.textContent = tr(t[1]);
            b.addEventListener('click', function (e) {
                e.stopPropagation();
                state.tab = t[0];
                Array.prototype.forEach.call(tabs.children, function (n, i) {
                    n.classList.toggle('active', (i === 0) === (t[0] === 'free'));
                });
                fill();
            });
        });

        fill();

        // The body must scroll inside the fixed-height card.
        requestAnimationFrame(function () {
            var used = tabs.offsetHeight + 12 + 28;
            body.style.maxHeight = Math.max(120, (vh() - card.getBoundingClientRect().top - 16) - used) + 'px';
        });
    }

    function paintPerformance(step) {
        var card = cardShell('dl-tut-card-perf');
        var body = el('div', 'dl-tut-card-body', card);
        body.innerHTML =
            '<div class="dl-tut-perf-layout">' +
                '<div class="dl-tut-perf">' +
                    '<span class="dl-tut-perf-ico">⚡</span>' +
                    '<div>' +
                        '<span class="dl-tut-layer-name" style="margin-bottom:6px">' + tr(PERF.title) + '</span>' +
                        '<p>' + tr(PERF.body) + '</p>' +
                        '<span class="dl-tut-tip">' + tr(PERF.tip) + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="dl-tut-perf-video">' +
                    '<video id="dlTutVideo" playsinline webkit-playsinline controls preload="metadata">' +
                        '<source src="' + TUTORIAL_VIDEO_URL + '" type="video/quicktime">' +
                    '</video>' +
                '</div>' +
            '</div>';

        var fin = el('button', 'dl-tut-finish', card);
        fin.type = 'button';
        fin.textContent = tr(UI.finish);
        fin.addEventListener('click', function (e) { e.stopPropagation(); close(); });

        requestAnimationFrame(function () {
            var used = fin.offsetHeight + 14 + 28;
            body.style.maxHeight = Math.max(120, (vh() - card.getBoundingClientRect().top - 16) - used) + 'px';
        });
    }

    // ── Public API ───────────────────────────────────────────────
    function go(i) {
        if (i < 0) return;
        if (i >= STEPS.length) { close(); return; }
        var dir = i > state.idx ? 1 : (i < state.idx ? -1 : 0);
        state.idx = i;
        state.quiet = false;
        if (dir === 0) { if (state.open) render(0); return; }
        render(dir);
    }

    function open(startIndex) {
        build();
        state.open = true;
        state.idx = typeof startIndex === 'number' ? startIndex : 0;
        state.quiet = false;
        state.seq++;
        root.classList.remove('dl-tut-closing', 'dl-tut-leaving', 'dl-tut-entering', 'dl-tut-quiet');
        root.classList.add('open');

        // On the website (non-PWA) the map can be scrolled half out of view —
        // bring it fully on screen so every arrow has a visible target.
        var scrolled = false;
        var frame = document.querySelector('.map-frame');
        if (frame && !document.body.classList.contains('is-pwa')) {
            var r = frame.getBoundingClientRect();
            if (r.top < 0 || r.bottom > vh()) {
                try { frame.scrollIntoView({ block: 'center' }); } catch (e) { frame.scrollIntoView(); }
                scrolled = true;
            }
        }

        render(0);

        // A second pass after the scroll settles keeps the arrows exact. It
        // still runs before the first painted frame, so the entrance
        // animation starts cleanly instead of being restarted mid-flight.
        requestAnimationFrame(function () {
            if (!state.open) return;
            var step = STEPS[state.idx];
            if (step && step.openPanel && state.panelOpening) return; // commit() paints once the panel lands
            if (step && step.openFriends && state.friendsOpening) return; // commit() paints once the friends tab renders
            paint(step);
        });

        // Smooth scrolling keeps moving for a while — settle the arrows once
        // it stops, without replaying the entrance animation.
        if (scrolled) {
            setTimeout(function () {
                if (!state.open) return;
                state.quiet = true;
                paint(STEPS[state.idx]);
                root.classList.add('dl-tut-quiet');
            }, 340);
        }
    }

    function close() {
        if (!root || !state.open) return;
        state.open = false;
        state.seq++;
        stopTutorialVideo();

        var finish = function () {
            ensurePanel(false);
            ensureFriends(false);
            root.classList.remove('open', 'dl-tut-closing', 'dl-tut-leaving',
                                 'dl-tut-entering', 'dl-tut-quiet');
            clearStage();
        };

        if (reduceMotion()) { finish(); return; }

        root.classList.add('dl-tut-closing');
        setTimeout(finish, 200);
    }

    window.openMapTutorial = function (i) { open(i); };
    window.closeMapTutorial = close;

    // Keep the "?" button label localised.
    function syncBtn() {
        var b = document.getElementById('mapHelpBtn');
        if (!b) return;
        b.title = tr(UI.help_title);
        b.setAttribute('aria-label', tr(UI.help_title));
    }

    document.addEventListener('detectlab:langchange', syncBtn);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', syncBtn);
    } else {
        syncBtn();
    }
})();
