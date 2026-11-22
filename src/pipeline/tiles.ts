/**
 * Web Mercator raster tiles (OSM/XYZ scheme) aligned with a d3.geoMercator projection.
 * d3.geoMercator maps the world to a square of side 2π·scale centred on its translate; a zoom
 * transform (x, y, k) scales and shifts that square. Tiles are only valid for Mercator.
 */
export interface Tile { key: string; url: string; x: number; y: number; size: number }

const OSM = {label: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright'};
const CARTO = {label: '© CARTO', href: 'https://carto.com/attribution/'};

/**
 * Basemap providers. OSM standard tiles need no key (light classroom use under the OSM tile usage policy)
 * and are shown muted to grey so data stays legible. CARTO styles need a free API key
 * (carto.com/basemaps/apikey) supplied as VITE_CARTO_KEY at build time.
 */
export const BASEMAPS = {
  osm: {label: 'OSM', carto: false, muted: true, attribution: [OSM]},
  light: {label: 'Light', carto: true, style: 'light_all', muted: false, attribution: [OSM, CARTO]},
  dark: {label: 'Dark', carto: true, style: 'dark_all', muted: false, attribution: [OSM, CARTO]},
  voyager: {label: 'Voyager', carto: true, style: 'rastertiles/voyager', muted: false, attribution: [OSM, CARTO]},
} as const;
export type BasemapId = keyof typeof BASEMAPS;

export function tileUrl(id: BasemapId, z: number, x: number, y: number, retina: boolean, key = ''): string {
  const b = BASEMAPS[id];
  if (!b.carto) return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  return `https://basemaps.cartocdn.com/${b.style}/${z}/${x}/${y}${retina ? '@2x' : ''}.png${key ? `?key=${encodeURIComponent(key)}` : ''}`;
}

/**
 * Tiles covering a w×h viewport for a Mercator projection with `scale` and `translate`,
 * under a zoom transform {x, y, k}. Tile size on screen stays between ~181 and ~362 px.
 */
export function tilesFor(scale: number, translate: [number, number], zoom: {x: number; y: number; k: number}, w: number, h: number,
  url: (z: number, x: number, y: number) => string, maxZ = 19): Tile[] {
  const world = 2 * Math.PI * scale * zoom.k; // px width of the whole world
  const ox = zoom.k * translate[0] + zoom.x - world / 2; // screen position of the world's top-left corner
  const oy = zoom.k * translate[1] + zoom.y - world / 2;
  const z = Math.max(0, Math.min(maxZ, Math.round(Math.log2(world / 256))));
  const n = 2 ** z, size = world / n;
  const x0 = Math.floor(-ox / size), x1 = Math.floor((w - ox) / size);
  const y0 = Math.max(0, Math.floor(-oy / size)), y1 = Math.min(n - 1, Math.floor((h - oy) / size));
  const tiles: Tile[] = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const wx = ((tx % n) + n) % n; // wrap around the antimeridian
    tiles.push({key: `${z}/${tx}/${ty}`, url: url(z, wx, ty), x: ox + tx * size, y: oy + ty * size, size});
  }
  return tiles;
}

/** Standard slippy-map pixel position of a lon/lat at zoom level z (256 px tiles), for tests. */
export function slippyPixel(lon: number, lat: number, z: number): [number, number] {
  const n = 256 * 2 ** z, r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}
