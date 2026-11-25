import type { ScanTicks } from "@recognizer/core";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { PlanRequest, ScanPlanView, ScanRunRecord } from "recognizer";
import type { EstimateAnswer, EstimateRequest } from "./estimate-text";
import type {
  DescribingSettings,
  ScanPort,
  ScanRunResult,
  StoredTicks,
} from "./scan-port";
import type { ScanReport } from "./scan-report";

export type CoreGap = { id: string; line: string; needs: string[] };

export type CoreOutcome =
  | { status: "finished" }
  | { status: "stopped" }
  | { status: "failed"; reason: "phases" }
  | { status: "failed"; reason: "invalid-request"; messages: string[] }
  | {
      status: "failed";
      reason: "crashed";
      error: { name: string; message: string };
    }
  | { status: "refused"; reason: "lock" }
  | { status: "refused"; reason: "preflight"; gaps?: CoreGap[] };

export type Unavailable =
  | { kind: "missing"; hint: string }
  | { kind: "gaps"; gaps: CoreGap[] }
  | { kind: "refused"; reason: string }
  | { kind: "exited"; status: string; stderr: string };

export type CoreStreamItem = {
  stream: string;
  window?: string;
  event?: unknown;
  outcome?: CoreOutcome;
  run?: ScanRunRecord | null;
  line?: string;
};

type Invoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

type Listen = <T>(
  event: string,
  handler: (event: { payload: T }) => void,
) => Promise<() => void>;

export type ScanSourceDeps = {
  invoke: Invoke;
  listen: Listen;
  windowLabel: () => string;
  repository: () => string;
};

export class CoreUnavailable extends Error {
  constructor(readonly unavailable: Unavailable) {
    super(JSON.stringify(unavailable));
  }
}

export function unavailableResult(unavailable: Unavailable): ScanRunResult {
  switch (unavailable.kind) {
    case "missing":
      return { status: "command-missing", hint: unavailable.hint };
    case "gaps":
      return { status: "gaps", gaps: unavailable.gaps };
    case "refused":
      return { status: "refused", reason: unavailable.reason };
    case "exited":
      return {
        status: "failed",
        exitCode: -1,
        stderr: `${unavailable.status}\n${unavailable.stderr}`.trim(),
      };
  }
}

function failedResult(
  outcome: Extract<CoreOutcome, { status: "failed" }>,
): ScanRunResult {
  if (outcome.reason === "phases") {
    return { status: "finished", exitCode: 1 };
  }

  if (outcome.reason === "invalid-request") {
    return { status: "refused", reason: outcome.messages.join("\n") };
  }

  return {
    status: "failed",
    exitCode: outcome.error.name === "InputError" ? 2 : -1,
    stderr: outcome.error.message,
  };
}

export function outcomeResult(
  outcome: CoreOutcome,
  context: { running: boolean; repository: string },
): ScanRunResult {
  if (outcome.status === "finished") {
    return { status: "finished", exitCode: 0 };
  }

  if (outcome.status === "stopped") {
    return { status: "stopped" };
  }

  if (outcome.status === "failed") {
    return failedResult(outcome);
  }

  if (outcome.reason === "lock") {
    return context.running
      ? { status: "attached" }
      : {
          status: "refused",
          reason: `a scan is already running on ${context.repository}`,
        };
  }

  return outcome.gaps !== undefined && outcome.gaps.length > 0
    ? { status: "gaps", gaps: outcome.gaps }
    : { status: "failed", exitCode: 4, stderr: "" };
}

export function coreReply<T>(reply: unknown): T {
  if (typeof reply === "object" && reply !== null) {
    const record = reply as Record<string, unknown>;

    if ("unavailable" in record) {
      throw new CoreUnavailable(record.unavailable as Unavailable);
    }

    if ("error" in record) {
      throw new Error(String(record.error));
    }

    if ("ok" in record) {
      return record.ok as T;
    }
  }

  return reply as T;
}

export function createScanSource(deps: ScanSourceDeps): ScanPort {
  const call = async <T>(
    op: string,
    args: Record<string, unknown> = {},
  ): Promise<T> => coreReply<T>(await deps.invoke("core_call", { op, args }));

  const items = new Set<(item: CoreStreamItem) => void>();
  let attached: Promise<() => void> | null = null;

  const attach = () => {
    attached ??= deps.listen<CoreStreamItem>("core-event", (event) => {
      const target = event.payload.window;

      if (target !== undefined && target !== deps.windowLabel()) {
        return;
      }

      for (const handler of items) {
        handler(event.payload);
      }
    });

    return attached;
  };

  let current: string | null = null;

  async function run(
    plan: Parameters<ScanPort["run"]>[0],
  ): Promise<ScanRunResult> {
    await attach();

    const buffered: CoreStreamItem[] = [];
    let scan: string | null = null;
    let settle: (outcome: CoreOutcome) => void = () => {};
    const outcome = new Promise<CoreOutcome>((resolve) => {
      settle = resolve;
    });
    const handler = (item: CoreStreamItem) => {
      if (scan === null) {
        buffered.push(item);
      } else if (item.stream === scan && item.outcome !== undefined) {
        settle(item.outcome);
      }
    };

    items.add(handler);

    try {
      scan = await call<string>("scan.start", {
        describe: plan.describe ? (plan.describeAll ? "all" : "stale") : false,
        analysis: plan.analysis,
        sense: plan.sense,
        modules: plan.modules,
        suites: plan.suites,
      });
      current = scan;

      for (const item of buffered) {
        handler(item);
      }

      const finished = await outcome;
      const running =
        finished.status === "refused" && finished.reason === "lock"
          ? (await call<{ running: boolean }>("scan.status")).running
          : false;

      return outcomeResult(finished, {
        running,
        repository: deps.repository(),
      });
    } catch (error) {
      if (error instanceof CoreUnavailable) {
        return unavailableResult(error.unavailable);
      }

      throw error;
    } finally {
      items.delete(handler);
      current = null;
    }
  }

  return {
    run,
    stop: async () => {
      await call(
        "scan.stop",
        current === null ? { owner: "any" } : { scan: current },
      );
    },
    answerDescribe: async (describe) => {
      await call("confirm.answer", { describe });
    },
    readCache: () => call<ScanReport>("structure.read"),
    readTicks: () => deps.invoke<StoredTicks>("read_scan_ticks"),
    writeTicks: (ticks) =>
      deps.invoke<void>("write_scan_ticks", {
        describe: ticks.describe,
        analysis: ticks.analysis,
        ticked: ticks.ticked,
        onlyView: ticks.onlyView,
        suites: ticks.suites,
        folds: ticks.folds,
      }),
    readDescribing: () => deps.invoke<DescribingSettings>("read_describing"),
    watchExternal: async () => {
      await attach();
      await call("scan.watch");
    },
    plan: (request: PlanRequest) =>
      call<ScanPlanView>("scan.plan", { ...request }),
    estimate: (request: EstimateRequest) =>
      call<EstimateAnswer>("scan.estimate", { ...request }),
    changeTicks: (ticks, changes) =>
      call<ScanTicks>("scan.ticks", { ticks, changes }),
    onRun(handler) {
      const forward = (item: CoreStreamItem) => {
        if (item.run !== undefined) {
          handler({ kind: "run", run: item.run });
        } else if (item.line !== undefined) {
          handler({ kind: "line", line: item.line });
        }
      };

      items.add(forward);
      void attach();

      return () => {
        items.delete(forward);
      };
    },
  };
}

export const scanSource: ScanPort = createScanSource({
  invoke,
  listen: (event, handler) => getCurrentWebviewWindow().listen(event, handler),
  windowLabel: () => getCurrentWebviewWindow().label,
  repository: () => repositoryPath,
});

let repositoryPath = "";

export function setScanRepository(path: string): void {
  repositoryPath = path;
}
