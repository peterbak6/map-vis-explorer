import * as topojson from 'topojson-client';
import type {Feature, FeatureCollection, MultiPolygon, Polygon} from 'geojson';
import type {Topology} from 'topojson-specification';
import type {DatasetFile} from './types.ts';

export interface ManifestEntry { id: string; title: string; file?: string; status: 'ready' | 'planned'; note?: string }

export interface Loaded {
  ds: DatasetFile;
  /** Base-map features (e.g. all counties) for context and clipping. */
  base: FeatureCollection<Polygon | MultiPolygon>;
  /** Outline mesh (e.g. state borders), if any. */
  outline?: GeoJSON.MultiLineString;
  /** Native polygons per level id → unit id. */
  shapes: Record<string, Map<string, Feature<Polygon | MultiPolygon>>>;
}

const url = (f: string) => `${import.meta.env.BASE_URL}data/${f}`;

export async function loadManifest(): Promise<ManifestEntry[]> {
  const r = await fetch(url('manifest.json'));
  if (!r.ok) throw Error('Could not load the dataset list.');
  return r.json();
}

export async function loadDataset(entry: ManifestEntry): Promise<Loaded> {
  const ds: DatasetFile = await (await fetch(url(entry.file!))).json();
  const topo: Topology = await (await fetch(url(ds.base.file))).json();
  const asFC = (name: string) => topojson.feature(topo, topo.objects[name] as any) as unknown as FeatureCollection<Polygon | MultiPolygon>;
  const all = asFC(ds.base.object);
  // Area datasets: keep only base polygons in regions the data covers (drops e.g. overseas territories).
  const regions = ds.geometry === 'areas' && ds.levels[1]?.parent ? new Set(ds.features.map(f => f.parents?.[ds.levels[1].parent!])) : null;
  const base = regions ? {...all, features: all.features.filter(f => regions.has(String(f.id).slice(0, 2)))} : all;
  const outline = ds.base.outline ? (topojson.mesh(topo, topo.objects[ds.base.outline] as any, (a, b) => a !== b) as GeoJSON.MultiLineString) : undefined;
  const shapes: Loaded['shapes'] = {};
  if (ds.geometry === 'areas') {
    ds.levels.forEach((l, i) => {
      const fc = i === 0 ? base : l.object ? asFC(l.object) : null;
      if (fc) shapes[l.id] = new Map(fc.features.map(f => [String(f.id), f]));
    });
  }
  return {ds, base, outline, shapes};
}
