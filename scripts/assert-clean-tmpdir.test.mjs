import { describe, expect, it } from "vitest";
import { runWithCleanTmpdir } from "./assert-clean-tmpdir.mjs";

const node = (source) => [process.execPath, ["-e", source]];

describe("runWithCleanTmpdir", () => {
  it("fails and names a directory the command leaves in TMPDIR", () => {
    const { status, left } = runWithCleanTmpdir(
      ...node(
        "require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'leak-'))",
      ),
    );

    expect(status).toBe(1);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatch(/^leak-/);
  });

  it("passes when the command removes what it made", () => {
    const { status, left } = runWithCleanTmpdir(
      ...node(
        "const fs = require('node:fs'); const d = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'tidy-')); fs.rmSync(d, { recursive: true })",
      ),
    );

    expect(status).toBe(0);
    expect(left).toEqual([]);
  });

  it("keeps the command's own exit status when it fails", () => {
    const { status } = runWithCleanTmpdir(...node("process.exit(3)"));

    expect(status).toBe(3);
  });
});
