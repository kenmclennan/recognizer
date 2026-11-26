import { Repository } from "@recognizer/core";
import type { Loaded } from "../src/scan-loading";
import { readRepositoryFiles } from "../src/scan-loading";

export type RecordedCommand = {
  command: string;
  args: Record<string, unknown>;
  reply: unknown;
  at?: number;
};

export type SerialisedLoaded = Omit<Loaded, "scans" | "repository"> & {
  scans: { file: string; document: unknown }[];
};

export type Recording = {
  loaded: SerialisedLoaded;
  commands: RecordedCommand[];
  events: unknown[];
  answers: Record<string, unknown>;
  marks?: Record<string, number>;
  hostEvents?: { event: string; payload: unknown }[];
};

export function commandKey(
  command: string,
  args: Record<string, unknown> | undefined,
): string {
  return `${command} ${JSON.stringify(args ?? {})}`;
}

export function serialiseLoaded(
  loaded: Loaded,
  documents: { file: string; document: unknown }[],
): SerialisedLoaded {
  const { scans, repository: _repository, ...rest } = loaded;

  return JSON.parse(
    JSON.stringify({
      ...rest,
      scans: scans.map(({ file }) => ({
        file,
        document: documents.find((one) => one.file === file)?.document,
      })),
    }),
  );
}

export function reviveLoaded(serialised: SerialisedLoaded): Loaded {
  const scans = serialised.scans.map(({ file, document }) => ({
    file,
    repository: readRepositoryFiles([{ file, document }]),
  }));

  return {
    ...serialised,
    scans,
    repository: Repository.join(scans.map((one) => one.repository)),
  };
}

export function answerFor(
  recording: Recording,
  command: string,
  args: Record<string, unknown> | undefined,
  upTo?: number,
): unknown {
  const key = commandKey(command, args);
  const matches = recording.commands.filter(
    (one) =>
      commandKey(one.command, one.args) === key &&
      (upTo === undefined || (one.at ?? 0) <= upTo),
  );

  if (matches.length > 0) {
    return (matches[matches.length - 1] as RecordedCommand).reply;
  }

  if (command === "core_call" && args?.op === "scan.plan") {
    const planned = recording.commands.filter(
      (one) =>
        one.command === "core_call" &&
        one.args.op === "scan.plan" &&
        (upTo === undefined || (one.at ?? 0) <= upTo),
    );

    if (planned.length > 0) {
      return (planned[planned.length - 1] as RecordedCommand).reply;
    }
  }

  if (command.startsWith("plugin:")) {
    return null;
  }

  const op = command === "core_call" ? String(args?.op) : command;

  if (op in recording.answers) {
    return recording.answers[op];
  }

  throw new Error(`no recorded answer for ${command} ${JSON.stringify(args)}`);
}
