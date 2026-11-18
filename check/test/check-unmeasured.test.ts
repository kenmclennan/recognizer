import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { DEFAULT_DUPLICATION_SETTINGS } from "../src/duplication/findings.js";
import { loadFindings } from "../src/load-findings.js";
import type { Scan } from "../src/scan.js";
import { STRUCTURE_SENSOR_VERSION } from "../src/structure-sensor.js";
import { REPO } from "./helpers.js";
import {
  fakeIo,
  hashedScan,
  mountedModules,
  PYTHON,
  ROOT,
} from "./scan-helpers.js";

const COMMIT = "abc123";
const STRUCTURE = `${ROOT}/.recognizer/cache/findings/structure.json`;
const checkScan = JSON.parse(
  readFileSync(join(REPO, "fixtures/check/scan.json"), "utf8"),
);
const policy = readFileSync(
  join(REPO, "fixtures/check/.recognizer/policy.yaml"),
  "utf8",
);

function duplicate(id: string) {
  return {
    id,
    kind: "duplication",
    severity: "warning",
    principle: "dont-repeat-yourself",
    fix_pattern: "extract-shared-function",
    summary: id,
    evidence: {
      modules: ["shop/domain/order.py"],
      members: [1, 2].map((index) => ({
        module: "shop/domain/order.py",
        name: `m${index}`,
        file: "shop/domain/order.py",
        lines: [1, 6] as [number, number],
      })),
    },
  };
}

function baseFiles(extra: Record<string, string> = {}) {
  return {
    [`${ROOT}/shop/a.py`]: "",
    ...mountedModules(checkScan),
    [`${ROOT}/.recognizer/cache/scan.python.json`]: JSON.stringify(
      hashedScan(checkScan, COMMIT),
    ),
    [`${ROOT}/.recognizer/policy.yaml`]: policy,
    ...extra,
  };
}

function seeded(
  options: {
    version?: string;
    duplication?: boolean;
    complexity?: boolean;
    findings?: ReturnType<typeof duplicate>[];
  } = {},
) {
  const probe = fakeIo({ commit: COMMIT, files: baseFiles() });

  run(["check", "--json", "--repository", ROOT], probe.io);

  const document = JSON.parse(probe.files.get(STRUCTURE) as string);

  document.sensor.version = options.version ?? STRUCTURE_SENSOR_VERSION;

  if (options.duplication ?? true) {
    document.settings.duplication = { ...DEFAULT_DUPLICATION_SETTINGS };
  }

  if (options.complexity ?? true) {
    document.settings.complexity_limit = 10;
  }

  document.findings = [...document.findings, ...(options.findings ?? [])];

  return fakeIo({
    commit: COMMIT,
    files: baseFiles({ [STRUCTURE]: JSON.stringify(document) }),
    scanners: {
      [PYTHON]: { output: JSON.stringify(hashedScan(checkScan, COMMIT)) },
    },
  });
}

function check(fake: ReturnType<typeof fakeIo>, ...argv: string[]) {
  const code = run(["check", ...argv, "--repository", ROOT], fake.io);

  return { code, out: fake.out(), err: fake.err() };
}

function structureStatus(out: string) {
  return JSON.parse(out).sensors.find(
    (one: { name: string }) => one.name === "structure",
  );
}

describe("check never reports unmeasured parts as measured", () => {
  it("reports partial when a stored document of another version held zero duplication", () => {
    const fake = seeded({ version: "20", complexity: true });
    const { out, err } = check(fake, "--json");

    expect(structureStatus(out).status).toBe("partial");
    expect(structureStatus(out).not_measured).toContain("duplication");
    expect(err).toContain("duplication not measured since the last scan");
  });

  it("stays ran for a measured zero at the current version", () => {
    const fake = seeded();
    const { out, err } = check(fake, "--json");

    expect(structureStatus(out).status).toBe("ran");
    expect(structureStatus(out)).not.toHaveProperty("not_measured");
    expect(structureStatus(out).settings.duplication).toBeDefined();
    expect(err).toBe("");
  });

  it("drops duplication findings stored by another version", () => {
    const fake = seeded({
      version: "20",
      findings: [duplicate("duplication:x"), duplicate("duplication:y")],
    });
    const { out } = check(fake, "--json");

    expect(structureStatus(out).status).toBe("partial");
    expect(out).not.toContain("duplication:x");
    expect(out).not.toContain("duplication:y");
  });

  it("keeps duplication findings stored by the current version", () => {
    const fake = seeded({
      findings: [duplicate("duplication:x"), duplicate("duplication:y")],
    });
    const { out } = check(fake, "--json");

    expect(structureStatus(out).status).toBe("ran");
    expect(out).toContain("duplication:x");
    expect(out).toContain("duplication:y");
  });

  it("reports exactly the unmeasured parts", () => {
    const onlyComplexity = check(seeded({ complexity: false }), "--json").out;
    const both = check(
      seeded({ duplication: false, complexity: false }),
      "--json",
    ).out;

    expect(structureStatus(onlyComplexity).not_measured).toEqual([
      "complexity",
    ]);
    expect(structureStatus(both).not_measured).toEqual([
      "duplication",
      "complexity",
    ]);
  });

  it("text line names unmeasured parts", () => {
    const { out } = check(seeded({ duplication: false }));

    expect(out).toMatch(
      /^sensor structure: .* \(not measured: duplication\)$/m,
    );
  });

  it("partial does not change the exit code", () => {
    const measured = check(seeded(), "--json");
    const partial = check(seeded({ version: "20" }), "--json");

    expect(structureStatus(partial.out).status).toBe("partial");
    expect(partial.code).toBe(measured.code);
  });

  it("failed structure phase then check", async () => {
    const stale = seeded({
      version: "20",
      findings: [duplicate("duplication:x")],
    });
    const broken = `${ROOT}/.recognizer/policy.yaml`;
    const good = stale.files.get(broken) as string;

    stale.files.set(broken, "components: {}\n");

    const scanCode = await run(["scan", ROOT], stale.io);

    expect(scanCode).toBe(1);

    stale.files.set(broken, good);

    const result = check(stale, "--json");
    const output = result.out;
    const out = output.slice(output.indexOf("{\n"));

    expect(structureStatus(out).status).toBe("partial");
    expect(structureStatus(out).not_measured).toContain("duplication");
    expect(out).not.toContain("duplication:x");
  });

  it("load path rejects another version", () => {
    const fake = seeded({
      version: "20",
      findings: [duplicate("duplication:x")],
    });
    const scans = [hashedScan(checkScan, COMMIT)] as unknown as Scan[];
    const documents = loadFindings(fake.io, ROOT, scans);
    const rewritten = JSON.parse(fake.files.get(STRUCTURE) as string);

    expect(documents[0].sensor.version).toBe(STRUCTURE_SENSOR_VERSION);
    expect(
      documents[0].findings.some((one) => one.id === "duplication:x"),
    ).toBe(false);
    expect(rewritten.sensor.version).toBe(STRUCTURE_SENSOR_VERSION);
    expect(
      rewritten.findings.some(
        (one: { id: string }) => one.id === "duplication:x",
      ),
    ).toBe(false);
  });
});
