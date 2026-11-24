import type { PhaseRecorder } from "../../domain/phase-recorder.js";
import type { Repository } from "../../domain/repository.js";
import type {
  DescribeProjection,
  DescribeResult,
} from "../../domain/scan-event.js";
import type { ScanSink } from "../../domain/scan-sink.js";
import type { HeldLock } from "../shared/ports/scan-lock.js";
import { describeModules } from "./describe-modules.js";
import type { DescribingSettings } from "./describing-settings.js";
import type { DescribingPorts } from "./internal/describing-ports.js";
import type { LocatedDescriber } from "./ports/describer.js";

export interface DescribeFilesInput {
  root: string;
  repository: Repository;
  missing: string[];
  located: LocatedDescriber;
  settings: DescribingSettings;
  selection: "all" | "stale";
  within: string[] | undefined;
  confirmAbove: number | undefined;
  lock: HeldLock | null;
  sink: ScanSink;
  recorder: PhaseRecorder;
}

export type DescribeOutcome =
  | { halted: true }
  | { halted: false; failed: boolean; limited: boolean };

export async function describeFiles(
  ports: DescribingPorts,
  input: DescribeFilesInput,
): Promise<DescribeOutcome> {
  const { confirm, clock } = ports;
  const { root, repository, lock, sink, recorder, settings } = input;
  const phase = recorder.start("describe");
  let describeFrom = clock.awake();

  for (const language of input.missing) {
    sink.say("stderr", `skipped: no scan for ${language}\n`);
    recorder.skip("describe", `no scan for ${language}`);
  }

  const limit = input.confirmAbove;
  const result: DescribeResult = await describeModules(ports, {
    root,
    repository,
    describer: input.located.describer as NonNullable<
      LocatedDescriber["describer"]
    >,
    model: settings.model,
    batchSize: settings.batchSize,
    selection: {
      kind: input.selection,
      ...(input.within === undefined ? {} : { within: input.within }),
    },
    ...(limit === undefined
      ? {}
      : {
          confirm: async (projection: DescribeProjection) => {
            if (
              projection.modules === 0 ||
              (projection.cost_usd !== null && projection.cost_usd <= limit)
            ) {
              return true;
            }

            sink.emit({ type: "confirmation-asked", projection });

            await sink.flush();

            const describe = await confirm.ask(lock);

            if (lock !== null) {
              sink.emit({ type: "confirmation-answered", describe });
            }

            describeFrom = clock.awake();

            return describe;
          },
        }),
    onProjection: (projection) => {
      sink.emit({ type: "projection", projection });
    },
    onStart: (total) => {
      sink.emit({ type: "phase", phase: "describe", detail: { total } });
    },
    onEvent: (name, data) => {
      sink.emit({ type: "plugin", phase: "describe", name, data });
    },
    onEntry: (entry) => {
      recorder.entry(phase, entry);
    },
    say: sink.say,
  });

  if (sink.stopped) {
    return { halted: true };
  }

  phase.duration_ms = clock.awake() - describeFrom;

  const stop = result.stopped;

  if (stop !== null) {
    sink.emit({ type: "describing-stopped", stop });
  }

  sink.emit({ type: "describing-finished", result });

  return {
    halted: false,
    failed: stop !== null,
    limited: stop?.cause === "limit",
  };
}
