# M1 spike — orbit render and node drag

**Issue:** [#238](https://github.com/astro-game-lab/hohmann-heist/issues/238) ·
**Milestone:** M1 · **Outcome: D5 is a go.** · **Date:** 2026-09-03

M1's exit criterion asked for "a throwaway page [that] renders an orbit and drags one
node at 60 fps", and a go/no-go on **D5** — analytic Keplerian propagation rather than
numerical integration for the game timeline. This is that page's result.

The page is `apps/web/src/spike/`, reachable at `#/spike`. It is throwaway by
construction: everything it owns is in that one directory, and the only hooks into the
rest of the app are one `RouteName` and one `import` in `app.tsx`.

## Why it had to exist

Every performance figure in `docs/PHYSICS.md` was measured under Node, and that document
says of them:

> Rasterisation, compositing and everything else the browser does with the main thread
> are not measured and cannot be from here. […] **passing does not mean §11.9's frame
> rows are met**.

`@hh/render` had never run in a browser. `apps/web` depended only on `@hh/astro` and
`@hh/math`. So the whole performance case for D5 rested on a measurement that explicitly
disclaimed the thing D5 is about, and §16 rates the risk this covers — R1, "the planner
does not feel good" — as **Fatal**.

## What was measured

The fixture is `tools/bench/frame.bench.test.ts`'s, constant for constant: a 400 km
circular orbit at ISS inclination, a 14 h horizon, eight nodes at 1800 s spacing, each a
25 m/s prograde burn, 1280 × 720, `scale = height / (3 × 6 778 137)`. `apps/web/src/spike/scenario.ts`
asserts those constants against the benchmark's so the two cannot drift apart silently.

Only the camera's **centre** differs — the benchmark centres on the ship, which is fine
when nothing is drawn and puts a third of the orbit off-screen when something is.
Translating a camera changes no cost: `projectInto` subtracts the centre before scaling.

Nine conics, 576 vertices per frame. 900 frames per run, statistics over the last 600.
The drag is synthetic — a fixed pointer displacement per frame — because a human cannot
produce a repeatable drag and a driver dispatching real pointer events measures the
driver. Every frame changes the plan, so no frame is served entirely from cache.

**Machine:** the development machine (WSL2), Chromium 1234 headless, `devicePixelRatio` 1.
Not a reference device — §11.9's reference-device rows remain open, and are #205 and #206.

### Frame time, in a browser

All figures in milliseconds.

| | median | p95 | worst |
|---|---:|---:|---:|
| **Idle** — 9 conics, all cached | | | |
| re-evaluate (`withPlan`) | 0.000 | 0.000 | 0.005 |
| geometry + scene | 0.035 | 0.045 | 0.065 |
| draw (Canvas 2-D) | 0.055 | 0.070 | 0.120 |
| **whole rAF callback** | **0.095** | 0.115 | 0.160 |
| frame interval | 16.665 | 16.810 | 16.865 |
| **Dragging** — one node, every frame | | | |
| re-evaluate (`withPlan`) | 0.045 | 0.060 | 0.125 |
| geometry + scene | 0.060 | 0.085 | 0.205 |
| draw (Canvas 2-D) | 0.055 | 0.070 | 0.115 |
| **whole rAF callback** | **0.165** | 0.215 | 0.435 |
| frame interval | 16.665 | 16.810 | 16.905 |

**Dropped frames: 0 of 600, in both modes.** A frame counts as dropped when its interval
spans two vsync periods (see below).

### Against the budgets

| | measured | §11.9 target | NFR-011 hard limit | margin |
|---|---:|---:|---:|---:|
| Idle frame | 0.095 ms | 4 ms | 16.7 ms | **42× / 176×** |
| Drag frame | 0.165 ms | 8 ms | 16.7 ms | **48× / 101×** |

### Against Node, which is the point

Same commit, same machine, same fixture, measured minutes apart:

| | Node (`frame.bench.test.ts`) | Browser (sim + geometry) | Browser (whole callback) |
|---|---:|---:|---:|
| Idle | 0.0102 ms | 0.035 ms | 0.095 ms |
| Dragging | 0.0508 ms | 0.105 ms | 0.165 ms |

Two things the browser adds, both previously unmeasured:

- **Scene construction, ~2×.** The Node benchmark stops at `projectInto` — it counts
  vertices into a `Float32Array` and never builds a primitive. A real frame allocates
  576 `ScreenPoint` objects and ten `Primitive`s, and that is the bulk of the gap.
- **Rasterisation, 0.055 ms flat.** The number `docs/PHYSICS.md` said could not be
  obtained from Node. It is essentially constant between idle and dragging, which is
  what you would expect: the same nine polylines are stroked either way.

The headline is that the Node figures were **optimistic by about 3×** and it does not
matter in the slightest, because the budget is 100× away.

## Decisions

### D5 — analytic Keplerian propagation: **GO**

Re-evaluating an eight-node plan through `withPlan` costs **0.045 ms** in a browser, on
every frame of a continuous drag. NFR-011's frame is 16.7 ms. Propagation is using
**0.27%** of it, and the whole frame — simulation, geometry, scene, rasterisation —
is using 1%.

A3 assumed analytic propagation would be fast enough and named the fallback if not: a
fixed-step integrator with a state cache, at the cost of "scrub anywhere instantly".
The assumption holds with three orders of margin on the propagation slice. The fallback
is not needed and the property it would have cost is kept.

### D9 — Preact + signals: **not decided here, by design**

Deliberately no evidence either way, and that is the honest outcome. #239 moved this
decision to M2 exit because D9's claim is about "a HUD updating at 60 Hz without
re-rendering panels", and there is no HUD at M1 to judge it on.

What this page does record is that it **kept Preact out of the frame loop entirely** —
state lives in refs and mutable locals inside one effect, and the component re-renders
about five times a second only to repaint a readout. So the numbers above say nothing
about Preact's per-frame cost, because Preact has no per-frame cost here. M2's planner
will not have that luxury, and that is exactly why R11 sets the trigger at "HUD
re-render cost above 2 ms/frame".

## Findings that are not about speed

### A 45 m/s drag moves the trajectory 5.5 pixels

The drag sweeps the last burn from 5 to 50 m/s — nearly a fifth of a LEO→GEO departure
burn. The drawn trajectory's apoapsis moves from **252.83 px to 258.29 px**: a range of
**5.455 px** at §11.9's zoom. Asserted in `scene.test.ts` so this document stays true.

This is not a renderer defect. It is what 45 m/s *is* at LEO with three orbit radii
across the viewport, and no amount of tessellation changes it. But it means **the orbit
view alone cannot show a player the effect of a Δv edit**, which is a real constraint on
M2's planner:

- The numeric readouts (#131) and the node editor's live deltas (#137) are not a
  convenience next to the orbit view — at LEO they carry the feedback the orbit view
  cannot.
- Auto-framing (#103) will not rescue this: framing the union of nine nearly-coincident
  conics barely changes the zoom.
- It strengthens the case for the closest-approach block (#132) as the primary readout
  during fine adjustment, since separation changes are legible when radius changes are not.

R1 is about whether the planner *feels* good. The frame budget says the interaction will
be smooth. This says smoothness will not be sufficient on its own.

### The dropped-frame metric was wrong before it was right

The first run reported **57% dropped frames** on a page whose intervals were 16.7–16.9 ms
— a locked 60 Hz with nothing missed. The threshold was `interval > 1000/60`, and a
display delivering a perfect 16.667 ms measures 16.7 ms, because the nominal period is
not representable and vsync jitters.

The metric now counts a frame as dropped when its interval spans **two** vsync periods,
with half a period of slack separating "jittered" from "missed". `metrics.test.ts`
carries the regression test with the real numbers in it. Recorded here because the wrong
version would have fired R1's stop-and-re-plan trigger on a page that was working
perfectly.

### `performance.now()` is coarsened to 100 µs unless the page is cross-origin isolated

The second run came back with every per-stage median sitting on exactly 0.0 or 0.1 ms.
That is Chromium's Spectre mitigation, and 100 µs is the same order as this page's entire
frame — the timer was being measured, not the code. `vite.config.ts` now sets COOP and
COEP on the **preview server only**, restoring 5 µs resolution. The built output carries
no headers of its own and GitHub Pages sets none, so nothing about the deployed site
changes. Anything that measures sub-millisecond work in a browser from here on needs this.

## What is still unmeasured

- **Reference devices.** These are development-machine figures. §11.9's rows are met on
  this hardware and remain open on the reference laptop and phone — #205 and #206.
  (`docs/PHYSICS.md` previously pointed those at #188 and #189, which are the PWA and
  daily-generator issues; corrected in this PR.)
- **`devicePixelRatio` above 1.** Measured at 1. Rasterisation scales with backing-store
  pixels, so a 2× display does up to 4× the fill. Draw is 0.055 ms, so there is room, but
  it is not measured. #115 owns DPR.
- **A real pointer.** The drag is synthetic. Event dispatch, coalescing and hit-testing
  are not in these numbers; #114 owns hit-testing.
- **Larger plans.** Eight nodes, per §11.9. §13.3's maximum is twelve.
- **Sustained sessions.** 900 frames is 15 seconds. Nothing here says what an hour does
  to the tessellation cache or the heap.

## Reproducing

```bash
pnpm --filter @hh/web build
pnpm --filter @hh/web preview --port 4180
# then, in a browser:
#   http://localhost:4180/hohmann-heist/#/spike               — drag the node by hand
#   http://localhost:4180/hohmann-heist/#/spike?auto=900      — synthetic drag, 900 frames
#   http://localhost:4180/hohmann-heist/#/spike?auto=900&drag=0  — the idle row
```

Auto mode parks its result on `window.__spikeResults` when the run finishes, which is
what a driver reads. The measurements above were taken with a headless Chromium driven
by a short Playwright script; the script is not committed, because adding Playwright to
this repo's dependencies is a decision for whoever picks up e2e (#207), not a side effect
of a spike.

## When to delete this

When M2's planner can render an orbit and drag a node. `rm -r apps/web/src/spike/`, drop
the `spike` route from `router.ts`, drop the two lines in `app.tsx`, and drop the
`preview.headers` block from `vite.config.ts` unless something still needs high-resolution
timers. Keep this document — the decision it records outlives the page that produced it.
