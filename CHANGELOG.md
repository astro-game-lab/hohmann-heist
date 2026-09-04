# Changelog

All notable changes to Hohmann Heist are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Changes to the physics model get their own note under **Physics**, with a pointer to
the `docs/PHYSICS.md` revision — players and contributors need to know when a number
they relied on has moved.

## [Unreleased]

### Added
- **The planner (#103, #123, #127, #128, #130, #131, #132, #143).** §8.3.4's five regions — HUD
  bar, timeline, plan panel, readouts and assist tray — around the orbit view, in one component
  tree at every width. The wide arrangement is a grid and the narrow one a tab strip, but the
  panels are the *same instances* at both, so rotating a phone cannot unmount them and take the
  plan, the selection or the scrub position with it. The timeline sits outside the tab strip in
  both, as §8.3.4 requires.
- **§8.5.1's state machine, with illegal transitions that do not compile (#143).** One function
  per edge, each taking the states that edge legally leaves, so `releaseDrag(IDLE)` is a type
  error rather than a run-time no-op. COMMITTED is reachable only with a `Legality` the caller has
  narrowed to `commitAllowed: true`, which makes §6.4's gate the reason the call compiles rather
  than a condition inside it. SCRUBBING is orthogonal — a field, not a phase — and `scrubTo`
  returns the same `plan` object it was handed, so FR-403's "never mutates the plan" is asserted
  by reference identity.
- **Auto-framing driven from application state (#103).** Manual pan or zoom suspends it until the
  ⌖ recentre, the ease runs against the caller's clock over `REFRAME_DURATION_SECONDS` with a long
  frame landing exactly on the target rather than overshooting, and `prefers-reduced-motion`
  collapses it to one frame. The union is assembled per frame from the real content — every
  tessellated arc, the target orbit and Earth's disc — rather than from a fixture.
- **DEP-07 — node snapping to the nearest apsis within 30 s**, in `@hh/game/snap`, disableable
  from the assist tray. Its `docs/PHYSICS.md` row moves from planned to implemented and records
  that the node-crossing half is deliberately absent: every v1.0 contract is equatorial-equivalent,
  so the line of nodes is undefined.

### Removed
- **The M1 spike page (`apps/web/src/spike/`, #238)** and its route, nav entry, catalogue key and
  ESLint exemption. It existed to prove a node could be dragged at 60 fps before there was a
  planner to drag one in; the planner is that, so keeping it would be keeping the prototype after
  the product. Its measurement — a 45 m/s Δv edit moves the drawn trajectory 5.455 px at LEO —
  is what the readouts and the node editor exist to carry, and it survives in `docs/SPIKE-M1.md`.

- **The application shell, the contract briefing, and the save (#117, #120, #183).** Hash routing
  over §8.2's whole table, with a screen frame that moves focus to the new heading on every route
  change — a hash change replaces the document body and leaves focus on a link that no longer
  exists, which strands a keyboard user silently — and a §9.4 entry transition that collapses to
  0 ms under `prefers-reduced-motion`. An unknown hash renders a not-found screen rather than a
  blank one. The seven routes whose screens are other issues render a placeholder inside the real
  frame, each showing its own heading and captured segment, so a deep link is checkable before the
  screen that consumes it exists.
- **The briefing (§8.3.3)** — the first screen that renders real content. Contract number and
  title, client and fee, the brief from its catalogue key, objective, Δv budget, deadline and par
  (**always shown**, D12), a row per §6.5 constraint, and the ship and target setup lines, all read
  out of the contract's own JSON. Numbers arrive in SI and leave in display units through the
  catalogue rather than through the component, because metres-to-kilometres is a locale decision as
  much as a unit one; §8.3.3's SI tooltip is a `title` **and** a visually-hidden span, since a
  `title` is invisible to touch and unreliable to a screen reader. ACCEPT is bound to `Enter` on the
  document, because focus is on the heading when the route change hands it over. Contracts are
  bundled and parsed at load, never fetched — that is what makes "no loading screen" true rather
  than asserted.
- **Versioned save data (FR-701, FR-703, §11.7).** One `localStorage` key, one JSON document, an
  explicit migration chain of pure functions, and export/import that round-trips byte-identically
  through a canonical form. A save from a newer build is **refused before it is read** and left
  untouched: reading the fields we recognise and ignoring the rest is how a v2 save comes back as a
  v1 save with no medals and then gets written back that way. Corrupt data is reported with its
  bytes intact, quota-exceeded is a returned outcome rather than an exception, and every load hands
  back a usable save so the game stays playable when storage does not work (FR-702).
- **`clientKey` and `fee_kcr` on the scenario schema**, both optional, so §8.3.3's client and fee
  lines have something to render. `clientKey` is a catalogue key for the same reason `briefKey` is
  one — "withheld" is prose — and §13.4's brief-keys check now covers it, so a contract naming a
  client nobody wrote fails the content suite.
- **The orbit scene (#106–#111, #113–#115, #177, §9.3).** Everything the planner draws.
  Earth to scale with Natural Earth 1:110 m coastlines and a terminator derived from a Sun vector
  the game layer supplies; hazard shells that serve both the 100 km floor and §6.5's no-fly annulus
  through one mechanism; the three trajectory styles as **three dash patterns, not three colours**;
  ship and target markers with fading trails; maneuver nodes with a two-axis handle cross on the
  RTN basis; and apsis ticks and a closest-approach tie line. **No text is drawn on the canvas** —
  a DOM label layer positioned by `transform` holds every string, and every string resolves through
  `@hh/ui`'s catalogue. Plus a pure hit-test index with 32 **CSS**-pixel targets and a documented
  priority order, and `devicePixelRatio` handling capped at 2 that survives a move between displays.
- **The planned trajectory's dots are spaced by equal *time*, and that is asserted.** §9.3 asks for
  it because the density then shows the speed — sparse at periapsis, dense at apoapsis — and a dash
  array cannot express it, since `setLineDash` spaces marks by arc length and knows nothing about
  the body traversing the path. The test measures the ratio of dot spacing at periapsis to apoapsis
  against vis-viva's `(1+e)/(1-e)` at three eccentricities, with a circular orbit as the control.
- **Natural Earth coastline data and its processing script (#177, §9.6).** `pnpm coastlines:write`
  fetches the pinned upstream release, verifies its SHA-256, reads the shapefile directly rather
  than trusting a third party's GeoJSON re-encoding, simplifies on the sphere, and writes
  delta-encoded rings. Reproducible: the same input gives a byte-identical output.
- **`#/scene`, a development harness** that draws the full scene against the real `c03-cold-open`
  contract. Throwaway, on the same terms as the M1 spike, and the place the renderer's visual
  claims — the DPR cap, greyscale distinguishability, Earth overflowing the viewport — are actually
  checked rather than asserted.

### Changed
- **§11.7's ~15 kB figure covers the campaign, not the dailies.** A completed 18-contract campaign
  measures 8 729 bytes, comfortably inside it, and eighteen 300-character replay codes are 5 400 of
  those — so replay length is the number to watch, not the field count. A year of daily results is
  **18 728 bytes on its own**, more than twice the campaign and past the stated budget with no
  contracts at all. Nothing is done about it here; the test records it so that #163 and M7 decide
  whether to prune with the number in front of them.
- **The save's `daily` record is `{ days, streak }`**, where §11.7's sketch puts `"streak"` in among
  the dates. A map whose values are either a result or a number has no useful type and forces every
  reader to narrow, and `"streak"` is a legal key in the same namespace as the dates. §11.7 is a
  jsonc illustration rather than a schema — its `settings` is a comment — and this is the one place
  taking it literally would cost something permanent.
- **`@hh/render` joins the NFR-022 coverage gate**, its stated condition ("once it holds code and
  has a browser-environment testing story") now being met. A `render-dom` Vitest project runs
  `*.dom.test.ts` under jsdom; the rest of the package stays under Node, deliberately.
- **§9.6's "~15 kB" estimate for the coastline asset does not hold.** At a precision meeting §9.3's
  0.5 px screen-space standard the data is 47 kB raw and 20.3 kB gzipped delta-encoded — and 74 kB
  raw, 31 kB gzipped, as literal GeoJSON. The estimate was an estimate; this is the measurement.
  Well inside NFR-020's 400 kB budget, which the app now spends 59.7 kB of, but the product
  definition's number should be corrected rather than quietly missed.

- **The par harness (#89, §6.7, DEP-12).** `tools/pars/` computes a contract's `par_dv` and
  `par_time` rather than taking them on trust: a grid over departure epoch and time of flight, every
  Lambert branch at each point, the best of each transfer family refined by a Nelder–Mead simplex,
  and the winner then built as a real quantised `Plan` and run through the game's own timeline,
  objective evaluator and legality check — so a published par is a number the game produced from a
  plan it would let a player commit. `pnpm pars:write` writes the answer into the scenario file and
  `docs/PARS.md`; `pnpm pars:check` recomputes it in CI and fails when it has moved, the same
  arrangement `schema:check` and the goldens have. **The rounding is the tolerance:** values are
  written at DEP-09's own quanta, 1e-4 m/s and 1e-3 s, and compared exactly, because §11.4 declines
  to claim bit-identical results across engines and a tolerance bolted on top would be a second
  number to argue about. C03's search takes about a second and agrees with the closed-form
  tangential impulse to 3.1e-5 m/s — two code paths that share only the value of μ.
- **`docs/PARS.md` (§6.7, §11.5).** The derivation for every contract, generated from the solver's
  own output. §11.5 rules that a par without a reproducible derivation is not mergeable, and D12
  makes par public and beatable — which makes this a forensic document, the thing a "I beat par"
  bug report gets checked against. It states the method, the three things the method cannot do,
  the search statistics, the closed-form comparison, and how to reproduce it in one command. A
  hand-maintained version would be the first thing to fall out of date, and a stale derivation is
  worse than none.
- **`c03-cold-open`, the first shipped contract (#91, FR-204).** An `intercept`: a 400 km circular
  orbit, KESTREL-2 in an 800 km circular orbit 14° ahead, 300 m/s of budget, a three-hour deadline
  inside a six-hour horizon. Contracts live in `content/contracts/` — data at the top of the
  repository where a contributor looks for them, rather than inside the package that owns the
  *format* and no particular contract. Its brief and its coach mark are catalogue keys, not prose
  in the scenario file (D14).
- **The content test suite (#87, §13.4).** One parameterised file over `content/contracts/`, so
  **adding a contract adds seven tests for free and offers no way to avoid them** — which is what
  makes G6 safe. Solvability, par accuracy to ±0.5%, budget headroom ×1.15, deadline headroom
  ×1.10, schema validity, reachability, and every `briefKey` and `coachMarks` entry resolving.
  Each check is its own `it` inside a `describe` named for the contract, so a failure prints which
  contract and which check without anyone reading a log. Three assertions ride along that §13.4
  does not list and nothing else would catch: that a file's name equals the id inside it, that
  `par.burns` matches the reference solution (§6.7 makes Gold depend on it), and that the replay's
  own §11.6 claim agrees with the plan beside it.
- **§6.8's unlock rule, as something a test can ask questions of.** Reachability is a property of
  the whole content set, not of one file, so `tools/content/reachability.ts` walks the progression
  graph to a fixpoint — act I open from a cold start, act *k* opening on ⌈2/3⌉ of act *k*−1's
  shipped contracts, `unlocks` adding explicit edges on top. It gates on what **ships** rather than
  on §6.8's designed act sizes, because that is what the game would do and because a rule written
  against a table would be a copy of `docs/PRODUCT.md` living in code. With one contract the
  content suite's reachability row passes trivially, so the rule is exercised separately against
  sets that are supposed to fail — a check that can only pass is not a check. Progression proper is
  #82 in M3, and this moves into `@hh/game` when it lands.
- **`no-tools-in-shipped-code` (NFR-020).** Nothing under `packages/` or `apps/` may import
  anything under `tools/`. #89 requires the par harness to be a development tool that is not in the
  bundle; nothing imports it today, which is a fact about this week rather than a property of the
  repository. The guardrail suite demonstrates the rule firing, like every other layering rule here.
- **`@hh/game`'s evaluation surface (FR-106, FR-107, FR-108).** Given a timeline and a contract:
  what did the player achieve, what rules did they break, and may they commit. Objectives are
  `reach_orbit`, `intercept`, `rendezvous` and `soft_rendezvous`; `station` is a separate type and
  arrives with contract 07. Constraints are the Δv budget, the deadline and the 100 km altitude
  floor. Legality is `L1`–`L6`, with every simultaneous failure returned together rather than one
  at a time. All of it is pure computation — no DOM, no clock, no randomness — so it runs under
  Node and would run unchanged in a Worker.
- **`reach_orbit` compares the final arc, not a sample (§6.4).** A Keplerian arc has constant
  elements, so the orbit a plan leaves the spacecraft in *is* the last arc's elements, held to the
  horizon by construction. There is no sampling window in which a transient mid-plan match could be
  caught, which is what "held at the end of the plan" asks for. Which elements are compared, and at
  what tolerance, is now written down rather than implied: periapsis and apoapsis radius to 10 km,
  inclination, RAAN and argument of periapsis to 0.1°, each corresponding to about 10 km of
  position error at a LEO radius. A circular goal does not compare the apse line and an equatorial
  goal does not compare the node line — tested on the **goal**, so a plan cannot pass by being
  accidentally degenerate.
- **Proximity objectives use the closest-approach finder, never a sampling grid (#61).** Two orbits
  crossing at 1° inclination close at 134 m/s, so a 1 km intercept window is about fifteen seconds
  wide against a sample spacing of about 172 s: a sampled evaluator would step over the transfer
  and tell the player they missed it. Every local minimum is tested rather than only the global
  one, because for a rendezvous the closest pass may be the fastest one and a later, wider, slower
  pass can be the one that satisfies both limits at once.
- **Constraints return every violating interval, never a boolean (FR-107).** §6.5 draws these as
  shaded bands on the timeline, and a band needs two epochs. The altitude floor runs the
  shell-crossing finder (#62) per arc and merges intervals that abut, so one dip that spans a burn
  draws as one band. Even the Δv budget has an interval: it is exceeded from the burn that crossed
  the cap onward.
- **Scenario format v1 (FR-201, FR-202).** A JSON Schema with the TypeScript types **and the
  validator** generated from it by `pnpm schema:write` and gated by `pnpm schema:check`. Unknown
  fields are rejected rather than ignored — a typo in a contributed scenario has to be an error,
  because silence would mean the contributor's intent quietly did nothing. The loader reports every
  field-level error at once, each with a JSON pointer and a catalogue key, and checks the semantics
  a schema cannot express: an objective naming a target that is not there, a deadline past the
  horizon, a duplicate constraint, a ship starting below its own floor, and a tolerance looser than
  the departures table promises the player. Loading and validating measures **9.4 µs** against
  §11.9's 20 ms budget.
- **The validator ships as generated code, not as a runtime dependency.** Ajv compiles the schema
  ahead of time in `tools/schema/generate.mjs`; `@hh/game` keeps its zero third-party runtime
  dependencies, the bundle avoids ~35 kB gzip, and nothing calls `new Function` at load time.
- **Message catalogue (FR-910, NFR-028).** `@hh/game` emits keys and parameters; `@hh/ui` resolves
  them. A message is a **function** of its parameters and the locale's formatters rather than a
  template string, so it can put a parameter wherever the language wants it and branch on
  `Intl.PluralRules` — Polish has four plural categories and English has two. The catalogue is a
  mapped type over every declared key, so a missing message and a spare one are both compile
  errors; `tools/guardrails/catalogue.test.ts` covers the rot a type cannot see, a key nothing
  produces. A missing dynamic key — a scenario's `briefKey` — throws in development and renders a
  visible marker in production, never a blank.
- **An ESLint rule against literal text in JSX (NFR-028).** Three `no-restricted-syntax` selectors,
  no new dependency: element text, string literals in expression containers, and the attributes a
  screen reader reads out. `{' '}`, interpolated values and non-visible attributes stay legal. The
  guardrail suite demonstrates each selector firing and each legitimate construct staying silent,
  and asserts the application passes. `apps/web`'s own strings moved to the catalogue in the same
  change — a rule with an exemption for the code that was already there is a rule nobody trusts.
- **Departures registry (§7.5, NFR-005).** The gameplay-departures table now exists as data as well
  as prose, and `tools/guardrails/departures.test.ts` fails when the two disagree about which
  departures exist, which package each lives in, or which the player is told about. This closes the
  half of NFR-005 `dependency-cruiser` cannot see: a tolerance written straight into the wrong
  package needs no illegal import and looks exactly like a physical constant.
- **Golden trajectories (§7.6 Tier 4).** 31 committed plans with their evaluated states at fixed
  epochs — 326 sampled states in all — covering every conic class including exactly parabolic, the
  degenerate geometries (e = 0, i = 0, both, i = π, polar), the degenerate plan structures (empty,
  a node on the start epoch, a node on the horizon, the minimum legal spacing, a zero-Δv node,
  twelve nodes), and two plans that change conic class mid-timeline. CI fails when a value moves by
  more than 1e-9 relative. **A golden asserts that a number has not changed, never that it is
  right**; the tests it sits behind are what say it is right.
- **A golden that moves takes `docs/PHYSICS.md` with it.** §11.13 has promised this check since M0
  and nothing enforced it. `tools/goldens/physics-doc-gate.mjs` now does, on every pull request: a
  fixture file only moves when an evaluated trajectory moved, which makes it a change to the
  physics model rather than to a test fixture. The check is deliberately shallow — it asks whether
  the document is in the same diff, not whether what was written there is any good, because no
  script can check the second and pretending to would be worse than not trying.
- **In-process determinism fuzz (FR-109).** 10 000 seeded random plans per CI run, each evaluated
  twice, compared on every float a timeline holds — arc boundaries, arc states, cached elements,
  both sides of every impulse, the inertial Δv, and five `stateAt` lookups — with `Object.is`, so
  `-0` and `+0` are distinguished and the comparison is bit-level rather than numeric. §11.4
  requires same-runtime determinism to be *exact*, and a tolerance would mask exactly the bugs this
  exists to catch. A 200 000-plan soak found no difference. Cross-runtime agreement is out of scope
  and remains #73.
- **Benchmark regression gate (NFR-011, NFR-021).** The benchmarks asserted §11.9's hard limits and
  nothing else, which catches a catastrophe and misses a forty-percent regression entirely. They now
  record their measurements and `pnpm bench:check` compares them against a committed baseline. Three
  choices in the comparison were measured rather than assumed: the **minimum** over each benchmark's
  batches rather than the median (worst-case run-to-run spread 19.7% against 31.5%); a baseline
  recorded **from CI** as the per-metric median of five runs; and each metric divided by the
  **median across all twenty in the same run**, so the gate asks whether an operation got slower
  than its neighbours did. The tolerance is 30%.
- **The relative comparison exists because the runner fleet spans a factor of two.** Six CI runs of
  one identical commit executed the suite at 0.52× to 1.02× of each other's pace. Absolute
  comparison across that cannot work — the fastest host reads 48% under a baseline recorded on the
  mid-range ones — while dividing by the run's own median removes the host exactly and leaves a
  per-metric scatter that is flat across the whole range (worst upward deviation 9.7% to 14.4%).
  The known blind spot is a uniform slowdown, which divides out; §11.9's absolute hard limits still
  backstop it and the host offset is printed on every run.
- **A synthetic normalisation was tried and rejected on measurement.** Every benchmark also times a
  frozen scalar arithmetic loop and records `measurement / yardstick`, on the theory that a
  dimensionless ratio makes a baseline portable. It over-corrects across machine families (a runner
  is 1.16× slower than the development machine on real workloads but 1.45× slower on the yardstick,
  putting every normalised row a systematic 22% under its baseline) and under-corrects within the
  fleet, while adding noise of its own. Two runs with yardsticks of 364 ns and 365 ns executed the
  suite at 0.96× and 0.79×. The ratio stays in the recorded results as the evidence for the
  decision, and is not used by the gate.

- **The two §11.9 frame-time budgets are measured** for the first time — idle 0.008–0.010 ms,
  dragging a node 0.041–0.048 ms, against 4 ms and 8 ms targets. What is measured is the geometry
  pipeline owned by `@hh/sim` and `@hh/render`; rasterisation is the browser's and cannot be
  measured from Node, so **passing does not mean §11.9's frame rows are met** — that is a
  real-device pass, #188 and #189. The benchmark says so, and so does `docs/PHYSICS.md`.
- **Benchmark files no longer run in parallel.** Four benchmarks competing for the same cores while
  each tries to measure elapsed time were partly measuring the scheduler. It matters more now that
  a gate reads those numbers.
- `@hh/sim` gains the **timeline**: applying a plan to an initial state over a horizon produces
  the alternating sequence of Keplerian arcs and instantaneous impulses FR-102 describes, with
  `stateAt` evaluating it anywhere inside the horizon and `withPlan` re-evaluating it from an
  edited node onward. This is what turns a plan into a trajectory; until now `@hh/sim` held the
  plan and nothing that ran it.
- **The empty plan is not a special case.** It produces one coasting arc from the start epoch to
  the horizon because the fold never enters its loop, not because a branch checks for it. A
  structure whose degenerate case is written separately is a structure with two behaviours to
  keep in step.
- **A node epoch belongs to the arc that starts there.** Timeline arcs inherit the half-open
  `[start, end)` rule the event finders already run on, so `stateAt` at a node returns the
  **post-impulse** state and the pre-impulse one is on the impulse record. The last arc is closed
  at the horizon so the deadline itself is evaluable, and an epoch outside the horizon is rejected
  with a typed `EpochOutOfHorizonError` carrying the bounds, rather than extrapolated into a plan
  that says nothing about that time.
- **Incremental re-evaluation is the same fold entered later, not a second implementation.**
  Arc *j*'s state depends on the initial state and nodes 0 … *j*−1, so an edit at node *k* cannot
  reach anything before *k*; `withPlan` diffs on the integer counts, reuses the earlier arcs **by
  reference** — element caches and all — and restarts the same loop at *k*. Moving, inserting and
  deleting a node are therefore one path rather than three. Measured: an 8-node plan re-evaluates
  fully in 0.03–0.05 ms against §11.9's 2 ms target, a last-node drag in 0.007–0.009 ms against
  NFR-011's 16.7 ms frame, and a timeline `stateAt` in 0.8–1.4 µs against a 5 µs target.
- **The arc lookup is measured as a binary search, not asserted as one.** Timing `stateAt` would
  prove nothing — the Kepler solve costs microseconds and the search nanoseconds — so the
  benchmark times the search alone: 228× more arcs costs 4.0× more, against 3.5× for a binary
  search and 228× for a linear scan.
- `@hh/propagation` gains the **five FR-008 event finders**: apsis crossings, closest approach
  between two independently propagated bodies, altitude-shell crossings, ground-station conical
  visibility, and cylindrical umbra intervals. They ship together because the interesting part of
  each is the same three decisions — what an interval endpoint means, what tolerance a returned
  epoch carries, and what happens to a feature the search cannot resolve — and five finders written
  apart would have answered them five ways.
- **The endpoint rule is half-open, `[start, end)`.** An event exactly at the start is reported and
  one exactly at the end is not, so searching two abutting arcs and concatenating reports every
  event exactly once instead of leaving a caller to de-duplicate on a float comparison. An interval
  already in progress at a bound is returned **clipped**, flagged as such, rather than dropped —
  a pass that begins at `start` because the search began there is a different fact from one that
  begins there because the spacecraft rose.
- **Apsis and shell crossings are closed-form, not root-found.** Both issues asked for root-finding
  to a stated tolerance; on an unperturbed conic both are algebraic — periapsis *is* true anomaly
  zero, and `r = p/(1 + e cos ν) = R` solves for `ν` directly — so they are exact to round-off,
  have no convergence tolerance, and have **no floor on the shortest feature they can find**. The
  shell's inverse cosine is written as a half-angle `atan2`, which `acos` is banned for (NFR-006)
  and which stays well conditioned at both ends besides.
- **Umbra samples in true anomaly rather than in time.** The shadow condition depends only on where
  the spacecraft is, so the grid is uniform in position around the orbit; that is what makes a
  short eclipse near periapsis no harder to find than a long one near apoapsis. Refinement still
  runs in epoch, so the stated tolerance means what it says.
- `@hh/astro` gains the **ECEF frame**: `EcefVector`, `ecef`, and the body-fixed ↔ inertial
  rotation. A ground station is the one thing in this simulation that is constant in the rotating
  frame and not in the inertial one, so it is stated in the rotating one and the compiler refuses
  to let it be passed where an inertial vector belongs. The rotation takes an **angle**, not an
  epoch — converting an epoch needs a sidereal-time model, which is data with a source and an
  expiry, and a scenario states its own station angle.
- `@hh/sim` opens with the **plan side of the simulation**: `Plan` and `ManeuverNode` with
  quantisation at entry (FR-101, FR-105, DEP-09), impulsive Δv applied in RTN (FR-006), and
  canonical JSON serialisation of a plan (§11.6). A node's canonical identity is its **integer
  count** — ticks of 1/1024 s and counts of 1e-4 m/s — and its SI values are derived from those
  counts rather than from the caller's arguments, which is what makes quantisation idempotent by
  construction rather than by discipline. FR-101's "≥ 1 s apart" is an integer comparison, because
  differencing two 2026 epochs as floats loses about 1e-7 s to cancellation and a plan that
  validates on one runtime should not fail on another.
- `@hh/sim` gains **canonical JSON replay codes**: keys sorted by an explicit writer rather than
  inherited from a literal's insertion order, no whitespace, integers only, and strict parsing that
  rejects an unknown schema version, an unrecognised key or a non-integer instead of dropping it.
  Node epochs are written as mission-elapsed ticks — §11.6's own claim field is plainly MET — so the
  origin cancels exactly on the way back. A share code for an 8-node plan measures 306 bytes, or 408
  base64url characters **with no compression at all**, which is how FR-607's 512-character budget is
  asserted: deflate is headroom, not an assumption the budget rests on.
- `@hh/render` gains the **`Renderer` seam and a Canvas 2-D implementation**. The interface takes a
  whole `Scene` bucketed by layer rather than a stream of drawing calls, so §11.8's draw order lives
  in the package as a constant instead of emerging from the order a caller happens to make its
  calls. There is no text primitive at all — that is what keeps labels in the DOM (D8) rather than
  leaving it to review — and the backing store is capped at 2x for battery.
- `@hh/render` gains an **orthographic camera**: pan and zoom as pure state transforms with no
  canvas anywhere, auto-framing of the ship ∪ target ∪ plan ∪ Earth union with a 12% margin, the
  20% re-frame rule, and manual zoom clamped to [0.5x, 40x] of the auto-frame scale. Scale is
  linear, per §8.4. The world-to-camera transform runs in float64 and `projectInto` is the only
  float32 in the package (NFR-010) — a test asserts that narrowing the world coordinate first
  loses more than a pixel of a 100 m detail at 1e8 m, which is the failure the rule exists to
  prevent.
- `@hh/render` gains **orbit tessellation with adaptive subdivision**, sampled in eccentric
  anomaly for an ellipse, hyperbolic anomaly for a hyperbola, and Barker's `D` inside a band around
  `e = 1`, refined until the screen-space sagitta is under 0.5 px and capped at 512 vertices. The
  cache is keyed by (elements, scale bucket) and the bucket rounds *up*, so a reused tessellation is
  never coarser than the scale it is drawn at. True anomaly is not in the key — scrubbing the
  timeline does not change the path — and neither is the camera basis or centre, so panning and
  rotating cost nothing. Measured at 0.009–0.09 ms per orbit against §11.9's 0.5 ms target, and
  0.0006 ms on a cache hit.
- **A benchmark for §11.9's orbit-tessellation budget**, alongside the propagation one, asserting the
  2 ms hard limit and reporting the 0.5 ms target.
- `@hh/propagation` gains **universal-variable Kepler propagation**: an arbitrary time offset,
  forwards or backwards, analytically, with one formulation covering elliptic, parabolic and
  hyperbolic orbits and no branch on conic class. Whole revolutions are removed before solving,
  which is what keeps the accuracy of a month-long propagation usable. Non-convergence is a typed
  return value. A single call costs about 1 µs against §11.9's 5 µs target.
- `@hh/propagation` gains the **`Arc`**: one Keplerian segment between impulses, an immutable value
  object whose classical elements are computed on first access and cached. Editing produces a new
  arc rather than mutating an existing one, which is what makes FR-104's incremental recompute safe
  rather than merely fast.
- `@hh/propagation` gains a **numerical integration oracle** — DOP853's 8th-order tableau with
  Richardson step control — reachable only from tests. FR-009 forbids advancing game state with it,
  and that prohibition is now a `dependency-cruiser` rule checked by deliberate violation rather
  than a comment.
- `@hh/astro` gains **equinoctial elements** `(p, f, g, h, k, L)`, with conversions to and
  from both a Cartesian state and the classical set. Non-singular at `e = 0` and at
  `sin i = 0`, which are the common case in this game. Retrograde orbits are supported
  through the retrograde factor rather than rejected.
- `@hh/astro` gains a **zero-revolution Lambert solver**, universal-variable, both transfer
  directions, with the direction chosen explicitly by the caller. Non-convergence is a
  typed return value; collinear positions are rejected with a typed error.
- `@hh/astro` gains the **closed-form two-body relations**: orbital period, mean motion,
  vis-viva, circular and escape speed, specific energy, and the Hohmann and bi-elliptic
  transfers.
- Initial project scaffold from `astro-game-lab/.repo-template`.

### Physics
- **C03's par is 109.1177 m/s and 4 122.965 s, against `docs/PRODUCT.md` §6.8's 217 m/s and
  48 min.** Nothing in the model moved and no golden changed; §6.8's figure is simply the wrong
  quantity for this contract. The table quotes a full two-burn Hohmann transfer — which is what
  C02 costs — and C03 is an `intercept`, where DEP-04 asks for 1 000 m of range and says nothing
  about relative velocity, so the circularisation burn buys nothing the objective wants. One
  prograde impulse raising apoapsis to the target's radius is the whole solution. The time is
  *larger* than 48 min for the matching reason: 48 min is the transfer alone, and the contract's
  departure phase makes the player wait about twenty minutes for the window — which is the lesson
  §6.8 itself assigns to C03. §6.8 states of its own numbers that they are indicative and not
  authoritative, and `docs/PRODUCT.md` is maintained outside this repository, so it is not edited
  to match; `docs/PARS.md` records the divergence and is the authority here.
- **DEP-01 is a core row, not a game-layer one.** `docs/PRODUCT.md` §7.5 places impulsive burns in
  `@hh/game/maneuver`; they are in `packages/sim/src/maneuver.ts` and cannot move, because FR-102
  defines a timeline as alternating Keplerian arcs and impulses and `@hh/sim` may not import the
  layer above it to ask what a burn means. It is now marked in `docs/PHYSICS.md` the way DEP-09 and
  DEP-11 already were — a departure that is not a simplification for fun, with the reason stated.
  No number moved; the model is unchanged.
- **DEP-13 added.** §6.4 requires `reach_orbit` to match its goal "within tolerance" without saying
  which elements or how much. The answer is now a numbered row rather than a constant in a file.
- Both differ from `docs/PRODUCT.md` §7.5, which is maintained upstream. `docs/PHYSICS.md` records
  the divergence and is the authority for this repository until the next sync.

### Changed
- `pnpm coverage` no longer runs the benchmark project (`vitest run --project !bench`). V8 coverage
  instruments every function and slows the code under measurement by roughly a factor of four, so a
  §11.9 budget asserted under it measures the profiler rather than the simulation — the
  ground-station search's 3.3 ms reads as 13.9 ms and trips an 8 ms limit nothing has broken. The
  second reason points the same way: a line reached only by a benchmark is *timed*, not tested, and
  counting it as covered overstates the number NFR-022's gate exists to keep honest. `pnpm bench`
  and `pnpm test:all` are unaffected.
- `@hh/render` compiles against its own TypeScript project. It draws on a canvas, so it needs the
  DOM library, and the root project deliberately has none so that a browser type in the simulation
  core is a compile error rather than something only the lint rule's list of global names catches.
  `pnpm typecheck` now runs three projects, and the guardrail suite checks both halves of the split
  by deliberate violation. Only the Canvas 2-D implementation actually needs a DOM; it sits behind
  the `@hh/render/canvas2d` subpath so the package's barrel — and the camera and tessellator behind
  it — stays runnable under Node.

### Removed
- **Pull-request preview deployments.** Every pull request published its build to
  `pr-preview/pr-<n>/` on `gh-pages` and commented the link; the whole facility is gone — both
  workflows, `tools/pages/pr-comment.sh`, and `publish.sh`'s second mode. A branch is verified
  locally instead: `pnpm build`, `pnpm --filter @hh/web preview`, and a real browser pointed at it.
  Two things follow from previews being the only other writer to the branch. `publish.sh` no longer
  preserves a path it does not own and no longer has a `remove` mode, so its usage is now
  `publish.sh <source-dir> <message>` and a publish replaces the tree whole. And the first deploy to
  `main` after this lands takes the stale preview directories with it, so no cleanup step has to be
  written or run.

### Fixed
- `docs/PHYSICS.md` said angles normalise to `[0, 2π)` "everywhere, without exception". Two of them
  do not, and one of the two was already shipping: hyperbolic anomaly, which is not periodic, and
  now topocentric elevation, which is a latitude-like coordinate on `[-π/2, π/2]` whose sign is its
  entire content — wrapping −10° to 350° would make `elevation ≥ mask` true for every spacecraft on
  the far side of the planet. The convention now says it governs *circular* angles and names both
  exceptions, rather than being a rule the code has to quietly break.
- `docs/PRODUCT.md` §11.6's "an 8-node plan is ~120 bytes of JSON" was optimistic by a factor of
  about 2.5 and is replaced by the measurement: 306 bytes, 408 base64url characters. A 123.75 m/s
  burn is 1 237 500 quantised counts, and every node carries three of those plus an epoch.
- `docs/PHYSICS.md` recorded DEP-09 as living in `@hh/game` and described quantised values as
  "exactly representable". Quantisation is a determinism mechanism (§11.4) and now lives in
  `@hh/sim`, and what is exactly representable is the integer count: 1/1024 is a binary fraction,
  1e-4 is not, so a quantised Δv is the correctly-rounded product rather than the decimal it prints
  as. The departures table's preamble now accounts for its two core-resident rows instead of
  forbidding them.

### Physics
- **The umbra is a cylinder, and that costs something measurable.** The real umbra is a cone — the
  Sun is a disc, so the shadow closes about 1 384 000 km behind Earth — and there is a penumbra
  outside it. This model has neither, which makes its shadow wider than the real one, increasingly
  so with altitude. Measured for a circular orbit with the Sun in plane: at 400 km the eclipse is
  **36.11 min against a true-cone 35.71 min, 1.1% long**; at geostationary altitude **69.41 min
  against 67.28 min, 3.2% long**. The penumbra, reported here as full sunlight, is a further
  0.8 min at 400 km and 4.3 min at GEO. **No previously published number has moved** — the shadow
  model is new — but the closed form behind it lands on the widely quoted ~36 min ISS eclipse and
  ~70 min maximum geostationary eclipse, and `docs/PHYSICS.md` records that those are quoted
  figures rather than a citable worked example.
- **Near-tangential shell crossings are ill-conditioned in epoch, and the closed form does not fix
  it.** Where a trajectory grazes a shell `dr/dt → 0`, so a fixed radius error becomes an unbounded
  epoch error. Measured on a 400 × 800 km orbit: the radius residual stays on the float64 floor at
  every separation, while the implied epoch error grows from 2.0e-11 s at 100 km below apoapsis to
  2.8e-8 s at 1 cm below it. A root-finder would inherit exactly the same conditioning; this is the
  geometry, not the method.
- **A circular orbit cannot be asked where it crosses a shell.** `cos ν* = (p/R − 1)/e` divides one
  small number by another, and a state built from `e = 0` returns with `e ≈ 1e-16`, so a circular
  orbit sitting exactly on a shell satisfies `r_p < R < r_a` in float64 — and a naive search
  reports being inside for half of every revolution, over a radius excursion of a nanometre. The
  finder now treats `e ≤ 5e-16`, the measured cancellation floor on the eccentricity magnitude, as
  circular and answers *entirely inside* or *entirely outside*. Circular orbits are the common case
  here, so this is the ordinary path rather than an edge case.
- **Impulsive Δv, with no model change.** FR-006 is applied through the existing `fromRtn`,
  unchanged: instantaneous, same position, no mass. **No published number has moved.** What is new
  is a frame property that was implicit and easy to get wrong — **impulses do not add in RTN
  components.** An impulse changes `v`, so `r × v` moves and the `T̂`/`N̂` axes rotate under the
  second delta-v. §13.3's "two impulses at the same epoch equal their vector sum" holds in the
  *inertial* frame; the RTN-component reading is now asserted to *fail*, by a margin two orders of
  magnitude above float64 noise, so it cannot be reintroduced quietly. `docs/PHYSICS.md` states it
  under the RTN frame.
- **Propagation exists, and is checked against an independent numerical method.** The analytic
  propagator and the DOP853-tableau oracle share no code, and agree to between 4e-14 and 7e-12
  relative across elliptic, near-parabolic and hyperbolic cases — inside the oracle's own
  sensitivity to its tolerance, which is where the test's threshold comes from rather than from
  what made it pass. **No published number has moved.** What is still missing is a Tier 3 external
  reference: both methods are ours, so the cross-check cannot catch a shared misunderstanding of a
  convention. The `poliastro`/Horizons row stays open against #55.
- **Corrected claim.** `docs/PHYSICS.md` implied §13.3's time-reversal requirement — 1e-12 relative
  over ±30 days — held across the element domain. It does not, and no propagator can make it: a
  float64 state determines its own orbital period to about one `eps`, and a few hundred revolutions
  amplify that past 1e-12. The measured envelope is now tabulated, together with the region where
  the flat 1e-12 does hold (`N·(1−e)^−2.5 ≤ 60`, which covers every v1.0 contract).
- **New measurement.** The oracle's energy drift is linear in orbit count and proportional to the
  requested tolerance — 4.5e-11 relative over a hundred orbits at `rtol = 1e-13` — and angular
  momentum drifts about three times less, not orders less. Recorded because an oracle whose fitness
  is assumed is not an oracle.
- **The Tier 1 closed-form validation suite is complete.** Every Tier 1 row in
  [`docs/PHYSICS.md`](docs/PHYSICS.md) now has a passing test with its expected value
  re-derived from the constants and, wherever one exists, an external anchor that does not
  come from those constants at all. **No published number has moved.**
- **Corrected claim.** `docs/PHYSICS.md` implied the equinoctial formulation fixes the
  cancellation in the eccentricity vector at low `e`. It does not, and nothing can: `e` at
  `1e-10` carries about `5e-16` of absolute error however it is computed, because that is
  the float64 representation limit of the *state*. What the equinoctial set fixes is the
  *periapsis direction*, whose classical error scales as `5e-16 / e` and which the
  classical convention stops reporting at all below `e = 1e-8`. The numerical notes now say
  so, with measurements.
- **Clarified claim.** The bi-elliptic thresholds 11.94 and 15.58 answer two different
  questions and are not the ends of one range. Both are now measured (11.9388, 15.5817) and
  shown to be independent of `μ` and of the inner radius.
- **New documented singularity.** The equinoctial set is an atlas of two charts switched at
  `i = π/2`; the singularity table records the switch, and that at `i = π/2` exactly the
  chart a round trip returns in is decided by round-off. Determinism is unaffected.
- **Lambert is validated against an independent reference.** Curtis §5.3 Examples 5.2
  (elliptical) and 5.3 (hyperbolic), to the book's printed precision. The hyperbolic case
  is the only external check on the negative-`z` branch of the Stumpff functions.
- **New documented limit.** The zero-revolution Lambert search stops at `4π² − 1e-4`,
  because the Stumpff `C(z)` cancels to exactly zero closer than that. The ceiling admits a
  transfer of roughly `4e19` s; beyond it the solver reports out-of-domain.
