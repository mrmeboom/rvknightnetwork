import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSkyNoise, skyTone, makeStars, twinkle, starStyle } from '../src/render/skymath.js';
import { TrailClock } from '../src/render/trailclock.js';
import { tagLines, nodeLabel } from '../src/ui/tagtext.js';
import { LOOK_DEFAULTS } from '../src/ui/look.js';
import { makeWorld } from './helpers.js';

const sky = LOOK_DEFAULTS.sky;
const base = 4 / 255;

test('sky: tone stays in range, is deterministic per seed, and differs between seeds', () => {
  const a = makeSkyNoise('s'), b = makeSkyNoise('s'), c = makeSkyNoise('t');
  let min = 1, max = 0, differs = false;
  for (let i = 0; i < 2000; i++) {
    const x = (i * 37) % 1900, y = (i * 91) % 1000, t = i * 0.3;
    const v = skyTone(a, x, y, t, sky, base);
    assert.equal(v, skyTone(b, x, y, t, sky, base));
    if (v !== skyTone(c, x, y, t, sky, base)) differs = true;
    min = Math.min(min, v); max = Math.max(max, v);
  }
  assert.ok(differs);
  assert.ok(min >= base - 1e-9 && max <= base + sky.patches + 1e-9, `range ${min} .. ${max}`);
  assert.ok(max - min > sky.patches * 0.5, 'patches actually vary');
});

test('sky: patches are large and evolve slowly and smoothly over time', () => {
  const n = makeSkyNoise('s');
  const at = (x, t) => skyTone(n, x, 500, t, sky, base);
  assert.ok(Math.abs(at(500, 0) - at(520, 0)) < sky.patches * 0.1, 'neighbouring pixels are alike');
  let jump = 0;
  for (let t = 0; t < 120; t += 0.05) jump = Math.max(jump, Math.abs(at(700, t + 0.05) - at(700, t)));
  assert.ok(jump < sky.patches * 0.02, `biggest step in 0.05 s is ${jump}`);
  let changed = 0;
  for (let t = 0; t < 200; t += 1) changed = Math.max(changed, Math.abs(at(700, t) - at(700, 0)));
  assert.ok(changed > sky.patches * 0.2, 'and over a few minutes it really changes');
});

test('sky: with patches at 0 the sky is a flat base tone', () => {
  const n = makeSkyNoise('s');
  for (let i = 0; i < 50; i++) assert.equal(skyTone(n, i * 40, i * 20, i, { ...sky, patches: 0 }, base), base);
});

test('stars: reproducible, in the unit square, mostly faint, and the first n stay put as the count grows', () => {
  const a = makeStars('s', 300), b = makeStars('s', 300), more = makeStars('s', 500);
  assert.deepEqual(a, b);
  assert.deepEqual(more.slice(0, 300), a);
  for (const s of a) assert.ok(s.x >= 0 && s.x < 1 && s.y >= 0 && s.y < 1);
  assert.ok(a.filter((s) => s.mag < 0.25).length > a.length * 0.55, 'many faint stars, few bright');
  assert.notDeepEqual(makeStars('other', 300), a);
});

test('stars: twinkle stays in range, depth 0 means steady, and they stay dimmer than any node', () => {
  const s = makeStars('s', 50);
  for (const star of s) {
    let lo = 1, hi = 0;
    for (let t = 0; t < 120; t += 0.1) {
      const f = twinkle(star, t, 0.6, 0.6);
      lo = Math.min(lo, f); hi = Math.max(hi, f);
      assert.equal(twinkle(star, t, 0, 0.6), 1);
    }
    assert.ok(lo >= 0.3 && hi <= 1 && hi - lo > 0.1, `${lo}..${hi}`);
    const st = starStyle(star, sky);
    assert.ok(st.alpha <= sky.starBright && st.radius < 2.5);
  }
});

test('trail clock: slices fill in order, fade by age, and expire in the order they were drawn', () => {
  const c = new TrailClock(4);
  const dur = 40; // 10 s per slice
  const seq = [];
  for (let t = 0; t <= 100; t += 1) {
    const { index, fresh } = c.advance(t, dur);
    if (fresh) seq.push([t, index]);
  }
  assert.deepEqual(seq.slice(0, 6), [[0, 0], [10, 1], [20, 2], [30, 3], [40, 0], [50, 1]]);
  // at t=100: slice index 2 is the current one (started at 100? no: 100 starts a new one) and ages run oldest-first
  const a = c.alphas(100, dur);
  const live = c.cur;
  assert.ok(a[live] > 0.95);
  const order = [1, 2, 3].map((k) => (live + k) % 4); // oldest ... newest before the current slice
  assert.ok(a[order[0]] <= a[order[1]] && a[order[1]] <= a[order[2]], `oldest fades first: ${a}`);
  assert.ok(a[order[0]] < a[live]);
});

test('trail clock: nothing survives longer than the duration, and an unused clock is dark', () => {
  const c = new TrailClock(6);
  assert.deepEqual(c.alphas(5, 30), [0, 0, 0, 0, 0, 0]);
  c.advance(0, 30);
  c.advance(10, 30);
  assert.ok(c.alphas(10, 30).every((v) => v >= 0));
  assert.ok(c.alphas(50, 30).every((v) => v === 0), 'everything has faded one full duration after it was drawn');
  c.reset();
  assert.deepEqual(c.alphas(0, 30), [0, 0, 0, 0, 0, 0]);
});

test('hover tag: category, location, speed to three decimals, then a CONNECTIONS heading and numbered links', () => {
  const w = makeWorld();
  w.run(90);
  const n = w.nodes.find((x) => x.links.length >= 2 && x.type !== 'star');
  const lines = tagLines(n);
  assert.equal(lines[0], n.type.toUpperCase());
  assert.ok(!/\d\/\d/.test(lines[0]), 'no links count in the category line');
  assert.match(lines[1], /^X -?\d+  Y -?\d+  Z -?\d+$/);
  assert.match(lines[2], /^SPEED \d+\.\d{3}$/);
  assert.equal(lines[3], 'CONNECTIONS');
  assert.equal(lines.length, 4 + n.links.length);
  lines.slice(4).forEach((ln, i) => assert.match(ln, new RegExp(`^${String(i + 1).padStart(3, '0')}\\..+`)));
  assert.ok(!lines.some((ln) => /OLDEST/.test(ln)));
  const star = w.nodes.find((x) => x.type === 'star');
  assert.equal(nodeLabel(star), 'VISITOR');
  assert.ok(!tagLines(star).some((l) => /STAR|CROWD/.test(l)), 'the word star never appears');
  assert.match(tagLines(star)[0], /^X /, 'a visitor has no separate category line');
  const lonely = { type: 'venue', x: 1, y: 2, z: 3, vx: 0, vy: 0, vz: 0, links: [] };
  assert.deepEqual(tagLines(lonely).slice(3), ['NO CONNECTIONS']);
});

// ---- hover tag layout, against a stand-in drawing surface ----------------------------

import { Hud } from '../src/ui/hud.js';
import { resolveLook } from '../src/ui/look.js';

function fakeCtx() {
  const calls = [];
  return {
    calls, font: '', fillStyle: '', strokeStyle: '', globalAlpha: 1, textAlign: 'left',
    save() {}, restore() {}, setTransform() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    measureText: (t) => ({ width: String(t).length * 7 }),
    fillText(text, x, y) { calls.push({ text, x, y, alpha: this.globalAlpha, font: this.font }); },
  };
}

function nodeWithLinks() {
  const w = makeWorld();
  w.run(90);
  const n = w.nodes.find((x) => x.links.length >= 2 && x.type !== 'star');
  n.r = { sx: 500, sy: 300, rad: 7, nn: 0.2, sharp: 1, bright: 1 };
  return { w, n };
}

test('hover tag: the title leads a left-aligned list underneath it, with no extra header or HELD line', () => {
  const { w, n } = nodeWithLinks();
  const look = resolveLook({});
  const ctx = fakeCtx();
  new Hud()._tag(ctx, n, look, look.hud.size, look.hud.size * 1.55, 1440, 860, look.hud.alpha);
  const [title, ...rest] = ctx.calls;
  assert.equal(title.text, n.name.toUpperCase());
  assert.ok(rest.every((c) => c.x === title.x), 'everything is left-aligned with the title');
  assert.ok(rest.every((c, i) => i === 0 ? c.y > title.y : c.y > rest[i - 1].y), 'listed top to bottom');
  assert.deepEqual(rest.map((c) => c.text), tagLines(n));
  assert.ok(title.alpha > rest[0].alpha, 'the title is a little brighter than the list');
  assert.ok(!ctx.calls.some((c) => /HELD/.test(c.text)));
  assert.ok(title.x > n.r.sx + n.r.rad + 7, 'the title sits clear of the selection ring');
});

test('hover tag: stays on screen near the edges, and its box becomes the hover area', () => {
  const { n } = nodeWithLinks();
  const look = resolveLook({});
  n.r.sx = 1420; n.r.sy = 850;
  const ctx = fakeCtx();
  new Hud()._tag(ctx, n, look, look.hud.size, look.hud.size * 1.55, 1440, 860, look.hud.alpha);
  for (const c of ctx.calls) assert.ok(c.x >= 0 && c.y > 0 && c.y < 860, `${c.text} at ${c.x},${c.y}`);
  const b = n.r.label;
  assert.ok(b.x + b.w <= 1440 && b.y + b.h <= 860, 'box fits');
});

// ---- panel organisation ------------------------------------------------------------

import { splitSchema, ESSENTIALS } from '../src/ui/essentials.js';
import { readFileSync } from 'node:fs';
import { controlled, ctlNode } from './helpers.js';
import { SCHEMA } from '../src/sim/params.js';
import { LOOK_SCHEMA } from '../src/ui/look.js';

test('panel: every parameter appears exactly once, either in Essentials or in an Advanced group', () => {
  const { essentials, advanced } = splitSchema();
  const shown = [...essentials.flatMap((s) => s.entries), ...[...advanced.values()].flat()].map((e) => e.path);
  assert.equal(new Set(shown).size, shown.length, 'no parameter listed twice');
  const expected = [...SCHEMA, ...LOOK_SCHEMA].map((e) => e.path).filter((p) => p !== 'run.timeScale' && p !== 'look.labelRotate'); // these two sit in the Run section
  assert.deepEqual([...shown].sort(), [...expected].sort(), 'nothing is lost');
});

test('panel: Essentials is a short list, and the rest is much longer', () => {
  const { essentials, advanced } = splitSchema();
  const n = essentials.reduce((s, x) => s + x.entries.length, 0);
  assert.ok(n >= 15 && n <= 30, `${n} essentials`);
  assert.ok([...advanced.values()].flat().length > 3 * n);
  assert.equal(ESSENTIALS.flatMap((s) => s.paths).length, n);
});

test('corner titles: the title top left and the mark top right, set like the ledger, and switchable', () => {
  const w = makeWorld();
  const look = resolveLook({});
  const R = { vw: 1440, vh: 860, dpr: 1 };
  const draw = (lk) => { const ctx = fakeCtx(); new Hud().draw(ctx, R, w, lk, { paused: false }); return ctx.calls; };
  const calls = draw(look);
  const left = calls.find((c) => c.text === 'RVK NIGHT NETWORK.CONSTELLATIONS');
  const right = calls.find((c) => c.text === 'MRTY.26');
  assert.ok(left && right, 'both titles are drawn');
  assert.ok(left.x < 40 && left.y < 40, 'top left');
  assert.ok(right.x > 1440 - 40 && right.y === left.y, 'top right, on the same line');
  const ledger = calls.find((c) => c.text.startsWith('SEED'));
  assert.equal(left.font, ledger.font, 'same type size as the corner ledger');
  assert.ok(!draw(resolveLook({ hud: { titles: false } })).some((c) => c.text === 'MRTY.26'), 'can be turned off');
});

// ---- turned labels (for portrait posters) -----------------------------------------------

import { labelTransform, labelStart } from '../src/render/labelgeom.js';

test('labels: by default they sit right of the mark; turned, they sit above it and read upward', () => {
  const sx = 300, sy = 200, rad = 7, size = 11, gap = 14;
  const flat = labelTransform(false, sx, sy, rad, size, gap);
  assert.equal(flat.rot, 0);
  const f = labelStart(flat);
  assert.ok(Math.abs(f.x - (sx + rad + gap)) < 1e-9 && Math.abs(f.y - (sy + size * 0.35)) < 1e-9, 'unchanged from before');

  const turned = labelTransform(true, sx, sy, rad, size, gap);
  assert.ok(Math.abs(turned.rot + Math.PI / 2) < 1e-12, '90 degrees counter-clockwise (negative on a canvas)');
  assert.equal(turned.originX, sx); assert.equal(turned.originY, sy, 'around the centre of the node');
  const t = labelStart(turned);
  assert.ok(Math.abs(t.x - (sx + size * 0.35)) < 1e-9, 'directly above the node (a hair of offset keeps the text centred on it)');
  assert.ok(Math.abs(t.y - (sy - (rad + gap))) < 1e-9, 'the same distance from the centre as before, now upward');
  // the reading direction is up the screen
  const dir = { x: Math.cos(turned.rot), y: Math.sin(turned.rot) };
  assert.ok(Math.abs(dir.x) < 1e-12 && Math.abs(dir.y + 1) < 1e-12);
});

test('labels: the turn is one switch called Turn 90°, off by default, shown in the Run section and nowhere else', () => {
  assert.equal(LOOK_DEFAULTS.look.labelRotate, false);
  assert.equal(LOOK_SCHEMA.find((e) => e.path === 'look.labelRotate').label, 'Turn 90°');
  const { essentials, advanced } = splitSchema();
  const listed = [...essentials.flatMap((s) => s.entries), ...[...advanced.values()].flat()].map((e) => e.path);
  assert.ok(!listed.includes('look.labelRotate'), 'not repeated in Essentials or Advanced');
  const panel = readFileSync(new URL('../src/ui/panel.js', import.meta.url), 'utf8');
  const run = panel.slice(panel.indexOf('  _runSection() {'), panel.indexOf('  _macroSection() {'));
  assert.ok(run.indexOf("app.exportPng(4)") < run.indexOf("'look.labelRotate'"), 'directly after the export buttons');
});

test('link annotations turn with the labels, around the middle of their link', () => {
  const w = controlled([ctlNode('A', 'artist', 500, 500), ctlNode('B', 'artist', 600, 500)]);
  w.step();
  assert.equal(w.links.length, 1);
  for (const n of w.nodes) n.r = { sx: n.x, sy: n.y, sharp: 1, rad: 3, nn: 0, bright: 1 };
  const draw = (rotate) => {
    const calls = [];
    const ctx = { ...fakeCtx(), save() { calls.push(['save']); }, restore() { calls.push(['restore']); }, translate(x, y) { calls.push(['translate', x, y]); }, rotate(a) { calls.push(['rotate', a]); }, fillText(text, x, y) { calls.push(['fillText', text, x, y]); } };
    const look = resolveLook({ hud: { linkNotes: true, titles: false, ledger: false, log: false, tags: false }, look: { labelRotate: rotate } });
    new Hud().draw(ctx, { vw: 1000, vh: 800, dpr: 1 }, w, look, { paused: false });
    return calls;
  };
  const flat = draw(false), turned = draw(true);
  const mid = (w.nodes[0].x + w.nodes[1].x) / 2;
  assert.ok(flat.some((c) => c[0] === 'fillText' && /^\d+S$/.test(c[1]) && Math.abs(c[2] - mid) < 1e-9), 'unturned: drawn at the middle of the link');
  assert.ok(!flat.some((c) => c[0] === 'rotate'));
  const i = turned.findIndex((c) => c[0] === 'rotate');
  assert.ok(i > 0 && Math.abs(turned[i][1] + Math.PI / 2) < 1e-12, 'turned: 90° counter-clockwise');
  const tr = turned.slice(0, i).reverse().find((c) => c[0] === 'translate');
  assert.ok(Math.abs(tr[1] - mid) < 1e-9, 'around the middle of the link');
  assert.ok(turned.slice(i).some((c) => c[0] === 'fillText' && /^\d+S$/.test(c[1]) && c[2] === 0));
});

// ---- export layers ----------------------------------------------------------------

import { EXPORT_LAYERS, defaultExportLayers, sanitizeExportLayers, anyExportLayer, paintStill } from '../src/render/layers.js';
import { Renderer } from '../src/render/canvas2d.js';

// A drawing surface that accepts anything and writes down the method calls.
function recordingCtx(w = 200, h = 100) {
  const calls = [];
  const store = { canvas: { width: w, height: h }, globalAlpha: 1 };
  const proxy = new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return (s) => ({ width: String(s).length * 7 });
      return (...a) => { calls.push(String(k)); return proxy; };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { ctx: proxy, calls };
}

test('export layers: sky, trails, nodes, grain and HUD, all on by default, in that order', () => {
  assert.deepEqual(EXPORT_LAYERS.map((l) => l.key), ['sky', 'trails', 'nodes', 'grain', 'hud']);
  assert.deepEqual(EXPORT_LAYERS.map((l) => l.label), ['SKY', 'TRAILS', 'NODES', 'GRAIN', 'HUD']);
  assert.ok(Object.values(defaultExportLayers()).every((v) => v === true));
});

test('export layers: saved values are cleaned, and only a plain false turns a layer off', () => {
  assert.deepEqual(sanitizeExportLayers(null), defaultExportLayers());
  assert.deepEqual(sanitizeExportLayers({ hud: false, grain: 0, nope: false, sky: 'no' }), { ...defaultExportLayers(), hud: false });
  assert.equal(anyExportLayer(defaultExportLayers()), true);
  assert.equal(anyExportLayer({ sky: false, trails: false, nodes: false, grain: false, hud: false }), false);
});

test('export layers: each layer is painted when on and skipped when off, bottom to top', () => {
  const order = [];
  const deps = (over = {}) => ({
    sky: { draw() { order.push('sky'); } },
    trails: { composite() { order.push('trails'); } },
    renderer: { drawScene(c, w, l, o) { order.push(`scene:${o.nodes ? 'nodes' : 'bare'}:${o.clear === false ? 'keep' : 'clear'}`); if (o.underlay) o.underlay(c); } },
    hud: { draw() { order.push('hud'); } },
    world: { t: 5 }, look: { look: { grain: 0.1, grainSize: 1 } }, grainTile: { width: 1 }, grainOffset: [0, 0],
    state: {}, vw: 200, vh: 100, scale: 1, ...over,
  });
  const run = (layers) => { order.length = 0; paintStill(recordingCtx().ctx, deps(), { ...defaultExportLayers(), ...layers }); return [...order]; };
  assert.deepEqual(run({}), ['sky', 'scene:nodes:keep', 'trails', 'hud']);
  assert.deepEqual(run({ sky: false }), ['scene:nodes:keep', 'trails', 'hud'], 'no sky: nothing painted underneath');
  assert.deepEqual(run({ trails: false }), ['sky', 'scene:nodes:keep', 'hud']);
  assert.deepEqual(run({ nodes: false }), ['sky', 'scene:bare:keep', 'trails', 'hud'], 'trails and HUD can stand without the nodes');
  assert.deepEqual(run({ hud: false }), ['sky', 'scene:nodes:keep', 'trails']);
  assert.deepEqual(run({ sky: false, trails: false, nodes: false, grain: false }), ['scene:bare:keep', 'hud'], 'any combination works');
});

test('export layers: grain is painted over the nodes and under the HUD, only when on', () => {
  const { ctx, calls } = recordingCtx();
  const stub = (name) => ({ draw() { calls.push(name); }, drawScene() { calls.push(name); }, composite() {} });
  const d = { sky: stub('sky'), trails: stub('trails'), renderer: stub('scene'), hud: stub('hud'), world: { t: 0 }, look: { look: { grain: 0.5, grainSize: 1 } }, grainTile: { width: 4 }, grainOffset: [0, 0], state: {}, vw: 200, vh: 100, scale: 1 };
  paintStill(ctx, d, defaultExportLayers());
  assert.ok(calls.indexOf('scene') < calls.indexOf('drawImage') && calls.indexOf('drawImage') < calls.indexOf('hud'), 'scene, then grain tiles, then HUD');
  calls.length = 0;
  paintStill(ctx, d, { ...defaultExportLayers(), grain: false });
  assert.ok(!calls.includes('drawImage'), 'no grain tiles');
});

test('export: the real scene draw keeps the sky underneath, and can leave the nodes out', () => {
  const w = makeWorld(); w.run(30);
  const look = resolveLook({});
  const r = new Renderer(); r.resize(200, 100, 1);
  const draw = (opts) => { const { ctx, calls } = recordingCtx(); r.drawScene(ctx, w, look, opts); return calls; };
  assert.ok(draw({}).includes('clearRect'), 'live page: the transparent scene canvas is cleared each frame');
  assert.ok(!draw({ clear: false }).includes('clearRect'), 'a still keeps the sky it already painted');
  const withNodes = draw({ clear: false }), without = draw({ clear: false, nodes: false });
  assert.ok(withNodes.length > without.length && !without.includes('stroke') && !without.includes('fill'), 'nothing of the links or marks without the nodes');
  assert.ok(w.nodes.every((n) => n.r && Number.isFinite(n.r.sx)), 'the projection is still prepared, so the HUD can place its tags');
});

test('export layers: the buttons sit right under EXPORT PNG, and the export is not blocked by them being remembered', () => {
  const panel = readFileSync(new URL('../src/ui/panel.js', import.meta.url), 'utf8');
  const run = panel.slice(panel.indexOf('  _runSection() {'), panel.indexOf('  _macroSection() {'));
  assert.ok(run.indexOf('app.exportPng(4)') < run.indexOf('this._layerButtons()') && run.indexOf('this._layerButtons()') < run.indexOf("'look.labelRotate'"));
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /anyExportLayer\(layers\)/, 'an export with every layer off says so instead of saving an empty file');
});
