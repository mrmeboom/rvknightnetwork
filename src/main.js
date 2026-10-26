import { createWorld, exportRecipe, normalizeRecipe } from './recipe.js';
import { Renderer } from './render/canvas2d.js';
import { makeGrainTile, paintGrain } from './render/grain.js';
import { Sky } from './render/sky.js';
import { TrailLayer } from './render/trails.js';
import { Hud } from './ui/hud.js';
import { Input } from './ui/input.js';
import { Panel } from './ui/panel.js';
import { resolveLook } from './ui/look.js';
import { MACROS } from './sim/macros.js';
import { randomSeed } from './seed.js';
import { getPath, setPath, clampToSchema, sanitizeParams } from './sim/params.js';

const STORE_KEY = 'rvk.state.v1';
// A few simulated seconds is enough: links form the moment nodes are in range, so the network is there from the
// first step, and the log is cleared so the opening burst of links does not flood it. (30 s cost ~0.9 s of boot.)
const WARMUP = 3;
const $ = (id) => document.getElementById(id);

const skyCanvas = $('sky'), sceneCanvas = $('scene'), overlayCanvas = $('overlay'), grainEl = $('grain'), panelEl = $('panel');
const skyCtx = skyCanvas.getContext('2d');
const sceneCtx = sceneCanvas.getContext('2d');
const overlayCtx = overlayCanvas.getContext('2d');
const grainTile = makeGrainTile(192, 'rvk-grain');
grainEl.style.backgroundImage = `url(${grainTile.toDataURL()})`;
grainEl.style.imageRendering = 'pixelated';

const app = {
  world: null,
  renderer: new Renderer(),
  sky: null,
  trails: new TrailLayer(),
  hud: new Hud(),
  look: resolveLook({}),
  lookOverrides: {},
  nodeList: [],
  paused: false,
  stepReq: false,
  accum: 0,
  grainOffset: [0, 0],
  flash: () => {},

  // ---- values and edits used by the panel ------------------------------
  getSim(path) { return getPath(this.world.p, path); },
  setSim(path, v) { this.world.set(path, clampToSchema(path, v)); this.save(); },
  resetSim(path) { this.world.clearParam(path); this.save(); },
  getLook(path) { return getPath(this.look, path); },
  setLook(path, v) {
    setPath(this.lookOverrides, path, v);
    this.look = resolveLook(this.lookOverrides);
    this.applyLook();
    this.save();
  },
  resetLook(path) {
    const keys = path.split('.');
    let o = this.lookOverrides;
    for (const k of keys.slice(0, -1)) { if (!o[k]) return; o = o[k]; }
    delete o[keys[keys.length - 1]];
    this.look = resolveLook(this.lookOverrides);
    this.applyLook();
    this.save();
  },
  macroValue(name) { return this.world.macros[name] ?? 0.5; },
  setMacro(name, v) {
    for (const path of Object.keys(MACROS[name].mul)) this.world.clearParam(path);
    this.world.setMacros({ [name]: v });
    this.save();
  },

  // ---- run controls ----------------------------------------------------
  togglePause() { this.paused = !this.paused; },
  stepOnce() { this.paused = true; this.stepReq = true; panel.refresh(); },
  applySeed(seed) { const r = this.recipe(); r.seed = seed; r.time = WARMUP; this.build(r); },
  reroll() { this.applySeed(randomSeed()); },
  jumpTo(t) { const r = this.recipe(); r.time = t; this.build(r); this.flash(`JUMPED TO ${t}S (LIVE EDITS ARE NOT REPLAYED)`); },
  addNode(name, type) { this.world.addNode({ name, type }); this.save(); },
  async reloadNodes() {
    await this.loadNodeList();
    const r = this.recipe();
    r.nodes = this.nodeList;
    this.build(r);
    this.flash(`LOADED ${this.nodeList.length} NODES`);
  },
  resetAll() {
    try { localStorage.removeItem(STORE_KEY); } catch { /* storage unavailable */ }
    this.lookOverrides = {};
    this.look = resolveLook({});
    this.applyLook();
    this.build({ seed: randomSeed(), time: WARMUP, nodes: this.nodeList });
    this.flash('BACK TO DEFAULTS');
  },

  // ---- recipes ---------------------------------------------------------
  // Settings only: the node list is left out while it is the same as nodes.json, and defaults are not repeated.
  recipe(full = false) {
    const r = { ...exportRecipe(this.world), look: JSON.parse(JSON.stringify(this.lookOverrides)) };
    const same = r.nodes.length === this.nodeList.length && r.nodes.every((n, i) => n.name === this.nodeList[i].name && n.type === this.nodeList[i].type);
    if (same && !full) delete r.nodes;
    if (!full) { delete r.version; if (r.dt === 1 / 60) delete r.dt; if (!Object.keys(r.macros).length) delete r.macros; if (!Object.keys(r.look).length) delete r.look; if (!Object.keys(r.params).length) delete r.params; }
    return r;
  },
  async copyRecipe() {
    const text = JSON.stringify(this.recipe(), null, 2);
    try { await navigator.clipboard.writeText(text); this.flash('RECIPE COPIED'); }
    catch { this.flash('CLIPBOARD BLOCKED: OPENED IN CONSOLE'); console.log(text); }
  },
  applyRecipeText(text) {
    try {
      const { recipe, dropped } = cleanRecipe(JSON.parse(text));
      this.build(recipe);
      this.flash(dropped.length ? `RECIPE APPLIED, ${dropped.length} OLD PARAMETER(S) DROPPED` : 'RECIPE APPLIED');
    } catch (err) { this.flash(`BAD RECIPE: ${String(err.message).split('\n')[0]}`); }
  },

  build(recipe) {
    const r = normalizeRecipe(recipe);
    if (r.look) { this.lookOverrides = r.look; this.look = resolveLook(r.look); this.applyLook(); }
    const nodes = r.nodes && r.nodes.length ? r.nodes : this.nodeList;
    const world = createWorld({ ...r, nodes });
    this.world = world;
    this.accum = 0;
    this.hud.clearLog();
    this.renderer.ghosts = [];
    this.trails.clear();
    if (this.sky) this.sky.setSeed(world.seed); else this.sky = new Sky(world.seed);
    world.drainEvents();
    if (typeof input !== 'undefined') input.validate();
    if (typeof panel !== 'undefined') panel.refresh();
    this.save();
  },

  save() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ recipe: { ...exportRecipe(this.world), time: 0 }, look: this.lookOverrides, nodeSig: this.nodeSig })); }
      catch { /* storage unavailable */ }
    }, 400);
  },

  async loadNodeList() {
    const res = await fetch('nodes.json');
    if (!res.ok) throw new Error(`nodes.json: HTTP ${res.status}`);
    this.nodeList = (await res.json()).nodes.map(({ name, type }) => ({ name, type }));
    this.nodeSig = this.nodeList.map((n) => `${n.type}:${n.name}`).join('|');
  },

  applyLook() {
    const L = this.look.look;
    grainEl.style.opacity = this.revealed ? String(L.grain) : '0'; // stays off until the first frame, so no raw noise shows while loading
    grainEl.style.backgroundSize = `${grainTile.width * L.grainSize}px`;
    document.body.style.background = '#000';
  },

  // ---- stills ----------------------------------------------------------
  exportPng(scale) {
    const { renderer, world, look } = this;
    const maxSide = 16000;
    const s = Math.max(1, Math.min(scale, Math.floor(maxSide / Math.max(renderer.vw, renderer.vh))));
    const state = { paused: this.paused, hoverId: input.hoverId, heldId: input.heldId };
    const r2 = new Renderer();
    r2.resize(renderer.vw, renderer.vh, s);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(renderer.vw * s); canvas.height = Math.round(renderer.vh * s);
    const c = canvas.getContext('2d');
    this.sky.draw(c, renderer.vw, renderer.vh, s, world.t, look);
    r2.drawScene(c, world, look, { hoverId: state.hoverId, heldId: state.heldId, underlay: (ctx) => this.trails.composite(ctx, world, look, s) });
    paintGrain(c, grainTile, canvas.width, canvas.height, look.look.grain, look.look.grainSize * s, ...this.grainOffset.map((v) => v * s));
    this.hud.draw(c, r2, world, look, state);
    renderer.prepare(world, look);
    canvas.toBlob((blob) => {
      if (!blob) { this.flash('EXPORT FAILED (IMAGE TOO LARGE?)'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `rvk-${world.seed}-t${Math.round(world.t)}-${s}x.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      this.flash(`SAVED ${canvas.width}x${canvas.height}`);
    }, 'image/png');
  },
};

// ---- boot ---------------------------------------------------------------
let panel, input;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vw = Math.max(1, window.innerWidth), vh = Math.max(1, window.innerHeight);
  for (const c of [skyCanvas, sceneCanvas, overlayCanvas]) { c.width = Math.round(vw * dpr); c.height = Math.round(vh * dpr); }
  app.renderer.resize(vw, vh, dpr);
  app.trails.resize(vw, vh, dpr);
}

// Recipes saved under an older parameter set lose the parameters that no longer exist instead of failing.
function cleanRecipe(recipe) {
  const { params, dropped } = sanitizeParams(recipe.params);
  return { recipe: { ...recipe, params }, dropped };
}

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; }
}

async function boot() {
  performance.mark('rvk-boot-start');
  await Promise.all([document.fonts.load('11px "Bungee Hairline"', 'ÞÐþðÁ'), app.loadNodeList()]);
  resize();
  window.addEventListener('resize', resize);

  const url = new URLSearchParams(location.search);
  const saved = url.has('fresh') ? null : loadSaved();
  // settings come back from the saved state, but the seed is new on every load (unless the address names one)
  let recipe = saved ? { ...cleanRecipe(saved.recipe).recipe, look: saved.look, time: WARMUP } : { time: WARMUP, nodes: app.nodeList };
  recipe.seed = url.get('seed') || randomSeed();
  // nodes.json was edited since this state was saved: use the file's list (nodes added in the panel are not kept)
  const nodesChanged = saved && saved.nodeSig !== app.nodeSig;
  if (nodesChanged) recipe.nodes = app.nodeList;
  try { app.build(recipe); }
  catch (err) { console.warn('Saved state could not be loaded, starting fresh:', err); app.build({ seed: randomSeed(), time: WARMUP, nodes: app.nodeList }); }
  app.applyLook();

  input = new Input(overlayCanvas, app);
  panel = new Panel(panelEl, app);
  app.panel = panel;
  if (nodesChanged) app.flash(`NODES.JSON CHANGED: LOADED ${app.nodeList.length} NODES`);
  panelEl.addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') e.target.blur(); });
  if (url.has('dev')) panel.show();

  // Shortcuts only work while the dev panel is open (so a visitor reading or typing elsewhere on a page is never
  // interrupted, and Space still scrolls). The backtick opens and closes the panel.
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Backquote') { panel.toggle(); e.preventDefault(); return; }
    if (!panel.visible) return;
    if (e.code === 'Space') { app.togglePause(); panel.refresh(); e.preventDefault(); }
    else if (e.key === '.') app.stepOnce();
  });

  window.rvk = app; // for inspection from the console and headless checks
  let last = performance.now(), lastGrain = last, lastSky = -Infinity, lastError = -Infinity;
  const step = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const w = app.world;
    if (!app.paused) {
      app.accum += dt * app.look.run.timeScale;
      let k = 0;
      while (app.accum >= w.dt && k < 24) { w.step(); app.accum -= w.dt; k++; }
      if (k >= 24) app.accum = 0;
    } else if (app.stepReq) { w.step(); app.stepReq = false; }

    const events = w.drainEvents();
    app.renderer.onEvents(events, w, app.look);
    app.hud.onEvents(events, w);
    input.validate();

    const L = app.look.look;
    if (now - lastGrain > 1000 / L.grainFps) {
      lastGrain = now;
      const step = grainTile.width * L.grainSize;
      app.grainOffset = [Math.floor(Math.random() * grainTile.width) * L.grainSize, Math.floor(Math.random() * grainTile.width) * L.grainSize];
      grainEl.style.backgroundPosition = `${-app.grainOffset[0] % step}px ${-app.grainOffset[1] % step}px`;
    }

    const R = app.renderer;
    if (now - lastSky > 50) { lastSky = now; app.sky.updateField(R.vw, R.vh, w.t, app.look); }
    app.sky.draw(skyCtx, R.vw, R.vh, R.dpr, w.t, app.look);
    R.drawScene(sceneCtx, w, app.look, {
      hoverId: input.hoverId, heldId: input.heldId,
      underlay: (ctx) => app.trails.composite(ctx, w, app.look, R.dpr),
    });
    if (!app.paused) app.trails.record(w, R, app.look);
    overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    app.hud.draw(overlayCtx, app.renderer, w, app.look, { paused: app.paused, hoverId: input.hoverId, heldId: input.heldId });
    app.frames = (app.frames || 0) + 1;
    if (!app.revealed) { app.revealed = true; app.applyLook(); performance.mark('rvk-first-frame'); }
  };
  const frame = (now) => {
    try { step(now); }
    catch (err) { if (now - lastError > 2000) { lastError = now; console.error(err); } }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  const f = $('fatal');
  f.textContent = `Could not start: ${err.message}`;
  f.hidden = false;
});
