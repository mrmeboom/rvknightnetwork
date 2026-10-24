import { TrailClock } from './trailclock.js';

const SLICES = 12;

// Trails as a ring of time slices (see TrailClock). Each slice is a transparent canvas that collects what
// was drawn during its stretch of the duration; slices fade by age, oldest first, then get reused.
export class TrailLayer {
  constructor() {
    this.clock = new TrailClock(SLICES);
    this.slices = [];
    this.k = 1;
    this.vw = 1;
    this.vh = 1;
    this.lastSample = -Infinity;
  }

  resize(vw, vh, dpr) {
    this.vw = vw;
    this.vh = vh;
    this.k = Math.max(0.5, Math.min(dpr, 1920 / vw));
    this.slices = [];
    this.clock.reset();
    this.lastSample = -Infinity;
  }

  clear() {
    this.clock.reset();
    this.lastSample = -Infinity;
    for (const s of this.slices) if (s) s.ctx.clearRect(0, 0, s.canvas.width, s.canvas.height);
  }

  _slice(i) {
    if (!this.slices[i]) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(this.vw * this.k);
      canvas.height = Math.round(this.vh * this.k);
      this.slices[i] = { canvas, ctx: canvas.getContext('2d') };
    }
    return this.slices[i];
  }

  // Draws the current frame into the trail (after the renderer has projected the nodes for this frame).
  record(world, renderer, look) {
    const dur = look.look.trails;
    if (dur <= 0) return;
    if (world.t < this.lastSample) this.clear();
    if (world.t - this.lastSample < 1 / look.look.trailRate) return;
    this.lastSample = world.t;
    const { index, fresh } = this.clock.advance(world.t, dur);
    const s = this._slice(index);
    if (fresh) s.ctx.clearRect(0, 0, s.canvas.width, s.canvas.height);
    s.ctx.setTransform(this.k, 0, 0, this.k, 0, 0);
    renderer.drawLite(s.ctx, world, look);
  }

  composite(ctx, world, look, dpr) {
    const dur = look.look.trails;
    if (dur <= 0) return;
    const alphas = this.clock.alphas(world.t, dur);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    for (let i = 0; i < alphas.length; i++) {
      if (alphas[i] < 0.002 || !this.slices[i]) continue;
      ctx.globalAlpha = alphas[i] * look.look.trailStrength;
      ctx.drawImage(this.slices[i].canvas, 0, 0, this.vw, this.vh);
    }
    ctx.globalAlpha = 1;
  }
}
