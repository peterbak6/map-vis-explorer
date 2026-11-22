import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as d3 from 'd3';
import {applyTime, timeText} from './time.ts';
import {aggregate} from './aggregate.ts';
import {buildScene} from './scene.ts';
import {initialSettings, resolve} from './options.ts';
import type {Dataset} from '../types.ts';

// Slot = weekday*24 + hour. 8 = Mon 08h, 5*24+14 = 134 = Sat 14h.
const ds: Dataset = {
  id: 't', title: 'T', subtitle: '', region: 'bergen', geometry: 'points',
  fields: ['starts', 'ends', 'net', 'durationMin', 'roundTrips'],
  levels: [{id: 'station', label: 'Station'}],
  measures: [{id: 'starts', label: 'Starts', kind: 'count', field: 'starts'}],
  time: {slots: 'slots', slotFields: ['trips', 'durationMin'], basis: 'start'},
  flowDerived: {starts: 'out:trips', ends: 'in:trips', net: 'net:trips', durationMin: 'out:durationMin', roundTrips: 'self:trips'},
  features: [
    {id: 'A', name: 'A', lon: 5.30, lat: 60.38, v: [0, 0, 0, 0, 0]},
    {id: 'B', name: 'B', lon: 5.34, lat: 60.39, v: [0, 0, 0, 0, 0]},
  ],
  flows: [
    {o: 'A', d: 'B', n: 13, slots: [[8, 10, 50], [134, 3, 30]]},
    {o: 'B', d: 'A', n: 4, slots: [[8, 4, 20]]},
    {o: 'A', d: 'A', n: 2, slots: [[134, 2, 40]]},
  ],
  source: '', attribution: '',
};

test('time filter sums slots and re-derives station fields', () => {
  const all = applyTime(ds, {days: [0, 1, 2, 3, 4, 5, 6], hours: [0, 24]});
  assert.deepEqual(all.features[0].v, [15, 6, 9, 120, 2]); // A: out 13+2, in 4+2, net, minutes, round trips
  const mon = applyTime(ds, {days: [0, 1, 2, 3, 4], hours: [7, 9]});
  assert.deepEqual(mon.flows!.map(f => f.n), [10, 4, 0]);
  assert.deepEqual(mon.features[1].v.slice(0, 3), [4, 10, -6]);
  const sat = applyTime(ds, {days: [5], hours: [0, 24]});
  assert.equal(sat.features[0].v[4], 2);
});

test('time text', () => {
  assert.equal(timeText({days: [0, 1, 2, 3, 4, 5, 6], hours: [0, 24]}), '');
  assert.equal(timeText({days: [0, 1, 2, 3, 4], hours: [7, 9]}), 'Mon–Fri · 07–09');
  assert.equal(timeText({days: [5, 6], hours: [0, 24]}), 'Sat, Sun');
});

test('net flows keep only the dominant direction; direction needs a focus', () => {
  const s = {...initialSettings(ds), mapType: 'flow' as const, flowMode: 'net' as const};
  const units = aggregate(ds, ds.levels[0]);
  const proj = d3.geoMercator().fitSize([400, 300], {type: 'MultiPoint', coordinates: [[5.30, 60.38], [5.34, 60.39]]});
  const scene = buildScene({ds, units, level: ds.levels[0], s, path: d3.geoPath(proj), width: 400, height: 300,
    project: p => proj(p) as [number, number], invert: p => proj.invert!(p) as [number, number]});
  const lines = scene.marks.filter(m => !m.node);
  assert.deepEqual(lines.map(m => [m.id, m.value]), [['A>B', 9]]);
  assert.equal(scene.marks.filter(m => m.node).length, 2);
  const r = resolve(ds, {...s, flowDirection: 'out'}, {unitCounts: {station: 2}, focus: null});
  assert.equal(r.e.flowDirection, 'out'); // kept as the user's choice; it applies once a station is selected
  assert.match(r.why.get('flow:out')!, /Click a station/);
});
