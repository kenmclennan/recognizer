import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PlanWorld, ticksOf } from "../fakes/plan-world.js";
import { repositoryFromFacts } from "../fakes/repository-of.js";

const fixtures = new URL("../../../../fixtures/", import.meta.url);

describe("a plan over committed content", () => {
  it("a_bring_plan_over_the_committed_typescript_scan", async () => {
    const scan = repositoryFromFacts(
      JSON.parse(
        readFileSync(
          new URL("typescript/expected-scan.json", fixtures),
          "utf8",
        ),
      ),
      "typescript",
    );
    const shipped = JSON.parse(
      readFileSync(new URL("sensors/shipped.json", fixtures), "utf8"),
    ) as string[];
    const planned = new PlanWorld();

    planned.seedScan(scan, "typescript");

    for (const name of shipped) {
      planned.addSensor(name, { runsTests: true });
    }

    expect(shipped).toEqual(["crap", "mutation"]);
    expect(scan.files.length).toBeGreaterThan(0);

    const view = await planned.plan({
      ticks: ticksOf({ ticked: [], armed: shipped }),
    });

    expect(view.never).toEqual(shipped);
    expect(view.intent.sense).toEqual(shipped);

    for (const name of shipped) {
      expect(view.work[name]).toBe(scan.files.length);
    }
  });
});
