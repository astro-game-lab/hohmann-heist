/**
 * `@hh/ui` — Preact components, panels, message catalogue, palettes, and accessibility utilities.
 *
 * **Layer: above the core.** May depend on the core packages; the core may never depend on
 * this one. Dependencies point one way: render → game → sim.
 *
 * See `docs/PRODUCT.md` §11.1 (architecture and the layering rule) and §11.2
 * (package responsibilities).
 *
 * The message catalogue is the first thing here, and it is deliberately first: NFR-028's
 * lint rule refuses literal text in JSX, so no component can be written until there is
 * somewhere for its words to live.
 */

/** Package identity. */
export const PACKAGE = '@hh/ui' as const;

export * from './catalogue/index.js';
export * from './palette/index.js';
export * from './planner/index.js';
export * from './execution/index.js';
export * from './debrief/index.js';
