import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type {
  RepositoryStateItem,
  RepositoryStatePort,
  ResultDocuments,
} from "./repository-state-port";
import { coreReply } from "./scan-source";

type Invoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

type Listen = <T>(
  event: string,
  handler: (event: { payload: T }) => void,
) => Promise<() => void>;

export type RepositoryStateSourceDeps = {
  invoke: Invoke;
  listen: Listen;
  windowLabel: () => string;
};

type Streamed = { stream: string; window?: string; state?: unknown };

export function createRepositoryStateSource(
  deps: RepositoryStateSourceDeps,
): RepositoryStatePort {
  const call = async <T>(
    op: string,
    args: Record<string, unknown> = {},
  ): Promise<T> => coreReply<T>(await deps.invoke("core_call", { op, args }));

  return {
    async watch(handler) {
      let stream: string | null = null;
      const stop = await deps.listen<Streamed>("core-event", (event) => {
        const { payload } = event;

        if (
          payload.state === undefined ||
          (payload.window !== undefined &&
            payload.window !== deps.windowLabel())
        ) {
          return;
        }

        handler({
          stream: payload.stream,
          state: payload.state as RepositoryStateItem["state"],
        });
      });

      stream = await call<string>("repository.watch");

      return () => {
        stop();

        if (stream !== null) {
          void call("repository.unwatch", { watch: stream }).catch(
            () => undefined,
          );
        }
      };
    },
    readResults: (tests = null) =>
      call<ResultDocuments>("results.read", tests === null ? {} : { tests }),
    clearResults: async (plugin) => {
      await call("results.clear", { plugin });
    },
  };
}

export const repositoryStateSource: RepositoryStatePort =
  createRepositoryStateSource({
    invoke,
    listen: (event, handler) =>
      getCurrentWebviewWindow().listen(event, handler),
    windowLabel: () => getCurrentWebviewWindow().label,
  });
