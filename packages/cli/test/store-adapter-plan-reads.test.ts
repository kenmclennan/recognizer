import { describe, expect, it } from "vitest";
import { StoreAdapter } from "../src/adapters/filesystem/store-adapter.js";
import { fakeIo, ROOT, scanJson } from "./scan-helpers.js";

const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const D = "d".repeat(64);

function seeded() {
  const python = scanJson(2, 0, {
    files: [
      { path: "m0.py", hash: H1 },
      { path: "m1.py", hash: H2 },
    ],
  });
  const kotlin = scanJson(1, 0, {
    modules: [{ id: "B.kt", language: "kotlin", kind: "module", members: [] }],
    files: [{ path: "B.kt", hash: H1 }],
  });
  const findings = {
    findings_version: 1,
    sensor: { name: "crap", version: "1" },
    commit: "abc",
    modified: false,
    settings: {},
    findings: [],
    inputs: { "m0.py": H1 },
    tests: D,
  };
  const responsibilities = {
    schema_version: 1,
    modules: {
      "m0.py": {
        line: "Does the first thing.",
        source_hash: H1,
        describer: ["describe"],
        version: "v1",
      },
      "m1.py": {
        line: "Does the second thing.",
        source_hash: "0".repeat(64),
        describer: ["describe"],
        version: "v1",
      },
    },
  };

  return fakeIo({
    files: {
      [`${ROOT}/.recognizer/cache/scan.python.json`]: python,
      [`${ROOT}/.recognizer/cache/scan.kotlin.json`]: kotlin,
      [`${ROOT}/.recognizer/cache/findings/crap.json`]:
        JSON.stringify(findings),
      [`${ROOT}/.recognizer/responsibilities.json`]:
        JSON.stringify(responsibilities),
      [`${ROOT}/.recognizer/config.yaml`]:
        "describer:\n  command: [describe]\n  version: v1\n",
    },
  });
}

describe("the store adapter plan reads", () => {
  it("the_adapter_reads_the_cached_scans_measured_inputs_and_lines", () => {
    const store = new StoreAdapter(seeded().io, "all");

    const cached = store.cachedRepository(ROOT);

    expect(
      cached.extractions.map((extraction) =>
        cached.files
          .filter((file) => file.language === extraction.language)
          .map(({ path }) => path),
      ),
    ).toEqual([["B.kt"], ["m0.py", "m1.py"]]);
    expect(store.cachedRepository("/nowhere").files).toEqual([]);
    expect(store.measuredOf(ROOT, "crap")).toEqual({
      inputs: { "m0.py": H1 },
      tests: D,
    });
    expect(store.measuredOf(ROOT, "mutation")).toBeNull();
    expect(store.testsDigest(ROOT)).toBe(D);
    expect(store.responsibilityKinds(ROOT)).toEqual({
      registered: true,
      kinds: { "B.kt": "missing", "m0.py": "current", "m1.py": "out-of-date" },
    });
  });

  it("reads no lines when no describer is registered", () => {
    const store = new StoreAdapter(fakeIo().io, "all");

    expect(store.responsibilityKinds(ROOT)).toEqual({
      registered: false,
      kinds: {},
    });
  });
});
