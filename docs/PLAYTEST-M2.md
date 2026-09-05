# M2 playtest round — the vertical slice

**Issue:** [#208](https://github.com/astro-game-lab/hohmann-heist/issues/208) ·
**Milestone:** M3 *(deferred from M2)* · **Status: prepared, not yet run.** ·
**Sessions: 0 of 5**

> **This report is a skeleton.** The protocol, the consent form and the observation sheet
> are ready and the build under test is live and verified; the five sessions have not
> been run. Every table below is empty by design. An empty cell here means *not yet
> measured* — it does not mean zero, and it must not be read as one.
>
> The round is finished when every field is filled, every finding links to an issue, and
> the recordings have been destroyed on the date this report names.

> ### `v0.1.0` shipped without this round
>
> On **2026-09-05** `v0.1.0` was released with **0 of 5** sessions run — a deliberate
> waiver by the owner, recorded in §14.1's M2 row and in `CHANGELOG.md`. The round is
> **deferred, not cancelled**, and #208 is re-opened against M3.
>
> Two things follow, and they change how this round is run rather than whether it is.
>
> **It is no longer a pre-release gate, so what it protects has changed.** Its findings
> were meant to shape the slice before anyone else saw it; they will now arrive against a
> build that is already public. That is a worse position to learn from — a first
> impression cannot be re-taken — and it is the actual cost of the waiver.
>
> **The build under test will not be `v0.1.0`.** By the time these sessions run, M3 will
> have moved the planner underneath them. Record what the debrief's `Build` line says and
> compare findings against *that*, not against this document's original intent. A finding
> from a session on M3's build is not evidence about `v0.1.0`, and this report must not be
> read as though it were.

M2's exit criteria (§14.1) ask for "5 playtest sessions run and reported". §13.6 is the
protocol; `docs/playtest/PROTOCOL.md` is how it gets executed and
`docs/playtest/OBSERVATION-SHEET.md` is what each session produces. This document is the
round.

## What is being tested

Contract 03, "Cold Open", played end to end on the deployed build — briefing → planner →
commit → execution → debrief — by five people who have not seen it before.

C03 is a single-burn intercept. `KESTREL-2` runs 400 km above the ship in a circular
orbit, 14° ahead; the budget is 300 m/s against a par of 109.1 m/s, and the deadline is
three hours against a par time of 68.7 minutes. Getting up there is nearly free. Arriving
while the target is still there is the whole contract, and it is the only thing the round
is really asking about.

### The build

Recorded here rather than assumed, because a session run against a stale deployment
measures the deployment.

| | |
| --- | --- |
| **URL** | <https://astro-game-lab.github.io/hohmann-heist/> |
| **Build under test** | *(record at session 1, from the debrief's `Build` line)* |
| **Smoke check** | `tools/smoke/smoke.sh https://astro-game-lab.github.io/hohmann-heist/` — record the date it last passed |

**The build says what it is.** §14.4's identifier is printed on the debrief — `Build 0.0.0
(ae569e9)` — so read it off the screen at the end of each session and write it on the
sheet. The round's build is whatever session 1 recorded; record it above once, and check
each later session against it.

Re-run the smoke check before each session. **If the identifier has changed between two
sessions, the build under test has changed, and those two sessions are not measuring the
same thing** — say so in the findings rather than averaging across the change.

> **Why this is no longer a hard-coded SHA.** It was one, naming `88853ce` and
> `index-Csh5p3Kl.js`, and that was correct when this document was written and stopped
> being correct the next day when #249 deployed. Nothing was measured against the stale
> pin — no session had run — but a pin that has to be hand-updated after every deploy is a
> pin that will eventually be wrong at the one moment it matters. The build now reports
> itself, so the round records what it *saw* rather than restating what it *expected*.

## Two adaptations, and why they were needed

§13.6 was written against the finished game. Two of its provisions do not survive contact
with a build that ships one contract, and both are recorded here rather than quietly
worked around.

### 1. "Time to the click" has no C05 to be measured against

§13.6 names the signal **"time to the click (C05)"** and calls it the headline number.
C05 "Tailgate" is the contract built around that insight — *to catch something ahead of
you, burn retrograde* (§6.5) — and it does not exist until M3. The signal cannot be
measured as written, and a report claiming otherwise would be claiming something false.

The M2 round records a **proxy**, labelled as one everywhere it appears: the first time
the player moves the departure epoch after at least one edit that changed only Δv. That
transition — from *how hard to push* to *when to push* — is the observable form of C03's
own lesson, which its coach mark states outright:

> "The target keeps moving while you climb. When you leave decides where it will be when
> you get there."

**The proxy is not §13.6's number and is not comparable with one.** M3's round measures
the real signal against C05, and it does not get to plot the two on the same axis.

### 2. §6.12 had no C03 row

The learning-outcome check is "a three-question verbal check after the relevant
contract", against §6.12's row for that contract. §6.12's table ran C01, C02, **C04**,
C05 — it skipped C03 entirely. The one contract in the slice had no outcome to check
against.

A row was added in the pull request that prepared this round:

> **C03** — Explain why *when* you leave decides where the target will be when you
> arrive.

That outcome is what the three questions in `docs/playtest/PROTOCOL.md` test. Like every
other §6.12 row it maps to a Codex entry, which is M3+ work and is not blocked by this.

## Participants

§13.6 gives the mix for an eight-session round — four P1, three P2, one P3 — and does not
give one for M2's five. **Planned: three P1, one P2, one P3.** P1 stays dominant because
§3 makes P1 the priority persona, and the single P3 session is kept rather than dropped
so the educator read is not deferred to M3.

| Label | Profile planned | Profile as recruited | Screening answer | Date | Session length |
| --- | --- | --- | --- | --- | --- |
| P1 | P1 | | | | |
| P2 | P1 | | | | |
| P3 | P1 | | | | |
| P4 | P2 | | | | |
| P5 | P3 | | | | |

*Record the mix as actually recruited even where it diverges from the plan. A round run
with a different mix is still a round; a report that does not say so is not a report.*

## Signals

One row per participant. **N/A is a value and needs a reason; a blank is not.**

### 1 — Time to first successful burn

| | P1 | P2 | P3 | P4 | P5 |
| --- | --- | --- | --- | --- | --- |
| Time | | | | | |
| Plans committed first | | | | | |

### 2 — The click *(M2 proxy — see the adaptation above)*

| | P1 | P2 | P3 | P4 | P5 |
| --- | --- | --- | --- | --- | --- |
| Time to first epoch move | | | | | |
| Δv-only edits first | | | | | |

### 3 — Learning outcome (§6.12, C03)

| | P1 | P2 | P3 | P4 | P5 |
| --- | --- | --- | --- | --- | --- |
| Q1 — same burn, ten minutes later | | | | | |
| Q2 — did the target moving matter | | | | | |
| Q3 — what made it hard | | | | | |
| **Overall** | | | | | |

### 4 — Confusion points

| | P1 | P2 | P3 | P4 | P5 |
| --- | --- | --- | --- | --- | --- |
| Questions asked | | | | | |
| Mis-clicks | | | | | |
| Pauses ≥ 10 s | | | | | |

The questions themselves are the finding, not the count. Verbatim, grouped by what they
were actually asking about:

>

### 5 — Vocabulary failures

Terms used but not definable, by participant:

| Term | P1 | P2 | P3 | P4 | P5 |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

Terms participants used that the slice does not put on screen:

>

### 6 — Abandonment

| | P1 | P2 | P3 | P4 | P5 |
| --- | --- | --- | --- | --- | --- |
| Abandoned / finished / timed out | | | | | |
| Where | | | | | |
| Nearly gave up at | | | | | |

## Findings

**A round that produces notes but no issues has not finished** (§13.6). Every row here
links to the issue it generated, or to the open issue that already covers it.

| # | Finding | Signal(s) | Participants | Severity | Issue |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

## What this changes about M3

Filled in once the findings exist. M3's scope is adjusted against this section, and
"nothing changed" is a legitimate outcome that has to be written down rather than left
implied.

>

## Data handling

Per the consent given (`docs/playtest/CONSENT.md`) and §11.12's stance that nothing is
collected in order to avoid needing more.

| | |
| --- | --- |
| **Recorded** | Screen and voice. No webcam, no face, no name, no contact details beyond a way to reach the facilitator |
| **Stored** | On the facilitator's own device only. Not uploaded, not shared |
| **Retention** | Deleted within **30 days of each session**, and sooner once this report is written |
| **Deletion due** | *(per-session dates, from the sheets)* |
| **Deleted on** | *(record the actual date — deletion is a task, not an intention)* |
| **Kept indefinitely** | The observation sheets, without names. Comparing one round against the next is why rounds are run |
| **In this report** | Participants appear as labels only. Quotes are attributed to a label and to nothing else |

Signed consent forms are stored separately from the observation sheets, so that a form
and a sheet cannot be matched to each other.

## Also outstanding at M2 exit

§14.1's M2 row asks for a **go/no-go on D9** — Preact plus `@preact/signals`, on the
claim that fine-grained signals suit a HUD updating at 60 Hz without re-rendering panels.
That decision is not this round's. It is
[#248](https://github.com/astro-game-lab/hohmann-heist/issues/248), opened alongside this
round for the reason #239 opened #238 — an exit criterion with no issue behind it is an
exit criterion nobody is holding. §16's R11 sets the trigger: HUD re-render cost above
2 ms/frame means switch, and `preact/compat` makes React a drop-in if it does.

**Settled, 2026-09-05.** #248 measured it: HUD re-render costs 0.285 ms/frame at 1× and
0.420 ms at 10 000×, against R11's 2 ms trigger, with no frames dropped. Preact is a go;
`@preact/signals` turned out to be a declared dependency that nothing imported and the
bundle never contained, and is dropped. `docs/DECISION-D9.md` records it. **The five
sessions are therefore the only M2 exit criterion still open.**
