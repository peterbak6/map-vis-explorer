import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as d3 from 'd3';
import {slippyPixel, tilesFor, tileUrl} from './tiles.ts';

test('tiles line up with d3.geoMercator, also when zoomed', () => {
  const proj = d3.geoMercator().fitExtent([[16, 16], [1100, 640]], {type: 'MultiPoint', coordinates: [[5.2865, 60.3578], [5.3612, 60.4129]]});
  for (const zoom of [{x: 0, y: 0, k: 1}, {x: -900, y: -500, k: 3.7}]) {
    const tiles = tilesFor(proj.scale(), proj.translate(), zoom, 1116, 656, (z, x, y) => `${z}/${x}/${y}`);
    const z = +tiles[0].key.split('/')[0];
    for (const [lon, lat] of [[5.3242, 60.3913], [5.30, 60.37], [5.355, 60.405]]) {
      const [px, py] = proj([lon, lat])!;
      const sx = zoom.k * px + zoom.x, sy = zoom.k * py + zoom.y; // where the data point is drawn
      const [gx, gy] = slippyPixel(lon, lat, z); // where it is on the tile pyramid
      const t = tiles.find(t => t.key === `${z}/${Math.floor(gx / 256)}/${Math.floor(gy / 256)}`);
      if (!t) continue; // point outside the viewport at this zoom
      const tx = t.x + ((gx % 256) / 256) * t.size, ty = t.y + ((gy % 256) / 256) * t.size;
      assert.ok(Math.abs(tx - sx) < 0.5 && Math.abs(ty - sy) < 0.5, `off by ${(tx - sx).toFixed(2)}, ${(ty - sy).toFixed(2)} px`);
    }
  }
});

test('tile URLs carry the optional key', () => {
  assert.equal(tileUrl('osm', 13, 4217, 2361, true), 'https://tile.openstreetmap.org/13/4217/2361.png');
  assert.equal(tileUrl('light', 13, 4217, 2361, false), 'https://basemaps.cartocdn.com/light_all/13/4217/2361.png');
  assert.equal(tileUrl('light', 13, 4217, 2361, true, 'abc'), 'https://basemaps.cartocdn.com/light_all/13/4217/2361@2x.png?key=abc');
  // Bergen centre (Store Lungegårdsvann) is in OSM tile 13/4217/2361.
  const [gx, gy] = slippyPixel(5.3242, 60.3913, 13);
  assert.deepEqual([Math.floor(gx / 256), Math.floor(gy / 256)], [4217, 2361]);
});
