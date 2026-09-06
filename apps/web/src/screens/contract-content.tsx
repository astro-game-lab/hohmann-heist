/**
 * How a contract describes itself — §8.3.3, shared by the briefing and the planner (#264).
 *
 * ## Why this is a module rather than two renderings
 *
 * ACCEPT is a one-way door. §8.3.3 states the job in numbers — objective, Δv budget,
 * deadline, par, constraints, setup — and the planner then showed the budget and the
 * deadline in the HUD and **nothing else**. A player planning a transfer had to remember
 * what they were aiming at or go back to the board and lose their plan.
 *
 * That was tolerable while one contract shipped and its objective fitted in a sentence.
 * Acts I–II make it a real problem: C07's objective is *"hold a slot 3.00° east of your
 * current longitude, within 0.05°, drifting no more than 0.01°/day"* — three numbers, none
 * of them in the planner, all of them needed to plan the burn.
 *
 * The fix is not a second rendering of the same facts. Two copies of "how a contract
 * describes itself" is two things to keep in step, and the first to drift is the one the
 * player sees least — which would be the planner's, the one added second. So the derivation
 * lives here once and both screens call it, and `ContractPanel.test.tsx` asserts the two
 * render **identical text** for the same scenario so the shared module cannot quietly grow
 * a caller-specific branch.
 *
 * ## Everything here is a string, and none of it is prose
 *
 * FR-910 and D14: every line resolves from the catalogue, keyed. There is no English in
 * this file — the objective's shape decides *which* key, never what it says. That is the
 * same rule `Briefing.tsx` already followed and the reason it could be extracted at all.
 *
 * ## Units convert here, at the boundary
 *
 * Radii become altitudes, radians become degrees in the catalogue's formatters, and the SI
 * value is carried behind the display one by {@link Quantity}. The simulation holds none of
 * that: it is metres and radians throughout, and this is the edge where a player's units
 * begin.
 */
import {
  MU_EARTH,
  R_EARTH_EQ,
  apoapsisRadius,
  elementsFromState,
  periapsisRadius,
} from '@hh/astro';
import type { OrbitShape, State } from '@hh/astro';
import type { LoadedScenario } from '@hh/game';
import type { Catalogue } from '@hh/ui';
import { Fragment, type JSX } from 'preact';

import { Icon, type IconName } from '../icons/index.js';

/** Altitude above the equatorial radius — what a player reads, where the file holds a radius. */
export const altitude = (radius: number): number => radius - R_EARTH_EQ;

const shapeOf = (state: State): OrbitShape =>
  elementsFromState(state.position, state.velocity, MU_EARTH);

/** Below this, an orbit is circular for the purpose of describing it. */
const CIRCULAR_ECCENTRICITY = 1e-6;

/**
 * A quantity: the display rendering, with the SI one behind it.
 *
 * `title` for the pointer, a visually-hidden span for everyone else.
 *
 * When the two renderings agree there is nothing behind the value, so it is plain text: a
 * Δv budget reads "300 m/s" either way, and attaching the tooltip anyway would put a dotted
 * underline under a value that reveals nothing and make a screen reader say "300 m/s 300
 * m/s". That was caught by looking at the built page rather than by a test — both spellings
 * were correct on their own.
 */
export const Quantity = ({
  name,
  display,
  si,
}: {
  readonly name: string;
  readonly display: string;
  readonly si: string;
}): JSX.Element =>
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
 * `aria-hidden`, because the line beside them says the same thing — §8.8's rule that
 * nothing is carried by one channel alone applies to shape as much as to colour.
 *
 * An unrecognised constraint kind gets the warning glyph rather than nothing: a
 * complication the briefing cannot name is still a complication, and §6.5 is explicit that
 * a player never discovers one by failing it.
 */
const CONSTRAINT_ICONS: Readonly<Record<string, IconName>> = {
  altitude_floor: 'altitude-floor',
  deadline: 'deadline',
  burn_count: 'burn-count',
};

export const ConstraintIcon = ({ kind }: { readonly kind: string }): JSX.Element => (
  <Icon class="hh-constraint__icon" name={CONSTRAINT_ICONS[kind] ?? 'warning'} />
);

/** The setup line for a state: circular or elliptical, with or without a phase. */
export const setupLine = (t: Catalogue['resolve'], state: State, phased: boolean): string => {
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

/** §8.3.3's objective line, whichever of §6.4's five kinds this contract sets. */
export const objectiveLine = (t: Catalogue['resolve'], scenario: LoadedScenario): string => {
  const { objective, targets } = scenario;
  if (objective.kind === 'reach_orbit') {
    return t('briefing.objective.reachOrbit', {
      periapsisAltitudeMetres: altitude(periapsisRadius(objective.goal)),
      apoapsisAltitudeMetres: altitude(apoapsisRadius(objective.goal)),
    });
  }
  if (objective.kind === 'station') {
    // No target: a slot is a place, not a thing to be near (#77, §6.4). This is C07's
    // three-number objective, and the reason #264 exists.
    return t('briefing.objective.station', {
      slotOffsetRad: objective.goal.slotOffsetRad,
      maxOffsetRad: objective.goal.maxOffsetRad,
      maxDriftRadPerSec: objective.goal.maxDriftRadPerSec,
    });
  }

  const target = targets.find((candidate) => candidate.id === objective.targetId);
  // The loader has already refused a scenario whose objective names a target it does not
  // define, so this is unreachable — the id is the honest fallback if it ever is.
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
 * The Δv budget and the deadline are constraints in §6.5's table and are also two of the
 * four lines in §8.3.3's numbers block. Repeating them here would say the same thing twice
 * on one screen, so what is left is everything else — today the altitude floor and the
 * burn-count cap, and in M4 the blackout, eclipse, approach-speed and no-fly rules as the
 * scenario schema grows to carry them.
 */
export const constraintRows = (
  t: Catalogue['resolve'],
  scenario: LoadedScenario,
): readonly (readonly [kind: string, line: string])[] => {
  const { rules } = scenario;
  return [
    ...(rules.floorAltitudeM === undefined
      ? []
      : [
          [
            'altitude_floor',
            t('briefing.constraint.altitudeFloor', { floorAltitudeM: rules.floorAltitudeM }),
          ] as const,
        ]),
    // §6.5's burn-count cap, from C04 on. A contract that declares none gets no row —
    // "no cap" is not "an infinite cap", and a line saying so would be noise on every other
    // contract's briefing.
    ...(rules.maxBurns === undefined
      ? []
      : [
          ['burn_count', t('briefing.constraint.burnCount', { maxBurns: rules.maxBurns })] as const,
        ]),
  ];
};

/**
 * §8.3.3's numbers block: objective, Δv budget, deadline, par.
 *
 * A component rather than four exported strings, because two of the four carry an SI value
 * behind the displayed one and that pairing is part of the rendering rather than of the
 * text. Both callers get the tooltips and the screen-reader spans without restating them.
 */
export const ContractNumbers = ({
  t,
  scenario,
}: {
  readonly t: Catalogue['resolve'];
  readonly scenario: LoadedScenario;
}): JSX.Element => {
  const { document: contract, rules } = scenario;
  return (
    <dl class="hh-contract__numbers">
      <dt>{t('briefing.objectiveLabel', {})}</dt>
      <dd data-testid="objective">{objectiveLine(t, scenario)}</dd>

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
  );
};

/** §6.5's constraint rows, as a list. */
export const ContractConstraints = ({
  t,
  scenario,
}: {
  readonly t: Catalogue['resolve'];
  readonly scenario: LoadedScenario;
}): JSX.Element => (
  <section class="hh-contract__constraints" aria-label={t('briefing.constraintsLabel', {})}>
    <ul>
      {constraintRows(t, scenario).map(([kind, line]) => (
        <li key={kind} class="hh-constraint" data-testid={`constraint-${kind}`}>
          <ConstraintIcon kind={kind} />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  </section>
);

/** §8.3.3's setup block: where the ship starts, and where each target is. */
export const ContractSetup = ({
  t,
  scenario,
}: {
  readonly t: Catalogue['resolve'];
  readonly scenario: LoadedScenario;
}): JSX.Element => (
  <section class="hh-contract__setup" aria-label={t('briefing.setupLabel', {})}>
    <dl>
      <dt>{t('briefing.shipLabel', {})}</dt>
      <dd data-testid="setup-ship">{setupLine(t, scenario.ship.state, false)}</dd>
      {scenario.targets.map((target) => (
        // An explicit `Fragment` rather than `<>`, because the key belongs to the pair: a
        // `<dt>`/`<dd>` is one row of a description list and keying the two halves
        // separately would let them be reordered independently. A wrapping element would
        // work in HTML5 and is deliberately not used — it would change the briefing's DOM,
        // and this extraction is supposed to move code rather than alter what it renders.
        <Fragment key={target.id}>
          <dt>{target.label}</dt>
          <dd data-testid={`setup-${target.id}`}>{setupLine(t, target.state, true)}</dd>
        </Fragment>
      ))}
    </dl>
  </section>
);
