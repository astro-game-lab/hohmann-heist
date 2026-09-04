/**
 * Turn Natural Earth's 1:110 m coastline shapefile into the vector data `@hh/render`
 * ships (#177, §9.6, NFR-020, NFR-024).
 *
 * Run it with `pnpm coastlines:write`. It fetches the pinned upstream release, verifies
 * its digest, parses the shapefile, simplifies, quantises, and writes
 * `packages/render/data/coastlines-110m.json`. Nothing here runs in CI and nothing here
 * reaches the browser bundle — the committed JSON is the only artefact the game loads.
 *
 * ## Why this reads a shapefile rather than taking GeoJSON
 *
 * Natural Earth's canonical distribution is the shapefile on `naciscdn.org`. Every
 * GeoJSON mirror of it is a third party's re-encoding, with its own precision and
 * simplification choices baked in and no digest to pin. Reading the upstream `.shp`
 * directly means the provenance chain is one hop long and the digest below covers the
 * actual bytes the data came from. The format costs about sixty lines to read: it is a
 * fixed 100-byte header followed by length-prefixed records, and coastlines are
 * `PolyLine` (shape type 3), the simplest variable-length record the format has.
 *
 * ## The two numbers that matter, and how they were chosen
 *
 * **Coordinate precision: 3 decimal places of a degree.** §9.3 refines an orbit until
 * its screen-space error is under 0.5 px, and there is no reason for the coastline to
 * hold itself to a looser standard than the orbits drawn over it. At the tightest
 * framing the camera reaches — LEO auto-frame at §8.4's 40x zoom ceiling — a pixel is
 * roughly 0.39 km, so 0.5 px is about 195 m. Three decimals of latitude is 111 m, which
 * clears it. Two decimals would be 1.11 km, about 2.8 px at that zoom, and visibly
 * stair-stepped.
 *
 * **Simplification tolerance: 200 m**, matched to that same 195 m budget.
 *
 * The honest finding is that the tolerance barely matters. Douglas–Peucker at 200 m
 * removes 30 of 5 128 points — 0.6% — and even at 800 m it removes 2%. The 1:110 m
 * source is *already* simplified to its stated resolution, so there is no redundancy
 * left for a second simplification pass to find. The step stays in because it is the
 * thing that would catch a future switch to the 1:50 m source, where it would suddenly
 * do a great deal of work; it is not carrying weight today and the docstring should not
 * imply it is.
 *
 * That has a consequence for §9.6, which estimates this asset at "~15 kB as simplified
 * GeoJSON". **It does not come out at 15 kB.** At a precision that meets §9.3, the data
 * is 47 kB raw and 20.3 kB gzipped in the encoding below — and as literal GeoJSON, 74 kB
 * raw and 31 kB gzipped. The estimate was an estimate; this is the measurement.
 * NFR-020's budget is 400 kB gzip and the app currently spends 18 kB of it, so 20.3 kB
 * is affordable, but the product definition's number should be corrected rather than
 * quietly missed.
 *
 * ## The encoding
 *
 * Rings of `[lon, lat]` in degrees, quantised to 1e-3 and **delta-encoded** along each
 * ring as integers. Adjacent coastline vertices are close together, so the deltas are
 * one to three digits where absolute coordinates are seven or eight. That is 47 kB
 * against 74 kB raw, and 20.3 kB against 30.6 kB gzipped.
 *
 * A varint-plus-base64 packing was measured too, and rejected: it lands at 18.9 kB
 * gzipped — 0.8 kB better — in exchange for an opaque blob and a decoder to maintain.
 * gzip already finds most of the redundancy that a bit-packing would, and 0.8 kB is
 * noise against a 400 kB budget.
 *
 * Decoding is a running sum, done once when the module loads. Nothing is parsed per
 * frame.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');

/**
 * The pinned upstream release.
 *
 * Natural Earth publishes in place — a version bump replaces the file at the same URL —
 * so the digest is what makes "the same input" a checkable claim rather than a hope. If
 * this stops matching, upstream has published a new release: look at what changed,
 * update both constants deliberately, and regenerate.
 */
const SOURCE_URL = 'https://naciscdn.org/naturalearth/110m/physical/ne_110m_coastline.zip';
const SOURCE_SHA256 = '664449b39070027e882abb295974d182afec18ca21107273d17e9e8bf6f64817';
const SOURCE_VERSION = '4.1.0';

/** Decimal places kept on each coordinate. See the docstring: 1e-3 deg is 111 m. */
const PRECISION = 3;

/** Douglas–Peucker tolerance in metres, matched to 0.5 px at the 40x zoom ceiling. */
const TOLERANCE_M = 200;

/** WGS-84 equatorial radius, for expressing the tolerance as a surface distance. */
const R_EARTH_EQ = 6378137;

const OUTPUT = join(REPO, 'packages', 'render', 'data', 'coastlines-110m.json');
const CACHE = join(HERE, '.cache', 'ne_110m_coastline.zip');

// ── Fetching ────────────────────────────────────────────────────────────────────

/** The upstream archive, from the cache when it is already there and verified. */
const fetchArchive = async () => {
  const cached = await readFile(CACHE).catch(() => undefined);
  if (cached !== undefined) {
    const digest = createHash('sha256').update(cached).digest('hex');
    if (digest === SOURCE_SHA256) return cached;
    process.stderr.write(`cached archive digest ${digest} does not match; refetching\n`);
  }

  process.stderr.write(`fetching ${SOURCE_URL}\n`);
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`fetch failed: ${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());

  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== SOURCE_SHA256) {
    throw new Error(
      `upstream digest changed.\n  expected ${SOURCE_SHA256}\n  received ${digest}\n` +
        'Natural Earth publishes in place. Inspect the new release, then update ' +
        'SOURCE_SHA256 and SOURCE_VERSION deliberately.',
    );
  }

  await mkdir(dirname(CACHE), { recursive: true });
  await writeFile(CACHE, bytes);
  return bytes;
};

/**
 * Pull one member out of a zip archive.
 *
 * Walks the central directory rather than scanning local headers, because a local
 * header may carry a zero compressed size with the real value deferred to a data
 * descriptor. The central directory always has the true sizes.
 */
const extractFromZip = (zip, wanted) => {
  // End of central directory: signature 0x06054b50, within the last 64 KiB.
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0 && i > zip.length - 65558; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive: no end-of-central-directory record');

  const count = zip.readUInt16LE(eocd + 10);
  let entry = zip.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(entry) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = zip.readUInt16LE(entry + 10);
    const compressedSize = zip.readUInt32LE(entry + 20);
    const nameLength = zip.readUInt16LE(entry + 28);
    const extraLength = zip.readUInt16LE(entry + 30);
    const commentLength = zip.readUInt16LE(entry + 32);
    const localOffset = zip.readUInt32LE(entry + 42);
    const name = zip.subarray(entry + 46, entry + 46 + nameLength).toString('utf8');

    if (name === wanted) {
      // The local header's own name and extra lengths, which need not match the
      // central directory's extra length.
      const localName = zip.readUInt16LE(localOffset + 26);
      const localExtra = zip.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localName + localExtra;
      const raw = zip.subarray(start, start + compressedSize);
      if (method === 0) return Buffer.from(raw);
      if (method === 8) return inflateRawSync(raw);
      throw new Error(`unsupported compression method ${String(method)} for ${name}`);
    }

    entry += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`${wanted} not found in archive`);
};

// ── Shapefile ───────────────────────────────────────────────────────────────────

/** ESRI shape type for a polyline. Coastlines are open arcs, not closed polygons. */
const SHAPE_POLYLINE = 3;

/**
 * Every part of every record in a `.shp`, as rings of `[lon, lat]` in degrees.
 *
 * The header is big-endian, the record contents little-endian — a genuine property of
 * the format rather than a mistake here.
 */
const readShapefile = (shp) => {
  if (shp.readInt32BE(0) !== 9994) throw new Error('not a shapefile: bad file code');
  const declared = shp.readInt32BE(24) * 2;
  if (declared !== shp.length) {
    throw new Error(`shapefile length ${String(declared)} disagrees with ${String(shp.length)}`);
  }
  const shapeType = shp.readInt32LE(32);
  if (shapeType !== SHAPE_POLYLINE) {
    throw new Error(`expected polyline (${String(SHAPE_POLYLINE)}), got ${String(shapeType)}`);
  }

  const rings = [];
  let offset = 100;
  while (offset < shp.length) {
    const contentLength = shp.readInt32BE(offset + 4) * 2;
    const content = offset + 8;

    const partCount = shp.readInt32LE(content + 36);
    const pointCount = shp.readInt32LE(content + 40);
    const partsAt = content + 44;
    const pointsAt = partsAt + partCount * 4;

    const starts = [];
    for (let i = 0; i < partCount; i++) starts.push(shp.readInt32LE(partsAt + i * 4));

    for (let i = 0; i < partCount; i++) {
      const from = starts[i];
      const to = i + 1 < partCount ? starts[i + 1] : pointCount;
      const ring = [];
      for (let j = from; j < to; j++) {
        ring.push([shp.readDoubleLE(pointsAt + j * 16), shp.readDoubleLE(pointsAt + j * 16 + 8)]);
      }
      rings.push(ring);
    }
    offset = content + contentLength;
  }
  return rings;
};

// ── Simplification ──────────────────────────────────────────────────────────────

const toUnitVector = ([lon, lat]) => {
  const a = (lon * Math.PI) / 180;
  const b = (lat * Math.PI) / 180;
  const cosB = Math.cos(b);
  return [cosB * Math.cos(a), cosB * Math.sin(a), Math.sin(b)];
};

/**
 * Distance from `p` to the great circle through `a` and `b`, in metres.
 *
 * On the sphere rather than in the lon/lat plane, because a degree of longitude is
 * 111 km at the equator and 2 km at 89° N. Simplifying in degrees would hold Norway
 * to a tolerance fifty times tighter than Indonesia, for no reason anyone chose.
 */
const distanceToChord = (p, a, b) => {
  const P = toUnitVector(p);
  const A = toUnitVector(a);
  const B = toUnitVector(b);
  let n = [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]];
  const magnitude = Math.hypot(n[0], n[1], n[2]);
  if (magnitude < 1e-12) {
    // Endpoints coincide, or are antipodal: no great circle is defined, so fall back
    // to the distance from the first of them.
    return Math.hypot(P[0] - A[0], P[1] - A[1], P[2] - A[2]) * R_EARTH_EQ;
  }
  n = [n[0] / magnitude, n[1] / magnitude, n[2] / magnitude];
  return Math.abs(P[0] * n[0] + P[1] * n[1] + P[2] * n[2]) * R_EARTH_EQ;
};

/** Douglas–Peucker, iterative so a long ring cannot overflow the stack. */
const simplify = (points, toleranceM) => {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const pending = [[0, points.length - 1]];
  while (pending.length > 0) {
    const [from, to] = pending.pop();
    let worst = -1;
    let worstAt = -1;
    for (let i = from + 1; i < to; i++) {
      const d = distanceToChord(points[i], points[from], points[to]);
      if (d > worst) {
        worst = d;
        worstAt = i;
      }
    }
    if (worst > toleranceM && worstAt > 0) {
      keep[worstAt] = 1;
      pending.push([from, worstAt], [worstAt, to]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
};

// ── Encoding ────────────────────────────────────────────────────────────────────

/**
 * Quantise to `PRECISION` decimals and delta-encode each ring.
 *
 * The first pair of every ring is its absolute position; every pair after it is a
 * difference from the one before. Rounding happens *before* differencing, so the
 * running sum a decoder computes reproduces the quantised values exactly rather than
 * accumulating rounding error along the ring.
 */
const encode = (rings) => {
  const scale = Math.pow(10, PRECISION);
  return rings.map((ring) => {
    const out = [];
    let previousLon = 0;
    let previousLat = 0;
    for (const [lon, lat] of ring) {
      const qLon = Math.round(lon * scale);
      const qLat = Math.round(lat * scale);
      out.push(qLon - previousLon, qLat - previousLat);
      previousLon = qLon;
      previousLat = qLat;
    }
    return out;
  });
};

/**
 * Split any ring that crosses the antimeridian.
 *
 * A ring running from +179° to −179° is a two-degree step in reality and a
 * 358-degree one in the stored numbers. Nothing downstream can tell those apart from
 * the coordinates alone, so a renderer interpolating between them draws a line all the
 * way across the globe. Cutting the ring here means the data itself carries no such
 * segment and the renderer needs no special case.
 *
 * The cut is a split, not a clamp: both halves are kept, so no coastline disappears.
 */
const splitAtAntimeridian = (rings) => {
  const out = [];
  for (const ring of rings) {
    let run = [];
    let previous;
    for (const point of ring) {
      if (previous !== undefined && Math.abs(point[0] - previous[0]) > 180) {
        if (run.length >= 2) out.push(run);
        run = [];
      }
      run.push(point);
      previous = point;
    }
    if (run.length >= 2) out.push(run);
  }
  return out;
};

// ── Driver ──────────────────────────────────────────────────────────────────────

const main = async () => {
  const zip = await fetchArchive();
  const shp = extractFromZip(zip, 'ne_110m_coastline.shp');

  const raw = readShapefile(shp);
  const rawPoints = raw.reduce((n, r) => n + r.length, 0);

  const split = splitAtAntimeridian(raw);
  const simplified = split.map((ring) => simplify(ring, TOLERANCE_M));
  const keptPoints = simplified.reduce((n, r) => n + r.length, 0);

  const document = {
    // Provenance travels with the data. A number in the game should always be
    // traceable to what produced it without going through git history.
    source: SOURCE_URL,
    sourceVersion: SOURCE_VERSION,
    sourceSha256: SOURCE_SHA256,
    licence: 'Public domain (Natural Earth)',
    generatedBy: 'tools/coastlines/process.mjs',
    // Degrees, east-positive longitude and north-positive latitude, WGS-84 — the
    // shapefile's own convention, carried through unchanged.
    units: 'degrees',
    precision: PRECISION,
    toleranceMetres: TOLERANCE_M,
    ringCount: simplified.length,
    pointCount: keptPoints,
    /**
     * Delta-encoded rings. Within a ring: `[lon0, lat0, dLon, dLat, dLon, dLat, ...]`,
     * every value an integer in units of `10^-precision` degrees.
     */
    rings: encode(simplified),
  };

  // Metadata indented for reading, rings compact at one per line. Pretty-printing the
  // rings the same way would put every integer on its own line and take the file from
  // 46 kB to 117 kB — most of it whitespace, and a diff nobody can read either way.
  // One line per ring at least makes "which coastline changed" a legible question.
  //
  // `.prettierignore` carries this file, because Prettier would expand those lines
  // straight back out again.
  const { rings, ...meta } = document;
  const head = JSON.stringify(meta, undefined, 2).slice(0, -2);
  const body = rings.map((ring) => `    ${JSON.stringify(ring)}`).join(',\n');
  const json = `${head},\n  "rings": [\n${body}\n  ]\n}\n`;
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, json);

  const gzip = (await import('node:zlib')).gzipSync(Buffer.from(json)).length;
  process.stderr.write(
    `wrote ${OUTPUT}\n` +
      `  rings   ${String(simplified.length)}\n` +
      `  points  ${String(keptPoints)} of ${String(rawPoints)} ` +
      `(${((100 * keptPoints) / rawPoints).toFixed(1)}% kept at ${String(TOLERANCE_M)} m)\n` +
      `  size    ${(json.length / 1024).toFixed(1)} kB raw, ${(gzip / 1024).toFixed(1)} kB gzip\n`,
  );
};

await main();
