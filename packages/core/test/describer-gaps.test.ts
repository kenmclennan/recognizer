import { describe, expect, it } from "vitest";
import type { Gap } from "../src/index.js";
import { createFakes, scanOver } from "./fakes/container.js";

function gap(id: string): Gap {
  return {
    id,
    line: `${id} is not ready`,
    needs: ["describe"],
    fix: {
      text: `fix ${id}`,
      command: null,
      cwd: "",
      env: {},
      kind: "outside",
    },
  };
}

describe("describer preflight", () => {
  it("reports the describer's gaps before the sensors' in the run's order", async () => {
    const fakes = createFakes();

    fakes.scanners.languages.set("python", {
      modules: 1,
      edges: 0,
      fails: false,
    });
    fakes.describer.registered = true;
    fakes.describer.needs = [gap("describe:program")];
    fakes.sensors.installed.set("ruler", {
      name: "ruler",
      runsTests: false,
      needs: ["ruler"],
      held: false,
    });

    const running = scanOver(fakes).start({
      repository: "/work/repository",
      mode: "full",
      describe: "stale",
      sensors: [{ name: "ruler" }],
      analysis: true,
      ignoreRetiredConfig: false,
      invocation: [],
    });
    const outcome = await running.outcome;

    expect(outcome.status).toBe("refused");
    expect(
      outcome.status === "refused" ? outcome.gaps.map((one) => one.id) : [],
    ).toEqual(["describe:program", "ruler"]);
  });
});
