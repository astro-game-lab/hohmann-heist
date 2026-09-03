# Tier 3 external-library fixtures

`fixtures.json` holds numbers computed by **somebody else's astrodynamics code**, so
that `reference.test.ts` can check ours against something that shares no lineage with
it. It closes three rows of the Tier 3 table in [`docs/PHYSICS.md`](../../docs/PHYSICS.md):
two-body propagation over a range of `a` and `e`, multi-revolution Lambert, and the
ISS real-orbit case.

**CI never runs Python.** The fixture is committed, and `reference.test.ts` reads it
like any other data file. Regenerating is a deliberate act by a person, and the change
lands as a reviewable diff — the same rule `tools/goldens/` follows, for the same
reason.

## Why this is not `crosscheck.test.ts`

`crosscheck.test.ts` compares the analytic propagator against the DOP853 oracle. Both
are ours. A shared misunderstanding of a convention, or a wrong constant, would agree
with itself and pass. What that test excludes is an error in either *algorithm*, which
is worth having and is a different thing from what this file provides.

## Regenerating

```sh
uv run --project tools/reference tools/reference/generate.py
```

Then run `pnpm test:all` and commit `fixtures.json` alongside whatever prompted the
regeneration. If a number moved, say why in `docs/PHYSICS.md` in the same pull request.

## Reproducibility, precisely

Running the generator twice **on the same machine with the same pinned versions**
produces a byte-identical file. There is no randomness, no clock and no network: the
case lists are literal, the ISS TLE is committed as `iss-tle.txt` rather than fetched,
and `json.dump` writes floats through `repr`, which is the shortest string that
round-trips a float64 exactly.

**Across machines it is reproducible in practice but not promised.** `hapsira`'s
Farnocchia propagator and Izzo solver run through `numba`, and neither that nor the
underlying BLAS guarantees identical rounding on a different microarchitecture. Any
difference would be in the last bits, far below the tolerances `reference.test.ts`
asserts — but "byte-for-byte on any machine" would be a claim nobody has checked, so
it is not made here.

## Why `hapsira`

`poliastro` is archived upstream and its final release does not install on Python
3.12+. `hapsira` is the maintained fork: same lineage, same `iod.izzo`, same
Farnocchia propagator. `astropy` on its own was considered and rejected — it has no
Kepler propagator and no Lambert solver, so it cannot fill either row.

**The `astropy<7` pin is load-bearing**, not conservatism. `hapsira` 0.18.0 imports
`astropy.coordinates.matrix_utilities.matrix_product`, which `astropy` 8 removed; with
an unpinned `astropy` the generator fails at import. Raising it means checking that
`hapsira` has caught up.

## The ISS case, and why disagreement is the assertion

A TLE-derived state propagated one orbit against SGP4. We model neither J2 nor drag,
so the two **must** disagree — asserting agreement would be asserting that our
simulation is something it is not. What the fixture records instead is the size of the
disagreement at eight points around one orbit, and `reference.test.ts` asserts that
our two-body propagation reproduces that size.

The fixture also carries `j2_displacement_bound`: `½ · a_J2 · T²`, using
`a_J2 = 1.5 J2 μ Rₑ² / r⁴`. That is an upper bound rather than an estimate, because
J2's direction rotates with the orbit and partly averages out over a revolution. The
measured separation after one orbit is about 40% of it, which is what "the magnitude
matches what the model predicts" means here and is what the test checks.

## Attribution

The TLE's source, provider, licence and retrieval date are recorded in
[`ATTRIBUTIONS.md`](../../ATTRIBUTIONS.md), along with the libraries used to generate
the fixture. These are development-time tools that ship nothing into the bundle.
