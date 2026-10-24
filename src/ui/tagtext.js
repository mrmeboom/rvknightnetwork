// What the hover tag says about a node, as lines of text. Everything is read from the simulation.
export const nodeLabel = (n) => (n ? (n.type === 'star' ? 'VISITOR' : n.name.toUpperCase()) : '?');

export function tagLines(n) {
  const speed = Math.hypot(n.vx, n.vy, n.vz);
  const lines = [
    ...(n.type === 'star' ? [] : [n.type.toUpperCase()]), // a visitor is already titled VISITOR
    `X ${Math.round(n.x)}  Y ${Math.round(n.y)}  Z ${Math.round(n.z)}`,
    `SPEED ${speed.toFixed(3)}`,
  ];
  if (!n.links.length) lines.push('NO CONNECTIONS');
  else {
    lines.push('CONNECTIONS');
    n.links.forEach((l, i) => lines.push(`${String(i + 1).padStart(3, '0')}.${nodeLabel(l.a === n ? l.b : l.a)}`));
  }
  return lines;
}
