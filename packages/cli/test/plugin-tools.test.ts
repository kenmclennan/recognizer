import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { manifestOf, type RealTool } from "./plugin-tools.js";

function script(name: string, body: string): RealTool {
  const path = join(makeTempDir("plugin-tools-"), name);

  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);

  return { name, path };
}

function thrown(tool: RealTool): string {
  try {
    manifestOf(tool);
  } catch (error) {
    return (error as Error).message;
  }

  return "";
}

describe("manifestOf", () => {
  it("reports the exit status and stderr of a tool that fails", () => {
    const message = thrown(script("fails", "echo boom >&2\nexit 3"));

    expect(message).toMatch(/status 3/);
    expect(message).toContain("boom");
  });

  it("reports the signal of a tool killed by a signal", () => {
    expect(thrown(script("killed", "kill -9 $$"))).toContain("SIGKILL");
  });

  it("reports a tool that exits 0 with empty output", () => {
    const message = thrown(script("silent", "exit 0"));

    expect(message).toContain("empty output");
    expect(message).toContain("stdout length 0");
  });

  it("returns the manifest of a tool that answers", () => {
    const tool = script("answers", `echo '{"kind":"sensor","name":"x"}'`);

    expect(manifestOf(tool)).toEqual({ kind: "sensor", name: "x" });
  });
});
