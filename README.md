# Hohmann Heist

Steal things in orbit. A browser puzzle game where the only weapon is real orbital mechanics.

An [astro-game-lab](https://github.com/astro-game-lab) game — real orbital mechanics, playable.

## Play

**Not deployed yet.** The build pipeline is issue
[#29](https://github.com/astro-game-lab/hohmann-heist/issues/29); this line becomes
a link the day it lands. To run it locally, see [Development](#development) below.

## Status

**A contract can be played end to end.** `c03-cold-open` runs briefing → planner →
execution → debrief: a plan is built and inspected, committed, flown, and judged against
the contract's published par. One contract ships, the diagnosis rule set behind the
debrief's "what happened" is still a single rule, and there is no board, title screen or
Codex — so this is a vertical slice rather than a game. The sections below describe what
actually exists rather than what is planned.

| | |
| --- | --- |
| **Simulation** | Constants, time, reference frames, the Kepler solvers, both element sets, the closed-form two-body relations, Lambert, universal-variable propagation with the arc abstraction over it, `@hh/sim` — nodes, quantisation, impulsive Δv, replay codes, and the **timeline**: a plan applied to a state becomes alternating Keplerian arcs and impulses over a horizon, evaluable at any epoch by binary search and re-evaluable from an edited node onward. Plus six event finders: apsis crossings, revolution completions, closest approach, altitude-shell crossings, ground-station visibility and umbra intervals. |
| **Rendering** | The whole orbit scene of §9.3. The `Renderer` seam with a Canvas 2-D implementation behind it, an orthographic camera with pan, zoom and auto-framing, adaptive orbit tessellation with its cache — and now Earth to scale with Natural Earth coastlines and a terminator, hazard shells, the three trajectory styles, ship and target markers with trails, maneuver nodes with RTN handles, and apsis and closest-approach annotations. Text is never on the canvas: a DOM label layer positioned by transform holds every string. Plus a hit-test index with 32 CSS px targets, and `devicePixelRatio` handling that survives a move between displays. |
| **Game rules** | `@hh/game` — the evaluation surface. Objectives (`reach_orbit`, `intercept`, `rendezvous`, `soft_rendezvous`), the Δv budget, deadline and 100 km altitude floor as *intervals* rather than booleans, and plan legality `L1`–`L6` with a specific, translatable reason for each. Then what a run came to: the **flight log** — every burn, apsis, revolution, constraint crossing and the closest approach, with epochs, from the event finders over the solved timeline — and the **outcome**, including §6.7's medals evaluated on quantised values so a 1e-9 difference between engines can never flip one. Plus the scenario format: a JSON Schema with the TypeScript types generated from it, and a loader that refuses an invalid contract with a field-level error. Every tolerance in it is a numbered departure in [`docs/PHYSICS.md`](docs/PHYSICS.md), and a test fails if the code and that table disagree. |
| **Content** | One shipped contract — `c03-cold-open`, an intercept — as declarative JSON in `content/contracts/`. Its par is **computed, not authored**: `tools/pars/` searches a grid of Lambert transfers refined by a simplex, evaluates the winner through the game's own timeline, and writes the derivation to [`docs/PARS.md`](docs/PARS.md). Every contract in the directory automatically gets §13.4's seven checks, so adding one adds seven tests and offers no way to avoid them. |
| **Application** | Hash routing over §8.2's whole table, with focus moved to the new screen's heading on every route change and transitions that collapse under `prefers-reduced-motion`. The **contract briefing** renders `c03-cold-open` from its own JSON — objective, Δv budget, deadline, par, constraints and the ship/target setup — in display units, each value carrying its SI value in a tooltip and in the DOM. Accepting it goes straight to the **planner**: §8.3.4's five regions around the orbit view, in one component tree that becomes a grid above 1024 px and a tab strip below without unmounting a panel, so no plan state survives the switch by accident. §8.5.1's state machine sits under it, with illegal transitions that fail to compile rather than being merely unreachable. Committing flies the plan: **execution** plays back the already-solved timeline at rates from 1× to 100 000×, pausable, skippable and abortable back to the planner with the plan and the player's place in it restored, with a camera that follows the ship and closes in on the encounter without a scale jump, and a flight log that is complete and identical whether the run was watched or skipped. It ends in the **debrief** — the medal, the result against par, and on a miss the closest approach achieved against what was needed. Progress persists under a single versioned `localStorage` key with an explicit migration chain, and a save from a newer build is refused rather than partially read. The remaining routes resolve to a placeholder inside the real frame. `#/scene` remains a development harness for the renderer's visual claims. Every string comes from `@hh/ui`'s message catalogue, and a lint rule refuses literal text in JSX. |
| **Quality** | 1 900 tests, CI on every pull request, a layering rule and determinism guardrails that are themselves tested. Plus three regression layers over plan evaluation: 31 committed golden trajectories gated at 1e-9 relative, a 10 000-plan in-process determinism fuzz asserting bit-identity, and a benchmark suite gated against a committed baseline rather than only against an absolute limit. |
| **Milestone** | M2 of eight — the vertical slice, in progress. See [`docs/PRODUCT.md`](docs/PRODUCT.md) §14 for the plan. |

[`docs/PHYSICS.md`](docs/PHYSICS.md) is the honest account of what the simulation
currently claims — including where a stated requirement turns out not to be
attainable in float64, and what holds instead. Every row that has no passing test
names the issue that will provide it.

## The astrodynamics

Orbital period depends only on semi-major axis, so changing *where you are* in an
orbit means changing *which orbit you are in*. The consequence is the least
intuitive fact in the subject: **to catch something ahead of you, you slow down.**
Burning retrograde drops you into a lower orbit with a shorter period, and you gain
angle on your target every revolution.

A player should come away able to explain why speeding up makes you arrive later.

See [`docs/PHYSICS.md`](docs/PHYSICS.md) for the model — units, frames, what is
neglected, and how the numbers were validated. If the simulation ever disagrees
with a textbook, that is a bug: please
[report it](https://github.com/astro-game-lab/hohmann-heist/issues/new/choose)
using the physics discrepancy template.

## Development

### Requirements

- **Node 24** (pinned in `.nvmrc`)
- **pnpm 11** (pinned in `packageManager`; `corepack enable` is enough)

### Setup

```bash
git clone https://github.com/astro-game-lab/hohmann-heist.git
cd hohmann-heist
pnpm install
pnpm dev
```

### Common tasks

| Task | Command |
| --- | --- |
| Run locally | `pnpm dev` |
| Build | `pnpm build` |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` — `pnpm lint:fix` to apply |
| Format | `pnpm format:check` — `pnpm format` to apply |
| Layering rule | `pnpm layering` |
| Test | `pnpm test` — the packages, and fast |
| Test everything | `pnpm test:all` — adds the app, the guardrails, the goldens, the fuzz and the benchmarks |
| Coverage | `pnpm coverage` |
| Benchmarks | `pnpm bench`, then `pnpm bench:check` against the committed baseline |
| Golden fixtures | `pnpm goldens:write` — regenerate them, deliberately |
| Par values | `pnpm pars:check` — recompute every contract's par and fail if it moved; `pnpm pars:write` to accept the new answer |

CI runs all of these on every pull request. `pnpm test` is deliberately the fast
subset for the inner loop; the guardrail suite builds a full type-aware program and
belongs in `test:all`.

Two of those gates are worth knowing about before you hit them. **A change to
`tools/goldens/fixtures.json` requires a change to `docs/PHYSICS.md` in the same pull
request** — a golden only moves when an evaluated trajectory moved, which makes it a
change to the physics model rather than to a test fixture. And the benchmark gate
fails on a *regression against the baseline*, not only on an absolute budget, so a
change that costs 30% *relative to the rest of the suite* has to be explained or
re-recorded even though nothing is running slowly yet. Runner speed varies about
two-fold, so the comparison is relative by necessity; `tools/bench/compare.mjs`
explains that, its one blind spot, and how to record a new baseline from CI.

### Layout

```
packages/math          vectors, matrices, angles, root finders, seeded PRNG
packages/astro         constants, time, frames, elements, Kepler, Lambert
packages/propagation   universal-variable propagation, arcs, event finders, oracle
packages/sim           plan, nodes, impulses, timeline, replay codes
packages/game          rules, scenarios, and every departure
packages/render        renderer, camera, orbit tessellation
packages/ui            message catalogue, components, palettes
apps/web               the browser application
content/contracts      the shipped contracts, as declarative JSON
tools/                 development tooling: the par solver, goldens, benchmarks, guardrails
```

Dependencies point one way: `render → game → sim`. The simulation core must not
import from the layers above it, must not touch the DOM, and must not read the wall
clock or call `Math.random`. All three are enforced in CI rather than left to
review — see [`docs/PRODUCT.md`](docs/PRODUCT.md) §11.1. Nothing under `packages/` or
`apps/` may import anything under `tools/`, which is what keeps development tooling —
the par solver especially — out of the bundle.

`packages/render` is the one package below `apps/web` that draws, so it compiles
against its own TypeScript project with the DOM library; the root project has none, so
a browser type in the core is a compile error. Only three modules actually need a DOM —
the Canvas 2-D implementation, the label layer and the viewport observer — and each sits
behind its own subpath (`@hh/render/canvas2d`, `/labels`, `/resize`). Everything the
barrel exports is plain geometry over plain numbers and runs under Node, which is what
lets the scene be tested and benchmarked without a browser. That split is enforced by the
compiler rather than by convention: the root project compiles everything the barrel
reaches, so a DOM type creeping into it fails `pnpm typecheck` — which is exactly how the
label layer's boundary was found.

## Documentation

- [`docs/PHYSICS.md`](docs/PHYSICS.md) — the simulation model and its validation.
- [`docs/PARS.md`](docs/PARS.md) — every contract's par, and the search that produced it.
- [`docs/DESIGN.md`](docs/DESIGN.md) — what the game is and who it is for.
- [`CHANGELOG.md`](CHANGELOG.md) — notable changes, including physics-model changes.
- [`CLAUDE.md`](CLAUDE.md) — conventions, for humans and for Claude Code.

## Contributing

Contributions are welcome — code, playtest feedback, art, scenario design, and
bug reports all count. See the org
[contributing guide](https://github.com/astro-game-lab/.github/blob/main/CONTRIBUTING.md),
which covers the extra requirements for physics changes: state your units and
frame, cite your source, and include a validation test.

## Licence

Code is [MIT](LICENSE). Game assets are
[CC BY 4.0](LICENSE-ASSETS.md). Third-party material and its terms are listed in
[`ATTRIBUTIONS.md`](ATTRIBUTIONS.md).
