import { NO_RUN_LINE, splitAtRun } from "../../domain/plugins/sensor-check.js";

export { NO_RUN_LINE };

export type DescriberCheck =
  | { kind: "no-run" }
  | { kind: "passed" }
  | {
      kind: "failed";
      program: string;
      words: string[];
      started: boolean;
      status: number | null;
    };

export function probeDescriberCheck(
  run: (
    program: string,
    args: string[],
    cwd: string,
  ) => { started: boolean; status: number | null },
  root: string,
  command: readonly string[],
): DescriberCheck {
  const split = splitAtRun(command);

  if (split === null) {
    return { kind: "no-run" };
  }

  const words = split.prefix.map((item) =>
    item.split("{repository}").join(root),
  );
  const program = words[0] as string;
  const result = run(program, [...words.slice(1), "check"], root);

  return result.started && result.status === 0
    ? { kind: "passed" }
    : {
        kind: "failed",
        program,
        words,
        started: result.started,
        status: result.status,
      };
}
