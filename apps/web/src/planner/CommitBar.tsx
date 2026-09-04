/**
 * Commit, and the reasons it is disabled — #139, FR-408, §6.4.
 *
 * Four criteria, and three of them are about the same mistake: telling a player *that*
 * they cannot commit without telling them *why*, or telling them only the first of
 * several reasons, or telling them in a way a screen reader never reaches.
 *
 * ## Every simultaneous reason, not the first
 *
 * `evaluateLegality` evaluates every applicable rule on every call and returns every
 * failure together — its docstring says why: *"Reporting the first one and stopping would
 * make a player fix five problems in five commits, discovering each only after solving
 * the last."* This renders the whole list. There is no `[0]` in this file.
 *
 * ## `L6` does not disable Commit, and that is the point
 *
 * §6.4: *"Committing a plan you know will fail is a legitimate way to learn, and the
 * debrief for a near-miss is one of the best teaching moments the game has."* So an unmet
 * objective is shown — prominently, because it is the thing the player most needs to
 * know — and the button stays enabled.
 *
 * This component does not decide that. `commitAllowed` is `evaluateLegality`'s verdict,
 * computed from each reason's own `blocking` flag, and the button reads it directly. The
 * reasons are split for *display* by the same flag, so there is no second rule here that
 * could disagree about which codes block. #139's second criterion asks for a test, and
 * `CommitBar.test.tsx` asserts it against a plan carrying `L6` and nothing else.
 *
 * ## The reasons are associated with the control, not merely beside it
 *
 * `aria-describedby` on the button, pointing at the list. A paragraph of red text next to
 * a disabled button is invisible to someone who tabs to the button and hears "Commit
 * plan, dimmed" and nothing else. That is #139's fifth criterion and it is one attribute.
 */
import type { Legality } from '@hh/game';
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';

const REASONS_ID = 'hh-commit-reasons';

export interface CommitBarProps {
  readonly t: Catalogue['resolve'];
  readonly resolveDynamic: Catalogue['resolveDynamic'];
  readonly legality: Legality;
  readonly onCommit: () => void;
}

export const CommitBar = ({
  t,
  resolveDynamic,
  legality,
  onCommit,
}: CommitBarProps): JSX.Element => {
  // A plan that produced no trajectory has one reason and no `reasons` array — §6.4's
  // non-evaluable case. It is not "illegal"; there was nothing to judge. The message says
  // what actually happened, which is the whole reason that arm exists.
  const reasons = legality.evaluable
    ? legality.reasons
    : [{ code: 'plan' as const, blocking: true, message: legality.reason }];

  const blocking = reasons.filter((reason) => reason.blocking);
  const warnings = reasons.filter((reason) => !reason.blocking);
  const hasReasons = reasons.length > 0;

  return (
    <div class="hh-commit" data-testid="commit-bar">
      {hasReasons ? (
        <ul class="hh-commit__reasons" id={REASONS_ID} data-testid="commit-reasons">
          {blocking.map((reason) => (
            <li
              key={`${reason.code}:${reason.message.key}`}
              class="hh-commit__reason"
              data-code={reason.code}
              data-blocking="true"
              data-testid={`commit-reason-${reason.code}`}
            >
              {resolveDynamic(reason.message.key, reason.message.params)}
            </li>
          ))}
          {warnings.map((reason) => (
            <li
              key={`${reason.code}:${reason.message.key}`}
              class="hh-commit__reason"
              data-code={reason.code}
              data-blocking="false"
              data-testid={`commit-reason-${reason.code}`}
            >
              {resolveDynamic(reason.message.key, reason.message.params)}
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        class="hh-commit__button"
        // The verdict, not a recomputation of it. `commitAllowed` is false exactly when
        // some reason is blocking, and `L6` is never one — see the docstring.
        disabled={!legality.commitAllowed}
        {...(hasReasons ? { 'aria-describedby': REASONS_ID } : {})}
        data-testid="commit"
        onClick={onCommit}
      >
        {t('planner.commit', {})}
      </button>
    </div>
  );
};
