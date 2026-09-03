// Generate the scenario validator and its TypeScript types from the JSON Schema (#85).
//
//   node tools/schema/generate.mjs             write the generated files
//   node tools/schema/generate.mjs --check     fail if what is committed is stale
//
// ## Why the validator is generated and committed rather than compiled at runtime
//
// `@hh/game` has no third-party runtime dependencies, and the workspace has two in
// total. Adding Ajv to the game layer would put roughly 35 kB gzip into the initial
// bundle (NFR-020's budget is 400 kB, so it would fit) to do a job that is entirely
// decided before the code ships: the schema is a constant, so the validator it implies
// is a constant, and computing a constant at load time is work the player waits for.
//
// Ajv's standalone mode emits that validator as plain JavaScript with no imports. It
// is committed, and `--check` regenerates it and compares — the same arrangement
// `tools/goldens` and `tools/reference` already use for their fixtures, for the same
// reason: a generated artefact that nobody can prove is current is a liability.
//
// Two things fall out that matter beyond the bundle. §11.9 budgets scenario load and
// validation at 20 ms, and schema compilation is most of what that budget would have
// been spent on. And Ajv compiles by `new Function`, which is the one construct a
// strict Content-Security-Policy refuses; nothing here needs one today, and not
// acquiring the constraint is cheaper than removing it later.
//
// ## The types come from the same file, so they cannot disagree with it
//
// #85 asks for types *generated* from the schema rather than hand-written beside it.
// `json-schema-to-typescript` does that. The failure mode being designed out is the
// ordinary one: someone adds a field to the schema, updates the interface, and gets
// the optionality or the union subtly wrong, so the compiler now believes something
// the validator does not enforce.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { compile } from 'json-schema-to-typescript';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCENARIO_DIR = join(REPO_ROOT, 'packages', 'game', 'src', 'scenario');

const SCHEMA_FILE = join(SCENARIO_DIR, 'scenario-1.schema.json');
const VALIDATOR_FILE = join(SCENARIO_DIR, 'validate.generated.js');
const VALIDATOR_TYPES_FILE = join(SCENARIO_DIR, 'validate.generated.d.ts');
const TYPES_FILE = join(SCENARIO_DIR, 'types.generated.ts');

/** Said on every generated file, so nobody edits one and wonders why it reverted. */
const BANNER = (source) =>
  [
    '/**',
    ' * GENERATED FILE — DO NOT EDIT.',
    ' *',
    ` * Generated from ${source} by tools/schema/generate.mjs.`,
    ' * Run `pnpm schema:write` after changing the schema; `pnpm schema:check` gates it in CI.',
    ' */',
  ].join('\n');

/**
 * Ajv, configured the way the loader needs it.
 *
 * `ajv/dist/2020` rather than the default export: the schema is draft 2020-12, and
 * Ajv's default build only knows draft-07.
 *
 * - `allErrors` because FR-202 asks for field-level errors, plural. Stopping at the
 *   first one would make a contributor fix a five-field typo in five passes (G6).
 * - `discriminator` so that a bad `objective` reports the errors of the branch its
 *   `kind` selected, rather than the union of every branch's complaints — which is the
 *   difference between "maxRange_m must be a number" and eleven lines about three
 *   objective types the author did not write.
 * - `useDefaults` off. The schema's `default` values document the shape; applying them
 *   would mean the validator mutates its input, and the loader is a better place to be
 *   explicit about what an absent array means.
 */
const createAjv = () =>
  new Ajv2020.default({
    allErrors: true,
    discriminator: true,
    strict: true,
    strictSchema: true,
    useDefaults: false,
    code: { source: true, esm: true, lines: true },
  });

const generateValidator = async (schema) => {
  const ajv = createAjv();
  const validate = ajv.compile(schema);
  const body = standaloneCode.default(ajv, validate);
  return `${BANNER('scenario-1.schema.json')}\n${body}`;
};

/**
 * The validator's type.
 *
 * Hand-written here rather than emitted by Ajv, which produces none, and deliberately
 * **not** typed with Ajv's own `ErrorObject`: `@hh/game` must not acquire even a
 * type-level dependency on a build-time tool. `SchemaError` in `errors.ts` restates the
 * three fields the loader reads, and is the contract between this file and that one.
 */
const validatorTypes = () =>
  `${BANNER('scenario-1.schema.json')}
import type { SchemaError } from './errors.js';
import type { Scenario } from './types.generated.js';

/** Ajv's standalone validator: a type guard that parks its diagnostics on itself. */
declare const validate: {
  (data: unknown): data is Scenario;
  errors?: SchemaError[] | null;
};

export default validate;
`;

const generateTypes = async (schema) =>
  compile(schema, 'Scenario', {
    bannerComment: BANNER('scenario-1.schema.json'),
    additionalProperties: false,
    style: { singleQuote: true, printWidth: 100 },
    declareExternallyReferenced: true,
    enableConstEnums: false,
  });

/** Everything the generator produces, keyed by path. */
const buildAll = async () => {
  const schema = JSON.parse(await readFile(SCHEMA_FILE, 'utf8'));
  return new Map([
    [VALIDATOR_FILE, await generateValidator(schema)],
    [VALIDATOR_TYPES_FILE, validatorTypes()],
    [TYPES_FILE, await generateTypes(schema)],
  ]);
};

const main = async () => {
  const check = process.argv.includes('--check');
  const outputs = await buildAll();

  if (!check) {
    await mkdir(SCENARIO_DIR, { recursive: true });
    for (const [file, content] of outputs) await writeFile(file, content);
    for (const file of outputs.keys()) {
      process.stdout.write(`wrote ${relative(REPO_ROOT, file)}\n`);
    }
    return 0;
  }

  const stale = [];
  for (const [file, expected] of outputs) {
    const actual = await readFile(file, 'utf8').catch(() => null);
    if (actual !== expected) stale.push(relative(REPO_ROOT, file));
  }

  if (stale.length === 0) {
    process.stdout.write('scenario schema artefacts are current\n');
    return 0;
  }

  process.stderr.write(
    `${stale.join('\n')}\n\n` +
      'These are generated from packages/game/src/scenario/scenario-1.schema.json and are\n' +
      'out of date. Run `pnpm schema:write` and commit the result.\n',
  );
  return 1;
};

process.exitCode = await main();
