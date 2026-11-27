import { describe, expect, it } from "vitest";
import { readConfigArea } from "../../src/index.js";
import { FakeRepositoryChecks } from "../fakes/fake-repository-checks.js";

const ROOT = "/repo";
const CONFIG_FILE = ".recognizer/config.yaml";
const SENSE = ["recognizer", "sense", ""].join("-");
const DESCRIBE = ["recognizer", "describe", ""].join("-");

function area(
  document: unknown,
  options: { named?: boolean; messages?: string[] } = {},
) {
  const repository = new FakeRepositoryChecks();

  repository.configDocumentValue = { kind: "parsed", document };
  repository.schemaMessageList = options.messages ?? [];

  return {
    repository,
    read: () => readConfigArea(repository, ROOT, options.named ?? false),
  };
}

describe("readConfigArea", () => {
  it("reports nothing and the empty registration for an absent config", () => {
    const repository = new FakeRepositoryChecks();
    const reading = readConfigArea(repository, ROOT, false);

    expect(reading).toEqual({
      problems: [],
      registered: {
        specs: [],
        named: {},
        install: {},
        sensors: [],
        describer: false,
      },
    });
    expect(repository.keyReads).toBe(0);
  });

  it("reports one config-yaml problem and skips registration for unparseable YAML", () => {
    const repository = new FakeRepositoryChecks();

    repository.configDocumentValue = { kind: "unparseable", message: "bad" };

    const reading = readConfigArea(repository, ROOT, false);

    expect(reading).toEqual({
      problems: [
        {
          code: "config-yaml",
          subject: CONFIG_FILE,
          line: "config is not valid YAML: bad",
          fix: {
            text: `correct the YAML in ${CONFIG_FILE}`,
            command: null,
          },
        },
      ],
      registered: { skipped: "config has problems" },
    });
    expect(repository.keyReads).toBe(0);
  });

  describe("retired keys", () => {
    it("gives an unset command, quoted repository when named", () => {
      const plain = area({ overlays: {} }).read();
      const named = area({ overlays: {} }, { named: true }).read();

      expect(plain.problems).toEqual([
        {
          code: "config-retired",
          subject: "overlays",
          line: expect.stringContaining("config/overlays is retired"),
          fix: {
            text: "recognizer config --unset overlays",
            command: "recognizer config --unset overlays",
          },
        },
      ]);
      expect(named.problems[0]?.fix.command).toBe(
        "recognizer config --unset overlays --repository /repo",
      );
    });

    it("quotes a repository path that needs it", () => {
      const repository = new FakeRepositoryChecks();

      repository.configDocumentValue = {
        kind: "parsed",
        document: { overlays: {} },
      };

      const reading = readConfigArea(repository, "/my repo's", true);

      expect(reading.problems[0]?.fix.command).toBe(
        "recognizer config --unset overlays --repository '/my repo'\\''s'",
      );
    });

    it("gives the migration for the tolerated thresholds sensor", () => {
      const found = area(
        { sensors: { thresholds: {} } },
        { named: true },
      ).read().problems[0];

      expect(found?.code).toBe("config-retired");
      expect(found?.subject).toBe("sensors.thresholds");
      expect(found?.line).not.toContain("recognizer doctor gives the commands");
      expect(found?.fix.command).toContain("--repository /repo");
    });
  });

  describe("empty sections", () => {
    it("gives a remove-section command for a sensor entry", () => {
      const found = area({ sensors: { mine: null } }, { named: true }).read()
        .problems[0];

      expect(found).toEqual({
        code: "config-empty",
        subject: "sensors.mine",
        line: "config sensors.mine is empty: delete the section or give it settings",
        fix: {
          text: "recognizer config --remove-section sensors.mine --repository /repo",
          command:
            "recognizer config --remove-section sensors.mine --repository /repo",
        },
      });
    });

    it("gives a text fix for a top-level key", () => {
      expect(area({ install: null }).read().problems[0]).toEqual({
        code: "config-empty",
        subject: "install",
        line: "config install is empty: delete the section or give it settings",
        fix: {
          text: `delete install in ${CONFIG_FILE}, or give it settings`,
          command: null,
        },
      });
    });
  });

  it("reports a duplicate suite with a text fix", () => {
    const found = area({
      tests: [{ name: "unit" }, { name: "unit" }],
    }).read().problems[0];

    expect(found).toEqual({
      code: "config-duplicate-suite",
      subject: "unit",
      line: "config/tests the test suite name unit is used twice",
      fix: {
        text: `rename or remove one of the test suites named unit in ${CONFIG_FILE}`,
        command: null,
      },
    });
  });

  it("reports a retired published setting", () => {
    const { read, repository } = area({ coverage: { old: 1 } });

    repository.keyList = [{ key: "coverage.old", retired: "use new" }];

    expect(read().problems).toEqual([
      {
        code: "config-retired",
        subject: "coverage.old",
        line: "config/coverage/old is retired: use new",
        fix: {
          text: "recognizer config --unset coverage.old",
          command: "recognizer config --unset coverage.old",
        },
      },
    ]);
  });

  it("reports schema messages as config-invalid and skips registration", () => {
    const reading = area(
      { sensors: {} },
      { messages: ["config/sensors/x must be object", "config must have y"] },
    ).read();

    expect(reading.problems).toEqual([
      {
        code: "config-invalid",
        subject: "sensors.x",
        line: "config/sensors/x must be object",
        fix: {
          text: `correct sensors.x in ${CONFIG_FILE}`,
          command: null,
        },
      },
      {
        code: "config-invalid",
        subject: "config",
        line: "config must have y",
        fix: { text: `correct config in ${CONFIG_FILE}`, command: null },
      },
    ]);
    expect(reading.registered).toEqual({ skipped: "config has problems" });
  });

  it("reports a sensor with no manifest, repeating the repository in each command", () => {
    const reading = area(
      { sensors: { mine: { command: [`${SENSE}mine`, "run"] } } },
      { named: true },
    ).read();

    expect(reading.problems).toEqual([
      {
        code: "sensor-manifest-missing",
        subject: "mine",
        line: "sensors.mine names no manifest command, so it declares nothing (no suites, no scope, no check)",
        fix: {
          text: `recognizer config --add sensors.mine.manifest ${SENSE}mine --repository /repo && recognizer config --add sensors.mine.manifest manifest --repository /repo`,
          command: `recognizer config --add sensors.mine.manifest ${SENSE}mine --repository /repo && recognizer config --add sensors.mine.manifest manifest --repository /repo`,
        },
      },
    ]);
  });

  it("skips the manifest check when a schema message is present", () => {
    const reading = area(
      { sensors: { mine: { command: [`${SENSE}mine`] } } },
      { messages: ["config bad"] },
    ).read();

    expect(reading.problems.map((one) => one.code)).toEqual(["config-invalid"]);
  });

  it("orders retired keys, empty sections, duplicates, retired settings, invalid", () => {
    const { read, repository } = area(
      {
        overlays: {},
        install: null,
        tests: [{ name: "a" }, { name: "a" }],
        coverage: { old: 1 },
      },
      { messages: ["config bad"] },
    );

    repository.keyList = [{ key: "coverage.old", retired: "gone" }];

    expect(read().problems.map((one) => one.code)).toEqual([
      "config-retired",
      "config-empty",
      "config-duplicate-suite",
      "config-retired",
      "config-invalid",
    ]);
  });

  it("registers specs, named scanners, installs, sensors and the describer", () => {
    const reading = area({
      scanners: { typescript: "ts" },
      install: { [`${SENSE}b`]: "brew install b" },
      describer: { command: [`${DESCRIBE}x`, "run"] },
      sensors: {
        a: {
          command: [`${SENSE}a`, "run", "--settings", '{"k":1}'],
          manifest: [`${SENSE}a`, "manifest"],
        },
        b: { command: [`${SENSE}b`, "run"] },
        structure: { duplication: false },
      },
    }).read();

    expect(reading.problems.map((one) => one.subject)).toEqual(["b"]);
    expect(reading.registered).toEqual({
      specs: [
        {
          kind: "sensor",
          subject: "a",
          name: "a",
          program: `${SENSE}a`,
          command: [`${SENSE}a`, "run", "--settings", '{"k":1}'],
          manifest: [`${SENSE}a`, "manifest"],
          settings: { k: 1 },
          installLine: null,
        },
        {
          kind: "describer",
          subject: "describer",
          name: "x",
          program: `${DESCRIBE}x`,
          command: [`${DESCRIBE}x`, "run"],
          settings: null,
          installLine: null,
        },
      ],
      named: { typescript: "ts" },
      install: { [`${SENSE}b`]: "brew install b" },
      sensors: ["a", "b"],
      describer: true,
    });
  });

  describe("published keys are read where they always were", () => {
    it("reads them once for a parsed document without suites", () => {
      const { read, repository } = area({ install: {} });

      read();

      expect(repository.keyReads).toBe(1);
    });

    it("reads them twice when the schema is clean and suites exist", () => {
      const { read, repository } = area({ tests: [{ name: "unit" }] });
      const reading = read();

      expect(reading.problems).toEqual([]);
      expect(repository.keyReads).toBe(2);
    });

    it("reads them once when the schema reports errors", () => {
      const { read, repository } = area(
        { tests: [{ name: "unit" }] },
        { messages: ["config bad"] },
      );

      expect(read().problems.map((one) => one.code)).toEqual([
        "config-invalid",
      ]);
      expect(repository.keyReads).toBe(1);
    });
  });
});
