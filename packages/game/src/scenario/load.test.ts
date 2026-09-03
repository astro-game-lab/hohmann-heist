/**
 * The scenario loader — #85 and #86, FR-201, FR-202, §11.5.
 *
 * The document under test is §11.5's own example, with the `par` fields that section's
 * rules require. Using the product definition's example rather than a minimal one is
 * deliberate: if the published example does not validate against the published schema,
 * the schema is wrong, and that is a failure worth finding here rather than in a
 * contributor's first pull request (G6).
 */
import { R_EARTH_EQ } from '@hh/astro';
import { describe, expect, it } from 'vitest';

import { definitely } from '../test-support.js';
import {
  INTERCEPT_MAX_RANGE_M,
  REACH_ORBIT_TOLERANCE,
  RENDEZVOUS_MAX_RANGE_M,
} from '../objectives/index.js';
import { SCENARIO_VERSION, loadScenario, parseScenario } from './load.js';
import type { LoadResult } from './load.js';

/** A fresh, valid document. Fresh because most cases mutate a copy of it. */
const scenario = (): Record<string, unknown> => ({
  $schema: 'https://astro-game-lab.github.io/hohmann-heist/schema/scenario-1.json',
  id: 'c05-tailgate',
  version: 1,
  act: 2,
  index: 5,
  title: 'Tailgate',
  briefKey: 'brief.c05',
  epoch: { scale: 'TAI', j2000Seconds: 0 },
  horizonSeconds: 50_400,
  ship: {
    state: {
      kind: 'elements',
      a_m: 6_778_137,
      e: 0,
      i_rad: 0,
      raan_rad: 0,
      argp_rad: 0,
      nu_rad: 0,
    },
    dvBudget_mps: 250,
  },
  targets: [
    {
      id: 'CTX-4',
      label: 'CTX-4',
      state: {
        kind: 'elements',
        a_m: 6_778_137,
        e: 0,
        i_rad: 0,
        raan_rad: 0,
        argp_rad: 0,
        nu_rad: 0.698_131_7,
      },
    },
  ],
  objective: { kind: 'intercept', targetId: 'CTX-4', maxRange_m: 1000 },
  constraints: [
    { kind: 'altitude_floor', min_m: 100_000 },
    { kind: 'deadline', seconds: 50_400 },
  ],
  par: {
    dv_mps: 72,
    time_s: 43_800,
    burns: 2,
    derivation: 'Two-impulse coplanar phasing, 8 revolutions. Grid search over N=1..20 revs.',
    referenceReplay: 'eyJ2IjoxLCJuIjpbXX0',
  },
  unlocks: [],
  assistsAllowed: ['closest_approach', 'elements', 'snapping', 'constraints'],
  coachMarks: ['mark.c05.retrograde'],
});

/** The keys of the errors a result carries, for the cases that assert on them. */
const keys = (result: LoadResult): readonly string[] =>
  result.ok ? [] : result.errors.map((error) => error.message.key);

const paths = (result: LoadResult): readonly string[] =>
  result.ok ? [] : result.errors.map((error) => error.path);

const loaded = (document: unknown) => {
  const result = parseScenario(document);
  if (!result.ok) throw new Error(`expected a scenario, got ${keys(result).join(', ')}`);
  return result.scenario;
};

describe('a valid scenario', () => {
  it('loads §11.5’s example', () => {
    expect(parseScenario(scenario()).ok).toBe(true);
  });

  it('converts to SI at the boundary, exactly once', () => {
    const result = loaded(scenario());
    // p = a(1 - e^2); at e = 0 they are the same number, which is checkable by eye.
    expect(result.ship.state.position).toBeDefined();
    // 400 km circular: |r| is the semi-major axis.
    const radius = Math.hypot(
      result.ship.state.position.x,
      result.ship.state.position.y,
      result.ship.state.position.z,
    );
    expect(radius).toBeCloseTo(6_778_137, 3);
    expect(radius - R_EARTH_EQ).toBeCloseTo(400_000, 3);
  });

  it('assembles exactly the rules legality takes', () => {
    const result = loaded(scenario());
    expect(result.rules).toStrictEqual({
      budgetMps: 250,
      deadlineSeconds: 50_400,
      floorAltitudeM: 100_000,
    });
  });

  it('resolves the objective to the shape the evaluators want', () => {
    const result = loaded(scenario());
    expect(result.objective.kind).toBe('intercept');
    if (result.objective.kind === 'intercept') {
      expect(result.objective.targetId).toBe('CTX-4');
      expect(result.objective.tolerance.maxRangeM).toBe(1000);
      expect(result.objective.tolerance.maxRelativeSpeedMps).toBeNull();
    }
  });

  it('keeps the validated document, because the briefing reads fields this type does not', () => {
    expect(loaded(scenario()).document.briefKey).toBe('brief.c05');
  });

  it('defaults an absent deadline to the horizon, and an absent floor to DEP-08', () => {
    const document = { ...scenario(), constraints: [] };
    expect(loaded(document).rules).toStrictEqual({
      budgetMps: 250,
      deadlineSeconds: 50_400,
      floorAltitudeM: 100_000,
    });
  });

  it('is a pure function — the same input gives the same result', () => {
    expect(loaded(scenario()).rules).toStrictEqual(loaded(scenario()).rules);
  });
});

describe('text that is not a scenario', () => {
  it('reports malformed JSON as a result, not an exception', () => {
    const result = loadScenario('{ not json');
    expect(result.ok).toBe(false);
    expect(keys(result)).toStrictEqual(['scenario.error.malformedJson']);
  });

  it('reports truncated JSON the same way', () => {
    const result = loadScenario(JSON.stringify(scenario()).slice(0, 120));
    expect(keys(result)).toStrictEqual(['scenario.error.malformedJson']);
  });

  it('parses valid JSON text', () => {
    expect(loadScenario(JSON.stringify(scenario())).ok).toBe(true);
  });
});

describe('the schema gate', () => {
  it('rejects an unknown field rather than ignoring it (G6)', () => {
    const document = { ...scenario(), horizonSecnods: 50_400 };
    const result = parseScenario(document);
    expect(keys(result)).toContain('scenario.error.unknownProperty');
    expect(paths(result)).toContain('/');
  });

  it('rejects an unknown field nested inside an object, and names the path', () => {
    const base = scenario();
    const document = { ...base, ship: { ...(base['ship'] as object), fuel_kg: 400 } };
    const result = parseScenario(document);
    expect(keys(result)).toContain('scenario.error.unknownProperty');
    expect(paths(result)).toContain('/ship');
  });

  it('names a missing required property and where it should have been', () => {
    const rest = scenario();
    delete rest['briefKey'];
    const result = parseScenario(rest);
    expect(keys(result)).toContain('scenario.error.required');
    if (!result.ok) {
      const error = definitely(
        result.errors.find((e) => e.message.key === 'scenario.error.required'),
      );
      if (error.message.key === 'scenario.error.required') {
        expect(error.message.params.property).toBe('briefKey');
      }
    }
  });

  it('rejects a value of the wrong type', () => {
    const document = { ...scenario(), horizonSeconds: '50400' };
    const result = parseScenario(document);
    expect(keys(result)).toContain('scenario.error.type');
    expect(paths(result)).toContain('/horizonSeconds');
  });

  it('rejects a number outside its range', () => {
    const base = scenario();
    const document = {
      ...base,
      ship: { ...(base['ship'] as Record<string, unknown>), dvBudget_mps: -1 },
    };
    expect(keys(parseScenario(document))).toContain('scenario.error.range');
  });

  it('rejects an open initial orbit, which has no semi-major axis to convert', () => {
    const base = scenario();
    const ship = base['ship'] as Record<string, unknown>;
    const document = {
      ...base,
      ship: { ...ship, state: { ...(ship['state'] as object), e: 1.2 } },
    };
    expect(keys(parseScenario(document))).toContain('scenario.error.range');
  });

  it('rejects an objective kind that does not exist', () => {
    const document = { ...scenario(), objective: { kind: 'land_on_mars', targetId: 'CTX-4' } };
    expect(keys(parseScenario(document))).toContain('scenario.error.notAllowed');
  });

  it('rejects a brief key that is not a catalogue key', () => {
    const document = { ...scenario(), briefKey: 'Steal the satellite!' };
    expect(keys(parseScenario(document))).toContain('scenario.error.pattern');
  });

  // FR-202 asks for field-level errors, plural: `allErrors` is on so a contributor
  // fixes a five-field typo in one pass rather than five.
  it('reports every field-level error at once', () => {
    const document = { ...scenario(), horizonSeconds: '50400', act: 99, id: 'Not A Slug' };
    const result = parseScenario(document);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('the version gate runs before the schema', () => {
  it('refuses an unknown major version with one clear message', () => {
    const result = parseScenario({ ...scenario(), version: 2 });
    // One message, not nineteen about fields v1 has never heard of.
    expect(keys(result)).toStrictEqual(['scenario.error.unsupportedVersion']);
    expect(paths(result)).toStrictEqual(['/version']);
  });

  it('names the version it does implement', () => {
    const result = parseScenario({ ...scenario(), version: 7 });
    if (!result.ok) {
      const error = definitely(result.errors[0]);
      if (error.message.key === 'scenario.error.unsupportedVersion') {
        expect(error.message.params.supported).toBe(SCENARIO_VERSION);
      }
    }
  });
});

describe('semantics the schema cannot express', () => {
  it('rejects an objective naming a target that is not there', () => {
    const document = { ...scenario(), objective: { kind: 'intercept', targetId: 'GHOST-1' } };
    const result = parseScenario(document);
    expect(keys(result)).toContain('scenario.error.unknownTarget');
    expect(paths(result)).toContain('/objective/targetId');
  });

  it('rejects two targets sharing an id', () => {
    const base = scenario();
    const targets = base['targets'] as unknown[];
    const document = { ...base, targets: [...targets, ...targets] };
    expect(keys(parseScenario(document))).toContain('scenario.error.duplicateTargetId');
  });

  it('rejects a deadline the horizon cannot reach', () => {
    const document = {
      ...scenario(),
      constraints: [{ kind: 'deadline', seconds: 90_000 }],
    };
    expect(keys(parseScenario(document))).toContain('scenario.error.deadlineBeyondHorizon');
  });

  it('rejects two constraints of the same kind', () => {
    const document = {
      ...scenario(),
      constraints: [
        { kind: 'deadline', seconds: 50_400 },
        { kind: 'deadline', seconds: 40_000 },
      ],
    };
    expect(keys(parseScenario(document))).toContain('scenario.error.duplicateConstraint');
  });

  it('rejects a ship that starts below its own altitude floor', () => {
    const base = scenario();
    const ship = base['ship'] as Record<string, unknown>;
    const document = {
      ...base,
      ship: {
        ...ship,
        state: { ...(ship['state'] as object), a_m: R_EARTH_EQ + 50_000 },
      },
    };
    expect(keys(parseScenario(document))).toContain('scenario.error.startsBelowFloor');
  });
});

describe('tolerance overrides', () => {
  // §7.5 states the loosest tolerance the game will ever apply, and §6.4 requires it to
  // be shown to the player. A contract may be harder; it may not be more forgiving.
  it('refuses a tolerance looser than the departure table', () => {
    const document = {
      ...scenario(),
      objective: { kind: 'intercept', targetId: 'CTX-4', maxRange_m: 5000 },
    };
    const result = parseScenario(document);
    expect(keys(result)).toContain('scenario.error.toleranceTooLoose');
  });

  it('accepts a tolerance tighter than the departure table', () => {
    const document = {
      ...scenario(),
      objective: { kind: 'intercept', targetId: 'CTX-4', maxRange_m: 250 },
    };
    const result = loaded(document);
    if (result.objective.kind === 'intercept') {
      expect(result.objective.tolerance.maxRangeM).toBe(250);
    }
  });

  it('defaults to the departure value when the scenario is silent', () => {
    const document = { ...scenario(), objective: { kind: 'intercept', targetId: 'CTX-4' } };
    const result = loaded(document);
    if (result.objective.kind === 'intercept') {
      expect(result.objective.tolerance.maxRangeM).toBe(INTERCEPT_MAX_RANGE_M);
    }
  });

  it('applies DEP-03 to a rendezvous', () => {
    const document = { ...scenario(), objective: { kind: 'rendezvous', targetId: 'CTX-4' } };
    const result = loaded(document);
    if (result.objective.kind === 'rendezvous') {
      expect(result.objective.tolerance.maxRangeM).toBe(RENDEZVOUS_MAX_RANGE_M);
      expect(result.objective.tolerance.maxRelativeSpeedMps).toBe(0.5);
    }
  });

  it('applies DEP-13 to a reach_orbit goal', () => {
    const document = {
      ...scenario(),
      targets: [],
      objective: {
        kind: 'reach_orbit',
        goal: { a_m: 42_164_173, e: 0, i_rad: 0, raan_rad: 0, argp_rad: 0 },
      },
    };
    const result = loaded(document);
    if (result.objective.kind === 'reach_orbit') {
      expect(result.objective.tolerance.radiusM).toBe(REACH_ORBIT_TOLERANCE.radiusM);
      expect(result.objective.tolerance.angleRad).toBe(REACH_ORBIT_TOLERANCE.angleRad);
      expect(result.objective.goal.semiLatusRectum).toBeCloseTo(42_164_173, 6);
    }
  });
});
