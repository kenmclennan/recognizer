import type { RepositoryState } from "@recognizer/core";
import type {
  PluginResults,
  RepositoryStateItem,
  RepositoryStatePort,
  ResultDocuments,
} from "./repository-state-port";

export type FakeRepositoryState = RepositoryStatePort & {
  publish(state: RepositoryState, stream?: string): void;
  setResults(plugin: string, texts: Partial<PluginResults>): void;
  readonly cleared: string[];
  readonly watching: number;
};

const NO_RESULTS: PluginResults = {
  findings: null,
  overlay: null,
  findingsProblem: null,
  overlayProblem: null,
  modifiedMs: null,
  freshness: null,
};

export function fakeRepositoryState(
  initial: RepositoryState | null = null,
): FakeRepositoryState {
  const handlers = new Set<(item: RepositoryStateItem) => void>();
  const texts = new Map<string, PluginResults>();
  const cleared: string[] = [];
  let latest = initial;

  return {
    cleared,
    get watching() {
      return handlers.size;
    },
    publish(state, stream = "r1") {
      latest = state;

      for (const handler of handlers) {
        handler({ stream, state });
      }
    },
    setResults(plugin, partial) {
      texts.set(plugin, { ...(texts.get(plugin) ?? NO_RESULTS), ...partial });
    },
    async watch(handler) {
      handlers.add(handler);

      if (latest !== null) {
        handler({ stream: "r1", state: latest });
      }

      return () => {
        handlers.delete(handler);
      };
    },
    async readResults(): Promise<ResultDocuments> {
      return {
        revision: latest?.revision ?? 0,
        plugins: Object.fromEntries(texts),
        refusals: {},
        lastRun: null,
      };
    },
    async clearResults(plugin) {
      cleared.push(plugin);
      texts.delete(plugin);
    },
  };
}
