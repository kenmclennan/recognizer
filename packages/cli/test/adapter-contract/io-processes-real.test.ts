import { type ChildProcess, spawn } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll } from "vitest";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import { nodeIo } from "../../src/cli.js";
import { StopScope } from "../../src/stop-scope.js";
import {
  ioProcessesContract,
  type ProcessBehaviour,
} from "./io-processes-contract.js";

const scope = new StopScope();

afterAll(() => scope.stop(0, 100));

const SERVER = [
  'const net = require("net");',
  "const [socket, behaviour] = process.argv.slice(1);",
  "const server = net.createServer((connection) => {",
  '  let received = "";',
  '  connection.on("error", () => {});',
  '  connection.on("data", (chunk) => {',
  "    received += chunk;",
  '    if (!received.includes("\\n")) return;',
  '    const line = received.split("\\n")[0];',
  '    if (behaviour === "echo") connection.write("got:" + line + "\\n");',
  '    if (behaviour === "multi") connection.write("one\\ntwo\\n");',
  '    if (behaviour === "empty") connection.write("\\n");',
  '    if (behaviour === "unterminated") connection.write("partial");',
  "    connection.end();",
  "  });",
  "});",
  'server.listen(socket, () => process.stdout.write("ready\\n"));',
].join("\n");

function script(behaviour: ProcessBehaviour): string {
  switch (behaviour.kind) {
    case "exit":
      return `printf '%s' '${behaviour.stdout}'\nprintf '%s' '${behaviour.stderr}' >&2\nexit ${behaviour.status}\n`;
    case "echo-stdin":
      return "exec cat\n";
    case "hold":
      return "exec sleep 30\n";
    case "stubborn":
      return "trap '' TERM\nprintf 'ready\\n'\nexec sleep 30\n";
    case "mark":
      return `printf '%s' "$*" > '${behaviour.file}'\n`;
  }
}

ioProcessesContract("Io processes contract (real)", () => {
  const directory = makeTempDir("io-processes-contract-");
  const sockets = makeTempDir("io-sock-");
  const servers: ChildProcess[] = [];

  return {
    io: nodeIo(scope),
    directory,
    program: (name, behaviour) => {
      const path = join(directory, name);

      writeFileSync(path, `#!/bin/sh\n${script(behaviour)}`);
      chmodSync(path, 0o755);

      return path;
    },
    serve: (behaviour) =>
      new Promise((resolve, reject) => {
        const socket = join(sockets, `s${servers.length}.sock`);
        const server = spawn(
          process.execPath,
          ["-e", SERVER, socket, behaviour],
          { stdio: ["ignore", "pipe", "inherit"] },
        );

        servers.push(server);
        server.on("error", reject);
        server.stdout?.once("data", () => resolve(socket));
      }),
    elapse: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    dispose: () => {
      for (const server of servers) {
        server.kill("SIGKILL");
      }
    },
  };
});
