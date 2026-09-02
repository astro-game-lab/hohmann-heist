import { describe, expect, it } from 'vitest';

import { hrefFor, parseHash } from './router.js';

describe('parseHash', () => {
  it('resolves the title route from the empty and root hashes', () => {
    for (const hash of ['', '#', '#/', '/']) {
      expect(parseHash(hash).name, hash).toBe('title');
    }
  });

  it('resolves static routes', () => {
    expect(parseHash('#/board').name).toBe('board');
    expect(parseHash('#/daily').name).toBe('daily');
    expect(parseHash('#/replay').name).toBe('replay');
    expect(parseHash('#/settings').name).toBe('settings');
  });

  it('captures parameters', () => {
    expect(parseHash('#/contract/5')).toMatchObject({ name: 'contract', params: { id: '5' } });
    expect(parseHash('#/codex/phasing')).toMatchObject({
      name: 'codex',
      params: { slug: 'phasing' },
    });
    expect(parseHash('#/leaderboard/2026-09-01')).toMatchObject({
      name: 'leaderboard',
      params: { date: '2026-09-01' },
    });
  });

  // Order matters in the route table: the specific pattern must win.
  it('prefers /daily/:date over /daily', () => {
    expect(parseHash('#/daily/2026-09-01')).toMatchObject({
      name: 'dailyDate',
      params: { date: '2026-09-01' },
    });
    expect(parseHash('#/daily').name).toBe('daily');
  });

  it('tolerates a hash with no leading slash', () => {
    expect(parseHash('#board').name).toBe('board');
  });

  it('ignores a query string', () => {
    expect(parseHash('#/replay?s=c05&r=abc')).toMatchObject({ name: 'replay', path: '/replay' });
  });

  it('decodes percent-encoded parameters', () => {
    expect(parseHash('#/codex/why%20slower').params['slug']).toBe('why slower');
  });

  it('resolves an unknown path to notFound rather than throwing', () => {
    // A bad URL is something to render, not a crash.
    expect(parseHash('#/nope').name).toBe('notFound');
    expect(parseHash('#/contract').name).toBe('notFound');
    expect(parseHash('#/contract/5/extra').name).toBe('notFound');
  });

  it('does not treat a trailing slash as a different route', () => {
    expect(parseHash('#/board/').name).toBe('board');
  });
});

describe('hrefFor', () => {
  it('builds a hash href', () => {
    expect(hrefFor('/board')).toBe('#/board');
    expect(hrefFor('board')).toBe('#/board');
  });

  it('round-trips through parseHash', () => {
    for (const path of ['/', '/board', '/contract/12', '/codex/phasing']) {
      expect(parseHash(hrefFor(path)).path).toBe(path === '/' ? '/' : path);
    }
  });
});
