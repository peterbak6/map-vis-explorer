import type {Feature, MultiPolygon, Polygon} from 'geojson';

/** One dataset file in public/data/<id>.json (see DESIGN.md → Datasets). */
export interface DatasetFile {
  id: string;
  title: string;
  subtitle: string;
  region: Region;
  geometry: 'areas' | 'points';
  /** Base map: a TopoJSON file in public/data. For area datasets `object` holds the feature polygons. */
  base: {file: string; object: string; outline?: string};
  /** Raw numeric fields, in the order of each feature's `v` array. */
  fields: string[];
  levels: LevelDef[];
  parentNames?: Record<string, Record<string, string>>;
  measures: MeasureDef[];
  /** Party or group names for category measures, keyed by field. */
  categories?: Record<string, {label: string; color?: string}>;
  features: RawFeature[];
  /** Origin–destination table: [originFeatureId, destinationFeatureId, ...values in flowFields order]. */
  flowFields?: string[];
  flows?: [string, string, ...number[]][];
  defaults?: {measure?: string; sizeMeasure?: string};
  source: string;
  attribution: string;
  note?: string;
}

export type Region = 'us' | 'nyc' | 'israel';

export interface LevelDef {
  id: string;
  label: string;
  /** Key in feature.parents used to group finer features. Absent for the finest level. */
  parent?: string;
  /** TopoJSON object with native polygons for this level (area datasets). */
  object?: string;
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
  projection: string;
}
