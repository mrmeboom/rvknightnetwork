import { TYPES } from '../sim/params.js';
import { FONT_FAMILY, LABEL_GAP } from '../render/canvas2d.js';
import { nodeLabel, tagLines } from './tagtext.js';

const MAX_LOG = 40;
const TITLE_LEFT = 'RVK NIGHT NETWORK.CONSTELLATIONS';
const TITLE_RIGHT = 'MRTY.26';

function clock(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

const label = nodeLabel;

// Everything shown here is read straight from the simulation: no invented readouts.
export class Hud {
  constructor() {
    this.log = [];
  }

  clearLog() { this.log = []; }

  onEvents(events, world) {
    for (const e of events) {
      const a = world.get(e.a), b = e.b ? world.get(e.b) : null;
      let text = null;
      switch (e.type) {
        case 'link': text = `LINK  ${label(a)} - ${label(b)}`; break;
        case 'unlink': text = `FREE  ${label(a)} / ${label(b)}  ${(e.reason || '').toUpperCase()}`; break;
        case 'add': text = `ADD   ${label(a)}`; break;
        case 'remove': text = `GONE  ${label(a)}`; break;
        case 'grab': text = `GRAB  ${label(a)}`; break;
        case 'release': text = `FLUNG ${label(a)}`; break;
      }
      if (text) this.log.push({ t: e.t, text });
    }
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  draw(ctx, renderer, world, look, state) {
    const H = look.hud;
    const { vw, vh } = renderer;
    const size = H.size, lh = size * 1.55, pad = 18;
    ctx.save();
    ctx.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0);
    ctx.font = `${size}px ${FONT_FAMILY}`;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.textBaseline = 'alphabetic';

    if (H.titles) this._titles(ctx, size, pad, vw, H.alpha);
    if (H.ledger) this._ledger(ctx, world, state, size, lh, pad, vh, H.alpha);
    if (H.log) this._log(ctx, world, size, lh, pad, vw, vh, H.alpha);
    if (H.ruler) this._ruler(ctx, world, look, vw, vh, size, H.alpha);
    if (H.linkNotes) this._linkNotes(ctx, world, size, H.alpha);
    if (H.tags) {
      const n = state.heldId ? world.get(state.heldId) : state.hoverId ? world.get(state.hoverId) : null;
      if (n && n.r) this._tag(ctx, n, look, size, lh, vw, vh, H.alpha);
    }
    ctx.restore();
  }

  // Two fixed labels in the top corners, set like the ledger in the bottom left.
  _titles(ctx, size, pad, vw, alpha) {
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'left';
    ctx.fillText(TITLE_LEFT, pad, pad + size * 0.8);
    ctx.textAlign = 'right';
    ctx.fillText(TITLE_RIGHT, vw - pad, pad + size * 0.8);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  _ledger(ctx, world, state, size, lh, pad, vh, alpha) {
    const s = world.stats();
    const lines = [
      `SEED ${world.seed.toUpperCase()}`,
      `T ${clock(world.t)}${state.paused ? '  PAUSED' : ''}`,
      `NODES ${s.nodes}  LINKS ${s.links}`,
      TYPES.map((t) => `${(t === 'star' ? 'visitor' : t).slice(0, 3).toUpperCase()} ${s.byType[t].nodes ? (s.byType[t].links / s.byType[t].nodes).toFixed(1) : '-'}`).join('  '),
    ];
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'left';
    lines.forEach((ln, i) => ctx.fillText(ln, pad, vh - pad - (lines.length - 1 - i) * lh));
    ctx.globalAlpha = 1;
  }

  _log(ctx, world, size, lh, pad, vw, vh, alpha) {
    const shown = this.log.slice(-9);
    ctx.textAlign = 'right';
    shown.forEach((e, i) => {
      const age = world.t - e.t;
      const fade = Math.max(0, 1 - age / 14) * (0.35 + 0.65 * ((i + 1) / shown.length));
      if (fade <= 0.02) return;
      ctx.globalAlpha = alpha * fade;
      ctx.fillText(`${clock(e.t)}  ${e.text}`, vw - pad, vh - pad - (shown.length - 1 - i) * lh);
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  // The node's title (a little brighter) with its details listed straight underneath, left-aligned with it.
  _tag(ctx, n, look, size, lh, vw, vh, alpha) {
    const r = n.r, L = look.look;
    const title = nodeLabel(n);
    const lines = tagLines(n);
    ctx.font = `${L.labelSize}px ${FONT_FAMILY}`;
    let w = ctx.measureText(title).width;
    ctx.font = `${size}px ${FONT_FAMILY}`;
    for (const ln of lines) w = Math.max(w, ctx.measureText(ln).width);
    const titleH = Math.max(L.labelSize * 1.3, lh);
    const h = titleH + lines.length * lh;
    let x = r.sx + r.rad + LABEL_GAP;
    let top = r.sy + L.labelSize * 0.35 - L.labelSize;
    x = Math.min(x, vw - 12 - w);
    top = Math.max(8, Math.min(top, vh - 12 - h));
    ctx.textAlign = 'left';
    ctx.globalAlpha = Math.min(1, alpha + 0.25);
    ctx.font = `${L.labelSize}px ${FONT_FAMILY}`;
    ctx.fillText(title, x, top + L.labelSize);
    ctx.globalAlpha = alpha;
    ctx.font = `${size}px ${FONT_FAMILY}`;
    lines.forEach((ln, i) => ctx.fillText(ln, x, top + titleH + i * lh + size * 0.8));
    ctx.globalAlpha = 1;
    r.label = { x, y: top, w, h };
  }

  _ruler(ctx, world, look, vw, vh, size, alpha) {
    const x = vw - 14, top = vh * 0.18, bot = vh * 0.82;
    const yOf = (nn) => top + (1 - (nn + 1) / 2) * (bot - top);
    ctx.globalAlpha = alpha * 0.6;
    ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bot); ctx.stroke();
    for (const n of world.nodes) {
      if (!n.r || n.removingAt !== null) continue;
      const y = yOf(n.r.nn);
      ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x, y); ctx.stroke();
    }
    const fy = yOf(look.look.focusDepth);
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.moveTo(x - 14, fy); ctx.lineTo(x - 7, fy - 4); ctx.lineTo(x - 7, fy + 4); ctx.closePath(); ctx.fill();
    ctx.textAlign = 'right';
    ctx.fillText('NEAR', x - 8, top - 8);
    ctx.fillText('FAR', x - 8, bot + size + 4);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  _linkNotes(ctx, world, size, alpha) {
    ctx.textAlign = 'center';
    const small = size * 0.85;
    ctx.font = `${small}px ${FONT_FAMILY}`;
    for (const l of world.links) {
      const a = l.a.r, b = l.b.r;
      if (!a || !b || Math.min(a.sharp, b.sharp) < 0.35) continue;
      if (Math.abs(a.sx - b.sx) > 500 || Math.abs(a.sy - b.sy) > 500) continue;
      ctx.globalAlpha = alpha * 0.8 * Math.min(a.sharp, b.sharp);
      ctx.fillText(`${(world.t - l.born).toFixed(0)}S`, (a.sx + b.sx) / 2, (a.sy + b.sy) / 2 - 4);
    }
    ctx.font = `${size}px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }
}
