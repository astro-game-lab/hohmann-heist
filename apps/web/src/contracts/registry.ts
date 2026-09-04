/**
 * Every shipped contract, bundled — §8.3.3, FR-201.
 *
 * > *ACCEPT: straight to the planner; no loading screen — scenario JSON is ≤ 8 kB and
 * > preloaded.*
 *
 * That is a design promise about latency, and the only way to keep it is to not fetch.
 * The contracts are imported, not requested: they land in the bundle, they are parsed
 * once at module load, and pressing ACCEPT is a state change rather than a round trip.
 * At ~2 kB each and eighteen of them at v1.0 that is around 36 kB against NFR-020's
 * 400 kB, which is affordable; the day it stops being, the fix is a per-act chunk, not a
 * network request on the path between reading a brief and playing it.
 *
 * ## Why a glob rather than a list
 *
 * `tools/content/`'s suite walks `content/contracts/` and gives every file it finds
 * §13.4's seven checks, so *adding a contract adds seven tests for free* — that is the
 * property G6 rests on. A hand-maintained list here would break the other half of it: a
 * contributor could add a contract, watch it pass every test, and find it unreachable in
 * the game because they did not know about this file. The glob means the directory is the
 * registry in both places.
 *
 * ## A contract that will not load is a build failure, not a runtime one
 *
 * `parseScenario` runs at module load and a failure throws immediately. The alternative —
 * skipping the bad one and carrying on — would ship a build whose contract board silently
 * has a hole in it. The content suite already refuses to let an invalid contract merge, so
 * the only way to reach the throw is to have broken the loader itself, and hearing about
 * that at start-up is the point.
 */
import { parseScenario, type LoadedScenario } from '@hh/game';

/**
 * Vite resolves this at build time: no directory is read at runtime, and the JSON is
 * inlined into the chunk. The path escapes the app root, which is the same reach
 * `scene-harness/contract.ts` already makes — `content/` is the workspace's, not the
 * app's, because `tools/` reads it too.
 */
const files = import.meta.glob<unknown>('../../../../content/contracts/*.json', {
  eager: true,
  import: 'default',
});

const load = (): ReadonlyMap<string, LoadedScenario> => {
  const byId = new Map<string, LoadedScenario>();
  for (const [path, document] of Object.entries(files)) {
    const result = parseScenario(document);
    if (!result.ok) {
      throw new Error(
        `${path} failed to load: ${result.errors.map((error) => error.message.key).join(', ')}`,
      );
    }
    byId.set(result.scenario.id, result.scenario);
  }
  return byId;
};

const CONTRACTS = load();

/**
 * Contracts in the order they are played.
 *
 * By act then index, from the contract's own fields — not by filename, which is only
 * conventionally `cNN-slug` and would silently mis-order the day one is not.
 */
export const contracts = (): readonly LoadedScenario[] =>
  [...CONTRACTS.values()].sort(
    (a, b) => a.document.act - b.document.act || a.document.index - b.document.index,
  );

/** One contract by the id in its URL, or `undefined` — a bad link is a thing to render. */
export const contractById = (id: string): LoadedScenario | undefined => CONTRACTS.get(id);
