import * as d3 from 'd3';
import type {ColorScale} from '../pipeline/color.ts';
import type {SizeLegend} from '../pipeline/scene.ts';

/** Colour legend: a histogram of displayed values with the colour ramp and class breaks drawn on it. */
export function ColorLegend({color, format, title, rampOnly = false}: {color: ColorScale; format: (v: number) => string; title: string; rampOnly?: boolean}) {
  const L = color.legend;
  if (L.kind === 'categorical') {
    return (
      <div className="legend">
        <div className="legend-title">{title}</div>
        <div className="cat-legend">{L.categories!.map(c => <span key={c.label}><i style={{background: c.color}} />{c.label} <small>{c.count}</small></span>)}</div>
      </div>
    );
  }
  if (!L.values.length) return null;
  const W = 300, H = 46, top = 4, barY = top + H + 2;
  const [lo, hi] = L.domain;
  const x = d3.scaleLinear().domain([lo, hi === lo ? lo + 1 : hi]).range([0, W]);
  const bins = d3.bin().domain(x.domain() as [number, number]).thresholds(40)(L.values);
  const y = d3.scaleLinear().domain([0, d3.max(bins, b => b.length) || 1]).range([0, H]);
  const ticks = L.kind === 'classed' ? [lo, ...L.breaks, hi] : x.ticks(4);
  const stepColor = (v: number) => color.color(v);
  return (
    <div className="legend">
      <div className="legend-title">{title}</div>
      <svg viewBox={`-6 0 ${W + 12} ${barY + 26}`} role="img" aria-label={`Colour legend from ${format(lo)} to ${format(hi)}`}>
        {!rampOnly && bins.map((b, i) => <rect key={i} x={x(b.x0!) + 0.5} y={top + H - y(b.length)} width={Math.max(0, x(b.x1!) - x(b.x0!) - 1)} height={y(b.length)} fill={stepColor((b.x0! + b.x1!) / 2)} />)}
        {d3.range(0, 60).map(i => { const v = lo + ((hi - lo) * (i + 0.5)) / 60; return <rect key={'r' + i} x={(W * i) / 60} y={barY} width={W / 60 + 0.4} height={8} fill={stepColor(v)} />; })}
        {L.kind === 'classed' && L.breaks.map((b, i) => <line key={'b' + i} x1={x(b)} x2={x(b)} y1={top} y2={barY + 10} stroke="#373335" strokeWidth="1" strokeDasharray="2 2" />)}
        {L.mid != null && <line x1={x(L.mid)} x2={x(L.mid)} y1={top} y2={barY + 10} stroke="#373335" strokeWidth="1.5" />}
        {rampOnly ? <><text x={0} y={barY + 22}>Low</text><text x={W} y={barY + 22} textAnchor="end">High</text></> : ticks.map((t, i) => <text key={'t' + i} x={x(t)} y={barY + 22} textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>{format(t)}</text>)}
      </svg>
    </div>
  );
}

export function SizeLegendView({size, title}: {size: SizeLegend; title: string}) {
  if (!size.items.length) return null;
  const maxS = d3.max(size.items, d => d.size) ?? 10;
  const H = Math.max(24, maxS * 2 + 6);
  let x = 4;
  return (
    <div className="legend">
      <div className="legend-title">{title}</div>
      {/* Drawn at the map's own pixel scale (no CSS stretching) so sizes match the marks at 1× zoom. */}
      <svg className="exact" width={300} height={H + 16} viewBox={`0 0 300 ${H + 16}`} role="img" aria-label="Size legend">
        {size.items.map((d, i) => {
          const w = size.kind === 'width' ? 46 : d.size * 2;
          const cx = x + w / 2; x += w + 46;
          const shape = size.kind === 'circle' ? <circle cx={cx} cy={H - d.size} r={d.size} fill="none" stroke="#625d58" />
            : size.kind === 'square' ? <rect x={cx - d.size} y={H - 2 * d.size} width={d.size * 2} height={d.size * 2} fill="none" stroke="#625d58" />
            : <line x1={cx - 22} x2={cx + 22} y1={H - maxS} y2={H - maxS} stroke="#625d58" strokeWidth={Math.max(0.5, d.size)} />;
          return <g key={i}>{shape}<text x={cx} y={H + 13} textAnchor="middle">{d.label}</text></g>;
        })}
      </svg>
    </div>
  );
}
