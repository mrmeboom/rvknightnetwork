import { SCHEMA } from '../sim/params.js';
import { LOOK_SCHEMA } from './look.js';

// The handful of controls that shape the piece, shown first in the panel. Every other parameter is still
// there, tucked into the collapsed Advanced groups below.
export const ESSENTIALS = [
  { title: 'Population', paths: ['world.maxAlive', 'world.lifeMin', 'world.lifeMax', 'world.stars', 'global.individuality'] },
  { title: 'Motion', paths: ['global.speedScale', 'global.wander', 'global.pathMemory'] },
  { title: 'Links', paths: ['links.connect', 'links.breakFactor', 'links.pull', 'links.fatigue', 'links.capScale', 'links.variety', 'magnet.strength', 'grab.authority'] },
  { title: 'Depth and view', paths: ['world.depthScale', 'view.zoom', 'look.perspective', 'look.focusDepth', 'look.focusFalloff'] },
  { title: 'Look', paths: ['look.labels', 'look.labelSize', 'look.trails', 'look.trailStrength', 'sky.patches', 'sky.stars', 'look.grain'] },
];

// Parameters shown elsewhere in the panel (the Run section) and so left out of the lists below.
const ELSEWHERE = new Set(['run.timeScale', 'look.labelRotate']);

// Splits every parameter into the Essentials sections and the Advanced groups. Each appears exactly once.
export function splitSchema() {
  const all = new Map();
  for (const e of SCHEMA) all.set(e.path, { ...e, src: 'sim' });
  for (const e of LOOK_SCHEMA) all.set(e.path, { ...e, src: 'look' });
  const used = new Set();
  const essentials = ESSENTIALS.map(({ title, paths }) => ({
    title,
    entries: paths.map((p) => {
      const e = all.get(p);
      if (!e) throw new Error(`Essential parameter "${p}" does not exist`);
      used.add(p);
      return e;
    }),
  }));
  const advanced = new Map();
  for (const e of all.values()) {
    if (used.has(e.path) || ELSEWHERE.has(e.path)) continue;
    if (!advanced.has(e.group)) advanced.set(e.group, []);
    advanced.get(e.group).push(e);
  }
  return { essentials, advanced };
}
