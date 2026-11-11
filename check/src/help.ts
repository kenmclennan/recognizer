import { resolve } from "node:path";
import { agentGuide } from "./agent-guide.js";
import type { Io } from "./cli.js";
import { COMMANDS, type Command } from "./commands.js";
import { InputError } from "./errors.js";
import { guideText, sensorsToCheck } from "./sensors-check.js";

export function shortHelp(commands: Command[] = COMMANDS): string {
  const width = Math.max(...commands.map((command) => command.name.length));
  const lines = commands.map(
    (command) => `  ${command.name.padEnd(width)}  ${command.summary}`,
  );

  return [
    `usage: recognizer <${commands.map((command) => command.name).join("|")}> ...`,
    "",
    ...lines,
    "",
    "run `recognizer help <command>` or `recognizer <command> --help` for a command in full",
    "run `recognizer --version` for the version",
    "run `recognizer help agents` for the guide an agent follows",
    "",
  ].join("\n");
}

function section(label: string, lines: string[]): string[] {
  return lines.length === 0
    ? []
    : [label, ...lines.flatMap((l) => l.split("\n")).map((l) => `  ${l}`), ""];
}

export function fullHelp(command: Command): string {
  return [
    `recognizer ${command.name} - ${command.summary}`,
    "",
    ...section("Usage:", [command.usage]),
    ...section(
      "Arguments:",
      command.arguments.map((a) => `${a.name}  ${a.description}`),
    ),
    ...section(
      "Options:",
      command.options.map((o) => `${o.flag}  ${o.description}`),
    ),
    ...section("Output:", [
      `text: ${command.output.text}`,
      `--json: ${command.output.json}`,
    ]),
    ...section(
      "Exit codes:",
      command.exitCodes.map((e) => `${e.code}  ${e.meaning}`),
    ),
    ...section(
      "Examples:",
      command.examples.flatMap((e) => [e.command, `    ${e.note}`]),
    ),
  ].join("\n");
}

function runSensorGuide(sensor: string, io: Io): number {
  const root = resolve(".");
  const [selected] = sensorsToCheck(io, root, sensor) as [
    { name: string; command: string[] },
  ];
  const guide = guideText(io, root, selected);

  if ("failure" in guide) {
    io.stderr(`${guide.failure}\n`);

    return 1;
  }

  io.stdout(
    guide.text.trim() === ""
      ? `${selected.name} supplies no setup guide\n`
      : guide.text,
  );

  return 0;
}

export function runHelp(argv: string[], io: Io): number {
  const [name, ...rest] = argv;

  if (name === undefined) {
    io.stdout(shortHelp());

    return 0;
  }

  if (name === "agents" && rest.length === 0) {
    io.stdout(agentGuide());

    return 0;
  }

  if (name === "sensors" && rest.length === 1) {
    return runSensorGuide(rest[0] as string, io);
  }

  const command = COMMANDS.find((entry) => entry.name === name);

  if (command === undefined || rest.length > 0) {
    throw new InputError([
      `no such command: ${argv.join(" ")}`,
      `commands: ${COMMANDS.map((entry) => entry.name).join(", ")}`,
    ]);
  }

  io.stdout(fullHelp(command));

  return 0;
}
