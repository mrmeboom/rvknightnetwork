// Time bookkeeping for trails, without canvases. Trails are kept in a ring of time slices; each slice
// collects what was drawn during one slice of the duration. Slices fade by age and the oldest is reused,
// so a trail vanishes in the same order it was drawn, with no leftover and no precision loss.
export class TrailClock {
  constructor(slices = 12) {
    this.n = slices;
    this.cur = 0;
    this.t0 = new Array(slices).fill(null); // start time of each slice, null while empty
  }

  reset() {
    this.cur = 0;
    this.t0.fill(null);
  }

  // Call before drawing into the trail at time t. Returns the index of the slice to draw into and whether it was just recycled (to clear).
  advance(t, duration) {
    const sliceDur = duration / this.n;
    if (this.t0[this.cur] === null) { this.t0[this.cur] = t; return { index: this.cur, fresh: true }; }
    if (t - this.t0[this.cur] >= sliceDur) {
      this.cur = (this.cur + 1) % this.n;
      this.t0[this.cur] = t;
      return { index: this.cur, fresh: true };
    }
    return { index: this.cur, fresh: false };
  }

  // Brightness factor per slice (0 for empty or expired ones), as of time t.
  alphas(t, duration) {
    const sliceDur = duration / this.n;
    return this.t0.map((t0, i) => {
      if (t0 === null) return 0;
      const age = t - (t0 + Math.min(t - t0, sliceDur) / 2); // a slice still filling ages from its middle so far
      const a = 1 - age / duration;
      return a > 0 ? Math.min(1, a) : 0;
    });
  }
}
