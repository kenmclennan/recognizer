import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "../../app");

function appSources(): string[] {
  return execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "src/**/*.ts",
      "src/*.ts",
    ],
    { cwd: app, encoding: "utf8" },
  )
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => resolve(app, line))
    .filter((file) => existsSync(file));
}

function linesMatching(files: string[], pattern: RegExp): string[] {
  return files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => pattern.test(line))
      .map((line) => `${file}: ${line.trim()}`),
  );
}

const SCAN_STREAM_PARSERS = /\b(parseScanLine|foldProgress|foldRunEvent)\b/;

const SCAN_STREAM_EVENTS =
  /event\s*(===|!==|:)\s*"(phase|entry|plugin|confirm|answered|stopped|preflight|structure|summary|projection)"/;

describe("the app holds no scan-stream parser", () => {
  const sources = appSources();

  it("lists the app's source files", () => {
    expect(sources.length).toBeGreaterThan(50);
    expect(sources.some((file) => file.endsWith("rescanner.ts"))).toBe(true);
  });

  it("names no scan-stream parser or fold in any app source", () => {
    expect(linesMatching(sources, SCAN_STREAM_PARSERS)).toEqual([]);
  });

  it("tests no scan-stream event name in any app source", () => {
    expect(linesMatching(sources, SCAN_STREAM_EVENTS)).toEqual([]);
  });

  it("parses no JSON in the progress modules", () => {
    const progress = sources.filter(
      (file) =>
        file.endsWith("/scan-progress.ts") ||
        file.endsWith("/setup-progress.ts"),
    );

    expect(progress).toHaveLength(2);
    expect(linesMatching(progress, /JSON\.parse/)).toEqual([]);
  });

  it("catches a parser and a stream event name when they are written", () => {
    expect(SCAN_STREAM_PARSERS.test("const e = parseScanLine(text);")).toBe(
      true,
    );
    expect(SCAN_STREAM_EVENTS.test('if (event.event === "summary") {')).toBe(
      true,
    );
    expect(SCAN_STREAM_EVENTS.test('{ event: "start", total: 3 }')).toBe(false);
  });
});
