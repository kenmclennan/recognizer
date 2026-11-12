import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { REPO } from "./helpers.js";
import {
  fakeIo,
  hashedScan,
  mountedModules,
  PYTHON,
  ROOT,
  scanJson,
} from "./scan-helpers.js";

const COMMIT = "abc123";
const checkScan = JSON.parse(
  readFileSync(join(REPO, "fixtures/check/scan.json"), "utf8"),
);
const STALE = "components:\n  domain: shop/domain/**\n  ports: nowhere/**\n";
const COVERING = "components:\n  all:\n    - shop/**\n    - tests/**\n";
const POLICY = `${ROOT}/.recognizer/policy.yaml`;

function problemLines(err: string): string[] {
  return err.split("\n").filter((line) => line.startsWith("warning: "));
}

describe("policy problems on check --scan", () => {
  function checkScan_(policy: string) {
    const fake = fakeIo({
      files: {
        "x.json": JSON.stringify(checkScan),
        "p.yaml": policy,
        "baselines/violations.json": JSON.stringify({
          schema_version: 1,
          violations: [],
        }),
      },
    });
    const code = run(
      ["check", "--scan", "x.json", "--policy", "p.yaml"],
      fake.io,
    );

    return { code, out: fake.out(), err: fake.err() };
  }

  it("prints the stale entry and the uncovered folder on stderr and keeps the exit code", () => {
    const stale = checkScan_(STALE);
    const covered = checkScan_(COVERING);
    const lines = problemLines(stale.err);

    expect(lines).toContain(
      "warning: p.yaml: policy entry nowhere/** (component ports) matches no scanned module",
    );
    expect(
      lines.some((line) => line.startsWith("warning: p.yaml: folder ")),
    ).toBe(true);
    expect(stale.code).toBe(covered.code);
    expect(problemLines(covered.err)).toEqual([]);
  });

  it("keeps policy problems out of stdout and out of the warnings count", () => {
    const stale = checkScan_(STALE);
    const covered = checkScan_(COVERING);
    const warnings = (out: string) => JSON.parse(out).warnings;
    const count = (err: string) => err.match(/^warnings: (\d+)$/m)?.[1];

    expect(JSON.stringify(warnings(stale.out))).not.toContain("policy_drift");
    expect(warnings(stale.out)).toEqual(warnings(covered.out));
    expect(count(stale.err)).toBe(count(covered.err));
  });
});

describe("policy problems on check in repository mode", () => {
  function repository(policy: string) {
    const fake = fakeIo({
      commit: COMMIT,
      files: {
        [`${ROOT}/shop/a.py`]: "",
        ...mountedModules(checkScan),
        [`${ROOT}/.recognizer/cache/scan.python.json`]: JSON.stringify(
          hashedScan(checkScan, COMMIT),
        ),
        [POLICY]: policy,
      },
    });
    const code = run(["check", "--json", "--repository", ROOT], fake.io);

    return { code, out: fake.out(), err: fake.err() };
  }

  it("prints both policy problems naming the policy file, with the exit code of a covering policy", () => {
    const stale = repository(STALE);
    const covered = repository(COVERING);
    const lines = problemLines(stale.err);

    expect(lines).toContain(
      `warning: ${POLICY}: policy entry nowhere/** (component ports) matches no scanned module`,
    );
    expect(
      lines.some((line) => line.startsWith(`warning: ${POLICY}: folder `)),
    ).toBe(true);
    expect(stale.code).toBe(covered.code);
    expect(problemLines(covered.err)).toEqual([]);
    expect(JSON.stringify(JSON.parse(stale.out).warnings)).not.toContain(
      "policy_drift",
    );
  });
});

describe("policy problems on scan", () => {
  async function scan(policy: string) {
    const fake = fakeIo({
      files: { [`${ROOT}/a.py`]: "", [POLICY]: policy },
      scanners: { [PYTHON]: { output: scanJson(2, 1) } },
    });
    const code = await run(["scan", ROOT], fake.io);

    return { code, err: fake.err() };
  }

  it("prints both policy problems and keeps the exit code of a covering policy", async () => {
    const stale = await scan("components:\n  one: gone/**\n");
    const covered = await scan('components:\n  all: "**"\n');
    const lines = problemLines(stale.err);

    expect(lines).toContain(
      "warning: .recognizer/policy.yaml: policy entry gone/** (component one) matches no scanned module",
    );
    expect(
      lines.some((line) =>
        line.startsWith("warning: .recognizer/policy.yaml: folder "),
      ),
    ).toBe(true);
    expect(stale.code).toBe(covered.code);
    expect(problemLines(covered.err)).toEqual([]);
  });
});
