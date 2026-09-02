# Design — Hohmann Heist

The short version. [`docs/PRODUCT.md`](PRODUCT.md) is the full product definition and the authority on anything below; this document exists so a contributor can understand what the game is without reading 2 800 lines first.

## Pitch

A puzzle game about stealing things in orbit, where the only weapon is orbital mechanics. You get a target, a delta-v budget, and a deadline. You plan a sequence of burns, watch the predicted trajectory bend as you drag each one, and commit.

Every number in it is real. The delta-v for LEO→GEO is 3 854 m/s because that is what it costs.

## The fantasy

You are the person in the room who can see the trajectory. Not a pilot — a planner. The crew has the hardware and the nerve; you have the transfer.

The feeling being sold is **the click**: the moment a player who has been fighting the controls suddenly sees that to catch something ahead of you, you slow down. That moment is the product. Everything else exists to get more people to it and keep them there afterwards.

## What the player actually does

1. **Pick a contract.** A target, a budget, a deadline, and sometimes a complication.
2. **Plan.** Add maneuver nodes on a scrubbable timeline. Drag a node's epoch or its delta-v and the predicted trajectory changes under your hands. Readouts show apoapsis, periapsis, period, and — the one that matters — predicted closest approach and relative speed.
3. **Commit.** Watch it play out. There is no hidden variance: **the prediction *is* the simulation**, so the game never surprises you with a discrepancy between what it showed and what happened.
4. **Debrief.** Your delta-v and time against par, and a sentence explaining what actually happened. *"You arrived 21 minutes early. Your phasing orbit was 4.1 km lower than it needed to be."*
5. **Retry**, with your plan intact. A failed attempt is a starting point, not a punishment.

Planning is paused and unlimited. Nothing is lost by experimenting, and the only cost of failure is the time spent watching it.

## The astrodynamics

- **The concept:** orbital period depends only on semi-major axis, so changing *where you are* in an orbit means changing *which orbit you are in*.
- **How the mechanic makes you feel it:** to catch a target ahead of you, you must burn retrograde. Dropping into a lower orbit shortens your period and you gain angle every revolution. The game gives you a target 40° ahead and a budget that only a phasing orbit can satisfy.
- **Afterwards** a player can explain why speeding up makes you arrive later, which is the single most counter-intuitive fact in the subject.

Six acts build from single burns to constrained multi-burn rendezvous with a Lambert solver. See §6.8 of the product definition for the full contract list.

## Fidelity boundary

| The game is honest about | The game deliberately simplifies |
| --- | --- |
| Delta-v budgets, orbital periods, transfer geometry, phasing, the delta-v/time trade | Instantaneous burns, no propellant mass, forgiving rendezvous tolerances, accelerated time |

**The authoritative list of departures is the `DEP-xx` table in [`docs/PHYSICS.md`](PHYSICS.md#gameplay-departures)**, and it is deliberately not duplicated here. Two lists of the same thing drift, and then nobody knows which is true. That table is also the enforcement point: nothing in it may live in the simulation core, and CI checks the import direction.

The rule: a player who checks a number against a textbook should find that we agree, or find the difference documented and deliberate.

## Difficulty and onboarding

Orbital mechanics is genuinely counter-intuitive, and the game has to teach that rather than punish ignorance of it.

- **First five minutes:** one burn, one fact. Contract 01 raises apoapsis and shows that a prograde burn changes the orbit on the *opposite* side. Nothing is explained that can be demonstrated.
- **Assumed knowledge:** none. Vocabulary arrives one word at a time, always with the plain-English gloss on first use.
- **Assists:** trajectory prediction is not an assist, it is the medium. Closest-approach markers, node snapping and constraint previews are on by default and can be turned off for a harder run. The Lambert targeting computer unlocks late — it does not solve the game, it turns the game into a search over departure and arrival times, which is the more interesting problem.
- **Failure:** there is no lose state. Commit is blocked only when a plan is *illegal* (over budget, hits the atmosphere, misses the deadline), never merely because it will fail — committing a plan you know will fail is a legitimate way to learn, and the debrief for a near miss is one of the best teaching moments the game has.

## Presentation

- **Visual approach:** mission control, after hours. Dark, dense, monospaced. The orbit view is a plot, not a scene: no starfield parallax, no lens flare. The trajectory is the artwork.
- **The scale problem:** Earth's radius is 6 378 km, LEO sits 400 km above it, GEO is 6.6 radii out. Rendering is **linear and auto-framed** to fit the relevant orbits, never logarithmic — a distorted radius would make an ellipse not look like an ellipse, and the intuition the game builds would rest on a lie.
- **A detail worth keeping:** the predicted trajectory is dotted at **equal time intervals**, so the dots crowd at apoapsis and spread at periapsis. The speed is visible in the spacing. Free, correct, and it teaches something.
- **Accessibility:** all text lives in the DOM and only geometry is drawn on canvas, so screen readers, browser zoom and translation work. Five colour palettes; nothing is conveyed by colour alone; every action is reachable from the keyboard.

## Scope

- **In scope for v1:** 18 hand-authored contracts, a procedurally generated daily challenge, medals and par, replay sharing, a leaderboard with server-side verification.
- **Explicitly out of scope:** vehicle construction, launch and reentry, staging, attitude control, docking minigames, multiplayer, accounts, monetisation.
- **Deferred:** inclination and plane changes (v1.1), J2 and finite burns as opt-in fidelity (v1.2), a scenario editor (v1.3).

Games die of scope. The list of what is not being built is the load-bearing half.

## Open questions

Tracked in §17 of the product definition. The ones that will most change the game:

- Is the deadline a hard fail or a score penalty?
- How much of the Codex should be required reading versus entirely optional?
- Does the game need a sandbox mode for educators?
