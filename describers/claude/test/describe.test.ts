import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { promptVersion, versionOf } from "../src/prompt.js";
import {
  claudeRan,
  PROMPT_FILE,
  REPO,
  REQUEST,
  recorded,
  run,
  sandbox,
  writeRequest,
} from "./helpers.js";

describe("prompt reaches claude", () => {
  it("sends the prompt, outline and source on stdin with fixed arguments", () => {
    const box = sandbox();
    const result = run(box, [writeRequest(box, REQUEST)]);
    const stdin = recorded(box, "stdin");

    expect(result.status).toBe(0);
    expect(stdin.startsWith(readFileSync(PROMPT_FILE, "utf8"))).toBe(true);
    expect(stdin).toContain("Module: shop/domain/order.py\nKind: module\n");
    expect(stdin).toContain('Outline (JSON):\n{\n  "members": [');
    expect(stdin).toContain("shop/domain/money.py");
    expect(stdin).toContain("shop/application/place.py");
    expect(stdin.endsWith(`Source:\n${REQUEST.source}`)).toBe(true);
    expect(JSON.parse(recorded(box, "argv"))).toEqual([
      "-p",
      "--tools",
      "",
      "--no-session-persistence",
    ]);
    expect(recorded(box, "cwd")).not.toBe(box.directory);
  });
});

describe("one line, trimmed", () => {
  it("prints the trimmed reply and a newline", () => {
    const box = sandbox();
    const result = run(box, [writeRequest(box, REQUEST)], {
      FAKE_CLAUDE_MODE: "padded",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("Handles orders.\n");
  });
});

describe("failure prints nothing", () => {
  const modes = ["fail", "empty", "blank", "two"];

  it.each(modes)("exits 1 with empty stdout for %s", (mode) => {
    const box = sandbox();
    const result = run(box, [writeRequest(box, REQUEST)], {
      FAKE_CLAUDE_MODE: mode,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toBe("");
  });

  it("carries claude's stderr in the reason", () => {
    const box = sandbox();
    const result = run(box, [writeRequest(box, REQUEST)], {
      FAKE_CLAUDE_MODE: "fail",
    });

    expect(result.stderr).toContain("claude exploded");
  });

  it("exits 1 when no claude is on PATH", () => {
    const box = sandbox();
    const result = run(box, [writeRequest(box, REQUEST)], {}, [
      dirname(process.execPath),
    ]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toBe("");
  });
});

describe("usage errors", () => {
  const cases: [string, (file: string) => string[], unknown][] = [
    ["no argument", () => [], REQUEST],
    ["two arguments", (file) => [file, file], REQUEST],
    ["a missing file", (file) => [`${file}.missing`], REQUEST],
    ["invalid JSON", (file) => [file], "{not json"],
    [
      "a request without source",
      (file) => [file],
      { ...REQUEST, source: undefined },
    ],
  ];

  it.each(cases)(
    "exits 2 for %s without running claude",
    (_name, args, body) => {
      const box = sandbox();
      const file = writeRequest(box, body);
      const result = run(box, args(file));

      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toBe("");
      expect(claudeRan(box)).toBe(false);
    },
  );

  it("prints the prompt version without running claude", () => {
    const box = sandbox();
    const result = run(box, ["--prompt-version"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${promptVersion()}\n`);
    expect(claudeRan(box)).toBe(false);
  });
});

describe("prompt version", () => {
  it("is prompt- plus the first 12 hex of the SHA-256 of prompt.md", () => {
    const digest = createHash("sha256")
      .update(readFileSync(PROMPT_FILE))
      .digest("hex");

    expect(promptVersion()).toBe(`prompt-${digest.slice(0, 12)}`);
  });

  it("changes when one byte of the prompt changes", () => {
    const text = readFileSync(PROMPT_FILE, "utf8");

    expect(versionOf(`${text}.`)).not.toBe(versionOf(text));
  });

  it("keeps the prompt text in exactly one file", () => {
    const first = readFileSync(PROMPT_FILE, "utf8").split("\n")[0] as string;
    const found = filesUnder(REPO).filter((file) =>
      readFileSync(file, "utf8").includes(first),
    );

    expect(found.map((file) => relative(REPO, file))).toEqual([
      "describers/claude/prompt.md",
    ]);
  });
});

function filesUnder(root: string): string[] {
  const skipped = new Set([
    "node_modules",
    "dist",
    ".git",
    ".worktrees",
    "target",
  ]);
  const entries = readdirSync(root, { withFileTypes: true });

  return entries.flatMap((entry) => {
    if (skipped.has(entry.name)) {
      return [];
    }

    const path = join(root, entry.name);

    if (entry.isDirectory()) {
      return filesUnder(path);
    }

    return /\.(md|ts|json|ya?ml|mjs|js)$/.test(entry.name) ? [path] : [];
  });
}
