// Single source of truth for every tunable value. The dev panel is generated from SCHEMA.
// Distances are world units, times are seconds, speeds are units/second.

export const TYPES = ['venue', 'artist', 'genre', 'theme', 'event', 'star'];

// One value per category; each node then varies around it by the Individuality slider.
const TYPE_DEFAULTS = {
  venue:  { speed: 9,    top: 30,   mass: 8,    reach: 1.1,  appMax: 4,   align: 0.35 },
  artist: { speed: 29,   top: 90,   mass: 1.75, reach: 1.0,  appMax: 4,   align: 0.5 },
  genre:  { speed: 18.5, top: 57.5, mass: 3,    reach: 1.1,  appMax: 3.5, align: 1.2 },
  theme:  { speed: 6.5,  top: 23,   mass: 16,   reach: 1.65, appMax: 2.5, align: 0.25 },
  event:  { speed: 12,   top: 39,   mass: 11,   reach: 1.5,  appMax: 5,   align: 0.35 },
  star:   { speed: 20,   top: 77.5, mass: 0.8,  reach: 1.05, appMax: 4,   align: 0.5 },
};

const TRAIT_META = [
  ['speed',  'Cruise speed',               0, 200, 0.5],
  ['top',    'Top speed',                  0, 500, 1],
  ['mass',   'Mass',                       0.1, 40, 0.1],
  ['reach',  'Reach (x connect distance)', 0.3, 3, 0.05],
  ['appMax', 'Max links',                  1, 8, 0.5],
  ['align',  'Path alignment',             0, 3, 0.05],
];

export const SCHEMA = [];

function add(path, label, group, kind, min, max, step, value) {
  SCHEMA.push({ path, label, group, kind, min, max, step, default: value });
}
const num = (path, label, group, min, max, step, value) => add(path, label, group, 'number', min, max, step, value);
const flag = (path, label, group, value) => add(path, label, group, 'bool', 0, 1, 1, value);
const range = (path, label, group, min, max, step, value) => add(path, label, group, 'range', min, max, step, value);

num('world.width', 'Field width', 'World', 400, 6000, 10, 2100);
num('world.height', 'Field height', 'World', 400, 6000, 10, 1240);
num('world.depth', 'Depth range', 'World', 0, 3000, 10, 300);
num('world.depthScale', 'Depth scale', 'World', 0, 1, 0.01, 1);
num('world.margin', 'Field margin', 'World', 0, 500, 5, 140);
num('world.stars', 'Visitors (count)', 'World', 0, 40, 1, 6);
num('world.maxAlive', 'Nodes alive at once (max)', 'World', 1, 400, 1, 54);
num('world.lifeMin', 'Node lifetime, shortest (s)', 'World', 5, 3600, 5, 90);
num('world.lifeMax', 'Node lifetime, longest (s)', 'World', 5, 3600, 5, 240);
flag('world.respawnSameType', 'Replacement is the same category', 'World', true);
num('world.spawnInterval', 'Min seconds between arrivals', 'World', 0.1, 20, 0.1, 0.5);
num('world.fadeIn', 'Node fade-in', 'World', 0.1, 10, 0.1, 1.5);
num('world.fadeOut', 'Node fade-out', 'World', 0.1, 10, 0.1, 1.2);

num('global.speedScale', 'Speed scale', 'Flight', 0.1, 4, 0.05, 1.3);
num('global.individuality', 'Individuality (how much nodes differ)', 'Flight', 0, 1, 0.01, 1);
num('global.wander', 'Path drift (rad/s)', 'Flight', 0, 1, 0.01, 0.24);
num('global.wanderFreq', 'Path drift frequency (Hz)', 'Flight', 0.02, 1, 0.01, 0.12);
num('global.zWander', 'Path drift in depth', 'Flight', 0, 1, 0.01, 0.5);
num('global.pathMemory', 'Return to own path (1/s)', 'Flight', 0, 3, 0.05, 0.55);
num('global.clampK', 'Soft speed ceiling', 'Flight', 0, 20, 0.1, 1.2);
num('global.sepRadius', 'Personal space radius', 'Flight', 0, 300, 1, 70);
num('global.sepStrength', 'Personal space strength', 'Flight', 0, 200, 1, 30);

num('links.connect', 'Connect distance', 'Links', 40, 600, 5, 360);
num('links.breakFactor', 'Break distance (x connect)', 'Links', 1.05, 3, 0.01, 1.35);
num('links.rest', 'Rest distance (x connect)', 'Links', 0.1, 0.95, 0.01, 0.6);
num('links.pull', 'Pull at break stretch', 'Links', 0, 40, 0.1, 5);
num('links.damping', 'Closing damping', 'Links', 0, 8, 0.1, 1);
num('links.align', 'Flight path alignment', 'Links', 0, 1, 0.005, 0.025);
num('links.fatigue', 'Link fatigue (s, 0 = off)', 'Links', 0, 600, 1, 60);
num('links.capScale', 'Max links scale', 'Links', 0.25, 3, 0.01, 1);
num('links.cooldown', 'Re-link cooldown after wearing out (s)', 'Links', 0, 60, 0.5, 8);
num('links.swapMargin', 'Swap margin', 'Links', 0, 0.6, 0.01, 0.15);
num('links.variety', 'Category variety (0 = all alike, 1 = prefer other categories)', 'Links', 0, 1, 0.01, 0.6);

num('magnet.strength', 'Magnetism strength', 'Magnetism', 0, 30, 0.1, 2.5);
num('magnet.radius', 'Magnetism radius (x connect)', 'Magnetism', 1, 6, 0.1, 2.2);
num('magnet.neutral', 'Neutral affinity', 'Magnetism', 0, 1, 0.01, 0.3);

num('grab.authority', 'Mouse authority', 'Grab', 0, 1, 0.01, 0.7);

flag('options.shy', 'Shy nodes (affinity below 0)', 'Options', false);
num('options.shyChance', 'Shy chance per type', 'Options', 0, 1, 0.01, 0.25);
num('options.shyDepth', 'Shyness depth', 'Options', 0, 1, 0.01, 0.5);

const typeName = (t) => (t === 'star' ? 'visitor' : t); // the crowd nodes are called visitors everywhere people can see
for (const type of TYPES) {
  for (const [key, label, min, max, step] of TRAIT_META) {
    num(`types.${type}.${key}`, `${typeName(type)}: ${label}`, `Type: ${typeName(type)}`, min, max, step, TYPE_DEFAULTS[type][key]);
  }
}

export const SCHEMA_BY_PATH = new Map(SCHEMA.map((e) => [e.path, e]));

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] ??= {};
  o[keys[keys.length - 1]] = value;
}

export function cloneParams(p) {
  return JSON.parse(JSON.stringify(p));
}

export const DEFAULTS = (() => {
  const d = {};
  for (const e of SCHEMA) setPath(d, e.path, Array.isArray(e.default) ? [...e.default] : e.default);
  return d;
})();

export function clampToSchema(path, value) {
  const e = SCHEMA_BY_PATH.get(path);
  if (!e) return value;
  const c = (v) => Math.min(e.max, Math.max(e.min, v));
  if (e.kind === 'number') return c(value);
  if (e.kind === 'range') {
    const [a, b] = value.map(c);
    return a <= b ? [a, b] : [b, a];
  }
  return !!value;
}

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Deep merge; arrays and primitives in patch replace the base value.
export function mergeParams(base, patch) {
  const out = cloneParams(base);
  const walk = (dst, src) => {
    for (const k of Object.keys(src)) {
      if (isPlain(src[k]) && isPlain(dst[k])) walk(dst[k], src[k]);
      else dst[k] = Array.isArray(src[k]) ? [...src[k]] : src[k];
    }
  };
  walk(out, patch || {});
  return out;
}

// Returns a list of problems with a params object (unknown paths, out-of-range values).
export function validateParams(params) {
  const problems = [];
  const walk = (o, prefix) => {
    for (const k of Object.keys(o)) {
      const path = prefix ? `${prefix}.${k}` : k;
      const e = SCHEMA_BY_PATH.get(path);
      if (e) {
        const vals = e.kind === 'range' ? o[k] : [o[k]];
        if (e.kind === 'bool') { if (typeof o[k] !== 'boolean') problems.push(`${path}: not a boolean`); continue; }
        if (!Array.isArray(vals) || (e.kind === 'range' && vals.length !== 2)) { problems.push(`${path}: bad shape`); continue; }
        for (const v of vals) if (!Number.isFinite(v) || v < e.min || v > e.max) problems.push(`${path}: ${v} outside [${e.min}, ${e.max}]`);
      } else if (isPlain(o[k])) walk(o[k], path);
      else problems.push(`${path}: unknown parameter`);
    }
  };
  walk(params, '');
  return problems;
}

// Drops unknown parameters and clamps out-of-range ones, for recipes saved under an older schema.
export function sanitizeParams(params) {
  const out = {}, dropped = [];
  const walk = (o, prefix) => {
    for (const k of Object.keys(o || {})) {
      const path = prefix ? `${prefix}.${k}` : k;
      const e = SCHEMA_BY_PATH.get(path);
      if (!e) {
        if (isPlain(o[k])) walk(o[k], path); else dropped.push(path);
        continue;
      }
      const v = o[k];
      const ok = e.kind === 'bool' ? typeof v === 'boolean'
        : e.kind === 'range' ? Array.isArray(v) && v.length === 2 && v.every(Number.isFinite)
          : Number.isFinite(v);
      if (ok) setPath(out, path, clampToSchema(path, v)); else dropped.push(path);
    }
  };
  walk(params, '');
  return { params: out, dropped };
}
