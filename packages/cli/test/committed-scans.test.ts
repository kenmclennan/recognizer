import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  readScanFile,
  readUncheckedScanFile,
  scanDocumentOf,
  scanFileText,
} from "../src/adapters/filesystem/scan-translator.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function committed(pattern: string): string[] {
  return execFileSync("git", ["ls-files", pattern], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter((path) => path.endsWith(".json"));
}

describe("a Repository built from committed scans", () => {
  it("every committed scan document reads", () => {
    const valid = [
      ...committed("schema/examples"),
      ...committed("fixtures"),
    ].filter(
      (path) =>
        !path.includes("/invalid/") &&
        (path.startsWith("schema/examples/") ||
          path.endsWith("expected-scan.json")),
    );

    expect(valid.length).toBeGreaterThan(0);

    const refused = valid.flatMap((path) => {
      try {
        readScanFile(JSON.parse(readFileSync(join(root, path), "utf8")));

        return [];
      } catch (error) {
        return [`${path}: ${(error as Error).message}`];
      }
    });

    expect(refused).toEqual([]);
  });

  it("every committed scan document round-trips through the entity", () => {
    const valid = [
      ...committed("schema/examples"),
      ...committed("fixtures"),
    ].filter(
      (path) =>
        !path.includes("/invalid/") &&
        (path.startsWith("schema/examples/") ||
          path.endsWith("expected-scan.json")),
    );

    expect(valid.length).toBeGreaterThan(0);

    const empties = { calls: 0, unresolved_imports: 0, test_imports: 0 };
    const keys = (value: unknown) => Object.keys(value as object);

    for (const path of valid) {
      const document = JSON.parse(readFileSync(join(root, path), "utf8"));
      const repository = readScanFile(document);
      const written = scanDocumentOf(repository) as unknown as Record<
        string,
        unknown
      >;

      for (const key of Object.keys(empties) as (keyof typeof empties)[]) {
        if (Array.isArray(document[key]) && document[key].length === 0) {
          empties[key] += 1;
        }
      }

      expect(JSON.parse(JSON.stringify(written)), path).toEqual(document);
      expect(keys(written), path).toEqual(keys(document));
      expect(keys(written.scanner), path).toEqual(keys(document.scanner));
      expect(keys(written.selection), path).toEqual(keys(document.selection));

      for (const section of [
        "files",
        "modules",
        "edges",
        "calls",
        "foreign",
      ] as const) {
        const entries = (written[section] ?? []) as unknown[];

        expect(entries.map(keys), `${path} ${section}`).toEqual(
          (document[section] ?? []).map(keys),
        );
      }

      const text = scanFileText(repository);

      expect(text.endsWith("\n") && !text.endsWith("\n\n"), path).toBe(true);
      expect(`${JSON.stringify(JSON.parse(text), null, 2)}\n`, path).toBe(text);
    }

    expect(empties.calls).toBeGreaterThanOrEqual(3);
    expect(empties.unresolved_imports).toBeGreaterThanOrEqual(2);
    expect(empties.test_imports).toBeGreaterThanOrEqual(1);
  });

  it("reads an unchecked scan through the same entities", () => {
    const [path] = committed("fixtures").filter((one) =>
      one.endsWith("expected-scan.json"),
    );

    expect(path).toBeDefined();

    const repository = readUncheckedScanFile(
      JSON.parse(readFileSync(join(root, path as string), "utf8")),
    );

    expect(repository.files.length).toBeGreaterThan(0);
  });
});
