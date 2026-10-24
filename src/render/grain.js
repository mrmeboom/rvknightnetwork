import { Rng } from '../sim/rng.js';

// A tile of white specks with random alpha: mostly faint, a few bright. Seeded so stills reproduce.
export function makeGrainTile(size = 192, seed = 'grain') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const rng = new Rng(seed);
  for (let i = 0; i < size * size; i++) {
    const a = Math.pow(rng.next(), 2.6) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// For stills: paints the tile over a whole canvas (device pixels), offset by (ox, oy).
export function paintGrain(ctx, tile, width, height, strength, pixelSize, ox = 0, oy = 0) {
  if (strength <= 0) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = strength;
  ctx.imageSmoothingEnabled = false;
  const step = tile.width * pixelSize;
  for (let y = -((oy % step) + step) % step; y < height; y += step) {
    for (let x = -((ox % step) + step) % step; x < width; x += step) {
      ctx.drawImage(tile, x, y, step, step);
    }
  }
  ctx.restore();
}
