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

  // ── No literal user-facing text in JSX (NFR-028) ───────────────────────────
  //
  // FR-910: every user-facing string comes from the message catalogue in `@hh/ui`;
  // none is built by concatenation. NFR-028 names the enforcement: "ESLint rule
  // against literal JSX text". This is it.
  //
  // ## Why `no-restricted-syntax` and not `eslint-plugin-react`
  //
  // `react/jsx-no-literals` does this job, and pulling in a React plugin to lint a
  // Preact application means a dependency whose rule set is mostly about a framework
  // this repo does not use. Two esquery selectors cover it, using the same mechanism
  // the `acos` ban already runs on -- and `tools/guardrails/guardrails.test.ts`
  // demonstrates each of them firing, and each of the legitimate constructs below
  // staying silent, which is what #88 asks for before the rule lands.
  //
  // ## What is caught, and what is deliberately not
  //
  //   <p>Hello</p>            caught -- JSXText with a non-space character
  //   <p>{'Hello'}</p>        caught -- a string literal is text wherever it is written
  //   <nav aria-label="x" />  caught -- read aloud by a screen reader, so it is a string
  //   <img alt="Earth" />     caught -- likewise
  //
  //   <p>{label}</p>          silent -- an expression is where a resolved key arrives
  //   {' '}                   silent -- JSX spacing, not a word
  //   <h2 id="route-heading"> silent -- an identifier, never rendered
  //   <a href={hrefFor(p)}>   silent -- likewise
  //
  // Whitespace-only `JSXText` is silent because it is how JSX is indented. The
  // attribute list is the set of attributes that reach a person: everything else --
  // `id`, `href`, `class`, `data-*`, `type` -- is machinery.
  {
    files: ['apps/web/**/*.tsx', 'packages/ui/**/*.tsx'],
    // The M1 spike is throwaway and is deleted whole when the planner replaces it
    // (#238, PR 5 of M2). Its readout is a measurement instrument rather than a
    // screen, and translating a number that exists to be read off a stopwatch would
    // be ceremony with no reader. Deleting the directory deletes this line with it.
    ignores: ['apps/web/src/spike/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
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
      ],
    },
  },

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
