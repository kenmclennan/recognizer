import type { PlannedChange } from "../../../domain/configuration/setup-changes.js";
import type {
  RunningSetupProgram,
  SetupPrograms,
} from "../ports/setup-programs.js";

export interface Ran {
  ok: boolean;
  output: string;
  command: string[];
  status: number | null;
}

export async function runChange(
  programs: SetupPrograms,
  change: PlannedChange,
  stopped: () => boolean,
  track: (running: RunningSetupProgram | null) => void,
  onStep: (
    step: number,
    steps: number,
    argv: string[],
    state: "running" | "done",
  ) => void = () => {},
): Promise<Ran> {
  let output = "";
  let command: string[] = [];
  let status: number | null = 0;
  const steps = change.steps.length;

  for (const [at, { argv, cwd }] of change.steps.entries()) {
    if (stopped()) {
      return { ok: false, output: `${output}stopped\n`, command, status: 143 };
    }

    command = argv;

    const [program, ...args] = argv;

    onStep(at + 1, steps, argv, "running");

    const running = programs.start(program as string, args, { cwd });

    track(running);

    const result = await running.result;

    track(null);

    output += `${result.stdout}${result.stderr}`;
    status = result.status;

    if (!result.started) {
      return {
        ok: false,
        output: `${output}${program} could not be started\n`,
        command,
        status,
      };
    }

    if (result.stopped === true || result.status !== 0) {
      return {
        ok: false,
        output: result.stopped === true ? `${output}stopped\n` : output,
        command,
        status,
      };
    }

    onStep(at + 1, steps, argv, "done");
  }

  return { ok: true, output, command, status };
}

export async function undoChanges(
  programs: SetupPrograms,
  root: string,
  completed: { change: PlannedChange; index: number }[],
  emit: (index: number, note: string) => void,
): Promise<void> {
  for (const { change, index } of [...completed].reverse()) {
    if (change.undo !== undefined) {
      const [program, ...args] = change.undo;

      await programs.start(program as string, args, { cwd: root }).result;
    }

    emit(index, change.undo_note ?? "");
  }
}
