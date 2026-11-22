import type {Dataset, RawFeature, Settings} from '../types.ts';

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const isAllTime = (s: Pick<Settings, 'days' | 'hours'>) => s.days.length === 7 && s.hours[0] === 0 && s.hours[1] === 24;
export const slotOn = (slot: number, s: Pick<Settings, 'days' | 'hours'>) => {
  const day = Math.floor(slot / 24), hour = slot % 24;
  return s.days.includes(day) && hour >= s.hours[0] && hour < s.hours[1];
};

/** Human-readable filter, e.g. "Mon–Fri · 07–09". Empty when everything is selected. */
export function timeText(s: Pick<Settings, 'days' | 'hours'>): string {
  if (isAllTime(s)) return '';
  const d = [...s.days].sort();
  const runs: string[] = [];
  for (let i = 0; i < d.length; i++) {
    let j = i; while (j + 1 < d.length && d[j + 1] === d[j] + 1) j++;
    runs.push(j > i + 1 ? `${DAYS[d[i]]}–${DAYS[d[j]]}` : j === i + 1 ? `${DAYS[d[i]]}, ${DAYS[d[j]]}` : DAYS[d[i]]);
    i = j;
  }
  const days = d.length === 7 ? 'All days' : d.length ? runs.join(', ') : 'No days';
  const pad = (h: number) => String(h).padStart(2, '0');
  const hours = s.hours[0] === 0 && s.hours[1] === 24 ? '' : ` · ${pad(s.hours[0])}–${pad(s.hours[1])}`;
  return days + hours;
}

/**
 * Apply the time filter: flow volumes and slot fields are summed over the selected slots, and
 * feature fields declared in `flowDerived` are recomputed from the filtered flows.
 * Datasets without time are returned unchanged.
 */
export function applyTime(ds: Dataset, s: Pick<Settings, 'days' | 'hours'>): Dataset {
  if (!ds.time || !ds.flows) return ds;
  const sf = ds.time.slotFields;
  const all = isAllTime(s) && s.days.length === ALL_DAYS.length;
  const flows = ds.flows.map(f => {
    const tot = new Array(sf.length).fill(0);
    for (const row of f.slots ?? []) if (all || slotOn(row[0], s)) for (let k = 0; k < sf.length; k++) tot[k] += row[k + 1] ?? 0;
    return {...f, n: f.slots ? tot[0] : f.n, vals: tot};
  });
  if (!ds.flowDerived) return {...ds, flows};
  const fieldIdx = Object.fromEntries(ds.fields.map((f, i) => [f, i]));
  const acc = new Map<string, number[]>();
  const get = (id: string) => { let a = acc.get(id); if (!a) { a = new Array(ds.fields.length).fill(0); acc.set(id, a); } return a; };
  const rules = Object.entries(ds.flowDerived).map(([field, rule]) => {
    const [dir, src] = rule.split(':');
    return {i: fieldIdx[field], dir, k: sf.indexOf(src)};
  }).filter(r => r.i != null && r.k >= 0);
  for (const f of flows) {
    for (const r of rules) {
      const v = f.vals[r.k];
      if (r.dir === 'out') get(f.o)[r.i] += v;
      else if (r.dir === 'in') get(f.d)[r.i] += v;
      else if (r.dir === 'self') { if (f.o === f.d) get(f.o)[r.i] += v; }
      else if (r.dir === 'net') { get(f.o)[r.i] += v; get(f.d)[r.i] -= v; }
    }
  }
  const features: RawFeature[] = ds.features.map(ft => {
    const a = acc.get(ft.id);
    const v = ft.v.slice();
    for (const r of rules) v[r.i] = a ? Math.round(a[r.i] * 10) / 10 : 0;
    return {...ft, v};
  });
  return {...ds, features, flows: flows.map(({vals: _v, ...f}) => f)};
}
