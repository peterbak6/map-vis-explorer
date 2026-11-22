import * as d3 from 'd3';
import type {Feature, MultiPolygon, Polygon} from 'geojson';
import type {Dataset, LevelDef, MeasureDef, RawFeature, Summary, Unit} from '../types.ts';

const EARTH_R = 6371.0088;

/** Sum the raw fields of a set of features. Nulls are skipped, never treated as zero. */
export function sumFields(fields: string[], features: RawFeature[]): Record<string, number> {
  const sums: Record<string, number> = {};
  fields.forEach((f, i) => {
    let s = 0, seen = false;
    for (const ft of features) { const v = ft.v[i]; if (v != null && Number.isFinite(v)) { s += v; seen = true; } }
    sums[f] = seen ? s : NaN;
  });
  return sums;
}

/**
 * Aggregate the dataset's features to a level.
 * `shapes` maps a unit id to its native polygon (from the base TopoJSON) when available.
 */
export function aggregate(ds: Dataset, level: LevelDef, shapes: Map<string, Feature<Polygon | MultiPolygon>> = new Map()): Unit[] {
  const groups = d3.group(ds.features, f => groupKey(level, f));
  const units: Unit[] = [];
  for (const [id, members] of groups) {
    if (id == null) continue;
    const shape = shapes.get(id);
    const [lon, lat] = shape ? d3.geoCentroid(shape) : weightedCenter(ds, members);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    units.push({
      id,
      name: unitName(ds, level, id, members),
      sums: sumFields(ds.fields, members),
      members,
      lon, lat,
      shape,
      areaKm2: shape ? d3.geoArea(shape) * EARTH_R * EARTH_R : undefined,
    });
  }
  return units;
}

function groupKey(level: LevelDef, f: RawFeature): string | null {
  if (level.cluster && f.lon != null && f.lat != null) {
    // Local equirectangular metres; adequate for snapping at city scale.
    const x = f.lon * 111320 * Math.cos((f.lat * Math.PI) / 180), y = f.lat * 110540;
    return `${Math.floor(x / level.cluster)}:${Math.floor(y / level.cluster)}`;
  }
  if (!level.parent) return f.id;
  return f.parents?.[level.parent] ?? null;
}

function unitName(ds: Dataset, level: LevelDef, id: string, members: RawFeature[]): string {
  if (!level.parent && !level.cluster) return members[0].name;
  if (level.parent) return ds.parentNames?.[level.parent]?.[id] ?? `${level.label} ${id}`;
  return members.length === 1 ? members[0].name : `${members[0].name} + ${members.length - 1} more`;
}

function weightedCenter(ds: Dataset, members: RawFeature[]): [number, number] {
  const pts = members.filter(m => m.lon != null && m.lat != null);
  if (!pts.length) return [NaN, NaN];
  // Weight by the first field (a count in every dataset contract); fall back to equal weights.
  const w = pts.map(m => Math.max(0, m.v[0] ?? 0));
  const tot = d3.sum(w);
  if (!tot) return [d3.mean(pts, m => m.lon!)!, d3.mean(pts, m => m.lat!)!];
  return [d3.sum(pts, (m, i) => m.lon! * w[i]) / tot, d3.sum(pts, (m, i) => m.lat! * w[i]) / tot];
}

/** Summaries that are meaningful for a measure kind. The first is the default. */
export function summariesFor(m: MeasureDef): Summary[] {
  switch (m.kind) {
    case 'ratio': return ['pooled', 'mean', 'median', 'min', 'max'];
    case 'median': return ['weighted', 'median', 'min', 'max'];
    default: return ['pooled'];
  }
}

export const SUMMARY_LABELS: Record<Summary, string> = {
  pooled: 'Pooled', weighted: 'Weighted mean', mean: 'Mean of units', median: 'Median of units', min: 'Min', max: 'Max',
};

/** Displayed value of a measure for one unit. Category measures return the index of the leading part. */
export function measureValue(ds: Dataset, m: MeasureDef, u: Unit, summary: Summary): number | null {
  const fi = (f?: string) => (f ? ds.fields.indexOf(f) : -1);
  const ok = (x: number) => (Number.isFinite(x) ? x : null);
  switch (m.kind) {
    case 'count':
    case 'signed':
      return ok(u.sums[m.field!]);
    case 'category': {
      const parts = m.parts ?? [];
      let best = -1, bestV = -Infinity;
      parts.forEach((p, i) => { const v = u.sums[p]; if (Number.isFinite(v) && v > bestV) { bestV = v; best = i; } });
      return best < 0 || bestV <= 0 ? null : best;
    }
    case 'ratio': {
      if (summary === 'pooled' || u.members.length === 1) {
        const n = u.sums[m.num!], d = u.sums[m.den!];
        return d > 0 ? ok(n / d) : null;
      }
      const ni = fi(m.num), di = fi(m.den);
      const vals = u.members.map(f => { const n = f.v[ni], d = f.v[di]; return n != null && d != null && d > 0 ? n / d : null; })
        .filter((x): x is number => x != null);
      return summarize(vals, summary);
    }
    case 'median': {
      const vi = fi(m.field), wi = fi(m.weight);
      const rows = u.members.map(f => [f.v[vi], wi >= 0 ? f.v[wi] : 1] as const).filter(([v]) => v != null) as [number, number | null][];
      if (u.members.length === 1) return rows[0]?.[0] ?? null;
      if (summary === 'weighted') {
        const W = d3.sum(rows, r => r[1] ?? 0);
        return W > 0 ? d3.sum(rows, r => r[0] * (r[1] ?? 0)) / W : null;
      }
      return summarize(rows.map(r => r[0]), summary);
    }
  }
}

function summarize(vals: number[], s: Summary): number | null {
  if (!vals.length) return null;
  if (s === 'min') return d3.min(vals)!;
  if (s === 'max') return d3.max(vals)!;
  if (s === 'median') return d3.median(vals)!;
  return d3.mean(vals)!;
}
