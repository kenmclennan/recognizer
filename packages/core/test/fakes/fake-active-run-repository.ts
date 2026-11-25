import type {
  ActiveRunRead,
  ActiveRunRepository,
  MarkerFacts,
  ReadCursor,
  RunReport,
} from "../../src/index.js";

export class FakeActiveRunRepository implements ActiveRunRepository {
  kind: "none" | "live" | "ended" | "killed" | "unreadable" = "none";
  record: MarkerFacts | null = null;
  reason = "the marker cannot be read";
  readonly script: RunReport[] = [];
  readonly settled: string[] = [];
  failSettles = 0;
  reads = 0;

  start(changes: Partial<MarkerFacts> = {}): MarkerFacts {
    this.record = {
      runId: "run-1",
      startedBy: "cli",
      startedAt: "2026-11-24T10:00:00.000Z",
      scope: { kind: "working-tree" },
      sensors: [],
      describe: false,
      suites: {},
      phase: "checking",
      endedAt: null,
      exit: null,
      gaps: [],
      failure: null,
      ran: null,
      ...changes,
    };
    this.kind = "live";
    this.script.length = 0;

    return this.record;
  }

  phase(phase: MarkerFacts["phase"]): void {
    if (this.record === null) {
      throw new Error("no run has started");
    }

    this.record = { ...this.record, phase };
  }

  report(...reports: RunReport[]): void {
    this.script.push(...reports);
  }

  end(
    phase: "finished" | "failed" | "stopped" | "refused",
    endedAt: string | null = "2026-11-24T10:05:00.000Z",
    facts: Partial<Pick<MarkerFacts, "gaps" | "failure" | "ran">> = {},
  ): void {
    this.phase(phase);
    this.record = {
      ...(this.record as MarkerFacts),
      endedAt,
      exit: phase === "finished" ? 0 : 1,
      ...facts,
    };
    this.kind = "ended";
  }

  kill(): void {
    this.kind = "killed";
  }

  clear(): void {
    this.kind = "none";
    this.record = null;
    this.script.length = 0;
  }

  read(_root: string, from: ReadCursor | null): ActiveRunRead {
    this.reads += 1;

    if (this.kind === "none" || this.record === null) {
      return { kind: "none" };
    }

    if (this.kind === "unreadable") {
      return { kind: "unreadable", reason: this.reason };
    }

    const offset =
      from !== null && from.runId === this.record.runId ? from.offset : 0;

    return {
      kind: this.kind,
      record: this.record,
      reports: this.script.slice(offset),
      offset: this.script.length,
    };
  }

  settleKilled(_root: string, record: MarkerFacts): void {
    if (this.failSettles > 0) {
      this.failSettles -= 1;

      throw new Error("the marker cannot be written");
    }

    this.settled.push(record.runId);
    this.record = { ...record, phase: "stopped" };
    this.kind = "ended";
  }
}
