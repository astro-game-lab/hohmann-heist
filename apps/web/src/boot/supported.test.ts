/**
 * §11.15's pre-boot capability check — #126.
 *
 * The check lives inline in `index.html` and **there is no second copy of it here**. That
 * is deliberate: the script has to run before the bundle exists, so it cannot be a module,
 * and a TypeScript twin kept beside it for testability would be two implementations that
 * drift — with the one that ships being the one nobody tested.
 *
 * So this test reads the real `index.html`, pulls out the real script, and drives it. Two
 * claims to keep, and they are #126's own:
 *
 * 1. **It parses on a browser without ES2022.** Checked by syntax, since the test runner
 *    obviously parses everything: the extracted source must contain no post-ES5 grammar.
 * 2. **It blocks the right things.** ES2022, `structuredClone` and Canvas 2D — and
 *    explicitly *not* `CompressionStream`, which §11.15 says has an `fflate` fallback and
 *    which would lock out players who could play.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Read from the workspace root rather than from `import.meta.url`, following
// `app.css.test.ts`: Vite rewrites `import.meta.url` to a served URL rather than a `file:`
// one, so the usual `fileURLToPath` idiom does not survive here. Vitest runs with the
// workspace root as its working directory.
const html = readFileSync(join(process.cwd(), 'apps', 'web', 'index.html'), 'utf8');

/** The pre-boot script, as it will actually ship. */
const checkSource = (): string => {
  const match = /<script id="hh-boot-check">([\s\S]*?)<\/script>/.exec(html);
  if (match?.[1] === undefined) throw new Error('the pre-boot check is missing from index.html');
  return match[1];
};

/**
 * The script with its commentary removed — what the syntax assertions below look at.
 *
 * They have to, because the comments legitimately contain backticks and `?.` while
 * *quoting* JavaScript, and a check that flagged those would be a check that punished
 * explaining the code. Full-line `//` comments only, matched on the trimmed line, so the
 * `'https://…'` inside the source link is never mistaken for one.
 */
const checkCode = (): string =>
  checkSource()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

/** What the check needs from a browser, so a test can supply a broken one. */
interface FakeWindow {
  __HH_UNSUPPORTED__?: boolean;
}

interface Capabilities {
  readonly hasEs2022?: boolean;
  readonly hasStructuredClone?: boolean;
  readonly hasCanvas?: boolean;
  readonly hasCompressionStream?: boolean;
}

/**
 * Run the real script against a synthesised environment.
 *
 * The globals it reads are shadowed by parameters rather than assigned onto `globalThis`,
 * so a case that removes `structuredClone` cannot remove it from the test runner as well.
 */
const runCheck = (capabilities: Capabilities): { unsupported: boolean; reason: string } => {
  const {
    hasEs2022 = true,
    hasStructuredClone = true,
    hasCanvas = true,
    hasCompressionStream = true,
  } = capabilities;

  const page: { id?: string; text: string } = { text: '' };

  const element = (): Record<string, unknown> => {
    const node: Record<string, unknown> = {
      style: {},
      firstChild: null,
      appendChild: (child: unknown) => {
        if (typeof child === 'object' && child !== null && 'nodeValue' in child) {
          page.text += String(child.nodeValue);
        }
        return child;
      },
      removeChild: () => undefined,
      getContext: () => (hasCanvas ? {} : null),
    };
    return node;
  };

  const fakeDocument = {
    getElementById: (id: string) => (id === 'app' ? element() : null),
    createElement: () => element(),
    createTextNode: (nodeValue: string) => ({ nodeValue }),
  };

  const fakeWindow: FakeWindow = {};

  // ES2022's *library* surface, which is what the check reads.
  const fakeObject = hasEs2022 ? Object : { ...Object, hasOwn: undefined };
  const fakeArray = hasEs2022 ? Array : { prototype: { at: undefined } };
  const fakeString = hasEs2022 ? String : { prototype: { replaceAll: undefined } };
  const fakeFunction = hasEs2022
    ? Function
    : function BrokenFunction() {
        throw new SyntaxError('unexpected token');
      };

  /*
   * `new Function` on purpose, and the rule that forbids it is right everywhere else.
   *
   * The script under test is a string in an HTML file — that is the whole point of it, and
   * the reason it cannot be imported. Evaluating it is the only way to test the code that
   * actually ships rather than a TypeScript twin that drifts from it. The input is a file
   * in this repository, not user data, so the "implied eval" hazard the rule guards
   * against does not apply.
   *
   * Naming the globals as parameters is what makes this safe *for the test runner*: the
   * script sees only what is passed here, so a case that removes `structuredClone` cannot
   * remove it from the process.
   */
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- see above
  const run = new Function(
    'document',
    'window',
    'structuredClone',
    'CompressionStream',
    'Object',
    'Array',
    'String',
    'Function',
    checkSource(),
  ) as (...args: readonly unknown[]) => void;

  run(
    fakeDocument,
    fakeWindow,
    hasStructuredClone ? structuredClone : undefined,
    // Present or absent is all the check reads; it never calls it.
    hasCompressionStream
      ? function CompressionStream(): void {
          return undefined;
        }
      : undefined,
    fakeObject,
    fakeArray,
    fakeString,
    fakeFunction,
  );

  return { unsupported: fakeWindow.__HH_UNSUPPORTED__ === true, reason: page.text };
};

describe('the pre-boot capability check', () => {
  describe('is written so it can run on the browsers it rejects', () => {
    /**
     * #126's second criterion. The check cannot be written in the syntax it is testing
     * for: a browser that cannot parse ES2022 would fail to parse the whole file, the
     * check would never run, and the player would get the blank page it exists to prevent.
     */
    const source = checkCode();

    it('uses no arrow functions', () => {
      expect(source).not.toMatch(/=>/);
    });

    it('uses no let or const', () => {
      expect(source).not.toMatch(/\b(?:let|const)\s/);
    });

    it('uses no template literals', () => {
      expect(source).not.toMatch(/`/);
    });

    it('uses no optional chaining or nullish coalescing', () => {
      // Outside the one `new Function` probe string, which is *meant* to be ES2022 and is
      // inside a try — it is the corroborating signal, never the only one.
      const withoutProbe = source.replace(/new Function\([\s\S]*?\)\(\);/, '');
      expect(withoutProbe).not.toMatch(/\?\./);
      expect(withoutProbe).not.toMatch(/\?\?/);
    });

    it('detects by feature rather than by eval of modern syntax alone', () => {
      expect(source).toContain('Object.hasOwn');
      expect(source).toContain('Array.prototype.at');
      expect(source).toContain('String.prototype.replaceAll');
    });
  });

  describe('lets a supported browser through', () => {
    it('sets no flag and renders nothing', () => {
      const { unsupported, reason } = runCheck({});
      expect(unsupported).toBe(false);
      expect(reason).toBe('');
    });

    /**
     * §11.15 lists `CompressionStream` and then says a ~3 kB `fflate` fallback covers the
     * Safari versions without it. Blocking on it would lock out players who can play,
     * which is worse than the blank page this whole mechanism exists to fix.
     */
    it('does not block a browser missing CompressionStream', () => {
      expect(runCheck({ hasCompressionStream: false }).unsupported).toBe(false);
    });
  });

  describe('stops an unsupported browser', () => {
    it('blocks a browser without ES2022 and names it', () => {
      const { unsupported, reason } = runCheck({ hasEs2022: false });
      expect(unsupported).toBe(true);
      expect(reason).toContain('ES2022');
    });

    it('blocks a browser without structuredClone and names it', () => {
      const { unsupported, reason } = runCheck({ hasStructuredClone: false });
      expect(unsupported).toBe(true);
      expect(reason).toContain('structuredClone');
    });

    it('blocks a browser without Canvas 2D and names it', () => {
      const { unsupported, reason } = runCheck({ hasCanvas: false });
      expect(unsupported).toBe(true);
      expect(reason).toContain('Canvas 2D');
    });

    /** §11.15's matrix, stated to the person affected by it. */
    it('shows the support matrix', () => {
      const { reason } = runCheck({ hasCanvas: false });
      expect(reason).toContain('Chrome');
      expect(reason).toContain('Firefox');
      expect(reason).toContain('Safari 17');
      expect(reason).toContain('Samsung Internet');
    });
  });

  /**
   * The flag `main.tsx` reads. Without it the bundle would mount over the page the check
   * just rendered on the two failures an ES2022-capable engine can still have.
   */
  it('signals the application not to mount', () => {
    expect(checkSource()).toContain('__HH_UNSUPPORTED__');
    expect(runCheck({ hasCanvas: false }).unsupported).toBe(true);
  });

  /**
   * NFR-020. The check ships on every load, so its cost is paid by every player —
   * including the ones it never fires for, which is nearly all of them.
   *
   * **Measured on the source, comments included, because that is what ships.** Vite does
   * not minify inline `<script>` in HTML: the built `dist/index.html` carries this block
   * verbatim. Measured at 4 379 bytes raw and 1 572 gzipped, inside an `index.html` that
   * is 11.2 kB raw and 4.1 kB gzipped in total — about 1% of NFR-020's 400 kB gzip budget,
   * against a bundle measured at 117 kB gzip.
   *
   * The commentary is most of those bytes and stays, deliberately. This is the one script
   * in the project that cannot be debugged where it runs — by the time it matters, the
   * browser running it cannot load the tools that would explain it — so the explanation
   * has to travel with it.
   *
   * 5 kB is a ceiling a little above the measurement, so a sentence added to a comment
   * does not fail CI but a second capability check with its own page would.
   */
  it('costs under 5 kB, which is what ships', () => {
    expect(checkSource().length).toBeLessThan(5120);
  });
});
