/**
 * §8.3.4's region ④ — the readouts and the closest-approach block. #131, #132, FR-406, FR-407.
 *
 * The two panels are one component because they share the value treatment and are one
 * region in §8.3.4's layout. What they show is decided in `@hh/ui`'s `orbitReadout` and
 * `approachReadout`, which are DOM-free and tested under Node; this renders the answer.
 *
 * ## Every number here arrives in SI and leaves through a message
 *
 * There is no arithmetic in this file, and that is #131's fifth criterion structurally
 * rather than by discipline: metres go in, `planner.readouts.*` turns them into
 * kilometres, and the decimal separator is the catalogue's business. The only thing this
 * component decides is *which rows exist*, and it takes that from the readout's `circular`
 * and `open` flags rather than re-testing the eccentricity.
 *
 * ## The suppression is explained, not merely applied
 *
 * A near-circular orbit shows one altitude instead of two, and a note saying why. Without
 * the note the panel looks broken — two rows a player saw a moment ago are gone — and the
 * note is what turns §9.3's suppression from a missing feature into a statement about the
 * orbit. Same for an open orbit, which additionally is `L4` and has no period.
 *
 * ## #132's met/unmet is a sentence, an icon and a colour, in that order
 *
 * FR-407 and §8.8: *"The met/unmet indicator is not colour alone."* The sentence says
 * what the tolerance was — "Within the 1.0 km objective tolerance" — because a bare "met"
 * tells a player nothing about what they would have to do differently. The icon is a
 * character rather than an image so it survives a stylesheet failing to load, and it is
 * `aria-hidden` because the sentence beside it already says it.
 */
import { metAt, type Epoch } from '@hh/astro';
import type { Catalogue } from '@hh/ui';
import type { ApproachReadout, OrbitReadout } from '@hh/ui';
import type { JSX } from 'preact';

import { Value } from './Value.js';

export interface ReadoutsProps {
  readonly t: Catalogue['resolve'];
  readonly orbit: OrbitReadout;
  /** `null` while a drag is in flight — the objective is not evaluated then (NFR-011). */
  readonly approach: ApproachReadout | null;
  readonly startEpoch: Epoch;
}

/** One `dt`/`dd` pair with the full-precision reading behind the value. */
const Row = ({
  name,
  label,
  display,
  precise,
}: {
  readonly name: string;
  readonly label: string;
  readonly display: string;
  readonly precise: string;
}): JSX.Element => (
  <>
    <dt>{label}</dt>
    <dd>
      <Value name={name} display={display} precise={precise} />
    </dd>
  </>
);

export const Readouts = ({ t, orbit, approach, startEpoch }: ReadoutsProps): JSX.Element => (
  <section class="hh-readouts" data-testid="readouts">
    <h2 class="hh-panel__heading">{t('planner.readouts.heading', {})}</h2>

    <dl class="hh-readouts__list">
      {orbit.circular ? (
        <Row
          name="altitude"
          label={t('planner.readouts.altitudeLabel', {})}
          display={t('planner.readouts.altitude', {
            altitudeMetres: orbit.meanAltitudeM ?? 0,
          })}
          precise={t('planner.si.metres', { metres: orbit.meanAltitudeM ?? 0 })}
        />
      ) : (
        <>
          {orbit.apoapsisAltitudeM === null ? null : (
            <Row
              name="apoapsis"
              label={t('planner.readouts.apoapsisLabel', {})}
              display={t('planner.readouts.apoapsis', {
                altitudeMetres: orbit.apoapsisAltitudeM,
              })}
              precise={t('planner.si.metres', { metres: orbit.apoapsisAltitudeM })}
            />
          )}
          {orbit.periapsisAltitudeM === null ? null : (
            <Row
              name="periapsis"
              label={t('planner.readouts.periapsisLabel', {})}
              display={t('planner.readouts.periapsis', {
                altitudeMetres: orbit.periapsisAltitudeM,
              })}
              precise={t('planner.si.metres', { metres: orbit.periapsisAltitudeM })}
            />
          )}
        </>
      )}

      {orbit.periodSeconds === null ? null : (
        <Row
          name="period"
          label={t('planner.readouts.periodLabel', {})}
          display={t('planner.readouts.period', { seconds: orbit.periodSeconds })}
          precise={t('planner.si.seconds', { seconds: orbit.periodSeconds })}
        />
      )}

      <Row
        name="eccentricity"
        label={t('planner.readouts.eccentricityLabel', {})}
        display={t('planner.readouts.eccentricity', { eccentricity: orbit.eccentricity })}
        precise={t('planner.readouts.eccentricity', { eccentricity: orbit.eccentricity })}
      />
    </dl>

    {orbit.circular ? (
      <p class="hh-readouts__note" data-testid="readouts-circular-note">
        {t('planner.readouts.circularNote', {})}
      </p>
    ) : null}
    {orbit.open ? (
      <p class="hh-readouts__note" data-testid="readouts-open-note">
        {t('planner.readouts.openNote', {})}
      </p>
    ) : null}

    <h2 class="hh-panel__heading">{t('planner.approach.heading', {})}</h2>
    {approach?.present !== true ? (
      <p class="hh-readouts__note" data-testid="approach-none">
        {t('planner.approach.none', {})}
      </p>
    ) : (
      <div class="hh-approach" data-testid="approach">
        <dl class="hh-readouts__list">
          <Row
            name="approach-range"
            label={t('planner.approach.rangeLabel', {})}
            display={t('planner.approach.range', { rangeMetres: approach.rangeM })}
            precise={t('planner.si.metres', { metres: approach.rangeM })}
          />
          <Row
            name="approach-speed"
            label={t('planner.approach.relativeSpeedLabel', {})}
            display={t('planner.approach.relativeSpeed', { mps: approach.relativeSpeedMps })}
            precise={t('planner.si.metresPerSecond', {
              metresPerSecond: approach.relativeSpeedMps,
            })}
          />
          <Row
            name="approach-at"
            label={t('planner.approach.atLabel', {})}
            display={t('planner.approach.at', {
              metSeconds: metAt(startEpoch, approach.epoch),
            })}
            precise={t('planner.si.seconds', {
              seconds: metAt(startEpoch, approach.epoch),
            })}
          />
        </dl>
        <p class="hh-approach__verdict" data-met={approach.met} data-testid="approach-verdict">
          <span aria-hidden="true">{approach.met ? '✓' : '✗'}</span>{' '}
          {approach.met
            ? t('planner.approach.met', { maxRangeMetres: approach.maxRangeM })
            : t('planner.approach.notMet', { maxRangeMetres: approach.maxRangeM })}
        </p>
      </div>
    )}
  </section>
);
