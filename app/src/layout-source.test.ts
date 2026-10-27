import type { ElkNode } from "elkjs/lib/elk-api";
import { describe, expect, it } from "vitest";
import {
  createLayoutSource,
  type LayoutAnswer,
  type MainThreadLayout,
  startLayoutWorker,
  type WorkerLike,
} from "./layout-source";

function fakeWorker() {
  let listener: (event: MessageEvent<LayoutAnswer>) => void = () => {};
  const posted: number[] = [];
  const worker: WorkerLike = {
    postMessage: (request) => {
      if (request.cmd === "layout") {
        posted.push(request.id);
      }
    },
    addEventListener: (_type, next) => {
      listener = next;
    },
  };

  return {
    worker,
    posted,
    answer: (data: LayoutAnswer) =>
      listener({ data } as MessageEvent<LayoutAnswer>),
  };
}

const graph = { id: "root" } as ElkNode;

const neverUsed: MainThreadLayout = () => Promise.reject(new Error("unused"));

const OVERFLOW = new RangeError("Maximum call stack size exceeded");

function deferred() {
  let resolve: (layout: ElkNode) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<ElkNode>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("layout source", () => {
  it("uses the latest request's answer and ignores a late older one", () => {
    const fake = fakeWorker();
    const layouts: ElkNode[] = [];
    const source = createLayoutSource(
      fake.worker,
      neverUsed,
      (l) => layouts.push(l),
      () => {},
    );

    source.request(graph);
    source.request(graph);
    fake.answer({ id: 2, data: { id: "two" } });
    fake.answer({ id: 1, data: { id: "one" } });

    expect(fake.posted).toEqual([1, 2]);
    expect(layouts.map((layout) => layout.id)).toEqual(["two"]);
  });

  it("reports an error answer and leaves the layout alone", () => {
    const fake = fakeWorker();
    const layouts: ElkNode[] = [];
    const errors: string[] = [];
    const source = createLayoutSource(
      fake.worker,
      neverUsed,
      (l) => layouts.push(l),
      (message) => errors.push(message),
    );

    source.request(graph);
    fake.answer({ id: 1, error: "boom" });

    expect(errors).toEqual(["boom"]);
    expect(layouts).toEqual([]);
  });

  it("ignores an error from a superseded request", () => {
    const fake = fakeWorker();
    const errors: string[] = [];
    const source = createLayoutSource(
      fake.worker,
      neverUsed,
      () => {},
      (m) => errors.push(m),
    );

    source.request(graph);
    source.request(graph);
    fake.answer({ id: 1, error: "old" });

    expect(errors).toEqual([]);
  });

  it("reports a layout that never answers once the timeout passes", () => {
    const fake = fakeWorker();
    const timers = fakeTimers();
    const errors: string[] = [];
    const source = createLayoutSource(
      fake.worker,
      neverUsed,
      () => {},
      (m) => errors.push(m),
      500,
      timers,
    );

    source.request(graph);

    expect(errors).toEqual([]);

    timers.fire();

    expect(timers.delays).toEqual([500]);
    expect(errors).toEqual(["the layout did not answer"]);
  });

  it("does not report a timeout once the layout has answered", () => {
    const fake = fakeWorker();
    const timers = fakeTimers();
    const errors: string[] = [];
    const source = createLayoutSource(
      fake.worker,
      neverUsed,
      () => {},
      (m) => errors.push(m),
      500,
      timers,
    );

    source.request(graph);
    fake.answer({ id: 1, data: { id: "one" } });
    timers.fire();

    expect(errors).toEqual([]);
  });

  it("retries a stack overflow on the main thread and applies that layout without a notice", async () => {
    const fake = fakeWorker();
    const retried: ElkNode[] = [];
    const layouts: ElkNode[] = [];
    const errors: string[] = [];
    const source = createLayoutSource(
      fake.worker,
      (g) => {
        retried.push(g);

        return Promise.resolve({ id: "main" } as ElkNode);
      },
      (l) => layouts.push(l),
      (m) => errors.push(m),
    );

    source.request(graph);
    fake.answer({ id: 1, error: OVERFLOW });
    await flush();

    expect(retried).toEqual([graph]);
    expect(layouts.map((layout) => layout.id)).toEqual(["main"]);
    expect(errors).toEqual([]);
  });

  it("does not retry a different error", async () => {
    const fake = fakeWorker();
    const retried: ElkNode[] = [];
    const errors: string[] = [];
    const source = createLayoutSource(
      fake.worker,
      (g) => {
        retried.push(g);

        return Promise.resolve(g);
      },
      () => {},
      (m) => errors.push(m),
    );

    source.request(graph);
    fake.answer({ id: 1, error: new Error("bad graph") });
    await flush();

    expect(retried).toEqual([]);
    expect(errors).toEqual(["Error: bad graph"]);
  });

  it("shows one notice when the retry also fails", async () => {
    const fake = fakeWorker();
    const errors: string[] = [];
    const source = createLayoutSource(
      fake.worker,
      () => Promise.reject(new Error("main failed")),
      () => {},
      (m) => errors.push(m),
    );

    source.request(graph);
    fake.answer({ id: 1, error: OVERFLOW });
    await flush();

    expect(errors).toEqual(["Error: main failed"]);
  });

  it("drops a retry result once a newer request was issued", async () => {
    const fake = fakeWorker();
    const first = deferred();
    const layouts: ElkNode[] = [];
    const errors: string[] = [];
    const source = createLayoutSource(
      fake.worker,
      () => first.promise,
      (l) => layouts.push(l),
      (m) => errors.push(m),
    );

    source.request(graph);
    fake.answer({ id: 1, error: OVERFLOW });
    source.request(graph);
    first.resolve({ id: "stale" } as ElkNode);
    await flush();

    expect(layouts).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("reports the timeout once and drops a retry that finishes after it", async () => {
    const fake = fakeWorker();
    const timers = fakeTimers();
    const slow = deferred();
    const layouts: ElkNode[] = [];
    const errors: string[] = [];
    const source = createLayoutSource(
      fake.worker,
      () => slow.promise,
      (l) => layouts.push(l),
      (m) => errors.push(m),
      500,
      timers,
    );

    source.request(graph);
    fake.answer({ id: 1, error: OVERFLOW });
    timers.fire();
    slow.resolve({ id: "late" } as ElkNode);
    await flush();

    expect(timers.delays).toEqual([500]);
    expect(errors).toEqual(["the layout did not answer"]);
    expect(layouts).toEqual([]);
  });

  it("starts a classic worker, which is the only kind the built bundle answers", () => {
    const options: unknown[] = [];

    class RecordingWorker {
      constructor(_url: unknown, init?: unknown) {
        options.push(init);
      }
    }

    const original = globalThis.Worker;

    globalThis.Worker = RecordingWorker as unknown as typeof Worker;

    try {
      startLayoutWorker();
    } finally {
      globalThis.Worker = original;
    }

    expect(options).toEqual([undefined]);
  });
});

function fakeTimers() {
  let callback: (() => void) | null = null;
  const delays: number[] = [];

  return {
    delays,
    set: (next: () => void, ms: number) => {
      callback = next;
      delays.push(ms);

      return 1;
    },
    clear: () => {
      callback = null;
    },
    fire: () => callback?.(),
  };
}
