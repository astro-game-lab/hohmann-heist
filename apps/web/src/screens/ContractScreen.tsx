/**
 * `/#/contract/:id` — §8.2's "Briefing → planner", and now the rest of the loop.
 *
 * One route covering four screens, which is §8.2's own arrangement rather than a
 * shortcut: accepting a contract is not navigation, and neither is committing a plan or
 * watching it fly. They are the same job seen from four positions. That has a
 * consequence worth stating — **Back from anywhere in the contract returns to the board,
 * not to the previous phase** — and it is the right one. Re-reading a brief you accepted
 * four seconds ago is not a thing anyone wants a history entry for, and rewinding into a
 * run that has already been decided is not either.
 *
 * ## The phases, and what carries between them
 *
 * ```
 *   briefing ──accept──► planner ──commit──► execution ──finish──► debrief
 *                          ▲                    │                    │
 *                          └──────abort─────────┘                    │
 *                          ▲                                         │
 *                          └───────────────retry──────────────────────┘
 * ```
 *
 * Two edges come **back**, and both of them are requirements rather than conveniences:
 *
 * - **Abort** (FR-603) — *"abortable back to the planner with the plan intact"*, and
 *   #145 adds *"with selection and scrub state sensibly restored"*. So the run carries
 *   the scrub head and the selection with it, not just the plan.
 * - **Retry** (§6.11) — *"Retry restores the plan"*. The same seed, from the same run.
 *
 * ## The result is computed once, here, at the moment of commit
 *
 * FR-601 says execution must not recompute or diverge from the prediction. The strongest
 * way to say that is to leave nothing for it to recompute: `onCommit` builds the flight
 * log and the outcome from the evaluation the planner already had, and both are held for
 * the rest of the contract. Execution reads them; the debrief reads them. Neither
 * evaluates anything, so watching a run, skipping it, or changing speed halfway cannot
 * produce different numbers — there are no other numbers.
 *
 * `useMemo` rather than `useState` for those two: they are a pure function of the
 * committed run, so deriving them is more honest than storing them, and it removes the
 * question of what happens if the two ever got out of step.
 */
import { R_EARTH_EQ } from '@hh/astro';
import type { AssistState, LoadedScenario, Outcome } from '@hh/game';
import {
  buildFlightLog,
  defaultAssistState,
  encodeAssists,
  evaluateOutcome,
  restrictToAllowed,
} from '@hh/game';
import { canonicalJson, replayFromPlan } from '@hh/sim';
import type { PersonalBest } from '@hh/ui';
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';

import { DebriefScreen } from '../debrief/DebriefScreen.js';
import { copyReplay } from '../debrief/share.js';
import { ExecutionScreen } from '../execution/ExecutionScreen.js';
import { PlannerScreen, type CommittedRun } from '../planner/PlannerScreen.js';
import { navigate } from '../router.js';
import type { ContractProgress } from '../save/index.js';
import { Briefing } from './Briefing.js';

/** Which of §8.2's four phases the contract is in. */
type Phase = 'briefing' | 'planner' | 'execution' | 'debrief';

export interface ContractScreenProps {
  readonly t: Catalogue['resolve'];
  readonly resolveDynamic: Catalogue['resolveDynamic'];
  readonly scenario: LoadedScenario;
  readonly progress?: ContractProgress;
  /** Counts the attempt and persists it. Called once per acceptance. */
  readonly onAccept: () => void;
  /** Records a completed run (FR-302). Called once, when the debrief is reached. */
  readonly onComplete?: (outcome: Outcome, replay: string) => void;
}

/**
 * The engine major version §11.6's replay code records.
 *
 * `1` for every v1.x build (§14.4). A constant here rather than read from the package
 * version, because the *engine* major and the *product* version are deliberately
 * different numbers: a replay is invalidated by a change to the evaluation, not by a
 * change to the UI, and §14.4 makes an engine bump require a `docs/PHYSICS.md` change.
 */
const ENGINE_MAJOR = 1;

/**
 * The assists this run used, as §6.6's model states them.
 *
 * The planner does not yet own a full assist tray — that is #140, which renders this same
 * model — so what a run uses today is the contract's permitted set at its defaults. When
 * the tray lands it supplies the player's own state and nothing here changes shape.
 *
 * `restrictToAllowed` is what keeps that honest: a contract that does not list an assist
 * cannot have used it, whatever the defaults say.
 */
const assistsFor = (scenario: LoadedScenario): AssistState =>
  restrictToAllowed(defaultAssistState(), scenario.document.assistsAllowed);

/**
 * §11.6's replay, as text.
 *
 * **The canonical JSON, not a base64url URL.** The codec (#148), the share-URL generator
 * (#149) and the viewer route (#150) are all M6, so there is no encoder in the workspace
 * yet — `replay.ts` provides `replayFromPlan` and `canonicalJson` and stops there.
 *
 * What that leaves is a real artefact rather than a placeholder: canonical JSON is the
 * exact form every scenario file already stores in `par.referenceReplay`, the content
 * suite already replays it, and it round-trips through `parseReplay` today. When #149
 * lands it wraps this same object; nothing about the button changes but the payload.
 */
const replayCodeFor = (
  run: CommittedRun,
  scenario: LoadedScenario,
  outcome: Outcome,
  assists: AssistState,
): string =>
  canonicalJson(
    replayFromPlan(run.plan, {
      scenarioId: scenario.id,
      startEpoch: scenario.startEpoch,
      engineMajor: ENGINE_MAJOR,
      assists: encodeAssists(assists),
      claim: {
        // The scoring grid, which is the unit §11.6's claim is defined in and the unit a
        // verifier compares. `outcome.ts` owns the conversion.
        dv: Math.round(outcome.dvUsedMps * 10),
        t: Math.round(outcome.metSeconds ?? 0),
      },
    }),
  );

/** What the save knows about earlier runs of this contract (FR-302, §8.3.9). */
const bestOf = (progress: ContractProgress | undefined): PersonalBest => ({
  ...(progress?.bestDv_mps === undefined ? {} : { dvMps: progress.bestDv_mps }),
  ...(progress?.bestTime_s === undefined ? {} : { timeSeconds: progress.bestTime_s }),
  ...(progress?.burns === undefined ? {} : { burns: progress.burns }),
});

export const ContractScreen = ({
  t,
  resolveDynamic,
  scenario,
  progress,
  onAccept,
  onComplete,
}: ContractScreenProps): JSX.Element => {
  const [phase, setPhase] = useState<Phase>('briefing');
  const [run, setRun] = useState<CommittedRun | null>(null);
  const [shareResult, setShareResult] = useState<'copied' | 'failed' | null>(null);

  /**
   * What the save held **before this run**, captured at commit.
   *
   * §8.3.9's third column compares against the player's best previous result, and
   * `progress` cannot supply it by the time the debrief renders: the run is recorded on
   * the way there (FR-302), so reading `progress` at that point compares the run against
   * itself and reports a first completion as having matched a best it just set.
   *
   * Captured when the plan is committed instead, which is the last moment the save is
   * still about earlier attempts. `null` until then, and `{}` at the debrief means what
   * it should — no previous run to compare with, rendered as an em dash.
   */
  const [bestBefore, setBestBefore] = useState<PersonalBest | null>(null);

  /**
   * The run, judged — once, at commit.
   *
   * Derived rather than stored, so there is no second copy to fall out of step with the
   * committed run. Both the flight log and the outcome are pure functions of the
   * evaluation the planner handed over (FR-601, §11.4).
   */
  const judged = useMemo(() => {
    if (run === null) return null;
    const { timeline, objective, legality } = run.evaluation;
    // A committed plan has both — `isCommittable` refuses a verdict that is not evaluable,
    // and a non-evaluable verdict is exactly the one with no timeline. Stated rather than
    // assumed, because the alternative is a crash on the screen after the commit.
    if (timeline === null || !legality.evaluable) return null;

    // §6.6's set for this contract, used by the scoring and recorded in the replay.

    const assists = assistsFor(scenario);

    const outcome = evaluateOutcome({
      timeline,
      objective,
      constraints: legality.constraints,
      rules: scenario.rules,
      par: {
        dvMps: scenario.document.par.dv_mps,
        timeSeconds: scenario.document.par.time_s,
        burns: scenario.document.par.burns,
      },
      // §6.6's set, restricted to what this contract offers. Eligibility and the cap are
      // derived from it inside `evaluateOutcome` — FR-301 is that a medal must reflect the
      // assists actually enabled, and a flag passed in from here is exactly the shape that
      // let this hard-code `true`.
      assists,
    });

    const entries = buildFlightLog(timeline, {
      objective,
      constraints: [
        legality.constraints.budget,
        legality.constraints.deadline,
        legality.constraints.altitudeFloor,
      ],
      referenceRadiusM: R_EARTH_EQ,
    });

    return { timeline, outcome, entries, replay: replayCodeFor(run, scenario, outcome, assists) };
  }, [run, scenario]);

  if (phase === 'briefing') {
    return (
      <Briefing
        t={t}
        resolveDynamic={resolveDynamic}
        scenario={scenario}
        {...(progress === undefined ? {} : { progress })}
        onAccept={() => {
          onAccept();
          setPhase('planner');
        }}
      />
    );
  }

  if (phase === 'planner' || judged === null) {
    return (
      <PlannerScreen
        t={t}
        resolveDynamic={resolveDynamic}
        scenario={scenario}
        // The plan comes back on an abort or a retry, with the place the player was
        // working in it (FR-603, #145, §6.11). Absent on a first entry.
        {...(run === null
          ? {}
          : {
              seed: {
                plan: run.plan,
                scrubEpoch: run.scrubEpoch,
                selectedNodeId: run.selectedNodeId,
              },
            })}
        onCommit={(committed) => {
          setRun(committed);
          // The last moment the save is still about earlier attempts — see `bestBefore`.
          setBestBefore(bestOf(progress));
          setShareResult(null);
          setPhase('execution');
        }}
      />
    );
  }

  if (phase === 'execution') {
    return (
      <ExecutionScreen
        t={t}
        resolveDynamic={resolveDynamic}
        scenario={scenario}
        timeline={judged.timeline}
        entries={judged.entries}
        outcome={judged.outcome}
        onAbort={() => {
          setPhase('planner');
        }}
        onFinish={() => {
          onComplete?.(judged.outcome, judged.replay);
          setPhase('debrief');
        }}
      />
    );
  }

  return (
    <DebriefScreen
      t={t}
      resolveDynamic={resolveDynamic}
      scenario={scenario}
      outcome={judged.outcome}
      best={bestBefore ?? {}}
      onRetry={() => {
        setShareResult(null);
        setPhase('planner');
      }}
      // One contract ships in this build, so there is nowhere to go next. The button says
      // so rather than vanishing — see `DebriefScreen`.
      onNext={null}
      onShare={() => {
        // Both ways this can fail — no clipboard at all, and a write that rejects —
        // come back as a value rather than an exception. See `share.ts`.
        void copyReplay(judged.replay).then(setShareResult);
      }}
      shareResult={shareResult}
      onBoard={() => {
        navigate('/board');
      }}
      reportHref={reportHrefFor(scenario, judged.replay)}
    />
  );
};

/**
 * D12's prefilled discrepancy report — FR-305, §6.7.
 *
 * > *If a player beats `par_dv`, that is a bug report about our optimum, and the debrief
 * > says so and offers to file it.*
 *
 * A GitHub issue URL with the title and body filled in, carrying the replay code so the
 * claim can be checked against `docs/PARS.md` rather than argued about. Built with
 * `URLSearchParams`, so a replay code containing a character that means something in a
 * URL cannot break the link.
 */
const reportHrefFor = (scenario: LoadedScenario, replay: string): string => {
  const params = new URLSearchParams({
    title: `par: ${scenario.id} beaten`,
    labels: 'physics',
    body: [
      `Contract: \`${scenario.id}\``,
      `Published par: ${String(scenario.document.par.dv_mps)} m/s`,
      '',
      'Replay:',
      '```json',
      replay,
      '```',
    ].join('\n'),
  });
  return `https://github.com/astro-game-lab/hohmann-heist/issues/new?${params.toString()}`;
};
