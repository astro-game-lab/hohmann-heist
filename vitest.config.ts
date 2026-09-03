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
      // Gated packages only. `render` and `ui` join once they hold code and have a
      // browser-environment testing story — see docs/PRODUCT.md NFR-022. `apps/web`
      // is a composition layer and is covered by its own tests, not by this gate.
      include: ['packages/{math,astro,propagation,sim,game}/src/**/*.ts'],
      exclude: ['**/*.test.ts'],
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
      },
    },
  },
});
