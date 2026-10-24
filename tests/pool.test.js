import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { exportRecipe } from '../src/recipe.js';
import { TYPES } from '../src/sim/params.js';
import { NODE_LIST, checkInvariants, merge } from './helpers.js';

const make = (params = {}, nodes = NODE_LIST, seed = 'pool') =>
  new World({ seed, nodes, params: merge({ world: { stars: 6, maxAlive: 40, lifeMin: 30, lifeMax: 60 } }, params) });
const alive = (w) => w.nodes.filter((n) => n.type !== 'star' && n.removingAt === null);
const counts = (w) => Object.fromEntries(TYPES.filter((t) => t !== 'star').map((t) => [t, alive(w).filter((n) => n.type === t).length]));

test('pool: about maxAlive nodes are alive, all from the list, none twice', () => {
  const w = make();
  assert.equal(alive(w).length, 40);
  const names = new Set(NODE_LIST.map((n) => `${n.type}:${n.name}`));
  let sum = 0, samples = 0;
  for (let i = 0; i < 600 * 60; i++) {
    w.step();
    if (i % 120 === 0) {
      const a = alive(w);
      sum += a.length; samples++;
      assert.ok(a.length >= 35 && a.length <= 40, `alive ${a.length}`);
      assert.equal(new Set(a.map((n) => n.poolKey)).size, a.length, 'nobody alive twice');
      for (const n of a) assert.ok(names.has(n.poolKey));
      checkInvariants(w);
    }
  }
  assert.ok(sum / samples > 38.5, `average alive ${(sum / samples).toFixed(1)}`);
});

test('pool: nodes keep leaving and arriving, so the cast keeps changing', () => {
  const w = make();
  const seen = new Set(alive(w).map((n) => n.poolKey));
  let adds = 0, removes = 0;
  for (let i = 0; i < 600 * 60; i++) {
    w.step();
    for (const e of w.drainEvents()) { if (e.type === 'add') adds++; if (e.type === 'remove') removes++; }
    for (const n of alive(w)) seen.add(n.poolKey);
  }
  assert.ok(adds > 30 && removes > 30, `adds ${adds}, removes ${removes}`);
  assert.ok(seen.size > 0.9 * w.pool.length, `${seen.size} of ${w.pool.length} on the list took part`);
});

test('pool: lifetimes stay within the set range', () => {
  const w = make({ world: { lifeMin: 40, lifeMax: 50, maxAlive: 30 } });
  const came = new Map();
  const lives = [];
  for (let i = 0; i < 900 * 60; i++) {
    w.step();
    for (const e of w.drainEvents()) {
      if (e.type === 'add') came.set(e.a, e.t);
      if (e.type === 'remove' && came.has(e.a)) lives.push(e.t - came.get(e.a));
    }
  }
  assert.ok(lives.length > 40);
  for (const l of lives) assert.ok(l >= 39.9 && l <= 50.1, `lifetime ${l.toFixed(1)}`);
});

test('pool: a replacement is the same category, so the mix stays steady', () => {
  const w = make();
  const start = counts(w);
  for (let i = 0; i < 600 * 60; i++) {
    w.step();
    if (i % 600 === 0) {
      const c = counts(w);
      for (const t of Object.keys(start)) assert.ok(Math.abs(c[t] - start[t]) <= 2, `${t}: ${c[t]} vs ${start[t]}`);
    }
  }
});

test('pool: without the same-category rule the mix may drift but the cap holds', () => {
  const w = make({ world: { respawnSameType: false } });
  w.run(400);
  assert.ok(alive(w).length >= 38 && alive(w).length <= 40);
});

test('pool: a returning node has the same personality as before', () => {
  const small = NODE_LIST.filter((n) => n.type === 'venue').slice(0, 9);
  const w = new World({ seed: 'again', nodes: small, params: { world: { stars: 0, maxAlive: 7, lifeMin: 10, lifeMax: 15 } } });
  const seen = new Map();
  let returned = 0;
  for (let i = 0; i < 400 * 60; i++) {
    w.step();
    for (const n of w.nodes) {
      const sig = JSON.stringify([n.traits.cruise, n.traits.mass, n.traits.aff]);
      if (seen.has(n.poolKey) && seen.get(n.poolKey) !== sig) assert.fail(`${n.poolKey} changed personality`);
      if (seen.has(n.poolKey) && !seen.get(`${n.poolKey}#back`)) { seen.set(`${n.poolKey}#back`, true); returned++; }
      seen.set(n.poolKey, sig);
    }
  }
  assert.ok(returned > 0, 'somebody came back');
});

test('pool: arrivals appear in the margin around the visible area', () => {
  const w = make({ world: { lifeMin: 10, lifeMax: 15, maxAlive: 30 } });
  const m = w.p.world.margin;
  let arrivals = 0;
  for (let i = 0; i < 300 * 60; i++) {
    w.step();
    for (const e of w.drainEvents()) {
      if (e.type !== 'add') continue;
      const n = w.get(e.a);
      assert.ok(n.x < m + 2 || n.x > w.W - m - 2 || n.y < m + 2 || n.y > w.H - m - 2, `${n.id} appeared at ${n.x.toFixed(0)},${n.y.toFixed(0)}`);
      arrivals++;
    }
  }
  assert.ok(arrivals > 20);
});

test('pool: with room for the whole list nobody ever leaves', () => {
  const w = make({ world: { maxAlive: 200, lifeMin: 5, lifeMax: 10 } });
  w.run(300);
  assert.equal(alive(w).length, NODE_LIST.length);
  assert.ok(!w.drainEvents().some((e) => e.type === 'remove'));
});

test('pool: deleting a node takes it off the list for good, and someone else arrives in its place', () => {
  const w = make();
  const victim = alive(w)[0];
  const size = w.pool.length;
  assert.ok(w.forgetNode(victim.id));
  assert.equal(w.pool.length, size - 1);
  for (let i = 0; i < 600 * 60; i++) {
    w.step();
    assert.ok(!alive(w).some((n) => n.poolKey === victim.poolKey), 'it never returns');
  }
  assert.ok(alive(w).length >= 38);
});

test('pool: sending a node away only for now: a manual removal is replaced and the node can return later', () => {
  const w = make();
  const victim = alive(w)[0];
  w.removeNode(victim.id);
  w.run(5);
  assert.ok(alive(w).length >= 39, 'the gap is filled');
  assert.ok(w.pool.some((d) => `${d.type}:${d.name}` === victim.poolKey), 'but it stays on the list');
});

test('pool: lowering the cap lets nodes leave one by one, raising it brings them in', () => {
  const w = make();
  w.run(5);
  w.set('world.maxAlive', 20);
  w.run(60);
  assert.ok(alive(w).length <= 21, `alive ${alive(w).length}`);
  w.set('world.maxAlive', 60);
  w.run(60);
  assert.ok(alive(w).length >= 55, `alive ${alive(w).length}`);
  checkInvariants(w);
});

test('pool: the crowd (stars) is unaffected', () => {
  const w = make();
  for (let i = 0; i < 300 * 60; i++) {
    w.step();
    if (i % 300 === 0) assert.equal(w.nodes.filter((n) => n.type === 'star' && n.removingAt === null).length, 6);
  }
});

test('pool: deterministic per seed, and different seeds start with different casts', () => {
  const a = make({}, NODE_LIST, 's1'), b = make({}, NODE_LIST, 's1'), c = make({}, NODE_LIST, 's2');
  a.run(200); b.run(200); c.run(200);
  assert.equal(a.hash(), b.hash());
  assert.notEqual(a.hash(), c.hash());
  assert.notDeepEqual(alive(make({}, NODE_LIST, 's1')).map((n) => n.id).sort(), alive(make({}, NODE_LIST, 's2')).map((n) => n.id).sort());
});

test('pool: the recipe keeps the whole list, not just who is alive', () => {
  const w = make();
  w.run(30);
  const r = exportRecipe(w);
  assert.equal(r.nodes.length, NODE_LIST.length);
});

test('pool: a crowded field of 92 nodes does not collapse into one clump', () => {
  const w = new World({ seed: 'dense', nodes: NODE_LIST, params: { world: { maxAlive: 999 } } });
  const cv = () => {
    const cells = new Array(28).fill(0);
    for (const n of w.nodes) cells[Math.min(3, Math.floor(n.y / w.H * 4)) * 7 + Math.min(6, Math.floor(n.x / w.W * 7))]++;
    const m = w.nodes.length / 28;
    return Math.sqrt(cells.reduce((a, c) => a + (c - m) ** 2, 0) / 28) / m;
  };
  w.run(420);
  assert.ok(cv() < 1.4, `grid CV ${cv().toFixed(2)}`);
  assert.ok(w.stats().meanSpeed > 4, `mean speed ${w.stats().meanSpeed.toFixed(1)}`);
});
