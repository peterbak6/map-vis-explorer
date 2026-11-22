import * as d3 from 'd3';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {Feature, Geometry} from 'geojson';
import type {Loaded} from '../data.ts';
import type {LevelDef, Settings, Unit} from '../types.ts';
import {makeProjection} from '../pipeline/geometry.ts';
import {buildScene, cartogramStart, layoutKey, type Scene, type SceneInput} from '../pipeline/scene.ts';
import {SEPARATE_TICKS} from '../pipeline/geometry.ts';

type XY = [number, number];
const ACCENT = '#d94722';
const OUTSIDE_LOWER48 = new Set(['02', '15']);

export function useScene(loaded: Loaded, units: Unit[], level: LevelDef, e: Settings, size: {w: number; h: number}) {
  const {ds, base} = loaded;
  const projection = useMemo(() => {
    let fit: Feature<Geometry> | GeoJSON.FeatureCollection<Geometry>;
    if (ds.geometry === 'areas') {
      // Non-composite projections frame the conterminous states; Albers USA insets Alaska and Hawaii.
      const feats = e.projection === 'albersUsa' ? base.features : base.features.filter(f => !OUTSIDE_LOWER48.has(String(f.id).slice(0, 2)));
      fit = {type: 'FeatureCollection', features: feats};
    } else {
      fit = {type: 'Feature', properties: {}, geometry: {type: 'MultiPoint', coordinates: ds.features.filter(f => f.lon != null).map(f => [f.lon!, f.lat!])}};
    }
    return makeProjection(e.projection, fit, size.w, size.h);
  }, [ds, base, e.projection, size.w, size.h]);
  const path = useMemo(() => d3.geoPath(projection), [projection]);
  const input = useMemo<SceneInput>(() => ({
    ds, units, level, s: e, path, width: size.w, height: size.h,
    project: p => (projection(p) as XY | null) ?? null,
    invert: p => (projection.invert?.(p) as XY | null) ?? null,
  }), [ds, units, level, e, path, projection, size.w, size.h]);
  const {layout, progress} = useCartogramLayout(input);
  const scene = useMemo<Scene>(() => buildScene({...input, layout}), [input, layout]);
  return {projection, path, scene, progress};
}

/** Finished Dorling/Demers layouts, keyed by everything that moves marks (not colour choices). */
const layoutCache = new Map<string, Float64Array>();

/**
 * Dorling/Demers separation runs in a worker so the page can show progress.
 * Returns the latest positions and progress in [0, 1] (null when nothing is computing).
 */
function useCartogramLayout(inp: SceneInput): {layout: Float64Array | null; progress: number | null} {
  const active = inp.s.mapType === 'cartogram' && (inp.s.variant.cartogram === 'dorling' || inp.s.variant.cartogram === 'demers');
  const key = active ? layoutKey(inp) : '';
  const [state, setState] = useState<{key: string; xy: Float64Array | null; progress: number | null}>({key: '', xy: null, progress: null});
  const inpRef = useRef(inp); inpRef.current = inp;
  useEffect(() => {
    if (!key) return;
    const cached = layoutCache.get(key);
    if (cached) { setState({key, xy: cached, progress: null}); return; }
    const {start, square} = cartogramStart(inpRef.current);
    const xyr = new Float64Array(start.length * 3);
    start.forEach((p, i) => { xyr[3 * i] = p.x; xyr[3 * i + 1] = p.y; xyr[3 * i + 2] = p.r; });
    setState({key, xy: null, progress: 0});
    const worker = new Worker(new URL('../pipeline/layout.worker.ts', import.meta.url), {type: 'module'});
    let step = 0;
    worker.onmessage = (ev: MessageEvent<{key: string; xy: Float64Array; done: boolean}>) => {
      step++;
      if (ev.data.done) { layoutCache.set(key, ev.data.xy); setState({key, xy: ev.data.xy, progress: null}); worker.terminate(); }
      else setState({key, xy: ev.data.xy, progress: Math.min(0.99, (step * 20) / SEPARATE_TICKS)});
    };
    worker.postMessage({key, xyr, shape: square ? 'square' : 'circle'}, [xyr.buffer]);
    return () => worker.terminate();
  }, [key]);
  if (!key) return {layout: null, progress: null};
  if (state.key !== key) return {layout: layoutCache.get(key) ?? null, progress: layoutCache.has(key) ? null : 0};
  return {layout: state.xy, progress: state.progress};
}

export function MapView({loaded, scene, path, e, selected, onSelect, size, hostRef}: {
  loaded: Loaded; scene: Scene; path: d3.GeoPath; e: Settings; selected: string | null; onSelect: (id: string | null) => void;
  size: {w: number; h: number}; hostRef: React.RefObject<HTMLDivElement | null>;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tip, setTip] = useState<{x: number; y: number; title: string; lines: string[]} | null>(null);
  const transformRef = useRef(d3.zoomIdentity);
  const {ds, base, outline} = loaded;

  useEffect(() => {
    const svg = d3.select(svgRef.current!);
    svg.selectAll('*').remove();
    const {w, h} = size;
    const defs = svg.append('defs');
    const derived = (e.mapType === 'choropleth' && e.variant.choropleth === 'voronoi') || e.mapType === 'heatmap';
    const landPath = base.features.map(f => path(f) ?? '').join('');
    defs.append('clipPath').attr('id', 'land').append('path').attr('d', landPath);
    svg.append('rect').attr('width', w).attr('height', h).attr('fill', 'transparent').on('click', () => onSelect(null));
    const zoomG = svg.append('g').attr('class', 'zoom-layer');

    // Base map: land plus internal borders, muted.
    const baseG = zoomG.append('g').attr('pointer-events', 'none');
    baseG.append('path').attr('d', landPath).attr('fill', '#f1eee9');
    if (outline) baseG.append('path').attr('d', path(outline) ?? '').attr('fill', 'none').attr('stroke', '#d6cfc6').attr('stroke-width', 0.6).attr('vector-effect', 'non-scaling-stroke');

    if (scene.raster) {
      const {data, gw, gh, cell, max} = scene.raster;
      const canvas = document.createElement('canvas'); canvas.width = gw; canvas.height = gh;
      const ctx = canvas.getContext('2d')!; const img = ctx.createImageData(gw, gh);
      for (let i = 0; i < data.length; i++) {
        const v = data[i]; if (v <= max * 0.002) continue;
        const c = d3.rgb(scene.color.color(v));
        img.data.set([c.r, c.g, c.b, Math.round(255 * Math.min(1, (v / max) * 6) * e.opacity)], i * 4);
      }
      ctx.putImageData(img, 0, 0);
      zoomG.append('image').attr('href', canvas.toDataURL()).attr('width', gw * cell).attr('height', gh * cell)
        .attr('preserveAspectRatio', 'none').attr('clip-path', 'url(#land)').style('image-rendering', 'auto');
    }

    const strokeW = e.outline === 'none' ? 0 : e.outline === 'bold' ? 1.2 : 0.35;
    const marksG = zoomG.append('g').attr('clip-path', derived ? 'url(#land)' : null);
    const isFlow = e.mapType === 'flow';
    const sel = marksG.selectAll<SVGElement, Scene['marks'][number]>('.mark').data(scene.marks, d => d.id);
    const ent = sel.enter().append(d => document.createElementNS('http://www.w3.org/2000/svg', d.shape === 'circle' ? 'circle' : d.shape === 'rect' ? 'rect' : 'path') as SVGElement)
      .attr('class', 'mark').attr('tabindex', 0).attr('role', 'button').attr('aria-label', d => `${d.title}. ${d.lines.join('. ')}`)
      .attr('fill', d => d.fill).attr('fill-opacity', e.opacity)
      .attr('stroke', d => (isFlow ? d.stroke! : '#fff')).attr('stroke-width', d => (isFlow ? d.strokeWidth! : d.shape === 'path' ? strokeW : Math.max(strokeW, 0.4)))
      .attr('stroke-opacity', isFlow ? 0.85 : 1).attr('vector-effect', isFlow ? null : 'non-scaling-stroke');
    ent.filter(d => d.shape === 'path').attr('d', d => d.d!)
      .attr('transform', d => (d.scale != null ? `translate(${d.x},${d.y}) scale(${d.scale}) translate(${-d.x!},${-d.y!})` : null));
    ent.filter(d => d.shape === 'circle').attr('cx', d => d.x!).attr('cy', d => d.y!).attr('r', d => d.r!);
    ent.filter(d => d.shape === 'rect').attr('x', d => d.x! - d.r!).attr('y', d => d.y! - d.r!).attr('width', d => 2 * d.r!).attr('height', d => 2 * d.r!);
    if (isFlow) ent.attr('stroke-linecap', 'round');

    // Area datasets: draw region borders above choropleths for orientation.
    if (outline && e.mapType === 'choropleth' && ds.geometry === 'areas') {
      zoomG.append('path').attr('d', path(outline) ?? '').attr('fill', 'none').attr('stroke', '#ffffff').attr('stroke-width', e.outline === 'none' ? 0 : 0.9).attr('pointer-events', 'none').attr('vector-effect', 'non-scaling-stroke');
    }

    const host = hostRef.current!;
    const showTip = (ev: MouseEvent | FocusEvent, d: Scene['marks'][number]) => {
      const r = host.getBoundingClientRect();
      const [cx, cy] = ev instanceof MouseEvent ? [ev.clientX - r.left, ev.clientY - r.top] : [w / 2, 40];
      setTip({x: Math.min(cx + 14, r.width - 260), y: Math.min(cy + 14, r.height - 120), title: d.title, lines: d.lines});
    };
    ent.on('mousemove', (ev, d) => showTip(ev, d)).on('mouseleave', () => setTip(null))
      .on('focus', (ev, d) => showTip(ev, d)).on('blur', () => setTip(null))
      .on('click', (ev, d) => { ev.stopPropagation(); onSelect(selected === d.id ? null : d.id); })
      .on('keydown', (ev: KeyboardEvent, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(selected === d.id ? null : d.id); } });
    if (selected) {
      ent.attr('opacity', d => (d.id === selected ? 1 : 0.28));
      ent.filter(d => d.id === selected).raise().attr('stroke', isFlow ? ACCENT : ACCENT).attr('stroke-width', d => (isFlow ? d.strokeWidth! + 1 : 1.8)).attr('vector-effect', 'non-scaling-stroke');
    }

    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([1, 14]).translateExtent([[0, 0], [w, h]])
      .on('zoom', ev => { transformRef.current = ev.transform; zoomG.attr('transform', ev.transform.toString()); });
    svg.call(zoom).on('dblclick.zoom', null).on('dblclick', () => svg.transition().duration(350).call(zoom.transform, d3.zoomIdentity));
    svg.call(zoom.transform, transformRef.current);
  }, [scene, path, base, outline, ds, e, selected, onSelect, size, hostRef]);

  return (
    <>
      <svg ref={svgRef} width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} role="group" aria-label={scene.title} />
      {tip && <div className="tooltip" style={{left: tip.x, top: tip.y}}><strong>{tip.title}</strong>{tip.lines.map((l, i) => <span key={i}>{l}</span>)}</div>}
    </>
  );
}
