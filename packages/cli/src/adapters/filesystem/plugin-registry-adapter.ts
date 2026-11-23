import type {
  PluginRegistry,
  Registered,
  RegisterOutcome,
  Registration,
} from "@recognizer/core";
import { parse } from "yaml";
import type { Io } from "../../cli.js";
import { configFile } from "../../config.js";
import {
  addSection,
  addValue,
  type EditOutcome,
  setValue,
} from "../../config-edit.js";
import { CORE_KEYS, publish } from "../../config-keys.js";

class Refused extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function existingOf(text: string): Registered {
  let document: unknown;

  try {
    document = parse(text);
  } catch {
    document = null;
  }

  const record = isRecord(document) ? document : {};
  const command = isRecord(record.describer)
    ? record.describer.command
    : undefined;

  return {
    sensors: isRecord(record.sensors) ? record.sensors : {},
    describerProgram:
      Array.isArray(command) && typeof command[0] === "string"
        ? command[0]
        : undefined,
  };
}

function unwrap(outcome: EditOutcome, text: string): string {
  if (outcome.status === "refused") {
    throw new Refused(outcome.reason);
  }

  return outcome.status === "ok" ? outcome.text : text;
}

function sensorWords(program: string): string[] {
  return [
    program,
    "run",
    "--repository",
    "{repository}",
    "--commit",
    "{commit}",
    "--output",
    "{output}",
  ];
}

function describerWords(program: string): string[] {
  return [program, "run", "--model", "{model}", "{request}"];
}

function edited(
  original: string,
  existing: Registered,
  registration: Registration,
): { text: string; registered: boolean } {
  const { kind, name, program, manifest } = registration;
  const published = publish([CORE_KEYS], "config");
  let text = original;

  const registered =
    kind === "sensor"
      ? existing.sensors[name] !== undefined && existing.sensors[name] !== null
      : existing.describerProgram === program;

  if (!registered) {
    if (kind === "sensor" && registration.shipped) {
      text = unwrap(addSection(text, published, `sensors.${name}`), text);
    } else if (kind === "sensor") {
      for (const word of sensorWords(program)) {
        text = unwrap(
          addValue(text, published, `sensors.${name}.command`, word),
          text,
        );
      }
    } else {
      for (const word of describerWords(program)) {
        text = unwrap(
          addValue(text, published, "describer.command", word),
          text,
        );
      }

      text = unwrap(
        setValue(
          text,
          published,
          "describer.version",
          manifest.prompt_version as string,
        ),
        text,
      );
    }
  }

  text = unwrap(
    setValue(text, published, `install.${program}`, manifest.install),
    text,
  );

  return { text, registered };
}

export class PluginRegistryAdapter implements PluginRegistry {
  constructor(private readonly io: Io) {}

  private original(root: string): string {
    const file = configFile(root);

    return this.io.exists(file) ? this.io.readFile(file) : "";
  }

  registered(root: string): Registered {
    return existingOf(this.original(root));
  }

  register(root: string, registration: Registration): RegisterOutcome {
    const file = configFile(root);
    const original = this.original(root);
    let result: { text: string; registered: boolean };

    try {
      result = edited(original, existingOf(original), registration);
    } catch (error) {
      if (error instanceof Refused) {
        return { status: "refused", reason: error.message };
      }

      throw error;
    }

    if (result.text !== original || !this.io.exists(file)) {
      const temporary = `${file}.${this.io.pid()}.tmp`;

      this.io.writeFile(temporary, result.text);
      this.io.rename(temporary, file);
    }

    return { status: result.registered ? "already-registered" : "registered" };
  }
}
