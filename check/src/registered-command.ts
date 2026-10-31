import type { Io } from "./cli.js";

export function fill(
  item: string,
  root: string,
  commit: string,
  output: string,
): string {
  return item
    .split("{repository}")
    .join(root)
    .split("{commit}")
    .join(commit)
    .split("{output}")
    .join(output);
}

export function runRegistered(
  io: Io,
  root: string,
  command: string[],
  commit: string,
  output: string,
  what: string,
  validate: (document: unknown) => void,
): string | null {
  io.remove(output);

  const [program, ...rest] = command.map((item) =>
    fill(item, root, commit, output),
  ) as [string, ...string[]];
  const result = io.run(program, rest, { cwd: root });
  const stderr = result.stderr.trim();

  if (!result.started) {
    return stderr !== "" ? stderr : `command did not start: ${program}`;
  }

  if (result.status !== 0) {
    return stderr !== ""
      ? stderr
      : `command exited with status ${result.status}`;
  }

  if (!io.exists(output)) {
    return `command wrote no ${what} file`;
  }

  let document: unknown;

  try {
    document = JSON.parse(io.readFile(output));
  } catch (error) {
    io.remove(output);

    return `${what} is not valid JSON: ${(error as Error).message}`;
  }

  try {
    validate(document);
  } catch (error) {
    io.remove(output);

    return (error as Error).message;
  }

  return null;
}
