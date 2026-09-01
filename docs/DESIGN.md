# Design — __GAME_NAME__

> Sketch this early and revise it often. It does not need to be long; it needs to be honest about what the game is and who it is for.
>
> Delete this blockquote once you have started.

## Pitch

_One or two sentences. What is it, and why would someone play it?_

## The fantasy

_What does the player get to feel like? "A flight director threading a launch window", "an orbital mechanic keeping a dying constellation alive". This is what the physics is in service of._

## What the player actually does

The core loop, concretely. What is the player looking at, what decisions do they make, what feedback do they get, and what makes them want to go again?

1. _..._
2. _..._
3. _..._

## The astrodynamics

The concept this game teaches by making you use it. One idea, done properly, beats five gestured at.

- **Concept:** _e.g. inclination changes are expensive, and cheapest at apoapsis._
- **How the mechanic makes you feel it:** _e.g. the fuel budget makes a naive plane change unaffordable, so you learn to combine it with the circularization burn._
- **What the player should be able to do afterwards** that they could not before.

## Fidelity boundary

Where the simulation is honest, and where the game layer steps in. Each departure here must also appear in the table in [`docs/PHYSICS.md`](PHYSICS.md#gameplay-departures) — that is the enforcement point.

| The game is honest about | The game deliberately simplifies |
| --- | --- |
| _e.g. delta-v budgets, orbital periods, transfer geometry_ | _e.g. instantaneous burns, no drag, forgiving docking tolerances_ |

The rule: a player who checks a number against a textbook should find that we agree, or find the difference documented and deliberate.

## Difficulty and onboarding

Orbital mechanics is genuinely counter-intuitive — prograde burns raise the *opposite* side of the orbit, speeding up drops you into a lower, faster orbit. The game has to teach that rather than punish ignorance of it.

- **First five minutes:** _what does the player learn, and how?_
- **Assumed knowledge:** _none, ideally._
- **Assists:** _maneuver previews, undo, predicted trajectories — and whether they can be turned off._
- **Failure:** _what happens when a player gets it wrong, and how they learn from it._

## Presentation

- **Visual approach:** _..._
- **Scale problem:** orbital distances defy linear rendering. _Log scale? Multiple zoom regimes? Camera-relative coordinates?_
- **Audio:** _..._
- **Accessibility:** colour-blind-safe palettes, remappable controls, readable at small sizes, no information conveyed by colour alone.

## Scope

- **In scope for v1:** _..._
- **Explicitly out of scope:** _..._
- **Deferred:** _..._

Games die of scope. Write down what you are not building.

## Open questions

- _..._
