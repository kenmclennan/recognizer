import type { RepositoryState } from "@recognizer/core";

export type RepositoryStateItem = {
  stream: string;
  state: RepositoryState;
};

export type PluginTexts = {
  findings: string | null;
  overlay: string | null;
  findingsProblem: string | null;
  overlayProblem: string | null;
};

export type ResultTexts = {
  revision: number;
  plugins: Record<string, PluginTexts>;
};

export type RepositoryStatePort = {
  watch(handler: (item: RepositoryStateItem) => void): Promise<() => void>;
  readResults(): Promise<ResultTexts>;
  clearResults(plugin: string): Promise<void>;
};
