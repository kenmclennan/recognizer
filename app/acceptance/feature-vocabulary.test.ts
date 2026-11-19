import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const SRC = here("../src");
const FORBIDDEN_STRINGS = ["src/", ".ts", "data-testid", "invoke"];

function sourceFiles(): string[] {
  return readdirSync(SRC).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
  );
}

function exportedNames(): string[] {
  const names = new Set<string>();

  for (const file of sourceFiles()) {
    names.add(file.replace(/\.ts$/, ""));

    const text = readFileSync(`${SRC}/${file}`, "utf8");

    for (const match of text.matchAll(
      /export (?:async )?(?:function|const|type|class|interface|enum) ([A-Za-z_$][\w$]*)/g,
    )) {
      names.add(match[1] as string);
    }
  }

  return [...names];
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function vocabularyHits(feature: string, names: string[]): string[] {
  const hits = names.filter((name) =>
    new RegExp(`(?<![\\w-])${escaped(name)}(?![\\w-])`).test(feature),
  );

  return [
    ...hits,
    ...FORBIDDEN_STRINGS.filter((text) => feature.includes(text)),
  ];
}

function importsOf(path: string): string[] {
  return [...readFileSync(path, "utf8").matchAll(/from "([^"]+)"/g)].map(
    (match) => match[1] as string,
  );
}

function acceptanceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;

    return entry.isDirectory() ? acceptanceFiles(path) : [path];
  });
}

describe("scan panel feature vocabulary", () => {
  it("the scan panel feature holds no identifier from app/src", () => {
    const feature = readFileSync(
      here("./scan-panel/scan-panel.feature"),
      "utf8",
    );

    expect(vocabularyHits(feature, exportedNames())).toEqual([]);
  });

  it("the check reports an identifier from app/src", () => {
    expect(
      vocabularyHits("Given onlyArmed is applied", exportedNames()),
    ).toContain("onlyArmed");
  });

  it("only the driver imports from app/src", () => {
    const offenders = acceptanceFiles(here("."))
      .filter(
        (path) =>
          path.endsWith(".ts") &&
          !path.endsWith(".test.ts") &&
          !path.endsWith("/driver/front-end-driver.ts"),
      )
      .filter((path) =>
        importsOf(path).some(
          (from) => from.includes("../src") || from.includes("/src/"),
        ),
      );

    expect(offenders).toEqual([]);
  });
});
