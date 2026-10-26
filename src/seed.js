// Every load starts on its own seed, so each visitor sees a different cast and starting point.
// Seeds always look like rvk-4821, the same as the dev panel's reroll. A ?seed=... in the address still wins.
export function randomSeed(rand = Math.random) {
  return `rvk-${Math.floor(rand() * 9000 + 1000)}`;
}
