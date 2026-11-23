import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ENTITIES = [
  "Repository",
  "Folder",
  "File",
  "Member",
  "Dependency",
  "Extraction",
  "View",
  "Neighbours",
  "CallerIndex",
  "ViewNotes",
  "ViewRange",
];
const root = new URL("../../", import.meta.url).pathname;

function sourcesUnder(folder: string): string[] {
  return readdirSync(join(root, folder), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = join(folder, entry.name);

      if (entry.isDirectory()) {
        return sourcesUnder(path);
      }

      return /\.ts$/.test(entry.name) ? [path] : [];
    },
  );
}

function importsFromLibrary(text: string): string[] {
  const found: string[] = [];
  const pattern = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"recognizer"/g;

  for (const match of text.matchAll(pattern)) {
    for (const name of (match[1] ?? "").split(",")) {
      found.push(
        name
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0] ?? "",
      );
    }
  }

  return found;
}

describe("entity types", () => {
  it("come from the core package root, never from the recognizer library", () => {
    const offenders = [...sourcesUnder("src"), ...sourcesUnder("test")].flatMap(
      (file) =>
        importsFromLibrary(readFileSync(join(root, file), "utf8"))
          .filter((name) => ENTITIES.includes(name))
          .map((name) => `${file}: ${name}`),
    );

    expect(offenders).toEqual([]);
  });

  it("are listed as a dependency of the app", () => {
    const manifest = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };

    expect(manifest.dependencies["@recognizer/core"]).toBeDefined();
  });
});
