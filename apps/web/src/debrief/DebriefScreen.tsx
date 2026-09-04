/**
 * The debrief — §8.3.9, FR-304, FR-305, FR-307, #121.
 *
 * > *Say what happened, in numbers, and make the next action obvious. This is where
 * > learning is consolidated, so it does more work than a results screen usually does.*
 *
 * Both variants of §8.3.9 are here, and they are the **same layout with one block
 * swapped** — the medal and the comparison table on a success, the diagnosis block on a
 * failure. That is the spec's own arrangement and it matters: a failure screen that
 * looked like a different screen would read as punishment, and §6.11 is explicit that
 * *"there is no lose state"*.
 *
 * ## Where the numbers come from
 *
 * All of them from one `Outcome`, computed at commit by `@hh/game`'s `evaluateOutcome`
 * and passed down. Nothing here evaluates, compares or rounds — `@hh/ui`'s `rows.ts`
 * decides which rows exist and the catalogue decides how a number reads. This file
 * arranges elements.
 *
 * ## FR-307, and why the failure block sometimes says nothing about why
 *
 * > *The debrief MUST produce a diagnosis from the rule set in §8.3.9, and MUST fall
 * > back to bare numbers rather than speculate.*
 *
 * `outcome.diagnosis` is `null` whenever no rule matched, and the block then shows the
 * three facts #121 asks for — closest approach achieved, what was needed, Δv used — plus
 * a line saying that is deliberate. Without that line a bare table reads as a screen
 * that failed to load; with it, it reads as the honest answer it is. The rule set grows
 * in #83 and nothing here changes.
 *
 * ## D12: beating par is a bug report
 *
 * §6.7: *"If a player beats `par_dv`, that is a bug report about our optimum, and the
 * debrief says so and offers to file it."* So the block that appears is not a
 * congratulation — it says our number was wrong and offers the report, prefilled with
 * the replay code (FR-305).
 */
import type { LoadedScenario, Outcome } from '@hh/game';
import type { Catalogue, DebriefRow, MissRow, PersonalBest } from '@hh/ui';
import { approachSummary, missRows, resultRows } from '@hh/ui';
import type { JSX } from 'preact';

export interface DebriefScreenProps {
  readonly t: Catalogue['resolve'];
  readonly resolveDynamic: Catalogue['resolveDynamic'];
  readonly scenario: LoadedScenario;
  readonly outcome: Outcome;
  /** What the save records for this contract, if anything (FR-302). */
  readonly best?: PersonalBest;
  /** §6.11: *Retry* restores the plan. */
  readonly onRetry: () => void;
  /** The next contract, or `null` when this build ships no later one. */
  readonly onNext: (() => void) | null;
  /** Copies §11.6's replay code. Resolves to whether the clipboard accepted it. */
  readonly onShare: () => void;
  /** Whether the last share attempt succeeded, or `null` before one was made. */
  readonly shareResult: 'copied' | 'failed' | null;
  readonly onBoard: () => void;
  /** D12's prefilled report, or `null` when there is nowhere to file it. */
  readonly reportHref: string | null;
}

/** A row's label key. A switch, so a fourth quantity is a compile error here. */
const labelKeyOf = (quantity: DebriefRow['quantity']) => {
  switch (quantity) {
    case 'deltaV':
      return 'debrief.row.deltaV' as const;
    case 'time':
      return 'debrief.row.time' as const;
    case 'burns':
      return 'debrief.row.burns' as const;
  }
};

/** A value in the row's own unit. The unit is a property of the quantity, not the column. */
const valueText = (
  quantity: DebriefRow['quantity'],
  value: number,
  t: Catalogue['resolve'],
): string => {
  switch (quantity) {
    case 'deltaV':
      return t('debrief.value.deltaV', { mps: value });
    case 'time':
      return t('debrief.value.time', { seconds: value });
    case 'burns':
      return t('debrief.value.burns', { count: value });
  }
};

/** One line of the failure block. */
const missText = (row: MissRow, t: Catalogue['resolve']): string => {
  switch (row.quantity) {
    case 'closest':
      return t('debrief.miss.closest', { rangeM: row.value, metSeconds: row.epochSeconds ?? 0 });
    case 'needed':
      return t('debrief.miss.needed', { rangeM: row.value });
    case 'deltaV':
      return t('debrief.miss.deltaV', { usedMps: row.value, budgetMps: row.limit ?? 0 });
  }
};

/** A failure row's label. §8.3.9's block is labelled rows, not a bare list of numbers. */
const missLabelKeyOf = (quantity: MissRow['quantity']) => {
  switch (quantity) {
    case 'closest':
      return 'debrief.miss.label.closest' as const;
    case 'needed':
      return 'debrief.miss.label.needed' as const;
    case 'deltaV':
      return 'debrief.miss.label.deltaV' as const;
  }
};

export const DebriefScreen = ({
  t,
  resolveDynamic,
  scenario,
  outcome,
  best,
  onRetry,
  onNext,
  onShare,
  shareResult,
  onBoard,
  reportHref,
}: DebriefScreenProps): JSX.Element => {
  const heading = outcome.success
    ? t('debrief.heading.success', {
        index: scenario.document.index,
        title: scenario.document.title,
      })
    : t('debrief.heading.failure', {
        index: scenario.document.index,
        title: scenario.document.title,
      });

  const approach = approachSummary(outcome, scenario.startEpoch);

  return (
    <div class="hh-debrief" data-testid="debrief">
      <h2 class="hh-debrief__heading" data-testid="debrief-heading">
        {heading}
      </h2>

      {/*
        The medal, by name as well as by shape. §8.8: *"no information by colour alone"*,
        and a medal is exactly the kind of thing a game conveys with a colour and a
        silhouette. `data-medal` carries it for styling; the text carries it for reading.
      */}
      {outcome.success ? (
        <p
          class="hh-debrief__medal"
          data-medal={outcome.medal ?? 'none'}
          data-testid="debrief-medal"
        >
          {outcome.medal === null
            ? t('debrief.medal.none', {})
            : t('debrief.medal', { medal: outcome.medal })}
        </p>
      ) : (
        <p class="hh-debrief__missed" data-testid="debrief-missed">
          {t('debrief.missed', {})}
        </p>
      )}

      {outcome.success ? (
        <table class="hh-debrief__table" data-testid="debrief-table">
          <caption class="hh-sr-only">{t('debrief.table.label', {})}</caption>
          <thead>
            <tr>
              {/* Visually blank in §8.3.9's mock, and never blank to a screen reader. */}
              <th scope="col">
                <span class="hh-sr-only">{t('debrief.column.quantity', {})}</span>
              </th>
              <th scope="col">{t('debrief.column.you', {})}</th>
              <th scope="col">{t('debrief.column.par', {})}</th>
              <th scope="col">{t('debrief.column.best', {})}</th>
              <th scope="col">{t('debrief.column.delta', {})}</th>
            </tr>
          </thead>
          <tbody>
            {resultRows(outcome, best ?? {}).map((row) => (
              <tr key={row.quantity} data-testid={`debrief-row-${row.quantity}`}>
                <th scope="row">{t(labelKeyOf(row.quantity), {})}</th>
                <td>{valueText(row.quantity, row.you, t)}</td>
                <td>{valueText(row.quantity, row.par, t)}</td>
                <td>
                  {row.best === null
                    ? t('debrief.value.absent', {})
                    : valueText(row.quantity, row.best, t)}
                </td>
                <td>
                  {row.deltaFraction === null
                    ? t('debrief.value.absent', {})
                    : t('debrief.value.delta', { fraction: row.deltaFraction })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        // A description list: these are labelled values, and `<dl>` is what says so to
        // a screen reader. A `<ul>` of "label: value" strings would be the same pixels
        // and none of the structure.
        <dl class="hh-debrief__miss" data-testid="debrief-miss">
          {missRows(outcome, scenario.startEpoch).map((row) => (
            <div key={row.quantity} class="hh-debrief__miss-row" data-quantity={row.quantity}>
              <dt>{t(missLabelKeyOf(row.quantity), {})}</dt>
              <dd>{missText(row, t)}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* §8.3.9's closest-approach line, which a success shows under the table. */}
      {outcome.success && approach !== null ? (
        <p class="hh-debrief__closest" data-testid="debrief-closest">
          {t('debrief.closest', {
            achievedM: approach.achievedM,
            neededM: approach.neededM,
            metSeconds: approach.epochSeconds,
          })}
        </p>
      ) : null}

      <section class="hh-debrief__what">
        <h3>{t('debrief.whatHappened', {})}</h3>
        <p data-testid="debrief-diagnosis">
          {outcome.diagnosis === null
            ? t('debrief.noDiagnosis', {})
            : resolveDynamic(outcome.diagnosis.key, outcome.diagnosis.params)}
        </p>
      </section>

      {/* D12, FR-305. Not a congratulation — a report that our number was wrong. */}
      {outcome.beatParDv ? (
        <section class="hh-debrief__beat-par" data-testid="debrief-beat-par">
          <p>{t('debrief.beatPar', { byMps: outcome.par.dvMps - outcome.dvUsedMps })}</p>
          {reportHref === null ? null : (
            <a href={reportHref} target="_blank" rel="noreferrer noopener">
              {t('debrief.beatPar.report', {})}
            </a>
          )}
        </section>
      ) : null}

      <div class="hh-debrief__actions">
        <button type="button" data-testid="debrief-retry" onClick={onRetry}>
          {t('debrief.action.retry', {})}
        </button>
        {/*
          NEXT is present and unavailable rather than absent, and says why. A control that
          vanished would leave the player wondering whether they had missed something;
          this states the boundary is the build's, not their progress.
        */}
        <button
          type="button"
          data-testid="debrief-next"
          disabled={onNext === null}
          {...(onNext === null ? { 'aria-describedby': 'hh-debrief-next-note' } : {})}
          onClick={() => onNext?.()}
        >
          {t('debrief.action.next', {})}
        </button>
        <button type="button" data-testid="debrief-share" onClick={onShare}>
          {t('debrief.action.share', {})}
        </button>
        <button type="button" data-testid="debrief-board" onClick={onBoard}>
          {t('debrief.action.board', {})}
        </button>
      </div>

      {onNext === null ? (
        <p class="hh-debrief__note" id="hh-debrief-next-note" data-testid="debrief-next-note">
          {t('debrief.next.none', {})}
        </p>
      ) : null}

      <p class="hh-debrief__note">{t('debrief.share.hint', {})}</p>
      {shareResult === null ? null : (
        <p class="hh-debrief__note" role="status" data-testid="debrief-share-result">
          {shareResult === 'copied' ? t('debrief.share.copied', {}) : t('debrief.share.failed', {})}
        </p>
      )}
    </div>
  );
};
