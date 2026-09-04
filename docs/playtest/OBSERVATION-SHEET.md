# Observation sheet

One copy per session. Copy this file, fill it in during and immediately after the
session, and keep it with the round's notes — **not** with the signed consent form
(`docs/playtest/CONSENT.md` keeps those apart deliberately).

Every field has a value by the end of the session. A field that could not be observed is
recorded as **N/A with the reason**, never left blank — a blank is indistinguishable from
a signal that was missed, and the two mean opposite things.

The protocol is `docs/playtest/PROTOCOL.md`. Read it before running a session; this sheet
assumes it.

---

## Session

| | |
| --- | --- |
| **Round** | M_ |
| **Participant label** | P_ |
| **Profile** | P1 / P2 / P3 — *(and the screening answer that decided it)* |
| **Date** | |
| **Facilitator** | |
| **Consent** | Signed ☐ · screen ☐ · audio ☐ · copy given to participant ☐ |
| **Recording started at** | |
| **Build under test** | Pages URL: |
| | `main` SHA: |
| | Entry script (from `smoke.sh`): |
| **Smoke check** | `tools/smoke/smoke.sh <url>` — pass ☐ / fail ☐ |
| **Fresh profile / storage cleared** | ☐ |
| **Contract(s) played** | |
| **Session length** | ______ min *(if under 30, say why)* |

---

## Signal 1 — Time to first successful burn

Session start → the first committed plan that produces a burn the player **intended**.
Not the first node placed, and not a burn they immediately undid.

| | |
| --- | --- |
| **Time** | ______ min ______ s |
| **Or N/A because** | |

What happened just before it — the action or realisation that unblocked them:

>

Number of plans committed before that one: ______

---

## Signal 2 — The click

**Read the protocol's caveat before filling this in.** §13.6 defines this signal against
**C05**, which does not exist before M3. At M2 the proxy below is recorded instead, and
it is labelled as a proxy in the report. It is not comparable with an M3+ figure.

**M3 onward — §13.6's signal.** Session start → the participant articulates, unprompted,
that dropping to a lower orbit catches something ahead.

| | |
| --- | --- |
| **Time** | ______ min ______ s |
| **N/A because** | |

Verbatim, what they said:

>

**M2 — the proxy.** The first time the player moves the **departure epoch** after at
least one edit that changed only **Δv**.

| | |
| --- | --- |
| **Time** | ______ min ______ s |
| **N/A because** | |

How many Δv-only edits came first: ______

Did they say anything as they did it?

>

---

## Signal 3 — Learning outcomes (§6.12)

Three questions, verbal, after the contract and before any other conversation. No
prompting, no correcting. Write what was **said**, then score it.

Outcome under test — §6.12's row for the contract played:

>

| # | Question | Verbatim answer | Got it / Partial / Missed |
| --- | --- | --- | --- |
| 1 | | | |
| 2 | | | |
| 3 | | | |

**Closing question — "was there a moment where something clicked?"**

>

*(Corroborates signal 2. It does not replace the observed timestamp — a participant who
reports no click but whose recording shows one had the click.)*

---

## Signal 4 — Confusion points

Every **question asked**, every **mis-click**, every **pause of 10 s or longer**. One row
each, in order. Questions go down **verbatim** — paraphrasing collapses distinct findings
into one.

| Time | Type | What happened — verbatim for questions | Screen / what was on it |
| --- | --- | --- | --- |
| | Q / mis-click / pause | | |
| | | | |
| | | | |
| | | | |
| | | | |
| | | | |
| | | | |
| | | | |

*(Continue on a second page. A long list here is a productive session, not a failed one.)*

---

## Signal 5 — Vocabulary failures

A failure is a term the participant **used** and then **could not define**. Only ask
about terms they actually said — asking about the rest is a quiz on the participant.

Terms the M2 slice puts on screen (from `packages/ui/src/catalogue/en.ts`):

| Term | Used? | Could define it? | What they said it meant |
| --- | --- | --- | --- |
| burn | ☐ | ☐ | |
| prograde | ☐ | ☐ | |
| retrograde | ☐ | ☐ | |
| periapsis | ☐ | ☐ | |
| apoapsis | ☐ | ☐ | |
| apsis | ☐ | ☐ | |
| node | ☐ | ☐ | |
| orbit | ☐ | ☐ | |
| Δv / delta-v | ☐ | ☐ | |
| epoch | ☐ | ☐ | |
| par | ☐ | ☐ | |
| intercept | ☐ | ☐ | |
| closest approach | ☐ | ☐ | |
| eccentricity | ☐ | ☐ | |

Terms they used that are **not** on this list — the game taught them a word it does not
know it is teaching, or they brought it with them:

>

---

## Signal 6 — Abandonment

| | |
| --- | --- |
| **Did they abandon?** | Yes ☐ / No ☐ / Ran out of time ☐ |
| **Where** | *(screen, and what they were trying to do)* |
| **At** | ______ min ______ s |

**Why**, in their words:

>

**Closing question — "was there a point where you nearly gave up?"**

>

*(Answer this even when they did not abandon. A near-abandonment at minute four in a
session that finished is a stronger finding than a clean run.)*

---

## Facilitator notes

Everything that does not fit above. Written **within the hour** — this is the field that
decays fastest.

>

**Did the facilitator break protocol?** *(Answered a question, filled a silence, reacted
to a mistake. Record it — it changes how the rest of the session reads.)*

>

---

## Candidate findings

Not conclusions — the things from this session worth carrying into the report. The report
is where they are weighed against the other sessions and turned into issues.

| # | What | Signal(s) | Severity guess |
| --- | --- | --- | --- |
| 1 | | | |
| 2 | | | |
| 3 | | | |

---

## Close-out

- [ ] Recording stopped and the file confirmed written
- [ ] Every question in the log answered for the participant
- [ ] All fields above filled, N/A ones given a reason
- [ ] Recording filed under the round's folder, named by participant label only
- [ ] Deletion date noted: ____________ *(within 30 days of the session)*
