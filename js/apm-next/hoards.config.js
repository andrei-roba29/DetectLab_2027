/* Hoards only. Proposed chronology/accuracy assumptions MUST be reviewed before activation.
 * No changes to the existing settlement period configuration.
 */
(function(root) {
    'use strict';
    var config = {
        // Fail closed until real source evidence, licence, chronology and live timing review.
        release: { sourceReviewed: false, licenceApproved: false, chronologyReviewed: false, performancePassed: false,
            // The operator's own decision, NOT evidence of review. ON at the
            // operator's request (2026-11-09): TRAIN runs on hoards while the four
            // reviews above stay open. The panel shows a permanent warning, every
            // result carries it, and data imports still refuse because `ready()`
            // reads the four reviews only and ignores this switch on purpose.
            operatorOverride: true },
        trainingRadiusKm: 150,
        resolutionM: 150, // proposal, NOT a measured optimum; also used for prediction
        maxRequests: 120,
        deadlineMs: 90000,
        excludeRomanianHoardSettlements: true,
        accuracyM: { exact: 60, approximate: 1000, unknown: null }, // working neighbourhoods, NOT measured precision
        duplicate: { distanceM: 1000, nameSimilarity: 0.7 },
        ranPosition: { DA: 'exact', NU: 'approximate', '': 'unknown' },
        // Empty intentionally: never invent meanings for DARMC quality codes or dates.
        // Each layer requires { idField,nameField,dateStartField,dateEndField,dateBasis,
        // yearConvention:'ce'|'historical',qualityFields:[],positionMapping:{rawKey:class},
        // centroidValues:[],hoardType,metalField,countryField,reviewed:true }.
        layers: {},
        periodGroups: [
            { key: 'gallic', label: 'Gallic / Galic', start: 200, end: 300, source: 'Haupt 2001; layer 12 date range supplied by the user; review required' },
            { key: 'late-roman', label: 'Late Roman / Roman târziu', start: 200, end: 700, source: 'Hobbs 2006; layers 15–16 date range supplied by the user; review required' },
            { key: 'carolingian', label: 'Carolingian / Carolingian', start: 751, end: 987, source: 'Coupland 2011, A Checklist of Carolingian Coin Hoards 751–987, Numismatic Chronicle 171; review required' }
        ],
        /* Danish period groups for the Fund og Fortidsminder hoards (Denmark has no
         * national repertory in this app). Same conventional Danish boundaries as
         * js/apm-next/apm-denmark-sites.js; broad envelopes for filtering, not
         * excavated dates. */
        danishPeriodGroups: [
            { key: 'stenalder', label: 'Stenalder', start: -10000, end: -1700, source: 'Conventional Danish period boundary; broad envelope, review required' },
            { key: 'bronzealder', label: 'Bronzealder', start: -1700, end: -500, source: 'Conventional Danish period boundary; broad envelope, review required' },
            { key: 'foerromersk', label: 'Førromersk jernalder', start: -500, end: 1, source: 'Conventional Danish period boundary; broad envelope, review required' },
            { key: 'romersk', label: 'Romersk jernalder', start: 1, end: 400, source: 'Conventional Danish period boundary; broad envelope, review required' },
            { key: 'germansk', label: 'Germansk jernalder', start: 400, end: 800, source: 'Conventional Danish period boundary; broad envelope, review required' },
            { key: 'jernalder', label: 'Jernalder', start: -500, end: 800, source: 'Conventional Danish period boundary; broad envelope, review required' },
            { key: 'vikingetid', label: 'Vikingetid', start: 793, end: 1066, source: 'Conventional Danish period boundary; broad envelope, review required' },
            { key: 'middelalder', label: 'Middelalder', start: 1066, end: 1536, source: 'Conventional Danish period boundary; broad envelope, review required' },
            { key: 'nyere', label: 'Nyere tid', start: 1536, end: 2000, source: 'Conventional Danish period boundary; broad envelope, review required' },
            { key: 'oldtid', label: 'Oldtid (broad)', start: -10000, end: 1066, source: 'Conventional Danish period boundary; broad envelope, review required' }
        ],
        // Astronomical ranges. Editorial proposals only; objects, NOT burial dates.
        // Specific phrases are consumed before general ones, while distinct periods survive.
        romanianPeriods: [
            { key: 'eneolitic', label: 'Eneolitic', start: -4999, end: -2499, patterns: ['eneolitic[a-z]*','cucuteni','cotofeni'], source: 'https://en.wikipedia.org/wiki/Prehistory_of_Transylvania — regional Copper Age envelope; review required' },
            { key: 'neolitic', label: 'Neolitic', start: -6499, end: -4499, patterns: ['neolitic[a-z]*'], source: 'https://en.wikipedia.org/wiki/Prehistory_of_Transylvania — regional Neolithic envelope; review required' },
            { key: 'bronz', label: 'Epoca bronzului', start: -3499, end: -1199, patterns: ['epoca bronzului','bronzului'], source: 'https://en.wikipedia.org/wiki/Prehistory_of_Transylvania — regional Bronze Age envelope; review required' },
            { key: 'hallstatt', label: 'Hallstatt', start: -1199, end: -449, patterns: ['hallstatt[a-z]*'], source: 'https://www.britannica.com/topic/Hallstatt-culture — approximate; review required' },
            { key: 'latene', label: 'La Tène', start: -449, end: 106, patterns: ['la ?tene','latene'], source: 'https://www.britannica.com/topic/La-Tene — regional extension to AD 106 proposed; review required' },
            { key: 'carpic', label: 'Carpic', start: 100, end: 400, patterns: ['carpic[a-z]*'], source: 'https://en.wikipedia.org/wiki/Carpi_(people) — proposed broad envelope; review required' },
            { key: 'dacic', label: 'Dacic', start: -499, end: 106, patterns: ['dacic[a-z]*','geto-dac[a-z]*'], source: 'https://www.britannica.com/place/Dacia — approximate; review required' },
            { key: 'roman-republican', label: 'Roman republican', start: -508, end: -26, patterns: ['roman[a-z]* republican[a-z]*'], source: 'https://www.britannica.com/place/Roman-Republic — 509–27 BC; review required' },
            { key: 'roman', label: 'Roman', start: -26, end: 476, patterns: ['roman(?:a|e|i|ul|ului)?'], source: 'https://www.britannica.com/place/Roman-Empire — 27 BC–AD 476; review required' },
            { key: 'bizantin', label: 'Bizantin', start: 330, end: 1453, patterns: ['bizantin[a-z]*'], source: 'https://www.britannica.com/place/Byzantine-Empire — broad envelope; review required' },
            { key: 'medieval', label: 'Medieval', start: 500, end: 1600, patterns: ['medieval[a-z]*'], source: 'https://www.britannica.com/event/Middle-Ages — regional working envelope; review required' },
            { key: 'otoman', label: 'Otoman', start: 1299, end: 1922, patterns: ['otoman[a-z]*'], source: 'https://www.britannica.com/place/Ottoman-Empire — broad envelope; review required' }
        ]
    };
    if (typeof module === 'object' && module.exports) module.exports = config;
    else root.DetectLabHoardConfig = config;
})(typeof self !== 'undefined' ? self : this);
