import { describe, expect, it } from "vitest";
import { cliScenario } from "./support/cli-scenario.js";

describe("the CLI scenario", () => {
  it("seeds named files into the repository, text as given and objects as JSON", () => {
    const scenario = cliScenario({
      files: {
        ".recognizer/policy.yaml": "rules: []\n",
        ".recognizer/baseline.json": { violations: [] },
      },
    });

    expect(scenario.read(".recognizer/policy.yaml")).toBe("rules: []\n");
    expect(scenario.readJson(".recognizer/baseline.json")).toEqual({
      violations: [],
    });
    expect(scenario.exists(".recognizer/missing.json")).toBe(false);
  });

  it("commits the seeded files so a scan sees a clean tree", async () => {
    const scenario = cliScenario({ files: { "notes.txt": "kept" } });
    const status = scenario.root.io.run("git", ["status", "--porcelain"], {
      cwd: scenario.repository,
    });

    expect(status.stdout.trim()).toBe("");
  });

  it("runs a command over the seeded repository and captures its output and exit code", async () => {
    const scenario = cliScenario();
    const result = await scenario.run(["help"]);

    expect(result.exit).toBe(0);
    expect(result.out).toContain("recognizer");
    expect(result.err).toBe("");
    expect(scenario.root.io.out).toEqual([]);
  });

  it("runs a command that reads the repository and writes its result back into the fake files", async () => {
    const scenario = cliScenario({ files: { ".recognizer/note": "x" } });
    const result = await scenario.run(["scan", scenario.repository]);

    expect(result.exit).toBe(0);
    expect(scenario.exists(".recognizer/cache")).toBe(true);
  });
});
