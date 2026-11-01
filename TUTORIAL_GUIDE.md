# Question-mark map guide (2026-11-01)

The shared desktop/PWA guide in `js/tutorial.js` now has 13 steps, fully in Romanian and English:

1. Left-side map controls, GPS and offline areas
2. Detection, storage and account
3. Friends, requests and chat
4. Layers, coverage and vertical controls
5. Free/Premium catalogue
6. 3D entry/exit, desktop/touch gestures, base maps, reset and raster refresh
7. LiDAR whole-layer versus 1 km radius loading, image settings and numeric-DTM limitations
8. Point/radius analysis actions and interpretation
9. APM Next-Gen MANUAL, heatmap, very-high outlines and GeoJSON
10. APM Next-Gen TRAIN, Romanian data/CSV, periods, validation and down-weighted sites
11. Historical-map long-press alignment, 3 km shift, lock, persistence, reset and the separate Other maps workflow
12. Search, paired controls, temporal comparisons, minimised windows and offline limitations
13. Performance tips and the existing video

Feature steps use keyboard-focusable, internally scrolling cards rather than activating tools. They do not run an analysis, enter 3D, toggle layers, or prompt for Premium/login. Existing targeted control steps and their panel lifecycle are retained. Navigation dots now have localised chapter titles and an active-step accessibility state.

`index.html` and the service-worker precache use `js/tutorial.js?v=20261101-expanded-guide`; the guide introduced shell cache `detectlab-v365-expanded-guide` (subsequent fixes advance the shell version). This requires the normal frontend deployment; no backend or database change is needed.

## Verification

- `node --check js/tutorial.js` and `node --check sw.js`
- `node test-tutorial.js`: 226 checks, including recursive bilingual completeness, chapter content, real control IDs and matching cache URL.
- `PLAYWRIGHT_MODULE_DIR=/path/to/node_modules node test-tutorial-browser.js`: eight passing Chromium scenarios (RO/EN × desktop 1440×900, PWA-class 390×844, 320×568, 844×390). Uses `playwright-core`, an installed Chromium or optional `@sparticuz/chromium`. No browser dependency or binary is added to the project.
- Browser checks use the real tutorial JS/CSS in a minimal map-shell fixture, not a live map or installed-device session. They cover catalogue tabs, seven feature cards, scrolling to the last section, toolbar/card bounds, navigation, language changes, resizing, closing and reopening. They do not verify tile providers or run the documented analyses.
- `node test-hist-shift.js`: passes.
- `node test-apm-next.js`: 62 passed, 0 failed.

Two broader existing suites, `test-map3d-mobile.js` and `test-map3d-terrain.js`, fail on stale exact 3D asset-tag assertions. The same failures were reproduced with the unmodified HEAD versions of `index.html`, `sw.js` and `js/tutorial.js`; those tests/assets were not changed to hide the failures.
