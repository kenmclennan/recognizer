import { join } from "node:path";
import {
  type Describer,
  InvalidRequest,
  type LocatedDescriber,
  type ResponsibilityStatesView,
  readResponsibilityStates,
} from "@recognizer/core";
import { ResponsibilitiesAdapter } from "../adapters/filesystem/responsibilities-adapter.js";
import { StructureAdapter } from "../adapters/filesystem/structure-adapter.js";
import { DescriberAdapter } from "../adapters/plugins/describer-adapter.js";
import type { Io } from "../cli.js";
import { configFile } from "../config.js";
import { parseConfig } from "../config-parse.js";
import { InputError } from "../errors.js";

class WholeConfigDescriber implements Pick<Describer, "locate"> {
  private readonly inner: DescriberAdapter;

  constructor(private readonly io: Io) {
    this.inner = new DescriberAdapter(io);
  }

  locate(root: string): LocatedDescriber {
    const path = configFile(root);

    if (this.io.exists(path)) {
      try {
        parseConfig(this.io.readFile(path));
      } catch (error) {
        throw new InvalidRequest([
          `config.yaml: ${
            error instanceof InputError
              ? error.messages.join("; ")
              : (error as Error).message
          }`,
        ]);
      }
    }

    return this.inner.locate(root);
  }
}

export function readResponsibilitiesOp(
  io: Io,
  root: string,
  modules: string[],
): ResponsibilityStatesView {
  const modified = io.modified?.(
    join(root, ".recognizer", "responsibilities.json"),
  );

  return readResponsibilityStates(
    {
      structure: new StructureAdapter(io),
      describer: new WholeConfigDescriber(io),
      responsibilities: new ResponsibilitiesAdapter(io),
    },
    {
      root,
      modules,
      describedAtMs:
        modified === undefined || modified === null
          ? null
          : Math.floor(modified),
    },
  );
}
