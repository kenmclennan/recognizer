import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((one) => {
    const path = join(directory, one.name);

    if (one.isDirectory()) {
      return one.name === "generated" || one.name === "node_modules"
        ? []
        : sources(path);
    }

    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("one Diagnosis type", () => {
  it("is defined once, in core's domain", () => {
    const definitions = ["cli", "core", "app"]
      .flatMap((name) => sources(join(REPO, "packages", name, "src")))
      .flatMap((path) =>
        readFileSync(path, "utf8")
          .split("\n")
          .filter((line) =>
            /^export (interface|type) (Diagnosis|SensorDiagnosis)[ <=]/.test(
              line,
            ),
          )
          .map(() => relative(REPO, path)),
      );

    expect(definitions).toStrictEqual([
      "packages/core/src/domain/diagnosis.ts",
    ]);
  });
});
