import type { RepositoryState } from "@recognizer/core";
import { acceptRevision, type HeldRevision } from "./repository-state-model";
import type { RepositoryStatePort } from "./repository-state-port";

export type RepositoryStateHolder = {
  start(): Promise<void>;
  latest(): Promise<RepositoryState>;
  current(): RepositoryState | null;
  onRevision(handler: (state: RepositoryState) => void): () => void;
  onInputsChange(handler: () => void): () => void;
  stop(): void;
};

export function createRepositoryStateHolder(
  port: RepositoryStatePort,
): RepositoryStateHolder {
  let held: HeldRevision | null = null;
  let starting: Promise<void> | null = null;
  let unwatch: (() => void) | null = null;
  const waiting: ((state: RepositoryState) => void)[] = [];
  const handlers = new Set<() => void>();
  const revisions = new Set<(state: RepositoryState) => void>();

  const begin = async (): Promise<void> => {
    unwatch = await port.watch((item) => {
      const before = held?.state ?? null;

      held = acceptRevision(held, item.stream, item.state);

      if (held.state !== item.state) {
        return;
      }

      for (const resolve of waiting.splice(0)) {
        resolve(item.state);
      }

      for (const handler of revisions) {
        handler(item.state);
      }

      if (before !== null && before.inputsDigest !== item.state.inputsDigest) {
        for (const handler of handlers) {
          handler();
        }
      }
    });
  };

  const self: RepositoryStateHolder = {
    start() {
      starting ??= begin().catch((error: unknown) => {
        starting = null;

        throw error;
      });

      return starting;
    },
    async latest() {
      await self.start();

      if (held !== null) {
        return held.state;
      }

      return new Promise<RepositoryState>((resolve) => waiting.push(resolve));
    },
    current() {
      return held?.state ?? null;
    },
    onRevision(handler) {
      revisions.add(handler);

      return () => revisions.delete(handler);
    },
    onInputsChange(handler) {
      handlers.add(handler);

      return () => handlers.delete(handler);
    },
    stop() {
      unwatch?.();
      unwatch = null;
      starting = null;
      held = null;
    },
  };

  return self;
}
