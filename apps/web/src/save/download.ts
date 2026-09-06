/**
 * Getting the save out of the browser and back in — FR-703, §11.7, §13.5's E14 (#185).
 *
 * > *Export/import is the same JSON, downloadable. This is also the only "cloud save":
 * > the player carries it.*
 *
 * `transfer.ts` already does the hard half — a canonical, byte-stable document and a
 * validating read — and its correctness is not this file's problem. What is missing is
 * everything around it: a file with a name, a picker, and the two sentences a player needs
 * before they destroy something.
 *
 * ## Why the browser parts are parameters
 *
 * `createObjectURL`, the anchor click, and the clock all arrive as arguments with browser
 * defaults, following `motion.ts`'s `MotionHost`. jsdom implements none of the three
 * usefully — there is no download, and a `Blob` read back is asynchronous — so a test that
 * used the ambient globals could only assert that nothing threw. With the seams named, the
 * whole export path is checkable: *this* text, under *that* filename, with the object URL
 * revoked afterwards.
 *
 * ## It has to work when storage does not
 *
 * Every function here takes a `SaveV1` — the in-memory save — and never reads
 * `localStorage`. That is #184's requirement and it is a structural property rather than a
 * promise: a player in a browser that will not store can still carry the file, and the
 * export they get is the progress they actually have rather than the empty document a
 * re-read would return.
 */
import { exportSave } from './transfer.js';
import { MEDALS, type Medal, type SaveV1 } from './schema.js';

/** The part of the platform an export needs, named so a test can supply it. */
export interface DownloadHost {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  /** Hands the file to the browser. The default clicks a detached anchor. */
  deliver(url: string, filename: string): void;
}

/**
 * A filename with the date **and the time** in it.
 *
 * The date alone is not enough to distinguish two exports, and two exports on one day is
 * the common case rather than the edge one — a player exports before importing something,
 * which #185 asks the confirmation to offer, and then exports again after playing. Same
 * name means the second silently becomes `(1)` in the download folder, or replaces the
 * first, depending on the browser.
 *
 * Minutes rather than seconds: enough to separate two deliberate acts, short enough to
 * read. Hyphen-separated and sorted big-endian, so the folder sorts chronologically.
 */
export const exportFilename = (now: Date = new Date()): string => {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp =
    `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `hohmann-heist-save-${stamp}.json`;
};

/** The default host: a `Blob` URL handed to a detached anchor. */
export const browserDownloadHost = (): DownloadHost => ({
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => {
    URL.revokeObjectURL(url);
  },
  deliver: (url, filename) => {
    // Detached rather than appended: nothing needs it in the document, and an anchor left
    // behind in the tree would be a tab stop leading nowhere.
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  },
});

/**
 * Download the save as the canonical indented document.
 *
 * The object URL is revoked immediately after the click. That is safe — the browser has
 * already taken a reference by the time `click` returns — and skipping it leaks the whole
 * document for the life of the page, which for a feature a player may use twice is a leak
 * nobody would ever notice and nobody should ship.
 */
export const downloadSave = (
  save: SaveV1,
  host: DownloadHost = browserDownloadHost(),
  now: Date = new Date(),
): string => {
  const text = exportSave(save);
  const filename = exportFilename(now);
  // `application/json` rather than `text/plain`, so a browser that offers to open it
  // rather than save it opens it as what it is.
  const url = host.createObjectURL(new Blob([text], { type: 'application/json' }));
  try {
    host.deliver(url, filename);
  } finally {
    host.revokeObjectURL(url);
  }
  return filename;
};

/**
 * What is about to be lost, in terms a player recognises.
 *
 * #185: the confirmation *"states what is being replaced (contract count, best medals)
 * rather than asking an abstract 'are you sure'"*. An abstract confirmation trains people
 * to click through it; a count they recognise is the one thing that makes them stop when
 * the number is bigger than they expected.
 *
 * "Completed" is a contract with a medal rather than one with attempts: attempts include
 * briefings accepted and abandoned, and telling a player they are about to lose eleven
 * contracts when they have finished two would be alarming and wrong.
 */
export interface SaveSummary {
  readonly contracts: number;
  /** Best medals held, highest first — `MEDALS` reversed, and only the ones held. */
  readonly medals: readonly { readonly medal: Medal; readonly count: number }[];
}

export const summarise = (save: SaveV1): SaveSummary => {
  const held = new Map<Medal, number>();
  let contracts = 0;
  for (const progress of Object.values(save.contracts)) {
    if (progress.medal === undefined) continue;
    contracts += 1;
    held.set(progress.medal, (held.get(progress.medal) ?? 0) + 1);
  }

  return {
    contracts,
    // Iterated over `MEDALS` rather than over the map, so the order is §6.7's and not
    // whatever order the contracts happened to be completed in — the same reason
    // `transfer.ts` sorts every map it serialises.
    medals: [...MEDALS]
      .reverse()
      .map((medal) => ({ medal, count: held.get(medal) ?? 0 }))
      .filter((row) => row.count > 0),
  };
};

/**
 * Read a picked file as text.
 *
 * `File.text()` rather than a `FileReader`: it is a promise, it is in every browser
 * §11.15 names, and the callback form exists only to support browsers this game does not.
 * A read that fails resolves to a refusal rather than rejecting, so the caller has one
 * shape to render and no path where a rejected promise escapes into the console.
 */
export type FileReadResult = { readonly ok: true; readonly text: string } | { readonly ok: false };

export const readFileText = async (file: Blob): Promise<FileReadResult> => {
  try {
    return { ok: true, text: await file.text() };
  } catch {
    return { ok: false };
  }
};
