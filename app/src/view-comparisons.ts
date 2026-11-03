import { type StaleMessage, staleKey, staleMessage } from "./stale-message";
import type { Rename, StaleReport } from "./stale-report";

export type Comparison = {
  name: string;
  title: string;
  viewCommit: string | null;
  scanCommit: string | null;
  run: () => Promise<StaleReport>;
};

export type ViewComparisons = {
  compare: (
    comparison: Comparison,
    post: (message: StaleMessage) => void,
  ) => Promise<StaleReport>;
  renames: (
    name: string,
    viewCommit: string,
    scanCommit: string | null,
    fetch: () => Promise<Rename[]>,
  ) => Promise<Rename[]>;
  settled: (
    name: string,
    viewCommit: string | null,
    scanCommit: string | null,
  ) => StaleReport | null;
  heldKeys: (scanCommit: string | null) => string[];
  drop: (name: string) => void;
  onUpdate: (handler: (name: string) => void) => () => void;
  requestUpdate: (name: string) => void;
};

type Entry = {
  name: string;
  scanCommit: string | null;
  promise: Promise<StaleReport>;
  report: StaleReport | null;
  key: string | null;
};

export function createViewComparisons(): ViewComparisons {
  const entries = new Map<string, Entry>();
  const renames = new Map<
    string,
    { name: string; promise: Promise<Rename[]> }
  >();
  let handler: ((name: string) => void) | null = null;

  const idOf = (
    name: string,
    viewCommit: string | null,
    scanCommit: string | null,
  ) => staleKey(name, viewCommit, scanCommit);

  return {
    compare(comparison, post) {
      const { name, title, viewCommit, scanCommit } = comparison;
      const id = idOf(name, viewCommit, scanCommit);
      const existing = entries.get(id);

      if (existing !== undefined) {
        return existing.promise;
      }

      const entry: Entry = {
        name,
        scanCommit,
        report: null,
        key: null,
        promise: Promise.resolve().then(comparison.run),
      };

      entries.set(id, entry);
      entry.promise = entry.promise.then((report) => {
        if (entries.get(id) !== entry) {
          return report;
        }

        entry.report = report;

        const message = staleMessage({
          name,
          title,
          viewCommit,
          scanCommit,
          report,
        });

        if (message !== null) {
          entry.key = message.key;
          post(message);
        }

        return report;
      });

      return entry.promise;
    },

    renames(name, viewCommit, scanCommit, fetch) {
      const id = idOf(name, viewCommit, scanCommit);
      const held = renames.get(id);

      if (held !== undefined) {
        return held.promise;
      }

      const promise = fetch();

      renames.set(id, { name, promise });

      return promise;
    },

    settled(name, viewCommit, scanCommit) {
      return entries.get(idOf(name, viewCommit, scanCommit))?.report ?? null;
    },

    heldKeys(scanCommit) {
      return [...entries.values()].flatMap((entry) =>
        entry.scanCommit === scanCommit && entry.key !== null
          ? [entry.key]
          : [],
      );
    },

    drop(name) {
      for (const [id, entry] of renames) {
        if (entry.name === name) {
          renames.delete(id);
        }
      }

      for (const [id, entry] of entries) {
        if (entry.name === name) {
          entries.delete(id);
        }
      }
    },

    onUpdate(next) {
      handler = next;

      return () => {
        if (handler === next) {
          handler = null;
        }
      };
    },

    requestUpdate(name) {
      handler?.(name);
    },
  };
}
