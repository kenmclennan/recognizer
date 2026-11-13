import type { Scan } from "recognizer";

export type ViewListing = {
  views: { name: string; text: string }[];
  refused: string[];
};

export type RangeChange = { status: string; path: string };

export type ChangeRange = {
  baseCommit: string | null;
  headCommit: string | null;
  merged: boolean;
  changes: RangeChange[];
};

export type RangeMembers = {
  baseScans: Scan[];
  headScans: Scan[];
  files: {
    path: string;
    base_text: string | null;
    head_text: string | null;
  }[];
};

export type ReadOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

export type ViewsPort = {
  remove(name: string): Promise<void>;
  changeRange(base: string, head: string): Promise<ChangeRange | null>;
  recent(): Promise<string[]>;
  recordOpened(name: string): Promise<void>;
  list(): Promise<ViewListing>;
  write(name: string, text: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  link(name: string): Promise<string>;
  renamesSince(commit: string): Promise<{ from: string; to: string }[]>;
  scansAt(commit: string): Promise<ReadOutcome<Scan[]>>;
  rangeMembers(base: string, head: string): Promise<ReadOutcome<RangeMembers>>;
  takePendingView(): Promise<string | null>;
  copy(text: string): Promise<void>;
  onChanged(run: () => void): () => void;
  author(): Promise<string>;
};

export const inertViews: ViewsPort = {
  remove: async () => {},
  changeRange: async () => null,
  recent: async () => [],
  recordOpened: async () => {},
  list: async () => ({ views: [], refused: [] }),
  write: async () => {},
  rename: async () => {},
  link: async (name) => name,
  renamesSince: async () => [],
  scansAt: async () => ({ ok: false, reason: "no repository is open" }),
  rangeMembers: async () => ({ ok: false, reason: "no repository is open" }),
  takePendingView: async () => null,
  copy: async () => {},
  onChanged: () => () => {},
  author: async () => "Me",
};

export const VIEW_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export const DRAFT_VIEW = "(unsaved)";
