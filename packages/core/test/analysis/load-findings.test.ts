import { describe, expect, it } from "vitest";
import {
  DEFAULT_STRUCTURE_SETTINGS,
  type LoadFindingsPorts,
  loadFindings,
  type SensorFindings,
  STRUCTURE_SENSOR_VERSION,
} from "../../src/index.js";
import { createFakes } from "../fakes/container.js";
import { breaching, FORBID, ROOT } from "./analysis-world.js";

function world() {
  const fakes = createFakes();
  const said: string[] = [];

  fakes.policy.held = [FORBID];
  fakes.config.settings = DEFAULT_STRUCTURE_SETTINGS;

  const ports: LoadFindingsPorts = {
    config: fakes.config,
    findings: fakes.findings,
    policy: fakes.policy,
    source: fakes.source,
    repositoryFiles: fakes.repositoryFiles,
    digest: fakes.digest,
    testReports: fakes.testReports,
    languages: fakes.languages,
  };
  const load = (commit: string | null) =>
    loadFindings(
      ports,
      (_stream, text) => {
        said.push(text);
      },
      ROOT,
      breaching(commit),
    );

  return { fakes, said, load };
}

function structureOf(documents: SensorFindings[]): SensorFindings {
  const found = documents.find(({ sensor }) => sensor.name === "structure");

  if (found === undefined) {
    throw new Error("no structure document");
  }

  return found;
}

describe("loadFindings", () => {
  it("computes without saving when the scan has no commit", () => {
    const { fakes, load } = world();

    const documents = load(null);

    expect(structureOf(documents).sensor.name).toBe("structure");
    expect(fakes.findings.saved).toEqual([]);
  });

  it("saves the computed document when nothing is stored for the commit", () => {
    const { fakes, load } = world();

    const documents = load("abc");

    expect(structureOf(documents).commit).toBe("abc");
    expect(fakes.findings.saved).toHaveLength(1);
    expect(fakes.findings.saved[0]?.sensor.name).toBe("structure");
  });

  it("reuses the stored document on a second call", () => {
    const { fakes, load } = world();

    const first = load("abc");

    expect(fakes.findings.saved).toHaveLength(1);

    const second = load("abc");

    expect(structureOf(second)).toEqual(structureOf(first));
    expect(fakes.findings.saved).toHaveLength(1);
  });

  it.each([
    ["another version", { sensor: { name: "structure", version: "0" } }],
    ["another commit", { commit: "other" }],
    ["a modified tree", { modified: true }],
    ["other settings", { settings: { entry_points: ["x"] } }],
  ])(
    "recomputes and saves when the stored document has %s",
    (_name, change) => {
      const { fakes, load } = world();

      load("abc");

      const stored = fakes.findings.saved[0] as SensorFindings;

      fakes.findings.stored.set("structure", {
        name: "structure",
        status: "read",
        document: { ...stored, ...change } as SensorFindings,
      });

      const documents = load("abc");

      expect(structureOf(documents).sensor.version).toBe(
        STRUCTURE_SENSOR_VERSION,
      );
      expect(fakes.findings.saved).toHaveLength(2);
    },
  );

  it("reads no structure document when settings are off", () => {
    const { fakes, load } = world();

    fakes.config.settings = "off";

    const documents = load("abc");

    expect(documents).toEqual([]);
    expect(fakes.findings.saved).toEqual([]);
  });

  it("reports mixed registered files by name", () => {
    const { fakes, said, load } = world();
    const current = {
      sensor: { name: "alpha", version: "1" },
      commit: "abc",
      modified: false,
      settings: {},
      findings: [],
    } as unknown as SensorFindings;

    fakes.config.sensors = ["alpha", "beta"];
    fakes.findings.stored.set("alpha", {
      name: "alpha",
      status: "read",
      document: current,
    });
    fakes.findings.stored.set("beta", {
      name: "beta",
      status: "invalid",
      reason: "bad shape",
    });
    fakes.findings.stored.set("gamma", {
      name: "gamma",
      status: "invalid",
      reason: "whatever",
    });

    const documents = load("abc");

    expect(documents.map(({ sensor }) => sensor.name).sort()).toEqual([
      "alpha",
      "structure",
    ]);
    expect(said).toContain("invalid beta: bad shape\n");
    expect(said).toContain("ignored unregistered gamma\n");
  });

  it("returns the fresh document and says so when the save throws", () => {
    const { fakes, said, load } = world();

    fakes.findings.save = () => {
      throw new Error("disk full");
    };

    const documents = load("abc");

    expect(structureOf(documents).commit).toBe("abc");
    expect(said).toContain("could not write structure findings\n");
  });
});
