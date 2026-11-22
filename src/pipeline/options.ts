import type {Dataset, MapType, MeasureDef, Region, Settings, Summary, Variant} from '../types.ts';
import {summariesFor} from './aggregate.ts';
import {palette} from './color.ts';

export const MAP_TYPES: [MapType, string][] = [
  ['symbol', 'Symbol'], ['choropleth', 'Choropleth'], ['cartogram', 'Cartogram'], ['heatmap', 'Heatmap'], ['flow', 'Flow'],
];
export const VARIANTS: Record<MapType, [Variant, string][]> = {
  symbol: [['circle', 'Circle'], ['square', 'Square']],
  choropleth: [['native', 'Native areas'], ['voronoi', 'Voronoi']],
  cartogram: [['dorling', 'Dorling'], ['demers', 'Demers'], ['noncontiguous', 'Non-contiguous'], ['contiguous', 'Contiguous']],
  heatmap: [['hex', 'Hex'], ['grid', 'Grid'], ['pixel', 'Pixel']],
  flow: [['straight', 'Straight'], ['arc', 'Arc'], ['arrow', 'Arrow']],
};
export const PROJECTIONS: Record<Region, [string, string][]> = {
  us: [['albersUsa', 'Albers USA'], ['albers', 'Albers'], ['mercator', 'Mercator'], ['equirect', 'Plate carrée']],
  bergen: [['utm', 'UTM 32N'], ['mercator', 'Mercator'], ['equirect', 'Plate carrée']],
  israel: [['tm', 'Transverse Merc.'], ['mercator', 'Mercator'], ['equirect', 'Plate carrée']],
};
export const CONTIGUOUS_LIMIT = 300;

export const initialSettings = (ds: Dataset): Settings => ({
  mapType: 'choropleth',
  variant: {symbol: 'circle', choropleth: ds.geometry === 'areas' ? 'native' : 'voronoi', cartogram: 'dorling', heatmap: 'hex', flow: 'arc'},
  level: ds.levels[0].id,
  summary: 'pooled',
  measure: ds.defaults?.measure ?? ds.measures[0].id,
  normalize: 'none',
  classing: 'quantile',
  bins: 5,
  scale: 'linear',
  palette: 'Oranges',
  midpoint: 'median',
  sizeMeasure: ds.defaults?.sizeMeasure ?? ds.measures.find(m => m.kind === 'count')?.id ?? '',
  maxSize: 24,
  cellSize: 18,
  topN: 150,
  opacity: 0.9,
  outline: 'thin',
  projection: ds.defaults?.projection ?? PROJECTIONS[ds.region][0][0],
  basemap: ds.defaults?.basemap ?? 'none',
  days: [0, 1, 2, 3, 4, 5, 6],
  hours: [0, 24],
  flowDirection: 'both',
  flowMode: 'gross',
});

/** Reasons keyed `control:value`; an empty string or absence means available. */
export type Reasons = Map<string, string>;

export interface Context {
  /** Number of units at each level. */
  unitCounts: Record<string, number>;
  /** Smallest displayed colour value (after structure is resolved), for log-scale availability. */
  minValue?: number;
  /** Unit currently selected on the map (flow direction filters need one). */
  focus?: string | null;
  /** Whether a CARTO basemap API key was configured at build time. */
  cartoKey?: boolean;
}

const isSize = (m: MeasureDef) => m.kind === 'count';

/** Why a measure cannot be the colour measure for a map type ('' if it can). */
export function colorMeasureReason(m: MeasureDef, mapType: MapType): string {
  if (mapType === 'heatmap' && m.kind === 'median') return 'Medians cannot be pooled inside bins. Choose a count or a share.';
  if (mapType === 'heatmap' && m.kind === 'category') return 'Categories cannot be pooled inside bins. Choose a count or a share.';
  return '';
}

/**
 * Resolve user settings into effective settings for a dataset, recording why options are unavailable.
 * Settings the user chose are kept; only effective values fall back when a choice no longer applies.
 */
export function resolve(ds: Dataset, s: Settings, ctx: Context): {e: Settings; why: Reasons} {
  const why: Reasons = new Map(Object.entries(ds.unavailable ?? {}));
  const e: Settings = {...s, variant: {...s.variant}};
  const points = ds.geometry === 'points';

  // Time filter: only for datasets whose flows carry weekday-hour slots.
  if (!ds.time) { why.set('time:', 'This dataset has no time of day or weekday.'); e.days = [0, 1, 2, 3, 4, 5, 6]; e.hours = [0, 24]; }

  // Map type
  if (!ds.flows?.length) why.set('mapType:flow', 'This dataset has no origin–destination table. Choose a dataset with trips.');
  if (why.get(`mapType:${e.mapType}`)) e.mapType = 'choropleth';

  // Level must exist in this dataset
  if (!ds.levels.some(l => l.id === e.level)) e.level = ds.levels[0].id;
  const nUnits = ctx.unitCounts[e.level] ?? 0;

  // Variants
  if (points) why.set('variant:native', 'Point data has no native areas. Voronoi derives one area per point.');
  if (points) why.set('variant:noncontiguous', 'Needs polygons to scale. Choose Dorling or Demers for point data.');
  if (points) why.set('variant:contiguous', 'Needs adjacent polygons. Choose Dorling or Demers for point data.');
  else if (nUnits > CONTIGUOUS_LIMIT) {
    const coarse = ds.levels.find(l => (ctx.unitCounts[l.id] ?? Infinity) <= CONTIGUOUS_LIMIT);
    why.set('variant:contiguous', `Rubber-sheet distortion is limited to ${CONTIGUOUS_LIMIT} units (this level has ${nUnits}).${coarse ? ` Choose ${coarse.label}.` : ''}`);
  }
  for (const [t, list] of Object.entries(VARIANTS) as [MapType, [Variant, string][]][]) {
    if (why.get(`variant:${e.variant[t]}`)) e.variant[t] = list.find(([v]) => !why.get(`variant:${v}`))![0];
  }

  // Colour measure
  const measures = ds.measures;
  for (const m of measures) { const r = colorMeasureReason(m, e.mapType); if (r) why.set(`measure:${m.id}`, r); }
  if (e.mapType === 'flow') for (const m of measures) why.set(`measure:${m.id}`, 'Flows are coloured by trip volume.');
  let m = measures.find(x => x.id === e.measure) ?? measures[0];
  if (why.get(`measure:${m.id}`) && e.mapType !== 'flow') m = measures.find(x => !why.get(`measure:${x.id}`)) ?? m;
  e.measure = m.id;

  // Summary
  const sums = summariesFor(m);
  const finest = ds.levels[0].id === e.level;
  for (const k of ['pooled', 'weighted', 'mean', 'median', 'min', 'max'] as Summary[]) {
    if (!sums.includes(k)) why.set(`summary:${k}`, m.kind === 'median' ? 'Medians cannot be pooled; choose how member medians are combined.' : m.kind === 'ratio' ? 'Shares are recomputed or summarized from member units.' : 'Counts are always summed.');
    else if (finest) why.set(`summary:${k}`, 'Each unit is a single feature at this level. Choose a coarser level to combine units.');
    else if (e.mapType === 'heatmap' && k !== 'pooled') why.set(`summary:${k}`, 'Heatmap bins pool numerators and denominators.');
  }
  if (!sums.includes(e.summary) || why.get(`summary:${e.summary}`)) e.summary = sums[0];

  // Normalization by area
  const areaMap = e.mapType === 'choropleth' || e.mapType === 'heatmap';
  const normReason = !(m.kind === 'count' || m.kind === 'signed') ? 'Only counts can be divided by area.' : !areaMap ? 'Per km² needs areas or bins. Choose Choropleth or Heatmap.' : '';
  if (normReason) { why.set('normalize:area', normReason); e.normalize = 'none'; }

  // Classing, scale, palette
  const cat = m.kind === 'category';
  if (cat) {
    for (const c of ['continuous', 'equal', 'quantile', 'jenks']) why.set(`classing:${c}`, 'Categories are not classed.');
    for (const c of ['linear', 'log', 'sqrt']) why.set(`scale:${c}`, 'Categories have no numeric scale.');
  }
  if (e.classing === 'continuous' || cat) for (const b of [3, 5, 7, 9]) why.set(`bins:${b}`, cat ? 'Categories are not classed.' : 'Continuous colour has no bins. Choose a classing method.');
  if (e.classing === 'quantile' && !cat) for (const c of ['linear', 'log', 'sqrt']) why.set(`scale:${c}`, 'Quantile classes depend only on rank order, not on the scale.');
  if (ctx.minValue != null && ctx.minValue <= 0) why.set('scale:log', 'Log scales need values above zero.');
  if (why.get(`scale:${e.scale}`)) e.scale = 'linear';
  for (const p of ['Oranges', 'Blues', 'Greens', 'Purples', 'YlGnBu', 'Viridis', 'Magma', 'RdBu', 'PuOr', 'BrBG']) if (cat) why.set(`palette:${p}`, 'Categories need a categorical palette.');
  for (const p of ['Tableau', 'Set2']) if (!cat) why.set(`palette:${p}`, 'Categorical palettes are for category measures.');
  if (why.get(`palette:${e.palette}`)) e.palette = cat ? 'Tableau' : m.kind === 'signed' ? 'RdBu' : 'Oranges';
  if (palette(e.palette).family !== 'diverging') for (const k of ['median', 'mean', 'zero']) why.set(`midpoint:${k}`, 'A midpoint applies to diverging palettes.');

  // Size
  for (const x of measures) if (!isSize(x)) why.set(`size:${x.id}`, x.kind === 'signed' ? 'Net values can be negative; sizes cannot.' : 'Sizes encode non-negative counts.');
  if (e.mapType === 'cartogram') why.set('size:', 'A cartogram needs a size measure.');
  const sm = measures.find(x => x.id === e.sizeMeasure);
  if ((e.sizeMeasure && (!sm || !isSize(sm))) || why.get(`size:${e.sizeMeasure}`)) e.sizeMeasure = measures.find(isSize)?.id ?? '';

  // Flow direction and mode
  if (e.mapType !== 'flow') for (const k of ['both', 'out', 'in', 'gross', 'net']) why.set(`flow:${k}`, 'Applies to Flow maps.');
  else if (!ctx.focus) for (const k of ['both', 'out', 'in']) why.set(`flow:${k}`, 'Click a station on the map to show only its flows.');
  if (why.get(`flow:${e.flowDirection}`) && e.mapType === 'flow' && ctx.focus) e.flowDirection = 'both';
  if (e.mapType === 'flow' && ctx.focus && e.flowMode === 'net' && e.flowDirection !== 'both') why.set('flow:net', 'Net compares both directions of each pair. Choose Both.');
  if (why.get(`flow:${e.flowMode}`)) e.flowMode = 'gross';

  // Projection must belong to the region
  if (!PROJECTIONS[ds.region].some(([p]) => p === e.projection)) e.projection = PROJECTIONS[ds.region][0][0];

  // Web map tiles are Web Mercator: they only line up with the Mercator projection.
  if (e.projection !== 'mercator') for (const b of ['osm', 'light', 'dark', 'voyager']) why.set(`basemap:${b}`, 'Web map tiles use Web Mercator. Choose the Mercator projection.');
  else if (!ctx.cartoKey) for (const b of ['light', 'dark', 'voyager']) why.set(`basemap:${b}`, 'CARTO tiles need a free API key (VITE_CARTO_KEY, see README). OSM works without one.');
  if (why.get(`basemap:${e.basemap}`)) e.basemap = 'none';
  return {e, why};
}
