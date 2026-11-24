import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { nodeIo } from "../src/cli.js";
import { markerPath, progressPath } from "../src/scan-marker.js";
import { StopBackstops } from "../src/serve/stop-backstops.js";
import {
  type Signals,
  stopMarkerProcess,
} from "../src/serve/stop-by-repository.js";

const RUN_ID = "11111111-2222-3333-4444-555555555555";

class ManualClock {
  now = 0;
  private readonly due: { at: number; action: () => void }[] = [];

  signals(sent: string[]): Signals {
    return {
      signal: (pid, group, name) => {
        sent.push(`${name}:${group ? "-" : ""}${pid}`);
      },
      later: (ms, action) => {
        this.due.push({ at: this.now + ms, action });
      },
    };
  }

  advance(ms: number): void {
    const target = this.now + ms;

    for (;;) {
      this.due.sort((a, b) => a.at - b.at);

      const next = this.due[0];

      if (next === undefined || next.at > target) {
        break;
      }

      this.due.shift();
      this.now = next.at;
      next.action();
    }

    this.now = target;
  }
}

function plant(phase: string, existing?: string): string {
  const root = existing ?? makeTempDir("stop-backstop-");
  const cache = join(root, ".recognizer", "cache");

  mkdirSync(cache, { recursive: true });
  writeFileSync(
    markerPath(root),
    JSON.stringify({
      version: 5,
      run_id: RUN_ID,
      pid: process.pid,
      pgid: process.pid,
      started_at: new Date().toISOString(),
      started_by: "app",
      repository: root,
      sensors: [],
      describe: false,
      suites: {},
      phase,
      ended_at: phase === "finished" ? new Date().toISOString() : null,
      exit: phase === "finished" ? 0 : null,
      gaps: [],
      failure: null,
      commit: null,
      ran: null,
    }),
  );
  writeFileSync(progressPath(root), "");

  return root;
}

function pending(promise: Promise<void>): Promise<boolean> {
  return Promise.race([
    promise.then(() => false),
    new Promise<boolean>((resolve) => setImmediate(() => resolve(true))),
  ]);
}

function ownerIo() {
  return { ...nodeIo(), pid: () => 1 };
}

describe("stop backstops", () => {
  it("a_pending_backstop_holds_the_exit_until_it_fires", async () => {
    const root = plant("running");
    const clock = new ManualClock();
    const sent: string[] = [];
    const backstops = new StopBackstops();

    stopMarkerProcess(
      ownerIo(),
      root,
      "app",
      clock.signals(sent),
      15_000,
      backstops,
    );

    expect(sent).toEqual([`SIGTERM:-${process.pid}`]);
    expect(await pending(backstops.settled())).toBe(true);

    clock.advance(14_000);

    expect(await pending(backstops.settled())).toBe(true);
    expect(sent).toHaveLength(1);

    clock.advance(1_000);
    await backstops.settled();

    expect(sent).toEqual([
      `SIGTERM:-${process.pid}`,
      `SIGKILL:-${process.pid}`,
    ]);
    expect(backstops.size).toBe(0);
  });

  it("a_backstop_for_a_run_that_ended_resolves_without_a_kill", async () => {
    const root = plant("running");
    const clock = new ManualClock();
    const sent: string[] = [];
    const backstops = new StopBackstops();

    stopMarkerProcess(
      ownerIo(),
      root,
      "app",
      clock.signals(sent),
      15_000,
      backstops,
    );
    plant("finished", root);
    clock.advance(1_000);
    await backstops.settled();

    expect(sent).toEqual([`SIGTERM:-${process.pid}`]);
  });
});
