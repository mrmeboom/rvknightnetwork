import { paintGrain } from './grain.js';

// The pieces a PNG export is made of, bottom to top. The switches only decide what is in the file; the live
// page and the look settings are untouched.
export const EXPORT_LAYERS = [
  { key: 'sky', label: 'SKY', title: 'The black base, sky patches and sky stars. Off leaves the background transparent.' },
  { key: 'trails', label: 'TRAILS', title: 'The fading trails behind the nodes.' },
  { key: 'nodes', label: 'NODES', title: 'The nodes with their labels, and the links between them.' },
  { key: 'grain', label: 'GRAIN', title: 'The grain over everything.' },
  { key: 'hud', label: 'HUD', title: 'Ledger, event log, corner titles, link notes and the hover tag.' },
];

export const defaultExportLayers = () => Object.fromEntries(EXPORT_LAYERS.map((l) => [l.key, true]));

// Anything unknown or not a boolean falls back to on, so a stale saved value cannot hide a layer for good.
export function sanitizeExportLayers(saved) {
  const out = defaultExportLayers();
  if (saved && typeof saved === 'object') for (const l of EXPORT_LAYERS) if (saved[l.key] === false) out[l.key] = false;
  return out;
}

export const anyExportLayer = (layers) => EXPORT_LAYERS.some((l) => layers[l.key]);

// Paints one still onto a fresh canvas context. Layers that are off are skipped, not painted and hidden.
// d: { sky, trails, renderer, world, look, hud, grainTile, grainOffset, state, vw, vh, scale }
export function paintStill(c, d, layers) {
  const { sky, trails, renderer, world, look, hud, grainTile, grainOffset, state, vw, vh, scale } = d;
  if (layers.sky) sky.draw(c, vw, vh, scale, world.t, look);
  // always run, so the projection is ready for the HUD even with the nodes off
  renderer.drawScene(c, world, look, {
    hoverId: state.hoverId, heldId: state.heldId, clear: false, nodes: !!layers.nodes,
    underlay: layers.trails ? (ctx) => trails.composite(ctx, world, look, scale) : null,
  });
  if (layers.grain) paintGrain(c, grainTile, c.canvas.width, c.canvas.height, look.look.grain, look.look.grainSize * scale, ...grainOffset.map((v) => v * scale));
  if (layers.hud) hud.draw(c, renderer, world, look, state);
}
