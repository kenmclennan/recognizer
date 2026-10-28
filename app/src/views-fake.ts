import type { Scan } from "recognizer";
import { VIEW_NAME, type ViewsPort } from "./views-port";

export type FakeViews = ViewsPort & {
  files: Map<string, string>;
  current: string[];
  copied: string[];
  renames: { from: string; to: string }[];
  renamed: { from: string; to: string }[];
  scansByCommit: Map<string, Scan[] | null>;
  edit(name: string, text: string | null): void;
  settle(): Promise<void>;
};

export function fakeViews(
  initial: Record<string, string> = {},
  options: {
    delayScans?: boolean;
    listError?: string;
    writeError?: string;
    refused?: string[];
  } = {},
): FakeViews {
  const files = new Map(Object.entries(initial));
  const listeners = new Set<() => void>();
  const current: string[] = [];
  const copied: string[] = [];
  const scansByCommit = new Map<string, Scan[] | null>();
  const waiting: (() => void)[] = [];
  const fake: FakeViews = {
    files,
    current,
    copied,
    renames: [],
    renamed: [],
    scansByCommit,
    async list() {
      if (options.listError !== undefined) {
        throw new Error(options.listError);
      }

      return {
        views: [...files].map(([name, text]) => ({ name, text })),
        refused: options.refused ?? [],
      };
    },
    async write(name, text) {
      if (options.writeError !== undefined) {
        throw new Error(options.writeError);
      }

      if (!VIEW_NAME.test(name)) {
        throw new Error(`${name} is not a valid view name`);
      }

      files.set(name, text);
    },
    async rename(from, to) {
      const text = files.get(from);

      if (!VIEW_NAME.test(from) || !VIEW_NAME.test(to)) {
        throw new Error("not a valid view name");
      }

      if (text === undefined) {
        throw new Error(`there is no view named ${from}`);
      }

      if (files.has(to)) {
        throw new Error(`${to} already exists`);
      }

      files.delete(from);
      files.set(to, text);
      fake.renamed.push({ from, to });
    },
    async writeCurrent(text) {
      current.push(text);
    },
    async path(name) {
      if (!VIEW_NAME.test(name)) {
        throw new Error(`${name} is not a valid view name`);
      }

      return `/repo/.recognizer/views/${name}.json`;
    },
    async renamesSince() {
      return fake.renames;
    },
    async scansAt(commit) {
      if (options.delayScans) {
        await new Promise<void>((resolve) => waiting.push(resolve));
      }

      return scansByCommit.get(commit) ?? null;
    },
    async copy(text) {
      copied.push(text);
    },
    onChanged(run) {
      listeners.add(run);

      return () => listeners.delete(run);
    },
    edit(name, text) {
      if (text === null) {
        files.delete(name);
      } else {
        files.set(name, text);
      }

      for (const run of listeners) {
        run();
      }
    },
    async settle() {
      for (const release of waiting.splice(0)) {
        release();
      }

      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };

  return fake;
}
