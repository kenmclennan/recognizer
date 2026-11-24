import type { PlannedChange } from "../../domain/configuration/setup-changes.js";
import type {
  SetupRunOutcome,
  TryEvent,
} from "../../domain/configuration/setup-event.js";
import type { ConfigurationPorts } from "./internal/configuration-ports.js";
import { runChange, undoChanges } from "./internal/run-change.js";
import { restore, snapshotOf } from "./internal/snapshot.js";
import type { RunningSetupProgram } from "./ports/setup-programs.js";
import { NO_STOP, type SetupStop } from "./setup-stop.js";

export type TryResultEvent = Extract<TryEvent, { event: "result" }>;

export interface TrySetupInput {
  root: string;
  changes: PlannedChange[];
  stop?: SetupStop;
  onEvent: (event: TryEvent) => void;
}

interface Gap {
  suite: string | null;
  line: string;
  output?: string;
}

function gapsOf(text: string): Gap[] | null {
  try {
    const parsed = JSON.parse(text) as {
      sensors?: { gaps?: Gap[] }[];
    };

    return (parsed.sensors ?? []).flatMap((sensor) => sensor.gaps ?? []);
  } catch {
    return null;
  }
}

export async function trySetup(
  ports: ConfigurationPorts,
  input: TrySetupInput,
): Promise<SetupRunOutcome<TryResultEvent>> {
  const { root, changes, onEvent } = input;
  const stop = input.stop ?? NO_STOP;
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

  const undo = async () => {
    restore(ports.files, root, snapshot);
    await undoChanges(ports.programs, root, completed, (index, note) =>
      onEvent({ event: "change", index, state: "undone", output: note }),
    );
  };

  const finish = (ok: boolean) => {
    const result: TryResultEvent = { event: "result", ok };

    onEvent(result);

    return { status: "finished" as const, ok, result };
  };

  try {
    onEvent({ event: "start", total: changes.length });

    for (const [index, change] of changes.entries()) {
      onEvent({ event: "change", index, state: "running", output: "" });

      const ran = await runChange(
        ports.programs,
        change,
        () => stop.requested(),
        (running) => {
          current = running;
        },
      );

      if (!ran.ok) {
        onEvent({
          event: "change",
          index,
          state: "failed",
          output: ran.output,
        });
        await undo();

        return finish(false);
      }

      completed.push({ change, index });
      onEvent({ event: "change", index, state: "done", output: ran.output });
    }

    const names = changes
      .filter((change) => change.id.startsWith("tests-"))
      .map((change) => change.id.slice("tests-".length));
    const running = ports.programs.start(
      "recognizer",
      ["sensors", "check", "--run", "--json"],
      { cwd: root },
    );

    current = running;

    const check = await running.result;

    current = null;

    if (stop.requested() || check.stopped === true) {
      await undo();

      return finish(false);
    }

    const gaps = check.started ? gapsOf(check.stdout) : null;
    let ok = check.started && gaps !== null && check.status === 0;

    for (const name of names) {
      const own =
        gaps === null
          ? ["the readiness check gave no answer"]
          : [
              ...new Set(
                gaps.filter((gap) => gap.suite === name).map((gap) => gap.line),
              ),
            ];

      if (own.length > 0) {
        ok = false;
      }

      const output =
        gaps === null
          ? []
          : [
              ...new Set(
                gaps
                  .filter((gap) => gap.suite === name)
                  .flatMap((gap) =>
                    gap.output === undefined || gap.output === ""
                      ? []
                      : [gap.output],
                  ),
              ),
            ];

      onEvent({
        event: "runner",
        name,
        ready: own.length === 0,
        detail: own.join(" "),
        output: output.join("\n\n"),
      });
    }

    await undo();

    return finish(ok);
  } finally {
    stop.settled();
  }
}
