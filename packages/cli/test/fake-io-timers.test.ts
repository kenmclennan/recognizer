import { ioTimersContract } from "./adapter-contract/io-timers-contract.js";
import { FakeIo } from "./support/index.js";

ioTimersContract("Io timers contract (fake)", () => {
  const io = new FakeIo();

  return {
    io,
    elapse: async (ms) => {
      io.timers.advance(ms);
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
});
