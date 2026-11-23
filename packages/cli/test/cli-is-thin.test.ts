import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

function relativeImports(file: string): string[] {
  const text = readFileSync(join(source, file), "utf8");

  return [...text.matchAll(/from\s+"(\.[^"]+)"/g)].map(
    (match) => match[1] as string,
  );
}

const PLUMBING = [
  /^\.\/adapters\//,
  /^\.\/cli\.js$/,
  /^\.\/errors\.js$/,
  /^\.\/fresh-ports\.js$/,
  /^\.\/scan-main\.js$/,
  /^\.\/findings-files\.js$/,
  /^\.\/folder-metrics\.js$/,
];

describe("the CLI is a thin adapter over core's analysis", () => {
  it("the analysis modules are gone from the CLI", () => {
    for (const gone of [
      "analyse.ts",
      "check.ts",
      "structure-warnings.ts",
      "structure-run.ts",
      "complexity",
      "duplication",
    ]) {
      expect(existsSync(join(source, gone)), gone).toBe(false);
    }

    const exported = [
      ...readFileSync(join(source, "structure-sensor.ts"), "utf8").matchAll(
        /^export\s+(?:async\s+)?(?:function|const|class|interface|type)\s+(\w+)/gm,
      ),
    ].map((match) => match[1]);

    expect(exported).toEqual(["resolveStructureSettings"]);
  });

  it("check and report import no analysis module", () => {
    for (const file of ["check-command.ts", "report-command.ts"]) {
      const imports = relativeImports(file);

      expect(imports.length, file).toBeGreaterThan(0);
      expect(
        imports.filter((one) => !PLUMBING.some((allowed) => allowed.test(one))),
        file,
      ).toEqual([]);
    }
  });
});
