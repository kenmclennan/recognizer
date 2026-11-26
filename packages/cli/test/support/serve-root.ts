import type { Git, ScanCache, Scratch } from "@recognizer/core";
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
    signals: options.signals,
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
      for (let waited = 0; waited <= ms; waited += STEP_MS) {
        const found = find();

        if (found !== undefined) {
          return found;
        }

        await root.advance(STEP_MS);
      }

      throw new Error(
        `not reached within ${ms} ms on the fake clock; lines so far: ${JSON.stringify(lines).slice(0, 2000)}`,
      );
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
