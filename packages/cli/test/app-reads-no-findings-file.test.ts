import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("the app and the findings files", () => {
  it("app_reads_no_findings_or_overlay_file", () => {
    const found = spawnSync(
      "git",
      [
        "grep",
        "-n",
        "-E",
        "cache/(findings|overlays)",
        "--",
        "packages/app/src",
        "packages/app/src-tauri/src",
      ],
      { cwd: REPO, encoding: "utf8" },
    );
    const lines = found.stdout.split("\n").filter((line) => line !== "");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("packages/app/src-tauri/src/fs_safe.rs:");
  });
});
