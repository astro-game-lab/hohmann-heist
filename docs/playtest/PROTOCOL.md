# Playtest protocol

The operating manual for a round of playtesting, in the form §13.6 asks for. It is
round-agnostic: the same protocol runs at M2, M3, M5 and M6, and each round writes its
own report — `docs/PLAYTEST-M2.md` is the first.

§13.6 is the requirement. This document is how it gets executed, and it exists because a
round run from memory produces notes that cannot be compared with the last round's. The
value of small-N testing is entirely in the comparison.

## Cadence and mix

| Round | Sessions | Scope |
| --- | --- | --- |
| M2 | 5 | The slice only — C03 |
| M3 | 8 | Acts I–II |
| M5 | 8 | Acts I–V |
| M6 | 8 | Full, plus one accessibility session with a screen-reader user |

§13.6 states the mix for an eight-session round: **four P1, three P2, one P3**. It does
not state one for M2's five. The M2 round uses **three P1, one P2, one P3** — P1 stays
dominant because §3 makes P1 the priority persona, and the single P3 session is kept
because dropping it would leave the educator read untested until M3.

The profiles are §3's, and recruiting against them means asking two questions, not
guessing:

| Profile | Screening question | Qualifies if |
| --- | --- | --- |
| **P1** — the curious puzzle player | "What is delta-v?" | Cannot define it |
| **P2** — the practitioner | "Have you used GMAT, STK, poliastro, or flown much in KSP?" | Yes to any, and can define delta-v |
| **P3** — the educator | "Do you teach or run outreach on anything space-related?" | Yes |

Record the actual mix in the report whether or not it matches the plan. A round run with
five P2s is not a failed round, but a report that does not say so is a false one.

## The protocol

Think-aloud, no guidance, **30 minutes**, screen recorded **with consent**. Consent is
`docs/playtest/CONSENT.md` and it is taken before the recording starts, not after.

**The facilitator does not answer questions during play.** This is the rule that makes
the round worth running and the one that is hardest to keep. Every question a participant
asks is a finding: it names something the game failed to convey. Answering it destroys
the finding and contaminates every observation after it.

The deflection is a fixed phrase, used every time, with no elaboration:

> "I want to see what you'd do without me. Ask me again at the end and I'll answer
> properly."

Then **write the question down verbatim**, with a timestamp. Verbatim matters — "how do I
make it go up" and "how do I raise the orbit" are different findings, and paraphrasing
collapses them into the same note.

At the end of the 30 minutes, answer everything that was asked. Participants who were
stonewalled for half an hour have earned it, and the answers are not data.

### Before the session

- [ ] Build under test identified: the deployed Pages URL, the `main` SHA behind it, and
      the entry script `tools/smoke/smoke.sh` reports. Record all three in the report.
- [ ] `tools/smoke/smoke.sh <url>` passes. A session run against a broken deployment
      measures the deployment.
- [ ] Consent form signed, and the participant has a copy.
- [ ] Recording started, and confirmed to be capturing both screen and audio — the
      think-aloud is the audio track, and a silent recording is half a session.
- [ ] A fresh browser profile, or `localStorage` cleared. The game saves progress
      (§11.10), and a second participant on the first one's save is not a first-time
      player.
- [ ] Observation sheet printed or open: `docs/playtest/OBSERVATION-SHEET.md`.

### During the session

Read this out, once, and then stop talking:

> "This is a browser game about orbits. I'd like you to play it for about thirty minutes
> and say out loud what you're thinking as you go — what you're looking at, what you
> expect to happen, what surprises you. There are no wrong moves and I'm not testing you;
> I'm testing the game. I won't answer questions while you play, but I'll answer all of
> them at the end."

Then: nothing. Do not narrate, do not react to a mistake, do not fill a silence. A ten
second pause is a data point (§13.6 counts it as a confusion point) and a facilitator who
fills it has erased it.

If the participant stops talking for a stretch, one neutral prompt is allowed — *"what
are you thinking?"* — and it is not a question, so it does not break the rule.

### After the session

1. The **learning check** (below) — three questions, verbal, before any debrief chat.
2. Answer every question from the question log.
3. Ask the two closing questions: *"Was there a point where you nearly gave up?"* and
    *"Was there a moment where something clicked?"* Both are for corroborating signals 2
    and 6, not for replacing the observed timestamps.
4. Stop the recording. Confirm the file wrote.
5. Fill in any sheet fields still blank **within the hour**. Memory for this decays fast
    and the sheet is the only artefact that survives.

## The six signals

§13.6's table, with how each is actually captured.

| # | Signal | Captured how |
| --- | --- | --- |
| 1 | Time to first successful burn | Timestamp: session start → the first committed plan that produces a burn the player intended. Not the first node placed |
| 2 | Time to the click | Timestamp — see below, and read the M2 caveat |
| 3 | Learning outcomes (§6.12) | Three-question verbal check after the contract |
| 4 | Confusion points | Every question asked, every mis-click, every pause of 10 s or longer |
| 5 | Vocabulary failures | Any term the player uses and then cannot define |
| 6 | Abandonment | Where, and why |

### Signal 2 — the click, and what it means before C05 exists

§13.6 defines this signal as **"time to the click (C05)"** and calls it the headline
number. C05 "Tailgate" is the contract built around it: *to catch something ahead of you,
burn retrograde* (§6.5). **C05 does not exist before M3.** A round played against a build
that ships only C03 cannot measure this signal as written, and a report that claims to
have measured it is claiming something false.

Rounds from M3 onward measure it as defined: session start → the moment the player
articulates, unprompted, that dropping lower catches something ahead.

The **M2 round uses a proxy**, and labels it as one everywhere it appears. C03's own
insight is not retrograde phasing — it is that arrival geometry is set by departure time.
Its coach mark says exactly that:

> "The target keeps moving while you climb. When you leave decides where it will be when
> you get there."

So the M2 proxy is: **the first time the player moves the departure epoch after at least
one edit that changed only Δv.** That transition — from tuning how hard to push to tuning
when to push — is the observable form of C03's lesson, and it is visible on the screen
recording without needing the participant to narrate it.

It is a proxy. It is not §13.6's C05 number, it is not comparable to one, and M3's round
does not get to plot it on the same axis.

### Signal 3 — the learning check

Three questions, asked verbally, after the participant has finished with the contract and
before any other conversation. Do not prompt, do not correct, and write down what was
actually said rather than whether it was right. "Something about going faster" and "you
speed up so you go higher" are different answers.

The outcome under test is §6.12's row for the contract played. For **C03**:

> *Explain why* when *you leave decides where the target will be when you arrive.*

The three questions for C03:

1. "If you'd made exactly the same burn ten minutes later, what would have been
    different?"
2. "The target was moving the whole time you were climbing. Did that matter?"
3. "If you had to explain to a friend what made this hard, what would you say?"

Score each as **got it / partial / missed**, and record the verbatim answer next to the
score. The score is for the trend line across rounds; the verbatim is where the actual
finding lives.

### Signal 5 — the vocabulary list

A vocabulary failure is a term the participant **uses and then cannot define**. Using a
word correctly without being able to define it is the failure mode this catches — the
player has learned the sound of the word without the concept behind it, which §3's P1
notes call out directly.

The terms the M2 slice actually puts on screen, taken from the shipped UI catalogue
(`packages/ui/src/catalogue/en.ts`) rather than from what the game is assumed to say:

`burn` · `prograde` · `retrograde` · `periapsis` · `apoapsis` · `apsis` · `node` ·
`orbit` · `Δv` / `delta-v` · `epoch` · `par` · `intercept` · `closest approach` ·
`eccentricity`

When a participant uses one, mark it. At the end, ask them to define the ones they used.
Do not ask about terms they never said — that is a quiz, and it measures the participant
rather than the game.

## What finishes a round

**A round that produces notes but no issues has not finished.** This is §13.6's standard
and the acceptance criterion the round is judged against.

Every finding in the report links to the issue it generated. The mapping is one-way and
total: a finding with no issue is either not a finding or an issue nobody opened, and
both cases are resolved by opening it. Findings that are already covered by an open issue
link to that one instead of duplicating it.

Issues from a round carry the `playtest` label, and their bodies say which round and
which session produced them, so a reader can get from an issue back to the observation
that caused it.

The round is done when:

- [ ] Every session's sheet is complete, including fields recorded as N/A with a reason.
- [ ] The report exists, with the participant mix as actually recruited.
- [ ] Every finding links to an issue.
- [ ] Recordings are handled per the consent given, and the report states the retention
      period and the deletion date.

## Data handling

The consent form is the contract with the participant and it is the binding document, not
this one. `docs/playtest/CONSENT.md` states what is recorded, what it is used for, how
long it is kept, and how to withdraw.

Two rules that are the facilitator's to keep rather than the form's:

- **Recordings never enter the repository, an issue, or a pull request.** They are the
  raw material for the report; the report is what is published. A quote in the report is
  attributed to "P3" and never to a person.
- **Deletion is a date, not an intention.** The report records the date the recordings
  are due to be destroyed, and destroying them is a task, not a hope.
