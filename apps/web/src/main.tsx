import { render } from 'preact';

import { App } from './app.js';

import './app.css';

const root = document.getElementById('app');
if (root === null) {
  throw new Error('missing #app mount point in index.html');
}
render(<App />, root);
