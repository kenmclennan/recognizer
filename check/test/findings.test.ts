import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findingsByModuleFrom,
  linesDuplicated,
  orderDuplication,
} from "../src/findings.js";
import type { FindingRecord } from "../src/findings-document.js";
import { parsePolicy, validateScan } from "../src/index.js";
import { structureSensor } from "../src/structure-sensor.js";
import { REPO } from "./helpers.js";

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
  scans: ReturnType<typeof validateScan>[],
  policy: ReturnType<typeof parsePolicy> | null,
  hub: number,
) {
  const { document } = structureSensor(
    scans,
    policy,
    {
      hub_threshold: hub,
      distance_threshold: 0.3,
      entry_points: [],
      warnings: {
        cycle: true,
        hub: true,
        folder_cycle: true,
        orphan: true,
        policy_drift: true,
        stable_dependencies: true,
        stable_abstractions: true,
        unused_exports: false,
      },
    },
    { commit: "abc", modified: false },
  );

  return findingsByModuleFrom([document]);
}

describe("findingsByModuleFrom over the structure document", () => {
  it("attaches a cycle warning to every module in it and a hub warning to the hub", () => {
    const { scan, policy } = fixture("check-warnings");
    const found = findingsByModule([scan], policy, 3);

    expect(found.get("app/domain/money.py")?.map((f) => f.severity)).toEqual([
      "warning",
      "warning",
      "warning",
    ]);
    expect(found.get("app/domain/order.py")?.map((f) => f.why)).toContain(
      "no-cycles",
    );
    expect(found.get("app/application/place.py")?.map((f) => f.why)).toContain(
      "interfaces-are-narrow-and-explicit",
    );
  });

  it("lists a module's violation before its warnings", () => {
    const { scan, policy } = fixture("check-warnings");
    const found = findingsByModule([scan], policy, 3);
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
    const found = findingsByModule([scan], null, 3);

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

    expect(findingsByModule([scan], policy, 3).has("app/domain/money.py")).toBe(
      true,
    );
    expect(
      findingsByModule([scan], ignoring, 3).has("app/domain/money.py"),
    ).toBe(false);
  });
});

describe("linesDuplicated and orderDuplication", () => {
  const rec = (
    id: string,
    kind: string,
    sizes: (number | null)[],
  ): FindingRecord => ({
    id,
    kind,
    severity: "warning",
    principle: "p",
    summary: id,
    evidence: {
      modules: ["m"],
      members: sizes.map((size, index) => ({
        module: "m",
        name: `n${index}`,
        ...(size === null ? {} : { lines: [1, size] as [number, number] }),
      })),
    },
  });

  it("sums unequal members and counts a member without lines as 0", () => {
    expect(linesDuplicated(rec("a", "duplication", [46, 51, 57]))).toBe(154);
    expect(linesDuplicated(rec("a", "duplication", [10, null]))).toBe(10);
  });

  it("orders duplication records in their own slots and leaves other kinds put", () => {
    const records = [
      rec("hub1", "hub", []),
      rec("d-small", "duplication", [5, 5]),
      rec("cycle1", "cycle", []),
      rec("d-b", "duplication", [8, 8]),
      rec("d-big", "duplication", [20, 20]),
      rec("d-a", "duplication", [8, 8]),
    ];

    expect(orderDuplication(records).map((one) => one.id)).toEqual([
      "hub1",
      "d-big",
      "cycle1",
      "d-a",
      "d-b",
      "d-small",
    ]);
  });
});
