import { describe, expect, it } from "vitest";
import type { Io } from "../src/cli.js";
import type { FindingsDocument } from "../src/findings-document.js";
import {
  findingsFile,
  readFindingsFiles,
  withoutAbsentModules,
} from "../src/findings-files.js";
import type { Scan } from "../src/scan.js";

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

function statusOf(
  value: FindingsDocument,
  state: { commit: string | null; modified: boolean },
  allowed: string[] | null = null,
): string | undefined {
  return readFindingsFiles(ioHolding(value), ROOT, state, [], allowed)[0]
    ?.status;
}

function scanOf(...ids: string[]): Scan {
  return {
    modules: ids.map((id) => ({ id, kind: "module" as const })),
    edges: [],
    foreign: [],
  };
}

describe("readFindingsFiles against the current scan state", () => {
  it("marks a dirty-run document stale once the tree is clean at the same commit", () => {
    expect(
      statusOf(document({ modified: true }), {
        commit: "abc",
        modified: false,
      }),
    ).toBe("stale");
  });

  it("reads a dirty-run document while the tree is still modified", () => {
    expect(
      statusOf(document({ modified: true }), { commit: "abc", modified: true }),
    ).toBe("read");
  });

  it("reads a clean-run document at the current commit whatever the tree state", () => {
    expect(statusOf(document(), { commit: "abc", modified: false })).toBe(
      "read",
    );
    expect(statusOf(document(), { commit: "abc", modified: true })).toBe(
      "read",
    );
  });

  it("reads a reported document at the current commit even when it was recorded dirty", () => {
    expect(
      statusOf(
        document({ modified: true, reported_at: "2026-11-04T00:00:00Z" }),
        { commit: "abc", modified: false },
        [],
      ),
    ).toBe("read");
  });

  it("marks a document at another commit stale", () => {
    expect(statusOf(document(), { commit: "def", modified: false })).toBe(
      "stale",
    );
  });
});

describe("withoutAbsentModules", () => {
  const mixed = document({
    modified: true,
    findings: [
      finding("present", ["pkg/a.py", "pkg/b.py"]),
      finding("absent", ["pkg/a.py", "pkg/d.py"]),
    ],
  });

  it("drops the finding naming a module the scans lack and counts it", () => {
    const result = withoutAbsentModules(mixed, [
      scanOf("pkg/a.py", "pkg/b.py"),
    ]);

    expect(result.document.findings.map((f) => f.id)).toEqual(["present"]);
    expect(result.dropped).toBe(1);
  });

  it("keeps every finding when all modules are present", () => {
    const result = withoutAbsentModules(mixed, [
      scanOf("pkg/a.py", "pkg/b.py"),
      scanOf("pkg/d.py"),
    ]);

    expect(result.document.findings).toHaveLength(2);
    expect(result.dropped).toBe(0);
  });

  it("returns a clean-run document unchanged", () => {
    const clean = document({ findings: mixed.findings });

    expect(withoutAbsentModules(clean, [scanOf("pkg/a.py")])).toEqual({
      document: clean,
      dropped: 0,
    });
  });

  it("returns a reported document unchanged", () => {
    const reported = document({
      modified: true,
      reported_at: "2026-11-04T00:00:00Z",
      findings: mixed.findings,
    });

    expect(withoutAbsentModules(reported, [scanOf("pkg/a.py")])).toEqual({
      document: reported,
      dropped: 0,
    });
  });
});
