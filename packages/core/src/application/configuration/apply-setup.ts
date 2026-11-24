import type { PlannedChange } from "../../domain/configuration/setup-changes.js";
import type {
  ApplyEvent,
  SetupEntry,
  SetupRunOutcome,
} from "../../domain/configuration/setup-event.js";
import type {
  ConfigurationPorts,
  SetupDoctorReport,
} from "./internal/configuration-ports.js";
import { runChange, undoChanges } from "./internal/run-change.js";
import { restore, snapshotOf } from "./internal/snapshot.js";
import type { RunningSetupProgram } from "./ports/setup-programs.js";
import { NO_STOP, type SetupStop } from "./setup-stop.js";

export type SetupApplyEvent = ApplyEvent<SetupDoctorReport>;

export type ApplyResultEvent = Extract<SetupApplyEvent, { event: "result" }>;

export interface ApplySetupInput {
  root: string;
  changes: PlannedChange[];
  stop?: SetupStop;
  onEvent: (event: SetupApplyEvent) => void;
  onEntry?: (entry: SetupEntry) => void;
}

function entryOf(
  change: PlannedChange,
  ran: { output: string; command: string[]; status: number | null },
  durationMs: number,
  reason: string | undefined,
): SetupEntry {
  return {
    name: change.id,
    command:
      ran.command.length === 0 ? (change.steps[0]?.argv ?? []) : ran.command,
    status: ran.status,
    durationMs,
    output: ran.output,
    ...(reason === undefined ? {} : { reason }),
  };
}

export async function applySetup(
  ports: ConfigurationPorts,
  input: ApplySetupInput,
): Promise<SetupRunOutcome<ApplyResultEvent>> {
  const { root, changes, onEvent } = input;
  const stop = input.stop ?? NO_STOP;
  const onEntry = input.onEntry ?? (() => {});
  const status = ports.lock.status(root);

  if (status.running) {
    stop.settled();

    return {
      status: "refused",
      reason: status.refusal ?? "a scan is already running",
    };
  }

  const snapshot = snapshotOf(ports.files, root, changes);
  const completed: { change: PlannedChange; index: number }[] = [];
  let current: RunningSetupProgram | null = null;

  stop.onRequest(() => current?.kill());

  const finish = (ok: boolean, doctor: SetupDoctorReport | null) => {
    const result: ApplyResultEvent = { event: "result", ok, doctor };

    onEvent(result);

    return { status: "finished" as const, ok, result };
  };

  try {
    onEvent({
      event: "start",
      total: changes.length,
      commands: changes.reduce((sum, change) => sum + change.steps.length, 0),
    });

    for (const [index, change] of changes.entries()) {
      onEvent({ event: "change", index, state: "running", output: "" });

      const began = ports.clock.awake();
      const ran = await runChange(
        ports.programs,
        change,
        () => stop.requested(),
        (running) => {
          current = running;
        },
        (step, steps, argv, state) =>
          onEvent({
            event: "command",
            index,
            step,
            steps,
            command: argv.join(" "),
            state,
          }),
      );

      if (ran.ok) {
        completed.push({ change, index });
        onEntry(entryOf(change, ran, ports.clock.awake() - began, undefined));
        onEvent({ event: "change", index, state: "done", output: ran.output });

        continue;
      }

      onEntry(
        entryOf(
          change,
          ran,
          ports.clock.awake() - began,
          `${change.id} failed`,
        ),
      );
      onEvent({ event: "change", index, state: "failed", output: ran.output });
      restore(ports.files, root, snapshot);
      await undoChanges(ports.programs, root, completed, (at, note) =>
        onEvent({ event: "change", index: at, state: "undone", output: note }),
      );

      return finish(false, null);
    }

    let doctor: SetupDoctorReport | null = null;

    onEvent({ event: "doctor", state: "running" });

    try {
      doctor = ports.reads.diagnose(root);
    } catch {
      doctor = null;
    }

    onEvent({ event: "doctor", state: "done" });

    return finish(true, doctor);
  } finally {
    stop.settled();
  }
}
