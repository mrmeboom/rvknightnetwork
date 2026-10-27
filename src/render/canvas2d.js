import { TYPES } from '../sim/params.js';
import { labelTransform } from './labelgeom.js';

export const FONT_FAMILY = '"Bungee Hairline", monospace';
const LINK_DASH = { venue: [], artist: [1.5, 3], genre: [7, 4], theme: [16, 6], event: [10, 3, 2, 3], star: [2, 5] };
const MARK_R = { venue: 7, artist: 2.4, genre: 5.5, theme: 12, event: 6, star: 7 };
const SHADOW_OFFSET = 10000;
export const LABEL_GAP = 14;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Draws the world on a 2D canvas. Pure function of simulation state plus look settings:
// the same call renders the live view and the exported stills.
export class Renderer {
  constructor() {
    this.vw = 1; this.vh = 1; this.dpr = 1;
    this.scale = 1;
    this.ghosts = [];
    this.sorted = [];
  }

  resize(vw, vh, dpr) {
    this.vw = vw; this.vh = vh; this.dpr = dpr;
  }

  // Only links that ended within the fade window get a ghost, so a fast-forward never conjures old ones.
  onEvents(events, world, look) {
    const fade = look.look.linkFade;
    for (const e of events) {
      if (e.type !== 'unlink' || world.t - e.t >= fade) continue;
      const a = world.get(e.a), b = world.get(e.b);
      if (a && b) this.ghosts.push({ a, b, t0: e.t });
    }
    if (this.ghosts.length > 200) this.ghosts.splice(0, this.ghosts.length - 200);
  }

  // Projects every node to the screen and stores the result on node.r.
  prepare(world, look) {
    const L = look.look;
    const W = world.W, H = world.H, m = world.p.world.margin;
    const visW = Math.max(1, W - 2 * m), visH = Math.max(1, H - 2 * m);
    this.scale = Math.max(this.vw / visW, this.vh / visH) * look.view.zoom;
    const zH = world.zHalf, per = L.perspective;
    const cx = this.vw / 2, cy = this.vh / 2;
    for (const n of world.nodes) {
      const nn = zH > 0 ? n.z / zH : 0;
      const size = Math.max(0.2, 1 + per * nn);
      const pp = 1 + 0.35 * per * nn;
      const sharp = Math.exp(-(((nn - L.focusDepth) / L.focusFalloff) ** 2));
      const r = n.r || (n.r = {});
      r.nn = nn; r.size = size; r.pp = pp; r.sharp = sharp;
      r.sx = cx + (n.x - W / 2) * this.scale * pp;
      r.sy = cy + (n.y - H / 2) * this.scale * pp;
      r.bright = (L.minBrightness + (1 - L.minBrightness) * sharp) * (0.75 + 0.25 * ((nn + 1) / 2)) * n.alpha;
      r.blur = (1 - sharp) * L.maxBlur;
      r.rad = MARK_R[n.type] * L.markSize * size;
    }
    this.sorted = [...world.nodes].sort((a, b) => a.z - b.z);
  }

  // Where the screen position of b sits relative to a, taking the shortest path across the wrap seam.
  _partnerPos(world, a, b) {
    const W = world.W, H = world.H;
    let dx = b.x - a.x, dy = b.y - a.y;
    let sx = b.r.sx, sy = b.r.sy;
    if (dx > W / 2) sx -= W * this.scale * b.r.pp; else if (dx < -W / 2) sx += W * this.scale * b.r.pp;
    if (dy > H / 2) sy -= H * this.scale * b.r.pp; else if (dy < -H / 2) sy += H * this.scale * b.r.pp;
    return [sx, sy];
  }

  // Draws onto a transparent canvas (the sky is its own layer underneath).
  // opts: { hoverId, heldId, underlay(ctx) } where underlay paints the trails between the sky and the live view.
  drawScene(ctx, world, look, opts = {}) {
    const { vw, vh, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.prepare(world, look);
    if (opts.underlay) { opts.underlay(ctx); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    this._drawLinks(ctx, world, look);
    this._drawNodes(ctx, world, look, opts);
  }

  // A plain version of the current frame (links and marks only) for the trail slices.
  drawLite(ctx, world, look) {
    const L = look.look;
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineCap = 'butt';
    for (const l of world.links) {
      const [bx, by] = this._partnerPos(world, l.a, l.b);
      this._line(ctx, l.a.r.sx, l.a.r.sy, bx, by, 0.5 * Math.min(l.a.r.bright, l.b.r.bright), L.linkWeight * (l.a.r.size + l.b.r.size) / 2, this._linkDash(l));
    }
    for (const n of this.sorted) {
      const r = n.r;
      if (r.sx < -60 || r.sx > this.vw + 60 || r.sy < -60 || r.sy > this.vh + 60) continue;
      ctx.globalAlpha = clamp(r.bright * 0.7, 0, 1);
      this._mark(ctx, n, r, L);
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }

  _linkDash(l) {
    const t = TYPES[Math.min(l.a.ti, l.b.ti)];
    return LINK_DASH[t];
  }

  _line(ctx, ax, ay, bx, by, alpha, weight, dash) {
    if (alpha < 0.01) return;
    if (Math.max(ax, bx) < -40 || Math.min(ax, bx) > this.vw + 40 || Math.max(ay, by) < -40 || Math.min(ay, by) > this.vh + 40) return;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = weight;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  _drawLinks(ctx, world, look) {
    const L = look.look;
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'butt';
    const links = [...world.links].sort((p, q) => (p.a.z + p.b.z) - (q.a.z + q.b.z));
    for (const l of links) {
      const a = l.a, b = l.b;
      const [bx, by] = this._partnerPos(world, a, b);
      const fin = clamp((world.t - l.born) / L.linkFade, 0, 1);
      const d = world._dist(a, b);
      const P = world.p.links;
      const rest = l.D * P.rest;
      const taut = clamp((d - rest) / Math.max(1e-6, l.D * P.breakFactor - rest), 0, 1);
      const wear = P.fatigue > 0 ? clamp((world.t - l.born) / P.fatigue, 0, 1) : 0;
      const alpha = L.linkAlpha * Math.min(a.r.bright, b.r.bright) * fin * (1 - L.tensionGlow + L.tensionGlow * taut) * (1 - 0.4 * wear);
      const weight = L.linkWeight * (a.r.size + b.r.size) / 2;
      this._line(ctx, a.r.sx, a.r.sy, bx, by, alpha, weight, this._linkDash(l));
    }
    // links that just ended fade out instead of vanishing
    const keep = [];
    for (const gh of this.ghosts) {
      const age = world.t - gh.t0;
      if (age >= L.linkFade || gh.a.dead || gh.b.dead) continue;
      keep.push(gh);
      const [bx, by] = this._partnerPos(world, gh.a, gh.b);
      const alpha = L.linkAlpha * Math.min(gh.a.r.bright, gh.b.r.bright) * (1 - age / L.linkFade) * 0.6;
      this._line(ctx, gh.a.r.sx, gh.a.r.sy, bx, by, alpha, L.linkWeight * (gh.a.r.size + gh.b.r.size) / 2, LINK_DASH.venue);
    }
    this.ghosts = keep;
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  _blurred(ctx, blur, fn) {
    if (blur < 0.7) { fn(); return; }
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,1)';
    ctx.shadowBlur = blur * this.dpr;
    ctx.shadowOffsetX = SHADOW_OFFSET;
    ctx.translate(-SHADOW_OFFSET / this.dpr, 0);
    fn();
    ctx.restore();
  }

  _drawNodes(ctx, world, look, opts) {
    const L = look.look;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.font = `${L.labelSize}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'alphabetic';
    for (const n of this.sorted) {
      const r = n.r;
      if (r.sx < -60 || r.sx > this.vw + 60 || r.sy < -60 || r.sy > this.vh + 60) continue;
      const emph = n.id === opts.hoverId || n.id === opts.heldId;
      const alpha = emph ? Math.max(r.bright, 0.9 * n.alpha) : r.bright;
      const blur = emph ? 0 : r.blur;
      this._blurred(ctx, blur, () => {
        ctx.globalAlpha = clamp(alpha, 0, 1);
        this._mark(ctx, n, r, L);
        if (n.id === opts.heldId) {
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(r.sx, r.sy, r.rad + 7, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (n.name && this._showLabel(L, r, emph) && !(emph && look.hud.tags)) {
          ctx.globalAlpha = clamp(alpha * L.labelAlpha * (emph ? 1.2 : 1), 0, 1);
          const text = n.name.toUpperCase();
          const t = labelTransform(L.labelRotate, r.sx, r.sy, r.rad, L.labelSize, LABEL_GAP);
          ctx.save();
          ctx.translate(t.originX, t.originY);
          ctx.rotate(t.rot);
          ctx.fillText(text, t.tx, t.ty);
          ctx.restore();
          // the hover area follows the title, except when it is turned (that mode is for stills, not for hovering)
          r.label = L.labelRotate ? null : { x: r.sx + t.tx, y: r.sy + t.ty - L.labelSize, w: ctx.measureText(text).width, h: L.labelSize * 1.3 };
        } else if (!emph) r.label = null;
      });
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }

  _showLabel(L, r, emph) {
    if (emph) return L.labels !== 'none';
    switch (L.labels) {
      case 'all': return true;
      case 'focus': return r.sharp > 0.35;
      default: return false;
    }
  }

  _mark(ctx, n, r, L) {
    const { sx: x, sy: y, rad } = r;
    ctx.lineWidth = Math.max(0.6, 0.9 * Math.sqrt(r.size));
    ctx.setLineDash([]);
    switch (n.type) {
      case 'venue':
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, Math.max(1, rad * 0.2), 0, Math.PI * 2); ctx.fill();
        break;
      case 'artist':
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
        break;
      case 'genre':
        ctx.beginPath();
        ctx.moveTo(x, y - rad); ctx.lineTo(x + rad, y); ctx.lineTo(x, y + rad); ctx.lineTo(x - rad, y); ctx.closePath();
        ctx.stroke();
        break;
      case 'theme':
        ctx.setLineDash([1.5, 3.5]);
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(x - 2, y); ctx.lineTo(x + 2, y); ctx.moveTo(x, y - 2); ctx.lineTo(x, y + 2); ctx.stroke();
        break;
      case 'event': {
        // a square with a smaller solid square at its heart
        ctx.strokeRect(x - rad, y - rad, rad * 2, rad * 2);
        const q = rad * 0.38;
        ctx.fillRect(x - q, y - q, q * 2, q * 2);
        break;
      }
      case 'star': {
        const k = rad * 0.16;
        ctx.beginPath();
        ctx.moveTo(x, y - rad);
        ctx.quadraticCurveTo(x + k, y - k, x + rad, y);
        ctx.quadraticCurveTo(x + k, y + k, x, y + rad);
        ctx.quadraticCurveTo(x - k, y + k, x - rad, y);
        ctx.quadraticCurveTo(x - k, y - k, x, y - rad);
        ctx.fill();
        break;
      }
    }
  }

  // Screen position back to the world coordinates a node at the same depth would have.
  unproject(world, node, sx, sy) {
    const k = this.scale * node.r.pp;
    return [world.W / 2 + (sx - this.vw / 2) / k, world.H / 2 + (sy - this.vh / 2) / k];
  }

  // The mark within reach of the pointer, or the node whose title (or open tag) the pointer is over.
  hitTest(world, sx, sy, maxDist = 22) {
    const m = this.nearestNode(world, sx, sy, maxDist);
    if (m) return m;
    const pad = 4;
    for (let i = this.sorted.length - 1; i >= 0; i--) {
      const n = this.sorted[i], b = n.r?.label;
      if (!b || n.removingAt !== null || n.alpha < 0.3) continue;
      if (sx >= b.x - pad && sx <= b.x + b.w + pad && sy >= b.y - pad && sy <= b.y + b.h + pad) return n;
    }
    return null;
  }

  nearestNode(world, sx, sy, maxDist) {
    let best = null, bd = maxDist;
    for (const n of this.sorted) {
      if (n.removingAt !== null || n.alpha < 0.3 || !n.r) continue;
      const d = Math.hypot(n.r.sx - sx, n.r.sy - sy) - n.r.rad * 0.5;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
}
