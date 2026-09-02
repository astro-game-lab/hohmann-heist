# Hohmann Heist

Steal things in orbit. A browser puzzle game where the only weapon is real orbital mechanics.

An [astro-game-lab](https://github.com/astro-game-lab) game — real orbital mechanics, playable.

## Play

**Not deployed yet.** The build pipeline is issue
[#29](https://github.com/astro-game-lab/hohmann-heist/issues/29); this line becomes
a link the day it lands. To run it locally, see [Development](#development) below.

## Status

**Early — the foundations, not the game.** There is nothing playable here yet, and
the sections below describe what actually exists rather than what is planned.

| | |
| --- | --- |
| **Simulation** | Constants, time, reference frames, the Kepler solvers, both element sets, the closed-form two-body relations, Lambert, and universal-variable propagation with the arc abstraction over it. No event finding, no timeline. |
| **Application** | A skeleton: routing works and imports the simulation packages. No screens. |
| **Quality** | 450 tests, CI on every pull request, a layering rule and determinism guardrails that are themselves tested. |
| **Milestone** | M0 of eight. See [`docs/PRODUCT.md`](docs/PRODUCT.md) §14 for the plan. |

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
| Test everything | `pnpm test:all` — adds the app and the guardrail suite |
| Coverage | `pnpm coverage` |

CI runs all of these on every pull request. `pnpm test` is deliberately the fast
subset for the inner loop; the guardrail suite builds a full type-aware program and
belongs in `test:all`.

### Layout

```
packages/math          vectors, matrices, angles, root finders, seeded PRNG
packages/astro         constants, time, frames, elements, Kepler, Lambert
packages/propagation   universal-variable propagation, arcs, oracle
packages/sim           plan, timeline, world state            (empty)
packages/game          rules, scenarios, and every departure  (empty)
packages/render        canvas 2-D                             (empty)
packages/ui            components, palettes, accessibility    (empty)
apps/web               the browser application
```

Dependencies point one way: `render → game → sim`. The simulation core must not
import from the layers above it, must not touch the DOM, and must not read the wall
clock or call `Math.random`. All three are enforced in CI rather than left to
review — see [`docs/PRODUCT.md`](docs/PRODUCT.md) §11.1.

## Documentation

- [`docs/PHYSICS.md`](docs/PHYSICS.md) — the simulation model and its validation.
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
