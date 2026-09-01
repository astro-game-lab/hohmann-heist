/**
 * Layering rules for the architecture in docs/PRODUCT.md §11.1.
 *
 * This overlaps pnpm's link-time enforcement on purpose. pnpm refuses to resolve a
 * package a workspace member has not declared; dependency-cruiser catches the two
 * cases pnpm cannot:
 *
 *   1. a *declared* but illegal dependency — someone "fixes" a resolution error by
 *      adding the dependency to package.json rather than by not importing it;
 *   2. a deep relative import that sidesteps the package boundary entirely, e.g.
 *      `../../game/src/index.js` from inside `@hh/math`.
 *
 * See NFR-005.
 */

/** Packages that make up the simulation core, innermost first. */
const CORE = ['math', 'astro', 'propagation', 'sim'];
/** Everything above the core. The core may never depend on any of these. */
const ABOVE_CORE = ['game', 'render', 'ui'];

const pkg = (names) => `^packages/(${names.join('|')})/`;

/** The core is a strict stack: each layer may only reach the ones below it. */
const coreOrderRules = CORE.slice(1)
  .map((name, index) => ({
    name,
    allowedBelow: CORE.slice(0, index + 1),
    forbiddenBelow: CORE.slice(index + 2),
  }))
  // The innermost layer has nothing below it to forbid.
  .filter(({ forbiddenBelow }) => forbiddenBelow.length > 0)
  .map(({ name, allowedBelow, forbiddenBelow }) => ({
    name: `core-order-${name}`,
    comment:
      `@hh/${name} may depend on ${allowedBelow.map((p) => `@hh/${p}`).join(', ')} ` +
      `but not on ${forbiddenBelow.map((p) => `@hh/${p}`).join(', ')}. See §11.1.`,
    severity: 'error',
    from: { path: `^packages/${name}/` },
    to: { path: pkg(forbiddenBelow) },
  }));

module.exports = {
  forbidden: [
    {
      name: 'no-core-to-upper',
      comment:
        'The simulation core must not import from the game, render or UI layers, ' +
        'or from an app. Dependencies point one way: render → game → sim. See §11.1.',
      severity: 'error',
      from: { path: pkg(CORE) },
      to: { path: `(${pkg(ABOVE_CORE)}|^apps/|^services/)` },
    },
    ...coreOrderRules,
    {
      name: 'no-circular',
      comment: 'Circular dependencies make the layering unanalysable and the build fragile.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-dev-dep',
      comment: 'Runtime code must not import a devDependency.',
      severity: 'error',
      from: { path: '^packages/', pathNot: '\\.test\\.ts$' },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: 'node_modules|/dist/|/coverage/' },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
