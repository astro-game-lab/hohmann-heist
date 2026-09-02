# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Hohmann Heist** — Steal things in orbit. A browser puzzle game where the only weapon is real orbital mechanics.

An [astro-game-lab](https://github.com/astro-game-lab) game. The org builds games where orbits are propagated rather than animated, and where the simulation is expected to agree with a textbook.

**Status: M0 of eight — the foundations, not the game.** There is nothing playable. `@hh/math`, `@hh/astro`, `@hh/propagation` and `@hh/render` hold real code; `sim`, `game` and `ui` are empty placeholders; `apps/web` is a routing skeleton with no screens. `README.md` describes what exists at any given time and is kept honest — trust it over any assumption about what has landed.

## The three documents

Read these before changing anything in the simulation. They are contracts, not background.

| Document | What it is | When it binds you |
| --- | --- | --- |
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | The ~2 800-line product definition. Numbered requirements (FR-/NFR-), architecture (§11.1), package responsibilities (§11.2), determinism spec (§11.4), the validation plan (§7.6), and the seed backlog every issue traces back to. | Any issue citing an FR- or NFR- number, or a `§`. Look it up rather than inferring it from the issue title. |
| [`docs/PHYSICS.md`](docs/PHYSICS.md) | What the simulation claims and how each claim was checked. Every row that has no test names the issue that will provide it. | **Every physics change updates it in the same PR.** A new solver adds its validation row; a changed convention corrects the prose. |
| [`docs/DESIGN.md`](docs/DESIGN.md) | The short version of what the game is, for someone who has not read the product definition. | Game-layer and UI work. |

Two rules about these documents that are easy to get wrong:

- **`docs/PRODUCT.md` is not a test oracle.** Its Appendix A reference calculations and its §6.8 par values were computed *from* the constants and exist to be checked. Never copy a number out of it into a test — §7.6's process rule is explicit, and it is how a wrong `R_GEO` was caught. Re-derive the value, or cite an independent source.
- **A validation table that implies coverage it does not have is worse than no table.** If a check does not exist, the row says so and names its issue. Do not mark a row green because the code "obviously" works.

## Architecture

The simulation core is **engine-agnostic and side-effect free**. No DOM, no renderer, no timers, no I/O, no ambient randomness. It runs under the test runner unchanged, and would run unchanged in a Worker. This is what makes the game deterministic and the physics testable, and it is the most important structural rule in the repo.

A pnpm workspace: seven packages under one application.

```
apps/web               Vite + Preact, hash routing, composition only
  ├── @hh/render       canvas 2-D, camera, orbit tessellation
  ├── @hh/ui           Preact components, palettes, a11y       (empty)
  └── @hh/game         rules, scenarios, scoring, every DEP-xx (empty)
        └── @hh/sim    plan, timeline, world state, events     (empty)
              ├── @hh/propagation   universal-variable propagation, arcs, DOP853 oracle
              ├── @hh/astro         constants, time, frames, elements, Kepler, Lambert
              └── @hh/math          vec3, mat3, angles, root finders, branded units, PCG32
```

Dependencies point one way. `math`, `astro`, `propagation` and `sim` are the **core**: they may never import from `game`, `render`, `ui`, `apps/*` or `services/*`, and the core is itself a strict stack — `astro` may reach `math`, `sim` may reach all three below it, and nothing reaches upward. See `docs/PRODUCT.md` §11.1 and §11.2 for what each package owns and, more usefully, what it must never contain.

**This is enforced, not reviewed.** Four mechanisms, all of which have been verified by deliberate violation:

- `dependency-cruiser` (`pnpm layering`) catches an illegal dependency even when it has been declared in `package.json`, and catches a deep relative import that sidesteps the package boundary.
- A scoped ESLint block bans `document`, `window`, `process`, `fetch`, `performance` and friends in `packages/{math,astro,propagation,sim,game}`, along with `Math.random`, `Date.now`, `new Date()` and `Math.acos`.
- The core packages compile without TypeScript's DOM library, so a stray `document` is a type error before it is a lint error — and so is a `CanvasRenderingContext2D`, which the lint rule's list of global names would miss. `apps/web` and `@hh/render` get their own tsconfigs; `pnpm typecheck` runs all three, and the guardrail suite checks both halves of the split by deliberate violation.
- Only `packages/render/src/canvas2d.ts` genuinely needs a DOM, and it is reachable only through the `@hh/render/canvas2d` subpath. The package's own barrel stays DOM-free — the camera and the tessellator are plain geometry — which is what keeps them testable under Node and measurable from `tools/bench`. That is enforced too: the benchmark imports `@hh/render` and lives inside the no-DOM root project.

If a guardrail is in your way, that is the guardrail working. Do not widen it — say why the code needs the exception.

## Simulation conventions

The org defaults, as this repo actually implements them. `docs/PHYSICS.md` § Conventions is authoritative; there are currently no deviations from the org defaults.

- **SI units everywhere in the core** — metres, seconds, kilograms, radians. Never kilometres or degrees inside the simulation; convert at the UI and file-format boundary. `@hh/math` brands them with a `unique symbol`, so `Metres` and `MetresPerSec` are distinct to the compiler and cannot be forged by an object literal. Brands are load-bearing at API boundaries and unwrapped inside a formula — full branded arithmetic makes vis-viva unreadable, and a convention people bypass is worse than none.
- **Frames are part of the value.** `EciVector<Metres>`, `PqwVector`, `RtnVector`, branded the same way. Handing a perifocal vector to something expecting an inertial one does not compile. ECI is J2000-aligned and is the default.
- **Time** is TAI seconds past J2000 as a float64 scalar, branded apart from a plain duration and from mission elapsed time. Leap seconds are deliberately absent and calendar output is labelled **TAI**, not UTC.
- **Angles normalise to `[0, 2π)`**, everywhere, without exception, and every function returning one normalises before returning. Hyperbolic anomaly is the one exception, because it is not periodic.
- **`atan2`, never `acos`.** Lint-enforced (NFR-006), including a destructured or locally imported `acos`. `acos` on a dot product cannot recover the quadrant and loses most of its significant digits for nearly-parallel vectors, which is exactly the case that matters.
- **Singularities at e = 0 and sin i = 0 are the common case**, not an edge case — every v1.0 contract is equatorial-equivalent. They are handled by a stated convention that reports which convention it applied, never by returning `NaN`. Note the equatorial test is on **`sin i`**, so it catches retrograde equatorial orbits too. The equinoctial set is what elements feeding logic use internally.
- **Non-convergence is a return value, never an exception and never a plausible wrong answer.** `RootResult` in `@hh/math` and `KeplerResult` in `@hh/astro` set the pattern: a discriminated union with `converged`, and a `best` estimate for diagnostics that is explicitly not a root. New solvers follow it. A quietly wrong anomaly becomes a trajectory that misses by kilometres with nothing pointing back at the cause.
- **Float64** for simulation state; float32 only in the renderer.
- **Prefer the better-conditioned formulation, and say why in the module docstring.** The element set is built on the semi-latus rectum rather than the semi-major axis because `a` is infinite at `e = 1` and FR-002 asks for the parabolic case. True anomaly is recovered without the eccentricity vector because that vector's direction is the first casualty of cancellation at low `e`.

## Determinism

Same seed plus same inputs must produce the same trajectory. Replays, shared scenarios, and reproducible bug reports depend on it. `docs/PRODUCT.md` §11.4 is the precise specification — read it before writing anything that could introduce a source of variation.

- All randomness comes from the seeded PCG32 in `@hh/math`, explicitly threaded. Never the global random.
- No wall-clock reads in the core. No iteration over unordered containers where order affects the result.
- Solvers iterate to a **fixed absolute tolerance with a fixed iteration cap**, so the result is tolerance-bounded rather than iteration-dependent.
- **Bit-identical cross-runtime results are not claimed, and must not be.** `Math.sin` and friends are not required to be correctly rounded and do differ between engines. Determinism comes from quantised inputs (DEP-09) and tolerance-band scoring, not from float equality.

## The honesty rule

Simplifications that exist to make the game fun — infinite fuel, snapped orbits, forgiving docking, time acceleration — live in the game layer, behind a clear boundary, and are listed as a numbered **DEP-xx** row in the gameplay-departures table in `docs/PHYSICS.md`. They never get baked into the simulation core, and the import direction that makes that true is enforced in CI.

When asked to make something "feel better" or "be more forgiving", implement it in the game layer and add the row. If that is not possible, say so rather than quietly adjusting the physics.

## Testing

Physics code is tested against something independent, not against itself.

- Assert against a closed form, a published worked example, or an independent tool (GMAT, JPL Horizons, `poliastro`/`astropy`).
- Put the expected value **and its source** in the test — edition, section and page for a book.
- **Every textbook citation is verified against the physical book by the person writing the test.** This is §7.6's process rule and it is not a formality. If you cannot verify a printed value, say so and leave the row pending rather than asserting a number you took on trust.
- Add or update the row in the validation table in `docs/PHYSICS.md`, in the same PR.
- Test the degenerate cases that apply: circular, equatorial, both together, retrograde, hyperbolic, near-parabolic.
- Property tests earn their keep here. `fast-check`'s seed is deliberately **not** pinned — the exploration is what found a real bisection bug on its first run.
- **State the reason for a tolerance, and set it to the measured limit.** Do not tune one until the suite goes green. `1e-3` against Curtis is the book's printed precision; a `1.4e-5 s` time tolerance is the float64 resolution of a Julian Date near 2451545. Both say so in the test.

Do not loosen a tolerance to make a failing test pass without understanding why it drifted. A test that starts failing after a refactor is usually right.

### Commands

| Task | Command |
| --- | --- |
| Typecheck | `pnpm typecheck` — all three projects |
| Lint | `pnpm lint` — `pnpm lint:fix` to apply |
| Layering rule | `pnpm layering` |
| Format | `pnpm format:check` — `pnpm format` to apply |
| Test | `pnpm test` — the packages, and fast |
| Test everything | `pnpm test:all` — adds the app and the guardrail suite |
| Coverage | `pnpm coverage` — gated at 90% statements in the core |
| Bundle size | `pnpm size` |

CI runs all of these on every pull request. Run them before proposing changes; `pnpm test:all` is the one that matches CI.

## Conventions

- Commit subjects are `area: what changed`, imperative, under 72 characters — `astro:`, `math:`, `infra:`, `docs:`, `physics:`.
- **The commit body carries the reasoning, and it is expected to be substantial.** Say why the approach was chosen, what was rejected and on what grounds, what the work uncovered, and what was measured rather than assumed. Read `git log` before writing one. `Closes #N` lines go at the end, one per issue.
- Keep the diff focused; unrelated changes belong in a separate PR.
- Third-party assets and data go in `ATTRIBUTIONS.md` in the same commit that adds them.
- Notable changes — physics-model changes especially — go in `CHANGELOG.md`.

## Attribution — DO NOT ADD

**Never add Claude attribution to any commit message, PR title, PR description, or issue/PR comment.** No `Co-Authored-By: Claude` trailers, no "Generated with Claude Code" footers, no `Claude-Session:` lines, no mention of Claude, Anthropic, an AI assistant, or an LLM as author or generator.

Commits and PRs should read as if authored entirely by the human user. No exceptions — if the user wants attribution, they will add it themselves.
