# GeoPackage reader runtime (vendored, no frontend build)

These files are **unmodified npm distribution artifacts**. They are executed
only when Natural protected sites is enabled at a supported zoom; they are
also included in the PWA shell precache. No dataset is included here.

| Files | Package / version | Licence |
|---|---|---|
| `sqlite.worker.js`, `sql-wasm.wasm` | [sql.js-httpvfs 0.8.12](https://github.com/phiresky/sql.js-httpvfs) | Apache-2.0; embedded sql.js is MIT; SQLite is public domain |
| `comlink.js` (`dist/umd/comlink.js`) | [Comlink 4.3.0](https://github.com/GoogleChromeLabs/comlink) | Apache-2.0 |
| `proj4.js` (`dist/proj4.js`) | [Proj4js 2.22.0](https://github.com/proj4js/proj4js) | MIT |

The accompanying `*.LICENSE.*` files reproduce the upstream licences. The
sql.js licence is from `sql-js/sql.js/LICENSE`; its author list is included in
`sql.js.AUTHORS.txt`. Source maps are optional and not shipped.

**Keep Comlink at 4.3.0 with this worker.** The published httpvfs worker uses
Comlink's numeric wire protocol; 4.3.1 changed the wire enums to strings and is
not compatible with it. Do not upgrade one without rebuilding/upgrading both.

To reproduce these files, unpack (in a temporary/ignored directory):

```sh
npm pack sql.js-httpvfs@0.8.12 comlink@4.3.0 proj4@2.22.0
```

Copy `dist/sqlite.worker.js` and `dist/sql-wasm.wasm` from the first package,
`dist/umd/comlink.js` from the second and `dist/proj4.js` from the third, along
with their licences. Then run `node test-romania-heritage-browser.js` with
Playwright/Chromium installed. No Node runtime dependencies are added to the
application and no external CDN is needed for this reader.

SHA-256 checksums:

```text
725e3dfc8daffdcd3c820c7115a3c8157fe43b43715b13f2a2322f37fb7b49ff  comlink.js
af7df653d91ea591f33d26fb958990bbd3071b2db644a4edaba441cc9861a474  proj4.js
e48eea05c22fb0a9eee181c249488ac498899d58ccde20c17d223218416ef49d  sqlite.worker.js
f71cee54ad1d4cccb781aad1fa79aa245a47fd3bd5172bb9f0d0897d47c7df15  sql-wasm.wasm
```

`../../geopackage-worker.js` is our small first-party adapter: it bounds sync
XHR timeouts and validates every range response before httpvfs caches it.
`../../geopackage-reader.js` discovers the file's schema/CRS, filters through
its spatial index and decodes GeoPackageBinary/WKB into GeoJSON.
