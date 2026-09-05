# Par values — Hohmann Heist

> **Generated. Do not edit by hand.** `pnpm pars:write` writes this file from the
> solver's own output; `pnpm pars:check` regenerates it and fails when it differs from
> what is committed. An edit here is reverted by the next run rather than kept.

## What a par is

Every contract publishes two numbers (§6.7): **`par_dv`**, the Δv of the reference
solution, and **`par_time`**, the mission elapsed time at which that solution meets the
objective. Both are shown to the player in the briefing and the debrief — par is not a
hidden developer score — and both are stored in the scenario file beside a reference
replay that the content suite replays and asserts on every run (§13.4).

**Par is published and beatable.** D12: if a player beats `par_dv`, that is a bug report
about our optimum, and the debrief says so and offers to file it. This document is what
such a report gets checked against, which is why it records the search rather than only
the answer.

## The method

There is no general trajectory optimiser here. Each objective kind names a **family** of
solutions that is the right shape for it, and the solver searches that family and nothing
else.

### `intercept` — Lambert transfers between two epochs

Parameterised by **departure epoch** and **time of flight**, and searched in two stages.

1. **A grid.** Departure epoch is sampled across the interval from mission start to the
   deadline; arrival epoch across the interval from the earliest admissible transfer to
   the planning horizon. At each point every Lambert branch the time of flight admits is
   solved — the zero-revolution transfer and both branches of each multi-revolution count
   up to the search ceiling — and the cheapest point of each branch family is kept.
2. **A simplex.** Each family's best grid point seeds a Nelder–Mead refinement over the
   same two parameters, with the initial simplex one grid cell wide. The refinement runs
   per family because the cheapest family changes across the search space and a simplex
   on a discontinuous objective converges to the discontinuity.

The **revolution ceiling is derived from the contract's own horizon** rather than fixed or
overridden per contract: a transfer cannot complete more revolutions than fit in the
planning horizon, so the horizon divided by the ship's orbital period is an upper bound
that is a property of the scenario rather than of a lookup table. Each entry below reports
the ceiling its contract reached.

### `reach_orbit` — tangential two-body transfers

The Δv is **not searched for**. Between two coplanar circular orbits the minimum-Δv
two-impulse transfer is the Hohmann transfer; searching a grid for it would be pretending
not to know a textbook result, and would publish a number slightly worse than the one that
can be written down. Where the radius ratio exceeds 11.94 the bi-elliptic branch is
searched over its one free parameter as well, because above that ratio the answer depends
on the intermediate radius; below it, Hohmann wins for every intermediate radius and the
branch is skipped rather than searched and discarded.

What *is* searched is **when to depart**. A goal that is circular and equatorial pins
nothing and the answer is to leave immediately. A goal with an apse line pins the burn to
the point that becomes its periapsis — half an orbit from the apsis being raised, which is
the lesson C01 exists to teach. The departure epoch is swept across one revolution, scored
by how far the resulting orbit sits from the goal in units of its own tolerance, and
refined to the **centre** of the tolerance band rather than an edge of it.

### `station` — drift orbits

Not a transfer between two positions, so the Lambert family would not find it at all.
Leave the geostationary radius so the period no longer matches Earth's rotation, let the
longitude slide, and burn again to stop. The free parameter is an **integer**: how many
complete drift revolutions to fly. That is what makes the construction exact — a drift
orbit is eccentric, so the burn that stops the drift is the first one reversed only at the
apsis the ship departed from, which comes round once per revolution. Everything else
follows from

```
T' = T_geo − slot / (k · omega_earth)
```

and vis-viva at the departure radius. Δv falls as `k` rises, so the cheapest admissible
member is the largest `k` whose second burn still lands inside the deadline: **the
deadline, not the budget, is what sets par for a station contract.** The whole family is
tabulated in the entry rather than only its winner, because the trade is the contract.

The winner is then built as a real `Plan` — quantised at entry to DEP-09's 1e-4 m/s and
1/1024 s, exactly as a player's plan would be (FR-105) — and run through the game's own
timeline, objective evaluator and legality check. **The published numbers are what that
evaluation reported**, not what the search estimated: a par the game itself did not
produce is a par nobody can reproduce.

How many impulses the resulting plan carries follows from the objective. An `intercept`
needs only the departure impulse — DEP-04 asks for 1 000 m of range and says nothing about
relative velocity — so its plan has one burn, whether the transfer is a climb or a phasing
loop. A `reach_orbit` takes one impulse when the goal's near apsis is already where the
ship is and two when it must circularise elsewhere. A `station` takes two: start the
drift, stop the drift. An objective that must match **velocity** takes an arrival impulse
none of these families buys, and gets its own strategy with the contract that first needs
one; the solver refuses an objective it has no strategy for rather than answering a
different question.

Δv is the sum of the burn magnitudes, which is the quantity the budget caps (DEP-02).
Time is the epoch at which the objective evaluator says the objective was met — for a
proximity objective the closest approach inside tolerance, not the last burn and not the
horizon.

## What the method does not do

DEP-12 is explicit that par is a fine grid refined by local optimisation and **not a
proven optimum**, and there are three specific reasons it is not:

- **The family is chosen per objective kind, and nothing outside it is looked for.** An
  `intercept` solved by a drift-and-catch, a `reach_orbit` reached by a three-burn detour
  outside the bi-elliptic branch, a `station` slot acquired on a transfer rather than a
  drift — none of these is searched.
- **A grid can step over a narrow minimum.** The simplex finds the bottom of a valley it
  started in; it cannot find one the grid never entered.
- **The revolution count is capped.** The ceiling is derived from each contract's horizon
  and is a bound on the work, not on the physics. Every entry reports the ceiling it got.

Where the geometry admits a closed form, each entry reports it beside the search's answer.
That comparison is evidence about the **search**: the two paths share only the values of μ
and ω⊕, so agreement means the grid, the simplex, the Lambert solver, the quantiser and the
timeline did not conspire. It is *not* evidence about the physics, which is checked
independently in `docs/PHYSICS.md` — Tier 1 against closed forms, Tier 3 against Vallado,
Curtis and a poliastro-lineage fixture.

Four geometries, four forms: the apoapsis raise for an `intercept` between circular orbits
of different radii; the **phasing orbit** for one between orbits of the *same* radius,
where a Hohmann check would compare against zero and call it agreement; the Hohmann pair
or its first burn alone for a `reach_orbit`; and the first-order drift relation
`λ̇ = −3Δv/a` for a `station`. The first three are exact and are held to DEP-09's
quantisation noise. The fourth is a linearisation and is held to its own second-order term
instead, because asserting a first-order expansion to a quantum would be asserting
something false.

## Reproducing a par

```bash
pnpm pars:check   # recompute every par and fail if it moved
pnpm pars:write   # recompute and write the result into the scenario files and this document
```

The search is deterministic: no randomness, a fixed grid, fixed simplex coefficients and a
fixed iteration cap, so the same scenario gives the same par on every run. §11.4 does not
claim bit-identical results across JavaScript engines — `Math.sin` and friends are not
required to be correctly rounded — so a par recomputed on a different engine may move in
its last digits. That is why a change in par is a **visible diff** rather than a silent
one: whatever moves it, it has to be committed.

## Divergences from `docs/PRODUCT.md` §6.8

§6.8's Δv and time columns say of themselves that they are *"computed from the constants in
§7.3 and are indicative targets for content design ... not authoritative"*, and that the
scenario file's value is whatever the validation test confirms. Where the solver disagrees
with that table, the solver's figure is the one that ships and the divergence is recorded
here. `docs/PRODUCT.md` is maintained outside this repository and is not edited to match.

- **C03 "Cold Open" — §6.8 quotes 217 m/s and 48 min; the solver finds about half the Δv.**
  The table's figure is the full two-burn Hohmann transfer, which is what C02 costs. C03 is
  an **`intercept`**, and DEP-04 asks only for 1 000 m of range — it says nothing about
  relative velocity, so the circularisation burn buys nothing the objective wants. One
  prograde impulse that raises apoapsis to the target's radius is the whole solution. The
  time is larger than 48 min for the matching reason: 48 min is the transfer alone, and the
  contract's departure phase requires waiting for the window before the transfer starts.
  Which is the lesson §6.8 itself assigns to C03 — *the transfer must arrive when the target
  is there, and departure timing is a free variable.*

## Contracts

### c03-cold-open

**“Cold Open”** — act 1, contract 3.

| | |
| --- | --- |
| Objective | intercept KESTREL-2 within 1 000 m |
| Δv budget | 300.0 m/s |
| Deadline | T+03:00:00 |
| Horizon | T+06:00:00 |
| **par_dv** | **109.1177 m/s** |
| **par_time** | **4122.965 s** (T+01:08:42) |
| **par_burns** | **1** |
| Closest approach | 0.1 m, against a 1 000 m tolerance |
| Budget headroom | 2.75× (§13.4 asks for ≥ 1.15×) |
| Horizon headroom | 5.24× (§13.4 asks for ≥ 1.10×) |

**Solution.** A single impulse — at MET T+00:20:22 (1222.345 s), RTN [0.0042, 109.1177, 0.0000] m/s prograde.

**Search.** 38 801 grid points (0 with no admissible transfer), 9 transfer families found and 7 of them feasible, 1 055 simplex iterations in total; every refinement stopped on its tolerance. Grid: 241 departure samples × 161 arrival samples, revolutions capped at 4 — derived from this contract's horizon, not set for it — shortest transfer considered 60 s. The winning family is the direct, zero-revolution transfer.

**Independent check.** Against the tangential impulse that raises apoapsis to the target radius: **109.1177 m/s**. The search found 109.1177 m/s, a difference of 0.000031 m/s (0.00003%), against a tolerance of 0.001000 m/s — an exact relation, held to DEP-09’s quantisation noise. The two share only the values of μ and ω⊕. A full two-burn Hohmann — what a *rendezvous* would cost here — is 216.6823 m/s.
