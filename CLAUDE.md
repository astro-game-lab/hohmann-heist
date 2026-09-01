# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**__GAME_NAME__** — __GAME_DESC__

An [astro-game-lab](https://github.com/astro-game-lab) game. The org builds games where orbits are propagated rather than animated, and where the simulation is expected to agree with a textbook. Read [`docs/PHYSICS.md`](docs/PHYSICS.md) before touching anything in the simulation — it states what this game's model claims and how those claims were validated.

> This repo was started from `astro-game-lab/.repo-template`. Until the toolchain and layout are settled, keep this file honest: describe what the repo actually does, not what the template assumed. Delete this note once it is real.

## Architecture

The simulation core is **engine-agnostic and side-effect free**. No DOM, no renderer, no timers, no I/O, no ambient randomness. It runs under the test runner unchanged. This is what makes the game deterministic and the physics testable, and it is the most important structural rule in the repo.

The intended split, adapted to whatever the stack calls things:

- **sim** — the physics core. Units, frames, seeded RNG, propagation, world state.
- **game** — rules, scenarios, and **every deliberate departure from the physics**.
- **render** — presentation. Reads simulation state; never owns or mutates it.

Dependencies point one way: render → game → sim. The core never imports from the layers above it.

## Simulation conventions

The org defaults. Any deviation gets documented in `docs/PHYSICS.md`.

- **SI units everywhere in the core** — metres, seconds, kilograms, radians. Never kilometres or degrees inside the simulation; convert at the UI and file-format boundary. Carry the unit in the name where there is any doubt (`alt_m`, `period_s`, `raan_rad`).
- **Frames are part of the value.** Never pass a bare position or velocity vector. Encode the frame in the type or the name (`r_eci_m`, `v_ecef_mps`). J2000-aligned ECI is the default inertial frame.
- **Time** is a scalar offset from a defined epoch in a stated scale — not UTC, which is not uniform. Simulation time never comes from the wall clock.
- **Angles** use `atan2`, never `acos` on a dot product where quadrant matters. Pick one normalization convention, state it in `docs/PHYSICS.md`, and apply it consistently.
- **Singularities** at zero eccentricity and zero inclination are the common case in games, not an edge case. Handle them by an explicit stated convention, and test them.
- **Float64** for simulation state; float32 only in the renderer.

## Determinism

Same seed plus same inputs must produce the same trajectory, on every platform. Replays, shared scenarios, and reproducible bug reports depend on it.

- All randomness comes from an explicitly seeded generator threaded through the code. Never the language's global random.
- Physics runs on a fixed timestep with an accumulator, decoupled from the render frame rate.
- No wall-clock reads inside the simulation. No iteration over unordered containers where order affects the result.

## The honesty rule

Simplifications that exist to make the game fun — infinite fuel, snapped orbits, forgiving docking, time acceleration — live in the game layer, behind a clear boundary, and are listed in the gameplay-departures table in `docs/PHYSICS.md`. They never get baked into the simulation core.

When asked to make something "feel better" or "be more forgiving", implement it in the game layer and add the row to that table. If that is not possible, say so rather than quietly adjusting the physics.

## Testing

Physics code is tested against something independent, not against itself.

- Assert against a closed form, a published worked example, or an independent tool (GMAT, JPL Horizons, `poliastro`/`astropy`).
- Put the expected value **and its source** in the test.
- Add the row to the validation table in `docs/PHYSICS.md`.
- Test the degenerate cases that apply: circular, equatorial, hyperbolic, near-parabolic.
- Property tests earn their keep here — element round-trips, conservation of energy and angular momentum over a closed orbit, solver convergence across the eccentricity range.

Do not loosen a tolerance to make a failing test pass without understanding why it drifted. A test that starts failing after a refactor is usually right.

## Conventions

- Run the repo's lint, typecheck, and test steps before proposing changes.
- Commit messages in the imperative mood, subject under 72 characters.
- Keep the diff minimal and focused; unrelated changes belong in a separate PR.
- Third-party assets and data go in `ATTRIBUTIONS.md` in the same commit that adds them.

## Attribution — DO NOT ADD

**Never add Claude attribution to any commit message, PR title, PR description, or issue/PR comment.** No `Co-Authored-By: Claude` trailers, no "Generated with Claude Code" footers, no `Claude-Session:` lines, no mention of Claude, Anthropic, an AI assistant, or an LLM as author or generator.

Commits and PRs should read as if authored entirely by the human user. No exceptions — if the user wants attribution, they will add it themselves.
