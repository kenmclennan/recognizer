import type { Io } from "./cli.js";
import { InputError, Refusal } from "./errors.js";
import type { ChangeFacts } from "./view-staleness.js";
import { isValidRef, parseRange, type ViewChange } from "./views.js";

export function resolveRef(io: Io, root: string, ref: string): string | null {
  if (!isValidRef(ref)) {
    return null;
  }

  const result = io.run("git", [
    "-C",
    root,
    "rev-parse",
    "--verify",
    "-q",
    `${ref}^{commit}`,
  ]);
  const commit = result.stdout.trim();

  return result.started && result.status === 0 && commit !== "" ? commit : null;
}

export function parseChangeFlag(
  io: Io,
  root: string,
  text: string,
): ViewChange {
  const change = parseRange(text);

  if (change === null) {
    throw new InputError([
      `invalid range: ${text} (expected <base>..<head>, each a git ref)`,
    ]);
  }

  for (const ref of [change.base, change.head]) {
    if (resolveRef(io, root, ref) === null) {
      throw new Refusal([`unknown ref: ${ref}`]);
    }
  }

  return change;
}

export function changeFacts(
  io: Io,
  root: string,
  change: ViewChange,
): ChangeFacts {
  const headCommit = resolveRef(io, root, change.head);
  const baseCommit = resolveRef(io, root, change.base);
  let merged = false;

  if (headCommit !== null && baseCommit !== null && headCommit !== baseCommit) {
    const result = io.run("git", [
      "-C",
      root,
      "merge-base",
      "--is-ancestor",
      headCommit,
      baseCommit,
    ]);

    merged = result.started && result.status === 0;
  }

  return { headCommit, baseCommit, merged };
}

export function diffNameStatus(
  io: Io,
  root: string,
  change: ViewChange,
): string | null {
  const result = io.run("git", [
    "-C",
    root,
    "diff",
    "--no-renames",
    "--name-status",
    "-z",
    `${change.base}...${change.head}`,
  ]);

  return result.started && result.status === 0 ? result.stdout : null;
}
