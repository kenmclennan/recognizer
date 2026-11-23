import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { NeighbourRow, PathStep } from "@recognizer/core";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
import { visualisationFor } from "./visualisation-container.js";

interface Question {
  io: Io;
  root: string;
  json: boolean;
  positionals: string[];
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

  return {
    io,
    root: resolve(values.repository ?? "."),
    json: values.json === true,
    positionals,
  };
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
  const asked = load(
    argv,
    io,
    `recognizer ${command} <module> [--repository <dir>] [--json]`,
    1,
  );
  const core = visualisationFor(io, asked.root);
  const request = { root: asked.root, module: asked.positionals[0] as string };
  const { module, rows, groups } =
    direction === "uses" ? core.askUses(request) : core.askUsedBy(request);

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
  const lines = [`${module} ${verb} ${plural(rows.length, "file")}`];

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
  const asked = load(
    argv,
    io,
    "recognizer callers <module> <name> [--repository <dir>] [--json]",
    2,
  );
  const [module, name] = asked.positionals as [string, string];
  const { callers, constructed } = visualisationFor(io, asked.root).askCallers({
    root: asked.root,
    module,
    name,
  });

  if (asked.json) {
    io.stdout(
      `${JSON.stringify({ module, name, constructed, callers }, null, 2)}\n`,
    );

    return 0;
  }

  io.stdout(
    `${[
      `${module}::${name} is called by ${plural(callers.length, "file")}`,
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
  const asked = load(
    argv,
    io,
    "recognizer path <from> <to> [--repository <dir>] [--json]",
    2,
  );
  const [from, to] = asked.positionals as [string, string];
  const { steps } = visualisationFor(io, asked.root).askPath({
    root: asked.root,
    from,
    to,
  });

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
