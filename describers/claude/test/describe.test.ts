import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../scripts/pool-scale.mjs";
import { promptVersion, versionOf } from "../src/prompt.js";
import {
  claudeRan,
  interrupt,
  PROMPT_FILE,
  REPO,
  REQUEST,
  recorded,
  run,
  sandbox,
  writeRequest,
} from "./helpers.js";

const MODEL = ["--model", "opus"];

describe("prompt reaches claude", () => {
  it("sends the prompt, outline and source on stdin with the configured model", () => {
    const box = sandbox();
    const result = run(box, [...MODEL, writeRequest(box, REQUEST)]);
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
      "--model",
      "opus",
      "--tools",
      "",
      "--no-session-persistence",
      "--output-format",
      "json",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--disable-slash-commands",
      "--system-prompt",
      "You describe code modules.",
    ]);
    expect(recorded(box, "cwd")).not.toBe(box.directory);
  });
});

describe("one line, trimmed", () => {
  it("prints the trimmed reply and a newline", () => {
    const box = sandbox();
    const result = run(box, [...MODEL, writeRequest(box, REQUEST)], {
      FAKE_CLAUDE_MODE: "padded",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("Handles orders.\n");
  });
});

describe("failure prints nothing", () => {
  const modes = ["fail", "empty", "blank", "two", "plain", "notfound"];

  it.each(modes)("exits 1 with empty stdout for %s", (mode) => {
    const box = sandbox();
    const result = run(box, [...MODEL, writeRequest(box, REQUEST)], {
      FAKE_CLAUDE_MODE: mode,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toBe("");
  });

  it("carries claude's stderr in the reason", () => {
    const box = sandbox();
    const result = run(box, [...MODEL, writeRequest(box, REQUEST)], {
      FAKE_CLAUDE_MODE: "fail",
    });

    expect(result.stderr).toContain("claude exploded");
  });

  it("exits 1 when no claude is on PATH", () => {
    const box = sandbox();
    const result = run(box, [...MODEL, writeRequest(box, REQUEST)], {}, [
      dirname(process.execPath),
    ]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toBe("");
  });
});

describe("the usage limit", () => {
  const limits = ["limit", "limit-text"];

  it.each(limits)("exits 75 with the limit line for %s", (mode) => {
    const box = sandbox();
    const result = run(box, [...MODEL, writeRequest(box, REQUEST)], {
      FAKE_CLAUDE_MODE: mode,
    });

    expect(result.status).toBe(75);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^claude usage limit: .+\n$/);
  });

  it("does not treat a 404 error as a limit", () => {
    const box = sandbox();
    const result = run(box, [...MODEL, writeRequest(box, REQUEST)], {
      FAKE_CLAUDE_MODE: "notfound",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("model not found");
    expect(result.stderr).not.toContain("usage limit");
  });
});

describe("a signal sent to the describer alone", () => {
  const signals: [NodeJS.Signals, number][] = [
    ["SIGTERM", 143],
    ["SIGINT", 130],
  ];

  it.each(signals)(
    "%s ends the claude child and exits %i",
    async (signal, code) => {
      const box = sandbox();
      const result = await interrupt(box, signal, scaledTimeout(5000));

      expect(result.status).toBe(code);
    },
    scaledTimeout(10_000),
  );
});

describe("usage errors", () => {
  const cases: [string, (file: string) => string[], unknown][] = [
    ["no argument", () => [], REQUEST],
    ["no model", (file) => [file], REQUEST],
    ["an empty model", (file) => ["--model", "", file], REQUEST],
    ["a model with no file", () => ["--model", "opus"], REQUEST],
    ["two files", (file) => [...MODEL, file, file], REQUEST],
    ["a missing file", (file) => [...MODEL, `${file}.missing`], REQUEST],
    ["invalid JSON", (file) => [...MODEL, file], "{not json"],
    [
      "a request without source",
      (file) => [...MODEL, file],
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

  it("prints its package version without running claude", () => {
    const box = sandbox();
    const result = run(box, ["--version"]);
    const { version } = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${version}\n`);
    expect(claudeRan(box)).toBe(false);
  });

  it("accepts --model with --check and exits 0 without running claude", () => {
    const box = sandbox();
    const result = run(box, ["--model", "sonnet", "--check"]);

    expect(result.status).toBe(0);
    expect(claudeRan(box)).toBe(false);
  });

  it("rejects --check without a model", () => {
    const box = sandbox();
    const result = run(box, ["--check"]);

    expect(result.status).toBe(2);
    expect(claudeRan(box)).toBe(false);
  });

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
