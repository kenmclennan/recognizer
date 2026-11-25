import { InvalidEntity } from "../invalid-entity.js";
import type { PluginEvent } from "../plugin-event.js";
import type {
  AccumulatedOverlay,
  DeclaredMetric,
} from "../reported-overlay.js";
import type { RunScope } from "../run-scope.js";

export interface ResultAccumulatorInput {
  name: string;
  version: string;
  metrics: readonly DeclaredMetric[];
  commit: string;
  scope: RunScope;
}

export type ReportedFinding = Record<string, unknown> & { id: string };

type Facts = Record<string, unknown> & {
  modified: boolean;
  settings: Record<string, unknown>;
};

export interface AccumulatedDocument {
  findings_version: 2;
  sensor: { name: string; version: string };
  commit: string;
  modified: boolean;
  settings: Record<string, unknown>;
  findings: ReportedFinding[];
  [fact: string]: unknown;
}

export interface Accumulated {
  document: AccumulatedDocument;
  overlay: AccumulatedOverlay | null;
}

export interface TailFallback {
  modified: boolean;
}

const FACT_KEYS = [
  "inputs",
  "tests",
  "counts",
  "stopped",
  "partial",
  "excluded",
  "unowned",
  "suites",
  "work",
] as const;

function valueProblem(
  type: DeclaredMetric["type"],
  value: unknown,
): string | null {
  if (type === "boolean") {
    return typeof value === "boolean" ? null : "is not a boolean";
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "is not a finite number";
  }

  if (type === "ratio" && (value < 0 || value > 1)) {
    return "is outside 0 to 1";
  }

  if (type === "count" && (!Number.isInteger(value) || value < 0)) {
    return "is not a non-negative integer";
  }

  return null;
}

export class ResultAccumulator {
  private readonly findings = new Map<string, ReportedFinding>();
  private readonly overlay = new Map<string, Map<string, number | boolean>>();
  private facts: Facts | null = null;
  private tail = false;
  private refusals = 0;
  private firstRefusal: string | null = null;
  private startTotal: number | null = null;
  private progress: { done: number; total: number } | null = null;

  constructor(private readonly input: ResultAccumulatorInput) {}

  take(event: PluginEvent): void {
    if (event.event === "start") {
      this.startTotal = event.total;

      return;
    }

    if (event.event === "progress") {
      this.progress = { done: event.done, total: event.total };

      return;
    }

    if (event.event === "result") {
      this.result(event);

      return;
    }

    if (event.event === "settled") {
      this.settle(event);
    }
  }

  private refuse(error: InvalidEntity): never {
    this.refusals += 1;
    this.firstRefusal ??= error.message;

    throw error;
  }

  private result(event: Extract<PluginEvent, { event: "result" }>): void {
    const findings = event.findings ?? [];
    const overlay = event.overlay ?? {};

    for (const finding of findings) {
      if (typeof finding.id !== "string" || finding.id === "") {
        this.refuse(
          new InvalidEntity(
            "ResultAccumulator",
            "a finding has an empty id",
            "",
          ),
        );
      }
    }

    for (const [metric, byId] of Object.entries(overlay)) {
      const declared = this.input.metrics.find((one) => one.name === metric);

      if (declared === undefined) {
        this.refuse(
          new InvalidEntity(
            "ResultAccumulator",
            "the overlay names an undeclared metric",
            metric,
          ),
        );
      }

      for (const [id, value] of Object.entries(byId)) {
        const problem = valueProblem(declared.type, value);

        if (problem !== null) {
          this.refuse(
            new InvalidEntity(
              "ResultAccumulator",
              `overlay ${metric} ${id} ${problem}`,
              value,
            ),
          );
        }
      }
    }

    for (const finding of findings) {
      this.findings.set(finding.id as string, finding as ReportedFinding);
    }

    for (const [metric, byId] of Object.entries(overlay)) {
      const held =
        this.overlay.get(metric) ?? new Map<string, number | boolean>();

      for (const [id, value] of Object.entries(byId)) {
        held.set(id, value);
      }

      this.overlay.set(metric, held);
    }

    this.tail = true;
  }

  private settle(event: Extract<PluginEvent, { event: "settled" }>): void {
    if (this.input.scope.kind === "commit" && event.modified) {
      this.refuse(
        new InvalidEntity(
          "ResultAccumulator",
          "a commit document cannot be modified",
          event.modified,
        ),
      );
    }

    const { event: _kind, ...facts } = event;

    this.facts = facts as Facts;
    this.tail = false;
  }

  refused(): number {
    return this.refusals;
  }

  firstReason(): string | null {
    return this.firstRefusal;
  }

  hasSettled(): boolean {
    return this.facts !== null;
  }

  hasUnsettledTail(): boolean {
    return this.tail;
  }

  settledComplete(): boolean {
    return (
      this.facts !== null &&
      this.facts.partial === undefined &&
      this.facts.stopped === undefined
    );
  }

  hasResults(): boolean {
    return this.findings.size > 0 || this.overlay.size > 0;
  }

  render(fallback: TailFallback): Accumulated {
    const facts: Facts = this.facts ?? {
      modified: fallback.modified,
      settings: {},
    };
    const unsettled = this.tail || this.facts === null;
    const document: AccumulatedDocument = {
      findings_version: 2,
      sensor: { name: this.input.name, version: this.input.version },
      commit: this.input.commit,
      modified: facts.modified,
      settings: facts.settings,
      findings: [...this.findings.values()].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      ),
    };

    for (const key of FACT_KEYS) {
      if (facts[key] !== undefined) {
        document[key] = facts[key];
      }
    }

    if (unsettled && document.stopped === undefined) {
      document.partial = {
        measured: this.progress?.done ?? 0,
        total: this.progress?.total ?? this.startTotal ?? 0,
      };
    }

    const values: AccumulatedOverlay["values"] = {};

    for (const [metric, byId] of [...this.overlay.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      values[metric] = Object.fromEntries(
        [...byId.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }

    return {
      document,
      overlay:
        this.overlay.size === 0
          ? null
          : { metrics: [...this.input.metrics], values },
    };
  }

  demoted(fallback: TailFallback): Accumulated {
    const rendered = this.render(fallback);
    const { document } = rendered;

    if (document.partial === undefined && document.stopped === undefined) {
      const counts = document.counts as
        | { measured: number; total: number }
        | undefined;

      document.partial = {
        measured: counts?.measured ?? this.progress?.done ?? 0,
        total: counts?.total ?? this.progress?.total ?? this.startTotal ?? 0,
      };
    }

    return rendered;
  }

  complete(fallback: TailFallback): Accumulated {
    return this.render(fallback);
  }
}
