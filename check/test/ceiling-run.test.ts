import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import { nodeIo } from "../src/cli.js";

describe("nodeIo.run with a ceiling", () => {
  it("returns only the command's own stderr when it fails before the ceiling", () => {
    const result = nodeIo().run("sh", ["-c", "echo boom >&2; exit 1"], {
      timeoutMs: 5_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("boom\n");
    expect(result.timedOut).toBeUndefined();
  });

  it("returns only the command's own stderr when the watchdog is reaped late", () => {
    process.env.RECOGNIZER_CEILING_PAUSE = "0.3";

    try {
      const result = nodeIo().run("sh", ["-c", "echo boom >&2; exit 1"], {
        timeoutMs: 5_000,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toBe("boom\n");
    } finally {
      delete process.env.RECOGNIZER_CEILING_PAUSE;
    }
  });

  it("returns empty stderr when it succeeds before the ceiling", () => {
    const result = nodeIo().run("sh", ["-c", "exit 0"], { timeoutMs: 5_000 });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("still exits 124 for a command that outlives the ceiling", () => {
    const result = nodeIo().run("sh", ["-c", "sleep 30 & wait"], {
      timeoutMs: 300,
    });

    expect(result.status).toBe(124);
    expect(result.timedOut).toBe(true);
  });

  it("returns when the command ends even if pgrep cannot see the watchdog's sleep", () => {
    const stubs = makeTempDir("ceiling-pgrep-");
    const stub = join(stubs, "pgrep");

    writeFileSync(stub, "#!/bin/sh\nexit 1\n");
    chmodSync(stub, 0o755);

    const originalPath = process.env.PATH;
    process.env.PATH = `${stubs}:${originalPath}`;

    try {
      const started = Date.now();
      const result = nodeIo().run("sh", ["-c", "sleep 0.3"], {
        timeoutMs: 3_000,
      });
      const elapsed = Date.now() - started;

      expect(result.status).toBe(0);
      expect(result.timedOut).toBeUndefined();
      expect(elapsed).toBeLessThan(2_000);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("returns promptly on every one of 100 immediate commands @non-gating", () => {
    for (let call = 0; call < 100; call += 1) {
      const started = Date.now();
      const result = nodeIo().run("true", [], { timeoutMs: 3_000 });

      expect(result.status).toBe(0);
      expect(Date.now() - started).toBeLessThan(2_000);
    }
  }, 120_000);
});
