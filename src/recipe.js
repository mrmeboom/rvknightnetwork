import { World } from './sim/world.js';
import { validateParams } from './sim/params.js';

export function normalizeRecipe(r = {}) {
  return {
    version: 1,
    seed: 'rvk',
    dt: 1 / 60,
    time: 0,
    macros: {},
    params: {},
    nodes: [],
    ...r,
  };
}

// Builds a world and fast-forwards it to recipe.time. A time jump reproduces the image exactly
// only for runs with no live edits (parameter changes or grabs) along the way.
export function createWorld(recipe) {
  const r = normalizeRecipe(recipe);
  const problems = validateParams(r.params);
  if (problems.length) throw new Error(`Invalid recipe params:\n  ${problems.join('\n  ')}`);
  const world = new World({ seed: r.seed, dt: r.dt, macros: r.macros, params: r.params, nodes: r.nodes });
  if (r.time > 0) world.run(r.time);
  return world;
}

export function exportRecipe(world) {
  return {
    version: 1,
    seed: world.seed,
    dt: world.dt,
    time: world.t,
    macros: { ...world.macros },
    params: JSON.parse(JSON.stringify(world.overrides)),
    nodes: world.pool.map((d) => ({ name: d.name, type: d.type })),
  };
}
