import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Split into projects because `apps/web` needs a DOM and the simulation
    // packages must not have one. This was deliberately deferred when the toolchain
    // landed — nothing needed a different environment then, and one config was
    // simpler. The browser app is the first thing that does.
    projects: [
      {
        test: {
          name: 'packages',
          environment: 'node',
          include: ['packages/*/src/**/*.test.ts'],
          // `*.dom.test.ts` belongs to the `render-dom` project below. Excluded by
          // name rather than by directory so that the DOM-needing tests sit beside
          // the code they cover, and so that a file which acquires a DOM dependency
          // has to be renamed — a visible act — rather than quietly moved.
          exclude: ['packages/*/src/**/*.dom.test.ts'],
        },
      },
      {
        // The browser-environment testing story NFR-022 names as the condition for
        // `@hh/render` joining the coverage gate.
        //
        // Only `@hh/render` gets this, and only for files named `*.dom.test.ts`. The
        // simulation core is tested under Node precisely because it must not depend on
        // a browser, and widening this glob to `packages/*` would quietly remove the
        // thing that makes that guarantee checkable. Two modules need it: the DOM label
        // layer (D8), which is DOM by definition, and nothing else — `canvas2d.ts` is
        // tested with a recording double under Node, on purpose, because drawing to a
        // jsdom canvas would test jsdom's canvas stub instead of the renderer.
        test: {
          name: 'render-dom',
          environment: 'jsdom',
          include: ['packages/render/src/**/*.dom.test.ts'],
        },
      },
      {
        test: {
          name: 'guardrails',
          environment: 'node',
          include: ['tools/guardrails/**/*.test.ts'],
        },
      },
      {
        // Performance budgets from docs/PRODUCT.md §11.9. These live under `tools/`
        // rather than beside the code they measure because measuring needs a clock,
        // and `performance` is banned in `packages/**` by the core guardrail block —
        // correctly, since the simulation must never read one. The benchmark is not
        // the simulation.
        //
        // **Excluded from `pnpm coverage`** (`vitest run --project !bench`), for two
        // reasons that point the same way. V8 coverage instruments every function,
        // which slows the code under measurement by roughly a factor of four — so a
        // budget asserted under coverage is measuring the profiler, and the
        // ground-station search's 3.3 ms becomes 13.9 ms and trips an 8 ms limit that
        // nothing about the code has broken. And a line reached only by a benchmark
        // is *timed*, not tested; counting it as covered would overstate the number
        // the NFR-022 gate exists to keep honest.
        test: {
          name: 'bench',
          environment: 'node',
          include: ['tools/bench/**/*.test.ts'],
          // One benchmark at a time. Vitest runs test files in parallel by default,
          // which for these means four files competing for the same cores while each
          // one tries to measure how long an operation takes — the numbers then
          // describe the scheduler as much as the code. It matters more now than it
          // did: `tools/bench/compare.mjs` gates on these numbers against a committed
          // baseline, and a gate is only as good as the measurement under it.
          fileParallelism: false,
        },
      },
      {
        // Golden trajectories (§7.6 Tier 4). Their own project so `pnpm goldens:write`
        // can run exactly this file — regenerating the fixtures is a deliberate act and
        // should not mean running the whole suite. They stay inside `pnpm coverage`,
        // unlike `bench`: they exercise the real evaluation path and the lines they
        // reach are genuinely tested rather than merely timed.
        test: {
          name: 'goldens',
          environment: 'node',
          include: ['tools/goldens/**/*.test.ts'],
        },
      },
      {
        // Tier 3 external-library fixtures (#55). Its own project so
        // `pnpm reference:write` -- which regenerates the committed fixture through
        // Python -- is a separate, deliberate act from running the suite, the same
        // arrangement `goldens` has and for the same reason.
        //
        // Under `tools/` rather than beside the code it checks because it reads a
        // file, and `process`/`node:fs` are banned in `packages/**` by the core
        // guardrail block. **This project never invokes Python**: the fixture is
        // committed and this reads it like any other data file.
        test: {
          name: 'reference',
          environment: 'node',
          include: ['tools/reference/**/*.test.ts'],
        },
      },
      {
        // The in-process determinism fuzz (FR-109). Its own project for the same
        // reason, and because its iteration count is worth being able to raise on its
        // own — see `tools/fuzz/determinism.fuzz.test.ts`.
        test: {
          name: 'fuzz',
          environment: 'node',
          include: ['tools/fuzz/**/*.test.ts'],
        },
      },
      {
        // §13.4's seven checks, applied to every contract in `content/contracts/`
        // (#87). Under `tools/` rather than beside `@hh/game` because it reads a
        // directory, and `node:fs` has no place in a package that must run in a
        // browser and a Worker — the same reason `reference` is here.
        //
        // These only ever *replay* a stored reference solution, so the suite stays
        // fast however many contracts ship. Computing par is the other project.
        test: {
          name: 'content',
          environment: 'node',
          // The par solver's own unit tests belong here rather than in `pars`: they are
          // pure arithmetic on known functions, they cost milliseconds, and gating them
          // behind a project that is excluded from `test:all` would leave the refinement
          // the whole search depends on unexercised by the suite people actually run.
          // Only the search *driver* is expensive, and it is named directly below.
          include: ['tools/{content,pars}/**/*.test.ts'],
          exclude: ['tools/pars/pars.test.ts'],
        },
      },
      {
        // The par solver (#89). Its own project so `pnpm pars:write` can run exactly
        // this file — recomputing a published par is a deliberate act, the same
        // arrangement `goldens` and `reference` have.
        //
        // Excluded from `test:all` by `pnpm test:all`'s project filter and run as its
        // own CI step (`pnpm pars:check`), because it is a search rather than an
        // assertion: it costs seconds where every other project costs milliseconds,
        // and it gates the same thing either way.
        //
        // It does still run under `pnpm coverage`, which excludes only `bench`. That is
        // not an oversight: **Vitest's repeated `--project` negations OR together**, so
        // `--project !bench --project !pars` matches every project — `bench` is not
        // `pars`, so the second filter admits it — and a brace glob is not matched
        // either. A second exclusion is therefore not expressible, and letting the
        // search run under coverage costs a few seconds and asserts nothing about time.
        // Letting `bench` run under coverage would be the real damage: V8 instruments
        // every function, and the block above records what that does to a budget.
        test: {
          name: 'pars',
          environment: 'node',
          include: ['tools/pars/pars.test.ts'],
        },
      },
      {
        test: {
          name: 'web',
          // The simulation core is tested under node precisely because it must not
          // depend on a browser. Only the app gets jsdom.
          environment: 'jsdom',
          include: ['apps/web/src/**/*.test.{ts,tsx}'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // NFR-022's condition for `render` was "once it holds code and has a
      // browser-environment testing story". Both became true when the orbit scene and
      // the `render-dom` project landed, so it joins the gate here. `ui` has not: it
      // holds only the message catalogue and has no browser tests yet. `apps/web` is a
      // composition layer and is covered by its own tests, not by this gate.
      include: ['packages/{math,astro,propagation,sim,game,render}/src/**/*.ts'],
      // `test-support.ts` is a fixture module for this package's tests: not exported
      // from any barrel and not reachable from source. Counting it would inflate the
      // number the NFR-022 gate exists to keep honest, for the same reason the tests
      // themselves are excluded.
      exclude: ['**/*.test.ts', '**/test-support.ts'],
      thresholds: {
        // NFR-022: >=90% statements in the core packages.
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
        // NFR-022: >=70% in the game layer.
        'packages/game/src/**': {
          statements: 70,
          branches: 60,
          functions: 70,
          lines: 70,
        },
        // NFR-022 sets no number for `render`, because it was written before the package
        // held code. It gets the **core's** bar rather than the game layer's, and that is
        // a correction rather than an ambition: the first draft of this block set 70 on
        // the theory that browser wiring — a context that fails to acquire, a media query
        // that re-arms, a `ResizeObserver` teardown — would have last-few-percent branches
        // too expensive to fake. Measured, the package comes in at 96% statements and 87%
        // branches, because those seams take structural types and a test can drive them
        // with a plain object instead of a browser. A gate twenty-six points below the
        // real number is not a gate; it would let a genuine regression through in silence.
        'packages/render/src/**': {
          statements: 90,
          branches: 80,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
});
