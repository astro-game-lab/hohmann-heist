# Hohmann Heist — Product Definition, Design & Delivery Plan

> **Status:** Draft 1 — approved for backlog creation
> **Version:** 0.1
> **Date:** 2026-09-01
> **Owner:** Dimitrije Jankovic
> **Org:** [astro-game-lab](https://github.com/astro-game-lab)
> **Repo:** [`astro-game-lab/hohmann-heist`](https://github.com/astro-game-lab/hohmann-heist)
> **Board:** [AstroGameLab #1](https://github.com/orgs/astro-game-lab/projects/1) · Game field = `Hohmann Heist`

## How to read this document

This is the single source of truth for **what Hohmann Heist is** and **what has to be built**. It is written so that a complete GitHub issue backlog can be derived from it mechanically:

| If you want to… | Read |
| --- | --- |
| Understand the product | §1–§5 |
| Understand the game | §6 |
| Know what the physics claims | §7 |
| Build a screen | §8, §9 |
| Write an issue's acceptance criteria | §10 (FR-###), §12 (NFR-###) |
| Build a system | §11 |
| Know when we ship | §14 |
| Turn this into issues | §15 |

Requirement IDs (`FR-101`, `NFR-014`) are **stable**. Once assigned they are never reused or renumbered — issues, tests, and commits cite them. New requirements append.

Three documents follow this one into the repo and inherit from it:

- `docs/PHYSICS.md` — the physics contract. §7 is its source; the repo copy is authoritative once created.
- `docs/DESIGN.md` — the short, living design summary. §6 is its source.
- `README.md` — the public face. §1 is its source.

---

## 1. Executive summary

### 1.1 Pitch

**Hohmann Heist is a puzzle game about stealing things in orbit, where the only weapon is orbital mechanics.**

You are given a target, a delta-v budget, and a deadline. You plan a sequence of impulsive burns on a scrubbable timeline, watch the predicted trajectory bend as you drag each one, and commit. Then you watch it play out. If your plan was good you match orbits with the target, take what you came for, and leave. If it was not, you burn your last 40 m/s watching the target sail past 12 kilometres away, and you try again.

Every number in it is real. The delta-v for LEO→GEO is 3 854 m/s because that is what it costs.

### 1.2 The fantasy

You are the person in the room who can see the trajectory. Not a pilot — a planner. The crew has the hardware and the nerve; you have the transfer.

The feeling we are selling is the **click**: the moment where a player who has been fighting the controls suddenly sees that to catch something ahead of you, you slow down. That moment is the product. Everything else — the art, the fiction, the leaderboard — exists to get more people to it and to keep them there afterwards.

### 1.3 Why this game first

From the [org roadmap](astro-games-roadmap.md), Hohmann Heist is priority 1 and Phase 2. It earns that slot on four counts:

1. **Smallest honest physics core.** Two-body, single central body, impulsive burns. Everything in it is closed-form or a well-understood solver. No ephemerides, no patched conics, no force models. We can be *provably* right, cheaply.
2. **Highest teaching density per line of code.** The counter-intuitive core of astrodynamics — retrograde to catch up, plane changes at apoapsis, the delta-v/time trade — is all reachable inside two-body.
3. **It builds the engine the other four games need.** Elements, frames, time, Kepler, Lambert, propagation, event finding, and a canvas orbit renderer are ~80% of what *Orbital Traffic Controller* and *Gravity Well* also need.
4. **It is demonstrably finishable.** A plan-then-execute puzzle has no AI, no netcode in the loop, no physics tuning spiral.

### 1.4 Elevator numbers

| | |
| --- | --- |
| Platform | Browser, desktop + tablet + phone. No install. |
| Session length | 3–8 minutes per contract; 20–40 minutes per sitting |
| v1.0 content | 18 hand-authored contracts across 6 acts, plus an infinite daily challenge |
| Time to first "click" | Under 5 minutes (Contract 01) |
| Assumed knowledge | None |
| Price | Free, open source (MIT code, CC BY 4.0 assets) |
| Estimated effort to v1.0 | ~150–200 issues, ~9 months at ~10 h/week |

---

## 2. Goals, non-goals, and success metrics

### 2.1 Product goals

| # | Goal | Why |
| --- | --- | --- |
| G1 | A stranger clicks a link and understands the objective in under 60 seconds. | Browser-first only pays off if the funnel is one click deep. |
| G2 | A player who has never heard of a Hohmann transfer executes one deliberately within 10 minutes. | This is the education thesis, made measurable. |
| G3 | Every number the game prints agrees with a textbook, or the difference is in a published table. | The org's honesty rule, and our only real differentiator. |
| G4 | A run is reproducible from a share code on any machine, forever. | Determinism is a feature, not an implementation detail — it powers replays, leaderboards, and bug reports. |
| G5 | The simulation core ships as a reusable package with no game code in it. | Phase 3–6 of the org roadmap depend on this. |
| G6 | An outside contributor can add a contract without touching TypeScript. | Scenario-as-data is the community on-ramp. |

### 2.2 Non-goals for v1.0

Stated so we can say no later without re-litigating:

- **Not a spaceflight simulator.** No launch, no reentry, no staging, no attitude control, no docking minigame.
- **Not KSP.** No sandbox, no vehicle construction, no career economy beyond a nominal contract fee.
- **Not real-time.** No twitch skill, no reflex windows, no piloting.
- **Not multiplayer.** Asynchronous leaderboards only; no live sessions.
- **Not 3D in v1.0.** Coplanar scenarios, 2D presentation. (The core is 3D from day one — see §7.2.)
- **No accounts.** No email, no OAuth, no passwords. See §11.12.
- **No mobile app stores.** PWA-installable is enough.
- **No monetisation.** Not in v1, not planned.

### 2.3 Success metrics

Measured via the privacy-preserving telemetry in §11.14. Targets are for the 90 days after the v1.0 launch post.

| Metric | Definition | Target | Stretch |
| --- | --- | --- | --- |
| M1 Tutorial completion | Sessions reaching Contract 01 debrief / sessions starting Contract 01 | ≥ 70% | ≥ 85% |
| M2 Act I completion | Unique players completing Contract 04 | ≥ 40% of starters | ≥ 55% |
| M3 The click | Players who complete a phasing contract (05–07) | ≥ 25% of starters | ≥ 35% |
| M4 Retry appetite | Median attempts per completed contract | ≥ 2.0 | ≥ 3.0 |
| M5 Return rate | Players with ≥ 2 sessions on different days | ≥ 20% | ≥ 30% |
| M6 Daily challenge | Median unique daily submissions, weeks 4–12 | ≥ 50/day | ≥ 200/day |
| M7 Physics trust | Open, confirmed `physics` issues at any time | 0 unresolved > 14 days | — |
| M8 Reach | GitHub stars on the repo at day 90 | ≥ 250 | ≥ 1 000 |
| M9 Contribution | External PRs merged | ≥ 5 | ≥ 20 |
| M10 Performance | p75 first-contentful-paint on 4G | ≤ 2.0 s | ≤ 1.2 s |

**Counter-metrics** — things that must not get worse in pursuit of the above:

| | |
| --- | --- |
| C1 | Median attempts per contract must not exceed 8 in Acts I–II (frustration, not depth). |
| C2 | Abandonment inside the planner (no commit within 5 minutes) must stay under 15%. |
| C3 | Bundle size must not exceed the NFR-020 budget to buy a feature. |

---

## 3. Audience

We design for three people. P1 is the priority; P2 is who we brag about; P3 is the growth channel.

### 3.1 P1 — "Sam", the curious puzzle player

- Plays Baba Is You, Opus Magnum, Factorio. Watches Scott Manley occasionally. Bounced off KSP.
- **Knows:** gravity, orbits are ellipses, rockets need fuel.
- **Does not know:** what delta-v is, that speeding up makes you go slower, what a periapsis is.
- **Wants:** an elegant system to master. Will happily retry 15 times to shave 8 m/s.
- **Will quit if:** the first three minutes require reading, or the UI has more than ~6 controls on screen.
- **Design implications:** the tutorial teaches by making one thing happen, not by explaining. Vocabulary is introduced one word at a time, always with the plain-English gloss on first use ("periapsis — the low point of the orbit").

### 3.2 P2 — "Priya", the practitioner

- Flight dynamics engineer, aerospace student, or serious KSP player. Might use GMAT at work.
- **Wants:** to check our arithmetic, and to be delighted when it holds up. Then wants the optimisation problem.
- **Will quit if:** she catches us lying — a wrong constant, a fudged tolerance, a delta-v that does not close.
- **Design implications:** every readout can be expanded to full precision; `docs/PHYSICS.md` is linked from inside the game; the physics-discrepancy issue template is one click from the debrief screen. Par values are published, and beatable.

### 3.3 P3 — "Marco", the educator

- Teaches undergraduate astrodynamics, or runs a space outreach programme.
- **Wants:** a link he can put on a slide. A specific contract that demonstrates the specific thing he just lectured about.
- **Design implications:** deep-linkable contracts (`/#/contract/11`), a Codex entry per concept that is correct enough to cite, and shareable custom scenarios (v1.3).

### 3.4 Explicitly not designed for

- Players who want a spaceflight sim with vehicle construction — that is KSP, and we will not win there.
- Players who want narrative-forward sci-fi — the fiction is a frame, not a plot.
- Offline/desktop-native players — browser only.

---

## 4. Landscape and positioning

| Product | What it does well | Where the gap is |
| --- | --- | --- |
| **Kerbal Space Program** | The definitive orbital-mechanics teacher. Maneuver nodes are its best idea. | 30+ hours to competence, a 2 GB install, a purchase, and vehicle construction gating the orbital content. |
| **Simple Rockets 2** | Mobile-friendly, decent orbital planning. | Still construction-first; physics is not documented or auditable. |
| **Orbiter 2016** | The fidelity benchmark. | A flight simulator for enthusiasts; no game layer, Windows only. |
| **Universe Sandbox** | Beautiful, approachable n-body sandbox. | A toy, not a challenge. No objectives, no mastery curve. |
| **Poliastro / GMAT / FreeFlyer** | Correct, professional. | Tools, not games. No feedback loop for a learner. |
| **Browser physics puzzlers** (e.g. *Bounce Back*, *Orbit*) | One-click, fast to learn. | The physics is decorative; nothing transfers to the real domain. |

### 4.1 Positioning statement

> For **curious puzzle players and space enthusiasts** who want the satisfaction of orbital mechanics without a 30-hour on-ramp, **Hohmann Heist** is a **browser puzzle game** that turns real orbital transfer planning into 5-minute heists. Unlike *Kerbal Space Program*, it requires no install, no purchase, and no rocket building — and unlike browser space games, its physics is validated against textbooks and published.

### 4.2 The three things nobody else does together

1. **One click to real physics.** No install, no build step, no tutorial about the tutorial.
2. **An auditable simulation.** A public physics contract, a validation table, and an issue template for telling us we are wrong.
3. **Deterministic, shareable runs.** A 300-character URL reproduces your trajectory exactly, anywhere.

---

## 5. Product decisions

Decisions made before drafting, with rationale and the cost of reversal. Anything not listed here is open and belongs in §17.

| # | Decision | Rationale | Reversal cost |
| --- | --- | --- | --- |
| D1 | **Plan-then-execute**, not real-time. Time only advances on commit or scrub. | Determinism is free. No reflex barrier. Puzzle depth over piloting skill. Matches "short sessions, deep mastery". | High — the whole UI is built around it. |
| D2 | **In-repo pnpm workspace**; extract `astro-engine` only when a second game needs it. | Ships a playable build months earlier. Avoids designing a public API for hypothetical consumers. The layering rule (§11.1) preserves the option. | Low — `git filter-repo` on a clean package boundary. |
| D3 | **Static site + serverless leaderboard** with server-side replay verification. | The daily challenge is the retention hook (M5, M6) and it is worthless without a trustworthy board. The sim core runs unchanged in a Worker, which also proves D2's layering. | Medium — the client works without it; the backend is additive. |
| D4 | **Light heist framing.** Contract briefs and terse comms, no characters on screen, no cutscenes. | Personality without an art or writing pipeline. Briefs double as the tutorial layer. | Low — text and CSS. |
| D5 | **Analytic Keplerian propagation**, not numerical integration, for the game timeline. | State at time *t* is a pure function of (state₀, Δt). Scrubbing is instant, determinism is near-trivial, and there is no accumulated integration error. A numerical integrator still ships, but only as a *test oracle*. | High — it is the shape of the sim. |
| D6 | **The sim core is 3D from day one**; v1.0 *content* is coplanar and the *view* is 2D. | Zero physics rework when inclination arrives in v1.1. Costs nothing now — a 3D vector with `z = 0` is the same code. | None. |
| D7 | **Canvas 2D**, not WebGL, for v1.0. | The scene is a few dozen polylines and sprites. WebGL is a dependency and a compatibility surface we do not need yet. | Medium — renderer package is behind an interface (§11.8). |
| D8 | **HUD and all text in DOM; only the orbit view in canvas.** | Screen readers, text selection, browser zoom, and i18n all work for free. Canvas-drawn text is an accessibility dead end. | High. |
| D9 | **Preact + `@preact/signals`** for the UI shell. | React-shaped API most contributors already know, at ~4 kB. Fine-grained signals suit a HUD updating at 60 Hz without re-rendering panels. React remains a drop-in via `preact/compat` if this proves wrong. | Low — revisit at M2 exit. |
| D10 | **Delta-v is a scalar tank** in v1.0; no mass, Isp, or rocket equation. | Removes propellant bookkeeping from the learning curve. The rocket equation is a *v1.2 mechanic*, gated behind understanding delta-v first. | Low — additive, and already a documented departure. |
| D11 | **No accounts.** Leaderboard identity is a locally generated keypair plus a chosen handle. | Zero PII, zero password reset flow, zero GDPR surface beyond rate-limiting IPs. | Medium. |
| D12 | **Par values are published, and beatable.** | Honesty. If a player beats our par we were wrong about the optimum, and we want to know. | None. |
| D13 | **Scenarios are data** (JSON), validated by schema, loaded at runtime. | Content without code. Enables the v1.3 editor and community contracts with no engine change. | Medium if deferred. |
| D14 | **English only at v1.0**, but no hard-coded strings. | Localisation is a v1.4 candidate; retrofitting string extraction is miserable. | Low if done now, high if not. |

---

## 6. Game design

### 6.1 The core loop

```
                        ┌──────────────────────────────┐
                        │        CONTRACT BOARD        │
                        │  pick a job                  │
                        └───────────────┬──────────────┘
                                        │
                        ┌───────────────▼──────────────┐
                        │          BRIEFING            │
                        │  target · budget · deadline  │
                        └───────────────┬──────────────┘
                                        │
        ┌───────────────────────────────▼──────────────────────────────┐
        │                          PLANNER                             │
        │                                                              │
        │   add node ──► drag Δv ──► watch prediction ──► scrub time   │
        │      ▲                                              │        │
        │      └──────────────────────────────────────────────┘        │
        │                    "what if I…"                              │
        │                                                              │
        │   readouts: apoapsis · periapsis · period · Δv left ·         │
        │             closest approach distance & relative speed       │
        └───────────────────────────────┬──────────────────────────────┘
                                        │ COMMIT
                        ┌───────────────▼──────────────┐
                        │          EXECUTION           │
                        │  playback, skippable         │
                        └───────────────┬──────────────┘
                                        │
                        ┌───────────────▼──────────────┐
                        │           DEBRIEF            │
                        │  medal · Δv vs par · why     │
                        └──┬────────────┬──────────────┘
                           │            │
                      RETRY│            │NEXT
                           └────────────┘
```

**The loop within the loop is the planner.** Everything else is framing. A player spends 80% of their time dragging a node handle and watching a dotted line change shape, and the entire game succeeds or fails on how good that feels.

The retry loop is deliberately frictionless: *Retry* returns to the planner **with your plan intact**, so a failed attempt is a starting point rather than a punishment. This is the single most important tuning decision for M4 (retry appetite) and C1 (frustration).

### 6.2 Player verbs

The complete verb list for v1.0. If a verb is not here, it does not exist.

| Verb | Where | Input | Notes |
| --- | --- | --- | --- |
| **Add node** | Planner | Click the trajectory, or `N` | Placed at the clicked point's epoch; snaps to apsis within 30 s (departure DEP-07) |
| **Move node in time** | Planner | Drag along trajectory, drag on timeline, or `,`/`.` | Constrained to after the previous node and before the horizon |
| **Set Δv** | Planner | Drag prograde/radial handles, numeric entry, or arrow keys | Two axes in v1.0 (prograde ±, radial ±); normal ± exists in the model and appears in v1.1 |
| **Delete node** | Planner | `Del`, or the node's ✕ | |
| **Scrub time** | Planner | Drag the timeline, `←`/`→`, or `Home`/`End` | Purely a view operation; changes nothing |
| **Focus** | Planner | `Tab` cycles ship/target/Earth; scroll to zoom; drag to pan | |
| **Toggle assist** | Planner | Assist tray | See §6.6 |
| **Solve** (Lambert) | Planner, Act V+ | The targeting computer panel | Unlocked content, not a default |
| **Commit** | Planner | `Enter`, or the button | Only enabled when the plan is legal (§6.4) |
| **Playback control** | Execution | `Space` pause, `1`–`5` speed, `S` skip to end | |
| **Retry / Next / Board** | Debrief | Buttons, `R` / `Enter` / `Esc` | |
| **Share** | Debrief | Copies a URL with the replay code | |

Deliberately absent: throttle, attitude, staging, docking alignment, camera roll, target selection during flight, mid-flight replanning. Every one of them is a real thing a spacecraft operator does, and every one of them would dilute the one decision this game is about.

### 6.3 The planner model

This is the heart of both the design and the architecture, so it is stated once, precisely.

A **plan** is an ordered list of maneuver **nodes**. A node is `(epoch, Δv vector in RTN)`. Applying a plan to an initial state produces a **timeline**: an alternating sequence of Keplerian **arcs** and instantaneous **impulses**.

```
 state₀ ──arc 0──► [node 1] ──arc 1──► [node 2] ──arc 2──► … ──► horizon
        Kepler      +Δv₁      Kepler     +Δv₂      Kepler
```

Three consequences fall out of this and they drive most of §11:

1. **Evaluation at any time is O(number of nodes before it)**, not O(steps). Scrubbing to T+31 h is as cheap as scrubbing to T+1 min. There is no simulation to fast-forward.
2. **There is no accumulated numerical error.** The state at the end of a 40-hour coast is one Kepler solve away from the state at its start.
3. **Editing node *k* invalidates only arcs *k* onward.** Dragging the last node's Δv re-solves one arc. This is what makes 60 fps dragging achievable (NFR-011).

The **prediction** the player sees is the timeline, tessellated into polylines. It is not a preview of a simulation — it *is* the simulation. What you see is exactly what will execute. This is a design promise: **the game never surprises you with a discrepancy between prediction and execution.**

#### The horizon

Every contract has a **planning horizon** — the deadline, plus a small margin. Prediction is not drawn past it. This bounds the work, bounds the visuals, and makes the deadline legible as a wall on the timeline rather than a number in a corner.

### 6.4 Objectives, tolerances, and legality

#### Objective types (v1.0)

| Type | Success condition | Used by |
| --- | --- | --- |
| **`reach_orbit`** | Osculating elements match the goal within tolerance, held at the end of the plan | Contracts 01, 02 |
| **`intercept`** | ∣Δr∣ ≤ 1 000 m relative to target at some epoch | Contracts 03, 13 |
| **`rendezvous`** | ∣Δr∣ ≤ 100 m **and** ∣Δv∣ ≤ 0.5 m/s, simultaneously | Contracts 08–10, 14, 15, 18 |
| **`soft_rendezvous`** | Rendezvous with ∣Δv∣ ≤ 0.1 m/s | Contract 10 |
| **`station`** | Mean longitude within ±0.05° of a slot, drift ≤ 0.01°/day | Contract 07 |

Tolerances are **gameplay departures**, not physics, and every one appears in the table in §7.5. They are shown to the player in the briefing and in the HUD — never hidden.

#### Legality — what blocks *Commit*

A plan is illegal, and *Commit* is disabled with a specific reason, if any of:

| Code | Condition | Message |
| --- | --- | --- |
| `L1` | Σ∣Δv∣ > budget | "Over budget by 24 m/s" |
| `L2` | Any trajectory point below 100 km altitude | "Trajectory intersects the atmosphere at T+02:14" |
| `L3` | Plan extends past the deadline | "Last burn is after the deadline" |
| `L4` | Any arc is hyperbolic or escapes the horizon | "Trajectory escapes Earth" |
| `L5` | Two nodes within 1 s of each other | "Merge these burns" |
| `L6` | Objective not met anywhere in the timeline | *(warning only — commit is allowed; failing is allowed)* |

`L6` is deliberately a warning. **Committing a plan you know will fail is a legitimate way to learn**, and the debrief for a near-miss is one of the best teaching moments the game has.

#### Failure conditions during execution

Because prediction *is* execution (§6.3), there are no surprise failures. Execution can only end in: objective met, deadline reached without success, or a constraint violation (§6.5) that the planner already warned about. The plan is checked at commit; execution is playback.

### 6.5 Constraints and complications

Complications are what stop Act V from being "run the solver". Each is a real orbital-operations concern, dressed as a heist problem.

| Constraint | Real concept | Game rule | First seen |
| --- | --- | --- | --- |
| **Δv budget** | Propellant | Hard cap on Σ∣Δv∣ | C01 |
| **Deadline** | Mission window | Hard cap on mission elapsed time | C01 |
| **Burn count** | Operational complexity | Soft cap; exceeding it forfeits Gold | C04 |
| **Blackout** | Ground-station visibility | No burn while within a station's elevation cone | C16 |
| **Eclipse window** | Umbra passage | Burns *only* while in Earth's shadow | C17 |
| **Approach speed cap** | Docking safety | ∣Δv_rel∣ at closest approach ≤ limit | C10 |
| **Altitude floor** | Atmospheric drag | Never below 100 km (hard, always on) | C01 |
| **No-fly shell** | Congested altitude band | Never within an annulus of radii | C18 |

Constraints are evaluated **during planning**, drawn on the timeline as shaded bands, and shown on the orbit view where they are geometric. A player never discovers a constraint by failing it.

### 6.6 Assists and the difficulty dial

There is no difficulty setting. There is a set of assists, each individually toggleable, each of which affects medal eligibility. This lets P1 and P2 play the same contract at their own level, and makes the leaderboard comparable.

| Assist | Default | What it gives | Medal effect |
| --- | --- | --- | --- |
| **Trajectory prediction** | On, cannot be disabled | The dotted future path | None — this is the medium |
| **Element readouts** | On | Apoapsis, periapsis, period, eccentricity | None |
| **Closest-approach markers** | On | Predicted ∣Δr∣, ∣Δv_rel∣, and the epoch, marked on both orbits | Disabling earns the *Blind* modifier |
| **Node snapping** | On | Snap to apsis / node crossings within 30 s | None |
| **Constraint preview** | On | Shaded illegal regions on the timeline | Disabling earns *Blind* |
| **Targeting computer** (Lambert) | Off; unlocked at C13 | Solves the transfer for a chosen departure/arrival pair | Using it caps the contract at Silver unless the contract is designed around it (Act V) |
| **Porkchop plot** | Off; unlocked at C14 | Δv contour over the departure × arrival plane | As above |
| **Coach marks** | On for C01–C04 | Contextual hints | None |

**Why the targeting computer is not cheating.** Lambert's problem answers "what transfer connects these two points in this time?". It does not answer "*which* departure and arrival should I choose?" — and that question is the actual optimisation. Handing the player a solver turns Act V from arithmetic into search, which is the more interesting game. Acts I–IV exist to make sure they understand what the solver is doing before they get it.

### 6.7 Scoring, par, and medals

#### Par

Every contract publishes two par values:

- **`par_dv`** — the delta-v of the reference optimal solution, computed by the scenario author's solver and stored in the scenario file with a note on how it was derived.
- **`par_time`** — the mission elapsed time of that same solution.

Par is **not** a hidden developer score. It is displayed in the briefing and the debrief, and `docs/PARS.md` records the derivation for each. If a player beats `par_dv`, that is a bug report about our optimum, and the debrief says so and offers to file it (D12).

#### Medals

| Medal | Condition |
| --- | --- |
| **Bronze** | Objective met, within budget and deadline |
| **Silver** | Bronze, and Δv ≤ `par_dv` × 1.10, and time ≤ `par_time` × 1.25 |
| **Gold** | Silver, and Δv ≤ `par_dv` × 1.02, and time ≤ `par_time` × 1.10, and burn count ≤ `par_burns` |
| **Clean Job** | Gold with no medal-affecting assists enabled |

Medals are per-contract and cumulative — earning Gold does not remove Bronze. Progression gates on **Bronze count**, never on Gold, so a player is never blocked by an optimisation they cannot find.

#### Leaderboard ranking

Deliberately **not** a composite score. A single formula invites arguments about weights and rewards gaming the formula rather than the orbit. Daily-challenge ranking is lexicographic:

1. Δv used, ascending
2. Mission elapsed time, ascending
3. Submission timestamp, ascending

Two boards per day: **Assisted** (any assists) and **Clean** (no medal-affecting assists). Same scenario, separate rankings.

### 6.8 Progression — the contract list

Six acts, 18 contracts. Each act introduces exactly one new idea and then makes you use it under pressure. Unlock rule: an act opens when **⌈2/3⌉ of the previous act's contracts have Bronze**.

The Δv and time figures below are **computed from the constants in §7.3** and are indicative targets for content design. They are not authoritative — each becomes a validation test (§13.4), and the scenario file's value is whatever that test confirms.

#### Act I — *Getting Off The Ground* — transfers

| # | Title | Objective | Setup | Budget | Par Δv | Par time | Teaches |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | **Shakedown** | `reach_orbit` | Circular 400 km; raise apoapsis to 800 km | 200 m/s | 109 m/s | 46 min | **A prograde burn raises the orbit on the *opposite* side.** The single most important counter-intuitive fact in the game, delivered in one burn. |
| 02 | **Round Trip** | `reach_orbit` | Complete the transfer — circularise at 800 km | 260 m/s | 217 m/s | 48 min | A transfer is *two* burns. The second one is at apoapsis, half a period later. |
| 03 | **Cold Open** | `intercept` | Target in a 800 km circular orbit, phase given | 300 m/s | 217 m/s | 48 min | The transfer must *arrive when the target is there*. Departure timing is a free variable. |
| 04 | **Long Haul** | `reach_orbit` | 400 km → GEO | 4 200 m/s | 3 854 m/s | 5 h 17 m | Scale. Delta-v is expensive, and this is what getting to GEO actually costs. Introduces the burn-count cap. |

#### Act II — *Timing Is Everything* — phasing

| # | Title | Objective | Setup | Budget | Par Δv | Par time | Teaches |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 05 | **Tailgate** | `intercept` | Same 400 km orbit, target 40° **ahead** | 250 m/s | 72 m/s (8 revs) | 12 h 10 m | **To catch something ahead of you, burn retrograde.** Drop lower, go round faster. The click. |
| 06 | **Overtake** | `intercept` | Same orbit, target 25° **behind** | 250 m/s | 44.0 m/s (8 revs) | 12 h 27 m | The mirror image: to let something catch *you*, climb. Note the symmetry with C05: there the **altitude floor** caps how cheap you can go, here the **deadline** does. |
| 07 | **Slot Machine** | `station` | GEO; reach a slot 3.0° east within 12 days | 25 m/s | 1.7 m/s | 10 d 4 h | **The delta-v/time trade, at its most extreme.** 1.7 m/s and ten days, or 3.7 m/s and five. Nothing else in the game makes the trade this stark. |

#### Act III — *Close Enough To Touch* — rendezvous

| # | Title | Objective | Setup | Budget | Par Δv | Par time | Teaches |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 08 | **Handshake** | `rendezvous` | 400 km → 800 km, arbitrary target phase | 400 m/s | TBD | TBD | Intercept is not rendezvous. You must match **velocity** too — the arrival burn is not optional. **Design note:** a pure Hohmann costs 216.7 m/s but only works if you wait for the right departure phase. The deadline is tuned during authoring so that waiting does not fit, forcing a phasing-plus-transfer plan. That tuning *is* the par derivation. |
| 09 | **Dead Drop** | `rendezvous` | Target in an eccentric orbit (e ≈ 0.3) | 600 m/s | TBD | TBD | Eccentric targets move at different speeds at different points. Where you meet matters as much as when. |
| 10 | **Quiet Approach** | `soft_rendezvous` | Rendezvous with ∣Δv_rel∣ ≤ 0.1 m/s at closest approach | 450 m/s | TBD | TBD | Terminal precision. Introduces the fine-adjust interaction (§8.5.4). |

#### Act IV — *The Long Way Round* — the trade

| # | Title | Objective | Setup | Budget | Par Δv | Par time | Teaches |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 11 | **Detour** | `reach_orbit` | 400 km → 108 450 km circular (r₂/r₁ = 16) | 4 200 m/s | 4 031 m/s (bi-elliptic) | 17 d | **Bi-elliptic beats Hohmann above r₂/r₁ ≈ 15.6.** Hohmann costs 4 112 m/s in 19 h; bi-elliptic costs 4 031 m/s in 17 days. The budget makes Hohmann impossible; the deadline makes bi-elliptic expensive. Pick. |
| 12 | **Patience** | `rendezvous` | Same target reachable fast-and-costly or slow-and-cheap | Tight both ways | TBD | TBD | There is no single "best" trajectory — only best *for a constraint*. |

#### Act V — *Targeting Computer* — Lambert

| # | Title | Objective | Setup | Budget | Par Δv | Par time | Teaches |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 13 | **Snapshot** | `intercept` | Arrival epoch **fixed** by the contract | 500 m/s | TBD | fixed | Lambert's problem, stated: two positions and a time of flight determine the transfer. Unlocks the targeting computer. |
| 14 | **Porkchop** | `rendezvous` | Departure and arrival both free | 500 m/s | TBD | TBD | The solver does not choose *for* you. Unlocks the porkchop plot; the game becomes a search over a 2D landscape. |
| 15 | **Second Pass** | `rendezvous` | Direct transfer is over budget; a multi-revolution solution is not | 350 m/s | TBD | TBD | Multi-rev Lambert. Waiting is a maneuver. |

#### Act VI — *Complications* — operations

| # | Title | Objective | Setup | Budget | Par Δv | Par time | Teaches |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 16 | **Blackout** | `rendezvous` | Two ground stations; no burns inside their cones | 400 m/s | TBD | TBD | Ground-station visibility. Your burn epochs are no longer free. |
| 17 | **Eclipse Run** | `rendezvous` | Burns permitted **only** in Earth's shadow | 450 m/s | TBD | TBD | Eclipse geometry. The umbra is a moving window you must plan into. |
| 18 | **The Big Score** | `rendezvous` | Phasing + Lambert + a blackout + a no-fly shell, tight budget | 600 m/s | TBD | TBD | Everything at once. The capstone. |

> Par values marked TBD are computed during content authoring (issue per contract, §15.6) and land in the scenario file with their derivation.

### 6.9 The daily challenge

One procedurally generated contract per UTC day, identical for everyone, seeded by the date.

- **Generation:** a seeded PCG32 stream picks an archetype (transfer-and-rendezvous / phasing / Lambert-window), then samples orbit parameters from a curated band, then runs the reference solver to establish par and to *reject* scenarios that are trivial, impossible, or degenerate. Rejection sampling with a hard iteration cap keeps generation deterministic and fast (NFR-013).
- **Attempts:** unlimited. Your best run stands.
- **Submission:** the replay code, submitted to the leaderboard (§11.10), verified server-side (§11.11).
- **Availability:** the previous 30 days are playable and browsable; older days remain playable by URL but are read-only on the board.
- **Streaks:** a local, private streak counter. No pressure mechanics, no notifications.

The daily is the answer to M5 and M6. It is also the only part of v1.0 that needs a server, which is why §11.10 is scoped to be small enough to fail gracefully — if the leaderboard is down, the daily is still playable and submissions queue locally.

### 6.10 Meta and economy

Deliberately thin. Contracts pay a **fee** in credits; credits do nothing except appear on your record and rank your career total. There is no shop, no upgrades, no unlockable hardware. The reward for playing well is a better number and a harder contract.

The one exception is the **targeting computer**, which is unlocked by progression rather than purchase (§6.6).

Rationale: any spendable currency creates an optimisation problem *outside* the orbital mechanics, and every minute spent on that is a minute not spent on the thing this game is about.

### 6.11 Failure, retry, and undo

| Situation | Behaviour |
| --- | --- |
| Editing a plan | Full undo/redo stack, 50 deep, `Ctrl+Z` / `Ctrl+Shift+Z`. Every node add/move/delete/Δv change is one entry. |
| Illegal plan | *Commit* disabled with the specific reason (§6.4). Never a silent disable. |
| Committed and failed | Debrief explains **why**, with the number: "Closest approach 12.4 km at T+03:51 — you needed 100 m." *Retry* restores the plan. |
| Committed and succeeded, no medal | Debrief shows the gap to Silver, precisely. |
| Stuck | After 3 failed attempts on Acts I–II, an optional hint appears. It never gives the answer; it names the concept and links the Codex entry. |

**There is no lose state and no resource that depletes across attempts.** The only cost of failure is the 40 seconds you spent watching it.

### 6.12 The teaching plan

What the player can do afterwards that they could not before, stated as learning outcomes so they can be tested in playtests (§13.6).

| After | The player can… |
| --- | --- |
| C01 | Predict which side of the orbit a prograde burn raises. |
| C02 | Describe a Hohmann transfer as two burns half a period apart. |
| C04 | State roughly what LEO→GEO costs, and why it is a lot. |
| C05 | Explain why you burn retrograde to catch something ahead of you. |
| C07 | Articulate the delta-v/time trade without prompting. |
| C08 | Distinguish intercept from rendezvous, and say why the second burn exists. |
| C11 | Say when bi-elliptic beats Hohmann, and what it costs. |
| C14 | Read a porkchop plot and identify a launch window. |
| C18 | Plan a constrained multi-burn rendezvous unaided. |

Each outcome maps to a **Codex** entry (§8.3.10) written to be correct enough for P2 and readable enough for P1.

---

## 7. The physics contract

This section is the source for `docs/PHYSICS.md`. Once the repo exists, the repo copy is authoritative and this one is historical.

### 7.1 Model statement

| | |
| --- | --- |
| **Model** | Two-body, point-mass Earth. Impulsive (zero-duration) maneuvers. Massless targets. |
| **Fidelity claim** | Delta-v and time-of-flight for any closed transfer are exact to within float64 round-off of the closed-form two-body solution — target agreement better than 1 × 10⁻⁹ relative against closed form, and better than 0.1% against an independent implementation. **Not suitable for mission planning**: no drag, no J2, no third body. |
| **Propagation** | Analytic, via universal-variable Kepler propagation (D5). No numerical integration in the game path. |
| **Integrator** | DOP853 exists in `@hh/propagation` **as a test oracle only** — used to cross-check the analytic propagator, never to advance game state. |

### 7.2 Conventions

Org defaults (`CLAUDE.md`), with no deviations.

| | |
| --- | --- |
| **Units** | SI throughout the core: metres, seconds, kilograms, radians. Conversion only at the UI and file-format boundary. |
| **Inertial frame** | ECI, J2000-aligned. `r_eci_m`, `v_eci_mps`. |
| **Other frames** | **Perifocal (PQW)** for element→Cartesian; **RTN/LVLH** (radial, transverse, normal) for expressing maneuver Δv relative to the spacecraft's instantaneous state. RTN is the *only* frame the player ever sees a vector in. |
| **Time scale** | **TAI**, as a float64 offset in seconds from J2000 TAI epoch. UTC appears only in the daily-challenge date key and in display strings, and is converted at the boundary. Mission elapsed time (MET) is a separate scalar starting at 0 per contract, and is what the UI shows. |
| **Angle normalisation** | **`[0, 2π)`** for all angles, everywhere, without exception. Any function returning an angle normalises before returning. |
| **Quadrant** | `atan2` only. `acos` on a dot product appears nowhere in the codebase; this is a lint rule, not a convention (NFR-006). |
| **Precision** | float64 for all simulation state. float32 only inside the renderer, after the camera transform. |
| **Vectors** | 3D always (D6). v1.0 content sets `z = 0` and `v_z = 0`; nothing in the core knows or cares. |

#### The RTN frame, stated precisely

For a spacecraft at `r`, `v`:

```
R̂ = r / |r|                     radial, outward
N̂ = (r × v) / |r × v|           normal, along angular momentum
T̂ = N̂ × R̂                      transverse, completing the right-handed set
```

Note `T̂` is *transverse*, not *along-velocity*: they coincide only for circular orbits. The UI labels the transverse axis **"prograde"** because that is the word players know, and the Codex entry for eccentric orbits explains the distinction. This is a naming departure, not a physics one, and it is recorded as such (DEP-10).

### 7.3 Constants

Every constant, its value, and its source. Mirrored in `ATTRIBUTIONS.md`.

| Symbol | Value | Units | Source |
| --- | --- | --- | --- |
| `MU_EARTH` | 3.986004418e14 | m³ s⁻² | EGM-96 / WGS-84 |
| `R_EARTH_EQ` | 6378137.0 | m | WGS-84 semi-major axis |
| `J2_EARTH` | 1.08262668e-3 | — | EGM-96 (**stored, unused in v1.0**; present so v1.2's J2 option has one source of truth) |
| `OMEGA_EARTH` | 7.2921150e-5 | rad s⁻¹ | IERS, mean sidereal rotation rate |
| `R_GEO` | 42164172.9 | m | **Derived at module load** from `MU_EARTH` and `OMEGA_EARTH`: `(μ/ω²)^(1/3)`. Not a literal — an independently written one drifts. An earlier draft of this table said `42164140.0`, which was 33 m from what these constants imply; the error changed the LEO→GEO Hohmann by 0.0005 m/s, so no par moved, but it is exactly the class of mistake deriving the value prevents. |
| `ALT_FLOOR` | 100000.0 | m | Game constant (Kármán line), not physics — see DEP-08 |
| `AU` | 1.495978707e11 | m | IAU 2012 (unused in v1.0; reserved) |

Constants live in exactly one module (`@hh/astro/constants`) and are never redefined. A test asserts that `R_GEO` matches its derivation to 1 m.

### 7.4 Scope of the model

#### What is modelled

- Point-mass Newtonian gravity of a single central body (Earth).
- Keplerian orbits: elliptic (0 ≤ e < 1), parabolic and hyperbolic handled by the universal-variable formulation.
- Impulsive maneuvers: instantaneous change of velocity, no change of position or mass.
- Lambert's problem, zero- and multi-revolution, both transfer directions.
- Event finding: apsis crossings, closest approach between two objects, sphere-crossing (altitude floor), conical visibility (ground station), cylindrical shadow (eclipse).
- Earth rotation, for ground-station positions only — a uniform rotation at `OMEGA_EARTH`. It affects nothing dynamical.

#### What is neglected — and what that costs

Specific and quantitative, because "simplified" is not an answer.

| Neglected | Consequence |
| --- | --- |
| **Atmospheric drag** | Orbits below ~500 km will not decay. A real 400 km orbit loses ~1–2 km/day at solar maximum; ours loses nothing. Matters for contracts longer than a few days at low altitude — which is why C05/C06 are ~12 h and C11's long leg is at high altitude. |
| **J2 and higher geopotential** | No nodal regression (−4.98°/day at 400 km, i = 51.6°) and no apsidal precession. Sun-synchronous orbits cannot be modelled. Since v1.0 content is coplanar and equatorial-equivalent, the visible error is apsidal drift only, which is zero for the circular orbits that dominate Acts I–III. **This is the largest single omission and it is the first candidate for v1.2.** |
| **Third-body (Moon, Sun)** | Negligible below ~50 000 km over hours. At C11's 108 450 km apogee over 17 days it is *not* negligible — lunar perturbation there is real. C11 is therefore flagged in the Codex as "the one contract where a real spacecraft would need a mid-course correction". |
| **Solar radiation pressure** | ~10⁻⁷ m/s² for a typical spacecraft. Irrelevant at our timescales; becomes the entire game in *Solar Sail*. |
| **Relativistic corrections** | ~10⁻⁹ of the Newtonian term. Irrelevant. |
| **Finite burn duration** | See DEP-01. A 200 m/s burn on a real upper stage takes ~60 s and costs ~1% in gravity losses. |
| **Spacecraft mass and propellant** | See DEP-02. |
| **Target maneuvering** | Targets are on fixed Keplerian orbits and never react. |
| **Attitude dynamics** | The spacecraft points wherever the Δv vector says. |

#### Domain of validity

- **Valid for:** closed orbits about Earth, 100 km ≤ altitude ≤ ~400 000 km, eccentricity 0 ≤ e ≤ 0.95, timescales up to ~30 days.
- **Degrades when:** e → 1 (near-parabolic; the universal-variable formulation is stable but the *elements* are not — the UI switches to a state-vector readout above e = 0.95); altitude < 200 km over multi-day spans (drag would dominate); beyond ~200 000 km over weeks (lunar third-body).
- **Known singularities and how we handle them:**

| Singularity | Handling |
| --- | --- |
| **e = 0** (argument of periapsis undefined) | Detected at e < 1e-8. Elements use the **equinoctial** set internally where any element is consumed by logic; the UI shows "circular" and suppresses ω. Never an error. |
| **i = 0** (RAAN undefined) | Detected at i < 1e-8. Same treatment; the UI suppresses Ω. **This is the common case in v1.0, not an edge case** — every v1.0 contract is equatorial-equivalent, so this path is the hot path and is tested first. |
| **e = 0 and i = 0** | Both suppressed; true longitude is the only angular element. |
| **Rectilinear orbits** (h = 0) | Rejected at construction with a typed error. Unreachable in normal play. |

### 7.5 Gameplay departures

**Every place the game knowingly departs from the physics.** This is the honesty rule. Nothing in this table may live in `@hh/astro`, `@hh/propagation`, or `@hh/sim` — every row names a module in `@hh/game` or above. A CI check enforces the import direction (NFR-005).

| ID | Departure | Lives in | Why | Player-visible? |
| --- | --- | --- | --- | --- |
| DEP-01 | **Impulsive burns** — zero duration, no gravity losses | `@hh/game/maneuver` | Finite burns make planning about throttle timing rather than trajectory. Cost: ~1% of Δv for large burns. | Yes — Codex "Why burns are instant" |
| DEP-02 | **Δv as a scalar tank**; no mass, Isp, or rocket equation | `@hh/game/budget` | Propellant bookkeeping is a second learning curve. Deferred to v1.2 as an opt-in mode. | Yes — the budget is labelled "Δv", not "fuel" |
| DEP-03 | **Rendezvous tolerance** 100 m / 0.5 m/s | `@hh/game/objectives` | Real proximity ops is ~0.1 m/s and takes hours. Ours is forgiving so the puzzle ends where the interesting part ends. | Yes — shown in briefing and HUD |
| DEP-04 | **Intercept tolerance** 1 000 m | `@hh/game/objectives` | As above, for grab-and-go objectives. | Yes |
| DEP-05 | **Time acceleration** during execution, up to 100 000× | `@hh/game/playback` | Nobody watches a 17-day transfer. | Yes — the speed is in the HUD |
| DEP-06 | **Fixed Sun direction** for the duration of a contract | `@hh/game/eclipse` | Avoids an ephemeris dependency. The Sun moves 0.041°/h; over a 12 h contract that is 0.5° of umbra rotation, well inside the eclipse-window tolerance. Contracts longer than 3 days (C07, C11) do not use eclipse constraints. | Yes — Codex, and the briefing says "sun-fixed approximation" |
| DEP-07 | **Node snapping** to apsis / node crossing within 30 s | `@hh/game/planner` | Hitting periapsis to the millisecond is not the fun part. Disable-able. | No, but the assist tray lists it |
| DEP-08 | **Altitude floor** at 100 km is an instant fail | `@hh/game/legality` | Stands in for drag and reentry, which are not modelled. | Yes — drawn as a red shell |
| DEP-09 | **Node epochs quantised** to 1/1024 s; Δv components to 1e-4 m/s | `@hh/game/plan` | Exact representability for replay codes and cross-platform verification (§11.4). Both quanta are far below any perceptible or scoring-relevant threshold. | No |
| DEP-10 | The transverse (T̂) axis is **labelled "prograde"** | `@hh/game/ui-labels` | Player vocabulary. They coincide for circular orbits and differ by the flight-path angle otherwise. | Yes — Codex "Prograde vs transverse" |
| DEP-11 | **Targets are massless** and do not perturb the ship | `@hh/sim/world` *(assumption, not a cheat)* | A 5 t satellite's gravity at 100 m is ~3 × 10⁻⁹ m/s². Standard practice. | Yes — Codex |
| DEP-12 | **Par values are the best known**, not the proven optimum | `@hh/game/scoring` | For Lambert contracts, the true optimum is a continuous search. Ours is a fine grid refined by local optimisation. | Yes — D12; the debrief invites a bug report if beaten |

### 7.6 Validation plan

Every claim in §7.1 points at a test. This table becomes the validation table in `docs/PHYSICS.md`, and the "Test" column is filled in as the tests land.

#### Tier 1 — closed form

Catches unit, frame, and algebra errors. Cheap, fast, runs on every commit.

| Property | Check | Reference |
| --- | --- | --- |
| Orbital period | `T = 2π√(a³/μ)` | Kepler's third law |
| Speed at radius | `v² = μ(2/r − 1/a)` | Vis-viva |
| Circular speed | `v = √(μ/r)`; asserts 7 668.6 m/s at 400 km, 3 074.66 m/s at GEO | Derived from §7.3 |
| GEO radius | `R_GEO` satisfies ω²r³ = μ, and agrees with the published 42 164.17 km to 10 m | Derived from §7.3, cross-checked against an independent published value |
| Hohmann Δv | LEO 400 km → GEO = 3 854.0 m/s (2 397.5 + 1 456.5) | Closed form |
| Hohmann time | Same transfer = 19 048.6 s = 5.29 h | `π√(a³/μ)` |
| Bi-elliptic threshold | Hohmann wins below r₂/r₁ = 11.94; bi-elliptic wins above 15.58 | Standard result; verified numerically across the range |
| Escape / energy | `ε = v²/2 − μ/r`, sign matches orbit class | — |

#### Tier 2 — properties

| Property | Check |
| --- | --- |
| Element ↔ Cartesian | Round-trip identity to 1e-12 relative, **including** e = 0, i = 0, and both together |
| Energy conservation | Specific orbital energy constant over a full period to 1e-12 relative |
| Angular momentum | `r × v` constant in magnitude and direction over a period |
| Kepler solver | Converges for e ∈ [0, 0.999] and e ∈ (1, 10], M ∈ [0, 2π), in ≤ 20 iterations, to 1e-13 |
| Universal variable | Agrees with the classical elliptic solver to 1e-11 across the elliptic range |
| Lambert | `lambert(r₁, r₂, Δt)` then propagate `r₁, v₁` for `Δt` returns `r₂` to 1e-9 relative, for 0–5 revolutions, both branches |
| Time reversal | Propagating +Δt then −Δt returns the initial state to 1e-12 |
| Determinism | The same plan evaluated twice, and in both browser and Worker runtimes, agrees within the §11.4 tolerance |

#### Tier 3 — independent references

Closed-form tests share the code's assumptions and cannot catch a wrong constant or a misunderstood convention. These can.

| Case | Reference | How |
| --- | --- | --- |
| State ↔ elements | Curtis, *Orbital Mechanics for Engineering Students*, worked examples in Ch. 4 | Hard-code the book's inputs and outputs. **Cite edition and example number in the test docstring** — do not copy a number from this document. |
| Kepler's equation | Vallado, *Fundamentals of Astrodynamics and Applications*, Ch. 2 worked examples | As above |
| Lambert | Vallado, Ch. 7 worked example; cross-check against `poliastro.iod.izzo` | As above |
| Propagation | `poliastro` / `astropy` two-body propagation over a range of a, e | Generate a fixture file offline with a pinned library version; commit the fixture and the generator script |
| Real orbit | An ISS TLE-derived state vector, propagated 1 orbit, compared to SGP4 | Expected disagreement (we have no J2/drag); the test asserts the *magnitude* of the disagreement is what the model predicts, which is a stronger check than agreement |

> **Process rule:** every textbook citation is verified against the physical book by the person writing the test. No reference value in this document may be copied into a test without independent confirmation. The numbers in §6.8 and §7.6 were computed from §7.3 and are stated to be *checked*, not trusted.

#### Tier 4 — regression

- **Golden trajectories.** A fixture set of ~30 plans with their evaluated states at fixed epochs, committed as JSON. Any change to the propagator that moves a golden value by more than 1e-9 relative fails CI and requires a `docs/PHYSICS.md` update in the same PR.
- **Contract solvability.** Every shipped contract has a stored reference solution; a test asserts it still achieves its objective and still costs `par_dv` ± 0.5%.

---

## 8. User experience

### 8.1 UX principles

1. **The prediction is the truth.** What the dotted line shows is what will happen. No hidden variance, no "approximately". If we cannot draw it accurately we do not draw it.
2. **Never punish ignorance; punish only a committed plan.** Everything before *Commit* is free, reversible, and unlimited.
3. **Real numbers, on demand.** Every readout has a plain-English form by default and a full-precision form on hover/expand. P1 never sees a number they cannot parse; P2 can always get to seven significant figures.
4. **One new idea at a time.** New vocabulary, new controls, and new constraints each arrive alone, and are used before the next arrives.
5. **Nothing is conveyed by colour alone.** Every colour-coded distinction also has a shape, dash pattern, label, or icon.
6. **The player is never waiting.** Scrubbing, dragging, and prediction are instant (NFR-011). Execution playback is skippable at any moment.
7. **Text lives in the DOM.** The canvas draws geometry. Everything readable is selectable, zoomable, translatable, and announceable (D8).

### 8.2 Information architecture

```
                              ┌─────────┐
                              │  TITLE  │
                              └────┬────┘
             ┌─────────────────────┼─────────────────────┐
             │                     │                     │
        ┌────▼─────┐        ┌──────▼──────┐       ┌──────▼──────┐
        │ CONTRACT │        │    DAILY    │       │   CODEX     │
        │  BOARD   │        │  CHALLENGE  │       │             │
        └────┬─────┘        └──────┬──────┘       └─────────────┘
             │                     │
             │   ┌─────────────────┤
             │   │                 │
        ┌────▼───▼─┐        ┌──────▼──────┐
        │ BRIEFING │        │ LEADERBOARD │
        └────┬─────┘        └─────────────┘
             │
        ┌────▼─────┐  ◄──── overlays: node editor · targeting computer ·
        │ PLANNER  │                  porkchop · pause · codex peek
        └────┬─────┘
             │ commit
        ┌────▼─────┐
        │EXECUTION │
        └────┬─────┘
             │
        ┌────▼─────┐
        │ DEBRIEF  │──► retry (Planner) · next (Briefing) · share · board
        └──────────┘

  Always reachable:  SETTINGS · ABOUT/PHYSICS · REPLAY VIEWER (by URL)
```

#### Routing

| Route | Screen | Notes |
| --- | --- | --- |
| `/` | Title | |
| `/#/board` | Contract board | |
| `/#/contract/:id` | Briefing → planner | Deep-linkable (P3) |
| `/#/daily` | Today's daily | |
| `/#/daily/:yyyy-mm-dd` | A past daily | |
| `/#/leaderboard/:yyyy-mm-dd` | Leaderboard | |
| `/#/codex/:slug` | Codex entry | Deep-linkable |
| `/#/replay?s=…&r=…` | Replay viewer | The share URL (§11.6) |
| `/#/settings` | Settings | |

Hash routing, because the site is static on GitHub Pages and must survive a hard refresh on any route without server rewrite rules.

### 8.3 Screen specifications

#### 8.3.1 Title

**Purpose:** identify the game, get the player into it in one click, and communicate "real physics" without saying so.

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                                                                  │
│          ╭──────────────────╮                                    │
│        ╭─╯       ●          ╰─╮      HOHMANN HEIST               │
│       │      ╭───────╮        │                                  │
│       │     │  EARTH  │   ◆   │      Steal things in orbit.      │
│       │      ╰───────╯        │      The only weapon is          │
│        ╰─╮                  ╭─╯      orbital mechanics.          │
│          ╰──────────────────╯                                    │
│           (live, slowly animating                                │
│            transfer, purely decorative)      ▸ START             │
│                                              ▸ CONTINUE  (Act II)│
│                                              ▸ DAILY CHALLENGE   │
│                                              ▸ CODEX             │
│                                              ▸ SETTINGS          │
│                                                                  │
│  astro-game-lab · MIT · the physics ↗            v1.0.0          │
└──────────────────────────────────────────────────────────────────┘
```

| Element | Behaviour |
| --- | --- |
| Background orbit | A real, propagated LEO→GEO transfer looping at ~2 000×. It is the actual sim, not an animation — the first honesty signal. |
| START / CONTINUE | *Continue* appears only with saved progress and jumps to the first incomplete contract. On a fresh visit, *Start* goes straight into C01 briefing — **no menus between a stranger and the game** (G1). |
| "the physics ↗" | Links to `docs/PHYSICS.md`. Present on every screen's footer. |

**States:** first visit (no *Continue*, no *Daily* badge) · returning · daily-available badge · offline (daily greyed with a tooltip).

---

#### 8.3.2 Contract board

**Purpose:** show progress, communicate the shape of the campaign, and make the next contract obvious.

```
┌──────────────────────────────────────────────────────────────────────┐
│  ◂ HOHMANN HEIST                          CREDITS 84.5k    ⚙  ?      │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ACT I · GETTING OFF THE GROUND                          4/4 ●●●●    │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐         │
│  │ 01         │ │ 02         │ │ 03         │ │ 04         │         │
│  │ SHAKEDOWN  │ │ ROUND TRIP │ │ COLD OPEN  │ │ LONG HAUL  │         │
│  │            │ │            │ │            │ │            │         │
│  │ ▲ GOLD     │ │ ▲ GOLD     │ │ ▲ SILVER   │ │ ▲ BRONZE   │         │
│  │ 109.0 m/s  │ │ 217.4 m/s  │ │ 231.8 m/s  │ │ 4012 m/s   │         │
│  │ par 109.1  │ │ par 216.7  │ │ par 216.7  │ │ par 3854   │         │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘         │
│                                                                      │
│  ACT II · TIMING IS EVERYTHING                           1/3 ●○○     │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐                        │
│  │ 05         │ │ 06     ▸   │ │ 07         │                        │
│  │ TAILGATE   │ │ OVERTAKE   │ │SLOT MACHINE│                        │
│  │ ▲ BRONZE   │ │  NEXT      │ │            │                        │
│  │ 96.2 m/s   │ │            │ │            │                        │
│  └────────────┘ └────────────┘ └────────────┘                        │
│                                                                      │
│  ACT III · CLOSE ENOUGH TO TOUCH                🔒 needs 2/3 of Act II│
│  ┌ ─ ─ ─ ─ ─ ┐ ┌ ─ ─ ─ ─ ─ ┐ ┌ ─ ─ ─ ─ ─ ┐                           │
│    ??            ??            ??                                    │
│  └ ─ ─ ─ ─ ─ ┘ └ ─ ─ ─ ─ ─ ┘ └ ─ ─ ─ ─ ─ ┘                           │
│                                                                      │
│  ────────────────────────────────────────────────────────────────    │
│  DAILY CHALLENGE · 2026-09-01                   ▸ 412 submissions    │
│  Not attempted.                                    your best: —      │
└──────────────────────────────────────────────────────────────────────┘
```

| Element | Behaviour |
| --- | --- |
| Card | Number, title, best medal, best Δv, par. Locked cards show act name and unlock rule, never the contract title (preserves the reveal). |
| `NEXT` marker | The first unstarted unlocked contract. Keyboard focus lands here on entry. |
| Act header | Completion count and the unlock rule for the following act. |
| Medals | ▲ shape + label + colour. Never colour alone (principle 5). |
| Daily strip | Always visible. Shows submission count when online, "offline" when not. |

---

#### 8.3.3 Briefing

**Purpose:** state the job in the game's voice, then state the constraints in numbers. Ten seconds to read.

```
┌──────────────────────────────────────────────────────────────────────┐
│  ◂ BOARD                                                             │
│                                                                      │
│   ╔════════════════════════════════════════════════════════════╗     │
│   ║  CONTRACT 05 — "TAILGATE"                                  ║     │
│   ║  client: withheld                            fee: 9 kcr    ║     │
│   ╟────────────────────────────────────────────────────────────╢     │
│   ║  CTX-4 is forty degrees ahead of you in the same orbit and ║     │
│   ║  pulling away is not the problem — catching it is. Its     ║     │
│   ║  keepers run a check every fourteen hours. Be alongside    ║     │
│   ║  before the next one.                                      ║     │
│   ║                                                            ║     │
│   ║  Don't overthink the direction you burn.                   ║     │
│   ╟────────────────────────────────────────────────────────────╢     │
│   ║  OBJECTIVE   Intercept CTX-4        within 1.0 km          ║     │
│   ║  Δv BUDGET   250 m/s                                       ║     │
│   ║  DEADLINE    14 h 00 m                                     ║     │
│   ║  PAR         72 m/s · 12 h 10 m · 2 burns                  ║     │
│   ╟────────────────────────────────────────────────────────────╢     │
│   ║  YOU              CTX-4                                    ║     │
│   ║  400 km circular  400 km circular, +40.0° true anomaly     ║     │
│   ╚════════════════════════════════════════════════════════════╝     │
│                                                                      │
│          [ ACCEPT ]                        best: — · attempts: 0     │
└──────────────────────────────────────────────────────────────────────┘
```

| Element | Behaviour |
| --- | --- |
| Brief text | 30–60 words, second person, terse. Contains the *hint* for teaching contracts, phrased as flavour ("Don't overthink the direction you burn"), never as instruction. |
| Constraint block | The numbers, in display units (km, m/s, h:mm). Every value has a tooltip with the SI value. |
| Par line | Always shown (D12). |
| Complications | Any active constraint from §6.5 gets a row with an icon and one line. |
| ACCEPT | `Enter`. Straight to the planner; no loading screen — scenario JSON is ≤ 8 kB and preloaded. |

**States:** first attempt · replay (shows best) · daily variant (shows the date and the leaderboard link) · locked (unreachable by UI; direct-URL access shows the unlock rule).

---

#### 8.3.4 The planner — the main screen

This is the game. It gets the most specification.

**Desktop / landscape ≥ 1024 px:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◂ 05 TAILGATE          Δv  72.4 / 250 m/s  ▓▓▓░░░░░░░   MET 00:00:00   ⚙ ?   │ ① HUD bar
├───────────────────────────────────────────────────┬──────────────────────────┤
│                                                   │  MANEUVER PLAN           │ ③ plan panel
│                      ·······                      │ ┌──────────────────────┐ │
│                 ····         ····                 │ │▸ 1   T+00:04:12      │ │
│              ···                  ···             │ │  prograde   −36.2    │ │
│            ··          ╭─────╮         ··         │ │  radial       0.0    │ │
│           ··          ╱       ╲          ··       │ │            ✕  ⤢      │ │
│          ··          │  EARTH  │          ·◆ CTX-4│ ├──────────────────────┤ │
│          ·           ╲       ╱           ·        │ │▸ 2   T+12:09:44      │ │
│          ··           ╰─────╯           ··        │ │  prograde   +36.2    │ │
│           ··                           ··         │ │  radial       0.0    │ │
│            ··                        ··           │ │            ✕  ⤢      │ │
│              ···                 ····             │ └──────────────────────┘ │
│                 ····         ····      ▲ YOU      │        + ADD NODE        │
│                      ·······                      │                          │
│                                                   ├──────────────────────────┤
│   ── your current orbit    ···· planned           │  READOUTS                │ ④ readouts
│   ─ ─ target orbit         ◆ target  ▲ you        │  apoapsis   400.0 km     │
│                                                   │  periapsis  274.2 km     │
│                                             ⊕ ⊖ ⌖ │  period      91.3 min    │
│                                                   │  ecc         0.0094      │
│                                                   │ ─────────────────────    │
│                                                   │  CLOSEST APPROACH        │
│                                                   │  0.31 km  @ T+12:09:52   │
│                                                   │  Δv_rel   0.02 m/s   ✓   │
│                                                   ├──────────────────────────┤
│                                                   │  ASSISTS      ▣▣▣□□      │ ⑤ assist tray
├───────────────────────────────────────────────────┴──────────────────────────┤
│ ② TIMELINE                                                                   │
│  0h        2h        4h        6h        8h       10h       12h    ▐ 14h     │
│  ├─────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────┼──────┤  │
│  │◆1                                                          ◆2  ✓        │  │
│  ●────────────────────────────────────────────────────────────────────       │
│  ▲ scrub T+00:00:00                                        deadline ▐        │
│                                                                              │
│           [ ⟲ UNDO ]  [ ⟳ ]                    [ ▶ COMMIT PLAN ]              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Regions:**

| # | Region | Contents | Rules |
| --- | --- | --- | --- |
| ① | HUD bar | Contract, Δv used/budget with a bar, MET at the scrub head, settings/help | Δv bar turns amber at 90%, red and `L1` at >100% |
| ② | Timeline | Full mission window, node markers, scrub head, deadline wall, constraint bands, objective-met tick | Horizontal on desktop; the primary time control |
| ③ | Plan panel | The ordered node list, each expandable to a numeric editor | Reorders automatically by epoch; DOM list, keyboard navigable |
| ④ | Readouts | Osculating elements at the scrub head, and the closest-approach block | Plain units by default; hover/focus reveals full precision |
| ⑤ | Assist tray | Toggles from §6.6, with the medal-eligibility indicator | Collapsed by default; expanding it never pauses anything |

**Orbit view rules:**

- Earth drawn to scale, with the 100 km altitude floor as a thin hazard shell.
- Current orbit solid; planned trajectory dotted; target orbit dashed. Three distinct dash patterns, not three colours (principle 5).
- Ship ▲ and target ◆ at the scrub epoch, with a short motion trail behind each showing the last ~10 minutes.
- Apsis markers on any orbit shown, labelled with altitude.
- Closest-approach epoch marked on both orbits with a tie line between them when the assist is on.
- Camera auto-frames to fit ship orbit + target orbit + planned trajectory on entry and on any change that would push geometry off-screen; manual pan/zoom overrides until the ⌖ recentre button is pressed.

**Narrow / portrait (< 768 px):**

```
┌───────────────────────────────┐
│ ◂ 05    Δv 72/250 ▓▓▓░░  ⚙    │
├───────────────────────────────┤
│                               │
│         (orbit view,          │
│          full width,          │
│          55% height)          │
│                               │
│                        ⊕ ⊖ ⌖  │
├───────────────────────────────┤
│ 0h    4h    8h    12h  ▐14h   │
│ ├─────┼─────┼──────┼───┤      │
│ │◆1                  ◆2 ✓     │
│ ●─────────────────────        │
├───────────────────────────────┤
│ ▣ PLAN(2) │ READOUTS │ ASSIST │  ◄ tabs, not columns
├───────────────────────────────┤
│ ▸ 1  T+00:04:12               │
│   prograde  −36.2  [−][+]     │
│ ▸ 2  T+12:09:44               │
│   prograde  +36.2  [−][+]     │
│           + ADD NODE          │
├───────────────────────────────┤
│  ⟲    [ ▶ COMMIT PLAN ]       │
└───────────────────────────────┘
```

The three side panels collapse into a tab strip. The timeline stays visible at all times — it is the second-most-important control after the orbit view and must never be behind a tab.

---

#### 8.3.5 Node editor (overlay)

Opened by `⤢` on a node, by double-clicking a node marker, or by `E` with a node selected. Anchored to the node, never modal.

```
        ┌────────────────────────────────────┐
        │  NODE 1                         ✕  │
        ├────────────────────────────────────┤
        │  EPOCH                             │
        │  T+ [00]:[04]:[12].[000]           │
        │  ◂ ─────────●───────────── ▸       │
        │  ⊙ periapsis  ⊙ apoapsis  ⊙ free   │
        ├────────────────────────────────────┤
        │  Δv  (RTN, m/s)                    │
        │  prograde   [  −36.2000 ] ◂ ▸      │
        │  radial     [    0.0000 ] ◂ ▸      │
        │  normal     [    0.0000 ] (v1.1)   │
        │  ──────────────────────────        │
        │  magnitude       36.2000 m/s       │
        ├────────────────────────────────────┤
        │  RESULT AFTER THIS BURN            │
        │  apoapsis    400.0 km  (unchanged) │
        │  periapsis   274.2 km  (−125.8)    │
        │  period       91.3 min (−1.3)      │
        ├────────────────────────────────────┤
        │  [ DELETE ]              [ DONE ]  │
        └────────────────────────────────────┘
```

| Control | Behaviour |
| --- | --- |
| Epoch fields | Typed entry, `h:mm:ss.mmm`. Invalid input is rejected on blur with the previous value restored, never silently clamped. |
| Epoch slider | Continuous drag; snaps to apsis within 30 s unless the snap assist is off. |
| Snap radio | Explicit "put this burn at periapsis/apoapsis" — the operation players actually want. |
| Δv fields | Full float64 entry for P2. `◂ ▸` steppers: 1 m/s, ×0.1 with `Shift`, ×10 with `Ctrl`. |
| Result block | Live delta against the pre-burn orbit. The learning surface — a player watching "periapsis −125.8" while dragging prograde *sees* the rule from principle 1 of astrodynamics. |

---

#### 8.3.6 Targeting computer (overlay, Act V+)

```
   ┌──────────────────────────────────────────────────────┐
   │  TARGETING COMPUTER — Lambert solver             ✕   │
   │  ⚠ using this caps this contract at SILVER           │
   ├──────────────────────────────────────────────────────┤
   │  DEPART   T+ [02:00:00]   ◂──────●──────────────▸    │
   │  ARRIVE   T+ [07:30:00]   ◂──────────────●─────▸    │
   │  REVS     ⊙ 0   ○ 1   ○ 2                            │
   ├──────────────────────────────────────────────────────┤
   │  SOLUTION                                            │
   │    departure burn      284.1 m/s   prograde 281.0    │
   │                                    radial    42.0    │
   │    arrival burn        108.9 m/s                     │
   │    total               393.0 m/s   ✓ within budget   │
   │    time of flight        5 h 30 m                    │
   ├──────────────────────────────────────────────────────┤
   │  [ OPEN PORKCHOP ]            [ INSERT AS PLAN ]     │
   └──────────────────────────────────────────────────────┘
```

*Insert as plan* replaces the current plan with the two solved nodes and is a single undo entry. The solution is previewed live on the orbit view while the sliders move.

#### 8.3.7 Porkchop plot (overlay, C14+)

```
   ┌───────────────────────────────────────────────────────────┐
   │  PORKCHOP — total Δv (m/s)                            ✕   │
   ├───────────────────────────────────────────────────────────┤
   │  arrival                                                  │
   │  T+12h ┤▒▒▒▒▓▓▓███████▓▓▓▒▒▒░░░░░░░░░░░░░                  │
   │        │▒▒▓▓▓██████▓▓▒▒░░░░░░░░░░░░░░░░░░                  │
   │  T+09h ┤▓▓██████▓▓▒▒░░░░······░░░░░░░░░░░  ← the valley    │
   │        │███▓▓▒▒░░░░····  ✛  ····░░░░░░░░░                  │
   │  T+06h ┤▓▒▒░░░░····      ▲      ····░░░░░                  │
   │        │▒░░░░····         cursor    ····░░                 │
   │  T+03h ┤░░····                        ····                 │
   │        └────┬─────┬─────┬─────┬─────┬─────┬──              │
   │           T+0h  T+2h  T+4h  T+6h  T+8h T+10h   departure   │
   ├───────────────────────────────────────────────────────────┤
   │  cursor:  depart T+03:20  arrive T+07:10                   │
   │           total 391.4 m/s   ·  best on grid 388.2 m/s ✛    │
   │  ░ <400   · 400–500   ▒ 500–700   ▓ 700–1000   █ >1000     │
   ├───────────────────────────────────────────────────────────┤
   │  [ JUMP TO BEST ]              [ USE THIS SOLUTION ]       │
   └───────────────────────────────────────────────────────────┘
```

Rendered on a separate canvas, computed on a Web Worker (NFR-012), progressive from a coarse grid to fine so the plot appears in < 200 ms and sharpens. Colour is accompanied by a shading/hatch ramp so it survives greyscale and colour-blindness (principle 5); the legend states the bands numerically.

---

#### 8.3.8 Execution

Same orbit view, different chrome. The plan panel becomes an event feed.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  05 TAILGATE          Δv 72.4 / 250        MET 12:09:44        ⏸  ⏭  ✕      │
├───────────────────────────────────────────────────┬──────────────────────────┤
│                                                   │  FLIGHT LOG              │
│              (orbit view, camera follows          │                          │
│               the ship, target framed)            │  T+00:00:00  ignition    │
│                                                   │  T+00:04:12  burn 1      │
│                        ▲──◆   ← closing           │              −36.2 m/s   │
│                                                   │  T+00:04:12  periapsis   │
│                                                   │              274.2 km    │
│                                                   │  T+01:35:41  rev 1       │
│                                                   │  …                       │
│                                                   │  T+12:09:44  burn 2      │
│                                                   │              +36.2 m/s   │
│                                                   │  T+12:09:52  ▸ CLOSEST   │
│                                                   │              0.31 km     │
├───────────────────────────────────────────────────┴──────────────────────────┤
│  ├──────────────────────────────────────────────────────●────┤               │
│  0h                                                    12h  14h              │
│              ▶ 1×   ▶▶ 100×   ▶▶▶ 1000×   ▶▶▶▶ 10000×  [SKIP TO END]         │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Playback speed is a **display** rate, not a simulation rate — the timeline is already solved. Changing speed changes nothing about the outcome (a direct consequence of D5 and worth saying in the Codex).
- `Space` pauses. Pausing does **not** allow editing — that would break the "prediction is truth" promise. It offers *Abort* (back to the planner with the plan intact) instead.
- Burn events flash the relevant Δv on the HUD and play a short cue.
- **Skip to end** is prominent, not hidden. A player on their 12th attempt should not watch 12 hours of coasting again.

---

#### 8.3.9 Debrief

**Purpose:** say what happened, in numbers, and make the next action obvious. This is where learning is consolidated, so it does more work than a results screen usually does.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                        ▲  ▲  ▲                                               │
│                        G O L D                                               │
│                   CONTRACT 05 COMPLETE                                        │
│                                                                              │
│   ┌────────────────────────────────────────────────────────────────────┐     │
│   │             YOU          PAR        BEST KNOWN                     │     │
│   │  Δv        72.4 m/s     72.0        72.0            +0.6%          │     │
│   │  time      12h 09m      12h 10m     12h 10m         −0.1%          │     │
│   │  burns     2            2                                          │     │
│   │  closest   0.31 km      (needed ≤ 1.00 km)                         │     │
│   └────────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│   WHAT HAPPENED                                                              │
│   You dropped into a 274 × 400 km phasing orbit, which is 1.3 minutes         │
│   shorter per revolution. Eight revolutions later you had closed 40°.         │
│   ↗ Codex: Phasing orbits — why slower is faster                             │
│                                                                              │
│   ─────────────────────────────────────────────────────────────────────      │
│   [ ⟲ RETRY ]     [ ▷ NEXT: 06 OVERTAKE ]     [ SHARE ]     [ BOARD ]        │
│                                                    ↗ replay link copied      │
└──────────────────────────────────────────────────────────────────────────────┘
```

**On failure** the same layout, with the result block replaced by the diagnosis:

```
│   ┌────────────────────────────────────────────────────────────────────┐     │
│   │  MISSED                                                            │     │
│   │  Closest approach   12.4 km at T+11:47:03                          │     │
│   │  Needed             ≤ 1.00 km                                      │     │
│   │  Δv used            118.6 of 250 m/s                               │     │
│   │                                                                    │     │
│   │  You arrived 21 minutes early. Your phasing orbit was 4.1 km       │     │
│   │  lower than it needed to be.                                       │     │
│   └────────────────────────────────────────────────────────────────────┘     │
```

**Diagnosis rules.** The failure text is generated from a small rule set over the outcome, not free-form. Rules include: arrived early/late (Δt at closest approach vs the target's arrival), over/under-shot (radial miss), too fast (Δv_rel), ran out of budget, hit the floor, missed the deadline, violated a constraint. Each rule has one sentence and one Codex link. Unmatched outcomes fall back to the bare numbers — **the game never speculates about why**.

If the player beats `par_dv`, an extra block appears: *"You beat our par by 1.4 m/s. Our optimum was wrong — [tell us ↗]"*, linking a pre-filled `physics` issue with the replay code (D12, P2 delight).

---

#### 8.3.10 Codex

Optional, deep-linkable explainers. One entry per concept in §6.12, plus the departures from §7.5 that players ask about.

```
┌──────────────────────────────────────────────────────────────────────┐
│  ◂ CODEX                            PHASING ORBITS                   │
├──────────────────────────────────────────────────────────────────────┤
│  Why slower is faster                                                │
│                                                                      │
│  To catch something ahead of you in the same orbit, you burn          │
│  retrograde — you slow down.                                         │
│                                                                      │
│      ┌──────────────────────────────────────┐                        │
│      │   (small live diagram: two orbits,   │  ← real sim, scrubs     │
│      │    a phasing ellipse, animating)     │    with a slider        │
│      └──────────────────────────────────────┘                        │
│                                                                      │
│  Slowing down lowers the far side of your orbit. A lower orbit has a  │
│  shorter period, so you come round faster and gain angle every        │
│  revolution.                                                          │
│                                                                      │
│  ▸ The numbers    T = 2π√(a³/μ). At 400 km, T = 92.6 min. Drop the    │
│    periapsis to 274 km and a falls to 6 715 km, giving T = 91.3 min.  │
│    That is 1.3 min per revolution, or 5.0° of angle.                 │
│                                                                      │
│  ▸ In the real world   Every ISS visiting vehicle does this. …        │
│                                                                      │
│  ▸ What we simplify    DEP-01, DEP-02 ↗ docs/PHYSICS.md               │
│                                                                      │
│  Seen in: Contract 05 Tailgate · 06 Overtake                          │
└──────────────────────────────────────────────────────────────────────┘
```

Each entry has four layers, progressively disclosed: **the sentence** (P1), **the diagram** (everyone), **the numbers** (P2), **what we simplify** (P2/G3). Diagrams are live simulations, not images — reusing the renderer keeps them correct by construction.

---

#### 8.3.11 Daily challenge & leaderboard

```
┌──────────────────────────────────────────────────────────────────────┐
│  ◂ BOARD        DAILY CHALLENGE · 2026-09-01        ◂ prev  next ▸    │
├────────────────────────────────────────┬─────────────────────────────┤
│  ╔══════════════════════════════════╗  │  LEADERBOARD                │
│  ║ GENERATED CONTRACT               ║  │  ⊙ Clean  ○ Assisted        │
│  ║ rendezvous · eccentric target    ║  ├─────────────────────────────┤
│  ╟──────────────────────────────────╢  │   1  vectorwitch   281.4 m/s│
│  ║ OBJECTIVE  Rendezvous with DL-01 ║  │   2  perijove      284.0    │
│  ║ Δv BUDGET  520 m/s               ║  │   3  ohm_sweet     287.7    │
│  ║ DEADLINE   18 h                  ║  │  ──────────────────────     │
│  ║ PAR        291.6 m/s · 9 h 40 m  ║  │  47  ▸ you        312.9     │
│  ╚══════════════════════════════════╝  │  ──────────────────────     │
│                                        │  48  slingshot     313.1    │
│  YOUR BEST   312.9 m/s · 9 h 51 m      │  49  delta_vee     314.0    │
│  ATTEMPTS    4                         │                             │
│  STREAK      6 days                    │  412 submissions            │
│                                        │  ↻ updated 2 min ago        │
│  [ PLAY ]   [ WATCH #1's RUN ]         │                             │
└────────────────────────────────────────┴─────────────────────────────┘
```

| Element | Behaviour |
| --- | --- |
| Board tabs | Clean / Assisted, per §6.7 |
| Your row | Always pinned into view, even at rank 4 000 |
| Watch a run | Loads that replay code into the replay viewer — **the top run is always watchable**, which is both a teaching tool and the strongest anti-cheat deterrent |
| Offline | Leaderboard panel shows "offline — your run is saved and will submit when you reconnect". The contract remains fully playable. |

---

#### 8.3.12 Settings

Grouped, all persisted locally, all applying immediately.

| Group | Settings |
| --- | --- |
| **Display** | Units (metric km/m·s⁻¹ **default**, or SI-only for P2); angle display (degrees **default** / radians); time format; theme (dark **default** / light / system); UI scale (90–150%) |
| **Accessibility** | Colour-vision palette (default / deuteranopia / protanopia / tritanopia / high contrast); reduce motion; disable background animation; increase line weights; screen-reader verbosity (terse / verbose) |
| **Gameplay** | Default assist set; coach marks on/off; confirm before commit; auto-skip playback after N attempts |
| **Audio** | Master, effects, ambience — three sliders, all default to a modest level, muted by default on first load until the player interacts (browser autoplay policy) |
| **Input** | Full keybinding remap; pointer sensitivity; invert scroll-zoom |
| **Data** | Handle (for the leaderboard); export save (JSON download); import save; clear all local data; what we store (links to §11.12) |

### 8.4 The scale problem

Orbital distances defy linear rendering: Earth's radius is 6 378 km, a LEO orbit sits 400 km above it (6% of a radius), GEO is 6.6 radii out, and C11's target is 17 radii out. A single fixed scale makes either LEO invisible or GEO off-screen.

**Decision: linear scale, auto-framed, with manual zoom.** We do not distort radius.

| Approach | Verdict |
| --- | --- |
| **Linear + auto-frame** ✅ | The camera fits the union of (ship orbit ∪ target orbit ∪ planned trajectory ∪ Earth) with a 12% margin, and re-frames with a 400 ms ease when that union changes by more than 20%. Zoom range is clamped to [0.5×, 40×] of the auto-frame scale. |
| Logarithmic radial | Rejected. It makes an ellipse not look like an ellipse. The visual intuition the game is trying to build would be built on a lie (G3). |
| Fixed zoom regimes | Rejected as a primary mechanism — regime changes are jarring — but the **auto-frame is effectively this**, done continuously. |
| Camera-relative rendering | Adopted at the *numeric* level: positions are transformed to camera space in float64 and only then cast to float32 for the canvas, avoiding precision loss at 10⁸ m scales (NFR-010). |

**LEO legibility.** At LEO-only framing, the orbit sits 6% of a radius above the limb and the two orbits in C01/C02 are 400 km apart on a 6 378 km ball. This is genuinely tight, and it is handled by:
- Auto-framing to the *orbits*, not to Earth — Earth is allowed to overflow the viewport.
- An **altitude ruler** along the radial line to the ship, ticking at sensible intervals.
- Apsis labels carrying altitude in text, so the number is legible even when the geometric separation is a few pixels.

A "compressed radial" *toggle* is a v1.1 candidate for the Codex diagrams only, never for the planner.

### 8.5 Interaction specification

#### 8.5.1 Planner state machine

```
                    ┌────────────┐
        ┌──────────►│    IDLE    │◄──────────┐
        │           └─────┬──────┘           │
        │      click orbit│  select node      │
        │                 ▼        ▼          │
        │        ┌────────────┐ ┌───────────┐ │
        │        │  PLACING   │ │ SELECTED  │ │
        │        └─────┬──────┘ └─┬───┬─────┘ │
        │       commit │   drag Δv│   │drag t │
        │              ▼          ▼   ▼       │
        │        ┌────────────┐ ┌───────────┐ │
        └────────┤  SELECTED  │ │ DRAGGING  ├─┘
                 └────────────┘ └───────────┘
                                      │ release → recompute arcs k…n
                       ┌──────────────┘
                       ▼
                 ┌───────────┐  legal   ┌──────────┐
                 │ EVALUATED ├─────────►│ COMMITTED│──► EXECUTION
                 └───────────┘          └──────────┘
                       │ illegal
                       └──► commit disabled + reason (§6.4)

  Orthogonal: SCRUBBING (view-only, never mutates) can overlay any state.
```

#### 8.5.2 Pointer

| Action | Result |
| --- | --- |
| Click empty space | Deselect |
| Click the planned trajectory | Place a node at that point's epoch (snapped per DEP-07) |
| Click a node marker | Select |
| Double-click a node marker | Open the node editor |
| Drag a node marker along the trajectory | Change its epoch |
| Drag a node's prograde/radial handle | Change that Δv component; magnitude shown live |
| Drag empty space | Pan (cancels auto-frame until ⌖) |
| Scroll / pinch | Zoom about the cursor |
| Drag the timeline | Scrub |
| Hover any readout | Full-precision tooltip |
| Right-click a node | Context menu: delete, snap to periapsis, snap to apoapsis, zero Δv |

Handles have a **32 px hit target** regardless of visual size, and the visual size is constant in screen space (they do not shrink when zoomed out).

#### 8.5.3 Keyboard

Complete map. All remappable (§8.3.12).

| Key | Action | | Key | Action |
| --- | --- | --- | --- | --- |
| `N` | Add node at scrub head | | `Space` | Play/pause (execution) |
| `Del` / `Backspace` | Delete selected node | | `1`–`5` | Playback speed |
| `E` | Edit selected node | | `S` | Skip to end |
| `Tab` / `Shift+Tab` | Cycle nodes | | `Enter` | Commit / confirm |
| `,` / `.` | Nudge node epoch ∓1 s (`Shift` ×0.1, `Ctrl` ×60) | | `Esc` | Back / close overlay |
| `↑` / `↓` | Prograde ±1 m/s (`Shift` ×0.1, `Ctrl` ×10) | | `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `←` / `→` | Radial ±1 m/s (same modifiers) | | `R` | Retry (debrief) |
| `Home` / `End` | Scrub to start / deadline | | `?` | Keyboard help overlay |
| `[` / `]` | Scrub ∓1 min (`Shift` ×0.1, `Ctrl` ×60) | | `F` | Recentre camera |
| `+` / `-` | Zoom | | `C` | Codex for the current concept |

Every action in the game is reachable by keyboard alone (NFR-016). The planner is fully operable without a pointer.

#### 8.5.4 Touch

| Gesture | Action |
| --- | --- |
| Tap trajectory | Place node |
| Tap node | Select (opens the node editor directly on narrow layouts — precision dragging is not viable on a phone) |
| Drag node | Change epoch |
| Pinch | Zoom |
| Two-finger drag | Pan |
| Drag timeline | Scrub |
| Long-press node | Context menu |

On narrow layouts, Δv is edited **only** through the numeric stepper UI, never by dragging a handle. Fine adjustment for `soft_rendezvous` (C10) uses the steppers with a ×0.1 toggle button, since modifier keys are unavailable.

### 8.6 Feedback and messaging

| Situation | Treatment |
| --- | --- |
| Illegal plan | Commit button disabled, with the reason inline beneath it. Never a tooltip-only explanation. The offending element (a node, a timeline region) is highlighted simultaneously. |
| Constraint violation while dragging | The timeline band the node has entered turns solid, and the node marker gains a ⚠. No modal, no sound. |
| Objective achieved in prediction | A green ✓ appears on the timeline at that epoch, and the closest-approach block shows ✓. **This is the strongest positive feedback in the game and it fires during planning, before commit.** |
| Save failure (quota, private mode) | A dismissible banner: "Progress can't be saved in this browser mode. The game still works." Never blocks play. |
| Network failure on submit | Silent queue, retried on reconnect. A subtle ⏳ on the daily strip. |
| First-time coach marks | Three per contract maximum, in C01–C04 only, dismissible permanently. |

### 8.7 Empty, loading, and failure states

| State | Treatment |
| --- | --- |
| First load | Inline skeleton of the title screen; the app is < 400 kB gzip and should be interactive before a spinner would appear (NFR-020). If it takes > 800 ms, a minimal progress bar. |
| No saved progress | Board shows Act I unlocked, everything else locked, `NEXT` on C01 |
| Leaderboard empty (new day) | "No submissions yet. Be first." — with the submit affordance, not an error |
| Leaderboard unreachable | Panel replaced with an offline notice and a retry link. The rest of the screen is unaffected. |
| Scenario fails schema validation | Refuse to load it, show which field failed, and offer to report it. Never load a partially valid scenario. |
| Replay code invalid or from a future schema version | Explicit message naming the version mismatch, with a link to the release that can read it |
| WebGL/canvas unavailable | Static message with the browser-support matrix (§11.15) |

### 8.8 Accessibility specification

Target: **WCAG 2.2 AA** for all DOM UI. The orbit view is a canvas and is handled by the parallel-representation rule below.

| Area | Requirement |
| --- | --- |
| **Colour** | Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI boundaries and graph lines. Four palettes shipped (default, deuteranopia, protanopia, tritanopia) plus a high-contrast mode. **No information by colour alone** — orbits differ by dash pattern, medals by shape and label, porkchop bands by hatch. |
| **Canvas parity** | Every piece of information drawn on the canvas has a DOM equivalent: the plan panel mirrors node markers, the readouts mirror apsis labels, the closest-approach block mirrors the tie line. A screen-reader user can play the entire game from the DOM. |
| **Live regions** | An `aria-live="polite"` region announces: node added/moved/deleted with its new Δv, closest-approach changes crossing the objective threshold, legality changes, and execution milestones. Verbosity is a setting. |
| **Keyboard** | 100% of actions keyboard-reachable (§8.5.3). Visible focus ring, never suppressed. Logical tab order. No keyboard traps. Skip-to-content link. |
| **Motion** | `prefers-reduced-motion` respected: camera re-framing becomes instant, the title background stops, playback defaults to skip-to-end, and no element animates purely decoratively. |
| **Text** | Minimum 14 px effective; UI scale 90–150%; the layout survives 200% browser zoom without horizontal scroll; no text baked into images. |
| **Timing** | No time limits on any interaction. The deadline is in-fiction mission time, never wall-clock. |
| **Input** | Pointer targets ≥ 44 × 44 px on touch, ≥ 32 × 32 px hit areas on desktop. No gesture is the only way to do anything. |
| **Audio** | Nothing is conveyed by sound alone; every audio cue has a visual counterpart. |
| **Language** | `lang` set; abbreviations expanded on first use; the Codex offers a plain-language summary at the top of every entry. |

**Testing:** axe-core in CI on every route (NFR-017), plus a manual NVDA + VoiceOver pass at M6, plus a keyboard-only playthrough of Acts I–III as a release gate.

### 8.9 Localisation readiness

English only at v1.0 (D14), but: all user-facing strings live in a single message catalogue keyed by ID; no string concatenation for sentences; numbers and dates formatted through `Intl`; layouts tested at +40% string length; the scenario schema carries brief text as a keyed reference rather than a literal, so contract text is translatable without touching scenario logic.

---

## 9. Visual and audio design

### 9.1 Art direction

**"Mission control, after hours."**

The reference is not science fiction. It is a real flight dynamics console — dark, dense, monospaced, phosphor-bright against near-black — with just enough grain and warmth to feel like a place rather than a spreadsheet. The heist framing shows up in the *typography and copy*, not in the rendering: a job board that looks like a job board, contract cards that look like documents, comms text that looks like it came off a printer.

Rules:

- **The orbit view is a plot, not a scene.** No starfield parallax, no lens flare, no nebulae. Earth is a flat disc with a coastline outline and a terminator, drawn in two colours. The trajectory is the artwork.
- **Line weight carries meaning.** Current orbit heavy, planned trajectory medium and dotted, target dashed, historical trail light and fading.
- **Motion is data.** Nothing moves that is not moving in the simulation, except deliberate UI transitions ≤ 200 ms.
- **Density over decoration.** Panels are tight, monospaced, and full of numbers. P2's aesthetic pleasure comes from information density; P1's comes from it being legible.

### 9.2 Colour and type

Tokens, not hex codes in components. Every token is defined in all five palettes (default, deuteranopia, protanopia, tritanopia, high contrast).

| Token | Role | Default (dark) |
| --- | --- | --- |
| `--bg` | Console ground | near-black, slightly warm |
| `--bg-panel` | Panel fill | one step up from ground |
| `--fg` | Primary text | off-white |
| `--fg-dim` | Secondary text, units | 60% |
| `--accent` | Player ship, current orbit, primary action | cyan family |
| `--target` | Target ship and orbit | amber family |
| `--plan` | Planned trajectory, nodes | white/neutral bright |
| `--ok` | Objective met, within tolerance | green family |
| `--warn` | Approaching a limit | amber |
| `--bad` | Illegal, violated, failed | red family |
| `--earth` | Earth disc | deep blue-grey |
| `--hazard` | Altitude floor, no-fly shells | red, 15% alpha, hatched |
| `--grid` | Timeline rules, plot axes | 20% |

Because `--accent` and `--target` must be distinguishable by *everyone*, they are additionally separated by:
- shape (▲ ship vs ◆ target),
- dash pattern (solid vs dashed),
- and a persistent text label at the marker.

**Type:** one monospace family for all numeric and console text (system stack: `ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace`); one humanist sans for brief prose and Codex body. **No custom webfonts at v1.0** — they cost bytes (NFR-020) and a font-loading failure mode, and the system monospace stack is exactly the right register. Numeric readouts use tabular figures so values do not jitter while dragging.

### 9.3 The orbit rendering language

| Element | Treatment |
| --- | --- |
| Earth | Filled disc, coastline outline, day/night terminator (from the fixed Sun vector, DEP-06). Drawn to scale, always. |
| Altitude floor | Thin hatched shell at 100 km. Always visible; turns solid red when the trajectory intersects it. |
| Current orbit | Solid, heavy, `--accent` |
| Planned trajectory | Dotted, medium, `--plan`. Dots are spaced by **equal time**, not equal distance — so their density *shows the speed*, dense at apoapsis and sparse at periapsis. A free, correct, and beautiful piece of physics intuition. |
| Target orbit | Dashed, medium, `--target` |
| Ship / target | ▲ / ◆ at the scrub epoch, constant screen size, with a 10-minute fading trail |
| Maneuver node | ◆ on the trajectory with a two-axis handle cross; selected nodes get a ring |
| Apsis markers | Small ticks with altitude labels; suppressed for near-circular orbits (e < 1e-3) |
| Closest approach | A tie line between the two positions at that epoch, labelled with distance and Δv_rel |
| Ground-station cone | A wedge from the station's ground position, rotating with Earth |
| Umbra | A cylinder shadow projected anti-sunward, drawn as a translucent band |
| Objective marker | A ✓ ring at the epoch where the objective is met in the prediction |

**Tessellation:** orbits are sampled in **eccentric anomaly**, not true anomaly or time, which distributes vertices evenly along the arc regardless of eccentricity. Adaptive subdivision refines where screen-space curvature exceeds 0.5 px. Target ≤ 512 vertices per orbit (NFR-011).

### 9.4 Motion

| Transition | Duration | Easing |
| --- | --- | --- |
| Screen change | 160 ms | ease-out, cross-fade |
| Camera re-frame | 400 ms | ease-in-out |
| Panel expand/collapse | 120 ms | ease-out |
| Value change in a readout | 0 ms | **instant** — never tween a number the player is dragging |
| Medal reveal (debrief) | 600 ms | one deliberate flourish, the only one in the game |

All of the above become 0 ms under `prefers-reduced-motion`, except the medal reveal, which becomes a cross-fade.

### 9.5 Audio

Sparse, functional, and skippable. Muted until first interaction; three sliders in settings.

| Cue | Sound |
| --- | --- |
| Node placed | Soft mechanical click |
| Node dragged | Nothing (it would be maddening) |
| Δv crosses budget | Low warning tone, once |
| Objective met in prediction | A short, clean rising two-note tone — **the reward sound of the game** |
| Burn executes | A brief thruster hiss, pitch-scaled to Δv magnitude |
| Contract complete | Three ascending notes by medal tier |
| Contract failed | A single low tone, not a stinger. Failure is not shameful. |
| Ambience | A very quiet console hum during planning, off by default |

**Constraint:** total audio payload ≤ 200 kB, loaded lazily after first interaction, so it never blocks NFR-020.

### 9.6 Asset inventory and licensing

| Asset | Source | Licence | Notes |
| --- | --- | --- | --- |
| UI icons | Hand-drawn SVG, ≤ 20 glyphs, inline | CC BY 4.0 (ours) | No icon-font dependency |
| Earth coastlines | Natural Earth 1:110 m, simplified | Public domain | ~15 kB as simplified GeoJSON; source and processing script in `ATTRIBUTIONS.md` |
| Typefaces | System stacks only | n/a | No embedded fonts at v1.0 |
| Audio | Commissioned or self-produced | CC BY 4.0 (ours) | ~10 short cues. No stock libraries without a checked licence. |
| Logo / OG image | `files/design/logo.png` (existing) | CC BY 4.0 (ours) | Needs an SVG re-draw for the favicon and social card |

**No AI-generated assets** whose training data or output licensing cannot be vouched for — this is org policy in `CONTRIBUTING.md` and applies here. Every third-party asset gets a row in `ATTRIBUTIONS.md` in the same commit that adds it.

---

## 10. Functional requirements

Requirement IDs are stable and permanent. Every issue cites the FRs it satisfies; every FR appears in the traceability matrix (§15.7). "**MUST**" is v1.0 scope; "**SHOULD**" is v1.0 if affordable; "**MAY**" is post-1.0.

### 10.1 Simulation core (FR-0xx)

| ID | Requirement |
| --- | --- |
| FR-001 | The system MUST represent all simulation state in SI units and float64, with position and velocity as 3D vectors carrying an explicit frame. |
| FR-002 | The system MUST convert between Cartesian state vectors and classical orbital elements, in both directions, for elliptic, parabolic, and hyperbolic orbits. |
| FR-003 | The system MUST handle the e = 0 and i = 0 singularities without error, using the conventions in §7.4, and MUST provide an equinoctial element set for internal use. |
| FR-004 | The system MUST solve Kepler's equation for elliptic and hyperbolic orbits, converging to 1e-13 within 20 iterations across e ∈ [0, 0.999] ∪ (1, 10]. |
| FR-005 | The system MUST propagate a state vector by an arbitrary time offset, forwards or backwards, analytically via universal variables. |
| FR-006 | The system MUST apply an impulsive Δv expressed in RTN to a state, producing a new state at the same epoch and position. |
| FR-007 | The system MUST solve Lambert's problem for zero and multiple revolutions, both transfer directions, returning all valid solution branches. |
| FR-008 | The system MUST find, within a bounded time interval: apsis crossings, closest approach between two propagated objects, altitude-shell crossings, conical (ground-station) visibility intervals, and cylindrical-shadow (umbra) intervals. |
| FR-009 | The system MUST provide a numerical integrator (DOP853 class) usable as a validation oracle, and MUST NOT use it to advance game state. |
| FR-010 | The system MUST provide a seeded, platform-independent PRNG (PCG32), and MUST contain no other source of randomness. |
| FR-011 | The simulation core MUST have zero dependencies on DOM, renderer, timers, wall clock, network, or filesystem, and MUST execute unchanged under Node, a browser, and a Cloudflare Worker. |
| FR-012 | All constants MUST be defined exactly once, with a cited source, and R_GEO MUST be verified against its derivation by test. |

### 10.2 Plan and timeline (FR-1xx)

| ID | Requirement |
| --- | --- |
| FR-101 | A plan MUST be an ordered list of nodes, each `(epoch, Δv_rtn)`, with epochs strictly increasing and separated by ≥ 1 s. |
| FR-102 | Applying a plan to an initial state MUST produce a timeline of alternating Keplerian arcs and impulses. |
| FR-103 | The timeline MUST be evaluable at any epoch within the horizon in O(nodes before that epoch), with no iteration over time steps. |
| FR-104 | Editing node *k* MUST invalidate and recompute only arcs *k* through *n*, never arcs before *k*. |
| FR-105 | Node epochs MUST be quantised to 1/1024 s and Δv components to 1e-4 m/s at the moment of entry, so the stored plan is exactly what was played. |
| FR-106 | The system MUST evaluate all objective types in §6.4 against a timeline, returning the achieving epoch and the achieved values. |
| FR-107 | The system MUST evaluate all constraint types in §6.5 against a timeline, returning every violating interval. |
| FR-108 | The system MUST compute plan legality per §6.4 and return a specific, localisable reason for each failure. |
| FR-109 | Evaluating the same plan twice MUST produce identical results; evaluating it in two runtimes MUST agree within the tolerance in §11.4. |
| FR-110 | The system MUST support an undo/redo stack of ≥ 50 plan mutations. |

### 10.3 Scenarios and content (FR-2xx)

| ID | Requirement |
| --- | --- |
| FR-201 | Scenarios MUST be declarative JSON conforming to a published schema (§11.5), loaded at runtime, with no scenario logic in TypeScript. |
| FR-202 | The system MUST validate every scenario against the schema before loading, and MUST refuse to load an invalid one with a field-level error. |
| FR-203 | Each scenario MUST carry its objective, constraints, budget, deadline, par values, par derivation note, and brief text. |
| FR-204 | The system MUST ship the 18 contracts in §6.8, each with a stored reference solution. |
| FR-205 | The system MUST generate a daily challenge deterministically from a UTC date, identical on every client and on the server. |
| FR-206 | Daily generation MUST reject scenarios that are trivial, infeasible, or degenerate, using rejection sampling with a bounded iteration count. |
| FR-207 | The system MUST make the previous 30 daily challenges playable, and older ones playable by URL. |
| FR-208 | The system SHOULD allow a scenario to be supplied by URL parameter for testing and education (P3). |

### 10.4 Scoring and progression (FR-3xx)

| ID | Requirement |
| --- | --- |
| FR-301 | The system MUST compute Bronze/Silver/Gold/Clean Job per §6.7 and MUST NOT award a medal the player did not earn under the assists actually enabled. |
| FR-302 | The system MUST record, per contract: best medal, best Δv, best time, burn count, attempt count, and the best run's replay code. |
| FR-303 | Act unlocking MUST depend only on Bronze counts, per §6.8. |
| FR-304 | The system MUST display par alongside the player's result, always. |
| FR-305 | When a player beats `par_dv`, the system MUST surface a prefilled physics-discrepancy report containing the replay code. |
| FR-306 | Leaderboard ranking MUST be lexicographic (Δv, time, submission time) with separate Clean and Assisted boards. |
| FR-307 | The debrief MUST produce a diagnosis from the rule set in §8.3.9, and MUST fall back to bare numbers rather than speculate. |

### 10.5 Planner UI (FR-4xx)

| ID | Requirement |
| --- | --- |
| FR-401 | The planner MUST render the orbit view, timeline, plan panel, readouts, and assist tray per §8.3.4, in both wide and narrow layouts. |
| FR-402 | The predicted trajectory MUST update within 16 ms of any node edit (NFR-011). |
| FR-403 | Scrubbing MUST be a pure view operation that never mutates the plan. |
| FR-404 | The camera MUST auto-frame per §8.4, and manual pan/zoom MUST suspend auto-framing until explicitly recentred. |
| FR-405 | Every node MUST be creatable, selectable, movable, editable, and deletable by pointer, by keyboard, and by touch. |
| FR-406 | Readouts MUST show display units by default and full float64 precision on hover or focus. |
| FR-407 | The closest-approach block MUST show distance, relative speed, and epoch, and MUST indicate whether the objective tolerance is met. |
| FR-408 | The commit control MUST be disabled with a specific inline reason whenever the plan is illegal, and MUST NOT be disabled merely because the objective is unmet. |
| FR-409 | Constraint-violating intervals MUST be drawn on the timeline and, where geometric, on the orbit view. |
| FR-410 | The node editor MUST show the resulting orbit's apoapsis, periapsis, and period as deltas against the pre-burn orbit, updating live. |
| FR-411 | The assist tray MUST show which assists affect medal eligibility and what the current cap is. |

### 10.6 Targeting tools (FR-5xx)

| ID | Requirement |
| --- | --- |
| FR-501 | The targeting computer MUST solve for a transfer given departure epoch, arrival epoch, and revolution count, and MUST preview it live on the orbit view. |
| FR-502 | *Insert as plan* MUST replace the current plan as a single undoable operation. |
| FR-503 | The porkchop plot MUST compute total Δv over a departure × arrival grid on a Web Worker, progressively refining from coarse to fine. |
| FR-504 | The porkchop MUST render its bands with both colour and a hatch/shading ramp, and MUST state the bands numerically in the legend. |
| FR-505 | Selecting a point on the porkchop MUST populate the targeting computer with that pair. |
| FR-506 | Both tools MUST be unavailable before their unlock contract, and MUST display their medal cap when used. |

### 10.7 Execution and replay (FR-6xx)

| ID | Requirement |
| --- | --- |
| FR-601 | Execution MUST play back the already-solved timeline; it MUST NOT recompute or diverge from the prediction. |
| FR-602 | Playback speed MUST be selectable up to 100 000× and MUST NOT affect the outcome. |
| FR-603 | Playback MUST be pausable, skippable to the end, and abortable back to the planner with the plan intact. |
| FR-604 | The flight log MUST record every burn, apsis, revolution, constraint entry/exit, and the closest approach, with epochs. |
| FR-605 | A completed run MUST be encodable as a replay code per §11.6, and any valid code MUST reproduce the run within the §11.4 tolerance. |
| FR-606 | The replay viewer MUST load a code from a URL and play it without the player owning the underlying save. |
| FR-607 | Share URLs MUST be ≤ 512 characters for a plan of ≤ 8 nodes. |

### 10.8 Persistence and settings (FR-7xx)

| ID | Requirement |
| --- | --- |
| FR-701 | Progress MUST persist in `localStorage`, versioned, with a forward-compatible migration path. |
| FR-702 | The game MUST remain fully playable when storage is unavailable, with a non-blocking notice. |
| FR-703 | The player MUST be able to export and import their save as a JSON file, and to clear all local data. |
| FR-704 | All settings in §8.3.12 MUST persist and apply immediately without reload. |
| FR-705 | Keybindings MUST be fully remappable, with conflict detection and reset-to-default. |

### 10.9 Leaderboard and backend (FR-8xx)

| ID | Requirement |
| --- | --- |
| FR-801 | The client MUST submit a daily run as a replay code plus a claimed result, signed with a locally generated key. |
| FR-802 | The server MUST re-evaluate every submission with the same simulation core and MUST reject any whose claimed result does not match within tolerance. |
| FR-803 | The server MUST reject submissions whose scenario key does not match the date's generated scenario. |
| FR-804 | The server MUST enforce per-identity and per-IP rate limits, and MUST return a clear error the client can surface. |
| FR-805 | The client MUST queue submissions when offline and retry on reconnect, without blocking play. |
| FR-806 | Leaderboards MUST be readable without any submission, and MUST return the requester's own rank alongside the top N. |
| FR-807 | Any leaderboard entry's replay MUST be watchable by any player. |
| FR-808 | Handles MUST be moderatable: a blocklist at submission, and an admin path to redact an entry. |
| FR-809 | The entire game except leaderboard read/write MUST function with the backend unreachable. |

### 10.10 Onboarding, codex, accessibility (FR-9xx)

| ID | Requirement |
| --- | --- |
| FR-901 | A first-time player MUST reach the C01 planner within two clicks of the title screen. |
| FR-902 | Coach marks MUST appear in C01–C04 only, at most three per contract, and MUST be permanently dismissible. |
| FR-903 | The Codex MUST contain one entry per learning outcome in §6.12, each with a live simulated diagram, and MUST be deep-linkable. |
| FR-904 | Every Codex entry MUST link the relevant departures from §7.5 and `docs/PHYSICS.md`. |
| FR-905 | All information rendered on canvas MUST have a DOM equivalent reachable by screen reader. |
| FR-906 | Every action MUST be performable by keyboard alone. |
| FR-907 | The UI MUST ship five colour palettes and MUST convey no information by colour alone. |
| FR-908 | The UI MUST respect `prefers-reduced-motion` and `prefers-color-scheme`. |
| FR-909 | The UI MUST pass axe-core with zero serious or critical violations on every route. |
| FR-910 | All user-facing strings MUST come from a message catalogue; none MUST be constructed by concatenation. |

---

## 11. Technical design

### 11.1 Architecture and the layering rule

```
                        ┌──────────────────────────────────┐
                        │           apps/web               │
                        │   Vite · Preact · routing · PWA  │
                        └───────────────┬──────────────────┘
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
            ┌───────────────┐  ┌────────────────┐  ┌────────────────┐
            │  @hh/render   │  │    @hh/ui      │  │  @hh/game      │
            │  canvas 2D    │  │  Preact comps  │  │  rules,        │
            │  camera,      │  │  panels, HUD,  │  │  scenarios,    │
            │  tessellation │  │  a11y, i18n    │  │  scoring,      │
            └───────┬───────┘  └────────┬───────┘  │  DEPARTURES    │
                    │                   │          └────────┬───────┘
                    └───────────────────┴───────────────────┘
                                        │
                              ┌─────────▼─────────┐
                              │      @hh/sim      │
                              │  plan, timeline,  │
                              │  world, events    │
                              └─────────┬─────────┘
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
          ┌──────────────────┐ ┌────────────────┐ ┌──────────────────┐
          │ @hh/propagation  │ │   @hh/astro    │ │    @hh/math      │
          │ kepler prop,     │ │ elements,      │ │ vec3, mat3,      │
          │ events, DOP853   │ │ frames, time,  │ │ PCG32, angles,   │
          │ (oracle only)    │ │ lambert, const │ │ roots, units     │
          └──────────────────┘ └────────────────┘ └──────────────────┘

                              ┌───────────────────┐
                              │  services/api     │  ← imports @hh/sim,
                              │  CF Worker + D1   │    @hh/game (headless)
                              └───────────────────┘
```

**The layering rule, enforced in CI (NFR-005):**

> `@hh/math`, `@hh/astro`, `@hh/propagation`, and `@hh/sim` MUST NOT import from `@hh/game`, `@hh/render`, `@hh/ui`, or `apps/*`. They MUST NOT reference `document`, `window`, `Date.now`, `performance.now`, `Math.random`, `fetch`, or `process`.

This is checked by `dependency-cruiser` and an ESLint `no-restricted-globals` config scoped to those packages. It is the mechanism that makes D2 (extract the engine later) cheap and D3 (run the sim in a Worker) possible, and it is the technical expression of the org's honesty rule.

### 11.2 Package responsibilities

| Package | Owns | Never contains |
| --- | --- | --- |
| `@hh/math` | `Vec3`, `Mat3`, angle normalisation, root finders (Brent, bisection), PCG32, branded unit types | Anything astrodynamical |
| `@hh/astro` | Constants, time (TAI/J2000 scalar, MET), frames (ECI/PQW/RTN), classical + equinoctial elements, state↔elements, Kepler solvers, Lambert | Propagation over time, game rules |
| `@hh/propagation` | Universal-variable Kepler propagation, arc abstraction, event finding, DOP853 oracle | Plans, objectives, scoring |
| `@hh/sim` | `Plan`, `Timeline`, `Arc`, world state, deterministic evaluation, serialisation of plans | Objectives, tolerances, medals, any number chosen for fun |
| `@hh/game` | Scenario loading and validation, objectives, constraints, legality, scoring, medals, progression, daily generation, **every DEP-xx** | Rendering, DOM |
| `@hh/render` | Canvas 2D scene graph, camera, orbit tessellation, hit-testing | Game rules, Preact |
| `@hh/ui` | Preact components, panels, message catalogue, a11y utilities, palettes | Physics |
| `apps/web` | Vite app, routing, PWA, storage, network client, composition | Anything reusable |
| `services/api` | Worker routes, D1 schema, verification, rate limiting, moderation | A second copy of the sim |

### 11.3 Key data models

Illustrative TypeScript. Exact shapes are settled in implementation; the *contracts* between layers are what this fixes.

```ts
// @hh/math — branded units make unit bugs compile errors
type Metres      = number & { readonly __unit: 'm' };
type Seconds     = number & { readonly __unit: 's' };
type MetresPerSec= number & { readonly __unit: 'm/s' };
type Radians     = number & { readonly __unit: 'rad' };

// @hh/astro — the frame is part of the value
interface StateVector {
  readonly frame: 'ECI';
  readonly epoch: Seconds;          // TAI seconds past J2000
  readonly r: Vec3<Metres>;
  readonly v: Vec3<MetresPerSec>;
}

interface ClassicalElements {
  readonly a: Metres; readonly e: number;
  readonly i: Radians; readonly raan: Radians;
  readonly argp: Radians; readonly nu: Radians;
  readonly degenerate: { circular: boolean; equatorial: boolean };
}

// @hh/sim — plan, arcs, timeline
interface ManeuverNode {
  readonly id: string;
  readonly epochQ: number;          // quantised: integer 1/1024 s since MET 0
  readonly dvQ: readonly [number, number, number]; // quantised: int, 1e-4 m/s, RTN
}
interface Plan { readonly nodes: readonly ManeuverNode[]; }

interface Arc {
  readonly start: Seconds; readonly end: Seconds;
  readonly state0: StateVector;     // at `start`, post-impulse
  readonly elements: ClassicalElements;
}
interface Timeline {
  readonly arcs: readonly Arc[];
  readonly horizon: Seconds;
  stateAt(t: Seconds): StateVector; // pure, O(log n) arc lookup + one Kepler solve
}

// @hh/game — the gameplay layer, where tolerances live
type Objective =
  | { kind: 'reach_orbit'; target: OrbitSpec; tol: OrbitTolerance }
  | { kind: 'intercept'; targetId: string; maxRange: Metres }
  | { kind: 'rendezvous'; targetId: string; maxRange: Metres; maxRelSpeed: MetresPerSec }
  | { kind: 'station'; longitude: Radians; tolLon: Radians; maxDrift: number };

interface Outcome {
  readonly met: boolean;
  readonly atEpoch: Seconds | null;
  readonly achieved: Record<string, number>;  // range, relSpeed, … full precision
  readonly dvUsed: MetresPerSec;
  readonly metElapsed: Seconds;
  readonly violations: readonly Violation[];
  readonly medal: 'none' | 'bronze' | 'silver' | 'gold' | 'clean';
}
```

### 11.4 Determinism specification

Determinism is a **product feature** (G4), so it gets a precise definition rather than an aspiration.

#### What is guaranteed

> **Given the same scenario id (or daily seed) and the same replay code, any conforming runtime produces an `Outcome` whose `dvUsed`, `metElapsed`, medal, and objective-met flag are identical, and whose continuous quantities agree to within 1 × 10⁻⁶ relative.**

Note what is *not* claimed: bit-identical floating-point state. `Math.sin`, `Math.cos`, `Math.exp`, and `Math.sqrt` are not required by IEEE 754 or by ECMAScript to be correctly rounded, and they do differ between V8, SpiderMonkey, and JavaScriptCore. Any design that requires bit-equality across browsers is broken from the start, and pretending otherwise would fail exactly where it matters — on a player's phone, on someone else's machine, a year later.

#### How it is achieved

| Mechanism | Detail |
| --- | --- |
| **Quantised input** | Node epochs are integers in 1/1024 s; Δv components are integers in 1e-4 m/s (DEP-09). Both are exactly representable in float64 and survive JSON round-trips exactly. The *input* to the simulation is therefore exact and identical everywhere. |
| **No accumulation** | Analytic propagation (D5) means error does not compound with elapsed time. A 17-day arc has the same error characteristics as a 17-minute one. |
| **Bounded solver iteration** | Kepler and Lambert solvers iterate to a fixed absolute tolerance with a fixed iteration cap, so the *number* of iterations is data-dependent but the *result* is tolerance-bounded, not iteration-dependent. |
| **No ambient nondeterminism** | Enforced by the layering rule (§11.1): no wall clock, no `Math.random`, no `Map`/`Set` iteration where order affects results, no floating-point-keyed lookups. |
| **Seeded generation** | PCG32, explicitly threaded. Daily scenarios are generated from `hash(date)` and produce byte-identical scenario JSON on client and server. |
| **Tolerance-band scoring** | Medal thresholds are evaluated against quantised, rounded values (Δv to 0.1 m/s, time to 1 s), so a 1e-9 cross-platform difference can never flip a medal. |

#### How it is tested

- A golden-trajectory fixture set (§7.6 Tier 4), asserted in CI on Node.
- A cross-runtime test in CI: the same 30 replay codes evaluated under Node, Chromium, Firefox, and WebKit (Playwright) and in a Worker (Miniflare), asserting agreement within 1e-6 relative and identical medals.
- A fuzz test: 10 000 random plans, evaluated twice in-process, asserting bit-identical results (same-runtime determinism *is* required to be exact).

### 11.5 Scenario schema

Declarative JSON, validated with a JSON Schema, typed with generated TypeScript types. This is the contributor on-ramp (G6) and the v1.3 editor's file format.

```jsonc
{
  "$schema": "https://astro-game-lab.github.io/hohmann-heist/schema/scenario-1.json",
  "id": "c05-tailgate",
  "version": 1,
  "act": 2,
  "index": 5,
  "title": "Tailgate",
  "briefKey": "brief.c05",              // message-catalogue key, not literal text (D14)

  "epoch": { "scale": "TAI", "j2000Seconds": 0 },
  "horizonSeconds": 50400,              // 14 h

  "ship": {
    "state": { "kind": "elements",
               "a_m": 6778137, "e": 0, "i_rad": 0,
               "raan_rad": 0, "argp_rad": 0, "nu_rad": 0 },
    "dvBudget_mps": 250
  },

  "targets": [
    { "id": "CTX-4", "label": "CTX-4",
      "state": { "kind": "elements",
                 "a_m": 6778137, "e": 0, "i_rad": 0,
                 "raan_rad": 0, "argp_rad": 0, "nu_rad": 0.6981317 } }
  ],

  "objective": { "kind": "intercept", "targetId": "CTX-4", "maxRange_m": 1000 },

  "constraints": [
    { "kind": "altitude_floor", "min_m": 100000 },
    { "kind": "deadline", "seconds": 50400 }
  ],

  "par": {
    "dv_mps": 72.0,
    "time_s": 43800,
    "burns": 2,
    "derivation": "Two-impulse coplanar phasing, 8 revolutions. Grid search over N=1..20 revs; N=8 is the lowest-Δv solution with periapsis above the 100 km floor. Solver: scripts/solve-c05.ts, committed.",
    "referenceReplay": "eyJ2IjoxLCJuIjpbey..."
  },

  "unlocks": [],
  "assistsAllowed": ["closest_approach", "elements", "snapping", "constraints"],
  "coachMarks": ["mark.c05.retrograde"]
}
```

**Rules:**
- Every scenario carries a `par.derivation` in prose and a `par.referenceReplay` that a test replays and asserts (§7.6 Tier 4). A par without a reproducible derivation is not mergeable.
- All quantities are SI, named with units, per org convention.
- `briefKey` and `coachMarks` are catalogue keys, so contract text is translatable and reviewable separately from scenario logic.
- Schema version is explicit; the loader refuses unknown major versions with a clear message.

### 11.6 Replay and share codes

```
replay := base64url( deflateRaw( canonicalJson( ReplayV1 ) ) )

ReplayV1 = {
  v: 1,                       // replay schema version
  s: "c05-tailgate" | "d:2026-09-01",   // scenario id or daily key
  e: 1,                       // engine major version (§14.4)
  n: [[epochQ, prQ, raQ, noQ], …],      // quantised nodes, integers; epochQ is
                                        // mission-elapsed ticks of 1/1024 s from
                                        // the scenario start, not absolute
  a: 0b0011011,               // assist bitmask at time of run
  c: { dv: 724, t: 43784 }    // claimed result, quantised (0.1 m/s, 1 s)
}
```

- **Canonical JSON**: keys sorted, no whitespace, integers only — so the same run always produces the same bytes, which makes the code a stable identity for deduplication and caching.
- **Size**: **measured at 306 bytes of JSON for an 8-node plan** — a realistic one, with epochs 90 minutes apart and burns of 100–400 m/s. That is ~408 characters of base64url *with no compression at all*, which is what `replay.test.ts` asserts against FR-607's 512-character budget: a budget that holds only because deflate happened to do well is a budget that fails on the first incompressible plan, so deflate is treated as headroom rather than as a load-bearing assumption. The earlier "~120 bytes" estimate was optimistic by a factor of about 2.5 and has been replaced by the measurement — a 123.75 m/s burn is 1 237 500 quantised counts, seven digits, and every node carries three of those plus an epoch.
- **Verification**: the server decodes, regenerates the scenario from `s`, re-evaluates the plan, and compares to `c` (§11.11).
- **Versioning**: `e` records the engine major version. A replay from an older engine is played by a *pinned evaluation path* where feasible; where it is not, the replay viewer says so explicitly rather than silently producing a different result. Engine major bumps are rare and require a `docs/PHYSICS.md` change (§14.4).

### 11.7 Save data

```jsonc
{
  "v": 1,
  "identity": { "handle": "perijove", "publicKey": "…", "privateKey": "…" },
  "contracts": {
    "c05-tailgate": { "medal": "gold", "bestDv_mps": 72.4, "bestTime_s": 43784,
                      "burns": 2, "attempts": 7, "bestReplay": "eyJ2Ijox…",
                      "firstCompletedAt": "2026-09-14T18:22:11Z" }
  },
  "daily": { "2026-09-01": { "bestDv_mps": 312.9, "submitted": true }, "streak": 6 },
  "settings": { /* §8.3.12 */ },
  "flags": { "coachMarksSeen": ["mark.c05.retrograde"], "codexRead": ["phasing"] }
}
```

- `localStorage`, single key, JSON, versioned with an explicit migration chain (`migrate_1_2`, …). Migrations are pure functions with tests.
- Total size for a completed campaign: ~15 kB. Well within any quota.
- The private key never leaves the device and is never sent anywhere (§11.12).
- Export/import is the same JSON, downloadable (FR-703). This is also the only "cloud save": the player carries it.

### 11.8 Rendering pipeline

Per frame:

```
  1. ui state  ──► camera.update()          (auto-frame ease, pan/zoom)
  2. sim       ──► timeline.stateAt(tScrub) (one Kepler solve per body)
  3. tessellate orbits (cached; invalidated only when elements change)
  4. transform to camera space in float64, cast to float32
  5. draw:  earth → hazard shells → constraint geometry → target orbit
            → current orbit → planned trajectory → trails → markers
            → nodes → handles → labels
  6. hit-test index rebuilt only on layout change
```

| Concern | Approach |
| --- | --- |
| **Tessellation cache** | Keyed by (elements, screen scale bucket). Dragging a node's Δv re-tessellates one orbit, not all. |
| **Precision** | Camera-space transform in float64 before the float32 cast (§8.4), so a 10⁸ m coordinate does not lose sub-kilometre detail. |
| **Text** | None on canvas. Labels are absolutely positioned DOM elements whose transform is updated per frame (D8). At ≤ 40 labels this is cheap and keeps them selectable and announceable. |
| **Resolution** | Backing store at `devicePixelRatio`, capped at 2 for battery. |
| **Renderer interface** | `@hh/render` exposes a `Renderer` interface with a Canvas2D implementation. A WebGL implementation is a v2 option and requires no consumer changes (D7). |
| **Off-main-thread** | The porkchop grid runs on a Worker (FR-503). The main timeline does not — it is fast enough (NFR-011) and moving it would add latency to dragging, which is the one thing that must never feel laggy. |

### 11.9 Performance budgets

Measured on the reference device: a 2019 mid-range laptop (4-core, integrated graphics, Chrome) and, for mobile, a 2021 mid-range Android phone.

| Budget | Target | Hard limit |
| --- | --- | --- |
| Frame time, planner idle | ≤ 4 ms | 16.7 ms |
| Frame time, dragging a node (8-node plan, 14 h horizon) | ≤ 8 ms | 16.7 ms |
| Full timeline re-evaluation, 8 nodes | ≤ 2 ms | 8 ms |
| Single `stateAt()` call | ≤ 5 µs | 20 µs |
| Orbit tessellation, one orbit | ≤ 0.5 ms | 2 ms |
| Porkchop coarse grid (24 × 24) | ≤ 200 ms | 500 ms |
| Porkchop fine grid (96 × 96), progressive | ≤ 2 s | 5 s |
| Scenario load and validate | ≤ 20 ms | 100 ms |
| Initial JS bundle, gzip | ≤ 400 kB | 600 kB |
| Total transfer, first load | ≤ 700 kB | 1 MB |
| Time to interactive, 4G | ≤ 1.5 s | 3 s |
| Peak heap | ≤ 150 MB | 250 MB |

Enforced by a bundle-size CI gate and a benchmark suite run on every PR touching `@hh/sim` or `@hh/render` (NFR-021).

### 11.10 Backend: the leaderboard service

Scope is deliberately minimal. It exists to make the daily challenge trustworthy, and nothing else.

**Stack:** Cloudflare Worker + D1 (SQLite). Free tier is sufficient at the M6 target (200 submissions/day ≈ 6 000/month). No framework, no ORM, ~600 lines.

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/v1/daily/:date` | GET | The generated scenario's canonical hash, for client cross-check |
| `/v1/leaderboard/:date?board=clean\|assisted&around=<pk>` | GET | Top 100 plus the requester's neighbourhood |
| `/v1/submit` | POST | Submit `{ date, board, replay, claimed, publicKey, signature }` |
| `/v1/replay/:id` | GET | Fetch a leaderboard entry's replay code (FR-807) |
| `/v1/health` | GET | Liveness |

```sql
CREATE TABLE submissions (
  id           TEXT PRIMARY KEY,        -- hash(date, publicKey)  → one row per player per day
  date         TEXT NOT NULL,
  board        TEXT NOT NULL CHECK (board IN ('clean','assisted')),
  public_key   TEXT NOT NULL,
  handle       TEXT NOT NULL,
  dv_q         INTEGER NOT NULL,        -- 0.1 m/s
  time_q       INTEGER NOT NULL,        -- seconds
  replay       TEXT NOT NULL,
  verified_at  INTEGER NOT NULL,
  redacted     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_rank ON submissions(date, board, redacted, dv_q, time_q, verified_at);
```

Ranking is that index, read directly — no scoring job, no cache invalidation, no eventual consistency. Leaderboard reads are cached at the edge for 60 s.

**Degradation:** every failure mode falls back to a fully playable offline game (FR-809). The client treats the backend as an optional enhancement, and the daily challenge's *scenario* is generated locally, never fetched — the server is only asked to rank.

### 11.11 Verification and anti-cheat

The threat is a player submitting a Δv they did not achieve. The defence is that **we can simply check**.

| Layer | Mechanism |
| --- | --- |
| **Re-evaluation** | The Worker imports `@hh/sim` and `@hh/game` — the *same code* the client runs — regenerates the day's scenario from the date seed, evaluates the submitted plan, and compares to the claimed result. A mismatch beyond 1e-6 relative is rejected. This is possible only because of the layering rule (§11.1), and it is the single strongest argument for that rule. |
| **Scenario binding** | The replay names a date; the server generates that date's scenario itself and ignores anything client-supplied about it. |
| **Plausibility** | Reject Δv below a floor derived from a lower bound for the scenario (computed at generation time), and reject node counts above a cap. |
| **Identity** | An Ed25519 keypair generated on first run. Submissions are signed. This does not prevent a determined attacker from minting identities — it prevents casual impersonation and makes rate limiting meaningful. |
| **Rate limits** | 20 submissions per identity per day; 200 per IP per day. Beyond that, `429` with a clear message. |
| **Transparency** | Every entry's replay is public and watchable (FR-807). A suspicious time can be inspected by anyone, which is a better deterrent than any heuristic. |
| **Redaction** | An admin path marks an entry `redacted`, removing it from rankings without deleting the audit row. |

**Explicitly out of scope:** obfuscation, client attestation, and anti-tamper. The client is open source; pretending otherwise would be theatre. Verification is server-side because that is the only place it can be real.

### 11.12 Privacy, data, and moderation

| | |
| --- | --- |
| **Accounts** | None (D11). |
| **PII collected** | None. No email, no name, no IP stored beyond a rolling 24 h rate-limit window (hashed). |
| **What is stored server-side** | A player-chosen handle, a public key, a date, quantised results, and a replay code. That is the whole record. |
| **What is stored client-side** | The save (§11.7), including the private key, which never leaves the device. |
| **Handles** | Chosen freely; screened against a profanity blocklist at submission; changeable, with the change applying to future submissions only. Reported handles can be redacted by an admin (FR-808). |
| **Deletion** | A player can clear all local data in Settings. Server-side, a submission can be deleted by presenting a signature from its own key — the only "account recovery" mechanism, and it is enough. |
| **Cookies** | None. `localStorage` only, for game state. |
| **Third parties** | None. No analytics SDK, no CDN fonts, no embeds. |
| **Legal surface** | With no PII and no cookies, the compliance obligation is a short, plain-language privacy note in Settings and in `README.md`, and honouring deletion requests. Nothing more is needed, and nothing more will be collected to avoid needing more. |

### 11.13 Build, CI/CD, environments

| | |
| --- | --- |
| **Package manager** | pnpm workspaces, lockfile committed, Node 24 LTS pinned via `.nvmrc`, `engines`, and `packageManager` |
| **Build** | Vite, TypeScript strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`). **TypeScript is held at 5.x**: `typescript-eslint` peers on `<6.1.0`, and no release supports TS 7 yet, so upgrading would cost the type-aware `strictTypeChecked` rule set entirely. Revisit when `typescript-eslint` supports TS 7. |
| **Lint / format** | ESLint (flat config) + Prettier, plus `dependency-cruiser` for the layering rule and a custom rule banning `acos` in `@hh/astro` |
| **Test** | Vitest for unit and property tests (`fast-check`), Playwright for browser and cross-runtime determinism, `@axe-core/playwright` for a11y |
| **Environments** | `production` → GitHub Pages at the repo's Pages URL, served from the root of the `gh-pages` branch (custom domain optional later); `local` → `pnpm dev`, or `pnpm build` with `pnpm --filter @hh/web preview` to serve the production build. **There is no hosted per-PR preview.** One was built and then removed (2026-09-03): Pages has no native per-PR deployment — `actions/deploy-pages`' `preview` input is alpha and not public, and a repository gets one Pages site — so previews had to coexist with production inside the single published tree, which made every pull request a writer to the branch that serves the game. A branch is verified locally instead: build it, serve it on `localhost`, and check it in a real browser. The committed browser suites of §13 are CI work, and they are not a precondition for this. `gh-pages` is left with exactly one writer, the deploy workflow, and a publish replaces the tree whole. The API has `production` and `staging` Workers. |
| **CI** (`.github/workflows/ci.yml`) | On every PR and every push to `main`: install (`--frozen-lockfile`) → typecheck → lint → layering check → format check → `test:all` (packages **and** the guardrail suite) → coverage → build → bundle size. The size gate measures gzipped transfer size against the NFR-020 targets, reports headroom to the run summary, and blocks the merge; §11.9's hard limits are encoded alongside the targets. Browser, axe and benchmark steps are added by the issues that introduce them. Actions are pinned to commit SHAs, not tags. |
| **CD** | On merge to `main`: build → publish to the root of `gh-pages` → smoke test the live URL, pinned to the entry script just built, so a deployment still serving the previous build cannot pass. A pull request deploys nothing. Tagged releases also deploy the Worker and publish the scenario JSON Schema to the Pages site. |
| **Branch protection** | `main` protected, linear history, CI required, squash merges (matches the `issue` skill's assumptions) |
| **Release** | Changesets for versioning, `CHANGELOG.md` maintained, **and any PR that changes a physics result must update `docs/PHYSICS.md` in the same PR** (CI check on the golden fixtures enforces this by failing loudly). |

### 11.14 Telemetry

The metrics in §2.3 need data, and the privacy stance (§11.12) forbids the usual way of getting it. The resolution:

- **Self-hosted, first-party, no third-party SDK.** A single endpoint on the same Worker.
- **No identifiers of any kind** — no cookie, no fingerprint, no key. Events carry only: an event name from a fixed enum, a contract id, an attempt ordinal within the *session* (in-memory only), and coarse buckets (medal, success/failure, Δv rounded to 5%).
- **Session** means a page lifetime. Nothing links two sessions, which is why M5 (return rate) is measured instead from *daily-challenge submission* counts, which are already public and consented.
- **Opt-out**, prominently, in Settings, and honoured by not sending anything. `Do-Not-Track` and Global Privacy Control are honoured automatically.
- **Event list is published** in `docs/TELEMETRY.md`. If it is not on that list, it is not sent.

| Event | Fields |
| --- | --- |
| `contract_start` | contract id |
| `contract_commit` | contract id, node count, Δv bucket, assists bitmask |
| `contract_result` | contract id, success, medal, Δv bucket, time bucket, attempt ordinal |
| `contract_abandon` | contract id, seconds in planner bucket |
| `codex_open` | slug |
| `assist_toggle` | assist name, on/off |
| `error` | error class, route |

### 11.15 Browser support

| Tier | Browsers | Commitment |
| --- | --- | --- |
| **Tier 1** | Chrome/Edge (last 2), Firefox (last 2), Safari 17+ (macOS and iOS) | Fully tested in CI, all features |
| **Tier 2** | Samsung Internet, Chrome on Android (last 2) | Manually smoke-tested per release |
| **Unsupported** | Anything without ES2022, `structuredClone`, `CompressionStream`, or Canvas 2D | A static, styled message with the reason |

`CompressionStream` is used for replay deflate; a ~3 kB `fflate` fallback covers Safari versions where it is missing. Baseline target is **ES2022**, no transpilation below it.

**PWA:** installable, offline-capable for everything except leaderboard reads and submission. A service worker caches the app shell and all scenario JSON, so a player who has loaded the game once can play the entire campaign on a plane.

---

## 12. Non-functional requirements

| ID | Requirement | Verified by |
| --- | --- | --- |
| NFR-001 | All simulation state is float64 SI; the renderer is the only float32 consumer. | Code review, lint rule on `Math.fround` usage |
| NFR-002 | Every physical quantity crossing a package boundary carries its unit in its type or its name. | Review checklist, branded types |
| NFR-003 | Every position and velocity carries an explicit frame. | Type system |
| NFR-004 | Simulation time is TAI seconds past J2000; UTC appears only at display and the daily date key. | Test, review |
| NFR-005 | The layering rule (§11.1) holds; core packages reference no browser or Node globals. | `dependency-cruiser` + ESLint in CI, blocking |
| NFR-006 | `acos` on a dot product appears nowhere; quadrant-sensitive angles use `atan2`. | Custom ESLint rule, blocking |
| NFR-007 | All angles are normalised to `[0, 2π)` at every function boundary that returns one. | Property tests |
| NFR-008 | No `Math.random`, `Date.now`, or `performance.now` in `@hh/math\|astro\|propagation\|sim\|game`. | ESLint `no-restricted-globals`, blocking |
| NFR-009 | No iteration over unordered containers where order affects results. | Review checklist; fuzz determinism test |
| NFR-010 | Coordinate transforms to camera space occur in float64 before any float32 cast. | Review; visual regression at GEO scale |
| NFR-011 | Timeline re-evaluation and re-render on a node drag complete within one 60 Hz frame for an 8-node plan. | Benchmark suite, CI gate |
| NFR-012 | No computation over 8 ms runs on the main thread during interaction. | Long-task audit in Playwright |
| NFR-013 | Daily-challenge generation completes in ≤ 50 ms and is bounded in iterations. | Unit test with a fixed seed sweep |
| NFR-014 | The game is fully playable with the backend unreachable, storage unavailable, or both. | Playwright tests with the network and storage blocked |
| NFR-015 | The same replay code yields identical medals and results across Node, Chromium, Firefox, WebKit, and the Worker runtime. | Cross-runtime CI job |
| NFR-016 | Every action is performable by keyboard alone. | Keyboard-only Playwright walkthrough of Acts I–III |
| NFR-017 | Zero serious or critical axe-core violations on every route. | axe in CI, blocking |
| NFR-018 | WCAG 2.2 AA contrast in all five palettes. | Automated contrast check over the token matrix |
| NFR-019 | No information conveyed by colour alone. | Greyscale visual-regression snapshots |
| NFR-020 | Initial bundle ≤ 400 kB gzip; total first load ≤ 700 kB. | `size-limit` CI gate, blocking |
| NFR-021 | Performance budgets in §11.9 are met on the reference devices. | Benchmark suite; manual device pass per milestone |
| NFR-022 | Test coverage ≥ 90% statements in `@hh/math\|astro\|propagation\|sim`, ≥ 70% in `@hh/game`. | Vitest coverage gate |
| NFR-023 | Every physics claim in `docs/PHYSICS.md` names a passing test. | A test that parses the doc's validation table and asserts each named test exists |
| NFR-024 | No third-party runtime dependency is added without a licence check and an `ATTRIBUTIONS.md` row. | CI licence scan; review checklist |
| NFR-025 | No PII is collected or transmitted. | Review; the published telemetry event list is asserted against the code |
| NFR-026 | The app is installable and plays the full campaign offline after one load. | Playwright offline test |
| NFR-027 | Source is MIT; assets are CC BY 4.0; both are stated in the repo and in-game. | Release checklist |
| NFR-028 | Every user-facing string is in the message catalogue. | ESLint rule against literal JSX text |

---

## 13. Testing and quality strategy

### 13.1 The shape of the pyramid

Inverted from the usual, deliberately. Most of the risk in this project is *numerical*, and numerical risk is cheapest to catch in unit tests.

```
                    ▲  manual playtest (§13.6)          ~8 sessions/milestone
                   ▲▲  e2e journeys (Playwright)        ~15 tests
                  ▲▲▲  cross-runtime determinism        ~30 replays × 5 runtimes
                ▲▲▲▲▲  integration (game + sim)         ~80 tests
             ▲▲▲▲▲▲▲▲  property tests (fast-check)      ~40 properties
        ▲▲▲▲▲▲▲▲▲▲▲▲▲  unit + reference (§7.6)          ~400 tests
```

### 13.2 Physics testing

Governed entirely by §7.6. The rules that matter:

1. **Never assert a physics value against our own implementation.** Closed form, textbook, or independent library — nothing else counts.
2. **The expected value and its source go in the test**, in the test file, not in a comment elsewhere.
3. **Degenerate cases are first-class**, not an afterthought: e = 0, i = 0, both, e → 1, hyperbolic, and multi-rev Lambert each have their own test, and the circular-equatorial case is the *hot path* for v1.0 content.
4. **A tolerance is never loosened to make a test pass** without a written explanation in the PR and a `docs/PHYSICS.md` update.
5. **Fixtures from external tools are generated by a committed script with a pinned library version**, so anyone can regenerate them.

### 13.3 Property tests

| Property | Generator domain |
| --- | --- |
| Element ↔ Cartesian round-trip | a ∈ [6.6e6, 4e8] m, e ∈ [0, 0.95], all angles |
| Propagate forward then back is identity | Δt ∈ [−30 d, +30 d] |
| Energy and angular momentum conserved over a period | full element domain |
| Kepler solver converges | e ∈ [0, 0.999] ∪ (1, 10], M ∈ [0, 2π) |
| Lambert solution reproduces the endpoint | r₁, r₂ non-collinear, Δt ∈ (0, 20 d], revs 0–5 |
| Applying zero Δv changes nothing | any state |
| Two impulses at the same epoch equal their vector sum | any state |
| Plan evaluation is deterministic in-process | random plans, 1–12 nodes |
| Timeline `stateAt` is continuous across arc boundaries | random plans |
| Objective evaluation is monotone in tolerance | random outcomes |

### 13.4 Content tests

Every shipped contract gets, automatically:

- **Solvability** — the stored `par.referenceReplay` achieves the objective.
- **Par accuracy** — that replay costs `par.dv_mps` ± 0.5% and takes `par.time_s` ± 0.5%.
- **Budget headroom** — `dvBudget ≥ par.dv × 1.15`, so par is not the only solution.
- **Deadline headroom** — `horizon ≥ par.time × 1.10`.
- **Schema validity** — against the published JSON Schema.
- **Reachability** — the contract is unlockable by a player following the progression rules.
- **Brief keys exist** — every `briefKey` and `coachMarks` entry resolves in the catalogue.

This is one parameterised test file over the scenario directory, so **adding a contract adds seven tests for free** — which is what makes G6 (contributors adding contracts) safe.

### 13.5 End-to-end journeys

| # | Journey |
| --- | --- |
| E1 | Cold start → C01 → commit → succeed → debrief → next |
| E2 | Cold start → C01 → commit → fail → diagnosis → retry → succeed |
| E3 | Complete Act I; verify Act II unlocks and Act III does not |
| E4 | Keyboard-only completion of C02, no pointer events |
| E5 | Narrow viewport (390 × 844) completion of C01 by touch |
| E6 | Node editor: type an epoch and a Δv, verify the trajectory and readouts |
| E7 | Undo/redo across 10 mutations returns the exact original plan |
| E8 | Share a run, open the share URL in a fresh context, watch the replay |
| E9 | Daily challenge: play, submit, appear on the leaderboard, watch the top run |
| E10 | Offline: block the network, verify the campaign plays and submission queues |
| E11 | Storage blocked: verify the game plays with the non-blocking notice |
| E12 | Targeting computer and porkchop on C14: solve, insert, commit |
| E13 | Settings: change palette, units, keybinds; reload; verify persistence |
| E14 | Export save, clear data, import save, verify progress restored |
| E15 | Invalid replay code and future-version replay code both produce clear errors |

### 13.6 Playtesting

Structured, small-N, and repeated at each milestone. Eight sessions per round: four P1-profile (no astrodynamics background), three P2-profile, one P3-profile.

**Protocol:** think-aloud, no guidance, 30 minutes, screen recorded with consent. The facilitator does not answer questions during play and writes down every one that is asked.

**What is measured:**

| Signal | How |
| --- | --- |
| Time to first successful burn | Timestamp |
| Time to the click (C05) | Timestamp; the headline number |
| Learning outcomes (§6.12) | A three-question verbal check after the relevant contract |
| Confusion points | Every question asked, every mis-click, every 10 s+ pause |
| Vocabulary failures | Any term the player cannot define after using it |
| Abandonment | Where and why |

**Cadence:** M2 (5 sessions, slice only), M3 (8, Acts I–II), M5 (8, Acts I–V), M6 (8, full, plus one accessibility session with a screen-reader user).

### 13.7 Definition of Done for a change

A change is done when:

- [ ] Types check, lint passes, layering check passes
- [ ] Tests added; physics changes cite an independent reference
- [ ] Coverage gates met (NFR-022)
- [ ] `docs/PHYSICS.md` updated if any physics result moved, in the same PR
- [ ] `ATTRIBUTIONS.md` updated if a dependency or asset was added
- [ ] `CHANGELOG.md` entry via changeset if user-visible
- [ ] Accessibility considered: keyboard path, DOM equivalent, contrast, reduced motion
- [ ] Performance budget not regressed
- [ ] Screenshot or recording attached for any UI change
- [ ] The FR/NFR IDs it satisfies are cited in the PR body

---

## 14. Release plan

### 14.1 Milestones

Effort is expressed in **issues** and **weeks at ~10 h/week**, not in dates, because this is a part-time open-source project. Dates are indicative from a 2026-09-15 start.

| M | Name | Version | Exit criteria | Issues | Weeks | Indicative |
| --- | --- | --- | --- | --- | --- | --- |
| **M0** | **Foundations** | — | Repo bootstrapped from template; pnpm workspace; CI green with typecheck, lint, layering, tests; `@hh/math` and `@hh/astro` complete with Tier 1 + Tier 2 validation passing; constants documented and sourced; `docs/PHYSICS.md` §7 transcribed | ~24 | 4 | Oct 2026 |
| **M1** | **Propagator & spike** | — | `@hh/propagation` and `@hh/sim` complete; Lambert solving and validated; event finding working; a throwaway page renders an orbit and drags one node at 60 fps. **Go/no-go on D5 and D9.** | ~22 | 4 | Nov 2026 |
| **M2** | **Vertical slice** | `v0.1.0` | C03 playable end to end: briefing → planner → commit → execution → debrief. Deployed to Pages. Save works. 5 playtest sessions run and reported. | ~26 | 5 | Dec 2026 |
| **M3** | **Alpha: Acts I–II** | `v0.2.0` | Contracts 01–07; contract board; medals and par; settings; two colour palettes; keyboard-complete planner; Codex entries for Acts I–II; axe clean. **Public alpha announced.** | ~28 | 5 | Feb 2027 |
| **M4** | **Rendezvous** | `v0.3.0` | Act III; closest-approach tooling; terminal fine-adjust; audio; coach marks; narrow-layout complete; PWA offline | ~24 | 5 | Mar 2027 |
| **M5** | **Targeting** | `v0.4.0` | Acts IV–V; Lambert targeting computer; porkchop on a Worker; multi-rev; 8 playtest sessions | ~26 | 5 | May 2027 |
| **M6** | **Beta** | `v0.9.0` | Act VI; all 18 contracts with pars and reference solutions; full Codex; replay share; all five palettes; screen-reader pass; performance pass on reference devices; cross-runtime determinism job green | ~26 | 5 | Jun 2027 |
| **M7** | **Launch** | `v1.0.0` | Daily challenge; leaderboard Worker + D1 deployed with verification; telemetry; privacy note; README/README assets; launch post | ~24 | 5 | Aug 2027 |

**Total: ~200 issues, ~38 weeks of part-time work.** Contingency is built in by treating Acts IV–VI content as the compressible scope — the game is shippable at M4 with 10 contracts if the schedule slips.

### 14.2 What ships when — feature × milestone

| Feature | M0 | M1 | M2 | M3 | M4 | M5 | M6 | M7 |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Math, elements, Kepler | ● | | | | | | | |
| Lambert | | ● | | | | | | |
| Propagation, events | | ● | | | | | | |
| Plan/timeline | | ● | | | | | | |
| Orbit renderer | | ◐ | ● | | | | | |
| Planner UI | | | ● | | | | | |
| Execution + debrief | | | ● | | | | | |
| Contract board, medals, par | | | | ● | | | | |
| Acts I–II content | | | ◐ | ● | | | | |
| Act III content | | | | | ● | | | |
| Acts IV–V content | | | | | | ● | | |
| Act VI content | | | | | | | ● | |
| Settings, palettes | | | | ◐ | ◐ | | ● | |
| Codex | | | | ◐ | ◐ | ◐ | ● | |
| Audio | | | | | ● | | | |
| PWA / offline | | | | | ● | | | |
| Targeting computer, porkchop | | | | | | ● | | |
| Replay share | | | | | | | ● | |
| Daily challenge | | | | | | | ◐ | ● |
| Leaderboard + verification | | | | | | | | ● |
| Telemetry | | | | | | | | ● |

● complete ◐ partial

### 14.3 Post-1.0

| Version | Theme | Contents |
| --- | --- | --- |
| **v1.1** | **The third dimension** | Inclination and RAAN; normal burns; plane-change contracts (cheapest at apoapsis — one of the best lessons available and currently missing); a 2.5D or 3D view; combined plane-change-and-circularise contracts |
| **v1.2** | **Higher fidelity, opt-in** | J2 as a togglable perturbation with its consequences taught (nodal regression, sun-synchronous orbits); finite burns and gravity losses; the rocket equation with mass and Isp as an advanced mode |
| **v1.3** | **Community** | Scenario editor in-browser; share a custom contract by URL; a curated community contract list; the JSON Schema published as the contract format |
| **v1.4** | **Reach** | Localisation (the catalogue is already ready); weekly challenges; a per-contract all-time leaderboard |
| **v2.0** | **Engine extraction** | `@hh/math\|astro\|propagation\|sim` extracted to `astro-game-lab/astro-engine`, published to npm, consumed by Hohmann Heist and *Orbital Traffic Controller* (D2's payoff) |

### 14.4 Versioning

- **App** follows semver on the deployed site; the version is visible on the title screen and in the debrief, and is embedded in every replay code.
- **Engine major version** (`e` in the replay code) increments only when a physics result changes in a way that could alter an outcome. This is rare, requires a `docs/PHYSICS.md` update in the same PR, and is announced in `CHANGELOG.md` under a dedicated **Physics** heading.
- **Scenario schema** is versioned independently; the loader accepts its major version and refuses others explicitly.
- **Leaderboards are engine-scoped.** A leaderboard is per (date, board, engine major). If the engine majors, historical boards stay readable and frozen rather than silently re-ranking. This is the honest handling, and it is why `e` is in the replay code.

### 14.5 Launch

**M7 exit → launch checklist:**

- [ ] All 18 contracts have Bronze-verified reference solutions and published pars
- [ ] Cross-runtime determinism job green on all five runtimes
- [ ] Performance budgets met on both reference devices
- [ ] Screen-reader playthrough of Acts I–III completed by an external tester
- [ ] `docs/PHYSICS.md` validation table complete, every row naming a passing test
- [ ] Privacy note published; telemetry event list published; opt-out verified
- [ ] `README.md`, `ATTRIBUTIONS.md`, `LICENSE`, `LICENSE-ASSETS.md` complete
- [ ] Social card, favicon, OG tags
- [ ] Leaderboard load-tested at 20× the M6 target
- [ ] A rollback plan: Pages can be reverted to the previous tag in one command

**Channels:** the org profile and Discussions; Hacker News (*Show HN*); `r/KerbalSpaceProgram`, `r/space`, `r/orbitalmechanics`; the `poliastro`/`astropy` and space-flight-dynamics communities; Mastodon/Bluesky space and gamedev circles; a short write-up of *how the physics was validated*, which is the angle that differentiates us and the one P2 will amplify.

**Launch-day risk:** a physics bug found publicly. Mitigation: the physics-discrepancy issue template is one click from the debrief, we respond within 24 h, and being visibly fast and honest about a wrong number is better marketing than not having one.

---

## 15. Backlog plan

This section exists so the backlog can be created directly from this document.

### 15.1 Structure

```
  Project board (org #1)  ──  Game field = "Hohmann Heist"
        │
        ├── GitHub Milestone = delivery milestone (M0 … M7)
        │
        └── Epic issue  (label: epic)          ~17 of them
                │  tracked with a task list of child issues
                └── Story / task issue         ~200 of them
                        └── cites FR-/NFR- IDs in the body
```

- **Milestones** are the M0–M7 delivery milestones from §14.1. Every issue has exactly one.
- **Epics** are long-lived vertical or horizontal slices; they span milestones and are closed when their last child is.
- **Issues** are the unit of work: one PR, one to two days at most. Anything larger is split at grooming.

### 15.2 Epics

| ID | Epic | Scope | Primary milestones |
| --- | --- | --- | --- |
| **E01** | Repo, toolchain, CI | Bootstrap, pnpm workspace, TS config, lint, layering check, CI/CD, Pages deploy | M0 |
| **E02** | Math and units | `@hh/math`: vectors, matrices, angles, roots, PCG32, branded units | M0 |
| **E03** | Astrodynamics core | `@hh/astro`: constants, time, frames, elements, Kepler, Lambert | M0, M1 |
| **E04** | Propagation and events | `@hh/propagation`: universal-variable propagation, arcs, event finding, DOP853 oracle | M1 |
| **E05** | Simulation and determinism | `@hh/sim`: plan, timeline, quantisation, evaluation, cross-runtime determinism | M1, M6 |
| **E06** | Game rules and scoring | `@hh/game`: objectives, constraints, legality, medals, par, progression, diagnosis | M2, M3 |
| **E07** | Scenario format and content | Schema, loader, validation, the 18 contracts, pars, reference solutions, solver scripts | M2–M6 |
| **E08** | Renderer | `@hh/render`: camera, tessellation, scene, hit-testing, precision, constraint geometry | M1–M4 |
| **E09** | UI shell and screens | Routing, title, board, briefing, debrief, settings, layouts | M2–M4 |
| **E10** | Planner interaction | Node CRUD, dragging, timeline, readouts, node editor, undo/redo, keyboard, touch | M2–M4 |
| **E11** | Execution and replay | Playback, flight log, replay codec, share URLs, replay viewer | M2, M6 |
| **E12** | Targeting tools | Lambert UI, porkchop worker and plot, insert-as-plan | M5 |
| **E13** | Onboarding and Codex | Coach marks, Codex framework, entries, live diagrams | M3–M6 |
| **E14** | Accessibility | Palettes, canvas parity, live regions, keyboard completeness, axe, reduced motion, screen-reader pass | M3–M6 |
| **E15** | Art, audio, presentation | Tokens, type, icons, Earth data, audio cues, motion, social assets | M3–M7 |
| **E16** | Persistence and settings | Save schema, migrations, export/import, settings, keybinds, PWA | M3–M4 |
| **E17** | Backend and daily | Daily generation, Worker, D1, verification, rate limits, moderation, telemetry, privacy | M6–M7 |

### 15.3 Labels

Existing org labels to reuse: `bug`, `enhancement`, `documentation`, `good first issue`, `help wanted`, `question`, `accessibility`, `duplicate`, `invalid`, `wontfix`, `triage`.

New labels to create on the repo:

| Label | Colour | Meaning |
| --- | --- | --- |
| `epic` | `#5319e7` | A tracking issue with child issues |
| `physics` | `#0e8a16` | Touches the simulation core or a physics claim |
| `determinism` | `#0e8a16` | Affects reproducibility |
| `sim` | `#1d76db` | `@hh/sim`, `@hh/propagation` |
| `render` | `#1d76db` | `@hh/render` |
| `ui` | `#1d76db` | `@hh/ui`, `apps/web` |
| `game` | `#1d76db` | `@hh/game` |
| `backend` | `#1d76db` | `services/api` |
| `infra` | `#c5def5` | Toolchain, CI/CD, deploy |
| `content` | `#fbca04` | Scenarios, briefs, Codex text |
| `design` | `#fbca04` | UX or visual design work |
| `ux` | `#fbca04` | Interaction design and flows |
| `perf` | `#d93f0b` | Performance budgets |
| `spike` | `#bfd4f2` | Time-boxed investigation with a written outcome |
| `tech-debt` | `#e99695` | Known compromise to repay |
| `playtest` | `#f9d0c4` | From or about a playtest session |
| `size:S` `size:M` `size:L` | `#ededed` | ≤2 h · ≤1 day · 1–2 days |

### 15.4 Issue conventions

**Title:** `<area>: <imperative summary>` — e.g. `astro: solve Kepler's equation for hyperbolic orbits`, `planner: drag a node along the trajectory`.

**Body template** (a repo issue template, `task.yml`):

```markdown
## What
One paragraph. What exists after this issue closes.

## Why
The FR/NFR this satisfies, and the user-visible consequence.

## Requirements
- FR-004, FR-005

## Acceptance criteria
- [ ] …testable, observable statements…

## Physics notes            (only for `physics` issues)
- Units and frame:
- Reference and citation:
- Validation test to add:

## Out of scope
- …

## Depends on
- #NN
```

**Definition of Ready** — an issue may move `Backlog → Ready` only when:

- [ ] Acceptance criteria are written and testable
- [ ] It cites at least one FR or NFR (or is explicitly `tech-debt`/`spike`)
- [ ] Dependencies are linked and not blocking
- [ ] It is sized `S`, `M`, or `L` (never larger — split it)
- [ ] For `physics`: the reference and validation approach are named
- [ ] For `ux`/`design`: the target screen spec in §8 is cited

**Definition of Done** — §13.7.

### 15.5 Board mapping

| Field | Value |
| --- | --- |
| **Game** | `Hohmann Heist` for everything in this plan |
| **Status** | `Backlog` → `Ready` → `In progress` → `In review` → `Done`, driven by the `issue` skill |
| **Priority** | `P0` blocks the current milestone · `P1` in the current milestone · `P2` wanted, can slip |
| **Milestone** | The GitHub milestone M0–M7 |

> **The `issue` skill is ready for this board.** It was repointed on 2026-09-01: repo paths, clone commands, and `gh` invocations target `astro-game-lab`, and its board transitions are wired to project **1** (`PVT_kwDOE0uNBc4BiJoC`) with the Status field ID and option IDs cached in the skill. Two things to know when working the backlog with it: this org runs **one board for every repo** (unlike `astro-tools`' board-per-repo), and the board's auto-add workflow is **not** configured — so a newly opened issue will not be on the board until someone adds it, and the skill will report that rather than silently skipping the transition.

### 15.6 Seed backlog

The issue list to create, by epic. Sizes are indicative. This is the input to the backlog-creation session that follows this document.

#### E01 — Repo, toolchain, CI (M0)

1. `repo: create hohmann-heist from .repo-template and bootstrap` — S
2. `repo: set origin to https and configure branch protection on main` — S
3. `infra: set up pnpm workspace with packages/ and apps/web` — M
4. `infra: TypeScript strict config shared across packages` — M
5. `infra: ESLint flat config + Prettier` — M
6. `infra: dependency-cruiser layering rule and CI gate` — M · NFR-005
7. `infra: custom lint rules — ban acos-on-dot, ban ambient globals in core` — M · NFR-006, NFR-008
8. `infra: Vitest setup with coverage gates` — S · NFR-022
9. `infra: Vite app skeleton with Preact and hash routing` — M
10. `infra: CI workflow — typecheck, lint, layering, test` — M
11. `infra: CD workflow — build and deploy to GitHub Pages` — M
12. `infra: PR preview deployments` — M · **dropped**: shipped as #30 and removed on 2026-09-03; a branch is verified locally instead (§11.13)
13. `infra: size-limit bundle gate` — S · NFR-020
14. `docs: transcribe the physics contract into docs/PHYSICS.md` — M
15. `docs: write docs/DESIGN.md from the design section` — S
16. `docs: README with play link, stack, and contribution pointers` — S
17. `repo: create labels and milestones M0–M7` — S
18. `repo: issue templates — task.yml alongside the org templates` — S

#### E02 — Math and units (M0)

20. `math: Vec3 and Mat3 with the operations the core needs` — M
21. `math: branded unit types (Metres, Seconds, MetresPerSec, Radians)` — M · NFR-002
22. `math: angle normalisation to [0, 2π) and angular difference` — S · NFR-007
23. `math: Brent and bisection root finders with iteration caps` — M
24. `math: PCG32 seeded PRNG with cross-platform test vectors` — M · FR-010
25. `math: property tests for the whole package` — M

#### E03 — Astrodynamics core (M0, M1)

26. `astro: constants module with sources; assert R_GEO derivation` — S · FR-012
27. `astro: time — TAI seconds past J2000, MET, display conversion` — M · NFR-004
28. `astro: ECI/PQW/RTN frame definitions and transforms` — M · FR-001
29. `astro: classical elements ↔ Cartesian state` — L · FR-002
30. `astro: equinoctial elements and the degenerate-case conventions` — L · FR-003
31. `astro: Kepler solver, elliptic` — M · FR-004
32. `astro: Kepler solver, hyperbolic and near-parabolic` — M · FR-004
33. `astro: Lambert solver, zero-revolution` — L · FR-007
34. `astro: Lambert solver, multi-revolution and both branches` — L · FR-007
35. `astro: Tier 1 closed-form validation suite` — L · §7.6
36. `astro: Tier 2 property suite` — M · §7.6
37. `astro: Tier 3 — Curtis and Vallado worked examples` — L · §7.6
38. `astro: Tier 3 — poliastro fixture generator and comparison` — L · §7.6

#### E04 — Propagation and events (M1)

39. `propagation: universal-variable Kepler propagation` — L · FR-005
40. `propagation: Arc abstraction with cached elements` — M
41. `propagation: DOP853 integrator as a test oracle` — L · FR-009
42. `propagation: cross-check analytic vs numerical propagation` — M
43. `propagation: apsis-crossing event finder` — M · FR-008
44. `propagation: closest-approach finder between two propagated bodies` — L · FR-008
45. `propagation: altitude-shell crossing finder` — M · FR-008
46. `propagation: ground-station conical visibility intervals` — L · FR-008
47. `propagation: cylindrical umbra intervals with a fixed Sun vector` — L · FR-008, DEP-06

#### E05 — Simulation and determinism (M1, M6)

48. `sim: Plan and ManeuverNode with quantisation` — M · FR-101, FR-105
49. `sim: impulsive Δv application in RTN` — M · FR-006
50. `sim: Timeline construction from a plan` — L · FR-102
51. `sim: stateAt() with O(log n) arc lookup` — M · FR-103
52. `sim: incremental re-evaluation from node k onward` — L · FR-104, NFR-011
53. `sim: plan serialisation to canonical JSON` — M
54. `sim: golden-trajectory fixtures and regression test` — M · §7.6 Tier 4
55. `sim: in-process determinism fuzz test` — M · FR-109
56. `sim: cross-runtime determinism CI job (Node, 3 browsers, Worker)` — L · NFR-015
57. `sim: benchmark suite and CI regression gate` — M · NFR-011, NFR-021

#### E06 — Game rules and scoring (M2, M3)

58. `game: objective evaluation — reach_orbit` — M · FR-106
59. `game: objective evaluation — intercept and rendezvous` — M · FR-106
60. `game: objective evaluation — soft_rendezvous and station` — M · FR-106
61. `game: constraint evaluation — budget, deadline, altitude floor` — M · FR-107
62. `game: constraint evaluation — blackout, eclipse, no-fly shell, burn count` — L · FR-107
63. `game: plan legality with specific reasons L1–L6` — M · FR-108
64. `game: medal computation with assist-aware eligibility` — M · FR-301
65. `game: progression and act unlocking` — M · FR-303
66. `game: outcome diagnosis rule set` — L · FR-307
67. `game: departures registry — assert every DEP-xx lives outside the core` — M · §7.5

#### E07 — Scenario format and content (M2–M6)

68. `content: scenario JSON Schema v1 and generated types` — L · FR-201
69. `content: scenario loader with field-level validation errors` — M · FR-202
70. `content: parameterised content test suite (7 checks per scenario)` — L · §13.4
71. `content: message catalogue and brief-key resolution` — M · FR-910, NFR-028
72. `content: solver script harness for computing pars` — L
73. `content: contracts 01–02` — M · FR-204
74. `content: contract 03 (vertical-slice target)` — M
75. `content: contract 04 — LEO to GEO` — M
76. `content: contracts 05–06 — phasing` — L
77. `content: contract 07 — GEO slot` — M
78. `content: contracts 08–10 — rendezvous` — L
79. `content: contracts 11–12 — bi-elliptic and the trade` — L
80. `content: contracts 13–15 — Lambert` — L
81. `content: contracts 16–18 — complications and capstone` — L
82. `content: brief text pass for all 18 contracts` — M · design
83. `content: publish the scenario schema to the Pages site` — S

#### E08 — Renderer (M1–M4)

84. `render: Renderer interface and Canvas2D implementation` — M · D7
85. `render: camera with pan, zoom, and float64 world-to-screen` — L · NFR-010
86. `render: auto-framing with easing and manual override` — M · FR-404
87. `render: orbit tessellation in eccentric anomaly with adaptive subdivision` — L · §9.3
88. `render: tessellation cache keyed by elements and scale` — M · NFR-011
89. `render: Earth disc, coastlines, terminator` — M
90. `render: altitude floor and hazard shells` — S
91. `render: trajectory styles — solid, dotted equal-time, dashed` — M · §9.3
92. `render: ship and target markers with fading trails` — M
93. `render: maneuver node markers and two-axis handles` — L
94. `render: apsis markers and closest-approach tie line` — M
95. `render: ground-station cones and umbra band` — L
96. `render: DOM label layer positioned per frame` — M · D8
97. `render: hit-testing index with 32 px targets` — M
98. `render: devicePixelRatio handling and resize` — S

#### E09 — UI shell and screens (M2–M4)

99. `ui: design tokens and the five palettes` — L · FR-907, NFR-018
100. `ui: hash routing and screen transitions` — M
101. `ui: title screen with live background transfer` — M · §8.3.1
102. `ui: contract board with acts, cards, medals, locks` — L · §8.3.2
103. `ui: briefing screen` — M · §8.3.3
104. `ui: debrief screen — success and failure variants` — L · §8.3.9
105. `ui: settings screen, all groups` — L · §8.3.12
106. `ui: wide and narrow planner layouts` — L · §8.3.4
107. `ui: keyboard help overlay` — S
108. `ui: empty, loading, and failure states` — M · §8.7
109. `ui: browser-unsupported page` — S · §11.15

#### E10 — Planner interaction (M2–M4)

110. `planner: HUD bar with Δv budget and MET` — M · FR-401
111. `planner: timeline with nodes, scrub head, deadline wall` — L · FR-403
112. `planner: constraint bands on the timeline` — M · FR-409
113. `planner: plan panel with the node list` — M
114. `planner: readouts panel with progressive precision` — M · FR-406
115. `planner: closest-approach block` — M · FR-407
116. `planner: add a node by clicking the trajectory` — M · FR-405
117. `planner: drag a node's epoch` — L · FR-405
118. `planner: drag a node's Δv handles` — L · FR-405
119. `planner: node snapping to apsides` — M · DEP-07
120. `planner: node editor overlay with live result deltas` — L · FR-410
121. `planner: undo/redo stack` — M · FR-110
122. `planner: commit gating with inline reasons` — M · FR-408
123. `planner: assist tray with medal-eligibility display` — M · FR-411
124. `planner: full keyboard control` — L · FR-405, NFR-016
125. `planner: touch interaction and narrow-layout editing` — L · §8.5.4
126. `planner: state machine and interaction tests` — M · §8.5.1

#### E11 — Execution and replay (M2, M6)

127. `execution: playback of a solved timeline with speed control` — L · FR-601, FR-602
128. `execution: pause, abort, skip to end` — M · FR-603
129. `execution: flight log event feed` — M · FR-604
130. `execution: camera behaviour during playback` — M
131. `replay: ReplayV1 codec — canonical JSON, deflate, base64url` — L · FR-605
132. `replay: share URL generation and copy affordance` — M · FR-607
133. `replay: replay viewer route` — M · FR-606
134. `replay: version mismatch handling and messaging` — M · §11.6

#### E12 — Targeting tools (M5)

135. `targeting: Lambert targeting computer overlay` — L · FR-501
136. `targeting: live solution preview on the orbit view` — M · FR-501
137. `targeting: insert-as-plan as one undo entry` — M · FR-502
138. `targeting: porkchop Web Worker with progressive grid refinement` — L · FR-503
139. `targeting: porkchop plot rendering with hatch ramp and legend` — L · FR-504
140. `targeting: porkchop selection populates the solver` — M · FR-505
141. `targeting: unlock gating and medal-cap display` — M · FR-506

#### E13 — Onboarding and Codex (M3–M6)

142. `onboarding: coach-mark framework, dismissible and permanent` — M · FR-902
143. `onboarding: coach marks for contracts 01–04` — M
144. `codex: entry framework with progressive disclosure and deep links` — L · FR-903
145. `codex: live simulated diagram component` — L
146. `codex: entries for Acts I–II concepts` — M · content
147. `codex: entries for Acts III–IV concepts` — M · content
148. `codex: entries for Act V–VI concepts` — M · content
149. `codex: departure entries linking docs/PHYSICS.md` — M · FR-904

#### E14 — Accessibility (M3–M6)

150. `a11y: canvas-to-DOM parity audit and gaps closed` — L · FR-905
151. `a11y: aria-live announcements with a verbosity setting` — M · §8.8
152. `a11y: focus management across screens and overlays` — M
153. `a11y: axe-core in CI on every route` — M · NFR-017
154. `a11y: greyscale visual-regression snapshots` — M · NFR-019
155. `a11y: contrast validation across all five palettes` — M · NFR-018
156. `a11y: prefers-reduced-motion throughout` — M · FR-908
157. `a11y: keyboard-only Playwright walkthrough of Acts I–III` — M · NFR-016
158. `a11y: external screen-reader playtest and fixes` — L · §13.6

#### E15 — Art, audio, presentation (M3–M7)

159. `design: icon set (≤20 inline SVG glyphs)` — M
160. `design: Natural Earth coastline processing script and data` — M · §9.6
161. `design: motion specification implemented` — S · §9.4
162. `audio: cue set produced and licensed` — L · §9.5
163. `audio: playback layer with lazy loading and mute default` — M
164. `design: logo SVG, favicon, OG/social card` — M
165. `design: light palette and theme switching` — M

#### E16 — Persistence and settings (M3–M4)

166. `save: versioned localStorage schema with migrations` — M · FR-701
167. `save: graceful degradation when storage is unavailable` — M · FR-702, NFR-014
168. `save: export and import as JSON` — M · FR-703
169. `settings: persistence and immediate application` — M · FR-704
170. `settings: keybinding remap with conflict detection` — L · FR-705
171. `pwa: service worker, offline shell, scenario precache` — L · NFR-026

#### E17 — Backend, daily, telemetry (M6–M7)

172. `daily: deterministic scenario generator with archetypes` — L · FR-205
173. `daily: rejection sampling for quality and feasibility` — L · FR-206
174. `daily: daily UI, past-30-days browsing, local streak` — M · FR-207
175. `backend: Worker scaffold, routes, D1 schema, migrations` — L
176. `backend: submission verification by re-evaluation` — L · FR-802, §11.11
177. `backend: signing and identity keypair on the client` — M · FR-801
178. `backend: rate limiting per identity and per IP` — M · FR-804
179. `backend: leaderboard read with the requester's neighbourhood` — M · FR-806
180. `backend: replay fetch and watch-a-run flow` — M · FR-807
181. `backend: handle blocklist and admin redaction path` — M · FR-808
182. `backend: offline submission queue and retry` — M · FR-805
183. `backend: staging environment and deploy workflow` — M
184. `backend: load test at 20× target` — M · §14.5
185. `telemetry: first-party event endpoint and client` — L · §11.14
186. `telemetry: opt-out, DNT/GPC honouring, published event list` — M · NFR-025
187. `docs: privacy note in-app and in README` — S · §11.12

#### Cross-cutting (various)

188. `perf: performance pass on the reference laptop` — L · NFR-021
189. `perf: performance pass on the reference phone` — L · NFR-021
190. `qa: e2e journeys E1–E15` — L · §13.5
191. `qa: playtest round M2 and report` — M · playtest
192. `qa: playtest round M3 and report` — M · playtest
193. `qa: playtest round M5 and report` — M · playtest
194. `qa: playtest round M6 and report` — M · playtest
195. `docs: TELEMETRY.md, PARS.md, and the validation table completion` — M · NFR-023
196. `release: v1.0 launch checklist` — M · §14.5

> ~195 seed issues, before the ones that playtesting and implementation will generate. Expect the real total to land near 240.
>
> (Item 19, adapting the `issue` skill to this org and board, was completed on 2026-09-01 and removed from the list. Numbering below it is unchanged, so cross-references from elsewhere in this document still resolve.)

### 15.7 Traceability

Every FR maps to at least one epic and one milestone. This table is the check that nothing in §10 is unowned.

| FR range | Epic(s) | Milestone(s) |
| --- | --- | --- |
| FR-001 – FR-012 | E02, E03, E04 | M0, M1 |
| FR-101 – FR-110 | E05, E10 | M1, M2 |
| FR-201 – FR-208 | E07, E17 | M2–M7 |
| FR-301 – FR-307 | E06, E09 | M2, M3 |
| FR-401 – FR-411 | E08, E09, E10 | M2–M4 |
| FR-501 – FR-506 | E12 | M5 |
| FR-601 – FR-607 | E11 | M2, M6 |
| FR-701 – FR-705 | E16 | M3, M4 |
| FR-801 – FR-809 | E17 | M7 |
| FR-901 – FR-910 | E13, E14, E07 | M3–M6 |
| NFR-001 – NFR-010 | E01, E02, E03, E08 | M0, M1 |
| NFR-011 – NFR-015 | E05, E08 | M1, M6 |
| NFR-016 – NFR-019 | E14 | M3–M6 |
| NFR-020 – NFR-021 | E01, E08 | M0, M6 |
| NFR-022 – NFR-024 | E01, E03 | M0 |
| NFR-025 – NFR-028 | E17, E07, E01 | M0, M7 |

---

## 16. Risks

Ordered by expected damage. Each has an owner action, not just a hope.

| # | Risk | Likelihood | Impact | Mitigation | Trigger to act |
| --- | --- | --- | --- | --- | --- |
| R1 | **The planner does not feel good.** Dragging a node and watching an orbit change is the whole game; if the interaction is laggy, imprecise, or confusing, nothing else matters. | Medium | Fatal | M1's spike exists precisely to de-risk this, before any UI is built around it. Performance budgets (NFR-011) are gates, not aspirations. 5 playtest sessions at M2 on the slice alone. | If the M1 spike cannot drag a node at 60 fps with a legible result, stop and re-plan the renderer before M2. |
| R2 | **Scope.** Games die of scope, and this document describes a lot of game. | High | Severe | Acts IV–VI are explicitly the compressible scope (§14.1). The game is shippable at M4 with 10 contracts. §2.2 is a contract with ourselves. | Any milestone slipping by >50% triggers a scope conversation, not a schedule extension. |
| R3 | **A physics bug found publicly after launch.** Our entire differentiation is that the numbers are right. | Medium | Severe | Four tiers of validation (§7.6), independent references, golden fixtures. And a *cultural* mitigation: the discrepancy template is one click from the debrief, and being fast and honest about a wrong number is better than never having one. | Any confirmed `physics` issue is P0 and gets a same-week fix and a `CHANGELOG` Physics entry. |
| R4 | **Solo-maintainer bandwidth.** ~38 weeks part-time is a long time to hold momentum alone. | High | Severe | Milestones are independently shippable and each ends with something playable on a public URL. `good first issue` labelling from M3 to grow contributors. The engine packages are useful to others even if the game stalls. | Two consecutive milestones missed → cut to the M4 scope and ship. |
| R5 | **Onboarding fails.** The counter-intuitive core is exactly what makes the first ten minutes hard. | Medium | Severe | Contracts 01–02 teach one fact each with one burn. Coach marks. The Codex. And the measurement: M1/M2/M3 in §2.3 are early-warning metrics, checked at every playtest round. | M1 (tutorial completion) below 50% at any playtest round → redesign Act I before proceeding. |
| R6 | **Cross-platform numerical divergence** flips a medal or invalidates a leaderboard. | Medium | Moderate | The determinism spec (§11.4) explicitly does *not* assume bit-equality, quantises inputs, and scores on rounded bands. A cross-runtime CI job on five runtimes. | Any cross-runtime disagreement above 1e-6 relative blocks the release. |
| R7 | **Lambert or multi-rev solver instability** at edge cases. These solvers are genuinely hard. | Medium | Moderate | Property tests across the full domain; both branches tested; comparison against `poliastro`'s Izzo implementation; explicit non-convergence returned as a typed result rather than a silent wrong answer. | Non-convergence rate above 0.1% over the property domain → change algorithm before M5. |
| R8 | **Leaderboard abuse or spam** on a no-accounts system. | Medium | Moderate | Server-side re-evaluation makes fake scores impossible; rate limits make spam expensive; public replays make cheating visible; redaction handles handles. | Sustained abuse → require a proof-of-work token on submission, which is a known, small change. |
| R9 | **Content authoring is slower than estimated.** Each contract needs a solver run, a par derivation, brief text, and playtesting. | High | Moderate | The solver harness (issue 72) is built once and reused. The parameterised content test suite makes each new contract cheap to trust. Acts compress. | If a contract takes more than 2 days, simplify it rather than extend the milestone. |
| R10 | **The scale problem beats the renderer** — LEO contracts look cramped and unreadable. | Medium | Moderate | Auto-framing to orbits rather than Earth, altitude rulers, and text labels carrying the numbers (§8.4). Validated at M2 playtest. | If LEO framing tests badly, add a Codex-only compressed-radial diagram mode — never in the planner. |
| R11 | **Preact/signals turns out to be the wrong shell** for a 60 Hz HUD. | Low | Moderate | Decision D9 is explicitly reviewable at M2 exit; `preact/compat` makes React a drop-in. | HUD re-render cost above 2 ms/frame → switch. |
| R12 | **A dependency's licence** turns out to be incompatible with MIT redistribution. | Low | Moderate | CI licence scan (NFR-024); `ATTRIBUTIONS.md` updated in the adding commit; a strong preference for zero runtime dependencies in the core packages. | Any non-permissive licence found → replace before merge. |
| R13 | **Cloudflare free tier** proves insufficient or its terms change. | Low | Low | The backend is ~600 lines behind five HTTP endpoints, and the game degrades to fully playable without it (FR-809). Porting to another edge platform is days, not weeks. | Any quota breach → evaluate; the game does not stop working meanwhile. |
| R14 | **Nobody plays it.** | Medium | Moderate | This is the least controllable risk and the least damaging: the engine, the validation work, and the four games behind it all still stand. Launch channels are chosen for where P2 lives (§14.5), because P2 amplifies. | If M8 (stars) is under 10% of target at day 90, the lesson is about distribution, not about the game. |

---

## 17. Open questions

Genuinely undecided. Each names who or what resolves it and by when.

| # | Question | Resolve by | How |
| --- | --- | --- | --- |
| Q1 | Should Contract 03 be the vertical-slice target, or is C01 a better slice? C03 exercises intercept and timing (more of the system); C01 is what a real player sees first. | M2 start | Pick C03 for the slice — it exercises more architecture — and build C01 immediately after. Confirm at M1 exit. |
| Q2 | Is the two-axis (prograde/radial) Δv handle enough in 2D, or does radial-only-when-needed reduce clutter? | M2 playtest | Playtest both. Radial burns matter for Lambert solutions and for eccentric rendezvous, so they cannot be cut — only hidden until first needed. |
| Q3 | Should the deadline be a hard fail or a score penalty? Hard fail is clearer; a penalty allows "I got there, just late". | M3 | Hard fail for v1.0 (clarity beats nuance in a puzzle game); revisit if playtests show it reads as unfair. |
| Q4 | Does the Δv budget deplete across *attempts* in any contract? Currently no (§6.11). A "one shot" contract could be dramatic. | M6 | Try one as a Contract 18 variant in playtest. Default to no. |
| Q5 | Should there be an all-time per-contract leaderboard, not just the daily? It is more content for P2, but it also fossilises early pars. | v1.4 | Deferred out of v1.0 deliberately. Revisit with real player data. |
| Q6 | How much of the Codex should be *required* reading vs. entirely optional? Currently entirely optional. | M3 playtest | Measure `codex_open` against contract failure rates. If failing players never open it, the game must teach in the planner instead. |
| Q7 | Does the game need a "sandbox" mode — an orbit and no objective — for P3 (educators)? Cheap to build on top of the planner. | M5 | Likely yes, as a small v1.1 addition. Not v1.0 scope. |
| Q8 | Should `@hh/astro` aim to be a *publishable* library from the start (documented public API, semver) or stay internal until v2.0? | M1 exit | Stay internal (D2), but keep the API clean enough that extraction is mechanical. |
| Q9 | Is Ed25519 signing worth the complexity for FR-801, given it does not stop a determined attacker? | M7 | Probably yes — it is ~20 lines with WebCrypto and it makes rate limiting meaningful. Confirm when building the Worker. |
| Q10 | Does the fixed-Sun approximation (DEP-06) hold well enough for Contract 17's eclipse windows, or does it need a low-precision solar ephemeris? | M6 | Compute the worst-case umbra-boundary error over a 12 h contract during content authoring. If it exceeds the window tolerance, add a Meeus low-precision Sun position — a ~40-line addition. |
| Q11 | Should replays record the *assist state* per-node rather than per-run, so partial assist use can be scored more finely? | M6 | Per-run for v1.0. Simpler, and the Clean/Assisted split is the only distinction the leaderboard needs. |
| Q12 | Custom domain for the Pages site, or the default `astro-game-lab.github.io/hohmann-heist`? | M7 | Default for launch; a domain is a one-line change later and costs nothing to defer. |

---

## 18. Assumptions

Stated so that if one turns out false, the affected design is identifiable.

| # | Assumption | If false |
| --- | --- | --- |
| A1 | A part-time solo maintainer with ~10 h/week is the resourcing model. | Milestones re-scope, not re-date. |
| A2 | Players have a pointer *or* a touchscreen *or* a keyboard; the game requires exactly one. | Already handled — every input path is complete on its own. |
| A3 | Analytic Kepler propagation is fast enough that no numerical integration is needed in the game path (D5). | M1's spike falsifies this early; the fallback is a fixed-step integrator with a state cache, which costs the "scrub anywhere instantly" property. |
| A4 | Two-body physics is sufficiently interesting for 18 contracts. | Act VI's operational constraints exist partly as insurance here; if it is thin, v1.1's plane changes move forward. |
| A5 | Cross-platform float differences stay below 1e-6 relative for the operations we use. | The determinism spec would need integer-only scoring, which is a larger change; the quantisation (DEP-09) is the first line of defence and is already in place. |
| A6 | GitHub Pages and a Cloudflare free-tier Worker suffice at the target scale. | R13. |
| A7 | ~~The org's `issue` skill will be adapted to `astro-game-lab` before the backlog is worked.~~ **Done 2026-09-01** — no longer an assumption. | n/a |
| A8 | No legal or licensing obstacle to Natural Earth coastline data or textbook-derived validation values. | Natural Earth is public domain; textbook *values* are facts, not expression, and are cited. |
| A9 | Playtest recruitment of ~8 people per round is achievable through the org's Discussions and personal networks. | Rounds shrink to 3–4 rather than being skipped; the qualitative signal survives small N. |

---

## 19. Glossary

Terms the game uses, defined as it defines them to players.

| Term | Definition |
| --- | --- |
| **Apoapsis** | The high point of an orbit. |
| **Periapsis** | The low point of an orbit. |
| **Delta-v (Δv)** | A change in velocity. The currency of spaceflight — every maneuver costs some, and you only have so much. |
| **Prograde / retrograde** | Along, or against, the direction of travel. (Strictly, along the *transverse* axis — see DEP-10.) |
| **Radial in / out** | Toward or away from the body you are orbiting. |
| **Normal** | Perpendicular to the orbital plane. Not used in v1.0 content. |
| **RTN / LVLH** | The radial–transverse–normal frame attached to the spacecraft. The frame all player Δv is expressed in. |
| **Hohmann transfer** | The two-burn transfer between two circular orbits. Usually the cheapest, rarely the fastest. |
| **Bi-elliptic transfer** | A three-burn transfer via a very high intermediate point. Cheaper than Hohmann above a radius ratio of ~15.6, and much slower. |
| **Phasing orbit** | A temporary orbit with a different period, used to change where you are in an orbit rather than which orbit you are in. |
| **Intercept** | Arriving at the same place as the target. |
| **Rendezvous** | Arriving at the same place *and the same velocity* as the target. |
| **Lambert's problem** | Given two positions and a time to travel between them, find the orbit that does it. |
| **Porkchop plot** | A contour map of transfer cost over departure and arrival times. Named for the shape of its contours. |
| **Maneuver node** | A planned burn: a time and a delta-v. |
| **MET** | Mission elapsed time, counted from the start of the contract. |
| **Osculating elements** | The orbit you would follow from your current state if nothing else acted on you. |
| **Eccentricity (e)** | How elongated an orbit is. 0 is a circle. |
| **Semi-major axis (a)** | Half the long axis of the orbit's ellipse. It alone determines the orbital period. |
| **True anomaly (ν)** | Where you are around the orbit, measured from periapsis. |
| **Umbra** | The full shadow behind a body. |
| **Par** | The delta-v and time of the best solution we know of. |

---

## 20. References

### Astrodynamics

- Vallado, D. A. — *Fundamentals of Astrodynamics and Applications*. The primary reference for algorithms, conventions, and worked examples. Cite edition and example number in every test.
- Curtis, H. D. — *Orbital Mechanics for Engineering Students*. The clearest worked examples for element conversion and transfers.
- Battin, R. H. — *An Introduction to the Mathematics and Methods of Astrodynamics*. For Lambert's problem in depth.
- Izzo, D. (2015) — *Revisiting Lambert's Problem*. The algorithm `poliastro` implements; the reference for the multi-revolution solver.
- Bate, Mueller & White — *Fundamentals of Astrodynamics*. Universal variables.

### Independent implementations for validation

- [`poliastro`](https://docs.poliastro.space/) — element conversion, propagation, Lambert.
- [`astropy`](https://www.astropy.org/) — time scales and frames.
- [GMAT](https://software.nasa.gov/software/GSC-18094-1) — mission-level cross-checks.
- [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) — real body states.

### Constants and data

- WGS-84 / EGM-96 — Earth gravitational parameter and radius.
- IERS Conventions — Earth rotation rate.
- [Natural Earth](https://www.naturalearthdata.com/) — coastline data, public domain.

### Design and craft

- Kerbal Space Program's maneuver-node UI — the interaction to learn from and improve on.
- *Opus Magnum*, *Baba Is You* — the retry loop and the "one more attempt" feeling.
- WCAG 2.2 — the accessibility target.

### Org documents

- `astro-games-roadmap.md` (workspace) — the portfolio this game leads.
- [`astro-game-lab/.github/CONTRIBUTING.md`](https://github.com/astro-game-lab/.github/blob/main/CONTRIBUTING.md) — physics-change requirements.
- Workspace `CLAUDE.md` — simulation conventions, stack, and Git/GitHub practice.

---

## Appendix A — Reference calculations

Computed from the constants in §7.3. **These are inputs to tests, not test oracles** — every one must be independently re-derived when its test is written (§7.6 process rule).

```
μ = 3.986004418e14 m³/s²      R⊕ = 6378137.0 m       r_GEO = 42164140.0 m

Circular orbits
  400 km altitude:  r = 6778137 m   v = 7668.6 m/s   T = 5553.6 s  (92.56 min)
  800 km altitude:  r = 7178137 m   v = 7451.8 m/s   T = 6052.4 s  (100.87 min)
  GEO:              r = 42164140 m  v = 3074.66 m/s  T = 86164.0 s (23.934 h)

Hohmann 400 → 800 km            (Contracts 01–03)
  Δv₁ = 109.1 m/s   Δv₂ = 107.6 m/s   total = 216.7 m/s   TOF = 2900.6 s (48.3 min)

Hohmann 400 km → GEO            (Contract 04)
  Δv₁ = 2397.5 m/s  Δv₂ = 1456.5 m/s  total = 3854.0 m/s  TOF = 19048.6 s (5.29 h)

Phasing at 400 km, close 40° of lead    (Contract 05)
  revs   phasing T    a_ph      periapsis alt    Δv total    elapsed
    1     4936.6 s   6266.3 km    −623.7 km      639.8 m/s    1.37 h   ← below the surface
    3     5347.9 s   6609.7 km      63.2 km      196.7 m/s    4.46 h   ← below the floor
    5     5430.2 s   6677.3 km     198.4 km      116.2 m/s    7.54 h
    8     5476.5 s   6715.2 km     274.2 km       72.0 m/s   12.17 h   ← par
   10     5491.9 s   6727.8 km     299.4 km       57.4 m/s   15.26 h   ← past the deadline
  The 100 km altitude floor and the 14 h deadline together make N = 8 the answer.

Phasing at 400 km, shed 25° of lead      (Contract 06)
  revs   phasing T    a_ph      apoapsis alt     Δv total    elapsed
    2     5746.5 s   6934.1 km     712.0 km      171.6 m/s    3.19 h
    3     5682.2 s   6882.3 km     608.4 km      115.7 m/s    4.74 h
    5     5630.8 s   6840.8 km     525.2 km       70.0 m/s    7.82 h
    8     5601.8 s   6817.3 km     478.3 km       44.0 m/s   12.45 h   ← par
   10     5592.2 s   6809.5 km     462.7 km       35.3 m/s   15.53 h   ← past the deadline
  No floor applies going up, so here the 14 h deadline alone sets the answer.

GEO longitude repositioning     (Contract 07)
  Δa = 10 km → −0.1284 °/day, 0.73 m/s round trip, 23.4 days for 3°
  Δa = 23 km → −0.2954 °/day, 1.68 m/s round trip, 10.2 days for 3°   ← par
  Δa = 50 km → −0.6421 °/day, 3.65 m/s round trip,  4.7 days for 3°

Bi-elliptic vs Hohmann, 400 km → 108450 km (r₂/r₁ = 16)    (Contract 11)
  Hohmann                              4112.2 m/s   in  19.11 h
  Bi-elliptic via r_b = 500 000 km     4031.3 m/s   in  17.01 days
    (3103.7 + 387.1 + 540.6)
  Saving 80.9 m/s costs 16.2 extra days. Theory: Hohmann always wins below
  r₂/r₁ = 11.94; bi-elliptic always wins above 15.58.
```

## Appendix B — Change log for this document

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 2026-09-01 | Initial draft. Decisions D1–D14 taken; FR-001–FR-910 and NFR-001–NFR-028 assigned; seed backlog of ~196 issues. |
| 0.1.1 | 2026-09-01 | Corrected C06 par to the computed 44.0 m/s and marked C08 par TBD pending deadline tuning; added C06 to Appendix A. `issue` skill repointed to `astro-game-lab` and board #1, so seed item 19 was removed and assumption A7 closed. |
