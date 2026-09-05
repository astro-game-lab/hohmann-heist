# D9 — Preact and `@preact/signals` for the UI shell

**Issue:** [#248](https://github.com/astro-game-lab/hohmann-heist/issues/248) ·
**Milestone:** M2 · **Outcome: Preact is a go. Signals are dropped.** · **Date:** 2026-09-05

§14.1's M2 row asks for a go/no-go on **D9**, and §16's **R11** sets the trigger: *HUD
re-render cost above 2 ms/frame → switch*. This is that measurement, and a finding about
the decision's own wording that had to be resolved before the number could mean anything.

`docs/SPIKE-M1.md` is the precedent. It decided D5 at M1 and said, explicitly, why it
could not decide D9:

> What this page does record is that it **kept Preact out of the frame loop entirely** —
> state lives in refs and mutable locals inside one effect […] So the numbers above say
> nothing about Preact's per-frame cost, because Preact has no per-frame cost here. M2's
> planner will not have that luxury.

M2's planner, execution and HUD are merged and deployed. The luxury is gone.

## The finding that comes first: signals were never adopted

D9 names two things — Preact, and `@preact/signals` — and makes one claim about the
second: *"fine-grained signals suit a HUD updating at 60 Hz without re-rendering panels."*

**`@preact/signals` is imported nowhere in this repository.** It is a declared dependency
of `apps/web` at `^2.0.0`, resolved to 2.11.1 and installed at 280 KB, and:

```
$ grep -rn '@preact/signals\|useSignal\|signal(' --include='*.ts' --include='*.tsx' apps packages
(no matches)

$ grep -c '@preact/signals\|signals-core\|useSignal' apps/web/dist/assets/index-BFenMzu5.js
0
```

It is tree-shaken out of the bundle because nothing reaches it. The 289 KB of shipped
JavaScript contains none of it.

What the slice actually built is the opposite of the claim. `apps/web/src/execution/store.ts`
holds the run in `useState` at the top of the screen and calls `setState` **on every
animation frame**, so the whole execution subtree re-renders at 60 Hz. `planner/store.ts`
is the same shape. There are no signals and there is no fine-grained subscription; there
is one state object at the root and a full diff per frame.

So the claim as written is not merely unproven — it is **unfalsifiable as built**, because
the mechanism it is about was never used. Measuring the app and reporting the result as
"signals work" would be asserting something the code does not do. That is the same error
`docs/PHYSICS.md` exists to prevent, in a different table.

The decision therefore splits, and both halves are answered below.

## What was measured

The **HUD updating during execution at 60 Hz** — #248's criterion, and the case D9's claim
is about.

| | |
|---|---|
| Build | production, `pnpm --filter @hh/web preview`, entry `index-BFenMzu5.js` |
| Browser | headless Chromium via the Playwright MCP server, `devicePixelRatio` 1 |
| Machine | the development machine (WSL2). **Not a reference device** — #205 and #206 remain open |
| Viewport | 956 × 478 canvas |
| Contract | `c03-cold-open`, one prograde burn, run to the horizon |
| Timer | **5 µs** resolution, `crossOriginIsolated` true |

The timer matters and is checked rather than assumed: `performance.now()` is coarsened to
100 µs unless the page is cross-origin isolated, which is the same order as the whole
frame here. `vite.config.ts` sets COOP and COEP on the preview server for this reason
(#238 found it the hard way). The measured resolution was 0.005 ms.

### How the probe works, and what it can and cannot see

`window.requestAnimationFrame` is wrapped so each of the app's own frame callbacks is
timed. `setState` in Preact schedules the re-render as a **microtask**, so a callback that
returns has not yet rendered; a microtask queued *after* the app's callback therefore runs
*after* Preact's diff has drained. That is the checkpoint the totals below are taken at.

An animation frame contains **more than one** rAF callback — measured at 1.58 to 1.99 of
them. The playback tick is one; Preact's own `afterPaint` flush, which runs `useEffect`
and therefore the canvas draw, is another. Summing them conflates the HUD with the
renderer, so they are reported separately:

- **tick sync** — inside the app's callback: `advance()` plus the `setState` call.
- **tick + Preact render** — the same, to the microtask checkpoint. The difference between
  the two is the diff, the commit and the DOM mutation. **This is the HUD re-render cost.**
- **effects incl. canvas** — Preact's effect flush, which is where `ExecutionView` draws.

Rasterisation and compositing are the browser's and are not in any of these numbers.

### Frame cost, in a browser

All figures in milliseconds.

| | median | p95 | worst |
|---|---:|---:|---:|
| **1× — 454 frames** | | | |
| tick sync (`advance` + `setState`) | 0.030 | 0.035 | 0.045 |
| tick + Preact render | **0.315** | 0.790 | 0.970 |
| → HUD re-render alone | **0.285** | 0.755 | 0.925 |
| effects incl. canvas draw | 0.010 | 0.015 | 0.020 |
| whole frame | 0.315 | 0.800 | 0.990 |
| frame interval | 16.665 | 16.670 | 16.670 |
| **1 000× — 514 frames** | | | |
| whole frame | 0.390 | 0.865 | 1.000 |
| **10 000× — 81 frames, run completed** | | | |
| tick sync | 0.030 | 0.045 | 0.060 |
| tick + Preact render | **0.450** | 0.975 | 1.360 |
| → HUD re-render alone | **0.420** | 0.930 | 1.300 |
| whole frame | 0.450 | 0.990 | 1.370 |
| frame interval | 16.665 | 16.670 | 16.670 |

**Dropped frames: 0**, at every speed, using #238's corrected rule — a frame counts as
dropped when its interval spans two vsync periods, not when it exceeds a nominal 16.667 ms
that a locked 60 Hz display cannot represent.

**A paused run schedules no frames at all.** The baseline collection returned zero
callbacks over four seconds. `store.ts` installs the loop only while `status === 'playing'`,
and the measurement confirms the docstring rather than trusting it.

### Against R11's trigger

| | measured | R11 trigger | headroom |
|---|---:|---:|---:|
| HUD re-render, median, 1× | 0.285 ms | 2 ms | **7.0×** |
| HUD re-render, median, 10 000× | 0.420 ms | 2 ms | **4.8×** |
| HUD re-render, worst, 10 000× | 1.300 ms | 2 ms | **1.5×** |
| Whole frame, worst, 10 000× | 1.370 ms | 16.7 ms (NFR-011) | 12.2× |

### Which panels re-render, and which DOM actually changes

Preact re-renders the **whole execution subtree** every frame — there is one state object
at the root and no memoisation boundary below it. What reaches the DOM is much narrower.
Mutations observed, grouped by the nearest `data-testid`:

| Region | 1× (454 frames) | 10 000× (81 frames) |
|---|---:|---:|
| `execution-progress` | 968 | 318 |
| `execution-view` (canvas attrs) | 491 | 185 |
| `execution-met` | 8 | 106 |
| `flight-log-list` | — | 19 |
| `flight-log-announcement` | — | 11 |

So the cost above is a full-tree diff whose output is a progress bar and a clock. The
flight log — the largest and fastest-growing part of the screen — mutates only when an
entry is actually crossed, which is what keeps the number flat as the log grows.

This is the honest version of D9's claim: the panels **are** re-rendered, and Preact's
diff is cheap enough that not re-rendering them was never necessary.

## Decisions

### Preact as the UI shell: **GO**

HUD re-render costs **0.285 ms** at 1× and **0.420 ms** at 10 000×, against R11's 2 ms
trigger — a factor of five to seven. The whole frame, simulation and canvas included,
uses 8% of a 60 Hz budget at its worst. Zero frames dropped at any speed. R11 does not
fire and `preact/compat` is not needed.

**The caveat worth carrying forward:** the *worst* frame at 10 000× is 1.30 ms, which is
65% of the trigger rather than a comfortable fraction of it. The median has 5× of room and
the tail has 1.5×. M3 adds the contract board, settings, medals and a keyboard-complete
planner on top of this, and the tail is where that will show first. R11 stays live; this
decision is that the shell is right, not that the subject is closed.

### `@preact/signals`: **dropped, as unused**

Not a no-go on a mechanism that failed — a removal of one that was never adopted. The
dependency is deleted from `apps/web/package.json` in the same pull request as this
document.

Three reasons, none of them about performance:

1. **It is dead.** Nothing imports it; it is absent from the bundle. Removing it changes
   no shipped byte — verified rather than asserted: the build before and after the removal
   produces the same entry script, `index-BFenMzu5.js`, at the same 289.37 kB. A content
   hash that does not move is the strongest available statement that nothing shipped
   changed.
2. **It misdescribes the architecture.** A reader of `package.json` — or of D9 — would
   reasonably expect fine-grained subscriptions and find a root `useState` re-rendering
   the tree at 60 Hz. A dependency that implies a design the code does not have is worse
   than a missing one, because it is believed.
3. **The problem it solves does not exist here.** It was carried for a HUD that would cost
   too much to re-render whole. Re-rendering it whole costs 0.285 ms.

**If the tail becomes a problem, this is reversible in an afternoon** and the reversal is
better informed for having the measurement above: add the dependency back and put signals
at the two places the table names — the progress bar and the MET readout — rather than
across the shell. Nothing in this decision forecloses it.

D9's row in §5 is amended to say *"Preact for the UI shell"*, with the signals half
recorded as dropped and why. Amending a decision rather than quietly satisfying half of it
is the point of having them numbered.

## What is still unmeasured

- **The planner's drag path.** #248 asks for execution, and execution is what is measured.
  The planner is the other 60 Hz path and the one `docs/SPIKE-M1.md` pointed at, and two
  attempts to drive a node drag from the harness failed to move the node — both synthetic
  `PointerEvent`s and a real driver-issued mouse drag left the plan unchanged, so what
  they timed was a handler that did nothing. Those numbers are not reported, because a
  measurement of a gesture that did not happen is not a small measurement, it is a wrong
  one. #238 measured the same path with Preact deliberately outside the frame loop; what
  is missing is the planner's cost with it inside. Worth an issue if M3's planner work
  makes the tail matter.
- **Reference devices.** Development-machine figures. #205 and #206 own the reference
  laptop and phone.
- **`devicePixelRatio` above 1.** Measured at 1. The HUD is DOM and scales with layout
  rather than fill, so this affects the canvas rather than the number R11 gates on.
- **100 000×.** Not measurable as a sustained state: DEP-05's maximum finishes C03's
  21 600 s horizon in 0.216 s, or about 13 frames. The highest speed with a sustained
  60 Hz HUD to observe is 10 000×, which is what the table reports.
- **A long session.** The longest collection here is 11 seconds.

## Reproducing

```bash
pnpm build
pnpm --filter @hh/web preview --port 4180
```

Then, in a browser at `http://localhost:4180/hohmann-heist/#/contract/c03-cold-open`:
accept, add a node, set prograde to 109.1177 m/s, commit, and time the frames. The probe
is described under "How the probe works" above; it is not committed, for the reason #238
gave about its own driver script — adding Playwright to this workspace's dependencies is a
decision for whoever picks up e2e (#207), not a side effect of a measurement.

The one thing not to omit is the cross-origin isolation check. Without it every figure in
this document rounds to 0.0 or 0.1 ms.
