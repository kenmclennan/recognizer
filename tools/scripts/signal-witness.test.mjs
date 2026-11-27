import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ancestry,
  buildRecord,
  describeExit,
  parseRows,
} from "./signal-witness.mjs";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "signal-witness.mjs",
);

function row(pid, ppid, command = "cmd") {
  return { pid, ppid, pgid: pid, user: "u", etime: "00:01", command };
}

function witness(source) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [SCRIPT, process.execPath, "-e", source],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("exit", (status) =>
      resolve({ status, stdout, stderr, pid: child.pid }),
    );
  });
}

describe("describeExit", () => {
  it.each([
    [{ code: 143 }, true],
    [{ code: 134 }, true],
    [{ signal: "SIGTERM" }, true],
    [{ signal: "SIGABRT" }, true],
    [{ code: 0 }, false],
    [{ code: 1 }, false],
    [{ code: 3 }, false],
    [{ code: 142 }, false],
    [{ code: 144 }, false],
  ])("classifies %j as killed=%s", (exit, killed) => {
    expect(describeExit(exit).killed).toBe(killed);
  });
});

describe("ancestry", () => {
  it("follows parents to pid 1", () => {
    const rows = [row(30, 20), row(20, 10), row(10, 1), row(1, 0)];

    expect(ancestry(rows, 30)).toEqual([30, 20, 10, 1]);
  });

  it("stops at a parent missing from the table", () => {
    expect(ancestry([row(99, 98)], 99)).toEqual([99]);
  });

  it("stops at a cycle", () => {
    expect(ancestry([row(5, 6), row(6, 5)], 5)).toEqual([5, 6]);
  });
});

describe("buildRecord", () => {
  const base = {
    cause: "received SIGTERM",
    now: "2026-11-27T00:00:00.000Z",
    pid: 30,
    ppid: 20,
    pgid: 30,
    uptimeSeconds: 5,
    load: ["0.10", "0.20", "0.30"],
    free: 1024,
  };

  it("names the cause, the witness pid, the ancestry and marks runner rows", () => {
    const rows = [
      row(30, 20, "node witness"),
      row(20, 10, "bash"),
      row(10, 1, "Runner.Worker run"),
    ];

    const text = buildRecord({ ...base, rows });

    expect(text).toContain("::error title=job-killed::received SIGTERM");
    expect(text).toContain("witness pid 30");
    expect(text).toContain("  20 10 20 u 00:01 bash");
    expect(text).toContain("* 10 1 10 u 00:01 Runner.Worker run");
  });

  it("keeps 300 rows of 301 and says so", () => {
    const rows = [row(30, 1)];

    for (let pid = 100; pid < 400; pid++) {
      rows.push(row(pid, 1));
    }

    const text = buildRecord({ ...base, rows });

    expect(rows).toHaveLength(301);
    expect(text).toContain("table cut to 300 rows of 301");
    expect(text).toContain("(300 of 301 rows");
  });
});

describe("parseRows", () => {
  it("reads a ps line", () => {
    expect(parseRows("  12 1 12 root 01:02 /bin/sh -c x\n")).toEqual([
      {
        pid: 12,
        ppid: 1,
        pgid: 12,
        user: "root",
        etime: "01:02",
        command: "/bin/sh -c x",
      },
    ]);
  });
});

describe("the witness script", () => {
  it("records a SIGTERM it receives and exits 143", async () => {
    const result = await witness(
      "process.kill(process.ppid, 'SIGTERM'); setInterval(() => {}, 1000)",
    );

    expect(result.status).toBe(143);
    expect(result.stderr).toContain("received SIGTERM");
    expect(result.stderr).toContain(`witness pid ${result.pid}`);
  });

  it("records a child ended by SIGABRT and exits 134", async () => {
    const result = await witness("process.kill(process.pid, 'SIGABRT')");

    expect(result.status).toBe(134);
    expect(result.stderr).toContain("child ended by SIGABRT");
    expect(result.stderr).toContain(`witness pid ${result.pid}`);
  });

  it("records a child exit of 143", async () => {
    const result = await witness("process.exit(143)");

    expect(result.status).toBe(143);
    expect(result.stderr).toContain("child exited 143");
    expect(result.stderr).toContain(`witness pid ${result.pid}`);
  });

  it("is silent when the child exits 0", async () => {
    const result = await witness("console.log('ran')");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ran");
    expect(result.stderr).toBe("");
  });

  it("is silent and passes through status 3", async () => {
    const result = await witness("process.exit(3)");

    expect(result.status).toBe(3);
    expect(result.stderr).toBe("");
  });
});
