import { describe, expect, it } from "vitest";
import {
  cliScenario,
  committedScan,
  languagePrograms,
  shippedSensor,
  typescriptScenario,
} from "./support/index.js";

describe("scan container", () => {
  it("refuses a bad sensor request with its messages", async () => {
    const scenario = cliScenario({ sensors: ["crap"] });
    const result = await scenario.run([
      "scan",
      scenario.repository,
      "--sense",
      "ghost",
    ]);

    expect(result.exit).toBe(2);
    expect(result.err).toContain("no such sensor: ghost");
  });

  it("the plan reads the tests from disk and ignores the scan's cached hashes", async () => {
    const testFile = "tests/test_a.py";
    const { root, repository } = typescriptScenario({
      registered: ["crap"],
      programs: {
        ...languagePrograms(),
        "recognizer-sense-crap": shippedSensor("crap"),
      },
    });

    root.io.files.writeFile(`${repository}/${testFile}`, "v1");

    const commit = root.repositories.commitAll(repository, "tests");
    const scan = committedScan();

    scan.commit = commit;
    scan.files.push({ path: testFile, hash: "f".repeat(64) });

    const moduleIds: string[] = scan.modules.map(
      (module: { id: string }) => module.id,
    );
    const inputs = Object.fromEntries(
      scan.files.map((file: { path: string; hash: string }) => [
        file.path,
        file.hash,
      ]),
    );
    const cache = `${repository}/.recognizer/cache`;

    root.io.files.writeFile(
      `${cache}/scan.typescript.json`,
      JSON.stringify(scan),
    );
    root.io.files.writeFile(
      `${cache}/findings/crap.json`,
      JSON.stringify({
        findings_version: 1,
        sensor: { name: "crap", version: "0.1.0" },
        commit,
        modified: false,
        settings: {
          threshold: 30,
          coverage_limit: 0.6,
          overlay: ".recognizer/cache/overlays/crap.json",
        },
        findings: [],
        inputs,
        tests: (await root.call("tests.hash", { repository, known: {} })).ok,
      }),
    );

    const request = {
      repository,
      mode: "bring",
      ticks: {
        describe: false,
        analysis: true,
        ticked: ["crap"],
        armed: ["crap"],
        onlyView: false,
        suites: {},
        folds: [],
      },
      scope: null,
      changed: [],
    };

    expect(moduleIds).not.toEqual([]);
    expect((await root.call("scan.plan", request)).ok.gaps.crap).toEqual([]);

    root.io.files.writeFile(`${repository}/${testFile}`, "v2");

    expect((await root.call("scan.plan", request)).ok.gaps.crap).toEqual(
      moduleIds.sort(),
    );

    await root.close();
  });
});
