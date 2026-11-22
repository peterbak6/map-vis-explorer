import type {ReactNode} from 'react';
import {PALETTES} from '../pipeline/color.ts';

/** Choice button; disabled choices stay discoverable and explain how to enable them. */
export function Choice({label, active, hint = '', onClick, children}: {label: string; active: boolean; hint?: string; onClick: () => void; children?: ReactNode}) {
  const disabled = !!hint;
  return (
    <span className="choice" data-hint={disabled ? hint : undefined} tabIndex={disabled ? 0 : undefined} aria-label={disabled ? `${label}. ${hint}` : undefined}>
      <button type="button" disabled={disabled} aria-pressed={active} className={active ? 'active' : ''} onClick={onClick}>
        {children}<span>{label}</span>
      </button>
    </span>
  );
}

export function Group<T extends string | number>({title, items, value, reason, onChange, cards = false, note}: {
  title: string; items: [T, string][]; value: T; reason: (v: T) => string; onChange: (v: T) => void; cards?: boolean; note?: string;
}) {
  const allOff = items.every(([v]) => reason(v));
  return (
    <fieldset className={allOff ? 'inactive' : ''}>
      <legend>{title}</legend>
      <div className={cards ? 'cards' : 'segments'}>
        {items.map(([v, label]) => (
          <Choice key={String(v)} label={label} active={value === v && !reason(v)} hint={reason(v)} onClick={() => onChange(v)}>
            {cards && <Mini kind={String(v)} />}
          </Choice>
        ))}
      </div>
      {allOff && <span className="reason">{reason(items[0][0])}</span>}
      {note && !allOff && <span className="reason">{note}</span>}
    </fieldset>
  );
}

export function Slider({label, value, min, max, step, format = String, onChange, disabled}: {label: string; value: number; min: number; max: number; step: number; format?: (v: number) => string; onChange: (v: number) => void; disabled?: string}) {
  return (
    <label className={`slider-control ${disabled ? 'off' : ''}`} title={disabled || undefined}>
      {label} <output>{format(value)}</output>
      <input aria-label={label} type="range" min={min} max={max} step={step} value={value} disabled={!!disabled} onChange={e => onChange(+e.target.value)} />
    </label>
  );
}

export function Palettes({value, reason, onChange}: {value: string; reason: (id: string) => string; onChange: (id: string) => void}) {
  return (
    <div className="palettes" role="group" aria-label="Palette">
      {PALETTES.map(p => {
        const hint = reason(p.id);
        const stops = p.scheme ? p.scheme.slice(0, 6) : [0, 0.25, 0.5, 0.75, 1].map(t => p.interp!(t));
        return (
          <span key={p.id} className="choice" data-hint={hint || undefined} tabIndex={hint ? 0 : undefined}>
            <button type="button" className={`swatch ${value === p.id && !hint ? 'active' : ''}`} disabled={!!hint} aria-pressed={value === p.id} aria-label={p.label} title={hint ? undefined : p.label} onClick={() => onChange(p.id)}>
              <i style={{background: p.scheme ? `linear-gradient(90deg,${stops.map((c, i) => `${c} ${(i / stops.length) * 100}% ${((i + 1) / stops.length) * 100}%`).join(',')})` : `linear-gradient(90deg,${stops.join(',')})`}} />
            </button>
          </span>
        );
      })}
    </div>
  );
}

/** Compact schematics in the course's charcoal/orange visual grammar. */
export function Mini({kind}: {kind: string}) {
  const c = 'currentColor', soft = '#ddd8d2';
  const land = <path d="M8 9 L30 5 L52 8 L69 15 L66 31 L44 36 L20 34 L7 24Z" fill="none" stroke={soft} strokeWidth="1.5" />;
  const content: Record<string, ReactNode> = {
    symbol: <>{land}<circle cx="25" cy="18" r="6" fill={c} opacity=".85" /><circle cx="48" cy="14" r="3.5" fill={c} opacity=".85" /><circle cx="50" cy="27" r="8" fill={c} opacity=".85" /><circle cx="17" cy="28" r="2.5" fill={c} opacity=".85" /></>,
    circle: <>{land}<circle cx="28" cy="20" r="7" fill={c} /><circle cx="49" cy="22" r="4" fill={c} /></>,
    square: <>{land}<rect x="21" y="13" width="14" height="14" fill={c} /><rect x="45" y="18" width="8" height="8" fill={c} /></>,
    choropleth: <><path d="M8 9 L30 5 L32 20 L10 24Z" fill={c} opacity=".9" /><path d="M30 5 L52 8 L50 22 L32 20Z" fill={c} opacity=".45" /><path d="M52 8 L69 15 L66 31 L50 22Z" fill={c} opacity=".7" /><path d="M10 24 L32 20 L44 36 L20 34Z" fill={c} opacity=".25" /><path d="M32 20 L50 22 L66 31 L44 36Z" fill={c} opacity=".6" /></>,
    native: <><path d="M8 9 L30 5 L32 20 L10 24Z" fill={c} opacity=".8" /><path d="M30 5 L52 8 L50 22 L32 20Z" fill={c} opacity=".35" /><path d="M52 8 L69 15 L66 31 L50 22Z" fill={c} opacity=".6" /><path d="M10 24 L32 20 L50 22 L66 31 L44 36 L20 34Z" fill={c} opacity=".2" /></>,
    voronoi: <>{land}<path d="M8 22 L28 18 L38 6 M28 18 L36 34 M28 18 L46 20 L56 8 M46 20 L52 34 M46 20 L68 22" fill="none" stroke={c} strokeWidth="1.3" />{[[18, 12], [18, 28], [44, 12], [40, 28], [60, 16], [60, 28]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.6" fill={c} />)}</>,
    cartogram: <><circle cx="22" cy="18" r="9" fill={c} opacity=".75" /><circle cx="40" cy="14" r="5" fill={c} opacity=".45" /><circle cx="50" cy="27" r="10" fill={c} opacity=".9" /><circle cx="32" cy="31" r="4" fill={c} opacity=".35" /></>,
    dorling: <><circle cx="22" cy="18" r="9" fill={c} opacity=".75" /><circle cx="40" cy="14" r="5" fill={c} opacity=".45" /><circle cx="50" cy="27" r="10" fill={c} opacity=".9" /><circle cx="32" cy="31" r="4" fill={c} opacity=".35" /></>,
    demers: <><rect x="12" y="9" width="17" height="17" fill={c} opacity=".75" /><rect x="31" y="8" width="10" height="10" fill={c} opacity=".45" /><rect x="41" y="17" width="19" height="19" fill={c} opacity=".9" /><rect x="30" y="27" width="8" height="8" fill={c} opacity=".35" /></>,
    noncontiguous: <>{land}<path d="M14 11 L28 9 L29 19 L16 21Z" fill={c} opacity=".8" /><path d="M38 10 L46 11 L45 17 L39 16Z" fill={c} opacity=".5" /><path d="M50 13 L66 18 L63 31 L48 25Z" fill={c} opacity=".9" /><path d="M26 27 L32 26 L34 31 L27 31Z" fill={c} opacity=".4" /></>,
    contiguous: <><path d="M6 12 Q20 2 34 8 Q36 18 32 24 Q16 28 6 22Z" fill={c} opacity=".8" /><path d="M34 8 Q46 6 52 12 Q50 20 40 22 L32 24 Q36 18 34 8Z" fill={c} opacity=".4" /><path d="M52 12 Q72 14 70 30 Q56 38 40 30 L40 22 Q50 20 52 12Z" fill={c} opacity=".9" /><path d="M6 22 Q16 28 32 24 L40 22 L40 30 Q28 38 10 32Z" fill={c} opacity=".25" /></>,
    heatmap: <>{[[14, 12, .3], [26, 12, .6], [38, 12, .9], [50, 12, .5], [20, 22, .5], [32, 22, 1], [44, 22, .8], [56, 22, .3], [26, 32, .25], [38, 32, .5], [50, 32, .2]].map(([x, y, o], i) => <path key={i} d={`M${x} ${y - 6}l5.2 3v6l-5.2 3l-5.2 -3v-6Z`} fill={c} opacity={o} />)}</>,
    hex: <>{[[14, 12, .3], [26, 12, .6], [38, 12, .9], [50, 12, .5], [20, 22, .5], [32, 22, 1], [44, 22, .8], [56, 22, .3], [26, 32, .25], [38, 32, .5], [50, 32, .2]].map(([x, y, o], i) => <path key={i} d={`M${x} ${y - 6}l5.2 3v6l-5.2 3l-5.2 -3v-6Z`} fill={c} opacity={o} />)}</>,
    grid: <>{[0, 1, 2, 3, 4].flatMap(col => [0, 1, 2].map(row => <rect key={`${col}${row}`} x={12 + col * 11} y={4 + row * 11} width="10" height="10" fill={c} opacity={[.2, .5, .9, .4, .15, .35, .8, 1, .6, .2, .1, .3, .5, .3, .1][col * 3 + row]} />))}</>,
    pixel: <><defs><radialGradient id="mg"><stop offset="0" stopColor={c} stopOpacity=".95" /><stop offset="1" stopColor={c} stopOpacity="0" /></radialGradient></defs><ellipse cx="30" cy="20" rx="16" ry="12" fill="url(#mg)" /><ellipse cx="52" cy="24" rx="11" ry="9" fill="url(#mg)" /></>,
    flow: <><circle cx="12" cy="28" r="2.5" fill={c} /><path d="M12 28 Q36 2 64 12" fill="none" stroke={c} strokeWidth="3.5" /><path d="M12 28 Q38 22 62 30" fill="none" stroke={c} strokeWidth="1.6" opacity=".6" /><circle cx="64" cy="12" r="2" fill={c} /><circle cx="62" cy="30" r="2" fill={c} /></>,
    straight: <><path d="M10 30 L66 10 M10 30 L62 32" fill="none" stroke={c} strokeWidth="2.5" /></>,
    arc: <><path d="M10 30 Q36 2 66 10 M10 30 Q36 20 62 32" fill="none" stroke={c} strokeWidth="2.5" /></>,
    arrow: <><path d="M10 26 Q34 4 56 9 L55 4 L68 11 L54 17 L55 12 Q34 10 10 32Z" fill={c} /></>,
  };
  return <svg viewBox="0 0 76 40" aria-hidden="true">{content[kind] ?? land}</svg>;
}
