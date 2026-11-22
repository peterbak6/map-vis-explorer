import {test} from 'node:test';
import assert from 'node:assert/strict';
import {aggregate, measureValue} from './aggregate.ts';
import {breaks, jenks} from './classify.ts';
import {colorScale} from './color.ts';
import {initialSettings, resolve} from './options.ts';
import {gridBins, hexBins, olsonScales, separate, flowPath} from './geometry.ts';
import type {Dataset} from '../types.ts';

const ds: Dataset = {
  id: 't', title: 'T', subtitle: '', region: 'us', geometry: 'points', base: {file: '', object: ''},
  fields: ['pop', 'hisp', 'inc'],
  levels: [{id: 'unit', label: 'Unit'}, {id: 'grp', label: 'Group', parent: 'g'}],
  parentNames: {g: {A: 'Alpha'}},
  measures: [
    {id: 'pop', label: 'Pop', kind: 'count', field: 'pop'},
    {id: 'share', label: 'Share', kind: 'ratio', num: 'hisp', den: 'pop'},
    {id: 'inc', label: 'Income', kind: 'median', field: 'inc', weight: 'pop'},
  ],
  features: [
    {id: 'a', name: 'a', parents: {g: 'A'}, lon: 0, lat: 0, v: [1000, 900, 20]},
    {id: 'b', name: 'b', parents: {g: 'A'}, lon: 1, lat: 0, v: [10, 0, 80]},
    {id: 'c', name: 'c', parents: {g: 'A'}, lon: 2, lat: 0, v: [90, null, null]},
  ],
  source: '', attribution: '',
};

test('counts sum and nulls are not zero', () => {
  const [u] = aggregate(ds, ds.levels[1]);
  assert.equal(u.name, 'Alpha');
  assert.equal(u.sums.pop, 1100);
  assert.equal(u.sums.hisp, 900);
});

test('ratios pool numerators and denominators unless a member summary is chosen', () => {
  const [u] = aggregate(ds, ds.levels[1]);
  const m = ds.measures[1];
  assert.equal(measureValue(ds, m, u, 'pooled'), 900 / 1100);
  assert.equal(measureValue(ds, m, u, 'mean'), (0.9 + 0) / 2); // c has no numerator → excluded, not zero
  assert.equal(measureValue(ds, m, u, 'max'), 0.9);
});

test('medians are weighted approximations, never sums', () => {
  const [u] = aggregate(ds, ds.levels[1]);
  const v = measureValue(ds, ds.measures[2], u, 'weighted')!;
  assert.ok(Math.abs(v - (20 * 1000 + 80 * 10) / 1010) < 1e-9);
  assert.equal(measureValue(ds, ds.measures[2], u, 'median'), 50);
});

test('classing: quantile, equal, natural breaks', () => {
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.deepEqual(breaks(v, 'equal', 3, 'linear'), [4, 7]);
  assert.equal(breaks(v, 'quantile', 5, 'linear').length, 4);
  assert.deepEqual(jenks([1, 1, 2, 10, 11, 12, 30, 31], 3), [10, 30]);
  assert.deepEqual(breaks(v, 'continuous', 5, 'linear'), []);
  const log = breaks([1, 10, 100, 1000], 'equal', 3, 'log');
  assert.ok(Math.abs(log[0] - 10) < 1e-9 && Math.abs(log[1] - 100) < 1e-9);
});

test('diverging colours are centred on the midpoint', () => {
  const s = {...initialSettings(ds), palette: 'RdBu', classing: 'continuous' as const, midpoint: 'zero' as const};
  const c = colorScale([-5, 0, 10], s);
  assert.equal(c.legend.mid, 0);
  assert.equal(c.color(0), c.color(0));
});

test('availability rules explain disabled options', () => {
  const s = initialSettings(ds);
  const {e, why} = resolve(ds, {...s, mapType: 'flow'}, {unitCounts: {unit: 3, grp: 1}});
  assert.equal(e.mapType, 'choropleth');
  assert.match(why.get('mapType:flow')!, /origin–destination/);
  assert.match(why.get('variant:native')!, /Voronoi/);
  const h = resolve(ds, {...s, mapType: 'heatmap', measure: 'inc'}, {unitCounts: {unit: 3, grp: 1}});
  assert.equal(h.e.measure, 'pop');
  const sz = resolve(ds, {...s, mapType: 'cartogram', sizeMeasure: 'share'}, {unitCounts: {unit: 3, grp: 1}});
  assert.equal(sz.e.sizeMeasure, 'pop');
  const cg = resolve(ds, {...s, mapType: 'cartogram', projection: 'mercator', basemap: 'osm'}, {unitCounts: {unit: 3, grp: 1}});
  assert.equal(cg.e.basemap, 'none');
  assert.match(cg.why.get('basemap:osm')!, /Cartograms/);
  const lg = resolve(ds, {...s, classing: 'equal', scale: 'log'}, {unitCounts: {unit: 3}, minValue: 0});
  assert.equal(lg.e.scale, 'linear');
});

test('binning keeps every point exactly once', () => {
  const pts: [number, number][] = Array.from({length: 500}, (_, i) => [(i * 37) % 300, (i * 91) % 200]);
  for (const bins of [hexBins(pts, 12), gridBins(pts, 20)]) {
    const ids = bins.flatMap(b => b.ids).sort((a, b) => a - b);
    assert.deepEqual(ids, pts.map((_, i) => i));
  }
});

test('cartogram helpers', () => {
  assert.deepEqual(olsonScales([100, 25], [1, 1]), [1, 0.5]);
  assert.deepEqual(olsonScales([100, 25], [1, 1], 0), [2, 1]);
  const out = separate([{x: 0, y: 0, r: 5}, {x: 1, y: 0, r: 5}], 'circle', 0, 300);
  assert.ok(Math.hypot(out[0].x - out[1].x, out[0].y - out[1].y) >= 9.9);
  const sq = separate([{x: 0, y: 0, r: 5}, {x: 1, y: 1, r: 5}], 'square', 0, 300);
  assert.ok(Math.max(Math.abs(sq[0].x - sq[1].x), Math.abs(sq[0].y - sq[1].y)) >= 9.9);
  assert.match(flowPath([0, 0], [10, 0], 'arrow', 4), /Z$/);
});
