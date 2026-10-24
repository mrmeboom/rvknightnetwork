import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { World } from '../src/sim/world.js';
import { TYPES } from '../src/sim/params.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// A fixed slice of nodes.json (the first of each category), so the tests do not slow down or change meaning
// every time the real list grows.
const ALL_NODES = JSON.parse(readFileSync(join(root, 'nodes.json'), 'utf8')).nodes;
const TAKE = { venue: 12, artist: 16, genre: 12, theme: 8, event: 19 };
export const NODE_LIST = Object.entries(TAKE).flatMap(([type, n]) => ALL_NODES.filter((x) => x.type === type).slice(0, n));

// By default everything on the list is alive at once (no cap), so tests can look up any node by name.
export function makeWorld(opts = {}) {
  const params = merge({ world: { maxAlive: 999 } }, opts.params || {});
  return new World({ seed: 'test', nodes: NODE_LIST, ...opts, params });
}

// Everything that moves nodes or links on its own switched off, for controlled physics tests.
export const QUIET = {
  global: { speedScale: 1, wander: 0, pathMemory: 0, clampK: 0, sepStrength: 0, individuality: 0 },
  links: { connect: 200, pull: 0, align: 0, fatigue: 0 }, // connect pinned: the controlled tests place nodes at fractions of it
  magnet: { strength: 0 },
  world: { stars: 0, depthScale: 0 },
};

export const merge = (...parts) => {
  const out = {};
  for (const part of parts) for (const [k, v] of Object.entries(part || {})) out[k] = { ...(out[k] || {}), ...v };
  return out;
};

// A node with fixed, neutral traits at an exact spot: affinity 0.5 for everyone gives a connect distance
// of exactly links.connect, so tests can place nodes at known fractions of it.
export function ctlNode(name, type, x, y, traits = {}) {
  return {
    name, type, at: { x, y, z: 0 },
    traits: { mass: 1, reach: 1, appMax: 3, top: 1000, cruise: 0, aff: TYPES.map(() => 0.5), ...traits },
  };
}

export function controlled(nodes, params = {}) {
  return new World({ seed: 'ctl', params: merge(QUIET, params), nodes });
}

export function linkBetween(w, a, b) {
  return w.links.find((l) => (l.a.id === a && l.b.id === b) || (l.a.id === b && l.b.id === a));
}

export function checkInvariants(w, label = '') {
  const where = label ? ` (${label})` : '';
  const ids = new Set();
  for (const n of w.nodes) {
    if (ids.has(n.id)) throw new Error(`duplicate node id ${n.id}${where}`);
    ids.add(n.id);
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'hx', 'hy', 'hz']) {
      if (!Number.isFinite(n[k])) throw new Error(`${n.id}.${k} is ${n[k]}${where}`);
    }
    if (n.x < 0 || n.x >= w.W || n.y < 0 || n.y >= w.H) throw new Error(`${n.id} outside field${where}`);
    if (Math.abs(n.z) > w.zHalf + 1e-6) throw new Error(`${n.id} outside depth${where}`);
    if (Math.abs(Math.hypot(n.hx, n.hy, n.hz) - 1) > 1e-6) throw new Error(`${n.id} heading is not a unit vector${where}`);
    if (n.links.length > n.traits.appMax) throw new Error(`${n.id} has ${n.links.length} links, cap ${n.traits.appMax}${where}`);
    for (const l of n.links) {
      if (!w.links.includes(l)) throw new Error(`${n.id} holds a link the world does not${where}`);
      if (l.a !== n && l.b !== n) throw new Error(`${n.id} holds a foreign link${where}`);
    }
  }
  const seen = new Set();
  for (const l of w.links) {
    if (l.a === l.b) throw new Error(`self link ${l.a.id}${where}`);
    if (!l.a.links.includes(l) || !l.b.links.includes(l)) throw new Error(`link missing from an endpoint${where}`);
    if (l.a.dead || l.b.dead) throw new Error(`link to a dead node${where}`);
    const key = [l.a.id, l.b.id].sort().join('|');
    if (seen.has(key)) throw new Error(`duplicate link ${key}${where}`);
    seen.add(key);
    if (w._dist(l.a, l.b) > l.B + 1e-6) throw new Error(`link ${key} stretched past its break distance${where}`);
  }
}
