// Resolve the files a browser actually fetches on a first load.
//
// NFR-020 budgets the *initial* bundle, which is a smaller set than "everything
// in dist": it is the entry chunk plus what that chunk statically imports, and
// the stylesheets and assets those chunks pull in. It is not the lazy-loaded
// chunks, and it is not the source maps, which a browser fetches only when
// devtools are already open.
//
// Vite's build manifest is the only thing that knows which files those are.
// Globbing `dist/assets/*.js` gives the same answer today, because there is one
// chunk, and would quietly give the wrong one the day a route is split out --
// counting a lazy chunk against a budget for the initial load, and blaming a
// code-splitting improvement for making the number worse.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DIST = join(REPO_ROOT, 'apps', 'web', 'dist');

const MANIFEST = join(DIST, '.vite', 'manifest.json');

function readManifest() {
  let raw;
  try {
    raw = readFileSync(MANIFEST, 'utf8');
  } catch (cause) {
    throw new Error(
      `No Vite build manifest at ${MANIFEST}.\n` + 'Run `pnpm build` before measuring bundle size.',
      { cause },
    );
  }
  const manifest = JSON.parse(raw);
  if (!Object.values(manifest).some((chunk) => chunk.isEntry)) {
    throw new Error(`${MANIFEST} declares no entry chunk; the build is not usable.`);
  }
  return manifest;
}

// Breadth-first over `imports` only. `dynamicImports` is deliberately not
// followed: a dynamic import is a separate request made later, which is the
// whole point of splitting one out.
function collect(manifest) {
  const scripts = new Set();
  const styles = new Set();
  const documents = new Set();

  const seen = new Set();
  const queue = Object.entries(manifest)
    .filter(([, chunk]) => chunk.isEntry)
    .map(([key]) => key);

  for (const key of queue) {
    if (key.endsWith('.html')) documents.add(key);
  }

  while (queue.length > 0) {
    const key = queue.shift();
    if (seen.has(key)) continue;
    seen.add(key);

    const chunk = manifest[key];
    if (!chunk) continue;

    if (chunk.file?.endsWith('.js')) scripts.add(chunk.file);
    else if (chunk.file) styles.add(chunk.file);

    for (const file of chunk.css ?? []) styles.add(file);
    for (const file of chunk.assets ?? []) styles.add(file);
    for (const imported of chunk.imports ?? []) queue.push(imported);
  }

  return { scripts, styles, documents };
}

const absolute = (files) => [...files].map((file) => join(DIST, file));

/** Every JavaScript file on the initial load path. Budgeted by NFR-020 at 400 kB gzip. */
export function initialScripts() {
  return absolute(collect(readManifest()).scripts);
}

/** Everything the browser transfers for a first load: document, scripts, styles, assets. */
export function initialLoad() {
  const { scripts, styles, documents } = collect(readManifest());
  return absolute([...documents, ...scripts, ...styles]);
}
