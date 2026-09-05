import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

export default defineConfig([
  // `tools/reference/.venv/` is the Python environment for the offline
  // reference-fixture generator. It is gitignored, but ESLint walks the working tree
  // rather than the index, and a JupyterLab extension bundled with `plotly` ships
  // minified `.js` that no tsconfig covers -- so without this the lint run fails on
  // files that are not ours and are not committed.
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    'tools/reference/.venv/**',
    // Generated from `packages/game/src/scenario/scenario-1.schema.json` by
    // `pnpm schema:write`, and gated by `pnpm schema:check`. Ajv's standalone output
    // is machine-written JavaScript that no tsconfig covers, so type-aware linting
    // cannot place it in a project at all; and linting a generated file asks the
    // author to satisfy a style guide they never read.
    'packages/game/src/scenario/*.generated.*',
  ]),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // This file is outside tsconfig's `include`, so the project service has
          // to be told about it explicitly before it can type-aware lint it.
          allowDefaultProject: ['eslint.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // CommonJS config files: no type-aware linting, and CommonJS globals.
  {
    files: ['**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'writable',
        exports: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },

  // Build tooling that runs under Node and sits outside every tsconfig: the size
  // budgets and the scripts that resolve and report them. Type-aware linting needs
  // a project to place a file in, and adding these to `allowDefaultProject` would
  // put untyped tooling through the `strictTypeChecked` rule set for no gain.
  {
    files: ['.size-limit.js', 'tools/**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        // `fetch` is a Node global with no importable form, and one tool genuinely
        // needs it: tools/coastlines/process.mjs pulls the pinned Natural Earth
        // release. Everything else Node-specific is imported by name -- `Buffer`
        // from `node:buffer` in that same file -- so this is the only global the
        // block has had to gain, and it is not reachable from packages/**.
        fetch: 'readonly',
      },
    },
  },

  // The browser application: DOM globals are expected here, and JSX needs parsing.
  // The core guardrail block below still applies to `packages/**` only, so nothing
  // in the simulation gains access to the DOM by way of this.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        // `projectService` is deliberately NOT set again here. typescript-eslint
        // builds one project service for the whole run, so a second declaration
        // wins over the first and silently drops its `allowDefaultProject` — which
        // then makes this very file unlintable. The service already discovers
        // apps/web/tsconfig.json on its own.
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        fetch: 'readonly',
        performance: 'readonly',
        HTMLElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        Element: 'readonly',
        Event: 'readonly',
        PointerEvent: 'readonly',
        URLSearchParams: 'readonly',
        console: 'readonly',
      },
    },
  },

  // ── A parameter that exists for its type ───────────────────────────────────
  //
  // `typescript-eslint`'s default is `args: 'after-used'`, which reports a trailing
  // parameter nobody reads. That is the right default and stays on; this adds the
  // `_`-prefix escape it ships without.
  //
  // The planner's state machine is what needs it. §8.5.1's edges are one function per
  // transition, and each takes the state it legally leaves *purely so that the wrong
  // call does not compile* — `cancelPlacement(state: PlacingState)` reads nothing out of
  // its argument, because there is nothing in a placement worth carrying into IDLE. The
  // parameter is the guarantee, and #143's "illegal transitions are impossible by
  // construction" is exactly that guarantee, so deleting it to satisfy the linter would
  // delete the acceptance criterion.
  //
  // Deliberately narrow: `args` only. An unused *variable*, an unused import and an
  // unused caught error are all still errors, because none of them can be load-bearing
  // the way a type-gating parameter is.
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'after-used', argsIgnorePattern: '^_' },
      ],
    },
  },

  // ── `no-restricted-syntax`: two rules, one ESLint rule name ────────────────
  //
  // FR-910/NFR-028 bans literal user-facing text in JSX. FR-907/NFR-018 bans colour
  // literals outside the palette. Both are expressed as `no-restricted-syntax`, and in a
  // flat config **the last matching entry for a rule replaces the earlier one** rather
  // than adding to it. Declaring them as two overlapping blocks silently switched the
  // first one off for every `.tsx` under `apps/web` — which is exactly what
  // `tools/guardrails/guardrails.test.ts` caught, and the reason that suite exists.
  //
  // So the selectors are named here and the blocks below compose them over file sets
  // that **do not overlap**. Adding a third rule means adding a list and deciding which
  // sets get it, not appending another block and hoping.

  ...(() => {
    const JSX_TEXT = [
      {
        selector: 'JSXText[value=/[^\\s]/]',
        message:
          'User-facing text belongs in the message catalogue in @hh/ui, not in JSX. ' +
          "Resolve a key instead: {t('app.title')}. See docs/PRODUCT.md FR-910 (NFR-028).",
      },
      {
        selector: 'JSXExpressionContainer > Literal[value=/[^\\s]/]',
        message:
          'A string literal in JSX is still literal text. Resolve a catalogue key ' +
          'instead. See docs/PRODUCT.md FR-910 (NFR-028).',
      },
      {
        selector:
          'JSXAttribute[name.name=/^(aria-label|aria-description|aria-placeholder|aria-roledescription|aria-valuetext|alt|title|placeholder)$/] > Literal',
        message:
          'This attribute is read out to the player, so it is a user-facing string. ' +
          'Resolve a catalogue key instead. See docs/PRODUCT.md FR-910 (NFR-028).',
      },
    ];

    const COLOUR = [
      {
        // `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` -- CSS's four hex forms, and the
        // only ones the palette's own parser accepts.
        selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]',
        message:
          "A colour belongs in @hh/ui's palette module, not in a component. " +
          'Read a token instead — see docs/PRODUCT.md §9.2 (FR-907, NFR-018).',
      },
      {
        // The functional notations, which a template or a concatenation would reach
        // for. Anchored at the start so a sentence mentioning `rgb` is not a colour.
        selector: 'Literal[value=/^(?:rgba?|hsla?|color-mix|oklch|oklab|lab|lch)\\(/]',
        message:
          "A colour belongs in @hh/ui's palette module, not in a component. " +
          'Read a token instead — see docs/PRODUCT.md §9.2 (FR-907, NFR-018).',
      },
    ];

    // The application and `@hh/ui`, minus the two exemptions each rule carries.
    //
    // The scene harness is exempt from the text rule — its controls are named after the
    // thing they vary, they are never addressed to a player, and it is deleted whole when
    // it has served its purpose — but **not** from the colour rule: it draws the scene, so
    // it is the last place a stale palette should be allowed to hide.
    //
    // Tests are exempt from the colour rule, because a test has to be able to name a
    // colour to assert anything about one, and not from the text rule, which is why the
    // icon test's label is a variable.
    const SOURCE = ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'];
    const HARNESS = 'apps/web/src/scene-harness/**';
    const TESTS = '**/*.test.{ts,tsx}';
    const PALETTE = 'packages/ui/src/palette/**';

    return [
      {
        // Everything that gets both.
        files: SOURCE,
        ignores: [HARNESS, TESTS, PALETTE],
        rules: { 'no-restricted-syntax': ['error', ...JSX_TEXT, ...COLOUR] },
      },
      {
        // The harness: colours only.
        files: [`${HARNESS}/*.{ts,tsx}`],
        rules: { 'no-restricted-syntax': ['error', ...COLOUR] },
      },
      {
        // Tests: text only.
        files: ['apps/web/**/*.test.tsx', 'packages/ui/**/*.test.tsx'],
        rules: { 'no-restricted-syntax': ['error', ...JSX_TEXT] },
      },
      {
        // The palette module declares the values, so it gets neither.
        files: [`${PALETTE}/*.{ts,tsx}`],
        rules: { 'no-restricted-syntax': 'off' },
      },
    ];
  })(),

  // ── Core determinism and portability guardrails ────────────────────────────
  //
  // NFR-005: the core references no browser or Node globals.
  // NFR-006: `acos` on a dot product appears nowhere; use `atan2`, which knows the
  //          quadrant. `acos` also loses precision badly near +/-1, which is exactly
  //          where nearly-parallel vectors land.
  // NFR-008: no ambient nondeterminism. Every random number comes from the seeded
  //          PRNG threaded through the simulation, and simulation time never comes
  //          from the wall clock.
  //
  // Applies to the four core packages and to `game`, per NFR-008's package list.
  // `render` and `ui` are exempt: the DOM is their job.
  {
    files: ['packages/{math,astro,propagation,sim,game}/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...[
          'document',
          'window',
          'self',
          'navigator',
          'localStorage',
          'sessionStorage',
          'fetch',
          'XMLHttpRequest',
          'WebSocket',
          'process',
          'performance',
        ].map((name) => ({
          name,
          message:
            `\`${name}\` is not available to this layer. The simulation core runs unchanged ` +
            'under Node, a browser and a Cloudflare Worker, and must stay free of host globals. ' +
            'See docs/PRODUCT.md §11.1 (NFR-005).',
        })),
      ],

      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'Use the seeded PRNG from @hh/math instead. Same seed plus same inputs must give ' +
            'the same trajectory on every platform. See docs/PRODUCT.md §11.4 (NFR-008).',
        },
        {
          object: 'Date',
          property: 'now',
          message:
            'Simulation time is never wall-clock time. Use the epoch threaded through the ' +
            'simulation. See docs/PRODUCT.md §7.2 (NFR-008).',
        },
        {
          object: 'Math',
          property: 'acos',
          message:
            'Use atan2 for anything where the quadrant matters. acos on a dot product cannot ' +
            'recover the sign and loses precision near +/-1. See docs/PRODUCT.md §7.2 (NFR-006).',
        },
      ],

      'no-restricted-syntax': [
        'error',
        {
          // Catches a locally imported or destructured `acos`, which the
          // `Math.acos` property rule above cannot see.
          selector: "CallExpression[callee.name='acos']",
          message:
            'Use atan2 for anything where the quadrant matters. See docs/PRODUCT.md §7.2 (NFR-006).',
        },
        {
          // `new Date()` with no arguments reads the wall clock.
          selector: 'NewExpression[callee.name="Date"][arguments.length=0]',
          message:
            'new Date() reads the wall clock. Simulation time comes from the epoch threaded ' +
            'through the simulation. See docs/PRODUCT.md §11.4 (NFR-008).',
        },
      ],
    },
  },

  // Prettier owns formatting. Keep this last so it wins over any stylistic rule.
  prettier,
]);
