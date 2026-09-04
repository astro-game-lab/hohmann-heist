/**
 * A readout value, with its full-precision reading behind it — FR-406.
 *
 * > *Values show display units by default and full precision on hover **or** focus.*
 *
 * The "or focus" is the whole reason this is a component rather than a `title`
 * attribute. `Briefing.tsx` uses a `title` plus a visually-hidden span, which is right
 * for a page that is read once; a readout is *inspected*, and #131 and #132 both name
 * focus explicitly because a `title` is unreachable by keyboard and unreliable to a
 * screen reader. So the precise reading is a real element, revealed by `:hover` and
 * `:focus-visible` alike, and the host is focusable so that a keyboard user can reach it.
 *
 * ## Why the precise reading is always in the accessible tree
 *
 * The hidden span is not `aria-hidden` and is not toggled — it is in the accessible name
 * of the value at all times, so a screen-reader user hears "274.2 kilometres, 274 198.33
 * metres" without having to discover that hovering does something. §8.8's rule is that
 * nothing is available to one input method only, and a reveal that only exists for
 * sighted pointer users is exactly that.
 *
 * ## Both strings arrive resolved
 *
 * Neither is built here. `display` and `precise` are catalogue results, so the rounding,
 * the unit and the decimal separator are all decided in `@hh/ui` — see FR-910 and the
 * note in `catalogue/types.ts` on why metres-to-kilometres is a locale decision.
 */
import type { JSX } from 'preact';

export interface ValueProps {
  /** The rounded, unit-bearing reading. Already resolved through the catalogue. */
  readonly display: string;
  /** The unrounded SI reading. Also already resolved. */
  readonly precise: string;
  /** Suffix for `data-testid`, so a test can address one row without a brittle selector. */
  readonly name: string;
}

export const Value = ({ display, precise, name }: ValueProps): JSX.Element => (
  // `tabIndex={0}` on a span is normally a smell — it makes a non-interactive element
  // focusable. Here it is the requirement: FR-406 asks for a reveal on focus, and the
  // only way to focus something is to be able to tab to it. It carries no role, because
  // it does nothing when activated; it is a value that can be inspected.
  <span class="hh-value" tabIndex={0} data-testid={`value-${name}`}>
    <span class="hh-value__display">{display}</span>
    <span class="hh-value__precise" data-testid={`precise-${name}`}>
      {precise}
    </span>
  </span>
);
