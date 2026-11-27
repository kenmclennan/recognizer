import { resolve } from "node:path";
import { freshScansOver, type Repository } from "@recognizer/core";
import type { Io } from "./cli.js";
import type { ConfigRead } from "./config.js";
import { asInputError } from "./errors.js";
import { freshPorts } from "./fresh-ports.js";
import { requestFrom } from "./scan-main.js";

export interface FreshScans {
  repository: Repository;
  scanned: boolean;
}

export function freshScans(io: Io, root: string, read: ConfigRead): FreshScans {
  const directory = resolve(root);

  return asInputError(() =>
    freshScansOver(
      freshPorts(io, read),
      { scan: requestFrom([directory, "--extract"], io).request },
      directory,
    ),
  );
}
