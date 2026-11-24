import { findDescribeGap } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { FindingsAdapter } from "../src/adapters/filesystem/findings-adapter.js";
import { ResponsibilitiesAdapter } from "../src/adapters/filesystem/responsibilities-adapter.js";
import { StructureAdapter } from "../src/adapters/filesystem/structure-adapter.js";
import { DescriberAdapter } from "../src/adapters/plugins/describer-adapter.js";
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

describe("the filesystem repositories plan reads", () => {
  it("the_repositories_read_the_cached_scans_measured_inputs_and_lines", () => {
    const { io } = seeded();
    const structure = new StructureAdapter(io);
    const findings = new FindingsAdapter(io);
    const cached = structure.read(ROOT);

    expect(
      cached.extractions.map((extraction) =>
        cached.files
          .filter((file) => file.language === extraction.language)
          .map(({ path }) => path),
      ),
    ).toEqual([["B.kt"], ["m0.py", "m1.py"]]);
    expect(structure.read("/nowhere").files).toEqual([]);
    expect(findings.measuredOf(ROOT, "crap")).toEqual({
      inputs: { "m0.py": H1 },
      tests: D,
    });
    expect(findings.measuredOf(ROOT, "mutation")).toBeNull();

    const lines = new ResponsibilitiesAdapter(io).read(ROOT);

    expect(lines.ids()).toEqual(["m0.py", "m1.py"]);
    expect(lines.get("m0.py")?.sourceHash).toBe(H1);
    expect(
      findDescribeGap(
        {
          structure,
          describer: new DescriberAdapter(io),
          responsibilities: new ResponsibilitiesAdapter(io),
        },
        ROOT,
        ["B.kt", "m0.py", "m1.py"],
      ),
    ).toEqual(["B.kt", "m1.py"]);
  });
});
