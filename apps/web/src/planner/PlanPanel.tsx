/**
 * §8.3.4's region ③ — the maneuver plan. #130, FR-405.
 *
 * > *An ordered node list, each entry expandable to a numeric editor, rendered as a
 * > **DOM list and keyboard navigable**.*
 *
 * The emphasis is §8.3.4's own. This is the region that makes the planner operable
 * without a canvas at all: every node in the plan has a row here, and everything a
 * pointer can do to a node marker can be done from the row.
 *
 * ## A real `<ul>`, and why that is the requirement rather than an implementation choice
 *
 * A list is what a screen reader announces as "list, 2 items", which tells a player how
 * many burns they have before reading any of them. A stack of `<div>`s with
 * `role="listitem"` would render identically and say nothing. So: `<ul>`, `<li>`, and the
 * controls inside each row are ordinary buttons, which is what makes Tab, Enter and Space
 * work without a key handler in this file.
 *
 * ## The announced name is not the visible text
 *
 * #130's last criterion: each node's epoch and Δv are *"announced meaningfully rather than
 * as bare numbers"*. On screen a row is a table — `1  T+00:04:12` above `prograde −36.2` —
 * which is the right density for the eye and is meaningless read aloud in order. So the
 * row carries `planner.plan.nodeLabel`, a sentence built in the catalogue where the sign
 * becomes a direction ("36.2 metres per second retrograde") and a zero component is
 * dropped rather than announced.
 *
 * That is why the visible cells are `aria-hidden`: without it a screen reader would read
 * the sentence and then the fragments it was built from.
 *
 * ## Selection is synchronised both ways, and neither direction is this file's to own
 *
 * #130's fourth criterion. The row's pressed state comes from the selected index and its
 * click calls `onSelect`; the orbit view does the same against the same state. Both are
 * views of `activeNodeId`, so there is no synchronisation code anywhere — which is the
 * only way two views cannot drift apart.
 */
import { metAt, type Epoch } from '@hh/astro';
import { fromDeltaVCounts, type Plan } from '@hh/sim';
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';

import { Icon } from '../icons/index.js';

export interface PlanPanelProps {
  readonly t: Catalogue['resolve'];
  readonly plan: Plan;
  readonly startEpoch: Epoch;
  readonly selectedIndex: number | null;
  /**
   * Which apsis each node is sitting on, parallel to `plan.nodes` — DEP-07 made visible
   * (#136).
   *
   * `null` for a node that is not on one, which on the near-circular orbits every Act I
   * contract opens with is every node. Derived by the caller because deciding it means
   * asking where the arc's apsides are, which needs the timeline — the same division of
   * labour `NodeEditor`'s `snappedTo` already uses.
   */
  readonly snappedKinds: readonly ('periapsis' | 'apoapsis' | null)[];
  /**
   * The live value of a gesture in flight, for the node being dragged — #263, #134, #135.
   *
   * The plan is deliberately not mutated until the drag is released (FR-105), which is what
   * makes `Escape` a no-op rather than an undo. So a panel rendering `plan` alone shows the
   * pre-drag numbers for the whole gesture and jumps on release — and #263's first criterion
   * is explicit that *"the plan panel and the orbit view both follow the pointer during the
   * gesture rather than only on release"*.
   *
   * The orbit view already had its live picture through `preview`; this is the same value
   * reaching the DOM half, which is the half §8.8's canvas-parity rule cares about. `null`
   * whenever nothing is being dragged.
   */
  readonly dragging: {
    readonly index: number;
    readonly metSeconds: number;
    readonly progradeMps: number;
    readonly radialMps: number;
  } | null;
  readonly onSelect: (index: number) => void;
  readonly onDelete: (index: number) => void;
  readonly onExpand: (index: number) => void;
  /** §8.5.2's context menu, opened from the row — the pointer-free route to it (#136). */
  readonly onOpenMenu: (index: number) => void;
  readonly onAdd: () => void;
}

export const PlanPanel = ({
  t,
  plan,
  startEpoch,
  selectedIndex,
  snappedKinds,
  dragging,
  onSelect,
  onDelete,
  onExpand,
  onOpenMenu,
  onAdd,
}: PlanPanelProps): JSX.Element => (
  <section class="hh-plan" data-testid="plan-panel">
    <h2 class="hh-panel__heading">{t('planner.plan.heading', {})}</h2>

    {plan.nodes.length === 0 ? (
      <p class="hh-plan__empty" data-testid="plan-empty">
        {t('planner.plan.empty', {})}
      </p>
    ) : (
      <ul
        class="hh-plan__list"
        aria-label={t('planner.plan.listLabel', { count: plan.nodes.length })}
      >
        {plan.nodes.map((node, index) => {
          // Counts to metres per second at the boundary, which is here. RTN order is
          // (radial, transverse, normal) and DEP-10 calls the transverse one "prograde" —
          // the naming departure lives in the catalogue, so this only has to pick the
          // right index and not re-argue the name.
          // The gesture's live values for the node being dragged, the plan's for every
          // other node and whenever nothing is in flight.
          const live = dragging !== null && dragging.index === index ? dragging : null;
          const radialMps = live?.radialMps ?? fromDeltaVCounts(node.deltaVCounts[0]);
          const progradeMps = live?.progradeMps ?? fromDeltaVCounts(node.deltaVCounts[1]);
          const metSeconds = live?.metSeconds ?? metAt(startEpoch, node.epoch);
          const selected = selectedIndex === index;
          const snappedTo = snappedKinds[index] ?? null;

          return (
            <li
              key={node.epochTicks}
              class="hh-plan__row"
              data-selected={selected}
              data-snapped={snappedTo ?? 'none'}
            >
              <button
                type="button"
                class="hh-plan__select"
                aria-pressed={selected}
                data-testid={`plan-node-${String(index)}`}
                onClick={() => {
                  onSelect(index);
                }}
              >
                {/* The sentence a screen reader gets. See the docstring. */}
                <span class="hh-sr-only">
                  {t('planner.plan.nodeLabel', {
                    index: index + 1,
                    metSeconds,
                    progradeMps,
                    radialMps,
                  })}
                  {/* Spoken as part of the row's sentence rather than as a separate
                      element, so a screen reader gets "burn 1 at T+00:04:12 ... snapped to
                      apoapsis" in one utterance instead of two. */}
                  {snappedTo === null
                    ? null
                    : ` ${t('planner.plan.snappedTo', { kind: snappedTo })}`}
                </span>
                <span class="hh-plan__epoch" aria-hidden="true">
                  {t('planner.plan.nodeEpoch', { index: index + 1, metSeconds })}
                  {/* DEP-07's visible half. The glyph is `aria-hidden` with the rest of
                      the visible cells because the sentence above already says it — and
                      it carries a `title` so a pointer user who has not met the mark can
                      find out what it means without leaving the planner. */}
                  {snappedTo === null ? null : (
                    <span
                      class="hh-plan__snapped"
                      data-testid={`plan-snapped-${String(index)}`}
                      data-kind={snappedTo}
                      title={t('planner.plan.snappedTo', { kind: snappedTo })}
                    >
                      {snappedTo === 'periapsis' ? '⌄' : '⌃'}
                    </span>
                  )}
                </span>
                <span class="hh-plan__components" aria-hidden="true">
                  <span>{t('planner.plan.prograde', { mps: progradeMps })}</span>
                  <span>{t('planner.plan.radial', { mps: radialMps })}</span>
                </span>
              </button>

              <span class="hh-plan__controls">
                <button
                  type="button"
                  class="hh-plan__control"
                  data-testid={`plan-delete-${String(index)}`}
                  onClick={() => {
                    onDelete(index);
                  }}
                >
                  <Icon name="delete" label={t('planner.plan.delete', { index: index + 1 })} />
                </button>
                <button
                  type="button"
                  class="hh-plan__control"
                  data-testid={`plan-menu-${String(index)}`}
                  onClick={() => {
                    onOpenMenu(index);
                  }}
                >
                  <Icon name="more" label={t('planner.nodeMenu.open', { index: index + 1 })} />
                </button>
                <button
                  type="button"
                  class="hh-plan__control"
                  data-testid={`plan-expand-${String(index)}`}
                  onClick={() => {
                    onExpand(index);
                  }}
                >
                  <Icon name="expand" label={t('planner.plan.expand', { index: index + 1 })} />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    )}

    <button type="button" class="hh-plan__add" data-testid="plan-add" onClick={onAdd}>
      {t('planner.plan.addNode', {})}
    </button>
  </section>
);
