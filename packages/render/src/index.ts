/**
 * `@hh/render` — Canvas 2-D scene, camera, orbit tessellation, and hit-testing.
 *
 * **Layer: above the core.** May depend on the core packages; the core may never depend on
 * this one. Dependencies point one way: render → game → sim.
 *
 * See `docs/PRODUCT.md` §11.1 (architecture and the layering rule) and §11.2
 * (package responsibilities).
 */

/** Package identity. Placeholder until this package holds real code. */
export const PACKAGE = '@hh/render' as const;
