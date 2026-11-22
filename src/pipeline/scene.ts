import * as d3 from 'd3';
import type {Dataset, LevelDef, MeasureDef, Settings, Unit} from '../types.ts';
import {measureValue, SUMMARY_LABELS} from './aggregate.ts';
import {colorScale, NO_DATA, type ColorScale} from './color.ts';
import {dougenik, flowPath, gridBins, hexBins, olsonScales, polygonPath, voronoiCells, densityGrid} from './geometry.ts';
import {MAP_TYPES, PROJECTIONS, VARIANTS} from './options.ts';
import {timeText} from './time.ts';

type XY = [number, number];

export interface Mark {
  id: string;
  shape: 'path' | 'circle' | 'rect';
  d?: string;
  x?: number; y?: number; r?: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  /** Scale about (x, y) for non-contiguous cartograms. */
  scale?: number;
  title: string;
  lines: string[];
  value: number | null;
  /** Flow-map node: clickable focus, keeps its own fill. */
  node?: boolean;
}

export interface SizeLegend { kind: 'circle' | 'square' | 'width'; items: {label: string; size: number}[] }

export interface Scene {
  marks: Mark[];
  color: ColorScale;
  size?: SizeLegend;
  raster?: {data: Float64Array; gw: number; gh: number; cell: number; max: number};
  /** Draw the base map underneath (true) and clip derived geometry to it. */
  title: string;
  subtitle: string;
  derived?: string;
}

export interface SceneInput {
  ds: Dataset;
  units: Unit[];
  level: LevelDef;
  s: Settings;
  project: (lonlat: XY) => XY | null;
  invert: (xy: XY) => XY | null;
  path: d3.GeoPath;
  width: number;
  height: number;
  /** Dorling/Demers positions [x0,y0,x1,y1,…] for the units returned by cartogramStart; centroids when absent. */
  layout?: Float64Array | null;
  /** Selected unit id; flows can be restricted to those leaving or entering it. */
  focus?: string | null;
}

/** Starting marks for Dorling/Demers: unit index, centroid position and radius (half-side for squares). */
export function cartogramStart(inp: SceneInput) {
  const {ds, units, s, project, width, height} = inp;
  const sizeM = ds.measures.find(x => x.id === s.sizeMeasure);
  const sizeVals = units.map(u => (sizeM ? measureValue(ds, sizeM, u, 'pooled') : 1));
  const square = s.variant.cartogram === 'demers';
  // Scale so total mark area ≈ 35% of the viewport, capped by maxSize×3 for the largest.
  const tot = d3.sum(sizeVals, v => v ?? 0) || 1;
  const vmax = d3.max(sizeVals, v => v ?? 0) || 1;
  const kk = Math.min(Math.sqrt((0.35 * width * height) / (Math.PI * tot)), (s.maxSize * 3) / Math.sqrt(vmax)) * (square ? Math.sqrt(Math.PI) / 2 : 1);
  const start: {i: number; x: number; y: number; r: number}[] = [];
  units.forEach((u, i) => { const p = project([u.lon, u.lat]); if (p) start.push({i, x: p[0], y: p[1], r: Math.max(0.6, kk * Math.sqrt(Math.max(0, sizeVals[i] ?? 0)))}); });
  return {start, kk, vmax, square};
}

/** Cache key for a Dorling/Demers layout: everything that moves marks, nothing that only colours them. */
export const layoutKey = (inp: Pick<SceneInput, 's' | 'width' | 'height' | 'ds'>) =>
  [inp.ds.id, inp.s.variant.cartogram, inp.s.level, inp.s.sizeMeasure, inp.s.projection, inp.width, inp.height, inp.s.maxSize, inp.s.days.join(''), inp.s.hours.join('-')].join('|');

const KM2 = 6371.0088 ** 2;

export function formatValue(m: MeasureDef | undefined, v: number | null, perArea = false): string {
  if (v == null || !Number.isFinite(v)) return 'No data';
  if (perArea) return d3.format(v < 10 ? ',.2f' : ',.0f')(v) + ' /km²';
  if (m?.format === 'percent') return d3.format('.1%')(v);
  if (m?.format === 'currency') return '$' + d3.format(',.0f')(v);
  return Math.abs(v) >= 100 ? d3.format(',.0f')(v) : d3.format(',.3~f')(v);
}

/** km² represented by a screen polygon, via the projection inverse. */
function polyKm2(poly: XY[], invert: SceneInput['invert']): number | undefined {
  const ring = poly.map(invert);
  if (ring.some(p => !p)) return undefined;
  const closed = [...(ring as XY[]), ring[0] as XY];
  // d3.geoArea expects clockwise exterior rings in screen-space order after inversion (y flips), so take the smaller solution.
  const a = d3.geoArea({type: 'Polygon', coordinates: [closed]});
  return Math.min(a, 4 * Math.PI - a) * KM2;
}

export function buildScene(inp: SceneInput): Scene {
  const {ds, units, level, s, project, invert, path, width, height} = inp;
  const m = ds.measures.find(x => x.id === s.measure)!;
  const sizeM = ds.measures.find(x => x.id === s.sizeMeasure);
  const variant = s.variant[s.mapType];
  const perArea = s.normalize === 'area';
  const cats = m.kind === 'category' ? (m.parts ?? []).map(p => ds.categories?.[p]?.label ?? p) : undefined;
  const pts: (XY | null)[] = units.map(u => project([u.lon, u.lat]));
  const raw = units.map(u => measureValue(ds, m, u, s.summary));
  const sizeVals = units.map(u => (sizeM ? measureValue(ds, sizeM, u, 'pooled') : 1));
  const name = (u: Unit) => u.name;
  const levelText = `${level.label}${units.length ? ` (${d3.format(',')(units.length)})` : ''}`;
  const summaryText = m.kind === 'ratio' || m.kind === 'median' ? ` · ${SUMMARY_LABELS[s.summary].toLowerCase()}` : '';
  const typeLabel = MAP_TYPES.find(([t]) => t === s.mapType)![1];
  const variantLabel = VARIANTS[s.mapType].find(([v]) => v === variant)![1];
  const projLabel = PROJECTIONS[ds.region].find(([p]) => p === s.projection)?.[1] ?? s.projection;
  const classText = m.kind === 'category' ? 'categorical' : s.classing === 'continuous' ? `continuous ${s.scale}` : `${s.classing === 'jenks' ? 'natural breaks' : s.classing === 'equal' ? 'equal interval' : 'quantile'} · ${s.bins} classes${s.classing !== 'quantile' && s.scale !== 'linear' ? ` · ${s.scale}` : ''}`;
  const when = ds.time ? timeText(s) : '';
  const title = (s.mapType === 'flow' ? `Trips between ${level.label.toLowerCase()} units` : `${m.label}${perArea ? ' per km²' : ''} · ${level.label}${summaryText}`) + (when ? ` · ${when}` : '');
  let subtitle = `${typeLabel} (${variantLabel.toLowerCase()}) · ${levelText} · ${s.mapType === 'flow' ? `top ${s.topN} flows` : classText} · ${projLabel}`;

  const tip = (u: Unit, v: number | null, extra: string[] = []) => {
    const lines = [`${m.label}${perArea ? ' per km²' : ''}: ${cats && v != null ? cats[v] : formatValue(m, v, perArea)}`];
    if (m.kind === 'ratio') lines.push(`${formatValue(undefined, u.sums[m.num!])} of ${formatValue(undefined, u.sums[m.den!])}`);
    if (u.members.length > 1) lines.push(`${u.members.length} features combined`);
    return [...lines, ...extra];
  };
  const sizeScale = (max: number) => {
    const vmax = d3.max(sizeVals, v => v ?? 0) || 1;
    // Symbol area is proportional to value; flow width is proportional to trips.
    return s.mapType === 'flow'
      ? d3.scaleLinear().domain([0, vmax]).range([0, max])
      : d3.scaleSqrt().domain([0, vmax]).range([0, max]);
  };
  const sizeLegend = (sc: d3.ScaleContinuousNumeric<number, number>, kind: SizeLegend['kind']): SizeLegend | undefined => {
    if (!sizeM) return undefined;
    const vmax = sc.domain()[1];
    const nice = d3.ticks(0, vmax, 3).filter(t => t > 0).slice(-3);
    return {kind, items: nice.map(t => ({label: formatValue(sizeM, t), size: sc(t)}))};
  };

  // ---------- Flow ----------
  if (s.mapType === 'flow') {
    const unitOf = new Map<string, number>();
    units.forEach((u, i) => u.members.forEach(f => unitOf.set(f.id, i)));
    const od = new Map<string, {a: number; b: number; n: number}>();
    const nodeOut = new Float64Array(units.length), nodeIn = new Float64Array(units.length);
    for (const f of ds.flows ?? []) {
      const a = unitOf.get(f.o), b = unitOf.get(f.d);
      if (a == null || b == null || !(f.n > 0)) continue;
      nodeOut[a] += f.n; nodeIn[b] += f.n;
      if (a === b) continue; // round trips and trips within one cluster have no line
      const k = `${a}>${b}`; const r = od.get(k) ?? {a, b, n: 0}; r.n += f.n; od.set(k, r);
    }
    let all = [...od.values()];
    if (s.flowMode === 'net') {
      const net = new Map<string, {a: number; b: number; n: number}>();
      for (const r of all) {
        const lo = Math.min(r.a, r.b), hi = Math.max(r.a, r.b), k = `${lo}|${hi}`;
        const x = net.get(k) ?? {a: lo, b: hi, n: 0};
        x.n += r.a === lo ? r.n : -r.n; net.set(k, x);
      }
      all = [...net.values()].filter(x => x.n !== 0).map(x => (x.n > 0 ? x : {a: x.b, b: x.a, n: -x.n}));
    }
    const fi = inp.focus ? units.findIndex(u => u.id === inp.focus) : -1;
    // A selected station restricts flows to those touching it.
    if (fi >= 0) all = all.filter(r => (s.flowDirection === 'out' ? r.a === fi : s.flowDirection === 'in' ? r.b === fi : r.a === fi || r.b === fi));
    all.sort((x, y) => y.n - x.n);
    const flows = all.slice(0, s.topN).reverse();
    const vals = flows.map(f => f.n);
    const color = colorScale(vals, s);
    const wScale = d3.scaleLinear().domain([0, d3.max(vals) || 1]).range([0, s.maxSize / 2]);
    const marks: Mark[] = [];
    for (const f of flows) {
      const a = pts[f.a], b = pts[f.b];
      if (!a || !b) continue;
      const w = Math.max(0.5, wScale(f.n));
      marks.push({id: `${units[f.a].id}>${units[f.b].id}`, shape: 'path', d: flowPath(a, b, variant as 'straight', w),
        fill: variant === 'arrow' ? color.color(f.n) : 'none', stroke: variant === 'arrow' ? 'none' : color.color(f.n), strokeWidth: variant === 'arrow' ? 0 : w,
        title: `${name(units[f.a])} → ${name(units[f.b])}`, lines: [`${d3.format(',')(f.n)} ${s.flowMode === 'net' ? 'more trips than the reverse direction' : f.n === 1 ? 'trip' : 'trips'}`], value: f.n});
    }
    // Nodes: one per unit, sized by trips leaving + arriving; click a node to focus flows on it.
    const nScale = d3.scaleSqrt().domain([0, d3.max(units, (_, i) => nodeOut[i] + nodeIn[i]) || 1]).range([1.5, 7]);
    units.forEach((u, i) => {
      const p = pts[i]; if (!p) return;
      marks.push({id: u.id, shape: 'circle', x: p[0], y: p[1], r: nScale(nodeOut[i] + nodeIn[i]), fill: i === fi ? '#d94722' : '#373335', stroke: '#fff', strokeWidth: 0.8, node: true,
        title: u.name, lines: [`${d3.format(',')(nodeOut[i])} trips leaving`, `${d3.format(',')(nodeIn[i])} trips arriving`, i === fi ? 'Click again to show all flows' : 'Click to show only this station’s flows'], value: null});
    });
    const focusText = fi >= 0 ? ` · ${s.flowDirection === 'out' ? 'leaving' : s.flowDirection === 'in' ? 'arriving at' : 'to and from'} ${units[fi].name}` : '';
    subtitle += `${focusText} · ${s.flowMode} · ${d3.format(',')(all.length)} flows, within-unit trips excluded`;
    return {marks, color, title, subtitle, size: {kind: 'width', items: d3.ticks(0, wScale.domain()[1], 3).filter(t => t > 0 && Number.isInteger(t)).slice(-3).map(t => ({label: `${d3.format(',')(t)} trip${t === 1 ? '' : 's'}`, size: Math.max(0.5, wScale(t))}))}};
  }

  // ---------- Heatmap ----------
  if (s.mapType === 'heatmap') {
    const idx = units.map((_, i) => i).filter(i => pts[i]);
    const P = idx.map(i => pts[i]!) as XY[];
    const binValue = (ids: number[], areaKm2?: number) => {
      const us = ids.map(j => units[idx[j]]);
      if (m.kind === 'ratio') { const n = d3.sum(us, u => u.sums[m.num!] || 0), d = d3.sum(us, u => u.sums[m.den!] || 0); return d > 0 ? n / d : null; }
      const t = d3.sum(us, u => u.sums[m.field!] || 0);
      return perArea ? (areaKm2 ? t / areaKm2 : null) : t;
    };
    if (variant === 'pixel') {
      const weights = idx.map(i => (m.kind === 'ratio' ? units[i].sums[m.num!] || 0 : Math.max(0, units[i].sums[m.field!] || 0)));
      const cell = 3;
      const g = densityGrid(P, weights, width, height, cell, s.cellSize);
      const max = d3.max(g.data) || 1;
      const color = colorScale([0, max], {...s, classing: 'continuous', scale: s.scale === 'log' ? 'sqrt' : s.scale});
      subtitle = `${typeLabel} (kernel density) · ${levelText} at centroids · bandwidth ${s.cellSize}px · ${projLabel}`;
      return {marks: [], color, raster: {...g, cell, max}, title: `${m.kind === 'ratio' ? m.label.replace(/ share$/, '') + ' (numerator)' : m.label} density · ${level.label} centroids`, subtitle};
    }
    const bins = variant === 'hex' ? hexBins(P, s.cellSize / 1.7) : gridBins(P, s.cellSize);
    const binKm2 = bins.map(b => {
      const r = Math.sqrt(b.areaPx) / 2;
      return polyKm2([[b.x - r, b.y - r], [b.x + r, b.y - r], [b.x + r, b.y + r], [b.x - r, b.y + r]], invert);
    });
    const vals = bins.map((b, i) => binValue(b.ids, binKm2[i]));
    const color = colorScale(vals, s);
    const marks = bins.map((b, i) => ({id: `bin${i}`, shape: 'path' as const, d: b.path, fill: color.color(vals[i]), title: `${b.ids.length} ${level.label.toLowerCase()} unit${b.ids.length > 1 ? 's' : ''} in bin`,
      lines: [`${m.label}${perArea ? ' per km²' : ''}: ${formatValue(m, vals[i], perArea)}`, b.ids.slice(0, 3).map(j => units[idx[j]].name).join(', ') + (b.ids.length > 3 ? '…' : '')], value: vals[i]}));
    subtitle = `${typeLabel} (${variantLabel.toLowerCase()} ${s.cellSize}px) · ${levelText} at centroids · ${classText} · ${projLabel}`;
    return {marks, color, title, subtitle, derived: `${bins.length} bins`};
  }

  // ---------- Areas: native or Voronoi ----------
  const needCells = s.mapType === 'choropleth' && variant === 'voronoi';
  const cells = needCells ? voronoiCells(pts.map(p => p ?? [-1e6, -1e6]) as XY[], [0, 0, width, height]) : [];
  const areaKm2 = units.map((u, i) => (needCells ? (cells[i] ? polyKm2(cells[i]!, invert) : undefined) : u.areaKm2));
  const display = raw.map((v, i) => (perArea && v != null ? (areaKm2[i] ? v / areaKm2[i]! : null) : v));
  const color = colorScale(display, s, cats);

  if (s.mapType === 'choropleth') {
    const marks: Mark[] = [];
    units.forEach((u, i) => {
      const d = needCells ? (cells[i] && pts[i] ? polygonPath(cells[i]!) : '') : u.shape ? path(u.shape) ?? '' : '';
      if (!d) return;
      marks.push({id: u.id, shape: 'path', d, fill: color.color(display[i]), title: u.name, lines: tip(u, display[i]), value: display[i]});
    });
    return {marks, color, title, subtitle, derived: needCells ? `Voronoi cells of ${units.length} points` : undefined};
  }

  if (s.mapType === 'symbol') {
    const sc = sizeScale(s.maxSize);
    const order = d3.range(units.length).filter(i => pts[i]).sort((a, b) => (sizeVals[b] ?? 0) - (sizeVals[a] ?? 0));
    const marks: Mark[] = order.map(i => {
      const r = sizeM ? Math.max(0, sc(sizeVals[i] ?? 0)) : s.maxSize / 4;
      const [x, y] = pts[i]!;
      return {id: units[i].id, shape: variant === 'square' ? 'rect' : 'circle', x, y, r, fill: color.color(display[i]), stroke: '#fff', strokeWidth: 0.5,
        title: units[i].name, lines: tip(units[i], display[i], sizeM && sizeM.id !== m.id ? [`${sizeM.label}: ${formatValue(sizeM, sizeVals[i])}`] : []), value: display[i]};
    });
    if (sizeM) subtitle += ` · area ∝ ${sizeM.label.toLowerCase()}`;
    return {marks, color, title, subtitle, size: sizeLegend(sc, variant === 'square' ? 'square' : 'circle')};
  }

  // ---------- Cartograms ----------
  const sizeLine = (i: number) => (sizeM && sizeM.id !== m.id ? [`${sizeM.label}: ${formatValue(sizeM, sizeVals[i])}`] : []);
  subtitle += ` · area ∝ ${sizeM?.label.toLowerCase() ?? 'size'}`;
  if (variant === 'dorling' || variant === 'demers') {
    const {start, kk, vmax, square} = cartogramStart(inp);
    const L = inp.layout && inp.layout.length === start.length * 2 ? inp.layout : null;
    const marks: Mark[] = start.map((p, j) => {
      const i = p.i;
      return {id: units[i].id, shape: square ? 'rect' : 'circle', x: L ? L[2 * j] : p.x, y: L ? L[2 * j + 1] : p.y, r: p.r, fill: color.color(display[i]), stroke: '#fff', strokeWidth: 0.6, title: units[i].name, lines: [...tip(units[i], display[i]), ...sizeLine(i)], value: display[i]};
    });
    const sc = d3.scaleSqrt().domain([0, vmax]).range([0, kk * Math.sqrt(vmax)]);
    return {marks, color, title, subtitle, size: sizeLegend(sc, square ? 'square' : 'circle')};
  }
  if (variant === 'noncontiguous') {
    const areasPx = units.map(u => (u.shape ? path.area(u.shape) : 0));
    const k = olsonScales(sizeVals.map(v => v ?? 0), areasPx, 0.95);
    subtitle += ' · true size at 95th-percentile density';
    const marks: Mark[] = [];
    units.forEach((u, i) => {
      if (!u.shape) return; const d = path(u.shape); if (!d) return;
      const [x, y] = path.centroid(u.shape);
      marks.push({id: u.id, shape: 'path', d, x, y, scale: k[i], fill: color.color(display[i]), title: u.name, lines: [...tip(u, display[i]), ...sizeLine(i), `Drawn at ${d3.format('.0%')(k[i] ** 2)} of its area`], value: display[i]});
    });
    return {marks, color, title, subtitle};
  }
  // Contiguous: project rings, distort, draw.
  const rings: XY[][][] = units.map(u => {
    if (!u.shape) return [];
    const polys = u.shape.geometry.type === 'Polygon' ? [u.shape.geometry.coordinates] : u.shape.geometry.coordinates;
    return polys.flatMap(poly => poly.map(ring => ring.map(c => project(c as XY)).filter((p): p is XY => !!p)).filter(r => r.length > 2));
  });
  const out = dougenik(rings, sizeVals.map(v => Math.max(1e-9, v ?? 0)));
  const marks: Mark[] = out.map((rs, i) => ({id: units[i].id, shape: 'path' as const, d: rs.map(polygonPath).join(''), fill: color.color(display[i]), title: units[i].name, lines: [...tip(units[i], display[i]), ...sizeLine(i)], value: display[i]}))
    .filter(mk => mk.d);
  return {marks, color, title, subtitle, derived: 'Dougenik rubber-sheet, 8 iterations'};
}

export {NO_DATA};
