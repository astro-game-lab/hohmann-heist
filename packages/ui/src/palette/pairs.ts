/**
 * Which pairs are measured, and against which threshold — §8.8, NFR-018.
 *
 * §8.8 sets two thresholds: **≥ 4.5:1 for text** and **≥ 3:1 for UI boundaries and graph
 * lines**. This is the list of pairs those thresholds are applied to, and it is explicit
 * rather than derived.
 *
 * ## Why the list is written out rather than generated
 *
 * The obvious implementation checks every token against every other — 13 × 13, or 78
 * unordered pairs. It would be shorter and it would be worse in two ways that matter.
 *
 * **Most of those pairs are meaningless.** `--ok` is never drawn on `--bad`, and no
 * palette should be constrained by a combination the design never produces. A check whose
 * failures are mostly irrelevant is a check people learn to override, and the first time
 * an override is added for a pair nobody uses, the habit exists for the pair somebody does.
 *
 * **And the meaningless ones are unsatisfiable.** Requiring 4.5:1 between every pair of
 * thirteen colours forces them apart until the palette is black, white and eleven greys.
 * The pressure would be to loosen the threshold — which is the failure NFR-018 exists to
 * prevent — rather than to shorten the list, which is the correct fix.
 *
 * So each entry below is a pair the interface actually renders, with a one-line note
 * naming where. When a screen starts drawing a combination that is not here, the entry is
 * added with it; a pair that is *not* listed is a claim that nothing draws it, and that
 * claim is reviewable in a way "we check everything" is not.
 *
 * ## The ground is named, never assumed
 *
 * Two tokens are translucent (`--hazard`, `--grid`), and a translucent colour's ratio
 * depends entirely on what is behind it — see `./contrast.ts`. So every pair names its
 * ground explicitly, and the same foreground appears twice when it is drawn on both the
 * console ground and a panel.
 *
 * ## Fills are not lines, and pretending otherwise breaks the design
 *
 * §8.8 sets thresholds for **text** and for **UI boundaries and graph lines**. It sets
 * none for a region *fill*, and two of §9.2's thirteen tokens are fills: `--earth` is a
 * disc and `--hazard` is a hatched wash at 15% alpha.
 *
 * Holding either to 3:1 against space would be applying a line rule to a region, and it
 * would wreck the thing it was meant to protect. Earth at 3:1 against the console ground
 * is a mid-grey disc, not §9.3's *"deep blue-grey"*; a hazard wash at 3:1 is a solid red
 * band, which is the state §9.3 reserves for a trajectory that is actually intersecting
 * it. In both cases what has to be **seen** is the line drawn on the fill — Earth's limb
 * and coastline, and the hazard hatch — and those are opaque strokes derived from these
 * tokens in `apps/web`.
 *
 * So a fill carries `kind: 'fill'` and a `linedBy` note saying where its edge is checked,
 * rather than a threshold it cannot meet. The token matrix then asserts only what is
 * true of a fill — that it parses, and that it is distinguishable from its ground at all
 * — and `apps/web`'s scene-derivation test enforces 3:1 on the strokes. Two checks, each
 * measuring something real, instead of one measuring the wrong thing.
 */
import type { MedalKey, Token } from './tokens.js';

/** §8.8's two thresholds. */
export const TEXT_CONTRAST_MIN = 4.5;
export const GRAPHIC_CONTRAST_MIN = 3;

/**
 * What a pair is.
 *
 * `text` is read, `graphic` is a line or boundary to be seen, `fill` is a region tint
 * whose edge carries the legibility. See the note above on why the third exists.
 */
export type PairKind = 'text' | 'graphic' | 'fill';

/** A token, or one of the medal ramp's entries (see `./palettes.ts`). */
export type ContrastSubject = Token | `medal.${MedalKey}`;

export interface ContrastPair {
  /** What is drawn. */
  readonly subject: ContrastSubject;
  /** What it is drawn on. Always an opaque ground. */
  readonly ground: Extract<Token, 'bg' | 'bg-panel'>;
  readonly kind: PairKind;
  /** Where this combination appears, so a failure names a screen and not a hex code. */
  readonly where: string;
  /**
   * For a `fill` only: where the 3:1 check on its edge actually lives.
   *
   * Required by the test rather than by the type, so that adding a fill without saying
   * how its edge is covered fails rather than quietly exempting a token from every check.
   */
  readonly linedBy?: string;
}

/**
 * The required ratio for a pair, or `undefined` for a fill.
 *
 * `undefined` rather than a small invented number: there is no published threshold for a
 * region tint, and picking one would be this module asserting a standard that does not
 * exist. What a fill is held to is stated in the test, in the terms that are actually
 * true of it.
 */
export const minimumFor = (kind: PairKind): number | undefined => {
  switch (kind) {
    case 'text':
      return TEXT_CONTRAST_MIN;
    case 'graphic':
      return GRAPHIC_CONTRAST_MIN;
    case 'fill':
      return undefined;
  }
};

/**
 * Every combination the interface renders, as of this milestone.
 *
 * Grouped by ground rather than by token, because that is how a palette is judged: a
 * designer asks "what can be read on a panel", not "where does amber appear".
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = Object.freeze([
  // ── Text on the console ground ──────────────────────────────────────────────
  { subject: 'fg', ground: 'bg', kind: 'text', where: 'Every screen heading and body' },
  { subject: 'fg-dim', ground: 'bg', kind: 'text', where: 'Units, labels, the debrief build line' },
  { subject: 'accent', ground: 'bg', kind: 'text', where: 'Clean Job medal, primary action label' },
  { subject: 'ok', ground: 'bg', kind: 'text', where: 'Closest-approach verdict when met' },
  {
    subject: 'warn',
    ground: 'bg',
    kind: 'text',
    where: 'Non-blocking commit reason, paused notice',
  },
  {
    subject: 'bad',
    ground: 'bg',
    kind: 'text',
    where: 'Blocking commit reason, MISSED, constraint log entry',
  },
  { subject: 'target', ground: 'bg', kind: 'text', where: 'Target label beside its marker' },

  // ── Text on a panel ─────────────────────────────────────────────────────────
  { subject: 'fg', ground: 'bg-panel', kind: 'text', where: 'Node editor, precision tooltip' },
  { subject: 'fg-dim', ground: 'bg-panel', kind: 'text', where: 'Node editor legends and notes' },
  { subject: 'accent', ground: 'bg-panel', kind: 'text', where: 'Node editor emphasis' },
  { subject: 'ok', ground: 'bg-panel', kind: 'text', where: 'Result deltas that improve' },
  { subject: 'warn', ground: 'bg-panel', kind: 'text', where: 'Result deltas approaching a limit' },
  { subject: 'bad', ground: 'bg-panel', kind: 'text', where: 'Refused edit, illegal value' },

  // ── The medal ramp, which is text wherever it appears ───────────────────────
  { subject: 'medal.bronze', ground: 'bg', kind: 'text', where: 'Debrief medal, board card' },
  { subject: 'medal.silver', ground: 'bg', kind: 'text', where: 'Debrief medal, board card' },
  { subject: 'medal.gold', ground: 'bg', kind: 'text', where: 'Debrief medal, board card' },
  { subject: 'medal.clean', ground: 'bg', kind: 'text', where: 'Debrief medal, board card' },

  // ── Lines, bars and boundaries ──────────────────────────────────────────────
  {
    subject: 'accent',
    ground: 'bg',
    kind: 'graphic',
    where: 'Current orbit; Δv bar fill; progress fill',
  },
  {
    subject: 'plan',
    ground: 'bg',
    kind: 'graphic',
    where: 'Planned trajectory dots; node markers',
  },
  { subject: 'target', ground: 'bg', kind: 'graphic', where: 'Target orbit, dashed' },
  { subject: 'ok', ground: 'bg', kind: 'graphic', where: 'Objective-met tick on the timeline' },
  { subject: 'warn', ground: 'bg', kind: 'graphic', where: 'Δv bar at 90% of budget' },
  {
    subject: 'bad',
    ground: 'bg',
    kind: 'graphic',
    where: 'Deadline wall; Δv bar over budget; constraint band',
  },
  {
    subject: 'grid',
    ground: 'bg',
    kind: 'graphic',
    where: 'Timeline track border, plan row borders',
  },
  {
    subject: 'grid',
    ground: 'bg-panel',
    kind: 'graphic',
    where: 'Node editor border, tooltip border',
  },
  // ── Region fills, whose edges carry the legibility ──────────────────────────
  {
    subject: 'hazard',
    ground: 'bg',
    kind: 'fill',
    where: 'The 100 km floor shell at rest, hatched',
    linedBy: "the hatch stroke, in apps/web's scene-derivation test",
  },
  {
    subject: 'earth',
    ground: 'bg',
    kind: 'fill',
    where: "Earth's disc against space",
    linedBy: "the limb and coastline, in apps/web's scene-derivation test",
  },
]);
