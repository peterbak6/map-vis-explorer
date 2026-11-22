import * as d3 from 'd3';
import type {Settings} from '../types.ts';
import {breaks, classOf, transform} from './classify.ts';

export type PaletteFamily = 'sequential' | 'diverging' | 'categorical';
export interface PaletteDef { id: string; label: string; family: PaletteFamily; interp?: (t: number) => string; scheme?: readonly string[] }

export const PALETTES: PaletteDef[] = [
  {id: 'Oranges', label: 'Oranges', family: 'sequential', interp: d3.interpolateOranges},
  {id: 'Blues', label: 'Blues', family: 'sequential', interp: d3.interpolateBlues},
  {id: 'Greens', label: 'Greens', family: 'sequential', interp: d3.interpolateGreens},
  {id: 'Purples', label: 'Purples', family: 'sequential', interp: d3.interpolatePurples},
  {id: 'YlGnBu', label: 'YlGnBu', family: 'sequential', interp: d3.interpolateYlGnBu},
  {id: 'Viridis', label: 'Viridis', family: 'sequential', interp: d3.interpolateViridis},
  {id: 'Magma', label: 'Magma', family: 'sequential', interp: t => d3.interpolateMagma(1 - t)},
  {id: 'RdBu', label: 'RdBu', family: 'diverging', interp: t => d3.interpolateRdBu(1 - t)},
  {id: 'PuOr', label: 'PuOr', family: 'diverging', interp: d3.interpolatePuOr},
  {id: 'BrBG', label: 'BrBG', family: 'diverging', interp: d3.interpolateBrBG},
  {id: 'Tableau', label: 'Tableau 10', family: 'categorical', scheme: d3.schemeTableau10},
  {id: 'Set2', label: 'Set 2', family: 'categorical', scheme: d3.schemeSet2},
];
export const palette = (id: string) => PALETTES.find(p => p.id === id) ?? PALETTES[0];
export const NO_DATA = '#ebe8e4';

/** Lightest colours of sequential ramps vanish on white; start ramps a little in. */
const ramp = (p: PaletteDef, t: number) => p.interp!(p.family === 'sequential' ? 0.08 + 0.92 * t : t);

export interface ColorLegend {
  kind: 'continuous' | 'classed' | 'categorical';
  domain: [number, number];
  breaks: number[];
  colors: string[];
  mid?: number;
  values: number[];
  categories?: {label: string; color: string; count: number}[];
}

export interface ColorScale { color: (v: number | null) => string; legend: ColorLegend }

/** Build the colour mapping for displayed values. */
export function colorScale(values: (number | null)[], s: Settings, categoryLabels?: string[]): ColorScale {
  const p = palette(s.palette);
  const vals = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (categoryLabels) {
    const scheme = (p.family === 'categorical' ? p.scheme : d3.schemeTableau10)!;
    const colors = categoryLabels.map((_, i) => scheme[i % scheme.length]);
    const counts = d3.rollup(vals, g => g.length, v => v);
    return {
      color: v => (v == null ? NO_DATA : colors[v] ?? NO_DATA),
      legend: {kind: 'categorical', domain: [0, categoryLabels.length - 1], breaks: [], colors, values: vals,
        categories: categoryLabels.map((label, i) => ({label, color: colors[i], count: counts.get(i) ?? 0})).filter(c => c.count > 0)},
    };
  }
  if (!vals.length) return {color: () => NO_DATA, legend: {kind: 'continuous', domain: [0, 1], breaks: [], colors: [], values: []}};
  const [lo, hi] = d3.extent(vals) as [number, number];
  const [f] = transform(s.scale);
  const mid = p.family === 'diverging' ? (s.midpoint === 'zero' ? 0 : s.midpoint === 'mean' ? d3.mean(vals)! : d3.median(vals)!) : undefined;
  // Position in [0,1] along the ramp, in transformed space; diverging ramps are centred on the midpoint.
  const pos = (v: number) => {
    if (mid == null) return hi === lo ? 0.5 : (f(v) - f(lo)) / (f(hi) - f(lo));
    const dev = Math.max(Math.abs(f(hi) - f(mid)), Math.abs(f(lo) - f(mid))) || 1;
    return 0.5 + (0.5 * (f(v) - f(mid))) / dev;
  };
  const clamp = (t: number) => Math.max(0, Math.min(1, t));
  const b = breaks(vals, s.classing, s.bins, s.scale);
  if (s.classing === 'continuous' || !b.length) {
    return {color: v => (v == null || !Number.isFinite(v) ? NO_DATA : ramp(p, clamp(pos(v)))),
      legend: {kind: 'continuous', domain: [lo, hi], breaks: [], colors: [], mid, values: vals}};
  }
  const edges = [lo, ...b, hi];
  const colors = edges.slice(0, -1).map((e, i) => {
    if (mid == null) return ramp(p, b.length ? i / b.length : 0.5);
    return ramp(p, clamp(pos((e + edges[i + 1]) / 2)));
  });
  return {color: v => (v == null || !Number.isFinite(v) ? NO_DATA : colors[classOf(v, b)]),
    legend: {kind: 'classed', domain: [lo, hi], breaks: b, colors, mid, values: vals}};
}
