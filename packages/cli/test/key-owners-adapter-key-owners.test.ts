import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KeyOwnersAdapter } from "../src/adapters/plugins/key-owners-adapter.js";
import { REPO } from "./helpers.js";
import { exampleManifest } from "./installed-read.js";
import { registeredPlugins } from "./registered-plugins.js";
import { fakeIo, ROOT } from "./scan-helpers.js";

const OFFICIAL_REGISTERED = registeredPlugins([
  { kind: "sensor", name: "crap" },
  { kind: "sensor", name: "mutation" },
]);

const PINNED = JSON.parse(
  readFileSync(join(REPO, "fixtures/sensors/config-keys.json"), "utf8"),
) as { keys: { key: string }[]; sections: { key: string }[] };

function adapterFor(options: Parameters<typeof fakeIo>[0]) {
  return new KeyOwnersAdapter(fakeIo(options).io);
}

function manifestProgram(manifest: unknown) {
  return () => ({ stdout: JSON.stringify(manifest) });
}

describe("KeyOwnersAdapter", () => {
  it("builds the tests keys from the installed sensors' manifests, as the pinned schema holds them", () => {
    const { schema, notAnswering } = adapterFor({
      sensorManifests: true,
      ...OFFICIAL_REGISTERED,
    }).schemas();

    expect(notAnswering).toEqual([]);
    expect(schema.keys.map((entry) => entry.key)).toContain(
      "tests.<name>.env.<variable>",
    );
    expect(schema).toEqual(PINNED);
  });

  it("builds placeholders from the real crap and mutation manifests alone", () => {
    const { schema, notAnswering } = adapterFor({
      sensorManifests: true,
      ...OFFICIAL_REGISTERED,
    }).schemas();

    expect(notAnswering).toEqual([]);
    expect(schema.placeholders).toEqual({
      name: "^.+$",
      variable: "^[A-Za-z_][A-Za-z0-9_]*$",
    });
  });

  it("holds no tests section when no sensor answers", () => {
    const { schema } = adapterFor({}).schemas();

    expect(schema.sections).toEqual([]);
    expect(schema.keys.some((entry) => entry.key.startsWith("tests."))).toBe(
      false,
    );
  });

  it("reports a sensor whose suite key differs from another's and leaves its suite keys out", () => {
    const mutation = exampleManifest("mutation");
    const suite = mutation.suite_keys as {
      section: unknown;
      keys: { key: string }[];
    };
    const conflicting = {
      ...mutation,
      suite_keys: {
        ...suite,
        keys: suite.keys.map((entry) =>
          entry.key === "tests.<name>.command"
            ? { ...entry, description: "something else" }
            : entry,
        ),
      },
    };
    const { schema, notAnswering } = adapterFor({
      sensorManifests: true,
      ...OFFICIAL_REGISTERED,
      programs: { "recognizer-sense-mutation": manifestProgram(conflicting) },
    }).schemas();

    expect(notAnswering).toHaveLength(1);
    expect(notAnswering[0]).toContain("sensors.mutation");
    expect(notAnswering[0]).toContain("tests.<name>.command");
    expect(
      schema.keys.find((entry) => entry.key === "tests.<name>.command")
        ?.description,
    ).not.toBe("something else");
  });

  it("a sensor that declares a placeholder another sensor declared differently is not answering, and its keys are left out", () => {
    const mutation = exampleManifest("mutation");
    const differing = {
      ...mutation,
      placeholders: {
        ...mutation.placeholders,
        variable: { pattern: "^[A-Z]+$", description: "a shouting variable" },
      },
    };
    const { schema, notAnswering } = adapterFor({
      sensorManifests: true,
      ...OFFICIAL_REGISTERED,
      programs: { "recognizer-sense-mutation": manifestProgram(differing) },
    }).schemas();

    expect(notAnswering).toHaveLength(1);
    expect(notAnswering[0]).toContain("sensors.mutation");
    expect(notAnswering[0]).toContain("<variable>");
    expect(schema.placeholders.variable).toBe("^[A-Za-z_][A-Za-z0-9_]*$");
    expect(
      schema.keys.some((entry) => entry.key.startsWith("sensors.mutation.")),
    ).toBe(false);
    expect(
      schema.keys.some((entry) => entry.key.startsWith("sensors.crap.")),
    ).toBe(true);
  });

  it("a sensor whose key uses a placeholder it does not declare is not answering", () => {
    const mutation = exampleManifest("mutation");
    const undeclaring = {
      ...mutation,
      settings: [
        ...mutation.settings,
        {
          key: "<metric>.above",
          type: "number",
          description: "a finding when the metric is above this value",
          example: "sensors.mutation.score.above 3",
        },
      ],
    };
    const { schema, notAnswering } = adapterFor({
      sensorManifests: true,
      ...OFFICIAL_REGISTERED,
      programs: { "recognizer-sense-mutation": manifestProgram(undeclaring) },
    }).schemas();

    expect(notAnswering).toHaveLength(1);
    expect(notAnswering[0]).toContain("sensors.mutation");
    expect(notAnswering[0]).toContain("<metric>.above");
    expect(notAnswering[0]).toContain("<metric>");
    expect(schema.keys.map((entry) => entry.key)).toContain(
      "sensors.crap.threshold",
    );
    expect(
      schema.keys.some((entry) => entry.key.startsWith("sensors.mutation.")),
    ).toBe(false);
  });

  it("a protocol 1 sensor with no placeholder keys still publishes its keys", () => {
    const mutation = exampleManifest("mutation");
    const {
      suite_keys: _suite,
      placeholders: _placeholders,
      ...rest
    } = mutation;
    const previous = { ...rest, protocol: 1, runs_tests: false };
    const { schema, notAnswering } = adapterFor({
      sensorManifests: true,
      ...OFFICIAL_REGISTERED,
      programs: { "recognizer-sense-mutation": manifestProgram(previous) },
    }).schemas();

    expect(notAnswering).toEqual([]);
    expect(
      schema.keys.some((entry) => entry.key.startsWith("sensors.mutation.")),
    ).toBe(true);
  });

  it("a third-party sensor that declares metric publishes <metric>.above", () => {
    const mutation = exampleManifest("mutation");
    const declaring = {
      ...mutation,
      placeholders: {
        ...mutation.placeholders,
        metric: {
          pattern: "^[a-z][a-z0-9_-]*$",
          description: "a metric the sensor reports",
        },
      },
      settings: [
        ...mutation.settings,
        {
          key: "<metric>.above",
          type: "number",
          description: "a finding when the metric is above this value",
          example: "sensors.mutation.score.above 3",
        },
      ],
    };
    const { schema, notAnswering } = adapterFor({
      sensorManifests: true,
      ...OFFICIAL_REGISTERED,
      programs: { "recognizer-sense-mutation": manifestProgram(declaring) },
    }).schemas();

    expect(notAnswering).toEqual([]);
    expect(schema.placeholders.metric).toBe("^[a-z][a-z0-9_-]*$");
    expect(schema.keys.map((entry) => entry.key)).toContain(
      "sensors.mutation.<metric>.above",
    );
  });

  describe("with a repository root", () => {
    const mine = { ...exampleManifest("crap"), name: "mine" };
    const registered = (...names: string[]) =>
      registeredPlugins(
        names.map((name) => ({
          kind: "sensor" as const,
          name,
          command: [`${name}-sense`],
        })),
      );
    const keysOf = (schema: { keys: { key: string }[] }, prefix: string) =>
      schema.keys
        .map((entry) => entry.key)
        .filter((key) => key.startsWith(prefix));

    it("publishes the settings of a registered custom sensor under its registered name", () => {
      const { schema, notAnswering } = adapterFor({
        ...registered("mine"),
        programs: { "mine-sense": manifestProgram(mine) },
      }).schemas(ROOT);

      expect(notAnswering).toEqual([]);
      expect(keysOf(schema, "sensors.mine.")).toEqual([
        "sensors.mine.threshold",
        "sensors.mine.coverage_limit",
        "sensors.mine.overlay",
      ]);
    });

    it("lists a registered sensor whose manifest cannot be read as not answering", () => {
      const { schema, notAnswering } = adapterFor({
        ...registered("mine"),
      }).schemas(ROOT);

      expect(notAnswering).toHaveLength(1);
      expect(notAnswering[0]).toContain("sensors.mine");
      expect(keysOf(schema, "sensors.mine.")).toEqual([]);
    });

    it("publishes a sensor that is registered and on PATH once, from the registered read", () => {
      const { schema } = adapterFor({
        sensorManifests: true,
        ...OFFICIAL_REGISTERED,
      }).schemas(ROOT);

      expect(
        keysOf(schema, "sensors.crap.").filter(
          (key) => key === "sensors.crap.threshold",
        ),
      ).toEqual(["sensors.crap.threshold"]);
    });

    it("answers one readable and one unreadable each their own way", () => {
      const { schema, notAnswering } = adapterFor({
        ...registered("good", "bad"),
        programs: {
          "good-sense": manifestProgram({ ...mine, name: "good" }),
        },
      }).schemas(ROOT);

      expect(keysOf(schema, "sensors.good.")).toContain(
        "sensors.good.threshold",
      );
      expect(notAnswering).toHaveLength(1);
      expect(notAnswering[0]).toContain("sensors.bad");
      expect(keysOf(schema, "sensors.bad.")).toEqual([]);
    });

    it("refuses a sensor that publishes a setting named manifest", () => {
      const reserved = {
        ...mine,
        settings: [
          { key: "manifest", type: "string", description: "x", example: "x" },
        ],
      };
      const { notAnswering } = adapterFor({
        ...registered("mine"),
        programs: { "mine-sense": manifestProgram(reserved) },
      }).schemas(ROOT);

      expect(notAnswering).toHaveLength(1);
      expect(notAnswering[0]).toContain("sensors.mine");
    });
  });
});
