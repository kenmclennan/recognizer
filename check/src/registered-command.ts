import type { Io, RunOptions, RunResult } from "./cli.js";
import { registerPending } from "./pending-checkpoints.js";

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

type Counted = {
  counts?: { measured?: number };
  stopped?: { measured?: number };
  partial?: { measured?: number };
};

function measuredOf(document: Counted): number | null {
  const measured =
    document.counts?.measured ??
    document.stopped?.measured ??
    document.partial?.measured;

  return typeof measured === "number" ? measured : null;
}

function protectsOutput(
  io: Io,
  output: string,
  checkpoint: Counted,
  validate: (document: unknown, anyCommit?: boolean) => void,
): boolean {
  if (!io.exists(output)) {
    return false;
  }

  try {
    const existing = JSON.parse(io.readFile(output)) as Counted | null;

    validate(existing, true);

    if (
      existing === null ||
      typeof existing !== "object" ||
      existing.partial !== undefined ||
      existing.stopped !== undefined
    ) {
      return false;
    }

    const kept = measuredOf(existing);
    const incoming = measuredOf(checkpoint);

    return kept !== null && incoming !== null && incoming < kept;
  } catch {
    return false;
  }
}

function promoteCheckpoint(
  io: Io,
  written: string,
  output: string,
  validate: (document: unknown, anyCommit?: boolean) => void,
): void {
  if (!io.exists(written)) {
    return;
  }

  try {
    const document = JSON.parse(io.readFile(written)) as Record<
      string,
      unknown
    > | null;

    validate(document);

    if (
      document === null ||
      typeof document !== "object" ||
      (document.partial === undefined && document.stopped === undefined)
    ) {
      throw new Error("not a checkpoint");
    }

    if (protectsOutput(io, output, document as Counted, validate)) {
      throw new Error("checkpoint measured less than the complete output");
    }

    io.rename(written, output);
  } catch {
    io.remove(written);
  }
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
  validate: (document: unknown, anyCommit?: boolean) => void,
): Prepared {
  const written = `${output}.tmp`;

  promoteCheckpoint(io, written, output, validate);

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
  validate: (document: unknown, anyCommit?: boolean) => void,
  timeoutMs?: number,
  keepStderr: (stderr: string) => string = (stderr) => stderr,
): RegisteredRun {
  const prepared = prepare(io, root, command, commit, output, validate);
  const unregister = registerPending(() => {
    promoteCheckpoint(io, prepared.written, output, validate);
  });
  let result: RunResult;

  try {
    result = io.run(prepared.program, prepared.rest, {
      cwd: root,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  } finally {
    unregister();
  }

  return conclude(
    io,
    prepared,
    { ...result, stderr: keepStderr(result.stderr) },
    output,
    what,
    validate,
  );
}

export async function runRegisteredAsync(
  io: Io,
  root: string,
  command: string[],
  commit: string,
  output: string,
  what: string,
  validate: (document: unknown, anyCommit?: boolean) => void,
  options: Omit<RunOptions, "cwd">,
  keepStderr: (stderr: string) => string,
): Promise<RegisteredRun> {
  const prepared = prepare(io, root, command, commit, output, validate);
  const unregister = registerPending(() => {
    promoteCheckpoint(io, prepared.written, output, validate);
  });
  let result: RunResult;

  try {
    result = await io.runAsync(prepared.program, prepared.rest, {
      cwd: root,
      ...options,
    }).result;
  } finally {
    unregister();
  }

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
  validate: (document: unknown, anyCommit?: boolean) => void,
): RegisteredRun {
  const stderr = result.stderr.trim();
  const ran = (reason: string | null): RegisteredRun => ({
    reason,
    command: filled,
    status: result.started ? result.status : null,
    stderr: result.stderr,
  });

  if (result.timedOut || !result.started || result.status !== 0) {
    promoteCheckpoint(io, written, output, validate);
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
