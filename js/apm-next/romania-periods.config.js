/* Editable name inference, NOT excavated dating. Astronomical approximate year ranges.
 * References are review starting points; ranges deliberately broad, regionally variable.
 * Patterns operate on normalised descriptive text only and must match whole words.
 * No additional cultures can be claimed from the missing user sample.
 */
(function (root) {
    'use strict';
    var config = {
        includeEmptyCoord: false,
        ambiguousWholeNames: ['roman', 'romanesti', 'romania'],
        excludeNamePatterns: ['necropol', 'biseric', 'manastir', 'cimitir', 'schit', 'capel', 'cripta', 'mormant', 'tumul'],
        periods: [
            { label: 'Eneolitic / Chalcolitic', start: -5000, end: -2500,
                patterns: ['eneolitic[a-z]*', 'cotofeni', 'cucuteni', 'gumelnita', 'hamangia'],
                source: 'https://en.wikipedia.org/wiki/Prehistory_of_Transylvania (Copper Age); https://en.wikipedia.org/wiki/Co%C8%9Bofeni_culture; regional envelope, approximate, review required' },
            { label: 'Neolitic', start: -6500, end: -4500,
                patterns: ['neolitic[a-z]*', 'starcevo(?:-cris)?', 'precucuteni'],
                source: 'https://en.wikipedia.org/wiki/Prehistory_of_Transylvania (Neolithic); broad regional envelope, approximate, review required' },
            { label: 'Epoca bronzului', start: -3500, end: -1200,
                patterns: ['epoca bronzului', 'bronz(?:ului)?', 'wietenberg', 'monteoru'],
                source: 'https://en.wikipedia.org/wiki/Prehistory_of_Transylvania (Bronze Age); regional envelope, approximate, review required' },
            { label: 'Hallstatt', start: -1200, end: -450,
                patterns: ['hallstatt(?:ian[a-z]*)?'],
                source: 'https://www.britannica.com/topic/Hallstatt-culture; includes conventional Romanian early-Iron-Age usage, approximate, review required' },
            { label: 'La Tène', start: -450, end: 106,
                patterns: ['la ?tene', 'latene'],
                source: 'https://www.britannica.com/topic/La-Tene; extended to Roman conquest for regional usage, approximate, review required' },
            { label: 'Dacic', start: -500, end: 106,
                patterns: ['dacic[a-z]*', 'geto-dac[a-z]*', 'getic[a-z]*'],
                source: 'https://www.britannica.com/place/Dacia; broad pre-conquest regional envelope, approximate, review required' },
            { label: 'Epoca fierului', start: -1200, end: 106,
                patterns: ['epoca fierului'],
                source: 'https://en.wikipedia.org/wiki/Prehistory_of_Transylvania (Iron Age); broad regional envelope, approximate, review required' },
            { label: 'Roman', start: 106, end: 275,
                patterns: ['epoca romana', 'roman(?:a|e|i|ul|ului)?', 'castru(?:l|lui)?'],
                source: 'https://www.britannica.com/place/Dacia (Roman conquest and withdrawal); provincial interval only, approximate, review required' },
            { label: 'Medieval', start: 500, end: 1600,
                patterns: ['medieval[a-z]*', 'feudal[a-z]*', 'voievodal[a-z]*'],
                source: 'https://www.britannica.com/event/Middle-Ages; broad Romanian working envelope, not an exact local chronology, review required' }
        ]
    };
    root.DetectLabRomaniaApmConfig = config;
    if (typeof module === 'object' && module.exports) module.exports = config;
})(typeof self !== 'undefined' ? self : this);
