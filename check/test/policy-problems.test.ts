import { describe, expect, it } from "vitest";
import { parsePolicy } from "../src/index.js";
import { policyProblems } from "../src/policy-problems.js";
import { scanOf } from "./scan-of.js";

describe("policyProblems", () => {
  const POLICY = "entry:\n  - app/domain/**\n  - app/ports/**\n";

  it("reports an entry glob matching no scanned module and no folder problem", () => {
    const found = policyProblems(
      [
        scanOf(
          [["app/domain/a.py", "app/misc/m.py"]],
          ["app/domain/a.py", "app/misc/m.py"],
        ),
      ],
      parsePolicy(POLICY),
    );

    expect(found).toEqual([
      {
        kind: "entry",
        subject: "app/ports/**",
        text: "policy entry app/ports/** matches no scanned module",
      },
    ]);
  });

  it("reports a glob listed twice once", () => {
    const found = policyProblems(
      [scanOf([], ["x/a.py"])],
      parsePolicy("entry:\n  - gone/**\n  - gone/**\n  - x/**\n"),
    );

    expect(found.map((problem) => problem.subject)).toEqual(["gone/**"]);
  });

  it("reports nothing with empty entry or without a policy", () => {
    const scan = scanOf([], ["x/a.py"]);

    expect(policyProblems([scan], parsePolicy("ignore: []\n"))).toEqual([]);
    expect(policyProblems([scan], parsePolicy("entry: []\n"))).toEqual([]);
    expect(policyProblems([scan], null)).toEqual([]);
  });

  it("does not report a glob matching a module in only one of two scans", () => {
    const found = policyProblems(
      [scanOf([], ["app/domain/a.py"]), scanOf([], ["app/ports/p.py"])],
      parsePolicy(POLICY),
    );

    expect(found).toEqual([]);
  });

  it("reports a forbid rule's to glob matching nothing once, naming the glob", () => {
    const found = policyProblems(
      [scanOf([], ["app/domain/a.py", "app/adapters/b.py"])],
      parsePolicy("forbid:\n  - app/domain/** -> app/nowhere/**\n"),
    );

    expect(found).toEqual([
      {
        kind: "forbid",
        subject: "app/nowhere/**",
        text: "policy forbid app/domain/** -> app/nowhere/**: app/nowhere/** matches no scanned module",
      },
    ]);
  });

  it("reports an unmatched glob inside a list forbid rule", () => {
    const found = policyProblems(
      [scanOf([], ["app/domain/a.py", "app/adapters/b.py"])],
      parsePolicy(
        "forbid:\n  - from: [app/domain/**, app/typo/**]\n    to: app/adapters/**\n",
      ),
    );

    expect(found.map((problem) => problem.subject)).toEqual(["app/typo/**"]);
  });

  it("reports nothing for a forbid rule whose globs all match", () => {
    const found = policyProblems(
      [scanOf([], ["app/domain/a.py", "app/adapters/b.py"])],
      parsePolicy("forbid:\n  - app/domain/** -> app/adapters/**\n"),
    );

    expect(found).toEqual([]);
  });

  it("does not report a forbid rule aimed at a foreign group", () => {
    const found = policyProblems(
      [scanOf([], ["app/domain/a.py"])],
      parsePolicy("forbid:\n  - app/domain/** -> foreign:requests\n"),
    );

    expect(found).toEqual([]);
  });
});
