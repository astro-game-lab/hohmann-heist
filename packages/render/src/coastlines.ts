/**
 * Decoding the shipped coastline data into the form a frame actually wants (#177, #106).
 *
 * `packages/render/data/coastlines-110m.json` stores rings of delta-encoded integers in
 * thousandths of a degree — a format chosen to be small on the wire, and deliberately
 * not the format anything draws from. `tools/coastlines/process.mjs` documents that
 * encoding and why it was picked.
 *
 * This module is the boundary the org convention asks for: **degrees come in, and
 * nothing downstream of here ever sees one.** What comes out is a flat `Float64Array` of
 * Earth-fixed unit vectors, which is what every frame needs and what nothing should be
 * recomputing per frame.
 *
 * ## Why unit vectors, and why once
 *
 * Drawing a coastline means, for each vertex: convert lon/lat to a direction, rotate it
 * by Earth's rotation at the epoch, scale to Earth's radius, project, and decide whether
 * it is on the near or far hemisphere. Only the *rotation* onward depends on the epoch.
 * The lon/lat-to-direction step is two sines and two cosines, it never changes, and
 * there are 5 098 vertices — so doing it per frame would spend about 20 000 trig calls a
 * frame to recompute constants. Doing it once at module load costs 122 kB of
 * `Float64Array` and removes that entirely.
 *
 * A flat array rather than an array of `{x, y, z}`: 5 098 small objects is 5 098
 * allocations and a pointer chase per vertex, and §11.9's idle budget is 4 ms for the
 * whole frame. The ring boundaries travel alongside as offsets, the same shape the
 * shapefile itself uses.
 *
 * ## Earth-fixed, not inertial
 *
 * The vectors are ECEF: they rotate with the planet, which is what a coastline does.
 * Turning them into something drawable is `earth.ts`'s job and needs the epoch, because
 * the rotation angle does. Doing that here would bake an epoch into a module-level
 * constant, which is exactly the kind of hidden state that makes a replay stop
 * reproducing.
 */
import data from '../data/coastlines-110m.json' with { type: 'json' };

/**
 * Coastline geometry as Earth-fixed unit vectors.
 *
 * Ring `i` occupies `vertices[offsets[i] * 3]` through `vertices[offsets[i + 1] * 3]`,
 * so `offsets` has one more entry than there are rings — the last is the total vertex
 * count. That is the standard CSR-style layout and it means iterating rings needs no
 * per-ring object.
 */
export interface Coastlines {
  /** Interleaved `x, y, z` Earth-fixed unit vectors. Length is `3 * vertexCount`. */
  readonly vertices: Float64Array;
  /** Start index of each ring in *vertices*, plus a terminating total. */
  readonly offsets: Uint32Array;
  /** Number of rings. */
  readonly ringCount: number;
  /** Total vertices across every ring. */
  readonly vertexCount: number;
}

/** The shape `tools/coastlines/process.mjs` writes. */
interface CoastlineDocument {
  readonly precision: number;
  readonly ringCount: number;
  readonly pointCount: number;
  readonly rings: readonly (readonly number[])[];
}

/**
 * Decode a coastline document.
 *
 * Exported separately from {@link COASTLINES} so a test can decode a small hand-written
 * document and check the delta arithmetic against values it can verify by hand, rather
 * than against 5 098 points nobody can check.
 *
 * @throws RangeError when a ring has an odd number of values — the encoding is pairs,
 * and an odd count means the file is truncated or was written by something else.
 */
export const decodeCoastlines = (document: CoastlineDocument): Coastlines => {
  const scale = Math.pow(10, -document.precision);
  const degreesToRadians = Math.PI / 180;

  let total = 0;
  for (const ring of document.rings) {
    if (ring.length % 2 !== 0) {
      throw new RangeError(`coastline ring has an odd value count: ${String(ring.length)}`);
    }
    total += ring.length / 2;
  }

  const vertices = new Float64Array(total * 3);
  const offsets = new Uint32Array(document.rings.length + 1);

  let vertex = 0;
  for (const [index, ring] of document.rings.entries()) {
    offsets[index] = vertex;
    // The running sum is over the *quantised integers*, not the decoded degrees, which
    // is what keeps the reconstruction exact: integer addition cannot drift, where
    // accumulating 0.001-degree floats along a 300-vertex ring would.
    let lonUnits = 0;
    let latUnits = 0;
    for (let i = 0; i < ring.length; i += 2) {
      // `?? 0` rather than an assertion: `noUncheckedIndexedAccess` is on, the loop
      // bound and the even-length check above together rule both reads out, and the
      // lint config forbids both ways of saying so — `!` outright, and `as number` in
      // favour of the `!` it forbids. This is the idiom the spike settled on.
      lonUnits += ring[i] ?? 0;
      latUnits += ring[i + 1] ?? 0;

      const lon = lonUnits * scale * degreesToRadians;
      const lat = latUnits * scale * degreesToRadians;
      const cosLat = Math.cos(lat);

      vertices[vertex * 3] = cosLat * Math.cos(lon);
      vertices[vertex * 3 + 1] = cosLat * Math.sin(lon);
      vertices[vertex * 3 + 2] = Math.sin(lat);
      vertex++;
    }
  }
  offsets[document.rings.length] = vertex;

  return {
    vertices,
    offsets,
    ringCount: document.rings.length,
    vertexCount: vertex,
  };
};

/**
 * The shipped Natural Earth 1:110 m coastlines, decoded once.
 *
 * A module-level constant because it is genuinely constant — the same bytes produce the
 * same vectors on every run, there is no epoch or camera in it, and every consumer wants
 * the same thing. Its licence and provenance are in `ATTRIBUTIONS.md`, and the document
 * itself carries them too.
 */
export const COASTLINES: Coastlines = decodeCoastlines(data satisfies CoastlineDocument);
