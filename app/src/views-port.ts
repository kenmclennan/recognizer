import type { Scan } from "recognizer";

export type ViewListing = {
  views: { name: string; text: string }[];
  refused: string[];
};

export type ViewsPort = {
  list(): Promise<ViewListing>;
  write(name: string, text: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  link(name: string): Promise<string>;
  renamesSince(commit: string): Promise<{ from: string; to: string }[]>;
  scansAt(commit: string): Promise<Scan[] | null>;
  takePendingView(): Promise<string | null>;
  copy(text: string): Promise<void>;
  onChanged(run: () => void): () => void;
  author(): Promise<string>;
};

export const inertViews: ViewsPort = {
  list: async () => ({ views: [], refused: [] }),
  write: async () => {},
  rename: async () => {},
  link: async (name) => name,
  renamesSince: async () => [],
  scansAt: async () => null,
  takePendingView: async () => null,
  copy: async () => {},
  onChanged: () => () => {},
  author: async () => "Me",
};

export const VIEW_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
