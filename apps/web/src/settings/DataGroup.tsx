/**
 * §8.3.12's Data group — export, import, clear — FR-703, §11.7, §13.5's E14 (#185).
 *
 * > *This is also the only "cloud save": the player carries it.* — §11.7
 *
 * There is no account and no server (D11), so the exported file is the entire backup
 * story. Two things follow, and they shape everything here.
 *
 * ## Import and clear are confirmed, and the confirmation says what is at stake
 *
 * Both destroy progress irreversibly once the old save is gone. #185 asks the confirmation
 * to state *"what is being replaced (contract count, best medals) rather than asking an
 * abstract 'are you sure'"*, and that is the difference between a dialog people read and
 * one they learn to click through: a number they recognise is what makes somebody stop
 * when it is bigger than they expected.
 *
 * Offering **export first** from inside the confirmation is the cheap and obviously right
 * move — the player is one click from losing something and one click from keeping it, and
 * making them cancel, export, and come back is a way of losing saves.
 *
 * ## It has to work when storage does not
 *
 * Export reads the in-memory save (#184), never `localStorage`. Import applies to memory
 * and *attempts* to persist, reporting a failure without losing the imported progress for
 * the session. A player in a browser that will not store can still carry the file, which
 * is the only recovery that exists for them.
 *
 * ## Refusal is specific, and never partial
 *
 * `parseSaveV1` already refuses an invalid or future-version document rather than reading
 * what it can. This renders *which* — a message naming the version mismatch is what tells
 * a player they need a newer build rather than a different file — and the current save is
 * untouched in every refusal path.
 */
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';

import { useOverlay } from '../a11y/overlay.js';
import { downloadSave, readFileText, summarise } from '../save/download.js';
import { importSave } from '../save/transfer.js';
import type { SaveV1 } from '../save/index.js';

export interface DataGroupProps {
  readonly t: Catalogue['resolve'];
  /** The in-memory save. Export reads this, never storage. */
  readonly save: SaveV1;
  /** Replace the save wholesale — import and clear both go through here. */
  readonly onReplace: (save: SaveV1) => void;
  readonly onClear: () => void;
  readonly children?: JSX.Element | null;
}

/** Which destructive action is waiting for an answer. */
type Pending = 'import' | 'clear' | null;

/** What the last import said, if anything. */
type Outcome =
  | { readonly kind: 'imported' }
  | { readonly kind: 'cleared' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'fileUnreadable' }
  | { readonly kind: 'futureVersion'; readonly found: number; readonly supported: number }
  | null;

export const DataGroup = ({
  t,
  save,
  onReplace,
  onClear,
  children,
}: DataGroupProps): JSX.Element => {
  const [pending, setPending] = useState<Pending>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  // Held between the picker and the confirmation: the file is read first so that an
  // unreadable one is refused *before* the player is asked to destroy anything. Asking
  // "replace your progress?" and then failing to import would be the worst order.
  const [incoming, setIncoming] = useState<SaveV1 | null>(null);

  /*
   * The confirmation is an overlay too, and #169's policy covers it (`a11y/overlay.ts`).
   *
   * Non-modal — `aria-modal="false"` below, and deliberately: the settings screen behind
   * stays readable while the player decides, and this is a two-button question rather than
   * a mode. So focus moves in and is restored to the button that raised it, and nothing is
   * trapped.
   *
   * Moving focus in is the part that was missing. The confirmation is rendered *after* a
   * press on Import or Clear, so without this a keyboard user pressed a button and the
   * question they now had to answer was somewhere below them in the tab order, unannounced.
   *
   * `Esc` stays on the container handler below rather than coming from the hook: it is
   * scoped to focus-within by virtue of being a container handler, which is what #185 asks
   * for and what a document-level listener would not be.
   */
  const confirmRef = useOverlay<HTMLDivElement>({ modal: false, open: pending !== null });

  const summary = summarise(save);
  const counts = {
    contracts: summary.contracts,
    bronze: summary.medals.find((row) => row.medal === 'bronze')?.count ?? 0,
    silver: summary.medals.find((row) => row.medal === 'silver')?.count ?? 0,
    gold: summary.medals.find((row) => row.medal === 'gold')?.count ?? 0,
    clean: summary.medals.find((row) => row.medal === 'clean')?.count ?? 0,
  };

  const exportNow = (): void => {
    downloadSave(save);
  };

  const onFilePicked = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    const read = await readFileText(file);
    if (!read.ok) {
      setOutcome({ kind: 'fileUnreadable' });
      return;
    }

    const result = importSave(read.text);
    if (!result.ok) {
      setOutcome(
        result.problem.code === 'futureVersion'
          ? {
              kind: 'futureVersion',
              found: result.problem.found ?? 0,
              supported: result.problem.supported ?? 0,
            }
          : { kind: 'unreadable' },
      );
      return;
    }

    setIncoming(result.save);
    setOutcome(null);
    setPending('import');
  };

  const confirmed = (): void => {
    if (pending === 'import' && incoming !== null) {
      onReplace(incoming);
      setOutcome({ kind: 'imported' });
    } else if (pending === 'clear') {
      onClear();
      setOutcome({ kind: 'cleared' });
    }
    setIncoming(null);
    setPending(null);
  };

  const dismiss = (): void => {
    setIncoming(null);
    setPending(null);
  };

  return (
    <>
      <p class="hh-setting__note">{t('settings.export.hint', {})}</p>

      {children}

      <div class="hh-data__actions">
        <button type="button" data-testid="export-save" onClick={exportNow}>
          {t('settings.export.label', {})}
        </button>

        <button
          type="button"
          data-testid="import-save"
          onClick={() => {
            fileInput.current?.click();
          }}
        >
          {t('settings.import.label', {})}
        </button>

        {/*
          The picker itself is hidden and driven from the button above, because a bare
          `<input type="file">` cannot be labelled or styled consistently across browsers.
          It stays in the tab order's shadow rather than being removed: `hidden` would make
          `click()` a no-op in some engines, so it is visually hidden and `aria-hidden`,
          and the button carries the accessible name.
        */}
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          class="hh-sr-only"
          aria-hidden="true"
          tabIndex={-1}
          data-testid="import-file"
          onChange={(event) => {
            const input = event.currentTarget;
            void onFilePicked(input.files?.[0]).finally(() => {
              // Cleared so picking the same file twice fires `change` the second time.
              input.value = '';
            });
          }}
        />

        <button
          type="button"
          data-testid="clear-save"
          onClick={() => {
            setOutcome(null);
            setPending('clear');
          }}
        >
          {t('settings.clear.label', {})}
        </button>

        {/*
          §11.12's "what we store". A link rather than a copy of the text: the privacy
          statement is one document, and a second copy inside a settings screen is a second
          copy to keep true.
        */}
        <a href="#/codex/what-we-store" data-testid="what-we-store">
          {t('settings.whatWeStore', {})}
        </a>
      </div>

      {pending === null ? null : (
        <div
          class="hh-data__confirm"
          ref={confirmRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby="hh-data-confirm-heading"
          data-testid="data-confirm"
          onKeyDown={(event) => {
            // Esc dismisses without acting — #185 asks for it by name, and a confirmation
            // that could only be answered with the mouse would fail NFR-016 anyway.
            if (event.key === 'Escape') {
              event.preventDefault();
              dismiss();
            }
          }}
        >
          <h3 id="hh-data-confirm-heading">
            {t(
              pending === 'import'
                ? 'settings.confirm.importHeading'
                : 'settings.confirm.clearHeading',
              {},
            )}
          </h3>
          <p data-testid="data-confirm-summary">
            {counts.contracts === 0
              ? t('settings.confirm.nothing', {})
              : t('settings.confirm.replacing', counts)}
          </p>
          <button type="button" data-testid="confirm-export-first" onClick={exportNow}>
            {t('settings.confirm.exportFirst', {})}
          </button>
          <button type="button" data-testid="confirm-proceed" onClick={confirmed}>
            {t(pending === 'import' ? 'settings.confirm.import' : 'settings.confirm.clear', {})}
          </button>
          <button type="button" data-testid="confirm-cancel" onClick={dismiss}>
            {t('settings.confirm.cancel', {})}
          </button>
        </div>
      )}

      {outcome === null ? null : (
        <p class="hh-data__outcome" role="status" data-testid="data-outcome">
          {outcome.kind === 'imported'
            ? t('settings.import.done', {})
            : outcome.kind === 'cleared'
              ? t('settings.cleared', {})
              : outcome.kind === 'fileUnreadable'
                ? t('settings.import.fileUnreadable', {})
                : outcome.kind === 'futureVersion'
                  ? t('settings.import.futureVersion', {
                      found: outcome.found,
                      supported: outcome.supported,
                    })
                  : t('settings.import.unreadable', {})}
        </p>
      )}
    </>
  );
};
