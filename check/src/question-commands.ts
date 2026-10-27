import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildCallerIndex } from "./callers.js";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
import { freshScans } from "./freshness.js";
import {
  groupByFolder,
  moduleNames,
  type NeighbourRow,
  usedByOf,
  usesOf,
} from "./neighbours.js";
import { type PathStep, shortestPath } from "./paths.js";
import type { Scan } from "./scan.js";

interface Question {
  json: boolean;
  positionals: string[];
  scans: Scan[];
  modules: string[];
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function load(argv: string[], io: Io, usage: string, arity: number): Question {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { json: { type: "boolean" }, repository: { type: "string" } },
  });

  if (positionals.length !== arity) {
    throw new InputError([`usage: ${usage}`]);
  }

  const { scans } = freshScans(io, resolve(values.repository ?? "."));
  const modules = moduleNames(scans);

  return { json: values.json === true, positionals, scans, modules };
}

function question(
  argv: string[],
  io: Io,
  usage: string,
  arity: number,
  moduleArguments: number,
): Question {
  const loaded = load(argv, io, usage, arity);

  for (const path of loaded.positionals.slice(0, moduleArguments)) {
    if (!loaded.modules.includes(path)) {
      throw new InputError([`no such module: ${path}`]);
    }
  }

  return loaded;
}

function rowLine(row: NeighbourRow): string {
  const names = row.names.length > 0 ? `  ${row.names.join(", ")}` : "";
  const flags = `${row.private ? " (private)" : ""}${row.inferred ? " (inferred)" : ""}`;

  return `  ${row.id}${names}${flags}`;
}

function neighbours(
  argv: string[],
  io: Io,
  direction: "uses" | "usedBy",
): number {
  const command = direction === "uses" ? "uses" : "used-by";
  const asked = question(
    argv,
    io,
    `recognizer ${command} <module> [--repository <dir>] [--json]`,
    1,
    1,
  );
  const module = asked.positionals[0] as string;
  const rows = (direction === "uses" ? usesOf : usedByOf)(
    asked.scans,
    asked.modules,
    module,
  );
  const groups = groupByFolder(rows);

  if (asked.json) {
    io.stdout(
      `${JSON.stringify(
        {
          module,
          direction,
          count: rows.length,
          groups: groups.map((group) => ({
            folder: group.folder,
            modules: group.rows,
          })),
        },
        null,
        2,
      )}\n`,
    );

    return 0;
  }

  const verb = direction === "uses" ? "uses" : "is used by";
  const lines = [`${module} ${verb} ${plural(rows.length, "module")}`];

  for (const group of groups) {
    lines.push(group.folder === "" ? "./" : `${group.folder}/`);
    lines.push(...group.rows.map(rowLine));
  }

  io.stdout(`${lines.join("\n")}\n`);

  return 0;
}

export function runUses(argv: string[], io: Io): number {
  return neighbours(argv, io, "uses");
}

export function runUsedBy(argv: string[], io: Io): number {
  return neighbours(argv, io, "usedBy");
}

export function runCallers(argv: string[], io: Io): number {
  const asked = question(
    argv,
    io,
    "recognizer callers <module> <name> [--repository <dir>] [--json]",
    2,
    1,
  );
  const [module, name] = asked.positionals as [string, string];
  const index = buildCallerIndex(asked.scans);

  if (!index.known(module)) {
    throw new InputError([`scan has no call data for ${module}`]);
  }

  const { callers, constructed } = index.of(module, name);

  if (asked.json) {
    io.stdout(
      `${JSON.stringify({ module, name, constructed, callers }, null, 2)}\n`,
    );

    return 0;
  }

  io.stdout(
    `${[
      `${module}::${name} is called by ${plural(callers.length, "module")}`,
      ...callers.map(
        (caller) =>
          `  ${caller.module}${caller.through === null ? "" : ` (through ${caller.through})`}`,
      ),
      `built: ${constructed ? "yes" : "no"}`,
    ].join("\n")}\n`,
  );

  return 0;
}

function stepLine(step: PathStep): string {
  const names = step.names.length > 0 ? `  ${step.names.join(", ")}` : "";

  return `  ${step.from} -> ${step.to}${names}`;
}

export function runPath(argv: string[], io: Io): number {
  const asked = question(
    argv,
    io,
    "recognizer path <from> <to> [--repository <dir>] [--json]",
    2,
    2,
  );
  const [from, to] = asked.positionals as [string, string];
  const steps = shortestPath(asked.scans, asked.modules, from, to);

  if (asked.json) {
    io.stdout(
      `${JSON.stringify({ from, to, found: steps !== null, steps: steps ?? [] }, null, 2)}\n`,
    );
  } else if (steps === null) {
    io.stdout(`no path from ${from} to ${to}\n`);
  } else {
    io.stdout(
      `${[`${from} reaches ${to} in ${plural(steps.length, "step")}`, ...steps.map(stepLine)].join("\n")}\n`,
    );
  }

  return steps === null ? 1 : 0;
}
