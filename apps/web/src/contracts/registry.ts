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
 * ## A contract that will not load is reported, not thrown
 *
 * This module used to throw at load, on the reasoning that a bad contract should be a
 * build failure rather than a board with a silent hole in it. The first half of that is
 * still true and is still enforced — **by `tools/content/`'s suite, which refuses to let
 * an invalid contract merge**, and which is a better place for the guarantee because it
 * fails in CI with the file named rather than in a browser with a blank page.
 *
 * What the throw could not do is §8.7's row: *"Refuse to load it, show which field failed,
 * and offer to report it."* A `throw` at module scope happens before anything is mounted,
 * so the only thing that can catch it is a boundary with an `Error` in its hand — and
 * `parseScenario` had already produced a list of JSON pointers and field-level messages
 * that stringifying into an `Error` threw away. Collecting the failures keeps them, so the
 * board can render the refusal against the contract it belongs to and the briefing route
 * for that id can say which field is wrong.
 *
 * The hole is therefore no longer silent, which was the actual objection: a contract that
 * failed to parse is **visible on the board as a failure**, not absent from it.
 */
import { parseScenario, type LoadedScenario, type ScenarioError } from '@hh/game';

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

/** A contract whose data was refused — §8.7, FR-202. */
export interface BrokenContract {
  /**
   * The id, taken from the filename.
   *
   * It cannot come from the document: the document is what failed validation, so its `id`
   * field is exactly as untrustworthy as the rest of it — and may be the field that failed.
   * The filename is the one identifier that is known to be well-formed, because Vite
   * resolved the glob against it.
   */
  readonly id: string;
  /** The loader's own field-level errors, unmodified. */
  readonly errors: readonly ScenarioError[];
}

/** `…/content/contracts/c05-tailgate.json` → `c05-tailgate`. */
const idFromPath = (path: string): string =>
  path
    .split('/')
    .pop()
    ?.replace(/\.json$/, '') ?? path;

interface Registry {
  readonly byId: ReadonlyMap<string, LoadedScenario>;
  readonly broken: readonly BrokenContract[];
}

const load = (): Registry => {
  const byId = new Map<string, LoadedScenario>();
  const broken: BrokenContract[] = [];

  // `Object.entries` over a glob is insertion-ordered by Vite's own sort of the matched
  // paths, but nothing downstream may rely on that (NFR-009): `contracts()` sorts by act
  // and index, and the broken list is sorted by id below.
  for (const [path, document] of Object.entries(files)) {
    const result = parseScenario(document);
    if (!result.ok) {
      broken.push({ id: idFromPath(path), errors: result.errors });
      continue;
    }
    byId.set(result.scenario.id, result.scenario);
  }

  broken.sort((a, b) => a.id.localeCompare(b.id));
  return { byId, broken: Object.freeze(broken) };
};

const REGISTRY = load();
const CONTRACTS = REGISTRY.byId;

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

/**
 * Every contract whose data was refused, by id.
 *
 * Empty in any build the content suite has passed, which is every build that reaches
 * `main`. It is not dead code for that reason: §8.7 asks for the state, and a state with
 * no way to reach it is a state nobody has looked at. `registry.test.ts` reaches it with
 * a malformed document through the same `parseScenario` call this uses.
 */
export const brokenContracts = (): readonly BrokenContract[] => REGISTRY.broken;

/** One refused contract by id, or `undefined` if that id parsed (or does not exist). */
export const brokenContractById = (id: string): BrokenContract | undefined =>
  REGISTRY.broken.find((contract) => contract.id === id);
