import { statSync } from "node:fs";
import { afterAll } from "vitest";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import { nodeIo } from "../../src/cli.js";
import { StopScope } from "../../src/stop-scope.js";
import { ioFilesContract } from "./io-files-contract.js";

const scope = new StopScope();

afterAll(() => scope.stop(0, 100));

ioFilesContract("Io files contract (real)", () => ({
  io: nodeIo(scope),
  directory: makeTempDir("io-files-contract-"),
  modeOf: (path) => {
    try {
      return statSync(path).mode & 0o777;
    } catch {
      return undefined;
    }
  },
}));
