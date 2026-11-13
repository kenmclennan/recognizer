import type { Scan } from "recognizer";
import {
  type ChangeRange,
  type RangeMembers,
  VIEW_NAME,
  type ViewsPort,
} from "./views-port";

export type FakeViews = ViewsPort & {
  files: Map<string, string>;
  copied: string[];
  pending: string[];
  renames: { from: string; to: string }[];
  renamed: { from: string; to: string }[];
  scansByCommit: Map<string, Scan[] | null>;
  ranges: Map<string, ChangeRange | null>;
  members: Map<string, RangeMembers | null>;
  memberCalls: string[];
  reasons: Map<string, string>;
  opened: string[];
  removed: string[];
  rangeCalls: string[];
  authorName: string;
  edit(name: string, text: string | null): void;
  settle(): Promise<void>;
};

export function fakeViews(
  initial: Record<string, string> = {},
  options: {
    delayScans?: boolean;
    delayRanges?: boolean;
    listError?: string;
    writeError?: string;
    refused?: string[];
  } = {},
): FakeViews {
  const files = new Map(Object.entries(initial));
  const listeners = new Set<() => void>();
  const copied: string[] = [];
  const pending: string[] = [];
  const scansByCommit = new Map<string, Scan[] | null>();
  const ranges = new Map<string, ChangeRange | null>();
  const members = new Map<string, RangeMembers | null>();
  const reasons = new Map<string, string>();
  const opened: string[] = [];
  const waiting: (() => void)[] = [];
  const fake: FakeViews = {
    files,
    copied,
    pending,
    renames: [],
    renamed: [],
    scansByCommit,
    ranges,
    members,
    memberCalls: [],
    reasons,
    opened,
    removed: [],
    rangeCalls: [],
    authorName: "Me",
    async author() {
      return fake.authorName;
    },
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
    async remove(name) {
      if (!files.has(name)) {
        throw new Error(`there is no view named ${name}`);
      }

      files.delete(name);
      fake.removed.push(name);

      for (const run of listeners) {
        run();
      }
    },
    async changeRange(base, head) {
      fake.rangeCalls.push(`${base}..${head}`);

      if (options.delayRanges) {
        await new Promise<void>((resolve) => waiting.push(resolve));
      }

      return ranges.get(`${base}..${head}`) ?? null;
    },
    async recent() {
      return opened.slice(0, 5);
    },
    async recordOpened(name) {
      const at = opened.indexOf(name);

      if (at >= 0) {
        opened.splice(at, 1);
      }

      opened.unshift(name);
    },
    async link(name) {
      if (!VIEW_NAME.test(name)) {
        throw new Error(`${name} is not a valid view name`);
      }

      return `recognizer://open?repo=%2Frepo&view=${name}`;
    },
    async takePendingView() {
      return pending.splice(0, 1)[0] ?? null;
    },
    async renamesSince() {
      return fake.renames;
    },
    async scansAt(commit) {
      if (options.delayScans) {
        await new Promise<void>((resolve) => waiting.push(resolve));
      }

      const found = scansByCommit.get(commit);

      return found === undefined || found === null
        ? { ok: false, reason: reasons.get(commit) ?? "no scans seeded" }
        : { ok: true, value: found };
    },
    async rangeMembers(base, head) {
      fake.memberCalls.push(`${base}..${head}`);

      const range = `${base}..${head}`;
      const found = members.get(range);

      return found === undefined || found === null
        ? { ok: false, reason: reasons.get(range) ?? "no members seeded" }
        : { ok: true, value: found };
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
