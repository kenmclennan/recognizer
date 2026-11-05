import type { Io, RunOptions, RunResult } from "./cli.js";

export interface RegisteredRun {
  reason: string | null;
  command: string[];
  status: number | null;
  stderr: string;
}

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

interface Prepared {
  filled: string[];
  program: string;
  rest: string[];
  written: string;
}

function prepare(
  io: Io,
  root: string,
  command: string[],
  commit: string,
  output: string,
): Prepared {
  const written = `${output}.tmp`;

  io.remove(output);
  io.remove(written);

  const filled = command.map((item) => fill(item, root, commit, written));
  const [program, ...rest] = filled as [string, ...string[]];

  return { filled, program, rest, written };
}

export function runRegistered(
  io: Io,
  root: string,
  command: string[],
  commit: string,
  output: string,
  what: string,
  validate: (document: unknown) => void,
  timeoutMs?: number,
): RegisteredRun {
  const prepared = prepare(io, root, command, commit, output);
  const result = io.run(prepared.program, prepared.rest, {
    cwd: root,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });

  return conclude(io, prepared, result, output, what, validate);
}

export async function runRegisteredAsync(
  io: Io,
  root: string,
  command: string[],
  commit: string,
  output: string,
  what: string,
  validate: (document: unknown) => void,
  options: Omit<RunOptions, "cwd">,
  keepStderr: (stderr: string) => string,
): Promise<RegisteredRun> {
  const prepared = prepare(io, root, command, commit, output);
  const result = await io.runAsync(prepared.program, prepared.rest, {
    cwd: root,
    ...options,
  }).result;

  return conclude(
    io,
    prepared,
    { ...result, stderr: keepStderr(result.stderr) },
    output,
    what,
    validate,
  );
}

function conclude(
  io: Io,
  { filled, program, written }: Prepared,
  result: RunResult,
  output: string,
  what: string,
  validate: (document: unknown) => void,
): RegisteredRun {
  const stderr = result.stderr.trim();
  const ran = (reason: string | null): RegisteredRun => ({
    reason,
    command: filled,
    status: result.started ? result.status : null,
    stderr: result.stderr,
  });

  if (result.timedOut || !result.started || result.status !== 0) {
    io.remove(written);
  }

  if (result.timedOut) {
    return ran("timed out");
  }

  if (!result.started) {
    return ran(stderr !== "" ? stderr : `command did not start: ${program}`);
  }

  if (result.status !== 0) {
    return ran(
      stderr !== "" ? stderr : `command exited with status ${result.status}`,
    );
  }

  if (!io.exists(written)) {
    return ran(`command wrote no ${what} file`);
  }

  let document: unknown;

  try {
    document = JSON.parse(io.readFile(written));
  } catch (error) {
    io.remove(written);

    return ran(`${what} is not valid JSON: ${(error as Error).message}`);
  }

  try {
    validate(document);
  } catch (error) {
    io.remove(written);

    return ran((error as Error).message);
  }

  io.rename(written, output);

  return ran(null);
}
