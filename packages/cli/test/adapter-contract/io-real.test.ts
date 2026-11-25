import { afterAll } from "vitest";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import { nodeIo } from "../../src/cli.js";
import { StopScope } from "../../src/stop-scope.js";
import { launcher } from "../serve-harness.js";
import { ioContract } from "./io-contract.js";

const scope = new StopScope();

afterAll(() => scope.stop(0, 100));

ioContract("Io contract (real)", () => {
  const directory = makeTempDir("io-contract-");

  return {
    io: nodeIo(scope),
    directory,
    program: (name, behaviour) => {
      launcher(
        directory,
        name,
        behaviour.kind === "exit"
          ? `printf '${behaviour.stdout}'; printf '${behaviour.stderr}' >&2; exit ${behaviour.status}`
          : "exec sleep 30",
      );

      return `${directory}/${name}`;
    },
    elapse: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
});
