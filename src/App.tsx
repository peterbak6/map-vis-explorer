import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {loadDataset, loadManifest, type Loaded, type ManifestEntry} from './data.ts';
import type {MapType, Settings, Unit} from './types.ts';
import {aggregate, measureValue, SUMMARY_LABELS, summariesFor} from './pipeline/aggregate.ts';
import {initialSettings, MAP_TYPES, PROJECTIONS, resolve, VARIANTS} from './pipeline/options.ts';
import {formatValue} from './pipeline/scene.ts';
import {applyTime, DAYS} from './pipeline/time.ts';
import {Choice, Group, Palettes, Slider} from './ui/Controls.tsx';
import {ColorLegend, SizeLegendView} from './ui/Legend.tsx';
import {MapView, useScene} from './ui/MapView.tsx';

export default function App() {
  const [manifest, setManifest] = useState<ManifestEntry[]>([]);
  const [datasetId, setDatasetId] = useState('');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const onBusy = useCallback((b: boolean) => setBusy(b), []);

  useEffect(() => { loadManifest().then(m => { setManifest(m); setDatasetId(m.find(x => x.status === 'ready')?.id ?? ''); }).catch(e => setError(String(e.message))); }, []);
  useEffect(() => {
    const entry = manifest.find(m => m.id === datasetId);
    if (!entry || entry.status !== 'ready') return;
    setLoaded(null);
    loadDataset(entry).then(l => {
      setLoaded(l);
      // Keep encoding choices across datasets; reset what is dataset-specific.
      setSettings(prev => { const init = initialSettings(l.ds); return prev ? {...prev, level: init.level, measure: init.measure, sizeMeasure: init.sizeMeasure, projection: init.projection, basemap: init.basemap, variant: {...prev.variant, choropleth: init.variant.choropleth}} : init; });
    }).catch(e => setError(`Could not load ${entry.title}: ${e.message}`));
  }, [manifest, datasetId]);

  return (
    <>
      <header>
        <div className="brand"><img src={`${import.meta.env.BASE_URL}map.svg`} alt="" width={27} height={27} /><h1>Map Vis Explorer</h1></div>
        <label className="dataset-picker"><span>DATASET</span>
          <select value={datasetId} disabled={busy} onChange={e => setDatasetId(e.target.value)}>
            {manifest.map(m => <option key={m.id} value={m.id} disabled={m.status !== 'ready'}>{m.title}{m.status !== 'ready' ? ' — data not prepared' : ''}</option>)}
          </select>
        </label>
      </header>
      {error ? <main><div className="status">{error}</div></main>
        : loaded && settings ? <Explorer loaded={loaded} s={settings} setS={setSettings as (f: (s: Settings) => Settings) => void} entry={manifest.find(m => m.id === datasetId)!} onBusy={onBusy} />
        : <main><div className="status">Loading…</div></main>}
    </>
  );
}

function Explorer({loaded: raw, s, setS, onBusy}: {loaded: Loaded; s: Settings; setS: (f: (s: Settings) => Settings) => void; entry: ManifestEntry; onBusy: (b: boolean) => void}) {
  // The time filter re-derives flows and flow-based feature fields before anything else.
  const dayKey = s.days.join(','), hourKey = s.hours.join('-');
  const loaded = useMemo<Loaded>(() => ({...raw, ds: applyTime(raw.ds, {days: s.days, hours: s.hours})}), [raw, dayKey, hourKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const {ds, shapes} = loaded;
  const [selected, setSelected] = useState<string | null>(null);
  const onSelect = useCallback((id: string | null) => setSelected(id), []);
  const unitsByLevel = useMemo(() => Object.fromEntries(ds.levels.map(l => [l.id, aggregate(ds, l, shapes[l.id])])) as Record<string, Unit[]>, [ds, shapes]);
  const unitCounts = useMemo(() => Object.fromEntries(Object.entries(unitsByLevel).map(([k, v]) => [k, v.length])), [unitsByLevel]);

  // Resolve structure first, then use the displayed values to decide scale availability.
  const first = resolve(ds, s, {unitCounts});
  const units = unitsByLevel[first.e.level];
  const focus = selected && units.some(u => u.id === selected) ? selected : null;
  const measure = ds.measures.find(m => m.id === first.e.measure)!;
  const minValue = useMemo(() => {
    let min = Infinity;
    for (const u of units) {
      let v = measureValue(ds, measure, u, first.e.summary);
      if (v != null && first.e.normalize === 'area') v = u.areaKm2 ? v / u.areaKm2 : null;
      if (v != null && v < min) min = v;
    }
    return min;
  }, [ds, units, measure, first.e.summary, first.e.normalize]);
  const resolved = resolve(ds, s, {unitCounts, minValue, focus, cartoKey: !!import.meta.env.VITE_CARTO_KEY});
  const why = resolved.why;
  // Stable identity: re-renders that don't change settings (hover, selection) must not rebuild the scene.
  const eKey = JSON.stringify(resolved.e);
  const e = useMemo(() => resolved.e, [eKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const level = ds.levels.find(l => l.id === e.level)!;
  const reason = (key: string) => (v: string | number) => why.get(`${key}:${v}`) ?? '';
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS(p => ({...p, [k]: v}));

  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({w: 900, h: 560});
  useLayoutEffect(() => {
    const el = hostRef.current!; const ro = new ResizeObserver(([en]) => { const w = Math.round(en.contentRect.width); setSize({w, h: Math.round(Math.max(420, Math.min(760, w * 0.6)))}); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const {path, projection, scene, progress} = useScene(loaded, units, level, e, size, e.mapType === 'flow' ? focus : null);
  const busy = progress != null;
  useEffect(() => onBusy(busy), [busy, onBusy]);
  useEffect(() => setSelected(null), [raw.ds, e.level, e.mapType]); // keep the focus while the time filter changes

  const t = e.mapType;
  const sizeUsed = t === 'symbol' || t === 'cartogram';
  const colorMeasures = ds.measures.map(m => [m.id, m.label] as [string, string]);
  const quickMeasures = ds.measures.slice(0, 6);
  const fmt = (v: number) => (t === 'flow' ? new Intl.NumberFormat('en').format(Math.round(v)) : formatValue(measure, v, e.normalize === 'area').replace(' /km²', ''));
  const perArea = e.normalize === 'area';

  return (
    <div className="workspace">
      <aside className={busy ? 'busy' : ''} inert={busy} aria-busy={busy}>
        <div className="eyebrow">MAP</div>
        <Group title="Map type" cards items={MAP_TYPES} value={t} reason={reason('mapType')} onChange={v => set('mapType', v as MapType)} />
        <Group title="Variant" cards items={VARIANTS[t]} value={e.variant[t]} reason={reason('variant')} onChange={v => setS(p => ({...p, variant: {...p.variant, [t]: v}}))} />

        {!why.get('time:') && <>
        <div className="eyebrow">TIME</div>
        <fieldset>
          <legend>Days</legend>
          <div className="segments days">
            {DAYS.map((d, i) => <Choice key={d} label={d} active={e.days.includes(i)} hint={why.get('time:') ?? ''}
              onClick={() => set('days', e.days.includes(i) ? e.days.filter(x => x !== i) : [...e.days, i].sort())} />)}
          </div>
          <div className="segments presets">
            {([['All', [0, 1, 2, 3, 4, 5, 6]], ['Weekdays', [0, 1, 2, 3, 4]], ['Weekend', [5, 6]]] as [string, number[]][]).map(([label, d]) =>
              <Choice key={label} label={label} active={e.days.join() === d.join()} hint={why.get('time:') ?? ''} onClick={() => set('days', d)} />)}
          </div>
          {why.get('time:') ? <span className="reason">{why.get('time:')}</span> : <span className="reason">{ds.time?.basis}</span>}
        </fieldset>
        <Slider label="From" value={e.hours[0]} min={0} max={23} step={1} format={v => `${String(v).padStart(2, '0')}:00`} onChange={v => set('hours', [v, Math.max(v + 1, e.hours[1])])} disabled={why.get('time:')} />
        <Slider label="To" value={e.hours[1]} min={1} max={24} step={1} format={v => `${String(v).padStart(2, '0')}:00`} onChange={v => set('hours', [Math.min(e.hours[0], v - 1), v])} disabled={why.get('time:')} />
        </>}

        {t === 'flow' && <>
        <div className="eyebrow">FLOW</div>
        <Group title="Selected station" items={[['both', 'Both'], ['out', 'Leaving'], ['in', 'Arriving']]} value={e.flowDirection} reason={v => why.get(`flow:${v}`) ?? ''} onChange={v => set('flowDirection', v)} />
        <Group title="Mode" items={[['gross', 'Gross'], ['net', 'Net']]} value={e.flowMode} reason={v => why.get(`flow:${v}`) ?? ''} onChange={v => set('flowMode', v)} />
        <Slider label="Top flows" value={e.topN} min={10} max={1000} step={10} onChange={v => set('topN', v)} />
        </>}

        <div className="eyebrow">AGGREGATION</div>
        <Group title="Level" items={ds.levels.map(l => [l.id, l.label] as [string, string])} value={e.level} reason={() => ''} onChange={v => set('level', v)} note={`${unitCounts[e.level]?.toLocaleString('en')} units`} />
        <Group title="Summary" items={(['pooled', 'weighted', 'mean', 'median', 'min', 'max'] as const).filter(k => summariesFor(measure).includes(k) || k === 'pooled').map(k => [k, k === 'pooled' && measure.kind !== 'ratio' ? (measure.kind === 'median' ? 'Pooled' : 'Total') : SUMMARY_LABELS[k]] as [typeof k, string])}
          value={e.summary} reason={reason('summary')} onChange={v => set('summary', v)} />

        <div className="eyebrow">COLOR</div>
        <fieldset className={t === 'flow' ? 'inactive' : ''}>
          <legend>Measure</legend>
          <select className="measure-select" value={e.measure} disabled={t === 'flow'} onChange={ev => set('measure', ev.target.value)}>
            {colorMeasures.map(([id, label]) => <option key={id} value={id} disabled={!!why.get(`measure:${id}`) && t !== 'flow'}>{label}{why.get(`measure:${id}`) && t !== 'flow' ? ' — n/a for this map' : ''}</option>)}
          </select>
          {t === 'flow' ? <span className="reason">Flows are coloured by trip volume.</span> : s.measure !== e.measure ? <span className="reason">{why.get(`measure:${s.measure}`)}</span> : null}
        </fieldset>
        <Group title="Normalize" items={[['none', 'None'], ['area', 'Per km²']]} value={e.normalize} reason={reason('normalize')} onChange={v => set('normalize', v)} />
        <Group title="Classing" items={[['continuous', 'Continuous'], ['equal', 'Equal'], ['quantile', 'Quantile'], ['jenks', 'Natural']]} value={e.classing} reason={reason('classing')} onChange={v => set('classing', v)} />
        <Group title="Bins" items={[[3, '3'], [5, '5'], [7, '7'], [9, '9']]} value={e.bins} reason={reason('bins')} onChange={v => set('bins', v)} />
        <Group title="Scale" items={[['linear', 'Linear'], ['sqrt', '√'], ['log', 'Log']]} value={e.scale} reason={reason('scale')} onChange={v => set('scale', v)} />
        <fieldset><legend>Palette</legend><Palettes value={e.palette} reason={id => why.get(`palette:${id}`) ?? ''} onChange={v => set('palette', v)} /></fieldset>
        <Group title="Midpoint" items={[['median', 'Median'], ['mean', 'Mean'], ['zero', 'Zero']]} value={e.midpoint} reason={reason('midpoint')} onChange={v => set('midpoint', v)} />

        {(sizeUsed || t === 'flow') && <>
        <div className="eyebrow">SIZE</div>
        <fieldset>
          <legend>Size measure</legend>
          <select className="measure-select" value={t === 'flow' ? '__trips' : e.sizeMeasure} disabled={!sizeUsed} onChange={ev => set('sizeMeasure', ev.target.value)}>
            {t === 'flow' && <option value="__trips">Trips</option>}
            {t !== 'flow' && <option value="" disabled={!!why.get('size:')}>Fixed size</option>}
            {t !== 'flow' && ds.measures.map(m => <option key={m.id} value={m.id} disabled={!!why.get(`size:${m.id}`)}>{m.label}</option>)}
          </select>
        </fieldset>
        <Slider label={t === 'flow' ? 'Max width' : 'Max size'} value={e.maxSize} min={4} max={60} step={1} format={v => `${v}px`} onChange={v => set('maxSize', v)} />
        </>}

        {t === 'heatmap' && <>
        <div className="eyebrow">HEATMAP</div>
        <Slider label={e.variant.heatmap === 'pixel' ? 'Bandwidth' : 'Cell size'} value={e.cellSize} min={6} max={60} step={1} format={v => `${v}px`} onChange={v => set('cellSize', v)} />
        </>}


        <div className="eyebrow sp">APPEARANCE</div>
        <Slider label="Opacity" value={e.opacity} min={0.1} max={1} step={0.05} format={v => `${Math.round(v * 100)}%`} onChange={v => set('opacity', v)} />
        <Group title="Outline" items={[['none', 'None'], ['thin', 'Thin'], ['bold', 'Bold']]} value={e.outline} reason={() => ''} onChange={v => set('outline', v)} />
        <Group title="Projection" items={PROJECTIONS[ds.region]} value={e.projection} reason={() => ''} onChange={v => set('projection', v)} />
        <Group title="Basemap" items={[['none', 'None'], ['osm', 'OSM'], ['light', 'Light'], ['dark', 'Dark'], ['voyager', 'Voyager']]} value={e.basemap} reason={v => why.get(`basemap:${v}`) ?? ''} onChange={v => set('basemap', v)} />
        <p className="panel-foot">Each choice redraws the same data.</p>
        <p className="data-source-link" style={{opacity: 0.75}}>© 2026 Peter Bak · <a href="https://visualanalytics.co.il" target="_blank" rel="noopener noreferrer" style={{color: 'inherit', textDecoration: 'underline'}}>VisualAnalytics</a></p>
      </aside>

      <main>
        <fieldset className="measurement-bar" disabled={busy}>
          <legend>Measure</legend>
          <div className="segments">
            {quickMeasures.map(m => <span className="choice" key={m.id} data-hint={why.get(`measure:${m.id}`) || undefined}><button type="button" className={e.measure === m.id && t !== 'flow' ? 'active' : ''} disabled={!!why.get(`measure:${m.id}`)} onClick={() => set('measure', m.id)}>{m.label}</button></span>)}
          </div>
        </fieldset>
        <section className="chart-card">
          <div className="chart-heading">
            <div><h2>{scene.title}</h2><p>{scene.subtitle}{scene.derived ? ` · ${scene.derived}` : ''}</p></div>
            <span>{ds.title}</span>
          </div>
          <div className="chart-host" ref={hostRef} style={{height: size.h}}>
            <MapView loaded={loaded} scene={scene} path={path} projection={projection} e={e} selected={selected} onSelect={onSelect} size={size} hostRef={hostRef} />
            {t === 'flow' && (
              <div className="map-chip">
                {focus ? <>Flows {e.flowDirection === 'out' ? 'leaving' : e.flowDirection === 'in' ? 'arriving at' : 'to and from'} <b>{units.find(u => u.id === focus)?.name}</b>
                  <button type="button" aria-label="Show all flows" onClick={() => setSelected(null)}>×</button></>
                  : <>Click a station to show only its flows</>}
              </div>
            )}
            {busy && (
              <div className="progress" role="progressbar" aria-label="Computing cartogram layout" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress! * 100)}>
                <span>Computing {e.variant.cartogram === 'demers' ? 'Demers' : 'Dorling'} layout · {Math.round(progress! * 100)}%</span>
                <i><b style={{width: `${progress! * 100}%`}} /></i>
              </div>
            )}
          </div>
          <div className="legends">
            <ColorLegend color={scene.color} format={fmt} title={t === 'flow' ? 'Trips' : `${measure.label}${perArea ? ' per km²' : ''}${scene.raster ? ' — relative density' : ''}`} rampOnly={!!scene.raster} />
            {scene.size && <SizeLegendView size={scene.size} title={t === 'flow' ? 'Width' : ds.measures.find(m => m.id === e.sizeMeasure)?.label ?? 'Size'} />}
          </div>
          <p className="chart-hint">Click a mark to highlight · Hover for values · Scroll to zoom, drag to pan, double-click to reset</p>
        </section>
        <footer>
          <span>{ds.subtitle} · <a href={ds.source}>Source</a> · {ds.attribution}</span>
          {ds.note && <span>{ds.note}</span>}
        </footer>
      </main>
    </div>
  );
}
