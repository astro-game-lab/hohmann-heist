/**
 * The icon set — §9.6, #176.
 *
 * > *UI icons — hand-drawn SVG, ≤ 20 glyphs, inline. CC BY 4.0 (ours). **No icon-font
 * > dependency.*** — §9.6
 *
 * One module, one grid, one stroke weight, `currentColor` throughout. Inline rather than
 * sprited or fetched: an icon font costs NFR-020's budget and adds a loading failure mode
 * where the glyph is a box until a network round trip completes, and a sprite sheet adds
 * a request for perhaps two kilobytes of path data.
 *
 * ## Why every glyph here has a consumer
 *
 * §8.3's mockups imply about twenty glyphs, and most of them belong to screens that do
 * not exist yet — the board (#119), the title (#118), settings (#122). Drawing them now
 * would put art in the bundle that nothing renders, and **a glyph with no consumer has no
 * test that can tell it from a broken one**: it would be reviewed once, by eye, and then
 * never looked at again until the screen that needed it shipped with a smudge.
 *
 * So this is the set the application actually draws today, and the shape of the module is
 * the deliverable as much as the paths are: adding a glyph is one entry in {@link PATHS}
 * and one name in {@link IconName}. The screens landing in later PRs add theirs with the
 * screen that draws them.
 *
 * ## Colour and meaning
 *
 * Nothing is filled and nothing is coloured. `currentColor` means a glyph takes the ink of
 * whatever it sits in, so it follows §9.2's palette through all five without a single
 * per-icon rule — which is the same property that made the palette worth extracting.
 *
 * And no glyph carries meaning alone (NFR-019). Every icon here is either `aria-hidden`
 * beside text that says the same thing, or inside a control whose accessible name comes
 * from the message catalogue. {@link Icon} makes the first case the default: it renders
 * `aria-hidden` unless given a label, so an icon has to be *asked* to be the only thing a
 * screen reader hears, and `icons.test.tsx` asserts no control in the app does that.
 */
import type { JSX } from 'preact';

/**
 * The grid every glyph is drawn on.
 *
 * 24 units, which is the size the stroke weight below was chosen against: 1.75 units at
 * 24 reads as a confident line at the 16 px these are rendered at, and stays a line rather
 * than becoming a smear at the 32 px hit target §8.8 asks for on desktop.
 */
export const ICON_VIEWBOX = '0 0 24 24';

/** Path data, by name. The whole set. */
const PATHS = {
  /** Zoom in — §8.3.4's ⊕. */
  'zoom-in': ['M11 4v14', 'M4 11h14', 'M16.5 16.5 21 21'],
  /** Zoom out — §8.3.4's ⊖. */
  'zoom-out': ['M4 11h14', 'M16.5 16.5 21 21'],
  /** Recentre the camera — §8.3.4's ⌖, FR-404. */
  recentre: [
    'M12 3v4',
    'M12 17v4',
    'M3 12h4',
    'M17 12h4',
    'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5',
  ],
  /** Delete a node — §8.3.5's DELETE. */
  delete: ['M4 7h16', 'M10 7V4h4v3', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
  /** Open the node editor — §8.3.4's ⤢. */
  expand: ['M4 10V4h6', 'M20 14v6h-6', 'M4 4l6 6', 'M20 20l-6-6'],
  /** Close an overlay — §8.3.5's ✕. */
  close: ['M6 6l12 12', 'M18 6L6 18'],
  /** Pause playback — §8.3.8. */
  pause: ['M9 5v14', 'M15 5v14'],
  /** Resume playback — §8.3.8. */
  play: ['M7 4.5v15l13-7.5z'],
  /** Skip to the end of a run — §8.3.8's S. */
  skip: ['M5 4.5v15l11-7.5z', 'M19 4v16'],
  /** Retry a contract — §8.3.9's ⟲, §6.11. */
  retry: ['M20 12a8 8 0 1 1-2.6-5.9', 'M20 4v5h-5'],
  /** Share a run — §8.3.9. */
  share: [
    'M8 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0',
    'M21 5.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0',
    'M21 18.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0',
    'M7.8 10.8 16.2 6.7',
    'M7.8 13.2l8.4 4.1',
  ],
  /** The 100 km altitude floor — §6.5, DEP-08. A surface with hazard hatching under it. */
  'altitude-floor': ['M2 15h20', 'M5 19l3-4', 'M11 19l3-4', 'M17 19l3-4', 'M7 10a5 5 0 0 1 10 0'],
  /** A mission deadline — §6.5. */
  deadline: ['M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16', 'M12 8v4.5l3 2'],
  /** A cap on the number of burns — §6.5, first used by C04. */
  'burn-count': ['M12 3c3 4 5 6 5 9a5 5 0 0 1-10 0c0-3 2-5 5-9', 'M12 20v1'],
  /** Something is wrong, or close to a limit — §8.6. */
  warning: ['M12 4 2.5 20h19z', 'M12 10v5', 'M12 17.5v.5'],
} as const satisfies Record<string, readonly string[]>;

/** Every glyph the application draws. */
export type IconName = keyof typeof PATHS;

/** The names, for a test or a contact sheet. */
export const ICON_NAMES = Object.keys(PATHS) as readonly IconName[];

export interface IconProps {
  readonly name: IconName;
  /**
   * The accessible name, already resolved from the catalogue.
   *
   * Omitted — the common case — the glyph is `aria-hidden` and something beside it says
   * what it means. Given, it becomes an image with a name, for a control that has no
   * visible text of its own.
   */
  readonly label?: string;
  /** Extra classes, for sizing at a particular site. */
  readonly class?: string;
}

/**
 * One glyph.
 *
 * `focusable="false"` because IE-era SVG is focusable by default in some engines and a
 * tab stop on a decoration is a keyboard trap in miniature (§8.8: *no keyboard traps*).
 */
export const Icon = ({ name, label, class: className }: IconProps): JSX.Element => (
  <svg
    class={className === undefined ? 'hh-icon' : `hh-icon ${className}`}
    viewBox={ICON_VIEWBOX}
    focusable="false"
    {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
  >
    {PATHS[name].map((d) => (
      <path key={d} d={d} />
    ))}
  </svg>
);
