import * as d3 from 'd3';
import type {Classing, ScaleKind} from '../types.ts';

/** Forward/inverse transforms for value scales. */
export function transform(kind: ScaleKind): [(x: number) => number, (y: number) => number] {
  if (kind === 'log') return [Math.log10, y => 10 ** y];
  if (kind === 'sqrt') return [x => Math.sign(x) * Math.sqrt(Math.abs(x)), y => Math.sign(y) * y * y];
  return [x => x, y => y];
}

/**
 * Interior class breaks (length bins − 1) for classed maps; [] for continuous.
 * Equal interval and natural breaks operate in the chosen scale's space; quantile uses ranks only.
 */
export function breaks(values: number[], classing: Classing, bins: number, scale: ScaleKind): number[] {
  const v = values.filter(Number.isFinite).sort(d3.ascending);
  if (classing === 'continuous' || v.length < 2) return [];
  if (classing === 'quantile') return dedupe(d3.range(1, bins).map(i => d3.quantileSorted(v, i / bins)!));
  const [f, inv] = transform(scale);
  const t = v.map(f);
  if (classing === 'equal') {
    const lo = t[0], hi = t[t.length - 1];
    return dedupe(d3.range(1, bins).map(i => inv(lo + ((hi - lo) * i) / bins)));
  }
  return dedupe(jenks(sample(t, 1200), bins).map(inv));
}

function dedupe(b: number[]) { return b.filter((x, i) => Number.isFinite(x) && (i === 0 || x > b[i - 1])); }

function sample(sorted: number[], n: number) {
  if (sorted.length <= n) return sorted;
  return d3.range(n).map(i => sorted[Math.round((i * (sorted.length - 1)) / (n - 1))]);
}

/** Fisher–Jenks natural breaks on sorted values; returns interior break values. */
export function jenks(data: number[], k: number): number[] {
  const n = data.length;
  if (n <= k) return data.slice(1);
  const lower = Array.from({length: n + 1}, () => new Int32Array(k + 1));
  const variance = Array.from({length: n + 1}, () => new Float64Array(k + 1).fill(Infinity));
  for (let j = 1; j <= k; j++) { lower[1][j] = 1; variance[1][j] = 0; }
  for (let l = 2; l <= n; l++) {
    let s1 = 0, s2 = 0, w = 0, vv = 0;
    for (let m = 1; m <= l; m++) {
      const i3 = l - m + 1, val = data[i3 - 1];
      s2 += val * val; s1 += val; w++;
      vv = s2 - (s1 * s1) / w;
      const i4 = i3 - 1;
      if (i4 !== 0) for (let j = 2; j <= k; j++) {
        if (variance[l][j] >= vv + variance[i4][j - 1]) { lower[l][j] = i3; variance[l][j] = vv + variance[i4][j - 1]; }
      }
    }
    lower[l][1] = 1; variance[l][1] = vv;
  }
  const out: number[] = [];
  let kk = n;
  for (let j = k; j >= 2; j--) { const id = lower[kk][j] - 1; out.unshift(data[id]); kk = id; }
  return out;
}

/** Class index for a value given interior breaks. */
export function classOf(x: number, b: number[]) { return d3.bisectRight(b, x); }
