// Pointer handling: hover for the data tags, and catching/holding/flinging nodes.
export class Input {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.hoverId = null;
    this.heldId = null;
    this.pointer = null;
    this.offset = [0, 0];
    el.style.touchAction = 'none';
    el.addEventListener('pointermove', (e) => this._move(e));
    el.addEventListener('pointerdown', (e) => this._down(e));
    el.addEventListener('pointerup', (e) => this._up(e));
    el.addEventListener('pointercancel', (e) => this._up(e));
    el.addEventListener('pointerleave', () => { if (!this.heldId) { this.hoverId = null; this.pointer = null; } });
  }

  _pos(e) {
    const r = this.el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  _hit(x, y) {
    const { world, renderer } = this.app;
    return renderer.hitTest(world, x, y, 22);
  }

  _move(e) {
    const [x, y] = this._pos(e);
    this.pointer = [x, y];
    const { world, renderer } = this.app;
    if (this.heldId) {
      const n = world.get(this.heldId);
      if (n) {
        const [wx, wy] = renderer.unproject(world, n, x + this.offset[0], y + this.offset[1]);
        world.moveGrab(this.heldId, wx, wy);
      }
      return;
    }
    const n = this._hit(x, y);
    this.hoverId = n ? n.id : null;
    this.el.style.cursor = n ? 'grab' : 'default';
  }

  _down(e) {
    if (e.button !== 0) return;
    const [x, y] = this._pos(e);
    const n = this._hit(x, y);
    if (!n) return;
    const { world, renderer } = this.app;
    // keep the grab point where the pointer is, so grabbing by the title does not make the node jump
    this.offset = [n.r.sx - x, n.r.sy - y];
    const [wx, wy] = renderer.unproject(world, n, x + this.offset[0], y + this.offset[1]);
    if (world.grab(n.id, wx, wy)) {
      this.heldId = n.id;
      this.hoverId = n.id;
      this.el.setPointerCapture?.(e.pointerId);
      this.el.style.cursor = 'grabbing';
    }
  }

  _up(e) {
    if (!this.heldId) return;
    this.app.world.release(this.heldId);
    this.heldId = null;
    this.el.releasePointerCapture?.(e.pointerId);
    this.el.style.cursor = 'default';
  }

  // The held node may be removed or the world rebuilt underneath us.
  validate() {
    const { world } = this.app;
    if (this.heldId && !world.get(this.heldId)?.held) this.heldId = null;
    if (this.hoverId && !world.get(this.hoverId)) this.hoverId = null;
  }
}
