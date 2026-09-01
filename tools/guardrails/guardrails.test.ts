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
  beforeAll(async () => {
    await ruleIdsFor('export const warmup = 1;\n', CORE_FILE);
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
