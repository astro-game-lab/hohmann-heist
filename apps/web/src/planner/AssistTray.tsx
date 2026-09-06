/**
 * §8.3.4's region ⑤ — the assist tray, complete. FR-411, §6.6, #140.
 *
 * > *There is no difficulty setting. There is a set of assists, each individually
 * > toggleable, each of which affects medal eligibility.* — §6.6
 *
 * That design only works if the trade is legible **at the moment of choosing**, which is
 * what FR-411 turns into a requirement: *"The assist tray MUST show which assists affect
 * medal eligibility and what the current cap is."* Until now this region carried DEP-07's
 * snap toggle and its own docstring saying the rest was this issue.
 *
 * ## The rendered set comes from the model, never from a list here
 *
 * Every row is generated from `ASSIST_IDS` and `ASSISTS` in `@hh/game` — #81's model, which
 * is itself checked against the scenario schema's own `Assist` union. A literal list in
 * this component would be a fourth place the set of assists is written down, and the first
 * one to go stale. `AssistTray.test.tsx` asserts the rendered set against the model rather
 * than against a fixture, so adding an assist upstream cannot silently fail to appear here.
 *
 * ## The three medal effects are not symmetric, and the interface must not imply they are
 *
 * §6.6 has three kinds and a reader skimming will see two:
 *
 * - **None.** Element readouts, node snapping, coach marks. Free.
 * - **Earns *Blind* when *disabled*.** Closest approach, constraint preview. On by default;
 *   turning them **off** earns a modifier, which is a distinction rather than a penalty.
 * - **Caps at Silver when *enabled*.** The targeting computer, the porkchop.
 *
 * A uniform "affects medals" badge would be wrong about half of them, and — worse — would
 * tell a player that leaving the defaults alone costs something, when §6.7's Clean Job is
 * specifically available to a player using every default assist. So each row states its
 * effect *and its direction*, in words, and the two directions do not share a phrasing.
 *
 * ## Trajectory prediction is shown, and cannot be switched off
 *
 * §6.6 lists it as *"On, cannot be disabled"*, and #81's model deliberately leaves it out
 * of `AssistId` — it is the medium rather than an assist, because §6.3 makes prediction the
 * game. But #140 asks for it to be **shown** anyway, with its reason, because a player who
 * cannot find it in the tray will assume it is hidden somewhere. So it is rendered as a
 * row that is not a control, from a constant here rather than from the model: putting it in
 * the model would mean offering a toggle that must not exist.
 *
 * ## Absent, not disabled
 *
 * An assist a contract does not allow is **not rendered at all**. §6.6's unlock is
 * progression, not purchase: the targeting computer before C13 is not a thing the player is
 * being denied, it is a thing that does not exist yet. That is the opposite of the choice
 * `NodeContextMenu` makes for its snap entries, and the difference is real — there, the
 * capability exists and this orbit happens to lack apsides, which is a fact about the orbit
 * worth teaching. Here the capability does not exist yet, and a dimmed row would be an
 * advertisement.
 */
import {
  ASSISTS,
  ASSIST_IDS,
  cappingAssists,
  medalCap,
  type AssistEffect,
  type AssistId,
  type AssistState,
} from '@hh/game';
import type { Catalogue, MessageKey } from '@hh/ui';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

export interface AssistTrayProps {
  readonly t: Catalogue['resolve'];
  readonly assists: AssistState;
  /** Which assists this contract offers. Anything else is absent — see the docstring. */
  readonly allowed: readonly AssistId[];
  readonly onToggle: (id: AssistId, enabled: boolean) => void;
}

/** The catalogue key naming each assist, and the one describing it. */
const nameKey = {
  elements: 'planner.assists.elements',
  closest_approach: 'planner.assists.closestApproach',
  snapping: 'planner.assists.snapping',
  constraints: 'planner.assists.constraints',
  targeting_computer: 'planner.assists.targetingComputer',
  porkchop: 'planner.assists.porkchop',
  coach_marks: 'planner.assists.coachMarks',
} as const satisfies Record<AssistId, MessageKey>;

const hintKey = {
  elements: 'planner.assists.elementsHint',
  closest_approach: 'planner.assists.closestApproachHint',
  snapping: 'planner.assists.snappingHint',
  constraints: 'planner.assists.constraintsHint',
  targeting_computer: 'planner.assists.targetingComputerHint',
  porkchop: 'planner.assists.porkchopHint',
  coach_marks: 'planner.assists.coachMarksHint',
} as const satisfies Record<AssistId, MessageKey>;

/**
 * How each effect is phrased. Three distinct sentences, by design.
 *
 * `none` renders nothing rather than "no effect": a row that says nothing about medals is
 * unambiguous, and a row that says "no effect on medals" invites the reader to wonder what
 * the effect is.
 */
const effectKey: Record<AssistEffect, MessageKey | null> = {
  none: null,
  blindWhenDisabled: 'planner.assists.effectBlind',
  capsWhenEnabled: 'planner.assists.effectCaps',
};

export const AssistTray = ({ t, assists, allowed, onToggle }: AssistTrayProps): JSX.Element => {
  // §8.3.4: *"collapsed by default"*. Local, because it is a view preference for this
  // region and nothing else in the planner needs to know — and expanding it must not
  // pause, reset or re-evaluate anything, which is what makes local state the right answer
  // rather than a lazy one.
  const [open, setOpen] = useState(false);

  const permitted = new Set(allowed);
  const rows = ASSIST_IDS.filter((id) => permitted.has(id));
  const cap = medalCap(assists);
  const capping = cappingAssists(assists);

  return (
    <section class="hh-assists" data-testid="assist-tray">
      <h2 class="hh-panel__heading">
        <button
          type="button"
          class="hh-assists__disclosure"
          aria-expanded={open}
          aria-controls="hh-assists-body"
          data-testid="assist-disclosure"
          onClick={() => {
            setOpen((was) => !was);
          }}
        >
          {t('planner.assists.heading', {})}
        </button>
      </h2>

      {/*
        FR-411's cap, outside the disclosure. It is the one thing in this region a player
        needs while the tray is collapsed — it is the *consequence* of what is inside — and
        putting it behind the toggle would hide the number the requirement exists to show.
        Stated as a medal rather than as a warning icon, because a cap is a fact about what
        this run can still earn and not a problem to fix.
      */}
      <p class="hh-assists__cap" data-testid="assist-cap" data-cap={cap}>
        {cap === 'clean'
          ? t('planner.assists.capClean', {})
          : t('planner.assists.capAt', {
              medal: t('planner.assists.medalSilver', {}),
              count: capping.length,
            })}
      </p>

      <div id="hh-assists-body" hidden={!open} data-testid="assist-body">
        <ul class="hh-assists__list">
          {rows.map((id) => {
            const spec = ASSISTS[id];
            const enabled = assists[id];
            const effect = effectKey[spec.effect];
            const hintId = `hh-assist-${id}-hint`;
            return (
              <li key={id} class="hh-assists__row" data-assist={id}>
                <label class="hh-assists__toggle">
                  <input
                    type="checkbox"
                    checked={enabled}
                    aria-describedby={hintId}
                    data-testid={`assist-${id}`}
                    onChange={(event) => {
                      onToggle(id, (event.target as HTMLInputElement).checked);
                    }}
                  />
                  {/*
                    The state is the checkbox's own, not a separate label saying "on" —
                    #140's seventh criterion. A control that announces its state twice is
                    worse than one that announces it once.
                  */}
                  <span>{t(nameKey[id], {})}</span>
                </label>
                <p class="hh-assists__hint" id={hintId}>
                  {t(hintKey[id], {})}
                </p>
                {effect === null ? null : (
                  <p
                    class="hh-assists__effect"
                    data-testid={`assist-${id}-effect`}
                    data-effect={spec.effect}
                  >
                    {t(effect, {})}
                  </p>
                )}
                {/* §6.6's "Default" column, so a player who has changed something can see
                    they have without remembering what it was. */}
                {enabled === spec.defaultEnabled ? null : (
                  <p class="hh-assists__changed" data-testid={`assist-${id}-changed`}>
                    {t(
                      spec.defaultEnabled
                        ? 'planner.assists.defaultOn'
                        : 'planner.assists.defaultOff',
                      {},
                    )}
                  </p>
                )}
              </li>
            );
          })}

          {/*
            §6.6's "On, cannot be disabled". Not a control, and not in `ASSIST_IDS` —
            see the docstring on why the model deliberately excludes it and why it is shown
            here anyway.
          */}
          <li class="hh-assists__row" data-assist="prediction" data-testid="assist-prediction">
            <p class="hh-assists__always">{t('planner.assists.prediction', {})}</p>
            <p class="hh-assists__hint">{t('planner.assists.predictionHint', {})}</p>
          </li>
        </ul>
      </div>
    </section>
  );
};
