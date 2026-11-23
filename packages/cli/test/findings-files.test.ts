import type { SensorFindings } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import type { FindingsDocument } from "../src/adapters/filesystem/findings-document-types.js";
import type { Io } from "../src/cli.js";
import { findingsFile, readFindingsFiles } from "../src/findings-files.js";
import { buildFreshness } from "../src/result-freshness.js";
import { repositoryFrom } from "./repository-from.js";

const ROOT = "/repo";

function finding(id: string, modules: string[]) {
  return {
    id,
    kind: "duplication",
    severity: "warning" as const,
    principle: "dry",
    summary: id,
    evidence: { modules },
  };
}

function document(overrides: Partial<FindingsDocument> = {}): FindingsDocument {
  return {
    findings_version: 1,
    sensor: { name: "duplication", version: "1" },
    commit: "abc",
    modified: false,
    settings: {},
    findings: [],
    ...overrides,
  };
}

function ioHolding(value: FindingsDocument): Io {
  const file = findingsFile(ROOT, "duplication");

  return {
    readDir: () => [{ name: "duplication.json", kind: "file" }],
    readFile: (path: string) => {
      if (path !== file) {
        throw new Error("missing");
      }

      return JSON.stringify(value);
    },
  } as unknown as Io;
}

const H0 = "0".repeat(64);
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);

const SCAN = repositoryFrom({
  modules: [
    { id: "pkg/a.py", kind: "module" },
    { id: "pkg/b.py", kind: "module" },
  ],
  edges: [],
  foreign: [],
  files: [
    { path: "pkg/a.py", hash: H1 },
    { path: "pkg/b.py", hash: H2 },
  ],
});

function read(
  value: FindingsDocument,
  allowed: string[] | null = null,
  tests: string | null = null,
) {
  return readFindingsFiles(
    ioHolding(value),
    ROOT,
    () => buildFreshness(SCAN, tests),
    [],
    allowed,
  )[0];
}

describe("readFindingsFiles judges per module", () => {
  const mixed = document({
    inputs: { "pkg/a.py": H1, "pkg/b.py": H0 },
    findings: [finding("on-a", ["pkg/a.py"]), finding("on-b", ["pkg/b.py"])],
  });

  it("reads a dirty-run document whose modules are all current", () => {
    const outcome = read(
      document({
        modified: true,
        inputs: { "pkg/a.py": H1 },
        findings: [finding("on-a", ["pkg/a.py"])],
      }),
    );

    expect(outcome).toMatchObject({ status: "read", valid: true, hidden: [] });
  });

  it("reads a document from another commit when every module hash matches", () => {
    const outcome = read(
      document({
        commit: "def",
        inputs: { "pkg/a.py": H1, "pkg/b.py": H2 },
        findings: mixed.findings,
      }),
    );

    expect(outcome).toMatchObject({ status: "read", valid: true, hidden: [] });
    expect(
      outcome?.status === "read" && outcome.document.findings,
    ).toHaveLength(2);
  });

  it("reads a reported document whose modules are current and keeps its reported mark", () => {
    const outcome = read(
      document({
        modified: true,
        reported_at: "2026-11-04T00:00:00Z",
        inputs: { "pkg/a.py": H1 },
        findings: [finding("on-a", ["pkg/a.py"])],
      }),
      [],
    );

    expect(outcome).toMatchObject({ status: "read", reported: true });
  });

  it("marks a document with no inputs stale", () => {
    const outcome = read(document({ findings: mixed.findings }));

    expect(outcome).toMatchObject({ status: "read", valid: false });
    expect(
      outcome?.status === "read" && outcome.document.findings,
    ).toHaveLength(0);
    expect(outcome?.status === "read" && outcome.hidden).toHaveLength(2);
  });

  it("keeps the current findings and lists the hidden ones in a valid document", () => {
    const outcome = read(mixed);

    expect(outcome?.status === "read" && outcome.valid).toBe(true);
    expect(
      outcome?.status === "read" && outcome.document.findings.map((f) => f.id),
    ).toEqual(["on-a"]);
    expect(
      outcome?.status === "read" && outcome.hidden.map((f) => f.id),
    ).toEqual(["on-b"]);
  });

  it("hides a finding naming a module the scans lack", () => {
    const outcome = read(
      document({
        inputs: { "pkg/a.py": H1, "pkg/d.py": H1 },
        findings: [finding("gone", ["pkg/a.py", "pkg/d.py"])],
      }),
    );

    expect(outcome?.status === "read" && outcome.hidden).toHaveLength(1);
  });

  it("hides every finding when tests differ from the current tests hash", () => {
    const value = document({
      inputs: { "pkg/a.py": H1 },
      tests: "a".repeat(64),
      findings: [finding("on-a", ["pkg/a.py"])],
    });

    expect(read(value, null, "a".repeat(64))).toMatchObject({
      valid: true,
      hidden: [],
    });
    expect(read(value, null, "b".repeat(64))).toMatchObject({ valid: false });
    expect(read(value, null, null)).toMatchObject({ valid: false });
  });
});

describe("readFindingsFiles tolerates a stored thresholds.complexity record", () => {
  const record = (kind: string) => ({
    ...finding(`thresholds:${kind}:pkg/a.py::f`, ["pkg/a.py"]),
    kind: `thresholds.${kind}`,
  });

  function readNamed(
    name: string,
    value: FindingsDocument,
    allowed: string[] = ["crap", "mutation"],
  ) {
    const file = findingsFile(ROOT, name);

    return readFindingsFiles(
      {
        readDir: () => [{ name: `${name}.json`, kind: "file" }],
        readFile: (path: string) => {
          if (path !== file) {
            throw new Error("missing");
          }

          return JSON.stringify(value);
        },
      } as unknown as Io,
      ROOT,
      () => buildFreshness(SCAN, null),
      [],
      allowed,
    )[0];
  }

  const held = (kinds: string[], name = "thresholds") =>
    document({
      sensor: { name, version: "1" },
      inputs: { "pkg/a.py": H1 },
      findings: kinds.map(record),
    });

  it("marks a leftover thresholds file with no reported_at as unregistered", () => {
    const outcome = readNamed("thresholds", held([]));

    expect(outcome).toMatchObject({
      name: "thresholds",
      status: "unregistered",
    });
  });

  it("drops the complexity record and keeps the coverage one", () => {
    const outcome = readNamed("thresholds", held(["complexity", "coverage"]));

    expect(outcome).toMatchObject({ status: "unregistered" });
    expect(outcome).not.toHaveProperty("document");
  });

  it("reads a document of only complexity records back with none", () => {
    const outcome = readNamed("thresholds", held(["complexity"]));

    expect(outcome).toMatchObject({ status: "unregistered" });
    expect(outcome).not.toHaveProperty("document");
  });

  it("leaves another sensor's thresholds.complexity-kinded record untouched", () => {
    const outcome = readNamed("other", held(["complexity"], "other"), [
      "other",
    ]);

    expect(
      (outcome as { document: SensorFindings }).document.findings,
    ).toHaveLength(1);
  });
});
