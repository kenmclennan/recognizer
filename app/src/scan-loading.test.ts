import { describe, expect, it } from "vitest";
import { loadScans } from "./scan-loading";
import type { ScanReport } from "./scan-report";

function scanText(ids: string[], overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    schema_version: 4,
    modules: ids.map((id) => ({ id, language: "python", kind: "module" })),
    edges: [],
    foreign: [],
    ...overrides,
  });
}

function scanned(
  scans: { file: string; text: string }[],
  exitCode: 0 | 1 = 0,
  stderr = "",
): ScanReport {
  return { status: "scanned", exitCode, stderr, scans, policy: null };
}

describe("loadScans", () => {
  it("accepts a scan and lists its modules", () => {
    const loaded = loadScans(
      scanned([{ file: "scan.python.json", text: scanText(["a.py", "b.py"]) }]),
    );

    expect(loaded.modules).toEqual(["a.py", "b.py"]);
    expect(loaded.scans.map((scan) => scan.file)).toEqual(["scan.python.json"]);
    expect(loaded.notices).toEqual([]);
    expect(loaded.blocking).toBeNull();
  });

  it("refuses an unknown schema_version with a notice and still loads the others", () => {
    const loaded = loadScans(
      scanned([
        { file: "scan.python.json", text: scanText(["a.py"]) },
        {
          file: "scan.typescript.json",
          text: scanText(["b.ts"], { schema_version: 9 }),
        },
      ]),
    );

    expect(loaded.modules).toEqual(["a.py"]);
    expect(loaded.notices).toEqual([
      "scan.typescript.json has schema_version 9; this viewer reads 4",
    ]);
  });

  it("refuses a version 2 scan, which the previous scanners wrote", () => {
    const loaded = loadScans(
      scanned([
        {
          file: "scan.python.json",
          text: scanText(["a.py"], { schema_version: 2 }),
        },
      ]),
    );

    expect(loaded.modules).toEqual([]);
    expect(loaded.notices).toEqual([
      "scan.python.json has schema_version 2; this viewer reads 4",
    ]);
  });

  it("refuses invalid JSON", () => {
    const loaded = loadScans(
      scanned([{ file: "scan.python.json", text: "{nope" }]),
    );

    expect(loaded.modules).toEqual([]);
    expect(loaded.notices).toHaveLength(1);
    expect(loaded.notices[0]).toContain("scan.python.json is not valid JSON");
  });

  it("refuses a document missing a list", () => {
    for (const missing of ["modules", "edges", "foreign"]) {
      const loaded = loadScans(
        scanned([
          {
            file: "scan.python.json",
            text: scanText(["a.py"], { [missing]: undefined }),
          },
        ]),
      );

      expect(loaded.modules).toEqual([]);
      expect(loaded.notices[0]).toContain(
        "lacks the modules, edges and foreign",
      );
    }
  });

  it("unions disjoint scans and keeps a repeated id once", () => {
    const loaded = loadScans(
      scanned([
        { file: "scan.python.json", text: scanText(["a.py", "shared"]) },
        { file: "scan.typescript.json", text: scanText(["shared", "b.ts"]) },
      ]),
    );

    expect(loaded.modules).toEqual(["a.py", "shared", "b.ts"]);
    expect(loaded.scans).toHaveLength(2);
  });

  it("adds a notice carrying stderr for exit code 1", () => {
    const loaded = loadScans(
      scanned(
        [{ file: "scan.python.json", text: scanText(["a.py"]) }],
        1,
        "typescript: not installed\n",
      ),
    );

    expect(loaded.modules).toEqual(["a.py"]);
    expect(loaded.notices).toEqual([
      "recognizer scan exited 1: typescript: not installed",
    ]);
  });

  it("names exactly the two refused files among three", () => {
    const loaded = loadScans(
      scanned([
        { file: "scan.go.json", text: "garbage" },
        { file: "scan.python.json", text: scanText(["a.py"]) },
        {
          file: "scan.typescript.json",
          text: scanText(["b.ts"], { schema_version: 1 }),
        },
      ]),
    );

    expect(loaded.modules).toEqual(["a.py"]);
    expect(loaded.notices).toHaveLength(2);
    expect(loaded.notices[0]).toContain("scan.go.json");
    expect(loaded.notices[1]).toContain("scan.typescript.json");
  });

  it("turns the three blocking statuses into one message", () => {
    const missing = loadScans({
      status: "command-missing",
      hint: "install it",
    });
    const config = loadScans({ status: "config-invalid", message: "relative" });
    const failed = loadScans({
      status: "scan-failed",
      exitCode: 2,
      stderr: "bad usage\n",
    });

    expect(missing.blocking).toBe("install it");
    expect(config.blocking).toContain("relative");
    expect(failed.blocking).toContain("exit 2");
    expect(failed.blocking).toContain("bad usage");

    for (const loaded of [missing, config, failed]) {
      expect(loaded.modules).toEqual([]);
    }
  });

  it("carries the policy text through", () => {
    const loaded = loadScans({
      status: "scanned",
      exitCode: 0,
      stderr: "",
      scans: [],
      policy: "levels: []",
    });

    expect(loaded.policy).toBe("levels: []");
  });
});
