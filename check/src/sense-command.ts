import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { readConfig } from "./config.js";
import { registeredSensors } from "./config-parse.js";
import { InputError } from "./errors.js";
import { validateFindings } from "./findings-document.js";
import { findingsFile } from "./findings-files.js";
import { runRegistered } from "./registered-command.js";
import { isDirty, resolveCommit } from "./scan-command.js";

const OPTIONS = {
  repository: { type: "string" },
  json: { type: "boolean" },
} as const;

interface SenseStatus {
  name: string;
  status: "ran" | "failed";
  reason?: string;
}

export function runSense(argv: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: OPTIONS,
  });
  const root = resolve(values.repository ?? ".");
  const registered = registeredSensors(readConfig(io, root));

  if (registered.length === 0) {
    throw new InputError([
      "no sensors are registered: add one to .recognizer/config.yaml",
    ]);
  }

  const names = registered.map((one) => one.name);
  const unknown = positionals.filter((name) => !names.includes(name));

  if (unknown.length > 0) {
    throw new InputError([
      ...unknown.map((name) => `no such sensor: ${name}`),
      `registered sensors: ${names.join(", ")}`,
    ]);
  }

  const commit = resolveCommit(io, root);

  if (commit === null) {
    throw new InputError(["not a git repository, or no commit"]);
  }

  const modified = isDirty(io, root);
  const selected =
    positionals.length > 0
      ? registered.filter((one) => positionals.includes(one.name))
      : registered;
  const sensors: SenseStatus[] = [];

  for (const { name, command } of selected) {
    const output = findingsFile(root, name);
    const reason = runRegistered(
      io,
      root,
      command,
      commit,
      output,
      "findings",
      (document) => {
        validateFindings(document, { name, commit });
      },
    );

    if (reason === null) {
      sensors.push({ name, status: "ran" });

      if (values.json !== true) {
        io.stdout(`ran ${name}\n`);
      }

      continue;
    }

    io.remove(output);
    io.stderr(`failed ${name}: ${reason}\n`);
    sensors.push({ name, status: "failed", reason });

    if (values.json !== true) {
      io.stdout(`failed ${name}\n`);
    }
  }

  if (values.json === true) {
    io.stdout(`${JSON.stringify({ commit, modified, sensors }, null, 2)}\n`);
  }

  return sensors.some((one) => one.status === "failed") ? 1 : 0;
}
