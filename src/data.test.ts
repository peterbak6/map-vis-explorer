import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as d3 from 'd3';
import {fromGeoJSON, rewind} from './data.ts';
import type {DatasetMeta} from './types.ts';

const meta: DatasetMeta = {
  id: 'g', title: 'G', subtitle: '', region: 'bergen', geometry: 'points', features: 'f.geojson', flows: 'l.geojson', flowField: 'trips',
  fields: ['starts', 'ends'], levels: [{id: 'station', label: 'Station'}],
  measures: [{id: 'starts', label: 'Starts', kind: 'count', field: 'starts'}], source: '', attribution: '',
};

test('GeoJSON points become features with numeric fields; flows become an OD table', () => {
  const {ds, base} = fromGeoJSON(meta, {type: 'FeatureCollection', features: [
    {type: 'Feature', id: '5', geometry: {type: 'Point', coordinates: [5.33, 60.37]}, properties: {name: 'Solheimsviken', starts: 10, ends: '7'}},
    {type: 'Feature', id: '220', geometry: {type: 'Point', coordinates: [5.35, 60.38]}, properties: {name: 'Møllendalsplass', starts: 4, ends: null}},
    {type: 'Feature', id: '9', geometry: {type: 'Point', coordinates: [5.32, 60.39]}, properties: {name: 'C', starts: 1, ends: 1}},
  ]}, {type: 'FeatureCollection', features: [
    {type: 'Feature', geometry: {type: 'LineString', coordinates: [[5.35, 60.38], [5.33, 60.37]]}, properties: {origin: '220', destination: '5', trips: 3}},
  ]}, null, null, [null]);
  assert.deepEqual(ds.features[0], {id: '5', name: 'Solheimsviken', v: [10, 7], lon: 5.33, lat: 60.37});
  assert.equal(ds.features[1].v[1], null); // missing stays missing
  assert.deepEqual(ds.flows, [{o: '220', d: '5', n: 3}]);
  assert.ok(d3.geoArea(base.features[0]) < 0.001, 'hull is wound for d3 (small area, not the globe)');
});

test('RFC 7946 counter-clockwise polygons are rewound for d3', () => {
  const ccw = {type: 'FeatureCollection' as const, features: [{type: 'Feature' as const, properties: {}, geometry: {type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}}]};
  assert.ok(d3.geoArea(ccw.features[0]) > 2 * Math.PI);
  rewind(ccw);
  assert.ok(d3.geoArea(ccw.features[0]) < 0.001);
});
