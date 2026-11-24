import { join } from "node:path";
import {
  InvalidRequest,
  Responsibilities,
  type ResponsibilitiesRepository,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { InputError } from "../../errors.js";
import {
  type ResponsibilityEntry,
  toResponsibility,
  validateResponsibilities,
} from "../../responsibilities.js";

function responsibilitiesFile(root: string): string {
  return join(root, ".recognizer", "responsibilities.json");
}

export class ResponsibilitiesAdapter implements ResponsibilitiesRepository {
  constructor(private readonly io: Io) {}

  read(root: string): Responsibilities {
    const file = responsibilitiesFile(root);
    const held = new Responsibilities();

    if (!this.io.exists(file)) {
      return held;
    }

    try {
      const { modules } = validateResponsibilities(
        JSON.parse(this.io.readFile(file)),
      );

      for (const [id, entry] of Object.entries(modules)) {
        held.set(id, toResponsibility(entry));
      }

      return held;
    } catch (error) {
      if (error instanceof InputError) {
        throw new InvalidRequest(error.messages);
      }

      throw new InvalidRequest([
        `responsibilities is not valid JSON: ${(error as Error).message}`,
      ]);
    }
  }

  write(root: string, responsibilities: Responsibilities): void {
    const file = responsibilitiesFile(root);
    const temp = `${file}.tmp`;
    const modules: Record<string, ResponsibilityEntry> = {};

    for (const id of responsibilities.ids()) {
      const entry = responsibilities.get(id) as NonNullable<
        ReturnType<Responsibilities["get"]>
      >;

      modules[id] = {
        line: entry.line,
        source_hash: entry.sourceHash,
        describer: [...entry.describer],
        version: entry.version,
      };
    }

    this.io.writeFile(
      temp,
      `${JSON.stringify({ schema_version: 1, modules }, null, 2)}\n`,
    );
    this.io.rename(temp, file);
  }
}
