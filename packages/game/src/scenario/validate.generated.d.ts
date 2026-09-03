/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Generated from scenario-1.schema.json by tools/schema/generate.mjs.
 * Run `pnpm schema:write` after changing the schema; `pnpm schema:check` gates it in CI.
 */
import type { SchemaError } from './errors.js';
import type { Scenario } from './types.generated.js';

/** Ajv's standalone validator: a type guard that parks its diagnostics on itself. */
declare const validate: {
  (data: unknown): data is Scenario;
  errors?: SchemaError[] | null;
};

export default validate;
