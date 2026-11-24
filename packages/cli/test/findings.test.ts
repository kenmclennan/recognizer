import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "@recognizer/core";
import {
  findingsByModuleFrom,
  linesDuplicated,
  orderDuplication,
  senseStructure as structureSensor,
} from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { findingsFile } from "../src/findings-files.js";
import { parsePolicy } from "../src/index.js";
import { loadFindings } from "../src/load-findings.js";
import { REPO } from "./helpers.js";
import { BEHAVIOUR } from "./language-behaviour-fixture.js";
import {
  repositoryFrom,
  validatedRepository as validateScan,
} from "./repository-from.js";
import { fakeIo, hashedScan, ROOT, TYPESCRIPT } from "./scan-helpers.js";

function fixture(name: string) {
  const dir = join(REPO, "fixtures", name);

  return {
    scan: validateScan(
      JSON.parse(readFileSync(join(dir, "scan.json"), "utf8")),
    ),
    policy: parsePolicy(
      readFileSync(join(dir, ".recognizer/policy.yaml"), "utf8"),
    ),
  };
}

function findingsByModule(
  scans: ReturnType<typeof validateScan>,
  policy: ReturnType<typeof parsePolicy> | null,
) {
  const { document } = structureSensor(
    scans,
    policy,
    {
      entry_points: [],
      entry_annotations: [],
      warnings: {
        cycle: true,
        orphan: true,
        unused_exports: false,
        private_imports: true,
        long_function: true,
      },
    },
    { commit: "abc", modified: false },
    BEHAVIOUR,
  );

  return findingsByModuleFrom([document]);
}

describe("findingsByModuleFrom principle text", () => {
  const record = (id: string, principle: string): Finding => ({
    id,
    kind: "orphan",
    severity: "warning",
    principle,
    summary: id,
    files: ["a.py"],
  });

  it("names a registered principle and keeps an unregistered one as written", () => {
    const found = findingsByModuleFrom([
      {
        sensor: { name: "structure", version: "18" },
        commit: "c",
        modified: false,
        settings: {},
        findings: [record("one", "dead-code"), record("two", "old-principle")],
      },
    ]);

    expect(found.get("a.py")?.map((finding) => finding.why)).toEqual([
      "Dead code",
      "old-principle",
    ]);
  });
});

describe("findingsByModuleFrom over the structure document", () => {
  it("attaches a cycle warning to every module in it", () => {
    const { scan, policy } = fixture("check-warnings");
    const found = findingsByModule(scan, policy);

    expect(found.get("app/domain/money.py")?.map((f) => f.severity)).toEqual([
      "warning",
    ]);
    expect(found.get("app/domain/order.py")?.map((f) => f.why)).toContain(
      "Levelization",
    );
  });

  it("lists a module's violation before its warnings", () => {
    const { scan, policy } = fixture("check-warnings");
    const found = findingsByModule(scan, policy);
    const withBoth = [...found.values()].find(
      (list) =>
        list.some((f) => f.severity === "violation") &&
        list.some((f) => f.severity === "warning"),
    );

    expect(withBoth).toBeDefined();
    expect(withBoth?.[0]?.severity).toBe("violation");
  });

  it("reports only warnings when there is no policy", () => {
    const { scan } = fixture("check-warnings");
    const found = findingsByModule(scan, null);

    expect(
      [...found.values()].flat().every((f) => f.severity === "warning"),
    ).toBe(true);
    expect(found.size).toBeGreaterThan(0);
  });

  it("drops modules the policy ignores", () => {
    const { scan, policy } = fixture("check-warnings");
    const ignoring = parsePolicy(
      `${readFileSync(join(REPO, "fixtures/check-warnings/.recognizer/policy.yaml"), "utf8")}\nignore: [app/domain/**]\n`,
    );

    expect(findingsByModule(scan, policy).has("app/domain/money.py")).toBe(
      true,
    );
    expect(findingsByModule(scan, ignoring).has("app/domain/money.py")).toBe(
      false,
    );
  });
});

describe("linesDuplicated and orderDuplication", () => {
  const rec = (
    id: string,
    kind: string,
    sizes: (number | null)[],
  ): Finding => ({
    id,
    kind,
    severity: "warning",
    principle: "p",
    summary: id,
    files: ["m"],
    members: sizes.map((size, index) => ({
      file: "m",
      name: `n${index}`,
      ...(size === null ? {} : { lines: [1, size] as [number, number] }),
    })),
  });

  it("sums unequal members and counts a member without lines as 0", () => {
    expect(linesDuplicated(rec("a", "duplication", [46, 51, 57]))).toBe(154);
    expect(linesDuplicated(rec("a", "duplication", [10, null]))).toBe(10);
  });

  it("orders duplication records in their own slots and leaves other kinds put", () => {
    const records = [
      rec("unused1", "unused_exports", []),
      rec("d-small", "duplication", [5, 5]),
      rec("cycle1", "cycle", []),
      rec("d-b", "duplication", [8, 8]),
      rec("d-big", "duplication", [20, 20]),
      rec("d-a", "duplication", [8, 8]),
    ];

    expect(orderDuplication(records).map((one) => one.id)).toEqual([
      "unused1",
      "d-big",
      "cycle1",
      "d-a",
      "d-b",
      "d-small",
    ]);
  });
});

describe("loadFindings with a stored structure document", () => {
  const COMMIT = "abc123";
  const scan = JSON.parse(
    readFileSync(join(REPO, "fixtures/check/scan.json"), "utf8"),
  );
  const stored = findingsFile(ROOT, "structure");

  function loaded(files: Map<string, string>, publishesPython: boolean) {
    const fake = fakeIo({
      commit: COMMIT,
      files: Object.fromEntries(files),
      ...(publishesPython ? {} : { scanners: { [TYPESCRIPT]: {} } }),
    });
    const documents = loadFindings(
      fake.io,
      ROOT,
      repositoryFrom(hashedScan(scan, COMMIT)),
    );

    return { fake, document: documents[0] };
  }

  it("recomputes a stored structure document when the unknown files changed", () => {
    const first = loaded(new Map(), false);

    expect(first.document?.unknownFiles?.languages).toEqual(["python"]);
    expect(JSON.parse(first.fake.files.get(stored) as string)).toHaveProperty(
      "unknown_files",
    );

    const second = loaded(first.fake.files, true);

    expect(second.document?.unknownFiles).toBeUndefined();
    expect(
      JSON.parse(second.fake.files.get(stored) as string),
    ).not.toHaveProperty("unknown_files");
  });

  it("reuses one whose unknown files match", () => {
    const first = loaded(new Map(), false);
    const before = first.fake.files.get(stored);
    const second = loaded(first.fake.files, false);

    expect(first.document?.unknownFiles).toBeDefined();
    expect(second.document?.unknownFiles).toEqual(first.document?.unknownFiles);
    expect(second.fake.writes.filter((path) => path === stored)).toEqual([]);
    expect(second.fake.files.get(stored)).toBe(before);
  });
});
