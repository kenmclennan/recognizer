import { spawn, spawnSync } from "node:child_process";
import { constants, freemem, loadavg, uptime } from "node:os";
import { pathToFileURL } from "node:url";

const KILLED_CODES = new Set([143, 134]);
const MAX_ROWS = 300;
const MAX_COMMAND = 200;
const RUNNER = /Runner\.(Listener|Worker)/;

export function describeExit({ code, signal }) {
  if (signal) {
    return { killed: true, cause: `child ended by ${signal}` };
  }

  if (KILLED_CODES.has(code)) {
    return { killed: true, cause: `child exited ${code}` };
  }

  return { killed: false, cause: "" };
}

export function parseRows(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const match = line.match(
        /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/,
      );

      if (match === null) {
        return undefined;
      }

      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        pgid: Number(match[3]),
        user: match[4],
        etime: match[5],
        command: match[6],
      };
    })
    .filter((row) => row !== undefined);
}

export function ancestry(rows, pid) {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const chain = [];
  const seen = new Set();
  let current = byPid.get(pid);

  while (current !== undefined && !seen.has(current.pid)) {
    chain.push(current.pid);
    seen.add(current.pid);
    current = byPid.get(current.ppid);
  }

  return chain;
}

function formatRow(row, marked) {
  const command =
    row.command.length > MAX_COMMAND
      ? row.command.slice(0, MAX_COMMAND)
      : row.command;

  return `${marked ? "* " : "  "}${row.pid} ${row.ppid} ${row.pgid} ${row.user} ${row.etime} ${command}`;
}

export function buildRecord({
  cause,
  now,
  pid,
  ppid,
  pgid,
  uptimeSeconds,
  load,
  free,
  rows,
}) {
  const chain = ancestry(rows, pid);
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const kept = rows.slice(0, MAX_ROWS);

  const lines = [
    `::error title=job-killed::${cause}`,
    `time ${now}`,
    `witness pid ${pid} ppid ${ppid} pgid ${pgid}`,
    `uptime ${uptimeSeconds}s loadavg ${load.join(" ")} freemem ${free}`,
    "ancestry (pid ppid pgid user etime command):",
    ...chain.map((id) =>
      formatRow(byPid.get(id), RUNNER.test(byPid.get(id).command)),
    ),
    `process table (${kept.length} of ${rows.length} rows, * marks runner processes):`,
    ...kept.map((row) => formatRow(row, RUNNER.test(row.command))),
  ];

  if (rows.length > MAX_ROWS) {
    lines.push(`table cut to ${MAX_ROWS} rows of ${rows.length}`);
  }

  return lines.join("\n");
}

function readRows() {
  const result = spawnSync(
    "ps",
    ["-A", "-o", "pid=,ppid=,pgid=,user=,etime=,command="],
    {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    },
  );

  return typeof result.stdout === "string" ? parseRows(result.stdout) : [];
}

function report(cause) {
  process.stderr.write(
    `${buildRecord({
      cause,
      now: new Date().toISOString(),
      pid: process.pid,
      ppid: process.ppid,
      pgid: Number(
        spawnSync("ps", ["-o", "pgid=", "-p", String(process.pid)], {
          encoding: "utf8",
        }).stdout,
      ),
      uptimeSeconds: Math.round(uptime()),
      load: loadavg().map((value) => value.toFixed(2)),
      free: freemem(),
      rows: readRows(),
    })}\n`,
  );
}

function main(argv) {
  const [command, ...args] = argv;

  if (command === undefined) {
    process.stderr.write("usage: signal-witness.mjs <command> [args...]\n");
    process.exit(2);
  }

  const child = spawn(command, args, { stdio: "inherit" });
  let received;

  for (const name of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.on(name, () => {
      received ??= name;
      child.kill(name);
    });
  }

  child.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(127);
  });

  child.on("exit", (code, signal) => {
    if (received !== undefined) {
      report(`received ${received}`);
      process.exit(128 + constants.signals[received]);
    }

    const outcome = describeExit({ code, signal });

    if (outcome.killed) {
      report(outcome.cause);
    }

    process.exit(signal ? 128 + constants.signals[signal] : (code ?? 1));
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2));
}
