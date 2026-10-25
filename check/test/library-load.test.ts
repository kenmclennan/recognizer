import { spawnSync } from "node:child_process";
import { join } from "node:path";
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
});
