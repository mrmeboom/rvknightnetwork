// Fast-forwards the simulation and prints numbers about how it behaves, so the feel can be tuned
// without watching it. Usage:
//   node scripts/tune.js [--seed rvk] [--seeds 3] [--minutes 10] [--warmup 60] [--dt 0.0166667]
//                        [--recipe path/to/recipe.json] [--set path=value ...] [--json]
// --set overrides a parameter, e.g. --set links.connect=200 --set magnet.strength=0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { World } from '../src/sim/world.js';
import { normalizeRecipe } from '../src/recipe.js';
import { TYPES, setPath } from '../src/sim/params.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const o = { seed: 'rvk', seeds: 1, minutes: 10, warmup: 60, dt: null, recipe: null, json: false, sets: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--set') { o.sets.push(argv[++i]); }
    else if (a.startsWith('--')) { const k = a.slice(2); o[k] = isNaN(Number(argv[i + 1])) ? argv[i + 1] : Number(argv[i + 1]); i++; }
  }
  return o;
}

const pct = (arr, q) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN);
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');

function loadRecipe(opts) {
  let r;
  if (opts.recipe) r = normalizeRecipe(JSON.parse(readFileSync(opts.recipe, 'utf8')));
  else r = normalizeRecipe({ nodes: JSON.parse(readFileSync(join(root, 'nodes.json'), 'utf8')).nodes });
  for (const s of opts.sets) {
    const [path, raw] = s.split('=');
    setPath(r.params, path, JSON.parse(raw));
  }
  return r;
}


// How unevenly nodes fill the field: coefficient of variation of counts in a grid (Poisson ~ 0.7 for this density).
function spatialCv(w, cols = 7, rows = 4) {
  const cells = new Array(cols * rows).fill(0);
  let n = 0;
  for (const node of w.nodes) {
    if (node.removingAt !== null) continue;
    const cx = Math.min(cols - 1, Math.floor((node.x / w.W) * cols));
    const cy = Math.min(rows - 1, Math.floor((node.y / w.H) * rows));
    cells[cy * cols + cx]++;
    n++;
  }
  const m = n / cells.length;
  const v = cells.reduce((a, c) => a + (c - m) ** 2, 0) / cells.length;
  return Math.sqrt(v) / m;
}

// Size of the biggest group of nodes connected by links.
function largestComponent(w) {
  const seen = new Set();
  let best = 0;
  for (const n of w.nodes) {
    if (seen.has(n)) continue;
    let size = 0;
    const stack = [n];
    seen.add(n);
    while (stack.length) {
      const cur = stack.pop();
      size++;
      for (const l of cur.links) {
        const o = l.a === cur ? l.b : l.a;
        if (!seen.has(o)) { seen.add(o); stack.push(o); }
      }
    }
    best = Math.max(best, size);
  }
  return best;
}

function runOne(opts, seed) {
  const recipe = loadRecipe(opts);
  const w = new World({ seed, dt: opts.dt ?? recipe.dt, macros: recipe.macros, params: recipe.params, nodes: recipe.nodes });
  w.run(opts.warmup);
  w.drainEvents();

  const total = Math.round(opts.minutes * 60 / w.dt);
  const sampleEvery = Math.max(1, Math.round(0.25 / w.dt));
  const born = new Map();
  for (const l of w.links) born.set(l.a.id + '|' + l.b.id, l.born);
  const lifeAll = [], lifeByType = Object.fromEntries(TYPES.map((t) => [t, []]));
  const reasons = {};
  let formed = 0;
  const partners = new Map();
  const speedRatio = {}, speeds = {}, linkCounts = {}, atCap = {}, samples = {};
  for (const t of TYPES) { speedRatio[t] = []; speeds[t] = []; linkCounts[t] = 0; atCap[t] = 0; samples[t] = 0; }
  const cosines = [];
  let maxStretch = 0, maxZ = 0, taut = 0, linkSamples = 0;
  const third = { a: [], c: [] };
  const cvSamples = [], compSamples = [];
  const sampleSpatialEvery = Math.max(1, Math.round(5 / w.dt));
  const setEvery = Math.max(1, Math.round(10 / w.dt));
  const linkSets = [];

  for (let i = 0; i < total; i++) {
    w.step();
    for (const e of w.drainEvents()) {
      const key = e.a + '|' + e.b;
      if (e.type === 'link') {
        formed++;
        born.set(key, e.t);
        if (!partners.has(e.a)) partners.set(e.a, new Set());
        if (!partners.has(e.b)) partners.set(e.b, new Set());
        partners.get(e.a).add(e.b); partners.get(e.b).add(e.a);
      } else if (e.type === 'unlink') {
        reasons[e.reason] = (reasons[e.reason] || 0) + 1;
        const t0 = born.get(key);
        if (t0 != null) {
          const d = e.t - t0, ta = w.get(e.a)?.type, tb = w.get(e.b)?.type;
          lifeAll.push(d);
          if (ta) lifeByType[ta].push(d);
          if (tb && tb !== ta) lifeByType[tb].push(d);
        }
        born.delete(key);
      }
    }
    if (i % sampleEvery === 0) {
      for (const n of w.nodes) {
        if (n.removingAt !== null) continue;
        const s = Math.hypot(n.vx, n.vy, n.vz);
        speeds[n.type].push(s);
        speedRatio[n.type].push(s / (n.traits.top * w.p.global.speedScale));
        linkCounts[n.type] += n.links.length;
        if (n.links.length >= n.traits.appMax) atCap[n.type]++;
        samples[n.type]++;
        maxZ = Math.max(maxZ, Math.abs(n.z));
      }
      for (const l of w.links) {
        const a = l.a, b = l.b;
        const sa = Math.hypot(a.vx, a.vy, a.vz), sb = Math.hypot(b.vx, b.vy, b.vz);
        if (sa > 1e-6 && sb > 1e-6) cosines.push((a.vx * b.vx + a.vy * b.vy + a.vz * b.vz) / (sa * sb));
        const d = w._dist(a, b);
        maxStretch = Math.max(maxStretch, d / l.B);
        linkSamples++;
        if (d > l.D) taut++;
      }
      (i < total / 3 ? third.a : i >= (2 * total) / 3 ? third.c : []).push(w.stats().meanSpeed);
    }
    if (i % setEvery === 0) linkSets.push(new Set(w.links.map((l) => (l.a.id < l.b.id ? l.a.id + '|' + l.b.id : l.b.id + '|' + l.a.id))));
    if (i % sampleSpatialEvery === 0) {
      cvSamples.push([i / total, spatialCv(w)]);
      compSamples.push([i / total, largestComponent(w)]);
    }
  }

  const jaccard = (A, B) => { let inter = 0; for (const k of A) if (B.has(k)) inter++; const uni = A.size + B.size - inter; return uni ? inter / uni : 1; };
  const sim60 = [], sim30 = [];
  for (let k = 0; k + 6 < linkSets.length; k++) sim60.push(jaccard(linkSets[k], linkSets[k + 6]));
  for (let k = 0; k + 3 < linkSets.length; k++) sim30.push(jaccard(linkSets[k], linkSets[k + 3]));

  const nodeCount = w.nodes.filter((n) => n.removingAt === null).length;
  const seenNodes = partners.size; // the cast changes, so measure against everyone who took part
  const pairsPossible = Math.max(1, (seenNodes * (seenNodes - 1)) / 2);
  const everLinkedPairs = [...partners.entries()].reduce((s, [, set]) => s + set.size, 0) / 2;
  const distinct = [...partners.values()].map((s) => s.size);

  return {
    seed,
    nodes: nodeCount,
    minutes: opts.minutes,
    perType: Object.fromEntries(TYPES.map((t) => [t, {
      linksPerNode: linkCounts[t] / Math.max(1, samples[t]),
      atCap: atCap[t] / Math.max(1, samples[t]),
      speedMean: mean(speeds[t]), speedP95: pct(speeds[t], 0.95), speedMax: Math.max(...speeds[t], 0),
      ratioP95: pct(speedRatio[t], 0.95), ratioMax: Math.max(...speedRatio[t], 0),
      lifeMedian: pct(lifeByType[t], 0.5), lifeP90: pct(lifeByType[t], 0.9),
    }])),
    formedPerMin: formed / opts.minutes,
    releases: reasons,
    lifeMedian: pct(lifeAll, 0.5), lifeP10: pct(lifeAll, 0.1), lifeP90: pct(lifeAll, 0.9),
    lockstep: mean(cosines),
    maxStretch,
    similarity60: mean(sim60),
    similarity30: mean(sim30),
    tautShare: taut / Math.max(1, linkSamples),
    maxZ,
    hardClamps: w.hardClamps,
    drift: mean(third.c) / mean(third.a),
    cvEarly: mean(cvSamples.filter(([f]) => f < 1 / 3).map((x) => x[1])),
    cvLate: mean(cvSamples.filter(([f]) => f >= 2 / 3).map((x) => x[1])),
    compMean: mean(compSamples.map((x) => x[1])),
    compMax: Math.max(...compSamples.map((x) => x[1])),
    partnersMean: mean(distinct), partnersMin: Math.min(...distinct, Infinity),
    pairsEverLinked: everLinkedPairs / pairsPossible,
  };
}

const targets = [
  ['links per node (all types)', (r) => mean(TYPES.map((t) => r.perType[t].linksPerNode)), 1.5, 4.2],
  ['median link lifetime (s)', (r) => r.lifeMedian, 5, 25],
  ['links shared with 60 s earlier (0 = all new)', (r) => r.similarity60, 0, 0.4],
  ['velocity lockstep of linked pairs (cosine)', (r) => r.lockstep, -0.1, 0.5],
  ['speed drift last/first third', (r) => r.drift, 0.8, 1.25],
  ['spread: grid CV, last third (random ~0.7)', (r) => r.cvLate, 0, 1.15],
  ['spread: grid CV, first third', (r) => r.cvEarly, 0, 1.15],
  ['share of link-time stretched past connect distance', (r) => r.tautShare, 0.005, 0.6],
  ['max stretch (distance / break distance)', (r) => r.maxStretch, 0, 1.0001],
  ['hard speed clamp hits', (r) => r.hardClamps, 0, 0],
  ['distinct partners per node', (r) => r.partnersMean, 12, 1e9],
  ['p95 speed / top speed, worst type', (r) => Math.max(...TYPES.map((t) => r.perType[t].ratioP95).filter(Number.isFinite)), 0, 1.3],
];

function report(r) {
  console.log(`\n=== seed "${r.seed}" — ${r.nodes} nodes, ${r.minutes} min measured ===`);
  console.log('type     links/node  at cap  speed mean  p95   max   p95/top  max/top  life med  life p90');
  for (const t of TYPES) {
    const p = r.perType[t];
    console.log(
      t.padEnd(8),
      f(p.linksPerNode, 2).padStart(10), f(p.atCap * 100, 0).padStart(6) + '%',
      f(p.speedMean).padStart(10), f(p.speedP95).padStart(5), f(p.speedMax).padStart(5),
      f(p.ratioP95, 2).padStart(8), f(p.ratioMax, 2).padStart(8),
      (f(p.lifeMedian) + 's').padStart(9), (f(p.lifeP90) + 's').padStart(9),
    );
  }
  console.log(`\nlinks formed per minute: ${f(r.formedPerMin, 0)}   releases: ${Object.entries(r.releases).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`link lifetime p10/median/p90: ${f(r.lifeP10)}s / ${f(r.lifeMedian)}s / ${f(r.lifeP90)}s`);
  console.log(`distinct partners per node: mean ${f(r.partnersMean)} (min ${f(r.partnersMin, 0)}); share of all pairs ever linked: ${f(r.pairsEverLinked * 100, 0)}%`);
  console.log(`spread (grid CV, random ~0.7): early ${f(r.cvEarly, 2)}, late ${f(r.cvLate, 2)}; largest linked group (a random degree-3 graph always has a giant one): mean ${f(r.compMean)}, max ${f(r.compMax, 0)}`);
  console.log(`links shared with 30 s / 60 s earlier: ${f(r.similarity30 * 100, 0)}% / ${f(r.similarity60 * 100, 0)}%`);
  console.log(`stretched past connect distance: ${f(r.tautShare * 100, 0)}% of link-time; max |z| reached: ${f(r.maxZ, 0)}`);
}

function checkTargets(results) {
  console.log('\n--- targets (average over seeds) ---');
  let bad = 0;
  for (const [label, fn, lo, hi] of targets) {
    const v = mean(results.map(fn));
    const ok = v >= lo && v <= hi;
    if (!ok) bad++;
    console.log(`${ok ? 'ok ' : '!! '} ${label.padEnd(44)} ${f(v, 2).padStart(8)}   wanted ${lo} .. ${hi >= 1e9 ? '∞' : hi}`);
  }
  console.log(bad ? `\n${bad} target(s) off` : '\nall targets met');
}

const opts = parseArgs(process.argv.slice(2));
const results = [];
for (let k = 0; k < opts.seeds; k++) results.push(runOne(opts, opts.seeds > 1 ? `${opts.seed}-${k + 1}` : opts.seed));
if (opts.json) console.log(JSON.stringify(results, null, 2));
else {
  report(results[0]);
  checkTargets(results);
}
