/**
 * The planner's DOM-free logic — §8.5.1's state machine and the readouts' unit boundary.
 *
 * What is here and what is not follows one line: this package sits in the root
 * TypeScript project, which has no DOM library, so everything reachable from this barrel
 * is checked to run under Node. That is what makes #143's *"testable headlessly, without
 * a canvas"* a property of the build rather than a claim in a docstring.
 *
 * The planner's Preact regions are therefore **not** here — they live in
 * `apps/web/src/planner/`, because they need a DOM and because §8.3.4's five regions have
 * exactly one consumer. §11.2 puts panels in this package, and they belong here once a
 * second screen wants one; moving them means giving `@hh/ui` its own DOM tsconfig the way
 * `@hh/render` has one, which is a workspace change rather than a file move and did not
 * belong inside the planner's own pull request.
 */
export type {
  CommittableLegality,
  Drag,
  DeltaVDrag,
  EpochDrag,
  HandleAxis,
  Interaction,
  CommittedState,
  DraggingState,
  EvaluatedState,
  IdleState,
  NodeId,
  Placement,
  PlacingState,
  PlannerModel,
  ScrubState,
  SelectedState,
} from './machine.js';
export {
  IDLE,
  activeNodeId,
  beginDrag,
  beginPlacement,
  cancelDrag,
  cancelPlacement,
  commit,
  commitPlacement,
  createModel,
  deselect,
  evaluated,
  isCommittable,
  isDragging,
  movePlacement,
  releaseDrag,
  scrubTo,
  select,
  setScrubbing,
  updateDeltaVDrag,
  updateEpochDrag,
} from './machine.js';

export type { ApproachReadout, OrbitReadout } from './readouts.js';
export { approachReadout, orbitReadout } from './readouts.js';
