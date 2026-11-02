/* sql.js-httpvfs adapter. Run synchronous range I/O off the UI thread and
 * reject malformed/ignored byte ranges instead of corrupting SQLite's cache.
 * No SharedArrayBuffer / cross-origin-isolated browsing context is needed. */
'use strict';
(function () {
    var open = XMLHttpRequest.prototype.open;
    var setHeader = XMLHttpRequest.prototype.setRequestHeader;
    var send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method) {
        this._dlRange = null;
        this._dlMethod = method;
        return open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        if (String(name).toLowerCase() === 'range') this._dlRange = /^bytes=(\d+)-(\d+)$/.exec(value);
        return setHeader.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
        // Sync XHR timeout is supported in workers (not on the main thread).
        this.timeout = 20000;
        send.apply(this, arguments);
        if (this._dlRange) {
            var expected = Number(this._dlRange[2]) - Number(this._dlRange[1]) + 1;
            if (this.status !== 206 || !this.response || this.response.byteLength !== expected) {
                throw new Error('invalid_geopackage_range_response');
            }
        }
    };
})();
importScripts('vendor/geopackage/sqlite.worker.js');
