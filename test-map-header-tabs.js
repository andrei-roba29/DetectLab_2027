'use strict';

// Run: node test-map-header-tabs.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const tabs = index.match(/<div class="map-tabs"[^>]*>([\s\S]*?)<\/div>/);
assert(tabs, 'the map tabs container remains available');
assert.doesNotMatch(tabs[1], /roman-atlas-link|europe-roman-atlas|3D ArcGIS atlas/i,
    'the 3D ArcGIS atlas tab is removed');
assert.match(tabs[1], /data-key="tab_free"[^>]*onclick="switchTab\(this,'free'\)"/,
    'the Free Preview tab is preserved');
assert.match(tabs[1], /id="tabWeather"[^>]*onclick="switchTab\(this,'weather'\)"/,
    'the Weather tab is preserved');
assert.strictEqual((tabs[1].match(/class="map-tab\b/g) || []).length, 2,
    'the header contains only the two remaining tabs');
assert.match(index, /<li><a href="europe-roman-atlas.html">/,
    'the separate Roman Atlas navigation link is preserved');
assert.match(index, /src="js\/map3d-terrain\.js\?v=/,
    'the regular 3D map viewer is unaffected');
console.log('PASS: ArcGIS atlas tab removed; Free Preview, Weather, Roman Atlas navigation and 3D viewer preserved.');
