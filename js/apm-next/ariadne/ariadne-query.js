/*!
 * The request body sent upstream. One function, one place.
 *
 * UNVERIFIED. The response excerpt proves the result shape, not the query DSL.
 * These field names are the only guess in the whole provider and they are all in
 * `config.fields` + this file, so a live correction is a one-file edit.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DetectLabAriadneQuery = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * @param {object} opts { box, cells, from, size, aggregations, fields }
     * @returns {object} the JSON body for the search endpoint
     */
    function buildSearchBody(opts) {
        var fields = opts.fields;
        var filter = [];
        if (opts.cells && opts.cells.length) {
            var terms = {}; terms[fields.cellField] = opts.cells;
            filter.push({ terms: terms });
        } else if (opts.box) {
            var geo = {};
            geo[fields.pointField] = {
                top_left: { lat: opts.box.north, lon: opts.box.west },
                bottom_right: { lat: opts.box.south, lon: opts.box.east }
            };
            filter.push({ geo_bounding_box: geo });
        }
        var body = {
            from: opts.from || 0,
            size: Math.max(1, opts.size || 100),
            query: { bool: { filter: filter } }
        };
        if (opts.aggregations) {
            var subjectTerms = { field: fields.subject, size: 30 };
            body.aggregations = {
                ariadneSubject: { terms: subjectTerms },
                temporal: { terms: { field: 'temporal', size: 30 } },
                geogridCentroid: { terms: { field: fields.cellField, size: 100 } }
            };
        }
        return body;
    }

    /** Number of pages a tile needs, given its reported total. */
    function pagesFor(total, pageSize, maxPages) {
        if (!Number.isFinite(total) || total <= 0) return 1;
        return Math.max(1, Math.min(maxPages, Math.ceil(total / pageSize)));
    }

    return { buildSearchBody: buildSearchBody, pagesFor: pagesFor };
});
