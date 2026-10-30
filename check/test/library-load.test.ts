import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";

const DIST = join(REPO, "check/dist");
const FIXTURE = join(REPO, "fixtures/check");

function noEval(script: string) {
  return spawnSync(
    process.execPath,
    [
      "--disallow-code-generation-from-strings",
      "--input-type=module",
      "-e",
      script,
    ],
    { encoding: "utf8" },
  );
}

describe("library load without code generation", () => {
  it("imports the index and exports the viewer's functions", () => {
    const result = noEval(
      `import(${JSON.stringify(join(DIST, "index.js"))}).then((m) => console.log(Object.keys(m).join(",")))`,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("collectViolations");
    expect(result.stdout).toContain("SCAN_SCHEMA_VERSION");
    expect(result.stdout).toContain("usesOf");
    expect(result.stdout).toContain("shortestPath");
    expect(result.stdout).toContain("buildCallerIndex");
    expect(result.stdout).toContain("validateView");
    expect(result.stdout).toContain("resolveView");
    expect(result.stdout).toContain("validateResponsibilities");
    expect(result.stdout).toContain("lineStatus");
    expect(result.stdout).toContain("findingsByModule");
    expect(result.stdout).not.toContain("freshScans");
  });

  it("reaches no node: module from the index", () => {
    const seen = new Set<string>();
    const specifiers: string[] = [];

    function walk(file: string): void {
      if (seen.has(file)) {
        return;
      }

      seen.add(file);

      const source = readFileSync(file, "utf8");

      for (const match of source.matchAll(
        /(?:from|import)\s*["']([^"']+)["']/g,
      )) {
        const specifier = match[1] as string;

        specifiers.push(specifier);

        if (specifier.startsWith(".") && specifier.endsWith(".js")) {
          walk(join(dirname(file), specifier));
        }
      }
    }

    walk(join(DIST, "index.js"));

    expect(seen.size).toBeGreaterThan(5);
    expect(
      specifiers.filter((specifier) => specifier.startsWith("node:")),
    ).toEqual([]);
  });

  it("runs policy, analysis and rules directly on the check fixture", () => {
    const script = `
      import { readFileSync } from "node:fs";
      const policy = await import(${JSON.stringify(join(DIST, "policy.js"))});
      const analyse = await import(${JSON.stringify(join(DIST, "analyse.js"))});
      const rules = await import(${JSON.stringify(join(DIST, "rules.js"))});
      const scan = JSON.parse(readFileSync(${JSON.stringify(join(FIXTURE, "scan.json"))}, "utf8"));
      const parsed = policy.parsePolicy(readFileSync(${JSON.stringify(join(FIXTURE, ".recognizer/policy.yaml"))}, "utf8"));
      const found = rules.collectViolations(scan, parsed);
      const analysis = analyse.analyse(scan, { hub: 10 }, parsed.ignore);
      console.log(JSON.stringify({ violations: found.violations.length, warnings: analysis.warnings.length }));
    `;
    const result = noEval(script);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ violations: 5, warnings: 1 });
  });

  it("validates a saved view with code generation from strings disabled", () => {
    const script = `
      const { validateView } = await import(${JSON.stringify(join(DIST, "index.js"))});
      const valid = validateView({ schema_version: 1, description: "d", commit: null, steps: [{ kind: "pick", module: "a" }] });
      let reason = null;
      try {
        validateView({ schema_version: 1, description: "", commit: null, steps: [] });
      } catch (error) {
        reason = error.messages.join("; ");
      }
      console.log(JSON.stringify({ description: valid.description, reason }));
    `;
    const result = noEval(script);

    expect(result.status).toBe(0);

    const answer = JSON.parse(result.stdout);

    expect(answer.description).toBe("d");
    expect(answer.reason).toContain("description");
  });
});
