import { describe, expect, it } from "vitest";

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
});
