import * as d3 from 'd3';
import type {Feature, FeatureCollection, Geometry} from 'geojson';

type XY = [number, number];

/** Projection factory per id, fitted to the given features and viewport. */
export function makeProjection(id: string, fit: FeatureCollection<Geometry> | Feature<Geometry>, w: number, h: number, pad = 16): d3.GeoProjection {
  let p: d3.GeoProjection;
  switch (id) {
    case 'albersUsa': p = d3.geoAlbersUsa() as unknown as d3.GeoProjection; break;
    case 'albers': p = d3.geoConicEqualArea().parallels([29.5, 45.5]).rotate([96, 0]).center([0, 38]); break;
    case 'tm': p = d3.geoTransverseMercator().rotate([-35.2045, -31.7344]); break;
    case 'equirect': p = d3.geoEquirectangular(); break;
    default: p = d3.geoMercator();
  }
  return p.fitExtent([[pad, pad], [w - pad, h - pad]], fit as d3.ExtendedFeatureCollection);
}

// ---------- Binning ----------

export interface Bin { x: number; y: number; ids: number[]; path: string; areaPx: number }

/** Hexagonal bins (pointy-top) of radius r over screen points. */
export function hexBins(pts: XY[], r: number): Bin[] {
  const dx = r * Math.sqrt(3), dy = r * 1.5;
  const bins = new Map<string, Bin>();
  const hex = d3.range(6).map(i => { const a = (Math.PI / 3) * i - Math.PI / 6; return [r * Math.cos(a), r * Math.sin(a)]; });
  pts.forEach(([px, py], i) => {
    let row = Math.round(py / dy), col = Math.round(px / dx - (row & 1) / 2);
    // Check the neighbouring row for the closer centre (exact hex membership).
    const cand: [number, number][] = [[row, col]];
    const row2 = py / dy > row ? row + 1 : row - 1;
    const col2 = Math.round(px / dx - (row2 & 1) / 2);
    cand.push([row2, col2], [row2, col2 + ((row2 & 1) ? 1 : -1)]);
    let best = cand[0], bd = Infinity;
    for (const [rr, cc] of cand) { const cx = (cc + (rr & 1) / 2) * dx, cy = rr * dy, d = (px - cx) ** 2 + (py - cy) ** 2; if (d < bd) { bd = d; best = [rr, cc]; } }
    [row, col] = best;
    const key = `${row}:${col}`;
    let b = bins.get(key);
    if (!b) {
      const x = (col + (row & 1) / 2) * dx, y = row * dy;
      b = {x, y, ids: [], path: 'M' + hex.map(([hx, hy]) => `${x + hx},${y + hy}`).join('L') + 'Z', areaPx: (3 * Math.sqrt(3) / 2) * r * r};
      bins.set(key, b);
    }
    b.ids.push(i);
  });
  return [...bins.values()];
}

/** Square bins of side s over screen points. */
export function gridBins(pts: XY[], s: number): Bin[] {
  const bins = new Map<string, Bin>();
  pts.forEach(([px, py], i) => {
    const c = Math.floor(px / s), r = Math.floor(py / s), key = `${r}:${c}`;
    let b = bins.get(key);
    if (!b) { const x = c * s, y = r * s; b = {x: x + s / 2, y: y + s / 2, ids: [], path: `M${x},${y}h${s}v${s}h${-s}Z`, areaPx: s * s}; bins.set(key, b); }
    b.ids.push(i);
  });
  return [...bins.values()];
}

/** Kernel density raster: returns an ImageData-sized density grid (cell = `cell` px). */
export function densityGrid(pts: XY[], weights: number[], w: number, h: number, cell: number, bandwidthPx: number) {
  const gw = Math.max(1, Math.ceil(w / cell)), gh = Math.max(1, Math.ceil(h / cell));
  const data = new Float64Array(gw * gh);
  pts.forEach(([x, y], i) => {
    const c = Math.floor(x / cell), r = Math.floor(y / cell);
    if (c >= 0 && c < gw && r >= 0 && r < gh) data[r * gw + c] += weights[i];
  });
  // Three box blurs ≈ Gaussian with σ ≈ bandwidth.
  d3.blur2({data, width: gw, height: gh}, Math.max(1, bandwidthPx / cell));
  return {data, gw, gh};
}

// ---------- Voronoi ----------

/** Voronoi cells (screen polygons) for points within an extent. */
export function voronoiCells(pts: XY[], extent: [number, number, number, number]): (XY[] | null)[] {
  const vor = d3.Delaunay.from(pts).voronoi(extent);
  return pts.map((_, i) => (vor.cellPolygon(i) as XY[] | null) ?? null);
}

export function polygonPath(poly: XY[]) { return 'M' + poly.map(p => p.join(',')).join('L') + 'Z'; }

// ---------- Cartograms ----------

export interface Placed { x: number; y: number; r: number }

export const SEPARATE_TICKS = 220;

/** Dorling (circles) or Demers (squares, half-side r) layout: marks start at centroids and are pushed apart. */
export function separate(start: Placed[], shape: 'circle' | 'square', padding = 0.5, iterations = SEPARATE_TICKS): Placed[] {
  let out: Placed[] = start;
  separateSteps(start, shape, p => { out = p; }, padding, iterations, Infinity);
  return out;
}

/** Same layout, reporting intermediate positions every `every` ticks; `done` is true on the last call. */
export function separateSteps(start: Placed[], shape: 'circle' | 'square', onStep: (placed: Placed[], done: boolean, tick: number) => void, padding = 0.5, iterations = SEPARATE_TICKS, every = 20) {
  const nodes = start.map(n => ({...n, x0: n.x, y0: n.y}));
  const sim = d3.forceSimulation(nodes as (d3.SimulationNodeDatum & Placed & {x0: number; y0: number})[])
    .force('x', d3.forceX<any>(d => d.x0).strength(0.08))
    .force('y', d3.forceY<any>(d => d.y0).strength(0.08))
    .force('collide', shape === 'circle' ? d3.forceCollide<any>(d => d.r + padding).iterations(3) : squareCollide(padding))
    .stop();
  const snap = () => nodes.map(n => ({x: n.x, y: n.y, r: n.r}));
  for (let i = 1; i <= iterations; i++) {
    sim.tick();
    if (i % every === 0 && i < iterations) onStep(snap(), false, i);
  }
  onStep(snap(), true, iterations);
}

/** Axis-aligned square collision: push overlapping squares apart along the axis of least overlap. */
function squareCollide(padding: number) {
  let nodes: (Placed & {vx?: number; vy?: number})[] = [];
  const force = () => {
    const tree = d3.quadtree(nodes, d => d.x, d => d.y);
    const maxR = d3.max(nodes, d => d.r) ?? 0;
    for (const a of nodes) {
      const reach = a.r + maxR + padding;
      tree.visit((q, x0, y0, x1, y1) => {
        if (!('length' in q)) {
          let node: any = q;
          do {
            const b = node.data as Placed;
            if (b !== a) {
              const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r + padding;
              const ox = min - Math.abs(dx), oy = min - Math.abs(dy);
              if (ox > 0 && oy > 0) {
                if (ox < oy) { const m = (ox / 2) * (dx < 0 ? -1 : 1); a.x -= m; b.x += m; }
                else { const m = (oy / 2) * (dy < 0 ? -1 : 1); a.y -= m; b.y += m; }
              }
            }
          } while ((node = node.next));
        }
        return x0 > a.x + reach || x1 < a.x - reach || y0 > a.y + reach || y1 < a.y - reach;
      });
    }
  };
  force.initialize = (n: any[]) => { nodes = n; };
  return force;
}

/**
 * Non-contiguous (Olson) cartogram: scale factor per polygon so its area is proportional to value.
 * The anchor polygon (density at quantile `anchor`) keeps its true size; denser polygons grow and may overlap.
 * Olson's original anchors on the densest unit (anchor = 1), which shrinks most units to dots when densities are skewed.
 */
export function olsonScales(values: number[], areasPx: number[], anchor = 1): number[] {
  const dens = values.map((v, i) => (areasPx[i] > 0 && v > 0 ? v / areasPx[i] : 0));
  const ref = (anchor >= 1 ? d3.max(dens) : d3.quantile(dens.filter(d => d > 0), anchor)) || 1;
  return dens.map(d => Math.sqrt(d / ref));
}

/**
 * Contiguous cartogram (Dougenik, Chrisman & Niemeyer 1985) on projected rings.
 * `rings[i]` holds the screen rings of unit i. Shared vertices move identically because
 * displacement depends only on position.
 */
export function dougenik(rings: XY[][][], values: number[], iterations = 8): XY[][][] {
  let cur = rings.map(rs => rs.map(r => r.map(p => [p[0], p[1]] as XY)));
  const total = d3.sum(values);
  for (let it = 0; it < iterations; it++) {
    const areas = cur.map(rs => Math.abs(d3.sum(rs, r => d3.polygonArea(r))));
    const cents = cur.map(rs => { const big = rs.reduce((a, b) => (Math.abs(d3.polygonArea(b)) > Math.abs(d3.polygonArea(a)) ? b : a)); return d3.polygonCentroid(big); });
    const totalArea = d3.sum(areas);
    const desired = values.map(v => (v / total) * totalArea);
    const radius = areas.map(a => Math.sqrt(a / Math.PI));
    const mass = desired.map((d, i) => Math.sqrt(d / Math.PI) - radius[i]);
    const sizeError = d3.mean(areas.map((a, i) => Math.max(a, desired[i]) / Math.max(1e-9, Math.min(a, desired[i])))) ?? 1;
    const reduce = 1 / sizeError;
    const n = values.length;
    cur = cur.map(rs => rs.map(r => r.map(([x, y]) => {
      let nx = x, ny = y;
      for (let j = 0; j < n; j++) {
        if (!radius[j]) continue;
        const dx = x - cents[j][0], dy = y - cents[j][1], d = Math.hypot(dx, dy) || 1e-9;
        const f = d > radius[j] ? mass[j] * (radius[j] / d) : mass[j] * (d * d) / (radius[j] * radius[j]) * (4 - 3 * (d / radius[j]));
        nx += (f * reduce * dx) / d; ny += (f * reduce * dy) / d;
      }
      return [nx, ny] as XY;
    })));
  }
  return cur;
}

// ---------- Flows ----------

/** Path for a flow from a to b with width w: straight line, clockwise arc, or tapered arrow polygon. */
export function flowPath(a: XY, b: XY, kind: 'straight' | 'arc' | 'arrow', w: number): string {
  const [x0, y0] = a, [x1, y1] = b, dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len; // unit normal (left of travel)
  if (kind === 'straight') return `M${x0},${y0}L${x1},${y1}`;
  const bend = len * 0.18;
  const cx = (x0 + x1) / 2 + nx * bend, cy = (y0 + y1) / 2 + ny * bend;
  if (kind === 'arc') return `M${x0},${y0}Q${cx},${cy} ${x1},${y1}`;
  // Tapered arrow: full width at the origin, a point at the destination, with a head.
  const hw = Math.max(0.6, w / 2), head = Math.min(len * 0.3, Math.max(6, w * 2.2));
  const t = 1 - head / len;
  const bx = x0 + dx * t + nx * bend * 0.3, by = y0 + dy * t + ny * bend * 0.3;
  return `M${x0 + nx * hw},${y0 + ny * hw}Q${cx + nx * hw * 0.6},${cy + ny * hw * 0.6} ${bx + nx * hw * 0.5},${by + ny * hw * 0.5}`
    + `L${bx + nx * hw * 1.6},${by + ny * hw * 1.6}L${x1},${y1}L${bx - nx * hw * 1.6},${by - ny * hw * 1.6}`
    + `L${bx - nx * hw * 0.5},${by - ny * hw * 0.5}Q${cx - nx * hw * 0.6},${cy - ny * hw * 0.6} ${x0 - nx * hw},${y0 - ny * hw}Z`;
}
