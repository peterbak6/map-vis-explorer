import type {Feature, MultiPolygon, Polygon} from 'geojson';

/** Shared description of a dataset (see DATA.md). */
interface DatasetCommon {
  id: string;
  title: string;
  subtitle: string;
  region: Region;
  geometry: 'areas' | 'points';
  /** Numeric feature properties used by measures. */
  fields: string[];
  levels: LevelDef[];
  measures: MeasureDef[];
  /** Party or group names for category measures, keyed by field. */
  categories?: Record<string, {label: string; color?: string}>;
  defaults?: {measure?: string; sizeMeasure?: string; projection?: string; basemap?: Basemap};
  /** Flows carry values per weekday-hour slot (slot = weekday × 24 + hour, weekday 0 = Monday). */
  time?: {slots: string; slotFields: string[]; basis: string};
  /** Feature fields recomputed from (time-filtered) flows: `out:`, `in:`, `self:` or `net:` + slot field. */
  flowDerived?: Record<string, string>;
  /** Controls this dataset does not support, keyed `control:value`, with the reason shown to students. */
  unavailable?: Record<string, string>;
  source: string;
  attribution: string;
  note?: string;
}

/**
 * Dataset description file public/data/<id>.json. Geometry and values live in standard GeoJSON
 * (RFC 7946) files it references.
 */
export interface DatasetMeta extends DatasetCommon {
  /** GeoJSON FeatureCollection of Points or (Multi)Polygons; numeric `fields` are feature properties. */
  features: string;
  /** Optional GeoJSON FeatureCollection of LineStrings with `origin`, `destination` and `flowField` properties. */
  flows?: string;
  flowField?: string;
  /** Optional GeoJSON drawn as context and used to clip derived geometry (e.g. land or a city boundary). */
  base?: string;
  /** Optional GeoJSON whose boundaries are drawn above choropleths (e.g. states). */
  outline?: string;
}

/** A dataset after loading: the in-memory model the pipeline works on. */
export interface Dataset extends DatasetCommon {
  features: RawFeature[];
  flows?: FlowRow[];
  parentNames?: Record<string, Record<string, string>>;
}

/** One origin–destination pair: total volume and, when the dataset has time, rows [slot, ...slotFields]. */
export interface FlowRow { o: string; d: string; n: number; slots?: number[][] }

export type Region = 'us' | 'bergen' | 'israel';

export interface LevelDef {
  id: string;
  label: string;
  /** Key in feature.parents used to group finer features. Absent for the finest level. */
  parent?: string;
  /** GeoJSON file with polygons for this level's units, ids matching the parent key (area datasets). */
  features?: string;
  /** Point datasets: snap to a square grid of this size (metres) instead of a named parent. */
  cluster?: number;
}

export interface RawFeature {
  id: string;
  name: string;
  parents?: Record<string, string>;
  lon?: number;
  lat?: number;
  v: (number | null)[];
}

export type MeasureKind = 'count' | 'signed' | 'ratio' | 'median' | 'category';

export interface MeasureDef {
  id: string;
  label: string;
  kind: MeasureKind;
  field?: string;
  num?: string;
  den?: string;
  /** Weight field for median approximations. */
  weight?: string;
  /** Category measures: fields whose summed values compete for the lead. */
  parts?: string[];
  unit?: string;
  format?: 'percent' | 'currency' | 'number';
}

/** A unit after aggregation to the chosen level. */
export interface Unit {
  id: string;
  name: string;
  /** Summed raw fields (counts, numerators, denominators, weights). */
  sums: Record<string, number>;
  /** Values of non-additive fields per member, for median-kind summaries. */
  members: RawFeature[];
  lon: number;
  lat: number;
  /** Native polygon(s), when the level has them. */
  shape?: Feature<Polygon | MultiPolygon>;
  areaKm2?: number;
}

export type MapType = 'symbol' | 'choropleth' | 'cartogram' | 'heatmap' | 'flow';
export type Variant =
  | 'circle' | 'square'
  | 'native' | 'voronoi'
  | 'dorling' | 'demers' | 'noncontiguous' | 'contiguous'
  | 'hex' | 'grid' | 'pixel'
  | 'straight' | 'arc' | 'arrow';
export type Summary = 'pooled' | 'mean' | 'median' | 'min' | 'max' | 'weighted';
export type Classing = 'continuous' | 'equal' | 'quantile' | 'jenks';
export type ScaleKind = 'linear' | 'log' | 'sqrt';
export type Normalize = 'none' | 'area';
export type Midpoint = 'median' | 'mean' | 'zero';
export type Outline = 'none' | 'thin' | 'bold';
/** Flows of the selected station: both directions, leaving it, or arriving at it. */
export type FlowDirection = 'both' | 'out' | 'in';
export type FlowMode = 'gross' | 'net';
export type Basemap = 'none' | 'osm' | 'light' | 'dark' | 'voyager';

export interface Settings {
  mapType: MapType;
  variant: Record<MapType, Variant>;
  level: string;
  summary: Summary;
  measure: string;
  normalize: Normalize;
  classing: Classing;
  bins: number;
  scale: ScaleKind;
  palette: string;
  midpoint: Midpoint;
  sizeMeasure: string; // '' = fixed size
  maxSize: number;
  cellSize: number; // heatmap cell (px on screen) / KDE bandwidth
  topN: number; // flow
  opacity: number;
  outline: Outline;
  /** Time filter (datasets with `time`): weekdays 0–6 (Mon–Sun) and hours [from, to). */
  days: number[];
  hours: [number, number];
  flowDirection: FlowDirection;
  flowMode: FlowMode;
  /** Web map tiles under the data (Mercator only). */
  basemap: Basemap;
  projection: string;
}
