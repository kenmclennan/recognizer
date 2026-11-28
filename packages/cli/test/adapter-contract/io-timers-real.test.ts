import { afterAll } from "vitest";
import { nodeIo } from "../../src/cli.js";
import { StopScope } from "../../src/stop-scope.js";
import { ioTimersContract } from "./io-timers-contract.js";

const scope = new StopScope();

afterAll(() => scope.stop(0, 100));

ioTimersContract("Io timers contract (real)", () => ({
  io: nodeIo(scope),
  elapse: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}));
