// Bundle-size budgets (NFR-020, docs/PRODUCT.md §11.9).
//
// Four entries, not two. §11.9 gives every budget both a target and a hard limit,
// and the distinction is worth keeping: the target is what the game is designed to
// fit in, the hard limit is what it must never exceed. Encoding only the target
// loses the hard limit; encoding only the hard limit lets the number drift for a
// year before anyone hears about it. The target entries are what actually gate a
// pull request -- a hard-limit entry cannot fail without its target having failed
// first -- but naming both in the report keeps the headroom legible against the
// number that really matters.
//
// `gzip: true` is load-bearing. size-limit has defaulted to brotli since v9, and
// NFR-020 is written in gzip. Dropping this flag would silently report a smaller
// number against the same budget and quietly widen the gate.
//
// Sizes are decimal, matching the spec's notation: size-limit parses limits with
// bytes-iec, where `kB` is 1000 bytes and `KiB` would be 1024.

import { initialLoad, initialScripts } from './tools/size/initial-files.mjs';

const scripts = initialScripts();
const firstLoad = initialLoad();

export default [
  {
    name: 'Initial JS · NFR-020 target',
    path: scripts,
    limit: '400 kB',
    gzip: true,
  },
  {
    name: 'Initial JS · §11.9 hard limit',
    path: scripts,
    limit: '600 kB',
    gzip: true,
  },
  {
    name: 'First load, total · NFR-020 target',
    path: firstLoad,
    limit: '700 kB',
    gzip: true,
  },
  {
    name: 'First load, total · §11.9 hard limit',
    path: firstLoad,
    limit: '1 MB',
    gzip: true,
  },
];
