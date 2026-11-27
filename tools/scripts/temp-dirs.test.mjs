import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "./temp-dirs.mjs";

const module = fileURLToPath(new URL("./temp-dirs.mjs", import.meta.url));

describe("makeTempDir", () => {
  it("removes made folders at process exit", () => {
    const tmp = makeTempDir("temp-dirs-exit-");
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { makeTempDir } from ${JSON.stringify(module)}; console.log(makeTempDir("exit-made-"));`,
      ],
      { encoding: "utf8", env: { ...process.env, TMPDIR: tmp } },
    );
    const made = result.stdout.trim();

    expect(made).toContain("exit-made-");
    expect(existsSync(made)).toBe(false);
  });
});
