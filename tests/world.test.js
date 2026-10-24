import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { TYPES } from '../src/sim/params.js';
import { createWorld, exportRecipe } from '../src/recipe.js';
import { makeWorld, checkInvariants, NODE_LIST, QUIET, controlled, ctlNode, linkBetween, merge } from './helpers.js';

const D = 200; // links.connect in the controlled worlds (pinned in QUIET); ctlNode makes every pair's connect distance exactly this
const reasons = (w) => w.drainEvents().filter((e) => e.type === 'unlink').map((e) => e.reason);

// ---- the whole world ------------------------------------------------------

test('determinism: same seed gives the same state, different seed does not', () => {
  const a = makeWorld(), b = makeWorld(), c = makeWorld({ seed: 'other' });
  a.run(40); b.run(40); c.run(40);
  assert.equal(a.hash(), b.hash());
  assert.notEqual(a.hash(), c.hash());
});

test('determinism: stepping in chunks equals one run', () => {
  const a = makeWorld(), b = makeWorld();
  a.run(30);
  for (let i = 0; i < 30; i++) b.run(1);
  assert.equal(a.hash(), b.hash());
});

test('determinism: adding a node does not change the traits of existing ones', () => {
  const a = makeWorld(), b = makeWorld({ nodes: [...NODE_LIST, { name: 'Extra', type: 'venue' }] });
  for (const n of a.nodes) assert.deepEqual(b.get(n.id).traits.aff, n.traits.aff);
});

test('invariants hold over five simulated minutes (caps, bounds, no NaN, links within break distance)', () => {
  const w = makeWorld();
  for (let i = 0; i < 300 * 60; i++) {
    w.step();
    if (i % 30 === 0) checkInvariants(w, `tick ${i}`);
  }
  assert.equal(w.hardClamps, 0);
  assert.ok(w.links.length > 0, 'network should have links');
});

test('invariants hold with deep depth, many stars and a fast tempo', () => {
  const w = makeWorld({ params: { world: { stars: 24, depth: 1600 }, global: { speedScale: 2.5 } } });
  for (let i = 0; i < 120 * 60; i++) {
    w.step();
    if (i % 30 === 0) checkInvariants(w, `tick ${i}`);
  }
  assert.equal(w.hardClamps, 0);
});

test('no energy runaway: late mean speed stays close to early mean speed', () => {
  const w = makeWorld();
  w.run(30);
  const mean = (secs) => {
    let s = 0, k = 0;
    for (let i = 0; i < secs * 60; i++) {
      w.step();
      if (i % 20 === 0) { s += w.stats().meanSpeed; k++; }
    }
    return s / k;
  };
  const early = mean(60);
  w.run(300);
  const late = mean(60);
  assert.ok(late / early > 0.75 && late / early < 1.3, `early ${early.toFixed(1)} late ${late.toFixed(1)}`);
});

test('speeds stay near their ceiling: nobody exceeds 1.6x top speed', () => {
  const w = makeWorld();
  let worst = 0;
  for (let i = 0; i < 240 * 60; i++) {
    w.step();
    if (i % 10 === 0) for (const n of w.nodes) worst = Math.max(worst, Math.hypot(n.vx, n.vy, n.vz) / (n.traits.top * w.p.global.speedScale));
  }
  assert.ok(worst < 1.6, `worst speed ratio ${worst.toFixed(2)}`);
});

test('the network keeps rearranging: most links a minute later are different ones', () => {
  const w = makeWorld();
  w.run(120);
  const keys = () => new Set(w.links.map((l) => [l.a.id, l.b.id].sort().join('|')));
  const before = keys();
  w.run(60);
  const after = keys();
  let shared = 0;
  for (const k of before) if (after.has(k)) shared++;
  const jaccard = shared / (before.size + after.size - shared);
  assert.ok(jaccard < 0.4, `${(jaccard * 100).toFixed(0)}% of links survived a minute`);
});

test('nodes stay spread over the field instead of collapsing into one clump', () => {
  const w = makeWorld();
  const cv = () => {
    const cells = new Array(28).fill(0);
    for (const n of w.nodes) cells[Math.min(3, Math.floor(n.y / w.H * 4)) * 7 + Math.min(6, Math.floor(n.x / w.W * 7))]++;
    const m = w.nodes.length / 28;
    return Math.sqrt(cells.reduce((a, c) => a + (c - m) ** 2, 0) / 28) / m;
  };
  w.run(300);
  assert.ok(cv() < 1.4, `grid CV ${cv().toFixed(2)} (random is about 0.7)`);
});

// ---- depth and wrap ---------------------------------------------------------

test('depth scale 0 keeps the simulation flat', () => {
  const w = makeWorld({ params: { world: { depthScale: 0 } } });
  for (let i = 0; i < 60 * 60; i++) {
    w.step();
    if (i % 60 === 0) for (const n of w.nodes) assert.ok(n.z === 0 && n.vz === 0 && n.hz === 0);
  }
});

test('depth: nodes use the z axis and stay inside the limits', () => {
  const w = makeWorld();
  let maxZ = 0;
  for (let i = 0; i < 120 * 60; i++) {
    w.step();
    for (const n of w.nodes) maxZ = Math.max(maxZ, Math.abs(n.z));
  }
  assert.ok(maxZ > 0.6 * w.zHalf, `max |z| only ${maxZ.toFixed(0)} of ${w.zHalf}`);
  assert.ok(maxZ <= w.zHalf + 1e-6);
});

test('depth scale can be changed live', () => {
  const w = makeWorld();
  w.run(10);
  w.set('world.depthScale', 0);
  for (const n of w.nodes) assert.ok(n.z === 0 && n.vz === 0);
  w.run(10);
  w.set('world.depthScale', 1);
  w.run(20);
  assert.ok(w.nodes.some((n) => Math.abs(n.z) > 1));
  checkInvariants(w);
});

test('wrap: distance across the seam is the short way round', () => {
  const w = controlled([ctlNode('A', 'venue', 10, 10), ctlNode('B', 'venue', 2090, 1230)]);
  const [a, b] = w.nodes;
  const d = w._dist(a, b);
  assert.ok(Math.abs(d - Math.hypot(20, 20)) < 1e-9);
  assert.equal(w.dx, -20);
  assert.equal(w.dy, -20);
});

test('wrap: nodes leaving one edge appear on the other', () => {
  const w = controlled([ctlNode('A', 'venue', 2099.9, 500)]);
  const a = w.nodes[0];
  a.vx = 60;
  w.step(); w.step();
  assert.ok(a.x < 5, `x = ${a.x}`);
});

test('wrap: two nodes either side of the seam link up', () => {
  const w = controlled([ctlNode('A', 'artist', 2090, 600), ctlNode('B', 'artist', 60, 600)]);
  w.step();
  assert.ok(linkBetween(w, 'a', 'b'), 'a link across the seam');
});

// ---- connecting -------------------------------------------------------------

test('connect: nodes link when they come within connect distance, and not before', () => {
  const w = controlled([
    ctlNode('Near A', 'artist', 500, 300), ctlNode('Near B', 'artist', 500 + 0.9 * D, 300),
    ctlNode('Far A', 'artist', 500, 900), ctlNode('Far B', 'artist', 500 + 1.1 * D, 900),
  ]);
  w.step();
  assert.ok(linkBetween(w, 'near-a', 'near-b'));
  assert.ok(!linkBetween(w, 'far-a', 'far-b'));
  w.get('far-b').x = 500 + 0.95 * D;
  w.step();
  assert.ok(linkBetween(w, 'far-a', 'far-b'), 'links as soon as the distance closes');
});

test('connect: affinity stretches or shrinks the distance, and a one-sided crush meets in the middle', () => {
  const mk = (affA, affB) => controlled([
    ctlNode('A', 'artist', 500, 500, { aff: Array(TYPES.length).fill(affA) }),
    ctlNode('B', 'artist', 900, 500, { aff: Array(TYPES.length).fill(affB) }),
  ]);
  const both = mk(1, 1).connectDistance(...mk(1, 1).nodes);
  const none = mk(0, 0).connectDistance(...mk(0, 0).nodes);
  const mixed = mk(1, 0).connectDistance(...mk(1, 0).nodes);
  assert.ok(both > 2 * none, `${both.toFixed(0)} vs ${none.toFixed(0)}`);
  assert.ok(mixed > none && mixed < both);
  assert.ok(Math.abs(mixed - (both + none) / 2) < 1e-6);
  // at 250 apart the keen pair link and the indifferent pair do not
  const keen = mk(1, 1), cold = mk(0, 0);
  keen.nodes[1].x = 750; cold.nodes[1].x = 750;
  keen.step(); cold.step();
  assert.equal(keen.links.length, 1);
  assert.equal(cold.links.length, 0);
});

test('connect: dragging two nodes together connects them', () => {
  const w = controlled([ctlNode('Dragged', 'artist', 400, 600), ctlNode('Target', 'artist', 1300, 600)], { links: { pull: 5 }, grab: { authority: 1 } });
  assert.equal(w.links.length, 0);
  assert.ok(w.grab('dragged', 400, 600));
  // move the cursor toward the target at 250 units per second, stopping at 0.6 of its connect distance
  const stop = 1300 - 0.6 * D;
  let cx = 400;
  for (let i = 0; i < 6 * 60 && !w.links.length; i++) {
    cx = Math.min(stop, cx + 250 / 60);
    w.moveGrab('dragged', cx, 600);
    w.step();
  }
  assert.ok(linkBetween(w, 'dragged', 'target'), 'the pair should have linked on contact');
  assert.ok(w.links[0].born < 6, 'quickly');
});

test('connect: dragging a node onto a free node in the full world connects them', () => {
  const w = makeWorld({ params: { world: { stars: 0 } } });
  w.run(60);
  const free = w.nodes.filter((n) => n.links.length < n.traits.appMax - 1);
  const a = free[0];
  // a node grabbed keeps its depth, so the target has to be within reach in depth too
  const b = free.find((n) => n !== a && !w._linked(n, a) && Math.abs(n.z - a.z) < 0.4 * w.p.links.connect);
  assert.ok(a && b, 'two nodes with spare capacity at a compatible depth');
  w.grab(a.id, a.x, a.y);
  let cx = a.x, cy = a.y, linked = false;
  for (let i = 0; i < 20 * 60 && !linked; i++) {
    b.vx = b.vy = b.vz = 0;
    // walk the cursor to a point a short way from the target at 300 units per second
    const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
    const step = Math.min(5, Math.max(0, d - 70));
    cx += (dx / (d || 1)) * step; cy += (dy / (d || 1)) * step;
    w.moveGrab(a.id, cx, cy);
    w.step();
    linked = w._linked(a, b);
  }
  assert.ok(linked, `${a.id} dragged next to ${b.id} should link`);
});

test('swap: a full node takes a clearly closer newcomer and drops its most stretched link', () => {
  const w = controlled([
    ctlNode('Full', 'artist', 800, 600, { appMax: 1 }),
    ctlNode('Old', 'artist', 800 + 0.95 * D, 600),
  ]);
  w.step();
  assert.ok(linkBetween(w, 'full', 'old'));
  w.drainEvents();
  w.addNode(ctlNode('Closer', 'artist', 800 - 0.5 * D, 600));
  w.run(3);
  assert.ok(linkBetween(w, 'full', 'closer'));
  assert.ok(!linkBetween(w, 'full', 'old'));
  assert.ok(reasons(w).includes('swap'));
});

test('swap: a newcomer that is only slightly closer does not shake a full node', () => {
  const w = controlled([
    ctlNode('Full', 'artist', 800, 600, { appMax: 1 }),
    ctlNode('Old', 'artist', 800 + 0.95 * D, 600),
  ]);
  w.step();
  w.addNode(ctlNode('Almost', 'artist', 800 - 0.9 * D, 600));
  w.run(3);
  assert.ok(linkBetween(w, 'full', 'old'));
  assert.ok(!linkBetween(w, 'full', 'almost'));
});

test('caps: no node ever holds more links than its cap, stars at most four', () => {
  const w = makeWorld({ params: { world: { stars: 12 }, links: { capScale: 3 } } });
  for (let i = 0; i < 120 * 60; i++) {
    w.step();
    for (const n of w.nodes) {
      assert.ok(n.links.length <= n.traits.appMax);
      if (n.type === 'star') assert.ok(n.links.length <= 4);
    }
  }
});

test('caps: lowering the cap live drops the most stretched surplus links at once', () => {
  const w = makeWorld();
  w.run(90);
  w.drainEvents();
  w.set('links.capScale', 0.4);
  w.step();
  for (const n of w.nodes) assert.ok(n.links.length <= n.traits.appMax, `${n.id}: ${n.links.length}/${n.traits.appMax}`);
  assert.ok(reasons(w).includes('cap'));
});

// ---- links are soft and brittle ----------------------------------------------

test('brittle: a node with enough speed walks out of the network and keeps its momentum', () => {
  const w = controlled(
    [ctlNode('Anchor', 'venue', 800, 600, { mass: 100 }), ctlNode('Runner', 'artist', 800 + 0.8 * D, 600)],
    { links: { pull: 5 } },
  );
  w.step();
  const link = linkBetween(w, 'anchor', 'runner');
  assert.ok(link);
  const runner = w.get('runner');
  runner.vx = 60;
  let maxJump = 0, prev = runner.vx, brokeAt = null;
  for (let i = 0; i < 12 * 60; i++) {
    w.step();
    maxJump = Math.max(maxJump, Math.abs(runner.vx - prev));
    prev = runner.vx;
    if (brokeAt === null && !w.links.length) brokeAt = w.t;
  }
  assert.ok(brokeAt !== null && brokeAt < 8, `link should dissolve (broke at ${brokeAt})`);
  assert.ok(runner.vx > 30, `momentum kept: ${runner.vx.toFixed(1)}`);
  assert.ok(maxJump < 0.6, `velocity never jerks: biggest change per tick ${maxJump.toFixed(3)}`);
  assert.ok(reasons(w).includes('stretch'));
});

test('brittle: a node whose own flight path leads away just goes, however gently', () => {
  const w = controlled(
    [ctlNode('Anchor', 'venue', 800, 600, { mass: 100 }), ctlNode('Drifter', 'artist', 800 + 0.8 * D, 600, { cruise: 25 })],
    { links: { pull: 5 }, global: { pathMemory: 0.5 } },
  );
  const d = w.get('drifter');
  d.hx = 1; d.hy = 0; d.hz = 0;
  w.step();
  assert.ok(linkBetween(w, 'anchor', 'drifter'));
  w.run(40);
  assert.ok(!linkBetween(w, 'anchor', 'drifter'), 'the link gives in');
  assert.ok(d.x > 800 + 1.35 * D, 'and the drifter is on its way');
});

test('soft: a node dragged gently takes its partner along; dragged hard, the link dissolves', () => {
  const build = () => controlled(
    [ctlNode('Held', 'artist', 600, 600), ctlNode('Partner', 'artist', 600 + 0.7 * D, 600)],
    { links: { pull: 5 }, grab: { authority: 1 } },
  );
  const gentle = build();
  gentle.step();
  gentle.grab('held', 600, 600);
  for (let i = 0; i < 20 * 60; i++) { gentle.moveGrab('held', 600 - (i / 60) * 6, 600); gentle.step(); }
  assert.ok(linkBetween(gentle, 'held', 'partner'), 'gentle drag keeps the link');
  assert.ok(gentle.get('partner').x < 600 + 0.7 * D - 60, `and the partner follows (x = ${gentle.get('partner').x.toFixed(0)})`);

  const hard = build();
  hard.step();
  hard.grab('held', 600, 600);
  for (let i = 0; i < 3 * 60; i++) { hard.moveGrab('held', 600 - (i / 60) * 150, 600); hard.step(); }
  assert.ok(!linkBetween(hard, 'held', 'partner'), 'a hard pull dissolves it');
  assert.ok(reasons(hard).includes('stretch'));
});

test('fatigue: a pair that never moves still lets go once the link has aged, and never with fatigue off', () => {
  const build = (fatigue) => controlled(
    [ctlNode('A', 'artist', 800, 600), ctlNode('B', 'artist', 800 + 0.9 * D, 600)],
    { links: { fatigue } },
  );
  const worn = build(20);
  worn.step();
  assert.ok(worn.links.length === 1);
  let at = null;
  for (let i = 0; i < 30 * 60 && at === null; i++) { worn.step(); if (!worn.links.length) at = worn.t; }
  assert.ok(at > 11 && at < 13.5, `wore out at ${at}`);
  assert.ok(reasons(worn).includes('worn'));
  worn.run(6);
  assert.equal(worn.links.length, 0, 'no instant re-link inside the cooldown');
  worn.run(4);
  assert.equal(worn.links.length, 1, 'they may meet again afterwards');

  const fresh = build(0);
  fresh.run(120);
  assert.equal(fresh.links.length, 1);
});

test('link pull draws two roaming nodes together without ever stopping them dead', () => {
  const w = controlled(
    [ctlNode('A', 'artist', 800, 600), ctlNode('B', 'artist', 800 + 1.3 * D, 600)],
    { links: { pull: 8 } },
  );
  w.get('a').x = 800; w._link(w.get('a'), w.get('b'));
  w.run(10);
  const d = w._dist(w.get('a'), w.get('b'));
  assert.ok(d < 1.3 * D, `pulled in to ${d.toFixed(0)}`);
});

// ---- grabbing ----------------------------------------------------------------

test('grab: mouse authority decides who wins, the mouse or the network', () => {
  const lagAt = (authority) => {
    const w = controlled(
      [ctlNode('Anchor', 'venue', 800, 600, { mass: 1000 }), ctlNode('Held', 'artist', 800 + 0.7 * D, 600)],
      { links: { pull: 5 }, grab: { authority } },
    );
    w.step();
    w.grab('held', 800 + 0.7 * D, 600);
    const cursor = 800 + 1.15 * D;
    for (let i = 0; i < 8 * 60; i++) { w.moveGrab('held', cursor, 600); w.step(); }
    return { lag: Math.abs(cursor - w.get('held').x), linked: !!w.links.length };
  };
  const strong = lagAt(1), weak = lagAt(0);
  assert.ok(strong.lag < 2, `full authority lag ${strong.lag.toFixed(1)}`);
  assert.ok(weak.lag > 5 * strong.lag + 5, `no authority lag ${weak.lag.toFixed(1)}`);
});

test('grab: a held node keeps its depth and a released one keeps its momentum', () => {
  const w = makeWorld({ params: { world: { stars: 0 } } });
  w.run(30);
  const n = w.get('bjork');
  const z0 = n.z;
  w.grab('bjork', n.x, n.y);
  for (let i = 0; i < 90; i++) { w.moveGrab('bjork', n.x + 12, n.y); w.step(); }
  assert.equal(n.z, z0);
  const v = [n.vx, n.vy, n.vz];
  w.release('bjork');
  assert.deepEqual([n.vx, n.vy, n.vz], v);
  const s = Math.hypot(...v);
  assert.ok(Math.abs(n.hx - n.vx / s) < 1e-9 && Math.abs(n.hy - n.vy / s) < 1e-9, 'flight path follows the flick');
  w.run(15);
  checkInvariants(w);
});

test('grab: a flicked node coasts and settles back toward its own speed', () => {
  const w = makeWorld({ params: { world: { stars: 0 } } });
  const n = w.get('kiasmos');
  w.grab('kiasmos', n.x, n.y);
  for (let i = 0; i < 30; i++) { w.moveGrab('kiasmos', n.x + 300, n.y); w.step(); }
  w.release('kiasmos');
  const top = n.traits.top * w.p.global.speedScale;
  assert.ok(Math.hypot(n.vx, n.vy) > top, 'flung faster than top speed');
  w.run(20);
  assert.ok(Math.hypot(n.vx, n.vy) < top * 1.3);
});

// ---- magnetism and affinity ---------------------------------------------------

test('magnetism: liked nodes drift toward each other before they connect, disliked ones drift apart', () => {
  const gap = (aff, start, strength) => {
    const w = controlled(
      [ctlNode('A', 'artist', 800, 600, { aff: Array(TYPES.length).fill(aff) }), ctlNode('B', 'artist', 800 + start, 600, { aff: Array(TYPES.length).fill(aff) })],
      { magnet: { strength } },
    );
    w.run(5);
    return w._dist(w.get('a'), w.get('b')) - start;
  };
  assert.ok(gap(1, 360, 5) < -5, 'liked nodes close the gap');
  assert.ok(gap(0, 150, 5) > 5, 'disliked nodes open it');
  assert.ok(Math.abs(gap(1, 360, 0)) < 1e-6, 'and nothing happens with the slider at 0');
});

test('affinity: nodes differ in taste, and one variety dial sets whether they prefer other categories', () => {
  const taste = (variety) => {
    const w = makeWorld({ params: { links: { variety } } });
    let same = 0, other = 0, ns = 0, no = 0;
    const distinct = new Set();
    for (const n of w.nodes) n.traits.aff.forEach((a, k) => {
      assert.ok(a >= 0 && a <= 1);
      if (k === n.ti) { same += a; ns++; } else { other += a; no++; }
      distinct.add(a.toFixed(3));
    });
    return { same: same / ns, other: other / no, distinct: distinct.size };
  };
  const flat = taste(0), varied = taste(1);
  assert.ok(Math.abs(flat.same - flat.other) < 0.06, 'variety 0: no preference');
  assert.ok(varied.other - varied.same > 0.3, `variety 1: others liked more (${varied.other.toFixed(2)} vs ${varied.same.toFixed(2)})`);
  assert.ok(flat.distinct > 50, 'every node has its own taste');
});

test('individuality 0 makes nodes of a category identical, and 1 makes them differ', () => {
  const traits = (I) => makeWorld({ params: { global: { individuality: I } } }).nodes.filter((n) => n.type === 'venue').map((n) => n.traits);
  const same = traits(0), varied = traits(1);
  assert.equal(new Set(same.map((t) => t.cruise.toFixed(6))).size, 1);
  assert.equal(new Set(same.map((t) => t.mass.toFixed(6))).size, 1);
  assert.ok(new Set(varied.map((t) => t.cruise.toFixed(3))).size > 8);
  const spread = (k) => Math.max(...varied.map((t) => t[k])) - Math.min(...varied.map((t) => t[k]));
  assert.ok(spread('cruise') > 0.3 * same[0].cruise && spread('mass') > 0.3 * same[0].mass);
});

test('individuality also makes each pair a little different, and A\'s feeling for B is not B\'s for A', () => {
  const w = makeWorld();
  const flat = makeWorld({ params: { global: { individuality: 0 } } });
  let diff = 0, diffFlat = 0, n = 0;
  for (let i = 0; i < 20; i++) for (let j = i + 1; j < 20; j++) {
    diff += Math.abs(w.aff(w.nodes[i], w.nodes[j]) - w.aff(w.nodes[j], w.nodes[i]));
    diffFlat += Math.abs(flat.aff(flat.nodes[i], flat.nodes[j]) - flat.aff(flat.nodes[j], flat.nodes[i]));
    n++;
  }
  assert.ok(diff / n > 0.05, `asymmetry ${(diff / n).toFixed(3)}`);
  assert.ok(diffFlat / n < diff / n, 'no individuality, less asymmetry');
});

test('shy option: off by default (no negative affinities); on gives some, and the world stays sound', () => {
  const off = makeWorld();
  for (const n of off.nodes) for (const a of n.traits.aff) assert.ok(a >= 0);
  const on = makeWorld({ params: { options: { shy: true, shyChance: 0.5 } } });
  assert.ok(on.nodes.some((n) => n.traits.aff.some((a) => a < 0)));
  for (let i = 0; i < 120 * 60; i++) {
    on.step();
    if (i % 60 === 0) checkInvariants(on);
  }
});

// ---- adding, removing, recipes ---------------------------------------------------

test('add and remove nodes at runtime', () => {
  const w = makeWorld();
  w.run(30);
  w.drainEvents();
  const before = w.nodes.length;
  const n = w.addNode({ name: 'New Club', type: 'venue' });
  const seen = w.drainEvents().map((e) => e.type);
  assert.equal(w.nodes.length, before + 1);
  assert.equal(n.alpha, 0);
  w.run(2);
  assert.equal(n.alpha, 1);
  w.run(60);
  checkInvariants(w);

  const victim = w.nodes.find((x) => x.links.length > 0 && x.type !== 'star');
  const partners = victim.links.map((l) => (l.a === victim ? l.b : l.a));
  assert.ok(w.forgetNode(victim.id));
  assert.equal(victim.links.length, 0);
  seen.push(...w.drainEvents().map((e) => e.type));
  for (const p of partners) assert.ok(!p.links.some((l) => l.a === victim || l.b === victim));
  checkInvariants(w);
  w.run(w.p.world.fadeOut + 0.5);
  assert.equal(w.get(victim.id), undefined);
  assert.ok(!w.nodes.includes(victim));
  w.run(60);
  checkInvariants(w);
  assert.ok(seen.includes('add') && seen.includes('remove'));
});

test('adding a node with a duplicate name gets a unique id', () => {
  const w = makeWorld();
  const a = w.addNode({ name: 'Mengi', type: 'venue' });
  assert.notEqual(a.id, 'mengi');
  assert.ok(w.get('mengi'));
});

test('star count follows the world.stars parameter live', () => {
  const w = makeWorld();
  const stars = () => w.nodes.filter((n) => n.type === 'star' && n.removingAt === null).length;
  assert.equal(stars(), 6);
  w.set('world.stars', 10);
  assert.equal(stars(), 10);
  w.set('world.stars', 2);
  assert.equal(stars(), 2);
  w.run(5);
  assert.equal(w.nodes.filter((n) => n.type === 'star').length, 2);
  checkInvariants(w);
});

test('parameters can be changed live without breaking invariants', () => {
  const w = makeWorld();
  w.run(20);
  w.setParams({ links: { capScale: 0.5, connect: 300 }, global: { speedScale: 2 } });
  w.setMacros({ promiscuity: 0.9, tension: 0.8 });
  for (let i = 0; i < 60 * 60; i++) {
    w.step();
    if (i % 60 === 0) checkInvariants(w);
  }
});

test('events are recorded and drained', () => {
  const w = makeWorld();
  w.run(60);
  const e = w.drainEvents();
  assert.ok(e.some((x) => x.type === 'link'));
  assert.equal(w.events.length, 0);
  for (const x of e) assert.ok(typeof x.t === 'number' && typeof x.a === 'string');
});

test('recipe: createWorld with time equals running by hand; export round-trips', () => {
  const recipe = { seed: 'poster-4417', time: 20, nodes: NODE_LIST, params: { links: { pull: 6 } } };
  const a = createWorld(recipe);
  const b = new World({ seed: 'poster-4417', nodes: NODE_LIST, params: { links: { pull: 6 } } });
  b.run(20);
  assert.equal(a.hash(), b.hash());
  const out = exportRecipe(a);
  assert.equal(out.seed, 'poster-4417');
  assert.equal(out.nodes.length, NODE_LIST.length);
  const c = createWorld({ ...out, time: 20 });
  assert.equal(c.hash(), a.hash());
});

test('recipe: invalid params are rejected', () => {
  assert.throws(() => createWorld({ params: { links: { connect: -5 } } }), /Invalid recipe params/);
  assert.throws(() => createWorld({ params: { bogus: { thing: 1 } } }), /unknown parameter/);
  assert.throws(() => createWorld({ params: { swing: { ropeLength: 260 } } }), /unknown parameter/);
});

test('unknown node types are rejected', () => {
  assert.throws(() => makeWorld({ nodes: [{ name: 'X', type: 'dragon' }] }), /Unknown node type/);
});
