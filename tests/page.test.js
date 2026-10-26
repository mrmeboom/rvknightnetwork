import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from '../src/sim/world.js';
import { randomSeed } from '../src/seed.js';
import { NODE_LIST } from './helpers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const html = read('index.html');

// every module main.js reaches through its imports
function moduleGraph(entry = 'src/main.js', seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  for (const m of read(entry).matchAll(/import[^;]*?from\s+'(\.[^']+)'/g)) moduleGraph(normalize(join(dirname(entry), m[1])), seen);
  return seen;
}

test('page: the preload list covers exactly the modules the app imports', () => {
  const listed = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]).sort();
  assert.deepEqual(listed, [...moduleGraph()].sort(), 'update the modulepreload list in index.html when files are added or removed');
});

test('page: nodes.json and the font are preloaded, and the fetch can use the preloaded copy', () => {
  assert.match(html, /<link rel="preload" href="nodes\.json" as="fetch" crossorigin>/);
  assert.match(html, /<link rel="preload" href="fonts\/BungeeHairline-latin\.woff2" as="font"/);
  const fetchLine = read('src/main.js').split('\n').find((l) => l.includes("fetch('nodes.json'"));
  assert.ok(fetchLine && !/cache\s*:/.test(fetchLine), 'a fetch with its own cache setting would ignore the preloaded copy');
});

test('page: the grain layer starts invisible, so raw noise never shows while loading', () => {
  assert.match(html, /#grain\s*\{[^}]*opacity:\s*0\b/);
  const main = read('src/main.js');
  assert.match(main, /this\.revealed \? String\(L\.grain\) : '0'/);
  assert.match(main, /if \(!app\.revealed\) \{ app\.revealed = true; app\.applyLook\(\)/);
});

test('start: the network is there from the first moments, so a short warm-up is enough', () => {
  const steady = new World({ seed: 'rvk', nodes: NODE_LIST });
  steady.run(30);
  const fresh = new World({ seed: 'rvk', nodes: NODE_LIST });
  fresh.run(3);
  assert.ok(fresh.links.length > 0.8 * steady.links.length, `${fresh.links.length} links after 3 s vs ${steady.links.length} after 30 s`);
  const speed = (w) => w.stats().meanSpeed;
  assert.ok(Math.abs(speed(fresh) - speed(steady)) / speed(steady) < 0.35, 'and it already moves at about the usual pace');
});

test('start: the warm-up in the app is short', () => {
  const m = read('src/main.js').match(/const WARMUP = (\d+(?:\.\d+)?);/);
  assert.ok(m && Number(m[1]) <= 5, `warm-up is ${m && m[1]} s`);
});

test('seed: every load rolls its own rvk-xxxx seed, the same shape as the reroll button', () => {
  const seeds = new Set(Array.from({ length: 200 }, () => randomSeed()));
  for (const s of seeds) assert.match(s, /^rvk-\d{4}$/);
  assert.ok(seeds.size > 150, `${seeds.size} different seeds in 200 rolls`);
  assert.equal(randomSeed(() => 0), 'rvk-1000');
  assert.equal(randomSeed(() => 0.9999), 'rvk-9999');
  const main = read('src/main.js');
  assert.ok(!/seed: 'rvk'/.test(main), 'no fixed seed is left in the app');
  assert.match(main, /recipe\.seed = url\.get\('seed'\) \|\| randomSeed\(\)/);
  assert.match(main, /reroll\(\) \{ this\.applySeed\(randomSeed\(\)\)/);
});
