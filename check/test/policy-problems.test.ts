import { describe, expect, it } from "vitest";
import { parsePolicy } from "../src/index.js";
import { policyProblems } from "../src/policy-problems.js";
import { scanOf } from "./scan-of.js";

describe("policyProblems", () => {
  const POLICY =
    "components:\n  domain: app/domain/**\n  ports: app/ports/**\n";

  it("reports exactly the failing entry and the uncovered folder", () => {
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
        text: "policy entry app/ports/** (component ports) matches no scanned module",
      },
      {
        kind: "folder",
        subject: "app/misc",
        text: "folder app/misc holds 1 scanned modules that no component covers",
      },
    ]);
  });

  it("reports a glob listed under two components once", () => {
    const found = policyProblems(
      [scanOf([], ["x/a.py"])],
      parsePolicy("components:\n  one: gone/**\n  two: gone/**\n  c: x/**\n"),
    );

    expect(found.map((problem) => problem.subject)).toEqual(["gone/**"]);
    expect(found[0]?.text).toContain("component one");
  });

  it("reports nothing without components or without a policy", () => {
    const scan = scanOf([], ["x/a.py"]);

    expect(policyProblems([scan], parsePolicy("ignore: []\n"))).toEqual([]);
    expect(policyProblems([scan], null)).toEqual([]);
  });

  it("does not report a glob matching a module in only one of two scans", () => {
    const found = policyProblems(
      [scanOf([], ["app/domain/a.py"]), scanOf([], ["app/ports/p.py"])],
      parsePolicy(POLICY),
    );

    expect(found).toEqual([]);
  });
});
