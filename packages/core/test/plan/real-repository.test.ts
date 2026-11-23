import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { testsHashOf } from "../../src/index.js";
import { PLAN_REPOSITORY, PlanWorld, ticksOf } from "../fakes/plan-world.js";
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

  it("a_digest_carrying_result_is_current_only_at_the_digest_of_the_committed_tests", async () => {
    const scan = repositoryFromFacts(
      JSON.parse(
        readFileSync(
          new URL("typescript/expected-scan.json", fixtures),
          "utf8",
        ),
      ),
      "typescript",
    );
    const planned = new PlanWorld();
    const tests = scan.files
      .map(({ path }) => path)
      .filter((path) => /test/.test(path));

    planned.seedScan(scan, "typescript");
    planned.addSensor("crap", { runsTests: true });
    planned.fakes.source.listed = tests.length > 0 ? tests : ["test/a.test.ts"];

    for (const path of planned.fakes.source.listed) {
      planned.fakes.source.hashes.set(`${PLAN_REPOSITORY}/${path}`, "h");
    }

    const inputs = Object.fromEntries(
      scan.files.map(({ path, hash }) => [path, hash]),
    );
    const digest = testsHashOf(planned.fakes, PLAN_REPOSITORY, new Map());
    const ticks = ticksOf({ ticked: ["crap"], armed: [] });

    planned.measure("crap", { inputs, tests: digest as string });

    const current = await planned.plan({ ticks });

    expect(current.gaps.crap).toEqual([]);

    planned.measure("crap", { inputs, tests: "other" });

    const stale = await planned.plan({ ticks });

    expect(stale.gaps.crap.length).toBe(scan.files.length);
  });
});
