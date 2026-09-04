/**
 * Tests for the guardrails themselves.
 *
 * NFR-005, NFR-006 and NFR-008 are blocking requirements, and a blocking check that
 * has silently stopped working is worse than no check — it buys false confidence.
 * These tests assert that each rule still fires on the construct it exists to catch.
 *
 * The ESLint cases lint *text* against a real file path, so they exercise the actual
 * `eslint.config.js` and its per-package globs rather than a reconstruction of them.
 */
import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { ESLint } from 'eslint';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

/** Call the binary directly; going through `pnpm exec` costs seconds per call. */
const DEPCRUISE = path.join('node_modules', '.bin', 'depcruise');
const cruise = async (): Promise<string> => (await execFileAsync(DEPCRUISE, ['packages'])).stdout;

const CORE_FILE = 'packages/math/src/index.ts';
const RENDER_FILE = 'packages/render/src/index.ts';

const eslint = new ESLint();

async function ruleIdsFor(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? '(fatal)');
}

describe('core guardrails (NFR-006, NFR-008)', () => {
  // The first lint builds the whole type-aware program, which takes tens of
  // seconds. Pay it once here rather than charging it to whichever case runs first.
  //
  // Both programs, not one. `packages/render` compiles against its own tsconfig -- it
  // needs the DOM library and the root project deliberately has none -- so linting a
  // file there builds a second program from scratch. Warming only the core one left
  // that cost falling on the first render case, which is a five-second timeout rather
  // than anything to do with the rule under test.
  beforeAll(async () => {
    await ruleIdsFor('export const warmup = 1;\n', CORE_FILE);
    await ruleIdsFor('export const warmup = 1;\n', RENDER_FILE);
  }, 180_000);

  const cases: readonly (readonly [label: string, code: string, rule: string])[] = [
    ['Math.random', 'export const x = Math.random();\n', 'no-restricted-properties'],
    ['Date.now', 'export const x = Date.now();\n', 'no-restricted-properties'],
    ['Math.acos', 'export const x = Math.acos(0.5);\n', 'no-restricted-properties'],
    [
      'bare acos()',
      'declare function acos(n: number): number;\nexport const x = acos(0.5);\n',
      'no-restricted-syntax',
    ],
    ['new Date()', 'export const x = new Date();\n', 'no-restricted-syntax'],
    ['document', 'export const x = document.title;\n', 'no-restricted-globals'],
    ['window', 'export const x = window.name;\n', 'no-restricted-globals'],
    ['process', 'export const x = process.platform;\n', 'no-restricted-globals'],
    ['fetch', 'export const x = fetch;\n', 'no-restricted-globals'],
    ['performance.now', 'export const x = performance.now();\n', 'no-restricted-globals'],
  ];

  it.each(cases)(
    'rejects %s in a core package',
    async (_label, code, rule) => {
      expect(await ruleIdsFor(code, CORE_FILE)).toContain(rule);
    },
    60_000,
  );

  it('allows the DOM in the render layer, which is its job', async () => {
    const ids = await ruleIdsFor('export const x = document.title;\n', RENDER_FILE);
    expect(ids).not.toContain('no-restricted-globals');
  });

  it('does not fire on clean core code', async () => {
    const clean = 'export const angle = Math.atan2(1, 2);\n';
    const ids = await ruleIdsFor(clean, CORE_FILE);
    expect(ids).toEqual([]);
  });
});

describe('layering rule (NFR-005)', () => {
  // A deep relative import resolves on the filesystem, so pnpm's link-time check
  // cannot see it. This is precisely the gap dependency-cruiser exists to close.
  const dir = 'packages/math/src/__guardrail__';
  const file = `${dir}/upward-import.ts`;

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects a deep relative import from the core into the game layer', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(
      file,
      "import { PACKAGE } from '../../../game/src/index.js';\nexport const leak = PACKAGE;\n",
      'utf8',
    );

    await expect(cruise()).rejects.toMatchObject({
      stdout: expect.stringContaining('no-core-to-upper') as unknown as string,
    });
  }, 60_000);

  it('passes on the real tree', async () => {
    expect(await cruise()).toContain('no dependency violations found');
  }, 60_000);
});

describe('the DOP853 oracle is unreachable from the game path (FR-009)', () => {
  // FR-009 permits a numerical integrator to exist and forbids using it to advance
  // game state. The prohibition is only real if it is enforced, and it is enforced
  // in two places because the two import routes fail differently: a deep relative
  // path resolves on the filesystem, and a subpath export resolves only once
  // dependency-cruiser is told to read `exports`. Both are checked here by
  // deliberate violation.
  const cases: readonly (readonly [label: string, dir: string, file: string, source: string])[] = [
    [
      'a subpath import from another package',
      'packages/sim/src/__guardrail__',
      'packages/sim/src/__guardrail__/oracle-leak.ts',
      "import { integrate } from '@hh/propagation/oracle';\nexport const leak = integrate;\n",
    ],
    [
      'a deep relative import from inside @hh/propagation',
      'packages/propagation/src/__guardrail__',
      'packages/propagation/src/__guardrail__/oracle-leak.ts',
      "import { integrate } from '../oracle/dop853.js';\nexport const leak = integrate;\n",
    ],
  ];

  afterEach(async () => {
    await rm('packages/sim/src/__guardrail__', { recursive: true, force: true });
    await rm('packages/propagation/src/__guardrail__', { recursive: true, force: true });
  });

  it.each(cases)(
    'rejects %s',
    async (_label, dir, file, source) => {
      await mkdir(dir, { recursive: true });
      await writeFile(file, source, 'utf8');

      await expect(cruise()).rejects.toMatchObject({
        stdout: expect.stringContaining('no-oracle-in-game-path') as unknown as string,
      });
    },
    60_000,
  );

  it('allows a test file to import it, which is the whole point', async () => {
    await mkdir('packages/sim/src/__guardrail__', { recursive: true });
    await writeFile(
      'packages/sim/src/__guardrail__/oracle-leak.test.ts',
      "import { integrate } from '@hh/propagation/oracle';\nexport const allowed = integrate;\n",
      'utf8',
    );

    expect(await cruise()).toContain('no dependency violations found');
  }, 60_000);
});

describe('development tooling never reaches shipped code (NFR-020)', () => {
  // #89 requires the par harness to be "a development tool: it is not in the app bundle
  // and does not count against NFR-020". Nothing imports it today, which is a fact about
  // this week rather than a property of the repository -- and `tools/` also holds the
  // golden generator, the benchmarks and this suite, none of which should ever be one
  // careless import away from the bundle. `no-tools-in-shipped-code` is that property;
  // this is the check on it.
  const dir = 'packages/game/src/__guardrail__';
  const file = `${dir}/tools-leak.ts`;

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects an import of the par solver from a package', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(
      file,
      "import { solvePar } from '../../../../tools/pars/solve.js';\nexport const leak = solvePar;\n",
      'utf8',
    );

    await expect(cruise()).rejects.toMatchObject({
      stdout: expect.stringContaining('no-tools-in-shipped-code') as unknown as string,
    });
  }, 60_000);
});

describe('the core compiles without the DOM library (NFR-005)', () => {
  // The lint rule above is one of two mechanisms, and it is the weaker one: it lists
  // globals by name, so it catches `document` and misses `CanvasRenderingContext2D`.
  // The other is that the root TypeScript project has no DOM library at all, which
  // makes any browser type a compile error in the core.
  //
  // That mechanism became easy to break silently when `packages/render` was given its
  // own tsconfig -- it draws on a canvas, so it genuinely needs the DOM -- because the
  // obvious way to give it one is to widen the root project for everyone. This checks
  // both halves of the split still hold.
  const TSC = path.join('node_modules', '.bin', 'tsc');
  const dir = 'packages/math/src/__guardrail__';
  const file = `${dir}/dom-type.ts`;

  const typecheck = (project: string): Promise<{ stdout: string }> =>
    execFileAsync(TSC, ['--noEmit', '-p', project]);

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects a DOM type in a core package', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(
      file,
      'export const width = (c: HTMLCanvasElement): number => c.width;\n',
      'utf8',
    );

    await expect(typecheck('tsconfig.json')).rejects.toMatchObject({
      stdout: expect.stringContaining("Cannot find name 'HTMLCanvasElement'") as unknown as string,
    });
  }, 120_000);

  it('accepts the same type in the render layer, which is what its own project is for', async () => {
    await expect(typecheck('packages/render/tsconfig.json')).resolves.toBeDefined();
  }, 120_000);

  it("keeps @hh/render's barrel reachable from the no-DOM project", async () => {
    // `tools/bench/tessellation.bench.test.ts` imports `@hh/render` and is inside the
    // root project, so everything the barrel re-exports is compiled without a DOM. That
    // is what keeps the camera and the tessellator runnable under Node and in a Worker,
    // and it is why `createCanvas2DRenderer` sits behind the `@hh/render/canvas2d`
    // subpath instead. Re-exporting it from the barrel fails this.
    await expect(typecheck('tsconfig.json')).resolves.toBeDefined();
  }, 120_000);
});

describe('a golden that moves takes docs/PHYSICS.md with it (§11.13)', () => {
  // §11.13 has promised since M0 that "any PR that changes a physics result must update
  // `docs/PHYSICS.md` in the same PR (CI check on the golden fixtures enforces this by
  // failing loudly)". #71 supplies the check; this is the check on the check.
  //
  // It is invoked the way CI invokes it, through `--files`, rather than by importing
  // the rule: the gate is a program, its exit code is what CI reads, and a test that
  // imported the predicate would pass while the program exited zero on everything.
  // That is the failure mode the whole guardrail suite exists to catch.
  const GATE = path.join('tools', 'goldens', 'physics-doc-gate.mjs');
  const FIXTURES = 'tools/goldens/fixtures.json';
  const PHYSICS = 'docs/PHYSICS.md';

  const run = (files: readonly string[]): Promise<{ stdout: string }> =>
    execFileAsync('node', [GATE, '--files', ...files]);

  it('passes when the fixtures did not move', async () => {
    const { stdout } = await run(['packages/sim/src/timeline.ts', 'README.md']);
    expect(stdout).toContain('nothing to enforce');
  });

  it('passes when the fixtures moved and the document moved with them', async () => {
    const { stdout } = await run([FIXTURES, PHYSICS, 'packages/propagation/src/universal.ts']);
    expect(stdout).toContain('changed with it');
  });

  it('fails when the fixtures moved and the document did not', async () => {
    await expect(run([FIXTURES, 'packages/propagation/src/universal.ts'])).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining(
        `${FIXTURES} changed but ${PHYSICS} did not`,
      ) as unknown as string,
    });
  });

  it('fails on the fixtures alone, with no other file to explain them', async () => {
    await expect(run([FIXTURES])).rejects.toMatchObject({ code: 1 });
  });

  it('reports a base it cannot diff against rather than passing quietly', async () => {
    // A misconfigured CI step -- a shallow checkout, a renamed default branch -- must
    // not look like a clean run. Exit 2, distinct from both pass and fail.
    await expect(
      execFileAsync('node', [GATE, '--base', 'refs/heads/no-such-branch-for-the-guardrail-suite']),
    ).rejects.toMatchObject({ code: 2 });
  }, 30_000);
});

describe('shell tooling is executable', () => {
  // CI invokes these scripts by path, so a mode of 100644 fails the job with
  // "Permission denied" rather than anything about the script. The bit is easy to
  // lose: a working copy on a filesystem that cannot express it -- a Windows drive
  // mounted into WSL, which is where this repository is developed -- sets
  // core.filemode to false, and `chmod +x` there changes nothing git will record.
  it('records every script under tools/ as mode 100755', async () => {
    const { stdout } = await execFileAsync('git', ['ls-files', '-s', '--', 'tools']);

    const notExecutable = stdout
      .split('\n')
      .filter((line) => line.endsWith('.sh'))
      .filter((line) => !line.startsWith('100755'))
      .map((line) => line.split('\t')[1] ?? line);

    expect(notExecutable).toEqual([]);
  });
});

describe('no literal user-facing text in JSX (NFR-028)', () => {
  // #88 asks that the rule be "demonstrated to fire before it lands". These cases lint
  // *text* against a real path inside `apps/web`, so they exercise the actual
  // `eslint.config.js` glob and its three selectors rather than a reconstruction.
  //
  // The silent cases matter as much as the loud ones: a rule that also fired on
  // `{' '}` or on `id="route-heading"` would be turned off within a week, and a rule
  // that is off enforces nothing.
  // Real paths: `lintText` places the text in a tsconfig project by its path, and a
  // file that does not exist cannot be placed -- the lint then comes back as one fatal
  // parse error, which a `not.toContain` assertion would quietly accept. The core
  // guardrail cases above use existing paths for the same reason.
  const APP_FILE = 'apps/web/src/app.tsx';
  const SPIKE_FILE = 'apps/web/src/spike/SpikePage.tsx';

  // The first lint of a `.tsx` builds the whole `apps/web` program, which takes tens
  // of seconds. Pay it once here, for both paths, rather than charging it to whichever
  // case runs first -- `apps/web/src/spike/` is inside the same project but is a
  // separate `ignores` decision, and warming only one left the other at a timeout.
  beforeAll(async () => {
    await ruleIdsFor('export const warmup = 1;\n', APP_FILE);
    await ruleIdsFor('export const warmup = 1;\n', SPIKE_FILE);
  }, 180_000);

  const fires: readonly (readonly [label: string, code: string])[] = [
    ['literal text in an element', 'export const a = <p>Hello</p>;\n'],
    ['a string literal in a container', "export const b = <p>{'Hello'}</p>;\n"],
    ['an aria-label', 'export const c = <nav aria-label="Routes" />;\n'],
    ['an image alt', 'export const d = <img alt="Earth" />;\n'],
    ['a placeholder', 'export const e = <input placeholder="Search" />;\n'],
  ];

  it.each(fires)(
    'fires on %s',
    async (_label, code) => {
      expect(await ruleIdsFor(code, APP_FILE)).toContain('no-restricted-syntax');
    },
    30_000,
  );

  const silent: readonly (readonly [label: string, code: string])[] = [
    ['a resolved key', 'export const f = (label: string) => <p>{label}</p>;\n'],
    ['JSX indentation', 'export const g = <p>\n  <i />\n</p>;\n'],
    ['an explicit space', "export const h = <p><i />{' '}<i /></p>;\n"],
    ['a non-visible attribute', 'export const i = <h2 id="route-heading" />;\n'],
    ['a class name', 'export const j = <p class="hud" />;\n'],
  ];

  it.each(silent)(
    'stays silent on %s',
    async (_label, code) => {
      expect(await ruleIdsFor(code, APP_FILE)).not.toContain('no-restricted-syntax');
    },
    30_000,
  );

  // The M1 spike is exempt and is deleted whole in PR 5 of M2. The exemption is
  // asserted so that removing the directory and its `ignores` entry together is a
  // visible change rather than a silent one.
  it('exempts the M1 spike, which is throwaway', async () => {
    expect(await ruleIdsFor('export const k = <p>Hello</p>;\n', SPIKE_FILE)).not.toContain(
      'no-restricted-syntax',
    );
  }, 30_000);

  // The rule is only worth having if the codebase satisfies it on the day it lands.
  it('passes on the application as it stands', async () => {
    const results = await eslint.lintFiles(['apps/web/src/**/*.tsx']);
    const offences = results.flatMap((result) =>
      result.messages
        .filter((message) => message.ruleId === 'no-restricted-syntax')
        .map((message) => `${result.filePath}:${String(message.line)}`),
    );
    expect(offences).toEqual([]);
  }, 120_000);
});
