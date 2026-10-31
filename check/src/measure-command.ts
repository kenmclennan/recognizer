import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { readConfig } from "./config.js";
import { InputError } from "./errors.js";
import { type Expected, validateOverlay } from "./overlays.js";
import { runRegistered } from "./registered-command.js";
import { isDirty, resolveCommit } from "./scan-command.js";

const OPTIONS = {
  repository: { type: "string" },
  json: { type: "boolean" },
} as const;

export const MEASURE_FLAGS = Object.keys(OPTIONS).map((name) => `--${name}`);

function overlayFile(root: string, name: string): string {
  return join(root, ".recognizer", "cache", "overlays", `${name}.json`);
}

function measureOne(
  io: Io,
  root: string,
  name: string,
  command: string[],
  expected: Expected,
): string | null {
  return runRegistered(
    io,
    root,
    command,
    expected.commit,
    overlayFile(root, name),
    "overlay",
    (document) => {
      validateOverlay(document, expected);
    },
  );
}

export function runMeasure(argv: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: OPTIONS,
  });
  const root = resolve(values.repository ?? ".");
  const overlays = readConfig(io, root)?.overlays ?? {};
  const registered = Object.keys(overlays);

  if (registered.length === 0) {
    throw new InputError([
      "no overlays are registered: add one to .recognizer/config.yaml",
    ]);
  }

  const unknown = positionals.filter((name) => !registered.includes(name));

  if (unknown.length > 0) {
    throw new InputError(unknown.map((name) => `no such overlay: ${name}`));
  }

  const commit = resolveCommit(io, root);

  if (commit === null) {
    throw new InputError(["not a git repository, or no commit"]);
  }

  const modified = isDirty(io, root);
  const selected = positionals.length > 0 ? positionals : registered;
  const measured: string[] = [];
  const failed: { overlay: string; reason: string }[] = [];

  for (const name of selected) {
    const registration = overlays[name] as (typeof overlays)[string];
    const reason = measureOne(io, root, name, registration.command, {
      commit,
      modified,
      metrics: registration.metrics,
    });

    if (reason !== null) {
      io.remove(overlayFile(root, name));
      failed.push({ overlay: name, reason });
      io.stderr(`failed ${name}: ${reason}\n`);

      continue;
    }

    measured.push(name);

    if (values.json !== true) {
      io.stdout(`measured ${name}\n`);
    }
  }

  if (values.json === true) {
    io.stdout(
      `${JSON.stringify({ commit, modified, measured, failed }, null, 2)}\n`,
    );
  } else {
    io.stdout(`measured ${measured.length}, failed ${failed.length}\n`);
  }

  return failed.length > 0 ? 1 : 0;
}
