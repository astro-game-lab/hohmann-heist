/**
 * The Codex's screens — #161's criteria, and #163's cross-references.
 *
 * The behaviours worth a test are the ones a type cannot state: that a deep link opens the
 * entry it names *at the layer it names*, that an unknown slug is a named failure rather
 * than a blank page, that reading an entry marks it read exactly once, and that the concept
 * `C` opens for a contract is a concept that contract actually teaches.
 */
import { CODEX_ENTRIES, createCatalogue } from '@hh/ui';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { contractById, contracts } from '../contracts/registry.js';

import { CodexScreen, layerFrom } from './CodexScreen.js';
import { CONCEPTS, conceptFor } from './current.js';

const catalogue = createCatalogue({ onMissingKey: 'throw' });
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

const el = (testId: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${testId}"]`);

const mount = async (
  props: Partial<Parameters<typeof CodexScreen>[0]> = {},
): Promise<ReturnType<typeof vi.fn>> => {
  const onRead = vi.fn();
  await act(() => {
    render(
      <CodexScreen
        t={catalogue.resolve}
        slug={null}
        search=""
        read={[]}
        onRead={onRead}
        {...props}
      />,
      container,
    );
  });
  return onRead;
};

describe('the index', () => {
  it('lists every entry, grouped by act', async () => {
    await mount();
    expect(el('codex-index')).not.toBeNull();
    for (const entry of Object.values(CODEX_ENTRIES)) {
      expect(el(`codex-index-${entry.slug}`), entry.slug).not.toBeNull();
    }
  });

  it('links each entry at its own route, which is what a deep link is', async () => {
    await mount();
    for (const entry of Object.values(CODEX_ENTRIES)) {
      expect(el(`codex-index-${entry.slug}`)?.getAttribute('href')).toBe(`#/codex/${entry.slug}`);
    }
  });

  /** `flags.codexRead` marks an entry; it never hides one. */
  it('badges what has been read without removing it', async () => {
    await mount({ read: ['phasing-orbits'] });
    expect(el('codex-read-phasing-orbits')).not.toBeNull();
    expect(el('codex-index-phasing-orbits')).not.toBeNull();
    expect(el('codex-read-departure-timing')).toBeNull();
  });

  it('marks nothing read merely by being listed', async () => {
    const onRead = await mount();
    expect(onRead).not.toHaveBeenCalled();
  });
});

describe('an entry', () => {
  it('renders all four layers', async () => {
    await mount({ slug: 'phasing-orbits' });
    expect(el('codex-entry-phasing-orbits')).not.toBeNull();
    expect(el('codex-layer-sentence')).not.toBeNull();
    expect(el('codex-layer-diagram')).not.toBeNull();
    expect(el('codex-layer-numbers')).not.toBeNull();
    expect(el('codex-layer-simplifications')).not.toBeNull();
  });

  /**
   * §8.3.10's progressive disclosure, as the default state: the sentence and the picture
   * are there on arrival, the derivation and the departures are a click away. The `<details>`
   * elements exist either way — closed is not absent — which is what keeps the browser's own
   * in-page search able to find them.
   */
  it('opens the first two layers and collapses the last two', async () => {
    await mount({ slug: 'phasing-orbits' });
    expect((el('codex-layer-numbers') as HTMLDetailsElement).open).toBe(false);
    expect((el('codex-layer-simplifications') as HTMLDetailsElement).open).toBe(false);
  });

  it('opens at the layer a link asks for', async () => {
    await mount({ slug: 'phasing-orbits', search: 'layer=numbers' });
    expect((el('codex-layer-numbers') as HTMLDetailsElement).open).toBe(true);
    // And only that one. A link into the numbers is not a link into everything.
    expect((el('codex-layer-simplifications') as HTMLDetailsElement).open).toBe(false);
  });

  it('ignores a layer it does not recognise rather than refusing the entry', () => {
    expect(layerFrom('layer=numbers')).toBe('numbers');
    expect(layerFrom('layer=nonsense')).toBeUndefined();
    expect(layerFrom('')).toBeUndefined();
  });

  it('marks itself read, once', async () => {
    const onRead = await mount({ slug: 'the-hohmann-transfer' });
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith('the-hohmann-transfer');
  });

  it('names the contracts it is seen in', async () => {
    await mount({ slug: 'phasing-orbits' });
    const seen = el('codex-seen-in')?.textContent ?? '';
    // C05's title, from the registry rather than from a string written here.
    expect(seen).toContain(contractById('c05-tailgate')?.document.title ?? 'MISSING');
  });
});

describe('a slug that names nothing — §8.7', () => {
  it('says what failed and shows the index rather than a blank page', async () => {
    await mount({ slug: 'not-an-entry' });
    expect(el('codex-unknown')).not.toBeNull();
    expect(el('codex-unknown')?.textContent).toContain('not-an-entry');
    expect(el('codex-index')).not.toBeNull();
  });

  it('marks nothing read', async () => {
    const onRead = await mount({ slug: 'not-an-entry' });
    expect(onRead).not.toHaveBeenCalled();
  });
});

describe('§8.5.3’s “current concept”', () => {
  it('has a concept for every shipped contract', () => {
    for (const scenario of contracts()) {
      expect(conceptFor(scenario.id), scenario.id).not.toBeNull();
    }
  });

  it('opens the index where there is no contract', () => {
    expect(conceptFor(null)).toBeNull();
    expect(conceptFor('not-a-contract')).toBeNull();
  });

  /**
   * The check that keeps the hand-written table honest — `current.ts` says why it is
   * hand-written rather than derived.
   *
   * A row may point at any entry it likes, provided that entry admits to being seen in
   * that contract. Without this, a table entry could quietly send C04 to the phasing
   * entry and nothing would notice: both sides would still resolve.
   */
  it('only points a contract at an entry that lists it', () => {
    for (const [contractId, slug] of Object.entries(CONCEPTS)) {
      expect(CODEX_ENTRIES[slug].seenIn, `${contractId} → ${slug}`).toContain(contractId);
    }
  });

  it('points at contracts that ship', () => {
    const shipped = new Set(contracts().map((scenario) => scenario.id));
    for (const contractId of Object.keys(CONCEPTS)) {
      expect(shipped, contractId).toContain(contractId);
    }
  });
});

describe('“seen in” names real contracts', () => {
  it('resolves every id every entry claims', () => {
    const shipped = new Set(contracts().map((scenario) => scenario.id));
    for (const entry of Object.values(CODEX_ENTRIES)) {
      for (const id of entry.seenIn) {
        expect(shipped, `${entry.slug}: ${id}`).toContain(id);
      }
    }
  });
});
