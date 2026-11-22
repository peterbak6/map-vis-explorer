import * as d3 from 'd3';
import type {Feature, FeatureCollection, Geometry, MultiPolygon, Polygon} from 'geojson';
import type {Dataset, DatasetMeta, FlowRow, RawFeature} from './types.ts';

export interface ManifestEntry { id: string; title: string; file?: string; status: 'ready' | 'planned'; note?: string }

type Areas = FeatureCollection<Polygon | MultiPolygon>;

export interface Loaded {
  ds: Dataset;
  /** Context drawn underneath and used to clip derived geometry (land, boundary, or the points' hull). */
  base: Areas;
  /** Boundaries drawn above choropleths (e.g. states). */
  outline?: Areas;
  /** Native polygons per level id → unit id. */
  shapes: Record<string, Map<string, Feature<Polygon | MultiPolygon>>>;
}

const url = (f: string) => `${import.meta.env.BASE_URL}data/${f}`;
async function getJSON<T>(f: string): Promise<T> {
  const r = await fetch(url(f));
  if (!r.ok) throw Error(`${f}: ${r.status}`);
  return r.json();
}

export async function loadManifest(): Promise<ManifestEntry[]> { return getJSON('manifest.json'); }

/** Load a dataset description and its GeoJSON files into the in-memory model. */
export async function loadDataset(entry: ManifestEntry): Promise<Loaded> {
  const meta = await getJSON<DatasetMeta>(entry.file!);
  const [fc, flowFC, baseFC, outlineFC, ...levelFCs] = await Promise.all([
    getJSON<FeatureCollection<Geometry>>(meta.features),
    meta.flows ? getJSON<FeatureCollection>(meta.flows) : null,
    meta.base ? getJSON<Areas>(meta.base) : null,
    meta.outline ? getJSON<Areas>(meta.outline) : null,
    ...meta.levels.map(l => (l.features ? getJSON<Areas>(l.features) : null)),
  ]);
  return fromGeoJSON(meta, fc, flowFC, baseFC, outlineFC, levelFCs);
}

/** Pure conversion, separated from fetching so it can be tested. */
export function fromGeoJSON(meta: DatasetMeta, fc: FeatureCollection<Geometry>, flowFC: FeatureCollection | null, baseFC: Areas | null, outlineFC: Areas | null, levelFCs: (Areas | null)[]): Loaded {
  const parentKeys = meta.levels.map(l => l.parent).filter((k): k is string => !!k);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : v == null || v === '' ? null : Number.isFinite(+(v as string)) ? +(v as string) : null);
  const features: RawFeature[] = [];
  const finestShapes = new Map<string, Feature<Polygon | MultiPolygon>>();
  rewind(fc); [baseFC, outlineFC, ...levelFCs].forEach(x => x && rewind(x));
  fc.features.forEach((f, i) => {
    const id = String(f.id ?? f.properties?.id ?? i);
    const p = f.properties ?? {};
    const rf: RawFeature = {id, name: String(p.name ?? id), v: meta.fields.map(k => num(p[k]))};
    const parents = Object.fromEntries(parentKeys.filter(k => p[k] != null).map(k => [k, String(p[k])]));
    if (Object.keys(parents).length) rf.parents = parents;
    if (f.geometry?.type === 'Point') [rf.lon, rf.lat] = f.geometry.coordinates;
    else if (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon') finestShapes.set(id, f as Feature<Polygon | MultiPolygon>);
    features.push(rf);
  });

  const field = meta.flowField ?? 'trips';
  const slotKey = meta.time?.slots;
  const flows = flowFC?.features.map(f => {
    const p = f.properties ?? {};
    const row: FlowRow = {o: String(p.origin), d: String(p.destination), n: num(p[field]) ?? 0};
    if (slotKey && Array.isArray(p[slotKey])) row.slots = p[slotKey] as number[][];
    return row;
  });

  const shapes: Loaded['shapes'] = {};
  const parentNames: Record<string, Record<string, string>> = {};
  meta.levels.forEach((l, i) => {
    const lf = i === 0 && meta.geometry === 'areas' ? null : levelFCs[i];
    if (i === 0 && meta.geometry === 'areas') shapes[l.id] = finestShapes;
    if (lf) {
      shapes[l.id] = new Map(lf.features.map(f => [String(f.id), f]));
      if (l.parent) parentNames[l.parent] = Object.fromEntries(lf.features.map(f => [String(f.id), String(f.properties?.name ?? f.id)]));
    }
  });

  const base: Areas = baseFC ?? (meta.geometry === 'areas'
    ? {type: 'FeatureCollection', features: [...finestShapes.values()]}
    : {type: 'FeatureCollection', features: [hull(features)]});
  const {features: _f, flows: _fl, base: _b, outline: _o, flowField: _ff, ...rest} = meta;
  const ds: Dataset = {...rest, features, flows, parentNames};
  return {ds, base, outline: outlineFC ?? undefined, shapes};
}

/**
 * RFC 7946 GeoJSON winds exterior rings counter-clockwise; d3-geo expects clockwise and would otherwise
 * draw the polygon's complement (the rest of the globe). Reverse any polygon covering more than a hemisphere.
 */
export function rewind(fc: FeatureCollection<Geometry>) {
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    polys.forEach(rings => {
      if (d3.geoArea({type: 'Polygon', coordinates: rings}) > 2 * Math.PI) rings.forEach(r => r.reverse());
    });
  }
  return fc;
}

/** Padded convex hull of point features, used as context when a point dataset has no base map. */
function hull(fs: RawFeature[]): Feature<Polygon> {
  const pts = fs.filter(f => f.lon != null).map(f => [f.lon!, f.lat!] as [number, number]);
  const h = d3.polygonHull(pts) ?? pts;
  const [cx, cy] = [d3.mean(h, p => p[0])!, d3.mean(h, p => p[1])!];
  const ring = h.map(([x, y]) => [cx + (x - cx) * 1.08, cy + (y - cy) * 1.08]);
  ring.push(ring[0]);
  let poly: Feature<Polygon> = {type: 'Feature', properties: {name: 'Extent of points'}, geometry: {type: 'Polygon', coordinates: [ring]}};
  // d3-geo expects clockwise exterior rings; a ring covering more than a hemisphere is wound the wrong way.
  if (d3.geoArea(poly) > 2 * Math.PI) poly = {...poly, geometry: {type: 'Polygon', coordinates: [ring.slice().reverse()]}};
  return poly;
}
