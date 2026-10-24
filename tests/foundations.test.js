import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, hash2 } from '../src/sim/rng.js';
import { createNoise } from '../src/sim/noise.js';
import { DEFAULTS, SCHEMA, SCHEMA_BY_PATH, mergeParams, validateParams, getPath, sanitizeParams } from '../src/sim/params.js';
import { applyMacros, MACROS } from '../src/sim/macros.js';

test('rng: same seed gives the same sequence, different seed does not', () => {
  const a = new Rng('x'), b = new Rng('x'), c = new Rng('y');
  const sa = Array.from({ length: 50 }, () => a.next());
  const sb = Array.from({ length: 50 }, () => b.next());
  const sc = Array.from({ length: 50 }, () => c.next());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  assert.ok(sa.every((v) => v >= 0 && v < 1));
});

test('rng: forks are independent of how much the parent has been used', () => {
  const a = new Rng('x'), b = new Rng('x');
  for (let i = 0; i < 100; i++) a.next();
  assert.equal(a.fork('node:a').next(), b.fork('node:a').next());
  assert.notEqual(a.fork('node:a').next(), a.fork('node:b').next());
});

test('rng: roughly uniform', () => {
  const r = new Rng('u');
  let sum = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) sum += r.next();
  assert.ok(Math.abs(sum / n - 0.5) < 0.01);
});

test('hash2 is directional', () => {
  assert.notEqual(hash2(3, 9, 1), hash2(9, 3, 1));
  assert.equal(hash2(3, 9, 1), hash2(3, 9, 1));
});

test('noise: deterministic per seed, bounded, smooth', () => {
  const n1 = createNoise(new Rng('n')), n2 = createNoise(new Rng('n')), n3 = createNoise(new Rng('m'));
  let max = 0, differs = false;
  for (let i = 0; i < 5000; i++) {
    const x = i * 0.137, y = i * 0.071 + 3.3, z = 1.7;
    const v = n1(x, y, z);
    assert.equal(v, n2(x, y, z));
    if (v !== n3(x, y, z)) differs = true;
    max = Math.max(max, Math.abs(v));
    assert.ok(Math.abs(n1(x + 0.001, y, z) - v) < 0.02);
  }
  assert.ok(differs);
  assert.ok(max <= 1.0001 && max > 0.5);
});

test('params: defaults satisfy their own schema', () => {
  assert.deepEqual(validateParams(DEFAULTS), []);
  for (const e of SCHEMA) assert.notEqual(getPath(DEFAULTS, e.path), undefined, e.path);
  for (const e of SCHEMA) {
    const vals = e.kind === 'range' ? e.default : e.kind === 'bool' ? [] : [e.default];
    for (const v of vals) assert.ok(v >= e.min && v <= e.max, `${e.path} default ${v} outside range`);
    if (e.kind === 'range') assert.ok(e.default[0] <= e.default[1], e.path);
  }
});

test('params: validation catches unknown and out-of-range values', () => {
  assert.ok(validateParams({ links: { nonsense: 1 } }).length > 0);
  assert.ok(validateParams({ links: { connect: 99999 } }).length > 0);
  assert.ok(validateParams({ types: { venue: { speed: [1] } } }).length > 0);
  assert.deepEqual(validateParams({ links: { connect: 300 } }), []);
});

test('params: merge replaces arrays and keeps the rest', () => {
  const m = mergeParams(DEFAULTS, { types: { venue: { speed: 3 } }, links: { pull: 7 } });
  assert.equal(m.types.venue.speed, 3);
  assert.equal(m.links.pull, 7);
  assert.equal(m.types.artist.speed, DEFAULTS.types.artist.speed);
  assert.equal(DEFAULTS.types.venue.speed, 9, 'defaults must not be mutated');
});

test('macros: 0.5 is neutral, extremes scale and stay in range', () => {
  const neutral = applyMacros(DEFAULTS, { tempo: 0.5, promiscuity: 0.5, tension: 0.5 });
  assert.deepEqual(neutral, DEFAULTS);
  const hi = applyMacros(DEFAULTS, { tempo: 1 });
  assert.ok(hi.global.speedScale > DEFAULTS.global.speedScale);
  const lo = applyMacros(DEFAULTS, { tempo: 0 });
  assert.ok(lo.global.speedScale < DEFAULTS.global.speedScale);
  for (const name of Object.keys(MACROS)) {
    for (const m of [0, 1]) {
      assert.deepEqual(validateParams(applyMacros(DEFAULTS, { [name]: m })), [], `${name} at ${m}`);
    }
  }
  assert.ok(SCHEMA_BY_PATH.size > 60);
});

test('params: sanitize drops old parameters and clamps the rest, so saved recipes survive a schema change', () => {
  const { params, dropped } = sanitizeParams({
    swing: { ropeLength: 260, fling: 0.4 },
    links: { connect: 99999, pull: 7 },
    types: { venue: { speed: [8, 3], mass: 99999 }, artist: { appMin: 2 } },
    affinity: { venue: { artist: [0.2, 0.8] } },
    bogus: 1,
  });
  assert.deepEqual(dropped.sort(), ['affinity.venue.artist', 'bogus', 'swing.fling', 'swing.ropeLength', 'types.artist.appMin', 'types.venue.speed']);
  assert.equal(params.types.venue.mass, 40, 'out-of-range values are clamped');
  assert.equal(params.links.connect, 600);
  assert.equal(params.links.pull, 7);
  assert.deepEqual(validateParams(params), []);
});
