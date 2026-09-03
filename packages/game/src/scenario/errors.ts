/**
 * Turning a schema rejection into something a contributor can act on — FR-202.
 *
 * > *The system MUST validate every scenario against the schema before loading, and
 * > MUST refuse to load an invalid one with a **field-level error**.*
 *
 * The point is G6: a contributor writing a contract should be told which field is wrong
 * and what is wrong with it, in one pass, without reading the schema. So every error
 * carries a JSON pointer into the document and a catalogue key naming the *kind* of
 * problem — never Ajv's own English, which is neither translatable nor stable across
 * versions of a build-time dependency.
 *
 * ## One key per keyword, not one key per message
 *
 * Ajv reports a `keyword` and a `params` object. Mapping those onto a small set of keys
 * — required, unknown property, wrong type, out of range, not in the allowed set — is
 * what makes the errors translatable: each key is one sentence with holes in it, and
 * the holes take values rather than fragments (FR-910).
 *
 * The mapping is deliberately **total**. Anything not specially handled becomes
 * `scenario.error.invalidField` carrying the keyword as a parameter, which is a
 * degraded message rather than a missing one. A schema change that introduces a keyword
 * nobody thought about produces "`/ship/dvBudget_mps` is not valid (multipleOf)" — not
 * ideal, and not a blank space or a crash.
 */
import type { GameMessage } from '../messages.js';
import { gameMessage } from '../messages.js';

/**
 * The shape of one validator diagnostic.
 *
 * This restates the four fields of Ajv's `ErrorObject` that this module reads, rather
 * than importing the type. `@hh/game` has no dependency on Ajv — the validator is
 * generated ahead of time and committed — and acquiring a type-level one would make
 * that claim true only until someone looked closely.
 */
export interface SchemaError {
  /** JSON pointer to the offending value. Empty string at the document root. */
  readonly instancePath: string;
  /** Pointer into the schema. Kept for diagnostics; not shown to anyone. */
  readonly schemaPath?: string;
  /** The keyword that failed: `required`, `type`, `additionalProperties`, … */
  readonly keyword: string;
  /** Keyword-specific detail. Its shape depends on `keyword`. */
  readonly params?: Readonly<Record<string, unknown>>;
  /** Ajv's English. Never shown; useful when a test needs to say what it saw. */
  readonly message?: string | undefined;
}

/** One thing wrong with a scenario, ready to render. */
export interface ScenarioError {
  /** JSON pointer to the value, or `/` for the document itself. */
  readonly path: string;
  /** A catalogue key and its parameters. */
  readonly message: GameMessage;
}

/** A JSON pointer, with the root spelled `/` rather than empty. */
export const pointer = (instancePath: string): string => (instancePath === '' ? '/' : instancePath);

/** A pointer with one more segment, escaped per RFC 6901. */
export const childPointer = (parent: string, segment: string | number): string => {
  const escaped = String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
  return parent === '/' || parent === '' ? `/${escaped}` : `${parent}/${escaped}`;
};

/** Read a `params` field that should be a string. */
const asString = (params: Readonly<Record<string, unknown>> | undefined, key: string): string => {
  const value = params?.[key];
  return typeof value === 'string' ? value : '';
};

/** Read a `params` field that should be a number. */
const asNumber = (params: Readonly<Record<string, unknown>> | undefined, key: string): number => {
  const value = params?.[key];
  return typeof value === 'number' ? value : Number.NaN;
};

/** Read a `params` field that should be a list of scalars, as identifiers. */
const asList = (params: Readonly<Record<string, unknown>> | undefined, key: string): string[] => {
  const value = params?.[key];
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
};

/**
 * Map one validator diagnostic onto a catalogue key.
 *
 * Ordered so the specific keywords are handled before the fallback, and grouped so that
 * the four numeric bounds — and the two length bounds, and the two item-count bounds —
 * share a key each. A player does not need six different sentences for "that number is
 * outside its range".
 */
export const toScenarioError = (error: SchemaError): ScenarioError => {
  const path = pointer(error.instancePath);
  const { params } = error;

  switch (error.keyword) {
    case 'required':
      return {
        path,
        message: gameMessage('scenario.error.required', {
          path,
          property: asString(params, 'missingProperty'),
        }),
      };
    case 'additionalProperties':
      return {
        path,
        message: gameMessage('scenario.error.unknownProperty', {
          path,
          property: asString(params, 'additionalProperty'),
        }),
      };
    case 'type':
      return {
        path,
        message: gameMessage('scenario.error.type', { path, expected: asString(params, 'type') }),
      };
    case 'minimum':
    case 'maximum':
    case 'exclusiveMinimum':
    case 'exclusiveMaximum':
    case 'multipleOf':
      return {
        path,
        message: gameMessage('scenario.error.range', { path, limit: asNumber(params, 'limit') }),
      };
    case 'minLength':
    case 'maxLength':
      return {
        path,
        message: gameMessage('scenario.error.stringLength', {
          path,
          limit: asNumber(params, 'limit'),
        }),
      };
    case 'minItems':
    case 'maxItems':
      return {
        path,
        message: gameMessage('scenario.error.itemCount', {
          path,
          limit: asNumber(params, 'limit'),
        }),
      };
    case 'uniqueItems':
      return { path, message: gameMessage('scenario.error.duplicate', { path }) };
    case 'pattern':
      return {
        path,
        message: gameMessage('scenario.error.pattern', {
          path,
          pattern: asString(params, 'pattern'),
        }),
      };
    case 'enum':
      return {
        path,
        message: gameMessage('scenario.error.notAllowed', {
          path,
          allowed: asList(params, 'allowedValues'),
        }),
      };
    case 'const':
      return {
        path,
        message: gameMessage('scenario.error.notAllowed', {
          path,
          allowed: [String(params?.['allowedValue'])],
        }),
      };
    case 'discriminator':
      // The `kind` tag is missing, is not a string, or names no branch. All three are
      // "that is not one of the kinds there are", which is what `notAllowed` says.
      return {
        path: childPointer(path, asString(params, 'tag') || 'kind'),
        message: gameMessage('scenario.error.notAllowed', {
          path: childPointer(path, asString(params, 'tag') || 'kind'),
          allowed: [],
        }),
      };
    default:
      return {
        path,
        message: gameMessage('scenario.error.invalidField', { path, keyword: error.keyword }),
      };
  }
};

/**
 * Map a whole batch, dropping the ones that carry no information.
 *
 * `oneOf` and `anyOf` fire *in addition to* the branch errors that explain them, and
 * with `discriminator` on there is always a more specific error beside them. Reporting
 * both means telling a contributor that their objective "must match exactly one schema
 * in oneOf" immediately after telling them which field is wrong, which makes the useful
 * line harder to find.
 */
export const toScenarioErrors = (errors: readonly SchemaError[]): readonly ScenarioError[] =>
  errors
    .filter((error) => error.keyword !== 'oneOf' && error.keyword !== 'anyOf')
    .map(toScenarioError);
