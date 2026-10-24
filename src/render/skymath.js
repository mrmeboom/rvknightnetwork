// Pure maths for the night sky (no canvas), so it can be tested headlessly and reused for stills.
import { Rng } from '../sim/rng.js';
import { createNoise } from '../sim/noise.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function makeSkyNoise(seed) {
  return createNoise(new Rng(`${seed}/sky`));
}

// Brightness (0..1) of the sky at pixel (x, y) and time t: large-scale perlin noise whose third axis is time,
// so the patches of light and dark evolve continuously. sky = look.sky, base = background tone 0..1.
export function skyTone(noise, x, y, t, sky, base) {
  const nx = x / sky.scale, ny = y / sky.scale, nz = t * sky.speed;
  let v = noise(nx, ny, nz);
  if (sky.detail > 0) v = (v + sky.detail * 0.5 * noise(nx * 2.3 + 7.1, ny * 2.3 + 3.3, nz * 1.7 + 5)) / (1 + sky.detail * 0.5);
  let u = clamp(0.5 + 0.5 * v * 1.4 * sky.contrast + sky.bias, 0, 1);
  u = u * u * (3 - 2 * u);
  return clamp(base + sky.patches * u, 0, 1);
}

// Star positions are in the unit square and keep their identity as the count changes (the first n are stable).
export function makeStars(seed, count) {
  const r = new Rng(`${seed}/stars`);
  return Array.from({ length: count }, () => ({
    x: r.next(), y: r.next(),
    mag: Math.pow(r.next(), 4),
    ph: r.next() * TAU, rate: 0.6 + r.next() * 0.9,
    ph2: r.next() * TAU, rate2: 2 + r.next() * 3,
  }));
}

// A slow swell plus a rare quick flicker; 1 means full brightness. Depth 0 means no twinkle.
export function twinkle(star, t, depth, speed) {
  const slow = 0.5 - 0.5 * Math.sin(TAU * star.rate * speed * t * 0.25 + star.ph);
  const quick = Math.pow(Math.max(0, Math.sin(TAU * star.rate2 * speed * t * 0.25 + star.ph2)), 6);
  return clamp(1 - depth * (0.6 * slow + 0.4 * quick), 0, 1);
}

export function starStyle(star, sky) {
  return {
    radius: (0.35 + star.mag * 1.0) * sky.starSize,
    alpha: sky.starBright * (0.25 + 0.75 * Math.pow(star.mag, 0.6)),
  };
}
