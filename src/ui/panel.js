import { MACROS } from '../sim/macros.js';
import { splitSchema } from './essentials.js';
import { LOOK_SCHEMA } from './look.js';

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) e.append(kid);
  return e;
}

const decimals = (step) => { const s = String(step); return s.includes('.') ? s.split('.')[1].length : 0; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The dev panel is generated from the parameter schemas, so a new parameter needs no panel code.
export class Panel {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.controls = [];
    this.open = this._loadOpen();
    if (this.open.Essentials === undefined) this.open.Essentials = true;
    this._build();
  }

  _loadOpen() {
    try { return JSON.parse(localStorage.getItem('rvk.panel.open')) || { Run: true, Macros: true, Essentials: true }; } catch { return { Run: true, Macros: true, Essentials: true }; }
  }

  _saveOpen() {
    try { localStorage.setItem('rvk.panel.open', JSON.stringify(this.open)); } catch { /* storage unavailable */ }
  }

  get visible() { return !this.root.hidden; }
  show() { this.root.hidden = false; this.refresh(); }
  hide() { this.root.hidden = true; }
  toggle() { this.visible ? this.hide() : this.show(); }

  _section(title, body, extra = '') {
    const sec = el('section', { class: `grp ${extra}`.trim() });
    const head = el('button', { class: 'grp-head', type: 'button' }, title);
    const set = (open) => { sec.classList.toggle('open', open); this.open[title] = open; this._saveOpen(); };
    head.addEventListener('click', () => set(!sec.classList.contains('open')));
    sec.append(head, el('div', { class: 'grp-body' }, body));
    sec.classList.toggle('open', !!this.open[title]);
    return sec;
  }

  _build() {
    const { app } = this;
    this.root.textContent = '';
    const head = el('div', { class: 'head' },
      el('span', { class: 'title' }, 'RVK / DEV'),
      el('span', { class: 'spacer' }),
      el('button', { type: 'button', title: 'Switch the panel to a plain monospace face for legibility', onclick: () => this.root.classList.toggle('mono') }, 'FONT'),
      el('button', { type: 'button', title: 'Hide (backtick)', onclick: () => this.hide() }, 'X'));
    this.root.append(head);
    this.root.append(this._runSection(), this._macroSection());

    const { essentials, advanced } = splitSchema();
    const body = [];
    for (const sec of essentials) {
      body.push(el('div', { class: 'sub' }, sec.title.toUpperCase()));
      for (const e of sec.entries) body.push(this._row(e));
    }
    this.root.append(this._section('Essentials', body));
    // everything else sits in one collapsed group that holds the collapsed groups
    const groups = [...advanced].map(([title, entries]) => this._section(title, entries.map((e) => this._row(e)), 'nested'));
    this.root.append(this._section('Advanced', groups));
    this.refresh();
  }

  _runSection() {
    const { app } = this;
    const seed = el('input', { type: 'text', value: app.world.seed, spellcheck: 'false', class: 'seed' });
    const jump = el('input', { type: 'number', value: '120', min: '0', step: '10', class: 'num' });
    const nodeName = el('input', { type: 'text', placeholder: 'NAME', spellcheck: 'false', class: 'seed' });
    const nodeType = el('select', {}, ['venue', 'artist', 'genre', 'theme', 'event'].map((t) => el('option', { value: t }, t.toUpperCase())));
    const pasteBox = el('textarea', { rows: '6', spellcheck: 'false', placeholder: 'Paste a recipe JSON here', hidden: true });
    const status = el('div', { class: 'status' });
    this.status = status;
    this.seedInput = seed;
    const flash = (msg) => { status.textContent = msg; clearTimeout(this._flash); this._flash = setTimeout(() => { status.textContent = ''; }, 3500); };
    app.flash = flash;

    this.pauseBtn = el('button', { type: 'button', onclick: () => { app.togglePause(); this.refresh(); } }, 'PAUSE');
    let confirmReset = null;
    const resetBtn = el('button', { type: 'button', onclick: () => {
      if (!confirmReset) {
        resetBtn.textContent = 'SURE?';
        confirmReset = setTimeout(() => { resetBtn.textContent = 'RESET ALL'; confirmReset = null; }, 2500);
      } else { clearTimeout(confirmReset); confirmReset = null; resetBtn.textContent = 'RESET ALL'; app.resetAll(); }
    } }, 'RESET ALL');

    const body = [
      el('div', { class: 'line' }, el('label', {}, 'SEED'), seed,
        el('button', { type: 'button', onclick: () => app.applySeed(seed.value.trim() || 'rvk') }, 'APPLY'),
        el('button', { type: 'button', onclick: () => app.reroll() }, 'REROLL')),
      el('div', { class: 'line' }, this.pauseBtn,
        el('button', { type: 'button', onclick: () => app.stepOnce() }, 'STEP'),
        el('button', { type: 'button', title: 'Clear the event log', onclick: () => app.hud.clearLog() }, 'CLEAR LOG')),
      this._row({ ...LOOK_SCHEMA.find((e) => e.path === 'run.timeScale'), src: 'look' }),
      el('div', { class: 'line' }, el('label', {}, 'JUMP TO T (S)'), jump,
        el('button', { type: 'button', onclick: () => app.jumpTo(Number(jump.value) || 0) }, 'GO')),
      el('div', { class: 'line' }, el('label', {}, 'EXPORT PNG'),
        el('button', { type: 'button', onclick: () => app.exportPng(1) }, '1X'),
        el('button', { type: 'button', onclick: () => app.exportPng(2) }, '2X'),
        el('button', { type: 'button', onclick: () => app.exportPng(4) }, '4X')),
      this._row({ ...LOOK_SCHEMA.find((e) => e.path === 'look.labelRotate'), src: 'look' }), // turns labels and link notes 90° counter-clockwise: for portrait posters
      el('div', { class: 'line' }, el('label', {}, 'RECIPE'),
        el('button', { type: 'button', onclick: () => app.copyRecipe() }, 'COPY'),
        el('button', { type: 'button', onclick: () => { pasteBox.hidden = !pasteBox.hidden; } }, 'PASTE')),
      pasteBox,
      el('div', { class: 'line', hidden: true, 'data-paste-apply': true },
        el('button', { type: 'button', onclick: () => app.applyRecipeText(pasteBox.value) }, 'APPLY PASTED')),
      el('div', { class: 'line' }, el('label', {}, 'ADD NODE'), nodeName, nodeType,
        el('button', { type: 'button', onclick: () => { if (nodeName.value.trim()) { app.addNode(nodeName.value.trim(), nodeType.value); nodeName.value = ''; } } }, 'ADD')),
      el('div', { class: 'line' },
        el('button', { type: 'button', onclick: () => app.reloadNodes() }, 'RELOAD NODES.JSON'), resetBtn),
      el('div', { class: 'hint' }, 'With this panel open: SPACE pauses, . steps. Double-click a label to reset it. The backtick closes the panel.'),
      status,
    ];
    pasteBox.addEventListener('input', () => {
      const apply = this.root.querySelector('[data-paste-apply]');
      if (apply) apply.hidden = pasteBox.hidden || !pasteBox.value.trim();
    });
    pasteBox.addEventListener('focus', () => { const apply = this.root.querySelector('[data-paste-apply]'); if (apply) apply.hidden = false; });
    return this._section('Run', body);
  }

  _macroSection() {
    const rows = Object.entries(MACROS).map(([name, m]) => {
      const out = el('output', {}, '0.50');
      const input = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(this.app.macroValue(name)) });
      input.addEventListener('input', () => { out.textContent = Number(input.value).toFixed(2); this.app.setMacro(name, Number(input.value)); this.refresh(); });
      input.addEventListener('dblclick', () => { input.value = '0.5'; input.dispatchEvent(new Event('input')); });
      this.controls.push({ refresh: () => { input.value = String(this.app.macroValue(name)); out.textContent = Number(input.value).toFixed(2); } });
      return el('div', { class: 'row' }, el('label', { title: 'Moves several raw parameters together. 0.5 is neutral. Double-click to reset.' }, m.label.toUpperCase()), out, input);
    });
    return this._section('Macros', rows);
  }

  _row(e) {
    const { app } = this;
    const get = () => (e.src === 'sim' ? app.getSim(e.path) : app.getLook(e.path));
    const set = (v) => (e.src === 'sim' ? app.setSim(e.path, v) : app.setLook(e.path, v));
    const reset = () => (e.src === 'sim' ? app.resetSim(e.path) : app.resetLook(e.path));
    const label = el('label', { title: `${e.path}  (double-click to reset)` }, e.label.toUpperCase());
    label.addEventListener('dblclick', () => { reset(); this.refresh(); });
    const row = el('div', { class: 'row' });
    const dec = decimals(e.step);
    const fmt = (v) => Number(v).toFixed(dec);
    let update;

    if (e.kind === 'number') {
      const out = el('output', {});
      const input = el('input', { type: 'range', min: e.min, max: e.max, step: e.step });
      input.addEventListener('input', () => { set(Number(input.value)); update(); });
      row.append(label, out, input);
      update = () => { const v = get(); input.value = v; out.textContent = fmt(v); row.classList.toggle('changed', !same(v, e.default)); };
    } else if (e.kind === 'range') {
      const out = el('output', {});
      const lo = el('input', { type: 'range', min: e.min, max: e.max, step: e.step });
      const hi = el('input', { type: 'range', min: e.min, max: e.max, step: e.step });
      const push = () => { set([Number(lo.value), Number(hi.value)]); update(); };
      lo.addEventListener('input', () => { if (Number(lo.value) > Number(hi.value)) hi.value = lo.value; push(); });
      hi.addEventListener('input', () => { if (Number(hi.value) < Number(lo.value)) lo.value = hi.value; push(); });
      row.append(label, out, lo, hi);
      row.classList.add('pair');
      update = () => { const [a, b] = get(); lo.value = a; hi.value = b; out.textContent = `${fmt(a)} - ${fmt(b)}`; row.classList.toggle('changed', !same([a, b], e.default)); };
    } else if (e.kind === 'bool') {
      const btn = el('button', { type: 'button', class: 'toggle' });
      btn.addEventListener('click', () => { set(!get()); update(); });
      row.append(label, btn);
      row.classList.add('inline');
      update = () => { const v = !!get(); btn.textContent = v ? 'ON' : 'OFF'; btn.classList.toggle('on', v); row.classList.toggle('changed', v !== e.default); };
    } else {
      const sel = el('select', {}, e.options.map((o) => el('option', { value: o }, o.toUpperCase())));
      sel.addEventListener('change', () => { set(sel.value); update(); });
      row.append(label, sel);
      row.classList.add('inline');
      update = () => { sel.value = get(); row.classList.toggle('changed', get() !== e.default); };
    }
    this.controls.push({ refresh: update });
    return row;
  }

  refresh() {
    for (const c of this.controls) c.refresh();
    if (this.pauseBtn) this.pauseBtn.textContent = this.app.paused ? 'PLAY' : 'PAUSE';
    if (this.seedInput && document.activeElement !== this.seedInput) this.seedInput.value = this.app.world.seed;
  }
}
