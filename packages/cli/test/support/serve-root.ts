import type { Git, ScanCache, Scratch } from "@recognizer/core";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { FakeScratch } from "../../../core/test/fakes/fake-scratch.js";
import { Service, type ServiceOptions } from "../../src/serve/service.js";
import type { Polls } from "../../src/serve/watch.js";
import { FakeIo, type FakeIoOptions } from "./fake-io.js";
import { FilesScanCache } from "./files-scan-cache.js";
import { archiveTarProgram, FakeRepositories } from "./git-program.js";

export type Line = Record<string, any>;

export interface ServeRootOptions extends FakeIoOptions {
  polls?: Polls;
  repositories?: FakeRepositories;
  adapters?: { git?: Git; scratch?: Scratch; cache?: ScanCache };
  signals?: ServiceOptions["signals"];
  backstopMs?: number;
}

export interface ServeRoot {
  readonly lines: Line[];
  readonly io: FakeIo;
  readonly repositories: FakeRepositories;
  send(op: string, args: Record<string, unknown>): number;
  call(op: string, args: Record<string, unknown>): Promise<Line>;
  until<T>(find: () => T | undefined, ms?: number): Promise<T>;
  outcome(stream: string): Promise<Line>;
  advance(ms: number): Promise<void>;
  settle(): Promise<void>;
  close(): Promise<void>;
}

const STEP_MS = 50;
const REAL_YIELD_MS = 5;
const REAL_CEILING_MS = 30_000;

export const SENT_SIGNALS: string[] = [];

export function inertSignals(
  sent: string[],
): NonNullable<ServiceOptions["signals"]> {
  return {
    signal: (pid, group, name) => {
      sent.push(`${name} ${group ? -pid : pid}`);
    },
    later: (ms, action) => {
      setTimeout(action, ms);
    },
  };
}

export async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

export function serveRoot(options: ServeRootOptions = {}): ServeRoot {
  const io = new FakeIo(options);
  const repositories = options.repositories ?? new FakeRepositories(io.files);
  const lines: Line[] = [];

  io.alive.add(io.pid());
  io.install("git", repositories.program());
  io.install("tar", archiveTarProgram);

  const service = new Service({
    write: (message) => {
      lines.push(JSON.parse(JSON.stringify(message)) as Line);
    },
    base: () => io,
    scoped: (scope) => io.withScope(scope),
    polls: options.polls,
    signals: options.signals ?? inertSignals(SENT_SIGNALS),
    backstopMs: options.backstopMs,
    adapters: {
      scratch: new FakeScratch(),
      cache: new FilesScanCache(io.files),
      ...options.adapters,
    },
  });
  let nextId = 1;

  const root: ServeRoot = {
    lines,
    io,
    repositories,
    send: (op, args) => {
      const id = nextId++;

      service.handle({ id, op, args } as never);

      return id;
    },
    advance: async (ms) => {
      const target = io.timers.awake() + ms;

      for (;;) {
        await settle();

        const next = io.timers.next();

        if (next === undefined || next > target) {
          break;
        }

        io.timers.advance(next - io.timers.awake());
      }

      io.timers.advance(target - io.timers.awake());
      await settle();
    },
    settle,
    until: async (find, ms = 30_000) => {
      const deadline = Date.now() + scaledTimeout(REAL_CEILING_MS);
      let waited = 0;

      for (;;) {
        const found = find();

        if (found !== undefined) {
          return found;
        }

        const next = io.timers.next();
        const timerDue =
          next !== undefined && next <= io.timers.awake() + STEP_MS;

        if (!timerDue) {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, REAL_YIELD_MS),
          );
        } else {
          waited += STEP_MS;
        }

        if (waited > ms) {
          throw new Error(
            `not reached within ${ms} ms on the fake clock; lines so far: ${JSON.stringify(lines).slice(0, 2000)}`,
          );
        }

        if (Date.now() > deadline) {
          throw new Error(
            `not reached within ${scaledTimeout(REAL_CEILING_MS)} ms on the real clock; lines so far: ${JSON.stringify(lines).slice(0, 2000)}`,
          );
        }

        await root.advance(STEP_MS);
      }
    },
    call: async (op, args) => {
      const id = root.send(op, args);

      return root.until(() => lines.find((line) => line.id === id));
    },
    outcome: async (stream) => {
      const item = await root.until(() =>
        lines.find((line) => line.stream === stream && "outcome" in line),
      );

      return item.outcome;
    },
    close: async () => {
      await service.stopAll(143);
    },
  };

  return root;
}
