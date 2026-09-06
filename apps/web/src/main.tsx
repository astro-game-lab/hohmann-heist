/**
 * The application's entry point.
 *
 * It does one thing beyond mounting, and that is honouring #126's pre-boot verdict. The
 * capability check in `index.html` runs before this file is fetched and sets
 * `__HH_UNSUPPORTED__` when the browser is missing something the game needs — and two of
 * the three things it checks (`structuredClone`, Canvas 2D) can be absent on an engine that
 * parses this bundle perfectly well. Without this guard the module would mount over the
 * page that just explained why the game cannot run, and the player would be back to a
 * broken-looking screen.
 *
 * Read off `window` rather than passed in, because there is no channel between an inline
 * ES5 script and an ES module other than a global, and declared here rather than in a
 * global `.d.ts` so the coupling is visible from the file that depends on it.
 */
import { render } from 'preact';

import { App } from './app.js';

import './app.css';

declare global {
  interface Window {
    /** Set by `index.html`'s pre-boot check — §11.15, #126. */
    __HH_UNSUPPORTED__?: boolean;
  }
}

if (window.__HH_UNSUPPORTED__ !== true) {
  const root = document.getElementById('app');
  if (root === null) {
    throw new Error('missing #app mount point in index.html');
  }

  /*
   * Take §8.7's first-load skeleton down before mounting.
   *
   * `render(vnode, parent)` **diffs against whatever is already in `parent`** — it does not
   * clear it — so leaving the skeleton in place appends the application beside it and
   * leaves a second, dead "Hohmann Heist" at the bottom of every screen. Verified in the
   * browser rather than deduced: it renders, and it reaches the accessibility tree.
   *
   * Removed by id rather than by clearing `#app`, so this cannot quietly delete anything
   * else that ends up in the mount point later. Synchronous and immediately before the
   * render, so nothing paints in between.
   */
  document.getElementById('hh-boot')?.remove();

  render(<App />, root);
}
