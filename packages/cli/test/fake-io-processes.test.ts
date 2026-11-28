import {
  ioProcessesContract,
  type ProcessBehaviour,
  type SocketBehaviour,
} from "./adapter-contract/io-processes-contract.js";
import { FakeIo } from "./support/index.js";
import type { Program } from "./support/io/processes.js";

const PROGRAMS: Record<
  ProcessBehaviour["kind"],
  (behaviour: ProcessBehaviour) => Program
> = {
  exit: (behaviour) => (call) => {
    if (behaviour.kind !== "exit") {
      throw new Error("wrong behaviour");
    }

    call.stdout(behaviour.stdout);
    call.stderr(behaviour.stderr);

    return { started: true, status: behaviour.status, stdout: "", stderr: "" };
  },
  "echo-stdin": () => (call) => {
    call.stdout(call.stdin);

    return { started: true, status: 0, stdout: "", stderr: "" };
  },
  hold: () => () => new Promise(() => {}),
  stubborn: () => (call) => {
    call.survivesKill = true;
    call.stdout("ready\n");

    return new Promise(() => {});
  },
  mark: (behaviour) => (call) => {
    if (behaviour.kind !== "mark") {
      throw new Error("wrong behaviour");
    }

    call.files.writeFile(behaviour.file, call.args.join(" "));

    return { started: true, status: 0, stdout: "", stderr: "" };
  },
};

const SERVERS: Record<SocketBehaviour, (text: string) => string | null> = {
  echo: (text) => `got:${text}\n`,
  multi: () => "one\ntwo\n",
  close: () => null,
  empty: () => "\n",
  unterminated: () => "partial",
};

ioProcessesContract("Io processes contract (fake)", () => {
  const io = new FakeIo();

  return {
    io,
    directory: "/work",
    program: (name, behaviour) => {
      io.install(name, PROGRAMS[behaviour.kind](behaviour));

      return name;
    },
    serve: async (behaviour) => {
      io.listen("/work/server.sock", SERVERS[behaviour]);

      return "/work/server.sock";
    },
    elapse: async (ms) => {
      io.timers.advance(ms);
      await new Promise((resolve) => setImmediate(resolve));
    },
    dispose: () => {},
  };
});
