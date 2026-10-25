import type { ElkNode } from "elkjs/lib/elk-api";

export type LayoutRequest =
  | { id: number; cmd: "register"; algorithms: string[] }
  | {
      id: number;
      cmd: "layout";
      graph: ElkNode;
      layoutOptions: Record<string, string>;
      options: Record<string, string>;
    };
export type LayoutAnswer =
  | { id: number; data: ElkNode }
  | { id: number; error: unknown };

export type WorkerLike = {
  postMessage: (request: LayoutRequest) => void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<LayoutAnswer>) => void,
  ) => void;
};

export type LayoutSource = {
  request: (graph: ElkNode) => void;
};

export const LAYOUT_TIMEOUT_MS = 15000;

export type Timers = {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const realTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createLayoutSource(
  worker: WorkerLike,
  onLayout: (layout: ElkNode) => void,
  onError: (message: string) => void,
  timeoutMs = LAYOUT_TIMEOUT_MS,
  timers: Timers = realTimers,
): LayoutSource {
  let latest = 0;
  let pending: unknown = null;

  function settle() {
    if (pending !== null) {
      timers.clear(pending);
      pending = null;
    }
  }

  worker.postMessage({ id: -1, cmd: "register", algorithms: ["layered"] });

  worker.addEventListener("message", (event) => {
    const answer = event.data;

    if (answer.id !== latest) {
      return;
    }

    settle();

    if ("error" in answer) {
      onError(String(answer.error));

      return;
    }

    onLayout(answer.data);
  });

  return {
    request(graph) {
      latest += 1;
      settle();

      const expected = latest;

      pending = timers.set(() => {
        if (expected === latest) {
          pending = null;
          onError("the layout did not answer");
        }
      }, timeoutMs);
      worker.postMessage({
        id: latest,
        cmd: "layout",
        graph,
        layoutOptions: {},
        options: {},
      });
    },
  };
}

export function startLayoutWorker(): WorkerLike {
  return new Worker(new URL("./layout.worker.ts", import.meta.url));
}
