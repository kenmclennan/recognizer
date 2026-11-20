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

export type MainThreadLayout = (graph: ElkNode) => Promise<ElkNode>;

export const STACK_OVERFLOW = "Maximum call stack size exceeded";

export async function layoutOnMainThread(graph: ElkNode): Promise<ElkNode> {
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");

  return new ELK().layout(graph);
}

export function createLayoutSource(
  worker: WorkerLike,
  mainThreadLayout: MainThreadLayout,
  onLayout: (layout: ElkNode) => void,
  onError: (message: string) => void,
  timeoutMs = LAYOUT_TIMEOUT_MS,
  timers: Timers = realTimers,
): LayoutSource {
  let latest = 0;
  let pending: unknown = null;
  let latestGraph: ElkNode | null = null;

  function settle() {
    if (pending !== null) {
      timers.clear(pending);
      pending = null;
    }
  }

  function retryOnMainThread(graph: ElkNode, id: number) {
    mainThreadLayout(graph).then(
      (layout) => {
        if (id === latest && pending !== null) {
          settle();
          onLayout(layout);
        }
      },
      (error) => {
        if (id === latest && pending !== null) {
          settle();
          onError(String(error));
        }
      },
    );
  }

  worker.postMessage({ id: -1, cmd: "register", algorithms: ["layered"] });

  worker.addEventListener("message", (event) => {
    const answer = event.data;

    if (answer.id !== latest) {
      return;
    }

    if ("error" in answer) {
      const message = String(answer.error);

      if (message.includes(STACK_OVERFLOW) && latestGraph !== null) {
        retryOnMainThread(latestGraph, answer.id);

        return;
      }

      settle();
      onError(message);

      return;
    }

    settle();

    onLayout(answer.data);
  });

  return {
    request(graph) {
      latest += 1;
      latestGraph = graph;
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
