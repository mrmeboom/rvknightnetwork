// Where a node's label is drawn, and whether it is turned. Normally the label sits to the right of the mark and
// reads left to right. Turned, it is rotated 90 degrees counter-clockwise around the node's centre, so it sits
// above the mark and reads bottom to top (turn the picture 90 degrees clockwise and it reads normally again).
// Draw with: save, translate(originX, originY), rotate(rot), fillText(text, tx, ty), restore.
export function labelTransform(rotate, sx, sy, rad, size, gap) {
  return { originX: sx, originY: sy, rot: rotate ? -Math.PI / 2 : 0, tx: rad + gap, ty: size * 0.35 };
}

// Where the start of the label ends up on screen.
export function labelStart(t) {
  return { x: t.originX + t.tx * Math.cos(t.rot) - t.ty * Math.sin(t.rot), y: t.originY + t.tx * Math.sin(t.rot) + t.ty * Math.cos(t.rot) };
}
