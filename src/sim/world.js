import { Rng, hash2, hashString } from './rng.js';
import { createNoise } from './noise.js';
import { TYPES, DEFAULTS, mergeParams, setPath } from './params.js';
import { applyMacros } from './macros.js';

const TWO_PI = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const MAX_EVENTS = 500;
const HARD_CEILING = 12;

export function resolveParams(macros, overrides) {
  return mergeParams(applyMacros(DEFAULTS, macros), overrides);
}

function slug(name) {
  const map = { 'ð': 'd', 'þ': 'th', 'æ': 'ae', 'Ð': 'd', 'Þ': 'th', 'Æ': 'ae' };
  return String(name)
    .replace(/[ðþæÐÞÆ]/g, (c) => map[c])
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'node';
}

// Nodes fly their own paths. Two nodes within connect distance link up; links are soft, brittle
// and nudge the paths of whoever they join. Nothing here is a hard constraint.
export class World {
  constructor({ seed = 'rvk', dt = 1 / 60, macros = {}, params = {}, nodes = [] } = {}) {
    this.seed = String(seed);
    this.seedInt = hashString(this.seed) | 0;
    this.dt = dt;
    this.macros = { ...macros };
    this.overrides = mergeParams({}, params);
    this.p = resolveParams(this.macros, this.overrides);
    this.rng = new Rng(this.seed + '/world');
    this.noise = createNoise(new Rng(this.seed + '/noise'));
    this.t = 0;
    this.tick = 0;
    this.nodes = [];
    this.links = [];
    this.events = [];
    this.hardClamps = 0;
    this._linkId = 0;
    this._starSeq = 0;
    this._byId = new Map();
    this._cool = new Map();
    this.poolRng = new Rng(this.seed + '/pool');
    this.pool = nodes.map((d) => ({ ...d }));
    this._recent = [];
    this._pending = [];
    this._lastArrival = -Infinity;
    this._lastDeparture = -Infinity;
    this.dx = 0; this.dy = 0; this.dz = 0;
    this._cache();
    const cap = Math.round(this.p.world.maxAlive);
    let initial = this.pool;
    if (this.pool.length > cap) {
      initial = [...this.pool];
      for (let i = initial.length - 1; i > 0; i--) {
        const j = Math.floor(this.poolRng.next() * (i + 1));
        [initial[i], initial[j]] = [initial[j], initial[i]];
      }
      initial = initial.slice(0, cap);
    }
    // arrivals are spread out: each starts with a random share of its lifetime already used
    for (const def of initial) this._spawn(def, { instant: true, life: this._rollLife() * (0.1 + 0.9 * this.poolRng.next()) });
    this._syncStars(true);
  }

  get(id) { return this._byId.get(id); }

  _cache() {
    const w = this.p.world;
    this.W = w.width;
    this.H = w.height;
    this.zHalf = (w.depth * w.depthScale) / 2;
  }

  // ---- parameters ------------------------------------------------------

  setParams(patch) {
    this.overrides = mergeParams(this.overrides, patch);
    this._reresolve();
  }

  set(path, value) {
    const patch = {};
    setPath(patch, path, value);
    this.setParams(patch);
  }

  // Drops a live override so the default (or macro-derived) value applies again.
  clearParam(path) {
    const keys = path.split('.');
    const trail = [];
    let o = this.overrides;
    for (const k of keys.slice(0, -1)) {
      if (!o[k]) return;
      trail.push([o, k]);
      o = o[k];
    }
    delete o[keys[keys.length - 1]];
    for (let i = trail.length - 1; i >= 0; i--) {
      const [parent, k] = trail[i];
      if (Object.keys(parent[k]).length === 0) delete parent[k]; else break;
    }
    this._reresolve();
  }

  setMacros(values) {
    this.macros = { ...this.macros, ...values };
    this._reresolve();
  }

  _reresolve() {
    const oldHalf = this.zHalf;
    this.p = resolveParams(this.macros, this.overrides);
    this._cache();
    for (const n of this.nodes) {
      this._applyTraits(n);
      if (oldHalf > 0 && this.zHalf > 0) n.z *= this.zHalf / oldHalf;
      else if (this.zHalf > 0) n.z = (n.u.pz * 2 - 1) * this.zHalf * 0.8;
      else { n.z = 0; n.vz = 0; }
      this._fixHeading(n);
    }
    this._syncStars(false);
  }

  // ---- nodes -----------------------------------------------------------

  _spawn(def, { instant = false, life = Infinity } = {}) {
    let id = def.id ?? (def.type === 'star' ? `star-${this._starSeq++}` : slug(def.name));
    if (this._byId.has(id)) { let k = 2; while (this._byId.has(`${id}-${k}`)) k++; id = `${id}-${k}`; }
    const r = new Rng(`${this.seed}/node:${id}`);
    const u = {
      px: r.next(), py: r.next(), pz: r.next(), h1: r.next(), h2: r.next(), w0: r.next(), w1: r.next(),
      speed: r.next(), top: r.next(), mass: r.next(), reach: r.next(), appMax: r.next(), align: r.next(),
      aff: TYPES.map(() => r.next()), shy: TYPES.map(() => r.next()),
    };
    const n = {
      id, name: def.name ?? '', type: def.type, ti: TYPES.indexOf(def.type), hid: hashString(id) | 0,
      x: def.at?.x ?? u.px * this.W, y: def.at?.y ?? u.py * this.H,
      z: def.at?.z ?? (u.pz * 2 - 1) * this.zHalf * 0.8,
      vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, az: 0, hx: 1, hy: 0, hz: 0,
      u, traits: null, traitOverrides: def.traits || {}, links: [],
      born: this.t, removingAt: null, dead: false, alpha: instant ? 1 : 0, held: null,
      poolKey: `${def.type}:${def.name ?? ''}`, dieAt: this.t + life,
    };
    if (n.ti < 0) throw new Error(`Unknown node type "${def.type}" for "${def.name}"`);
    this._applyTraits(n);
    const phi = (u.h2 - 0.5) * 0.9;
    n.hx = Math.cos(u.h1 * TWO_PI) * Math.cos(phi);
    n.hy = Math.sin(u.h1 * TWO_PI) * Math.cos(phi);
    n.hz = Math.sin(phi);
    if (this.zHalf === 0) n.z = 0;
    this._fixHeading(n);
    const speed = n.traits.cruise * this.p.global.speedScale;
    n.vx = n.hx * speed; n.vy = n.hy * speed; n.vz = n.hz * speed;
    this.nodes.push(n);
    this._byId.set(id, n);
    if (!instant) this._event('add', n);
    return n;
  }

  // Keeps the heading a unit vector, flat when the world is flat.
  _fixHeading(n) {
    if (this.zHalf === 0) n.hz = 0;
    const len = Math.hypot(n.hx, n.hy, n.hz);
    if (len < 1e-9) { n.hx = 1; n.hy = 0; n.hz = 0; return; }
    n.hx /= len; n.hy /= len; n.hz /= len;
  }

  // Each category has one value per trait; a node varies around it by the Individuality slider (a fixed random
  // offset per node, so a returning node is always the same character).
  _applyTraits(n) {
    const p = this.p, T = p.types[n.type], u = n.u, I = p.global.individuality;
    const vary = (base, frac, x) => base * (1 + I * frac * (2 * x - 1));
    const cruise = Math.max(0.1, vary(T.speed, 0.35, u.speed));
    const top = Math.max(vary(T.top, 0.2, u.top), cruise * 1.2);
    const mass = Math.max(0.05, vary(T.mass, 0.4, u.mass));
    let appMax = Math.max(1, Math.round((T.appMax + I * 0.75 * (2 * u.appMax - 1)) * p.links.capScale));
    if (n.type === 'star') appMax = Math.min(4, appMax);
    // liking others: members of other categories are liked more than one's own by "category variety"
    const v = p.links.variety, same = 0.55 - 0.35 * v, other = 0.55 + 0.15 * v;
    const aff = TYPES.map((to, k) => {
      let a = clamp((to === n.type ? same : other) + I * 0.35 * (2 * u.aff[k] - 1), 0, 1);
      if (p.options.shy && u.shy[k] < p.options.shyChance) a = -a * p.options.shyDepth;
      return a;
    });
    n.traits = {
      cruise, top, mass, invMass: 1 / mass,
      reach: vary(T.reach, 0.2, u.reach), appMax, align: vary(T.align, 0.4, u.align), aff,
      ...n.traitOverrides,
    };
    n.traits.invMass = 1 / n.traits.mass;
  }

  addNode(def) {
    if (!this.pool.some((d) => d.type === def.type && d.name === def.name)) this.pool.push({ ...def });
    return this._spawn(def, { life: this._rollLife() });
  }

  _rollLife() {
    const W = this.p.world;
    const lo = Math.min(W.lifeMin, W.lifeMax), hi = Math.max(W.lifeMin, W.lifeMax);
    return lo + (hi - lo) * this.poolRng.next();
  }

  removeNode(id) {
    const n = this._byId.get(id);
    if (!n || n.removingAt !== null) return false;
    n.removingAt = this.t;
    n.held = null;
    if (n.type !== 'star') {
      // whoever arrives next is preferably of the same category, and this one waits its turn before returning
      this._pending.push(n.type);
      this._recent.push(n.poolKey);
      if (this._pending.length > 50) this._pending.shift();
      const keep = Math.max(2, Math.min(12, Math.floor(this.pool.length * 0.25)));
      while (this._recent.length > keep) this._recent.shift();
    }
    for (const l of [...n.links]) this._unlink(l, 'removed');
    this._event('remove', n);
    return true;
  }

  // Takes a node out of the list for good (it does not come back); removeNode only sends it away for a while.
  forgetNode(id) {
    const n = this._byId.get(id);
    if (!n || n.type === 'star') return false;
    const i = this.pool.findIndex((d) => `${d.type}:${d.name ?? ''}` === n.poolKey);
    if (i >= 0) this.pool.splice(i, 1);
    return this.removeNode(id);
  }

  _syncStars(initial) {
    const want = Math.round(this.p.world.stars);
    const live = this.nodes.filter((n) => n.type === 'star' && n.removingAt === null);
    for (let k = live.length; k < want; k++) this._spawn({ type: 'star', name: '' }, { instant: initial });
    for (let k = live.length; k > want; k--) this.removeNode(live[k - 1].id);
  }

  // ---- grabbing --------------------------------------------------------

  grab(id, x, y) {
    const n = this._byId.get(id);
    if (!n || n.removingAt !== null) return false;
    n.held = { tx: x, ty: y };
    this._event('grab', n);
    return true;
  }

  moveGrab(id, x, y) {
    const n = this._byId.get(id);
    if (n?.held) { n.held.tx = x; n.held.ty = y; }
  }

  // Release keeps the momentum; the node's flight path becomes the direction it was going.
  release(id) {
    const n = this._byId.get(id);
    if (!n?.held) return;
    n.held = null;
    const s = Math.hypot(n.vx, n.vy, n.vz);
    if (s > 1e-3) { n.hx = n.vx / s; n.hy = n.vy / s; n.hz = n.vz / s; this._fixHeading(n); }
    this._event('release', n);
  }

  // ---- geometry --------------------------------------------------------

  // Shortest wrapped vector a -> b in (dx, dy, dz); returns its length.
  _dist(a, b) {
    const W = this.W, H = this.H;
    let dx = b.x - a.x, dy = b.y - a.y;
    if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
    if (dy > H / 2) dy -= H; else if (dy < -H / 2) dy += H;
    const dz = b.z - a.z;
    this.dx = dx; this.dy = dy; this.dz = dz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  _linked(a, b) {
    for (const l of a.links) if (l.a === b || l.b === b) return true;
    return false;
  }

  aff(i, j) {
    const a = i.traits.aff[j.ti];
    if (a <= 0) return a;
    // every pair is a little different too (and A's feeling for B is not B's for A)
    return clamp(a + (hash2(i.hid, j.hid, this.seedInt) * 2 - 1) * 0.15 * this.p.global.individuality, 0, 1);
  }

  // How close two nodes must come to link: baseline x each node's reach x how much it likes the other,
  // averaged, so a one-sided crush connects at a middle distance.
  connectDistance(a, b) {
    const f = (x, y) => x.traits.reach * clamp(0.55 + 0.9 * this.aff(x, y), 0.15, 1.5);
    return this.p.links.connect * 0.5 * (f(a, b) + f(b, a));
  }

  // Break distance: the connect distance times the break factor, shrinking toward the rest distance as the link ages.
  breakDistance(D, age) {
    const L = this.p.links;
    const wear = L.fatigue > 0 ? clamp(age / L.fatigue, 0, 1) : 0;
    return D * (L.breakFactor - (L.breakFactor - L.rest) * wear);
  }

  // Held nodes lose weight in proportion to the mouse's authority, so the network can pull back on them.
  _inv(n) {
    return n.held ? n.traits.invMass * (1 - this.p.grab.authority) : n.traits.invMass;
  }

  // ---- simulation ------------------------------------------------------

  run(seconds) {
    const ticks = Math.round(seconds / this.dt);
    for (let i = 0; i < ticks; i++) this.step();
  }

  step() {
    const dt = this.dt;
    this.t += dt;
    this.tick++;
    this._forces(dt);
    this._integrate(dt);
    this._lifecycle();
    this._formation();
    this._turnover();
    this._fades(dt);
  }

  _forces(dt) {
    const p = this.p, g = p.global, L = p.links, M = p.magnet, zH = this.zHalf, t = this.t;
    const nodes = this.nodes;
    for (const n of nodes) { n.ax = 0; n.ay = 0; n.az = 0; n.mx = 0; n.my = 0; n.mz = 0; }

    // own flight path: heading drifts with noise, velocity relaxes toward it
    for (const n of nodes) {
      if (n.held) continue;
      const tt = t * g.wanderFreq + n.u.w0 * 100, ww = n.u.w1 * 50;
      let nx = this.noise(tt, ww, 0.31), ny = this.noise(tt, ww, 7.77);
      let nz = zH > 0 ? g.zWander * this.noise(tt, ww, 13.13) : 0;
      const dot = nx * n.hx + ny * n.hy + nz * n.hz;
      nx -= dot * n.hx; ny -= dot * n.hy; nz -= dot * n.hz;
      n.hx += g.wander * dt * nx; n.hy += g.wander * dt * ny; n.hz += g.wander * dt * nz;
      this._fixHeading(n);

      const tr = n.traits;
      const cruise = tr.cruise * g.speedScale, top = tr.top * g.speedScale;
      n.ax += g.pathMemory * (n.hx * cruise - n.vx);
      n.ay += g.pathMemory * (n.hy * cruise - n.vy);
      n.az += g.pathMemory * (n.hz * cruise - n.vz);
      const s = Math.hypot(n.vx, n.vy, n.vz);
      if (s > top) {
        const c = ((s - top) * g.clampK) / s;
        n.ax -= n.vx * c; n.ay -= n.vy * c; n.az -= n.vz * c;
      }
      if (zH > 0) {
        const over = Math.abs(n.z) - 0.7 * zH;
        if (over > 0) n.az -= Math.sign(n.z) * (over / (0.3 * zH)) * 40;
      }
    }

    // personal space and magnetism, over all pairs
    const sr = g.sepRadius;
    const magnetOn = M.strength > 0;
    const magnetBound = M.radius * L.connect * 3.2;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const d = this._dist(a, b);
        if (d < 1e-6) continue;
        const nx = this.dx / d, ny = this.dy / d, nz = this.dz / d;
        const ia = this._inv(a), ib = this._inv(b), isum = ia + ib;
        if (isum === 0) continue;
        const wa = ia / isum, wb = ib / isum;
        if (d < sr && g.sepStrength > 0) {
          const f = g.sepStrength * (1 - d / sr) ** 2;
          a.ax -= nx * f * wa; a.ay -= ny * f * wa; a.az -= nz * f * wa;
          b.ax += nx * f * wb; b.ay += ny * f * wb; b.az += nz * f * wb;
        }
        if (magnetOn && d < magnetBound && a.removingAt === null && b.removingAt === null && a.alpha > 0.3 && b.alpha > 0.3 && !this._linked(a, b)) {
          const reach = M.radius * this.connectDistance(a, b);
          if (d < reach) {
            const fall = 1 - d / reach;
            const fa = M.strength * (this.aff(a, b) - M.neutral) * fall * Math.min(1.6, 2 * wa);
            const fb = M.strength * (this.aff(b, a) - M.neutral) * fall * Math.min(1.6, 2 * wb);
            if (!a.held) { a.mx += nx * fa; a.my += ny * fa; a.mz += nz * fa; }
            if (!b.held) { b.mx -= nx * fb; b.my -= ny * fb; b.mz -= nz * fb; }
          }
        }
      }
    }

    // The pull of all neighbours together never exceeds one neighbour's full pull, so a crowded field
    // does not snowball into a single clump (the sum would otherwise grow with the number of nodes).
    if (magnetOn) {
      for (const n of nodes) {
        const len = Math.hypot(n.mx, n.my, n.mz);
        if (len < 1e-9) continue;
        const k = len > M.strength ? M.strength / len : 1;
        n.ax += n.mx * k; n.ay += n.my * k; n.az += n.mz * k;
      }
    }

    // links: a soft pull toward the partner that grows with stretch, and a nudge of both flight paths
    for (const l of this.links) {
      const a = l.a, b = l.b;
      const d = this._dist(a, b);
      if (d < 1e-6) continue;
      const nx = this.dx / d, ny = this.dy / d, nz = this.dz / d;
      const rest = l.D * L.rest, span = Math.max(1e-6, l.D * L.breakFactor - rest);
      if (d > rest) {
        const s = Math.min(1.5, (d - rest) / span);
        let rel = L.pull * s;
        const vr = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
        if (vr < 0) rel += L.damping * vr * s;
        const ia = this._inv(a), ib = this._inv(b), isum = ia + ib;
        if (isum > 0) {
          const wa = ia / isum, wb = ib / isum;
          a.ax += nx * rel * wa; a.ay += ny * rel * wa; a.az += nz * rel * wa;
          b.ax -= nx * rel * wb; b.ay -= ny * rel * wb; b.az -= nz * rel * wb;
        }
      }
      if (L.align > 0) {
        const ka = L.align * a.traits.align * Math.max(0, this.aff(a, b)) * dt;
        const kb = L.align * b.traits.align * Math.max(0, this.aff(b, a)) * dt;
        const ahx = a.hx, ahy = a.hy, ahz = a.hz;
        if (!a.held) { a.hx += ka * (b.hx - ahx); a.hy += ka * (b.hy - ahy); a.hz += ka * (b.hz - ahz); }
        if (!b.held) { b.hx += kb * (ahx - b.hx); b.hy += kb * (ahy - b.hy); b.hz += kb * (ahz - b.hz); }
        this._fixHeading(a); this._fixHeading(b);
      }
    }

    // held nodes follow the cursor on a spring; more mouse authority means a stiffer spring
    const k = 0.3 * Math.pow(80 / 0.3, p.grab.authority), c = 2 * Math.sqrt(k) * 0.9;
    const W = this.W, H = this.H;
    for (const n of nodes) {
      if (!n.held) continue;
      let dx = n.held.tx - n.x, dy = n.held.ty - n.y;
      if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
      if (dy > H / 2) dy -= H; else if (dy < -H / 2) dy += H;
      n.ax += k * dx - c * n.vx;
      n.ay += k * dy - c * n.vy;
      n.az = 0;
    }
  }

  _integrate(dt) {
    const g = this.p.global, zH = this.zHalf, W = this.W, H = this.H;
    for (const n of this.nodes) {
      n.vx += n.ax * dt; n.vy += n.ay * dt; n.vz += n.az * dt;
      if (n.held || zH === 0) n.vz = 0;
      if (!n.held) {
        const ceil = n.traits.top * g.speedScale * HARD_CEILING;
        const s = Math.hypot(n.vx, n.vy, n.vz);
        if (s > ceil) { const k = ceil / s; n.vx *= k; n.vy *= k; n.vz *= k; this.hardClamps++; }
      }
      n.x += n.vx * dt; n.y += n.vy * dt; n.z += n.vz * dt;
      n.x = ((n.x % W) + W) % W;
      n.y = ((n.y % H) + H) % H;
      if (zH === 0) { n.z = 0; n.vz = 0; }
      else if (n.z > zH) { n.z = zH; if (n.vz > 0) n.vz = 0; }
      else if (n.z < -zH) { n.z = -zH; if (n.vz < 0) n.vz = 0; }
    }
  }

  // Links dissolve when stretched past their (fatigued) break distance. The nodes keep their momentum.
  _lifecycle() {
    const L = this.p.links, t = this.t;
    const drop = [];
    for (const l of this.links) {
      if (l.a.removingAt !== null || l.b.removingAt !== null) { drop.push([l, 'removed']); continue; }
      const d = this._dist(l.a, l.b);
      l.D = this.connectDistance(l.a, l.b);
      l.B = this.breakDistance(l.D, t - l.born);
      if (d > l.B) drop.push([l, d > l.D * L.breakFactor ? 'stretch' : 'worn']);
    }
    for (const [l, reason] of drop) {
      this._unlink(l, reason);
      if (reason === 'worn' && L.cooldown > 0) this._cool.set(this._pairKey(l.a, l.b), t + L.cooldown);
    }
    if (this._cool.size > 400) for (const [k, until] of this._cool) if (until <= t) this._cool.delete(k);
    // a cap lowered live: the most stretched surplus links go
    for (const n of this.nodes) {
      while (n.links.length > n.traits.appMax) this._unlink(this._mostStretched(n), 'cap');
    }
  }

  _pairKey(a, b) {
    return a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
  }

  // Two nodes whose link has just worn out do not re-link at once.
  _cooling(a, b) {
    const until = this._cool.get(this._pairKey(a, b));
    return until !== undefined && until > this.t;
  }

  _stretch(l) {
    return this._dist(l.a, l.b) / l.D;
  }

  _mostStretched(n) {
    let worst = null, wr = -Infinity;
    for (const l of n.links) {
      const r = this._stretch(l);
      if (r > wr) { wr = r; worst = l; }
    }
    return worst;
  }

  // Deterministic: every unlinked pair inside its connect distance links, closest first. A full node only
  // takes a newcomer by dropping its most stretched link, and only if the newcomer is clearly closer.
  _formation() {
    const L = this.p.links, nodes = this.nodes;
    const bound = L.connect * 3.2;
    const cands = [];
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      if (a.removingAt !== null || a.alpha < 0.6) continue;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        if (b.removingAt !== null || b.alpha < 0.6) continue;
        const d = this._dist(a, b);
        if (d > bound) continue;
        if (this._linked(a, b) || this._cooling(a, b)) continue;
        const D = this.connectDistance(a, b);
        if (d < D) cands.push({ r: d / D, i, j });
      }
    }
    if (!cands.length) return;
    cands.sort((p, q) => p.r - q.r || p.i - q.i || p.j - q.j);
    for (const { r, i, j } of cands) {
      const a = nodes[i], b = nodes[j];
      if (this._linked(a, b)) continue;
      let va = null, vb = null;
      if (a.links.length >= a.traits.appMax) {
        va = this._mostStretched(a);
        if (!va || r + L.swapMargin >= this._stretch(va)) continue;
      }
      if (b.links.length >= b.traits.appMax) {
        vb = this._mostStretched(b);
        if (!vb || r + L.swapMargin >= this._stretch(vb)) continue;
      }
      if (va) this._unlink(va, 'swap');
      if (vb && vb !== va) this._unlink(vb, 'swap');
      this._link(a, b);
    }
  }

  _link(a, b) {
    const D = this.connectDistance(a, b);
    const l = { id: ++this._linkId, a, b, born: this.t, D, B: this.breakDistance(D, 0) };
    this.links.push(l);
    a.links.push(l);
    b.links.push(l);
    this._event('link', a, b);
    return l;
  }

  _unlink(l, reason) {
    const rm = (arr) => { const k = arr.indexOf(l); if (k >= 0) arr.splice(k, 1); };
    rm(this.links); rm(l.a.links); rm(l.b.links);
    this._event('unlink', l.a, l.b, reason);
  }

  // Keeps about maxAlive nodes in the field: nodes leave when their lifetime is up and new ones arrive
  // from the list, so the network is always changing. With room for the whole list, nobody leaves.
  _turnover() {
    const W = this.p.world, cap = Math.round(W.maxAlive), t = this.t;
    const turnover = this.pool.length > cap;
    let alive = 0, soonest = null;
    for (const n of this.nodes) {
      if (n.type === 'star' || n.removingAt !== null) continue;
      if (turnover && n.dieAt <= t) { this.removeNode(n.id); continue; }
      alive++;
      if (!soonest || n.dieAt < soonest.dieAt) soonest = n;
    }
    if (turnover && alive > cap && soonest && t - this._lastDeparture >= W.spawnInterval) {
      this.removeNode(soonest.id); // the cap was lowered: the node closest to leaving anyway goes first
      this._lastDeparture = t;
    }
    if (alive < cap && t - this._lastArrival >= W.spawnInterval) {
      const def = this._pickArrival();
      if (def) { this._arrive(def); this._lastArrival = t; }
    }
  }

  // Prefers someone of the category that just left (so the mix stays steady), and someone who has not just left.
  _pickArrival() {
    const key = (d) => `${d.type}:${d.name ?? ''}`;
    const present = new Set(this.nodes.map((n) => n.poolKey));
    const free = this.pool.filter((d) => !present.has(key(d)));
    if (!free.length) return null;
    const rested = free.filter((d) => !this._recent.includes(key(d)));
    const want = this.p.world.respawnSameType && this._pending.length ? this._pending[0] : null;
    const tiers = want
      ? [rested.filter((d) => d.type === want), free.filter((d) => d.type === want), rested, free]
      : [rested, free];
    const cands = tiers.find((t) => t.length) || free;
    return cands[Math.floor(this.poolRng.next() * cands.length)];
  }

  // New arrivals appear in the margin around the visible area and drift in.
  _arrive(def) {
    this._pending.shift();
    const m = this.p.world.margin, W = this.W, H = this.H, r = this.poolRng;
    const edge = (len) => (r.next() < 0.5 ? r.next() * m : len - r.next() * m);
    const at = def.at ?? (r.next() < 0.5
      ? { x: edge(W), y: r.next() * H, z: (r.next() * 2 - 1) * this.zHalf * 0.8 }
      : { x: r.next() * W, y: edge(H), z: (r.next() * 2 - 1) * this.zHalf * 0.8 });
    this._spawn({ ...def, at }, { life: this._rollLife() });
  }

  _fades(dt) {
    const w = this.p.world;
    let removed = false;
    for (const n of this.nodes) {
      if (n.removingAt !== null) {
        n.alpha = Math.max(0, 1 - (this.t - n.removingAt) / w.fadeOut);
        if (n.alpha <= 0) { n.dead = true; removed = true; }
      } else if (n.alpha < 1) n.alpha = Math.min(1, n.alpha + dt / w.fadeIn);
    }
    if (removed) {
      for (const n of this.nodes) if (n.dead) this._byId.delete(n.id);
      this.nodes = this.nodes.filter((n) => !n.dead);
    }
  }

  _event(type, a, b, reason) {
    this.events.push({ t: this.t, type, a: a.id, b: b?.id ?? null, reason: reason ?? null });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---- inspection ------------------------------------------------------

  hash() {
    let h = 2166136261;
    const mix = (v) => { h = Math.imul(h ^ (v | 0), 16777619); };
    for (const n of this.nodes) {
      mix(Math.round(n.x * 100)); mix(Math.round(n.y * 100)); mix(Math.round(n.z * 100));
      mix(Math.round(n.vx * 100)); mix(Math.round(n.vy * 100)); mix(n.links.length);
    }
    mix(this.links.length);
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  stats() {
    const byType = {};
    for (const t of TYPES) byType[t] = { nodes: 0, links: 0 };
    let speed = 0, count = 0;
    for (const n of this.nodes) {
      if (n.removingAt !== null) continue;
      byType[n.type].nodes++;
      byType[n.type].links += n.links.length;
      speed += Math.hypot(n.vx, n.vy, n.vz);
      count++;
    }
    return { t: this.t, nodes: count, links: this.links.length, byType, meanSpeed: count ? speed / count : 0 };
  }
}
