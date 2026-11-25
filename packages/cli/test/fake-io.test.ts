import { ioContract } from "./adapter-contract/io-contract.js";
import { FAKE_BIN, FakeIo } from "./support/index.js";

ioContract("Io contract (fake)", () => {
  const io = new FakeIo();

  return {
    io,
    directory: "/work",
    program: (name, behaviour) => {
      io.install(name, () =>
        behaviour.kind === "exit"
          ? {
              started: true,
              status: behaviour.status,
              stdout: behaviour.stdout,
              stderr: behaviour.stderr,
            }
          : new Promise(() => {}),
      );

      return `${FAKE_BIN}/${name}`;
    },
    elapse: async (ms) => {
      io.timers.advance(ms);
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
});
