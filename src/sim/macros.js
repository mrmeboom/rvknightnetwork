import { cloneParams, getPath, setPath, clampToSchema } from './params.js';

// A macro value m is in [0, 1]; 0.5 is neutral. Each mapped path is multiplied by k^((m-0.5)*2),
// so m=1 gives k times the default and m=0 gives 1/k.
export const MACROS = {
  tempo: {
    label: 'Tempo',
    mul: { 'global.speedScale': 2, 'global.wander': 1.6, 'global.pathMemory': 1.3 },
  },
  promiscuity: {
    label: 'Promiscuity',
    mul: { 'links.connect': 1.5, 'links.capScale': 1.5, 'links.fatigue': 0.5, 'magnet.strength': 2.5 },
  },
  tension: {
    label: 'Tension',
    mul: { 'links.pull': 3, 'links.breakFactor': 1.25, 'links.align': 2.5 },
  },
};

export function applyMacros(params, values = {}) {
  const out = cloneParams(params);
  for (const [name, m] of Object.entries(values)) {
    const macro = MACROS[name];
    if (!macro) continue;
    for (const [path, k] of Object.entries(macro.mul)) {
      const f = Math.pow(k, (m - 0.5) * 2);
      const cur = getPath(out, path);
      setPath(out, path, clampToSchema(path, Array.isArray(cur) ? cur.map((v) => v * f) : cur * f));
    }
  }
  return out;
}
