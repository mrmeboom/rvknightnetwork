// Presentation settings (not part of the simulation). Same shape as the sim schema so the
// dev panel treats both alike. Lives in the recipe under "look".
import { mergeParams, setPath } from '../sim/params.js';

export const LOOK_SCHEMA = [];

function add(path, label, group, kind, min, max, step, value, options) {
  LOOK_SCHEMA.push({ path, label, group, kind, min, max, step, default: value, options });
}
const num = (path, label, group, min, max, step, value) => add(path, label, group, 'number', min, max, step, value);
const flag = (path, label, group, value) => add(path, label, group, 'bool', 0, 1, 1, value);
const choice = (path, label, group, options, value) => add(path, label, group, 'choice', 0, 0, 0, value, options);

num('run.timeScale', 'Time scale', 'Run', 0, 8, 0.05, 0.85);

num('view.zoom', 'Zoom', 'View', 0.4, 3, 0.01, 1);
num('look.perspective', 'Perspective', 'View', 0, 1.5, 0.01, 0.5);
num('look.focusDepth', 'Focus plane (far -1 .. near +1)', 'View', -1, 1, 0.01, 0);
num('look.focusFalloff', 'Focus falloff', 'View', 0.1, 3, 0.01, 0.9);
num('look.minBrightness', 'Out-of-focus brightness', 'View', 0, 1, 0.01, 0.3);
num('look.maxBlur', 'Out-of-focus blur (px)', 'View', 0, 20, 0.5, 5);

num('look.markSize', 'Mark size', 'Marks and labels', 0.4, 3, 0.05, 1);
choice('look.labels', 'Labels', 'Marks and labels', ['all', 'focus', 'hover', 'none'], 'all');
num('look.labelSize', 'Label size (px)', 'Marks and labels', 6, 40, 0.5, 11);
num('look.labelAlpha', 'Label brightness', 'Marks and labels', 0.05, 1, 0.01, 0.8);

num('look.linkWeight', 'Link weight (px)', 'Links', 0.25, 3, 0.05, 1);
num('look.linkAlpha', 'Link brightness', 'Links', 0.05, 1, 0.01, 0.55);
num('look.linkFade', 'Link fade time (s)', 'Links', 0.05, 4, 0.05, 0.8);
num('look.tensionGlow', 'Brighten when stretched', 'Links', 0, 1, 0.01, 0.45);

num('look.trails', 'Trails: duration (s, 0 = off)', 'Trails', 0, 600, 1, 0);
num('look.trailStrength', 'Trails: brightness', 'Trails', 0.05, 1, 0.01, 0.45);
num('look.trailRate', 'Trails: snapshots per second', 'Trails', 1, 60, 1, 12);

num('sky.patches', 'Patches: brightness', 'Sky', 0, 0.5, 0.005, 0.07);
num('sky.scale', 'Patches: size (px)', 'Sky', 150, 3000, 10, 870);
num('sky.speed', 'Patches: evolution speed', 'Sky', 0, 0.5, 0.001, 0.022);
num('sky.contrast', 'Patches: contrast', 'Sky', 0.3, 4, 0.05, 1.3);
num('sky.bias', 'Patches: lit share (-0.5 .. 0.5)', 'Sky', -0.5, 0.5, 0.01, 0);
num('sky.detail', 'Patches: fine detail', 'Sky', 0, 1, 0.01, 0.3);
num('sky.stars', 'Sky stars: count', 'Sky', 0, 1000, 10, 260);
num('sky.starSize', 'Sky stars: size', 'Sky', 0.3, 4, 0.05, 1);
num('sky.starBright', 'Sky stars: brightness', 'Sky', 0, 1, 0.01, 0.55);
num('sky.twinkle', 'Sky stars: twinkle depth', 'Sky', 0, 1, 0.01, 0.6);
num('sky.twinkleSpeed', 'Sky stars: twinkle speed', 'Sky', 0.05, 4, 0.05, 0.6);

num('look.grain', 'Grain strength', 'Grain and base tone', 0, 0.5, 0.005, 0.065);
num('look.grainFps', 'Grain refresh (fps)', 'Grain and base tone', 1, 60, 1, 20);
num('look.grainSize', 'Grain size (px)', 'Grain and base tone', 1, 4, 1, 1);
num('look.bgTone', 'Sky base tone (0-30)', 'Grain and base tone', 0, 30, 1, 0);

flag('hud.ledger', 'A. Corner ledger', 'HUD', true);
flag('hud.tags', 'B. Hover / grab tags', 'HUD', true);
flag('hud.linkNotes', 'C. Link annotations', 'HUD', false);
flag('hud.log', 'D. Event log', 'HUD', true);
flag('hud.ruler', 'E. Depth ruler', 'HUD', false);
num('hud.size', 'HUD type size (px)', 'HUD', 7, 24, 0.5, 11);
num('hud.alpha', 'HUD brightness', 'HUD', 0.1, 1, 0.01, 0.75);

export const LOOK_BY_PATH = new Map(LOOK_SCHEMA.map((e) => [e.path, e]));

export const LOOK_DEFAULTS = (() => {
  const d = {};
  for (const e of LOOK_SCHEMA) setPath(d, e.path, e.default);
  return d;
})();

export function resolveLook(overrides) {
  return mergeParams(LOOK_DEFAULTS, overrides || {});
}
