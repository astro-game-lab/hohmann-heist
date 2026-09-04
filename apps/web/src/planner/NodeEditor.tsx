/**
 * §8.3.5's node editor. #137, FR-410.
 *
 * Anchored to the node and **never modal**, which is the constraint that shapes
 * everything else here: the orbit view, the timeline and the plan panel all stay live
 * and interactive while it is open, so it cannot trap focus, cannot own the Escape key
 * unconditionally, and cannot assume the node it is editing still exists in the same
 * place after a change made somewhere else.
 *
 * ## The result block is the reason this screen exists
 *
 * FR-410 asks for apoapsis, periapsis and period as **live deltas against the pre-burn
 * orbit**, and §8.3.5 explains why in one line: a player dragging prograde and watching
 * "periapsis −125.8" *sees* the rule. That is not decoration. The M1 spike measured what
 * the orbit view can show — a 45 m/s change moves the drawn trajectory 5.455 px at LEO —
 * so the picture cannot teach this and the numbers have to.
 *
 * The deltas come from `burnResult`, which takes the two orbits either side of the
 * impulse and nothing else. The impulse already carries both states, so there is no
 * propagation here and no second opinion about what the burn did.
 *
 * ## Invalid epoch input is rejected, not clamped
 *
 * §8.3.5 is explicit, and the four fields are what make it precise. A field holds its own
 * text while it is being edited; on blur the four are recombined, and `metFromParts`
 * returns `null` for anything out of range. `null` restores the previous value.
 *
 * Clamping is the tempting alternative and is what the sentence rules out: a player who
 * types 75 minutes meant something, and quietly turning it into 59 produces a plan they
 * did not author and cannot see is different from the one they asked for.
 *
 * A valid epoch can still be *refused* — by the horizon, or by FR-101's spacing (`L5`) —
 * and that refusal comes back through the store as a reason, not as a silent no-op.
 *
 * ## Closing does not lose edits
 *
 * #137's sixth criterion. There is no draft state to lose: every field commits on blur or
 * on change, so the plan is always what the fields say. "Done" closes a panel whose work
 * is already saved, and the ✕ does the same. That is a design choice rather than a
 * shortcut — a modal editor with OK and Cancel would need a draft, and a *non-modal* one
 * with a draft would be showing the player a plan the rest of the screen disagrees with.
 */
import { metAt, type Epoch, type OrbitShape } from '@hh/astro';
import { fromDeltaVCounts, type ManeuverNode } from '@hh/sim';
import type { Catalogue } from '@hh/ui';
import { DELTA_V_STEP_MPS, burnResult, deltaVStep, metFromParts, metParts } from '@hh/ui';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/** Which axis a stepper drives. The index the catalogue's `step` message reads. */
const AXIS = { prograde: 0, radial: 1 } as const;

/** The four epoch fields as the text they currently show. */
type EpochDraft = Record<'hours' | 'minutes' | 'seconds' | 'milliseconds', string>;

const draftOf = (metSeconds: number): EpochDraft => {
  const parts = metParts(metSeconds);
  return {
    hours: String(parts.hours),
    minutes: String(parts.minutes),
    seconds: String(parts.seconds),
    milliseconds: String(parts.milliseconds),
  };
};

/**
 * A field's text as a number, or `NaN`.
 *
 * `Number('')` is 0, which would silently read an emptied field as zero rather than as
 * the incomplete entry it is. `NaN` reaches `metFromParts`, which refuses it as
 * non-integer — the refusal path, which is the correct one for a field mid-edit.
 */
const partValue = (text: string): number => (text.trim() === '' ? Number.NaN : Number(text));

export interface NodeEditorProps {
  readonly t: Catalogue['resolve'];
  readonly node: ManeuverNode;
  readonly index: number;
  readonly startEpoch: Epoch;
  /** The mission window, for the epoch slider's range. */
  readonly horizonSeconds: number;
  /** The orbit before the burn, and after it. `null` when the plan produced no timeline. */
  readonly orbits: { readonly before: OrbitShape; readonly after: OrbitShape } | null;
  readonly mu: number;
  readonly referenceRadiusM: number;
  readonly onEpoch: (metSeconds: number) => void;
  readonly onDeltaV: (progradeMps: number, radialMps: number) => void;
  readonly onSnap: (kind: 'periapsis' | 'apoapsis') => void;
  /**
   * Which apsis the burn currently sits on, or `null` for §8.3.5's "free".
   *
   * Derived by the caller rather than here, because deciding it means asking where this
   * arc's apsides are — which is `@hh/game`'s question and needs the timeline.
   */
  readonly snappedTo: 'periapsis' | 'apoapsis' | null;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}

export const NodeEditor = ({
  t,
  node,
  index,
  startEpoch,
  horizonSeconds,
  orbits,
  mu,
  referenceRadiusM,
  onEpoch,
  onDeltaV,
  onSnap,
  snappedTo,
  onDelete,
  onClose,
}: NodeEditorProps): JSX.Element => {
  const metSeconds = metAt(startEpoch, node.epoch);
  const radialMps = fromDeltaVCounts(node.deltaVCounts[0]);
  const progradeMps = fromDeltaVCounts(node.deltaVCounts[1]);
  const magnitude = Math.hypot(progradeMps, radialMps);

  // The fields hold **text** while they are being edited, not parsed numbers. A field
  // mid-edit is text: it can be empty, and `Number('')` is 0 — so a numeric draft would
  // read a cleared minutes field as "zero minutes" and commit it, rather than treating it
  // as the incomplete entry it is. `partValue` turns that case into `NaN` instead, which
  // `metFromParts` refuses, which is the restore path.
  //
  // They are re-seeded from the node whenever it changes underneath, which happens on
  // every drag of the same node in the orbit view: this overlay is not modal, and that
  // drag is still live.
  const [draft, setDraft] = useState(() => draftOf(metSeconds));
  useEffect(() => {
    setDraft(draftOf(metSeconds));
  }, [metSeconds]);

  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    // Focus the heading on open. Appropriate to a *non-modal* overlay: it moves focus in
    // so a keyboard user is where the new controls are, and does nothing to stop them
    // tabbing straight back out to the rest of the planner, which is what a modal would.
    headingRef.current?.focus();
  }, []);

  /** Commit the four fields, or restore them. §8.3.5's rejection rule. */
  const commitEpoch = (): void => {
    const seconds = metFromParts({
      hours: partValue(draft.hours),
      minutes: partValue(draft.minutes),
      seconds: partValue(draft.seconds),
      milliseconds: partValue(draft.milliseconds),
    });
    if (seconds === null) {
      setDraft(draftOf(metSeconds));
      return;
    }
    onEpoch(seconds);
  };

  const result =
    orbits === null ? null : burnResult(orbits.before, orbits.after, mu, referenceRadiusM);

  const Stepper = ({
    axis,
    sign,
    onStep,
  }: {
    readonly axis: number;
    readonly sign: number;
    readonly onStep: (delta: number) => void;
  }): JSX.Element => (
    <button
      type="button"
      class="hh-editor__stepper"
      aria-label={t('planner.editor.step', { sign, axis })}
      data-testid={`editor-step-${axis === AXIS.prograde ? 'prograde' : 'radial'}-${sign < 0 ? 'down' : 'up'}`}
      onClick={(event) => {
        // §8.3.5's modifiers, read from the click. The same rule answers the keyboard in
        // `keys.ts` and reaches `deltaVStep` there too, so there is one statement of it.
        onStep(sign * deltaVStep({ shift: event.shiftKey, ctrl: event.ctrlKey }));
      }}
    >
      {sign < 0 ? '◂' : '▸'}
    </button>
  );

  return (
    <section
      class="hh-editor"
      // A `dialog` role would announce it as modal and invite a focus trap. It is a
      // labelled region, which is what §8.3.5's "never modal" actually describes.
      role="group"
      aria-labelledby="hh-editor-heading"
      data-testid="node-editor"
    >
      <header class="hh-editor__header">
        <h3 id="hh-editor-heading" tabIndex={-1} ref={headingRef}>
          {t('planner.editor.heading', { index: index + 1 })}
        </h3>
        <button type="button" class="hh-editor__close" data-testid="editor-close" onClick={onClose}>
          {t('planner.editor.close', {})}
        </button>
      </header>

      <fieldset class="hh-editor__group">
        <legend>{t('planner.editor.epochLabel', {})}</legend>
        <div class="hh-editor__epoch">
          {(
            [
              ['hours', draft.hours, 'planner.editor.hours'],
              ['minutes', draft.minutes, 'planner.editor.minutes'],
              ['seconds', draft.seconds, 'planner.editor.seconds'],
              ['milliseconds', draft.milliseconds, 'planner.editor.milliseconds'],
            ] as const
          ).map(([field, value, key]) => (
            <label key={field}>
              <span class="hh-sr-only">{t(key, {})}</span>
              <input
                type="number"
                min={0}
                value={value}
                data-testid={`editor-epoch-${field}`}
                onInput={(event) => {
                  setDraft((current) => ({
                    ...current,
                    [field]: (event.target as HTMLInputElement).value,
                  }));
                }}
                onBlur={commitEpoch}
              />
            </label>
          ))}
        </div>

        <input
          type="range"
          class="hh-editor__slider"
          min={0}
          max={horizonSeconds}
          step={1}
          value={metSeconds}
          aria-label={t('planner.editor.epochSlider', {})}
          data-testid="editor-epoch-slider"
          onInput={(event) => {
            onEpoch(Number((event.target as HTMLInputElement).value));
          }}
        />

        {/*
          §8.3.5's three radios. Radios rather than buttons because they are a *state* as
          well as a command — "free" is where the burn is when it is on neither apsis, and
          there is nothing to press to get there. Choosing periapsis or apoapsis moves the
          burn; choosing free leaves it, which is why it is disabled: a control that
          reports a state it cannot bring about should not look pressable.
        */}
        <div
          class="hh-editor__snap"
          role="radiogroup"
          aria-label={t('planner.editor.snapLabel', {})}
        >
          {(
            [
              ['periapsis', 'planner.editor.snapPeriapsis'],
              ['apoapsis', 'planner.editor.snapApoapsis'],
            ] as const
          ).map(([kind, key]) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={snappedTo === kind}
              data-testid={`editor-snap-${kind}`}
              onClick={() => {
                onSnap(kind);
              }}
            >
              {t(key, {})}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={snappedTo === null}
            disabled
            data-testid="editor-snap-free"
          >
            {t('planner.editor.snapFree', {})}
          </button>
        </div>
      </fieldset>

      <fieldset class="hh-editor__group">
        <legend>{t('planner.editor.deltaVLabel', {})}</legend>

        <div class="hh-editor__field">
          <label>
            <span>{t('planner.editor.prograde', {})}</span>
            <input
              type="number"
              // No `step`: §8.3.5 asks for full float64 entry, and a step would make the
              // browser's own validation refuse a value the game accepts.
              value={progradeMps}
              data-testid="editor-prograde"
              onChange={(event) => {
                onDeltaV(Number((event.target as HTMLInputElement).value), radialMps);
              }}
            />
          </label>
          <Stepper
            axis={AXIS.prograde}
            sign={-1}
            onStep={(delta) => {
              onDeltaV(progradeMps + delta, radialMps);
            }}
          />
          <Stepper
            axis={AXIS.prograde}
            sign={1}
            onStep={(delta) => {
              onDeltaV(progradeMps + delta, radialMps);
            }}
          />
        </div>

        <div class="hh-editor__field">
          <label>
            <span>{t('planner.editor.radial', {})}</span>
            <input
              type="number"
              value={radialMps}
              data-testid="editor-radial"
              onChange={(event) => {
                onDeltaV(progradeMps, Number((event.target as HTMLInputElement).value));
              }}
            />
          </label>
          <Stepper
            axis={AXIS.radial}
            sign={-1}
            onStep={(delta) => {
              onDeltaV(progradeMps, radialMps + delta);
            }}
          />
          <Stepper
            axis={AXIS.radial}
            sign={1}
            onStep={(delta) => {
              onDeltaV(progradeMps, radialMps + delta);
            }}
          />
        </div>

        {/* §8.3.5 marks the normal component v1.1. Shown and disabled rather than absent,
            so a player who expects three components can see that the third is coming. */}
        <div class="hh-editor__field">
          <label>
            <span>{t('planner.editor.normal', {})}</span>
            <input type="number" value={0} disabled data-testid="editor-normal" />
          </label>
          <span class="hh-editor__note">{t('planner.editor.normalNote', {})}</span>
        </div>

        <p class="hh-editor__magnitude">
          <span>{t('planner.editor.magnitudeLabel', {})}</span>{' '}
          <span data-testid="editor-magnitude">
            {t('planner.editor.magnitude', { mps: magnitude })}
          </span>
        </p>
        <p class="hh-sr-only" id="hh-editor-step-hint">
          {t('planner.editor.stepHint', { stepMps: DELTA_V_STEP_MPS })}
        </p>
      </fieldset>

      <section class="hh-editor__result" data-testid="editor-result">
        <h4>{t('planner.editor.resultHeading', {})}</h4>
        {result === null ? null : (
          <dl class="hh-readouts__list">
            {result.apoapsisAltitude === null ? null : (
              <>
                <dt>{t('planner.readouts.apoapsisLabel', {})}</dt>
                <dd data-testid="editor-result-apoapsis">
                  {t('planner.readouts.apoapsis', {
                    altitudeMetres: result.apoapsisAltitude.after,
                  })}{' '}
                  {t('planner.editor.deltaAltitude', {
                    deltaMetres: result.apoapsisAltitude.delta,
                  })}
                </dd>
              </>
            )}
            <dt>{t('planner.readouts.periapsisLabel', {})}</dt>
            <dd data-testid="editor-result-periapsis">
              {t('planner.readouts.periapsis', {
                altitudeMetres: result.periapsisAltitude.after,
              })}{' '}
              {t('planner.editor.deltaAltitude', {
                deltaMetres: result.periapsisAltitude.delta,
              })}
            </dd>
            {result.period === null ? null : (
              <>
                <dt>{t('planner.readouts.periodLabel', {})}</dt>
                <dd data-testid="editor-result-period">
                  {t('planner.readouts.period', { seconds: result.period.after })}{' '}
                  {t('planner.editor.deltaPeriod', { deltaSeconds: result.period.delta })}
                </dd>
              </>
            )}
          </dl>
        )}
        {result?.period === null ? (
          <p class="hh-editor__note" data-testid="editor-result-open">
            {t('planner.editor.resultOpen', {})}
          </p>
        ) : null}
      </section>

      <footer class="hh-editor__footer">
        <button type="button" data-testid="editor-delete" onClick={onDelete}>
          {t('planner.editor.delete', {})}
        </button>
        <button type="button" data-testid="editor-done" onClick={onClose}>
          {t('planner.editor.done', {})}
        </button>
      </footer>
    </section>
  );
};
