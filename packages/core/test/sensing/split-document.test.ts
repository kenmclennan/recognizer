import { describe, expect, it } from "vitest";
import {
  Finding,
  type SensorFindings,
  splitDocument,
} from "../../src/index.js";
import { repositoryOf } from "../fakes/repository-of.js";

const SCAN = repositoryOf({ "a.py": "ha", "b.py": "hb" }, ["a.py", "b.py"]);

function findingOn(id: string, files: string[]): Finding {
  return Finding.stored({
    id,
    kind: "k",
    severity: "warning",
    principle: "p",
    summary: id,
    files,
  });
}

function documentOf(
  findings: Finding[],
  inputs: Record<string, string> | undefined,
): SensorFindings {
  return {
    sensor: { name: "s", version: "1" },
    commit: "c",
    modified: false,
    settings: {},
    findings,
    ...(inputs === undefined ? {} : { inputs }),
  };
}

describe("splitDocument", () => {
  it("shows every finding when all the files they name are current", () => {
    const one = findingOn("one", ["a.py"]);
    const two = findingOn("two", ["b.py"]);
    const document = documentOf([one, two], { "a.py": "ha", "b.py": "hb" });

    const split = splitDocument(SCAN, document, null);

    expect(split.shown.map((f) => f.id)).toEqual(["one", "two"]);
    expect(split.hidden).toEqual([]);
  });

  it("hides every finding when none of the files they name are current", () => {
    const one = findingOn("one", ["a.py"]);
    const two = findingOn("two", ["b.py"]);
    const document = documentOf([one, two], { "a.py": "old", "b.py": "old" });

    const split = splitDocument(SCAN, document, null);

    expect(split.shown).toEqual([]);
    expect(split.hidden.map((f) => f.id)).toEqual(["one", "two"]);
  });

  it("partitions a mixed document in order", () => {
    const current = findingOn("current", ["a.py"]);
    const outOfDate = findingOn("out-of-date", ["b.py"]);
    const unnamed = findingOn("unnamed", []);
    const document = documentOf([current, outOfDate, unnamed], {
      "a.py": "ha",
      "b.py": "old",
    });

    const split = splitDocument(SCAN, document, null);

    expect(split.shown.map((f) => f.id)).toEqual(["current", "unnamed"]);
    expect(split.hidden.map((f) => f.id)).toEqual(["out-of-date"]);
  });

  it("hides a finding naming no file on an invalid document", () => {
    const unnamed = findingOn("unnamed", []);
    const document = documentOf([unnamed], undefined);

    const split = splitDocument(SCAN, document, null);

    expect(split.shown).toEqual([]);
    expect(split.hidden.map((f) => f.id)).toEqual(["unnamed"]);
  });
});
