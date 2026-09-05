/**
 * The briefing — §8.3.3, #120.
 *
 * > *Purpose: state the job in the game's voice, then state the constraints in numbers.
 * > Ten seconds to read.*
 *
 * The first screen in the game that renders real content, and the last one before the
 * planner. Everything on it comes out of the contract's own JSON — nothing is written
 * into this file about any particular contract, which is what lets a contributor add one
 * and have it play (G6).
 *
 * ## Numbers arrive in SI and leave in display units, and the conversion is the
 * catalogue's
 *
 * §8.3.3 asks for "display units (km, m/s, h:mm)" with "a tooltip with the SI value".
 * Both renderings are catalogue messages: metres in, kilometres out is a locale decision
 * as much as a unit one — the decimal separator, the grouping, and where the abbreviation
 * goes all change with the language. This file therefore does no formatting at all. It
 * reads SI out of the loaded scenario, and hands it to a key.
 *
 * The tooltip is a `title` **and** a visually-hidden span. A `title` is invisible to
 * touch and unreliable to a screen reader, and §8.8's canvas-parity rule is really a
 * statement about the whole UI: nothing is available to one input method only. The
 * hidden span costs a few characters of markup and makes the unrounded quantity part of
 * the accessible text.
 *
 * ## Four states, and the one this build cannot decide
 *
 * First attempt, replay-with-best and the daily variant are all read out of the save and
 * the route. **Locked is not**: §6.8's unlock rule — an act opens when ⌈2/3⌉ of the
 * previous act's contracts have Bronze — is written once already, in
 * `tools/content/reachability.ts`, whose own docstring says it moves into `@hh/game`
 * when progression lands (#82, M3). Writing it a second time here to have something to
 * evaluate would be the exact duplication that note exists to prevent, and the copies
 * would disagree the first time one of them changed.
 *
 * So the lock is an **input**. This screen renders it and states the rule; deciding it is
 * #82's, and until then `App` passes nothing and every shipped contract is open — which
 * is also the truth, since the only contract that ships is in act I.
 */
import {
  MU_EARTH,
  R_EARTH_EQ,
  apoapsisRadius,
  elementsFromState,
  periapsisRadius,
  type OrbitShape,
  type State,
} from '@hh/astro';
import type { LoadedScenario } from '@hh/game';
import type { Catalogue } from '@hh/ui';
import { Fragment, type JSX } from 'preact';
import { useEffect } from 'preact/hooks';

import { Icon, type IconName } from '../icons/index.js';
import type { ContractProgress } from '../save/index.js';
import { hrefFor } from '../router.js';

export interface BriefingProps {
  readonly t: Catalogue['resolve'];
  /** For the contract's own keys — `briefKey`, `clientKey` — which come from data. */
  readonly resolveDynamic: Catalogue['resolveDynamic'];
  readonly scenario: LoadedScenario;
  /** What the save holds for this contract. Absent on a first attempt. */
  readonly progress?: ContractProgress;
  /** Set when this contract is the daily variant for a date (§6.9). */
  readonly dailyDate?: string;
  /** Set when progression has not opened this contract. See the note above. */
  readonly locked?: boolean;
  readonly onAccept: () => void;
}

/** Altitude above the equatorial radius — what a player reads, where the file holds a radius. */
const altitude = (radius: number): number => radius - R_EARTH_EQ;

const shapeOf = (state: State): OrbitShape =>
  elementsFromState(state.position, state.velocity, MU_EARTH);

/** Below this, an orbit is circular for the purpose of describing it. */
const CIRCULAR_ECCENTRICITY = 1e-6;

/**
 * A quantity: the display rendering, with the SI one behind it.
 *
 * `title` for the pointer, a visually-hidden span for everyone else. See the note at the
 * top of this file for why it is both.
 */
const Quantity = ({
  name,
  display,
  si,
}: {
  readonly name: string;
  readonly display: string;
  readonly si: string;
}): JSX.Element =>
  // When the two renderings agree there is nothing behind the value, so it is plain
  // text: a Δv budget reads "300 m/s" either way, and attaching the tooltip anyway would
  // put a dotted underline under a value that reveals nothing and make a screen reader
  // say "300 m/s 300 m/s". Caught by looking at the built page rather than by a test —
  // both spellings were correct on their own.
  display === si ? (
    <span data-testid={`value-${name}`}>{display}</span>
  ) : (
    <span class="hh-quantity" title={si} data-testid={`value-${name}`}>
      {display}
      <span class="hh-sr-only" data-testid={`si-${name}`}>
        {si}
      </span>
    </span>
  );

/**
 * §8.3.3's "a row with an icon and one line".
 *
 * The geometry that stood in for the icon set until #176 is gone; these are the set's
 * glyphs. `aria-hidden`, because the line beside them says the same thing — §8.8's rule
 * that nothing is carried by one channel alone applies to shape as much as to colour.
 *
 * An unrecognised constraint kind gets the warning glyph rather than nothing: a
 * complication the briefing cannot name is still a complication, and §6.5 is explicit
 * that a player never discovers one by failing it.
 */
const CONSTRAINT_ICONS: Readonly<Record<string, IconName>> = {
  altitude_floor: 'altitude-floor',
  deadline: 'deadline',
  burn_count: 'burn-count',
};

const ConstraintIcon = ({ kind }: { readonly kind: string }): JSX.Element => (
  <Icon class="hh-constraint__icon" name={CONSTRAINT_ICONS[kind] ?? 'warning'} />
);

export const Briefing = ({
  t,
  resolveDynamic,
  scenario,
  progress,
  dailyDate,
  locked = false,
  onAccept,
}: BriefingProps): JSX.Element => {
  const { document: contract, rules, objective, targets } = scenario;

  /**
   * §8.3.3: ACCEPT is bound to `Enter`.
   *
   * On the document rather than on the button, because focus is on the screen's heading
   * when the route change hands it over — a listener on the button would only fire for
   * someone who had already tabbed to it, which is the one person who does not need a
   * shortcut.
   *
   * It stands down for anything that has its own meaning for `Enter`: a focused control,
   * an editable field, a modifier held, or an event something else has already handled.
   * Without that guard, clicking ACCEPT with the keyboard would accept twice.
   */
  useEffect(() => {
    if (locked) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.isContentEditable) return;
        if (['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      }
      onAccept();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [locked, onAccept]);

  /** The setup line for a state: circular or elliptical, with or without a phase. */
  const setupLine = (state: State, phased: boolean): string => {
    const shape = shapeOf(state);
    const periapsisAltitudeMetres = altitude(periapsisRadius(shape));
    if (shape.eccentricity < CIRCULAR_ECCENTRICITY) {
      return phased
        ? t('briefing.setup.circularPhased', {
            altitudeMetres: periapsisAltitudeMetres,
            trueAnomalyRad: shape.trueAnomaly,
          })
        : t('briefing.setup.circular', { altitudeMetres: periapsisAltitudeMetres });
    }
    const apoapsisAltitudeMetres = altitude(apoapsisRadius(shape));
    return phased
      ? t('briefing.setup.ellipsePhased', {
          periapsisAltitudeMetres,
          apoapsisAltitudeMetres,
          trueAnomalyRad: shape.trueAnomaly,
        })
      : t('briefing.setup.ellipse', { periapsisAltitudeMetres, apoapsisAltitudeMetres });
  };

  const objectiveLine = (): string => {
    if (objective.kind === 'reach_orbit') {
      return t('briefing.objective.reachOrbit', {
        periapsisAltitudeMetres: altitude(periapsisRadius(objective.goal)),
        apoapsisAltitudeMetres: altitude(apoapsisRadius(objective.goal)),
      });
    }
    const target = targets.find((candidate) => candidate.id === objective.targetId);
    // The loader has already refused a scenario whose objective names a target it does
    // not define, so this is unreachable — the id is the honest fallback if it ever is.
    const label = target?.label ?? objective.targetId;
    const rangeMetres = objective.tolerance.maxRangeM;
    const relativeSpeedMps = objective.tolerance.maxRelativeSpeedMps ?? 0;
    if (objective.kind === 'intercept') {
      return t('briefing.objective.intercept', { target: label, rangeMetres });
    }
    return objective.kind === 'rendezvous'
      ? t('briefing.objective.rendezvous', { target: label, rangeMetres, relativeSpeedMps })
      : t('briefing.objective.softRendezvous', { target: label, rangeMetres, relativeSpeedMps });
  };

  /**
   * §6.5's rows, minus the two that already have a numbered row of their own.
   *
   * The Δv budget and the deadline are constraints in §6.5's table and are also two of
   * the four lines in §8.3.3's numbers block. Repeating them here would say the same
   * thing twice on one screen, so what is left is everything else — today the altitude
   * floor, and in M4 the blackout, eclipse, approach-speed and no-fly rules as the
   * scenario schema grows to carry them.
   */
  const constraintRows = (): readonly (readonly [kind: string, line: string])[] =>
    rules.floorAltitudeM === undefined
      ? []
      : [
          [
            'altitude_floor',
            t('briefing.constraint.altitudeFloor', { floorAltitudeM: rules.floorAltitudeM }),
          ],
        ];

  return (
    <div class="hh-briefing">
      <p class="hh-briefing__back">
        <a href={hrefFor('/board')}>{t('briefing.backToBoard', {})}</a>
      </p>

      {dailyDate === undefined ? null : (
        <p class="hh-briefing__daily" data-testid="daily-variant">
          <span>{t('briefing.dailyVariant', { date: dailyDate })}</span>{' '}
          <a href={hrefFor(`/leaderboard/${dailyDate}`)}>{t('briefing.leaderboardLink', {})}</a>
        </p>
      )}

      <p class="hh-briefing__meta">
        {contract.clientKey === undefined ? null : (
          <span data-testid="client">
            {t('briefing.clientLabel', {})} {resolveDynamic(contract.clientKey)}
          </span>
        )}
        {contract.fee_kcr === undefined ? null : (
          <span data-testid="fee">
            {t('briefing.feeLabel', {})} {t('briefing.fee', { kilocredits: contract.fee_kcr })}
          </span>
        )}
      </p>

      <p class="hh-briefing__brief" data-testid="brief">
        {resolveDynamic(contract.briefKey)}
      </p>

      <dl class="hh-briefing__numbers">
        <dt>{t('briefing.objectiveLabel', {})}</dt>
        <dd data-testid="objective">{objectiveLine()}</dd>

        <dt>{t('briefing.dvBudgetLabel', {})}</dt>
        <dd>
          <Quantity
            name="dv-budget"
            display={t('briefing.dvBudget', { budgetMps: rules.budgetMps })}
            si={t('briefing.si.metresPerSecond', { metresPerSecond: rules.budgetMps })}
          />
        </dd>

        <dt>{t('briefing.deadlineLabel', {})}</dt>
        <dd>
          <Quantity
            name="deadline"
            display={t('briefing.deadline', { seconds: rules.deadlineSeconds })}
            si={t('briefing.si.seconds', { seconds: rules.deadlineSeconds })}
          />
        </dd>

        {/* D12: always shown. Par is not a hidden developer score. */}
        <dt>{t('briefing.parLabel', {})}</dt>
        <dd>
          <Quantity
            name="par"
            display={t('briefing.par', {
              dvMps: contract.par.dv_mps,
              timeSeconds: contract.par.time_s,
              burns: contract.par.burns,
            })}
            si={t('briefing.si.metresPerSecond', { metresPerSecond: contract.par.dv_mps })}
          />
        </dd>
      </dl>

      <section class="hh-briefing__constraints" aria-label={t('briefing.constraintsLabel', {})}>
        <ul>
          {constraintRows().map(([kind, line]) => (
            <li key={kind} class="hh-constraint" data-testid={`constraint-${kind}`}>
              <ConstraintIcon kind={kind} />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      <section class="hh-briefing__setup" aria-label={t('briefing.setupLabel', {})}>
        <dl>
          <dt>{t('briefing.shipLabel', {})}</dt>
          <dd data-testid="setup-ship">{setupLine(scenario.ship.state, false)}</dd>
          {targets.map((target) => (
            // An explicit `Fragment` rather than `<>`, because the key belongs to the
            // pair: a `<dt>`/`<dd>` is one row of a description list and keying the two
            // halves separately would let them be reordered independently.
            <Fragment key={target.id}>
              <dt>{target.label}</dt>
              <dd data-testid={`setup-${target.id}`}>{setupLine(target.state, true)}</dd>
            </Fragment>
          ))}
        </dl>
      </section>

      <footer class="hh-briefing__footer">
        {locked ? (
          <p data-testid="locked">{t('briefing.locked', { act: contract.act })}</p>
        ) : (
          <button type="button" class="hh-briefing__accept" onClick={onAccept} data-testid="accept">
            {t('briefing.accept', {})}
          </button>
        )}
        <p class="hh-briefing__record" data-testid="record">
          <span>
            {progress?.bestDv_mps === undefined
              ? t('briefing.recordNone', {})
              : t('briefing.record', {
                  bestDvMps: progress.bestDv_mps,
                  medal: progress.medal ?? '',
                  attempts: progress.attempts,
                })}
          </span>{' '}
          <span>{t('briefing.attempts', { attempts: progress?.attempts ?? 0 })}</span>
        </p>
      </footer>
    </div>
  );
};

/** Shown when a URL names a contract that does not ship. */
export const UnknownContract = ({
  t,
  id,
}: {
  readonly t: Catalogue['resolve'];
  readonly id: string;
}): JSX.Element => (
  <>
    <p data-testid="unknown-contract">{t('briefing.unknownContract', { id })}</p>
    <p>
      <a href={hrefFor('/board')}>{t('briefing.backToBoard', {})}</a>
    </p>
  </>
);
