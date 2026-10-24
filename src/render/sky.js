import { skyTone, makeSkyNoise, makeStars, twinkle, starStyle } from './skymath.js';

const COLS = 96;
const SIZE_CLASSES = 6;

// The night sky: slowly evolving patches of light and dark (perlin noise, time on the third axis) and
// a few twinkling stars. The patches are computed on a coarse grid and scaled up smoothly.
export class Sky {
  constructor(seed) {
    this.field = document.createElement('canvas');
    this.stars = [];
    this.sprites = new Map();
    this.setSeed(seed);
  }

  setSeed(seed) {
    this.seed = String(seed);
    this.noise = makeSkyNoise(this.seed);
    this.stars = [];
    this.lastUpdate = -Infinity;
  }

  // Cheap enough to run a few times a second; the patches change very slowly.
  updateField(vw, vh, t, look) {
    if (!(vw >= 1 && vh >= 1)) return; // a window that has no size yet (a hidden or resizing embed)
    const cols = COLS, rows = Math.max(2, Math.round((COLS * vh) / vw));
    if (this.field.width !== cols || this.field.height !== rows) { this.field.width = cols; this.field.height = rows; this.img = null; }
    const ctx = this.field.getContext('2d');
    const img = this.img || (this.img = ctx.createImageData(cols, rows));
    const base = look.look.bgTone / 255;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const tone = skyTone(this.noise, ((i + 0.5) / cols) * vw, ((j + 0.5) / rows) * vh, t, look.sky, base);
        const g = Math.round(tone * 255), k = (j * cols + i) * 4;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = g;
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // Stars are stamped from a handful of pre-rendered dots. Drawing hundreds of circles that each have their
  // own radius is very slow in a canvas (nothing can be cached); stamping a few sizes is fast.
  _sprite(cls, dpr, starSize) {
    const key = `${cls}|${dpr}|${starSize}`;
    let sp = this.sprites.get(key);
    if (!sp) {
      if (this.sprites.size > 60) this.sprites.clear();
      const radius = (0.35 + ((cls + 0.5) / SIZE_CLASSES)) * starSize;
      const px = Math.max(3, Math.ceil(radius * 2 * dpr) + 4);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = px;
      const c = canvas.getContext('2d');
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(px / 2, px / 2, radius * dpr, 0, Math.PI * 2);
      c.fill();
      sp = { canvas, size: px / dpr };
      this.sprites.set(key, sp);
    }
    return sp;
  }

  draw(ctx, vw, vh, dpr, t, look) {
    const S = look.sky;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, vw, vh);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low'; // the field is already smooth; 'high' costs frame rate for nothing
    if (this.field.width > 1) ctx.drawImage(this.field, 0, 0, vw, vh);
    const n = Math.round(S.stars);
    if (this.stars.length !== n) this.stars = makeStars(this.seed, n);
    for (const star of this.stars) {
      const st = starStyle(star, S);
      const a = st.alpha * twinkle(star, t, S.twinkle, S.twinkleSpeed);
      if (a < 0.01) continue;
      const sp = this._sprite(Math.min(SIZE_CLASSES - 1, Math.floor(star.mag * SIZE_CLASSES)), dpr, S.starSize);
      ctx.globalAlpha = a;
      ctx.drawImage(sp.canvas, star.x * vw - sp.size / 2, star.y * vh - sp.size / 2, sp.size, sp.size);
    }
    ctx.globalAlpha = 1;
  }
}
