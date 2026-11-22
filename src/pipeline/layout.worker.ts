/// <reference lib="webworker" />
import {separateSteps} from './geometry.ts';

/** Runs a Dorling/Demers separation off the main thread, posting intermediate positions as it settles. */
self.onmessage = (ev: MessageEvent<{key: string; xyr: Float64Array; shape: 'circle' | 'square'}>) => {
  const {key, xyr, shape} = ev.data;
  const n = xyr.length / 3;
  const start = Array.from({length: n}, (_, i) => ({x: xyr[3 * i], y: xyr[3 * i + 1], r: xyr[3 * i + 2]}));
  separateSteps(start, shape, (placed, done) => {
    const out = new Float64Array(n * 2);
    placed.forEach((p, i) => { out[2 * i] = p.x; out[2 * i + 1] = p.y; });
    (self as unknown as Worker).postMessage({key, xy: out, done}, [out.buffer]);
  });
};
