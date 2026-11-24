import type { RepositoryState } from "@recognizer/core";
import type {
  PluginTexts,
  RepositoryStateItem,
  RepositoryStatePort,
  ResultTexts,
} from "./repository-state-port";

export type FakeRepositoryState = RepositoryStatePort & {
  publish(state: RepositoryState, stream?: string): void;
  setTexts(plugin: string, texts: Partial<PluginTexts>): void;
  readonly cleared: string[];
  readonly watching: number;
};

const NO_TEXTS: PluginTexts = {
  findings: null,
  overlay: null,
  findingsProblem: null,
  overlayProblem: null,
};

export function fakeRepositoryState(
  initial: RepositoryState | null = null,
): FakeRepositoryState {
  const handlers = new Set<(item: RepositoryStateItem) => void>();
  const texts = new Map<string, PluginTexts>();
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
    setTexts(plugin, partial) {
      texts.set(plugin, { ...(texts.get(plugin) ?? NO_TEXTS), ...partial });
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
    async readResults(): Promise<ResultTexts> {
      return {
        revision: latest?.revision ?? 0,
        plugins: Object.fromEntries(texts),
      };
    },
    async clearResults(plugin) {
      cleared.push(plugin);
      texts.delete(plugin);
    },
  };
}
