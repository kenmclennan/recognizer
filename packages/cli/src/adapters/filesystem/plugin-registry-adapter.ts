import {
  type EditKeyOutcome,
  editKey,
  type KeyEditPorts,
  type PluginRegistry,
  type Registered,
  type RegisterOutcome,
  type Registration,
} from "@recognizer/core";
import { parse } from "yaml";
import type { Io } from "../../cli.js";
import { configFile } from "../../config.js";
import { PolicyAdapter } from "./policy-adapter.js";
import { saveRepositoryText } from "./repository-text.js";
import { YamlKeyedTextAdapter } from "./yaml-keyed-text-adapter.js";

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

const NO_OWNERS: KeyEditPorts["keyOwners"] = {
  schemas: () => ({
    schema: {
      keys_version: 1,
      owner: "sensors",
      placeholders: {},
      sections: [],
      keys: [],
    },
    notAnswering: [],
  }),
};

class Edits {
  private held: string;

  constructor(
    original: string,
    private readonly io: Io,
  ) {
    this.held = original;
  }

  get text(): string {
    return this.held;
  }

  private ports(): KeyEditPorts {
    return {
      config: {
        text: () => ({ present: true, text: this.held, hash: "" }),
        saveText: (_root, text) => {
          this.held = text;
        },
      },
      policy: new PolicyAdapter(this.io),
      keyedText: new YamlKeyedTextAdapter(),
      keyOwners: NO_OWNERS,
    };
  }

  apply(verb: "set" | "add" | "add-section", key: string, value?: string) {
    const outcome: EditKeyOutcome = editKey(this.ports(), {
      subject: "config",
      root: "",
      verb,
      key,
      ...(value === undefined ? {} : { value }),
    });

    if (outcome.status === "refused") {
      throw new Refused(`${outcome.reason}${outcome.suffix}`);
    }
  }
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
  io: Io,
): { text: string; registered: boolean } {
  const { kind, name, program, manifest } = registration;
  const edits = new Edits(original, io);

  const registered =
    kind === "sensor"
      ? existing.sensors[name] !== undefined && existing.sensors[name] !== null
      : existing.describerProgram === program;

  if (!registered) {
    if (kind === "sensor" && registration.shipped) {
      edits.apply("add-section", `sensors.${name}`);
    } else if (kind === "sensor") {
      for (const word of sensorWords(program)) {
        edits.apply("add", `sensors.${name}.command`, word);
      }
    } else {
      for (const word of describerWords(program)) {
        edits.apply("add", "describer.command", word);
      }

      edits.apply(
        "set",
        "describer.version",
        manifest.prompt_version as string,
      );
    }
  }

  edits.apply("set", `install.${program}`, manifest.install);

  return { text: edits.text, registered };
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
      result = edited(original, existingOf(original), registration, this.io);
    } catch (error) {
      if (error instanceof Refused) {
        return { status: "refused", reason: error.message };
      }

      throw error;
    }

    if (result.text !== original || !this.io.exists(file)) {
      saveRepositoryText(this.io, file, result.text);
    }

    return { status: result.registered ? "already-registered" : "registered" };
  }
}
