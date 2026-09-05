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

Acts I's four contracts reproduce §6.8 to the digit — 109.1177, 216.6823 and 3 853.9598 m/s
against a table quoting 109, 217 and 3 854 — so the divergences below are all in Act II, and
all of them are the same divergence: **§6.8's Δv columns price a manoeuvre that meets the
objective and then tidies up afterwards, and the objective does not ask for the tidying.**

- **C03 "Cold Open" — §6.8 quotes 217 m/s and 48 min; the solver finds about half the Δv.**
  The table's figure is the full two-burn Hohmann transfer, which is what C02 costs. C03 is
  an **`intercept`**, and DEP-04 asks only for 1 000 m of range — it says nothing about
  relative velocity, so the circularisation burn buys nothing the objective wants. One
  prograde impulse that raises apoapsis to the target's radius is the whole solution. The
  time is larger than 48 min for the matching reason: 48 min is the transfer alone, and the
  contract's departure phase requires waiting for the window before the transfer starts.
  Which is the lesson §6.8 itself assigns to C03 — *the transfer must arrive when the target
  is there, and departure timing is a free variable.*

- **C05 "Tailgate" and C06 "Overtake" — §6.8 quotes 72 and 44.0 m/s; the solver finds
  exactly half of each.** Same cause as C03, and the *times* agree to the minute: 12 h 10 m
  and 12 h 27 m, both on eight revolutions, exactly as the table says. §6.8 prices the
  two-burn phasing manoeuvre — drop into the phasing orbit, then re-circularise — and the
  re-circularisation is what an `intercept` does not buy. This was raised as a design
  question rather than settled by the arithmetic, because promoting C05 to a
  `rendezvous` *would* make the second burn necessary and would restore §6.8's figure.
  The decision was to keep `intercept`: C08 *Handshake*'s entire lesson is
  *"intercept is not rendezvous; you must match velocity too"*, and spending it three
  contracts early would cost more than the number is worth. C05's teaching claim is about
  **direction** — burn retrograde to catch something ahead — and one burn teaches it.

- **C07 "Slot Machine" — §6.8 quotes 1.7 m/s over 10 d 4 h; the solver ships 1.4244 m/s
  over 11.96 d.** Not a disagreement about the physics: §6.8's pair of points, *"1.7 m/s and
  ten days, or 3.7 m/s and five"*, are members of the family the solver enumerates, and the
  table below has the first of them at **1.7096 m/s over 9.96 days** — three figures, from
  the constants. The second is close rather than exact: the family is indexed by whole
  revolutions, and 3.7 m/s falls between the four-revolution member (4.2793 m/s, 3.98 d)
  and the five (3.4220 m/s, 4.98 d). The contract's deadline is twelve days, par is the
  cheapest member that fits inside it, and that is the twelve-revolution member rather than
  the ten. §6.8 quotes a point on the trade; the contract asks for its end.

## A correction to §6.8's C05/C06 asymmetry

§6.8 says of the phasing pair: *"there the **altitude floor** caps how cheap you can go,
here the **deadline** does."* The second half is right. The first is backwards, and the
arithmetic is not close.

Δv falls **monotonically with revolution count** — a longer phasing loop is a smaller
period change — so a cheaper solution flies a *higher* periapsis, not a lower one. C05's
winning eight-revolution member has its periapsis at 274.2 km; nine revolutions would put
it at 288.2 km. The floor is nowhere near either. Where it does bite is the **fast** end:
three revolutions puts periapsis at 63.2 km, through DEP-08's 100 km floor, and four
brings it back to 147.8 km.

So the floor bounds how *quickly* C05 can be flown, and the deadline bounds how *cheaply* —
in both contracts. The asymmetry §6.8 is reaching for is still real and is still worth
preserving: C05's family runs **downward** into the floor and C06's runs **upward** away
from it, so only one of the two has a fast end the floor can reach at all. That is what
`tools/content/contracts.test.ts` asserts, in those terms.

## The phasing family, and why Lambert cannot find it

Worth recording because it looks like a tuning problem and is not. C05 and C06 put the ship
and the target on the **same** circular orbit, so the manoeuvre is not a transfer between
two places — it is a change of period, flown for a whole number of revolutions, returning
to the point it started from. Departure and arrival are the same position, and that is
precisely the geometry Lambert's problem is degenerate at: the transfer angle is zero and
`solveLambert` refuses it.

The transfer search can therefore only creep towards the answer and gets worse as it does.
On C05 it returned 48.26 m/s from seventeen families with two of them feasible, against a
closed form of 36.00 — a number that is admissible, reproducible, and 34% too expensive.
Phasing orbits are a family of their own for that reason, indexed by two integers, and both
families are searched on every `intercept`; each entry below reports what the one that
lost was worth.

## Contracts

### c01-shakedown

**“Shakedown”** — act 1, contract 1.

| | |
| --- | --- |
| Objective | reach_orbit — 6 778 137 × 7 178 137 m |
| Δv budget | 200.0 m/s |
| Deadline | T+01:30:00 |
| Horizon | T+03:00:00 |
| **par_dv** | **109.1177 m/s** |
| **par_time** | **2776.813 s** (T+00:46:16) |
| **par_burns** | **1** |
| Budget headroom | 1.83× (§13.4 asks for ≥ 1.15×) |
| Horizon headroom | 3.89× (§13.4 asks for ≥ 1.10×) |

**Solution.** A single impulse — at MET T+00:46:16 (2776.813 s), RTN [0.0000, 109.1177, 0.0000] m/s prograde.

**Search.** No Δv search: the minimum-Δv two-impulse transfer between coplanar circular orbits is a closed form, and the winner is a Hohmann transfer in 1 impulse from 6 778 137 m to 7 178 137 m. What was searched is the departure epoch — 361 samples across one revolution, then 30 simplex iterations to the centre of the goal's tolerance band; the refinement stopped on its tolerance. The bi-elliptic branch was **not** searched. The radius ratio is 1.06, below the 11.94 threshold `docs/PHYSICS.md` measures, and below it Hohmann wins for *every* intermediate radius — so there is provably nothing there to find rather than nothing found.

**Independent check.** Against the tangential impulse that raises the far apsis to the goal’s: **109.1177 m/s**. The search found 109.1177 m/s, a difference of 0.000031 m/s (0.00003%), against a tolerance of 0.001000 m/s — an exact relation, held to DEP-09’s quantisation noise. The two share only the values of μ and ω⊕. Circularising there as well — what C02 costs — would be 216.6823 m/s.

### c02-round-trip

**“Round Trip”** — act 1, contract 2.

| | |
| --- | --- |
| Objective | reach_orbit — circular at 7 178 137 m |
| Δv budget | 260.0 m/s |
| Deadline | T+01:30:00 |
| Horizon | T+03:00:00 |
| **par_dv** | **216.6823 m/s** |
| **par_time** | **2900.616 s** (T+00:48:20) |
| **par_burns** | **2** |
| Budget headroom | 1.20× (§13.4 asks for ≥ 1.15×) |
| Horizon headroom | 3.72× (§13.4 asks for ≥ 1.10×) |

**Solution.** 2 impulses — at MET T+00:00:00 (0.000 s), RTN [0.0000, 109.1177, 0.0000] m/s prograde; at MET T+00:48:20 (2900.616 s), RTN [0.0000, 107.5646, 0.0000] m/s prograde.

**Search.** No Δv search: the minimum-Δv two-impulse transfer between coplanar circular orbits is a closed form, and the winner is a Hohmann transfer in 2 impulses from 6 778 137 m to 7 178 137 m. What was searched is the departure epoch — 1 samples across one revolution, then 0 simplex iterations to the centre of the goal's tolerance band; the refinement stopped on its tolerance. The bi-elliptic branch was **not** searched. The radius ratio is 1.06, below the 11.94 threshold `docs/PHYSICS.md` measures, and below it Hohmann wins for *every* intermediate radius — so there is provably nothing there to find rather than nothing found.

**Independent check.** Against the two-impulse Hohmann transfer between the two circular radii: **216.6823 m/s**. The search found 216.6823 m/s, a difference of 0.000023 m/s (0.00001%), against a tolerance of 0.001000 m/s — an exact relation, held to DEP-09’s quantisation noise. The two share only the values of μ and ω⊕.

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

**Search.** 38 801 grid points (0 with no admissible transfer), 9 transfer families found and 3 of them feasible, 1 055 simplex iterations in total; every refinement stopped on its tolerance. Grid: 241 departure samples × 161 arrival samples, revolutions capped at 4 — derived from this contract's horizon, not set for it — shortest transfer considered 60 s. The winning family is the direct, zero-revolution transfer.

**Independent check.** Against the tangential impulse that raises apoapsis to the target radius: **109.1177 m/s**. The search found 109.1177 m/s, a difference of 0.000031 m/s (0.00003%), against a tolerance of 0.001000 m/s — an exact relation, held to DEP-09’s quantisation noise. The two share only the values of μ and ω⊕. A full two-burn Hohmann — what a *rendezvous* would cost here — is 216.6823 m/s.

### c04-long-haul

**“Long Haul”** — act 1, contract 4.

| | |
| --- | --- |
| Objective | reach_orbit — circular at 42 164 173 m |
| Δv budget | 4500.0 m/s |
| Deadline | T+06:00:00 |
| Horizon | T+08:00:00 |
| **par_dv** | **3853.9598 m/s** |
| **par_time** | **19048.583 s** (T+05:17:28) |
| **par_burns** | **2** |
| Budget headroom | 1.17× (§13.4 asks for ≥ 1.15×) |
| Horizon headroom | 1.51× (§13.4 asks for ≥ 1.10×) |

**Solution.** 2 impulses — at MET T+00:00:00 (0.000 s), RTN [0.0000, 2397.4731, 0.0000] m/s prograde; at MET T+05:17:28 (19048.583 s), RTN [-0.0001, 1456.4867, 0.0000] m/s prograde.

**Search.** No Δv search: the minimum-Δv two-impulse transfer between coplanar circular orbits is a closed form, and the winner is a Hohmann transfer in 2 impulses from 6 778 137 m to 42 164 173 m. What was searched is the departure epoch — 1 samples across one revolution, then 0 simplex iterations to the centre of the goal's tolerance band; the refinement stopped on its tolerance. The bi-elliptic branch was **not** searched. The radius ratio is 6.22, below the 11.94 threshold `docs/PHYSICS.md` measures, and below it Hohmann wins for *every* intermediate radius — so there is provably nothing there to find rather than nothing found.

**Independent check.** Against the two-impulse Hohmann transfer between the two circular radii: **3853.9598 m/s**. The search found 3853.9598 m/s, a difference of 0.000016 m/s (0.00000%), against a tolerance of 0.001000 m/s — an exact relation, held to DEP-09’s quantisation noise. The two share only the values of μ and ω⊕.

### c05-tailgate

**“Tailgate”** — act 2, contract 5.

| | |
| --- | --- |
| Objective | intercept MERIDIAN-9 within 1 000 m |
| Δv budget | 250.0 m/s |
| Deadline | T+12:13:20 |
| Horizon | T+14:00:00 |
| **par_dv** | **36.0031 m/s** |
| **par_time** | **43811.754 s** (T+12:10:11) |
| **par_burns** | **1** |
| Closest approach | 0.0 m, against a 1 000 m tolerance |
| Budget headroom | 6.94× (§13.4 asks for ≥ 1.15×) |
| Horizon headroom | 1.15× (§13.4 asks for ≥ 1.10×) |

**Solution.** A single impulse — at MET T+00:00:00 (0.000 s), RTN [0.0000, -36.0031, 0.0000] m/s retrograde.

**Search.** No Δv search: a phasing orbit is a closed form in two integers, how many revolutions the ship flies and how many the target does. The target starts 40.0° ahead, and the winner flies 8 revolutions against the target's 8 — a higher, slower orbit — the ship falls back by climbing — on a period of 5476.491 s, whose other apsis is at 6 652 324 m. 60 members were enumerated and 5 were admissible. The Lambert family was searched too and its best was 41.2889 m/s — worse, and necessarily so: a phasing solution departs and arrives at the **same position**, which is the one geometry Lambert's problem is degenerate at, so the transfer search can only creep towards this answer and gets worse as it does.

**Independent check.** Against the phasing orbit whose period closes the phase in the achieved time, entered with one tangential impulse: **36.0133 m/s**. The search found 36.0031 m/s, a difference of 0.010170 m/s (0.02824%), against a tolerance of 0.036013 m/s — an exact relation keyed to the achieved closest approach, held to the difference between that instant and the nominal return. The two share only the values of μ and ω⊕. Re-circularising at the end — what a *rendezvous* would cost here — would be 72.0265 m/s.

### c06-overtake

**“Overtake”** — act 2, contract 6.

| | |
| --- | --- |
| Objective | intercept MERIDIAN-9 within 1 000 m |
| Δv budget | 250.0 m/s |
| Deadline | T+12:30:00 |
| Horizon | T+14:00:00 |
| **par_dv** | **21.9983 m/s** |
| **par_time** | **44814.787 s** (T+12:26:54) |
| **par_burns** | **1** |
| Closest approach | 0.0 m, against a 1 000 m tolerance |
| Budget headroom | 11.36× (§13.4 asks for ≥ 1.15×) |
| Horizon headroom | 1.12× (§13.4 asks for ≥ 1.10×) |

**Solution.** A single impulse — at MET T+00:00:00 (0.000 s), RTN [0.0000, 21.9983, 0.0000] m/s prograde.

**Search.** No Δv search: a phasing orbit is a closed form in two integers, how many revolutions the ship flies and how many the target does. The target starts 335.0° ahead, and the winner flies 8 revolutions against the target's 9 — a lower, faster orbit — the ship catches up by dropping — on a period of 5601.833 s, whose other apsis is at 6 856 475 m. 61 members were enumerated and 8 were admissible. The Lambert family was searched too and its best was 22.0705 m/s — worse, and necessarily so: a phasing solution departs and arrives at the **same position**, which is the one geometry Lambert's problem is degenerate at, so the transfer search can only creep towards this answer and gets worse as it does.

**Independent check.** Against the phasing orbit whose period closes the phase in the achieved time, entered with one tangential impulse: **22.0053 m/s**. The search found 21.9983 m/s, a difference of 0.007044 m/s (0.03201%), against a tolerance of 0.022005 m/s — an exact relation keyed to the achieved closest approach, held to the difference between that instant and the nominal return. The two share only the values of μ and ω⊕. Re-circularising at the end — what a *rendezvous* would cost here — would be 44.0107 m/s.

### c07-slot-machine

**“Slot Machine”** — act 2, contract 7.

| | |
| --- | --- |
| Objective | station — a slot 3.000° east, held within ±0.050° at a drift no greater than 0.010°/day |
| Δv budget | 25.0 m/s |
| Deadline | T+12d 00:00:00 |
| Horizon | T+14d 00:00:00 |
| **par_dv** | **1.4244 m/s** |
| **par_time** | **1033251.174 s** (T+11d 23:00:51) |
| **par_burns** | **2** |
| Budget headroom | 17.55× (§13.4 asks for ≥ 1.15×) |
| Horizon headroom | 1.17× (§13.4 asks for ≥ 1.10×) |

**Solution.** 2 impulses — at MET T+00:00:00 (0.000 s), RTN [0.0000, -0.7122, 0.0000] m/s retrograde; at MET T+11d 23:00:51 (1033251.174 s), RTN [0.0000, 0.7122, 0.0000] m/s prograde.

**The trade.** Δv falls as the drift gets slower, so what sets par is the deadline
rather than the budget. Every member the solver enumerated:

| Revolutions | Δv (m/s) | Elapsed (days) | Δa (km) | Admissible |
| --- | --- | --- | --- | --- |
| 1 | 17.2251 | 0.99 | -234.57 | yes |
| 2 | 8.5765 | 1.99 | -117.20 | yes |
| 3 | 5.7097 | 2.98 | -78.12 | yes |
| 4 | 4.2793 | 3.98 | -58.58 | yes |
| 5 | 3.4220 | 4.98 | -46.86 | yes |
| 6 | 2.8509 | 5.98 | -39.05 | yes |
| 7 | 2.4431 | 6.97 | -33.47 | yes |
| 8 | 2.1374 | 7.97 | -29.29 | yes |
| 9 | 1.8997 | 8.97 | -26.03 | yes |
| 10 | 1.7096 | 9.96 | -23.43 | yes |
| 11 | 1.5540 | 10.96 | -21.30 | yes |
| 12 | 1.4244 | 11.96 | -19.52 | yes **← par** |
| 13 | 1.3148 | 12.96 | -18.02 | no — past the deadline |
| 14 | 1.2208 | 13.95 | -16.73 | no — past the deadline |
| 15 | 1.1394 | 14.95 | -15.62 | no — past the deadline |

**Search.** No Δv search: each member of the drift family is a closed form in one integer, the number of complete drift revolutions. 15 members were enumerated up to a ceiling of 15, 12 of them admissible, and the cheapest admissible one won — 12 revolutions on a drift orbit of period 86104.264 s, 19522.7 m below the ship's own radius.

**Independent check.** Against the first-order drift relation λ̇ = −3Δv/a, paid twice: **1.4244 m/s**. The search found 1.4244 m/s, a difference of 0.000043 m/s (0.00301%), against a tolerance of 0.007122 m/s — a first-order relation, held to its own second-order term rather than to a quantum. The two share only the values of μ and ω⊕.
