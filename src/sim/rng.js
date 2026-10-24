function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function sfc32(a, b, c, d) {
  return function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  return xmur3(String(str))();
}

// Directional (hash2(a,b) differs from hash2(b,a)); returns [0,1).
export function hash2(a, b, s) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ s;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class Rng {
  constructor(seed) {
    this.seed = String(seed);
    const h = xmur3(this.seed);
    this._f = sfc32(h(), h(), h(), h());
    for (let i = 0; i < 12; i++) this._f();
  }
  next() { return this._f(); }
  range(a, b) { return a + (b - a) * this._f(); }
  int(a, b) { return a + Math.floor(this._f() * (b - a + 1)); }
  chance(p) { return this._f() < p; }
  normal() {
    const u = Math.max(this._f(), 1e-12), v = this._f();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  pick(arr) { return arr[Math.floor(this._f() * arr.length)]; }
  fork(label) { return new Rng(this.seed + '/' + label); }
}
