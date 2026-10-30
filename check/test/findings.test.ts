import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findingsByModule } from "../src/findings.js";
import { parsePolicy, validateScan } from "../src/index.js";
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

describe("findingsByModule", () => {
  it("attaches a cycle warning to every module in it and a hub warning to the hub", () => {
    const { scan, policy } = fixture("check-warnings");
    const found = findingsByModule([scan], policy, 3);

    expect(found.get("app/domain/money.py")?.map((f) => f.severity)).toEqual([
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
