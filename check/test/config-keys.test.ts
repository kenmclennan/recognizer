import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CORE_KEYS,
  type KeySchema,
  parseKeySchema,
  publish,
} from "../src/config-keys.js";
import { keysHelp } from "../src/key-command.js";
import { REPO } from "./helpers.js";

const EXAMPLES = join(REPO, "schema/config-keys-examples");
const CONFIG = JSON.parse(
  readFileSync(join(REPO, "schema/config.schema.json"), "utf8"),
);

function examples(kind: string): [string, string][] {
  return readdirSync(join(EXAMPLES, kind)).map((name) => [
    name,
    readFileSync(join(EXAMPLES, kind, name), "utf8"),
  ]);
}

function core(key: string) {
  const found = CORE_KEYS.keys.find((entry) => entry.key === key);

  expect(found, key).toBeDefined();

  return found as NonNullable<typeof found>;
}

describe("the key schema examples", () => {
  it("accepts every valid example and refuses every invalid one", () => {
    expect(examples("valid").length).toBeGreaterThan(0);
    expect(examples("invalid").length).toBeGreaterThan(0);

    for (const [name, text] of examples("valid")) {
      expect("schema" in parseKeySchema(text), name).toBe(true);
    }

    for (const [name, text] of examples("invalid")) {
      expect("reason" in parseKeySchema(text), name).toBe(true);
    }
  });

  it("names a keys_version it does not read as the reason", () => {
    const [, text] = examples("invalid").find(([name]) =>
      name.startsWith("other-version"),
    ) as [string, string];

    expect(parseKeySchema(text)).toEqual({
      reason: "its keys_version is 2, not the 1 this recognizer reads",
    });
  });

  it("refuses a document that is not JSON, and one using an undefined placeholder", () => {
    expect(parseKeySchema("nope")).toEqual({
      reason: "it printed invalid JSON",
    });

    const undefinedPlaceholder = JSON.stringify({
      keys_version: 1,
      owner: "x",
      placeholders: {},
      sections: [],
      keys: [
        {
          key: "a.<who>",
          type: "string",
          description: "d",
          example: "a.b c",
        },
      ],
    });
    const parsed = parseKeySchema(undefinedPlaceholder);

    expect("reason" in parsed && parsed.reason).toContain("<who>");
  });
});

describe("the core's own key table", () => {
  it("validates against the key schema", () => {
    expect("schema" in parseKeySchema(JSON.stringify(CORE_KEYS))).toBe(true);
  });

  it("publishes a key for every property the config schema defines for the core's half", () => {
    const describer = CONFIG.properties.describer.properties;
    const sensors = CONFIG.properties.sensors;
    const structure = sensors.properties.structure.oneOf[0].properties;
    const warnings = structure.warnings.properties;
    const seen: string[] = [];

    expect(Object.keys(describer).length).toBe(2);
    expect(core("describer.command").multi).toBe(true);
    expect(core("describer.command").type).toBe("string");
    expect(core("describer.version").type).toBe("string");
    seen.push("describer.command", "describer.version");

    expect(sensors.additionalProperties.properties.command.type).toBe("array");
    expect(core("sensors.<name>.command").multi).toBe(true);
    seen.push("sensors.<name>.command");

    expect(core("sensors.structure").values).toEqual(["off"]);
    seen.push("sensors.structure");

    for (const [name, schema] of Object.entries(structure) as [
      string,
      { type: string; minimum?: number; maximum?: number },
    ][]) {
      if (name === "warnings" || name === "duplication") {
        continue;
      }

      const key = core(`sensors.structure.${name}`);

      expect(key.type, name).toBe(
        schema.type === "array" ? "string" : schema.type,
      );
      expect(key.multi === true, name).toBe(schema.type === "array");
      expect(key.minimum, name).toBe(schema.minimum);
      expect(key.maximum, name).toBe(schema.maximum);
      seen.push(`sensors.structure.${name}`);
    }

    const duplication = (
      structure.duplication as unknown as {
        oneOf: [
          { const: false },
          {
            properties: Record<
              string,
              {
                type: string;
                minimum?: number;
                maximum?: number;
                exclusiveMinimum?: number;
              }
            >;
          },
        ];
      }
    ).oneOf;

    expect(core("sensors.structure.duplication").type).toBe("boolean");
    seen.push("sensors.structure.duplication");

    for (const [name, schema] of Object.entries(duplication[1].properties)) {
      const key = core(`sensors.structure.duplication.${name}`);

      expect(key.type, name).toBe(schema.type);
      expect(key.minimum, name).toBe(schema.minimum);
      expect(key.maximum, name).toBe(schema.maximum);
      expect(key.exclusiveMinimum, name).toBe(schema.exclusiveMinimum);
      seen.push(`sensors.structure.duplication.${name}`);
    }

    const switches = Object.keys(warnings);
    const placeholder = core("sensors.structure.warnings.<warning>");

    expect(placeholder.type).toBe("boolean");

    for (const name of switches) {
      expect(CORE_KEYS.placeholders.warning, name).toContain(name);
      expect(
        new RegExp(CORE_KEYS.placeholders.warning as string).test(name),
        name,
      ).toBe(true);
    }

    expect(
      new RegExp(CORE_KEYS.placeholders.warning as string).test(
        "stable_abstractions",
      ),
    ).toBe(false);

    expect(core("sensors.structure.warnings.orphan.entry_points").multi).toBe(
      true,
    );
    expect(
      core("sensors.structure.warnings.long_function.limit"),
    ).toMatchObject({ type: "integer", minimum: 1, default: 20 });
    seen.push(
      "sensors.structure.warnings.<warning>",
      "sensors.structure.warnings.long_function.limit",
      "sensors.structure.warnings.orphan.entry_points",
    );

    expect(seen.length).toBeGreaterThanOrEqual(6);
    expect(CORE_KEYS.keys.map((entry) => entry.key).sort()).toEqual(
      [...seen].filter((key, at, all) => all.indexOf(key) === at).sort(),
    );
  });

  it("does not publish the retired keys", () => {
    const keys = CORE_KEYS.keys.map((entry) => entry.key);

    expect(keys.some((key) => key.includes("distance_threshold"))).toBe(false);
    expect(keys.some((key) => key.includes("stable_abstractions"))).toBe(false);
    expect(keys.some((key) => key.includes("instability_gap"))).toBe(false);
    expect(keys.some((key) => key.includes("composition_roots"))).toBe(false);
  });
});

describe("key defaults", () => {
  const base = (extra: Record<string, unknown>) =>
    JSON.stringify({
      keys_version: 1,
      owner: "x",
      placeholders: {},
      sections: [],
      keys: [
        {
          key: "a.b",
          type: "integer",
          description: "d",
          example: "e",
          ...extra,
        },
      ],
    });

  it("refuses a key that carries more than one of default, defaults and default_text", () => {
    expect(
      "reason" in parseKeySchema(base({ default: 1, defaults: { a: 1 } })),
    ).toBe(true);
    expect(
      "reason" in parseKeySchema(base({ default: 1, default_text: "t" })),
    ).toBe(true);
    expect(
      "reason" in
        parseKeySchema(base({ defaults: { a: 1 }, default_text: "t" })),
    ).toBe(true);
    expect("schema" in parseKeySchema(base({ default: 1 }))).toBe(true);
  });

  it("publishes the defaults of the core table", () => {
    const warning = core("sensors.structure.warnings.<warning>");

    expect(warning.defaults).toEqual({
      cycle: true,
      orphan: true,
      unused_exports: false,
      private_imports: true,
      long_function: true,
    });
    expect(core("sensors.structure.warnings.long_function.limit").default).toBe(
      20,
    );

    const figures = {
      threshold: 0.82,
      min_lines: 4,
      pair_min_lines: 6,
      min_nodes: 20,
    };

    for (const [name, value] of Object.entries(figures)) {
      expect(core(`sensors.structure.duplication.${name}`).default, name).toBe(
        value,
      );
    }

    const defaulted = CORE_KEYS.keys
      .filter(
        (entry) => entry.default !== undefined || entry.defaults !== undefined,
      )
      .map((entry) => entry.key)
      .sort();

    expect(defaulted).toEqual([
      "sensors.structure.duplication.min_lines",
      "sensors.structure.duplication.min_nodes",
      "sensors.structure.duplication.pair_min_lines",
      "sensors.structure.duplication.threshold",
      "sensors.structure.warnings.<warning>",
      "sensors.structure.warnings.long_function.limit",
    ]);
  });

  it("lists the default in the help line of each key form", () => {
    const schema = JSON.parse(base({ default: 30 })) as KeySchema;
    const withDefaults = {
      ...schema,
      keys: [
        {
          ...(schema.keys[0] as object),
          default: undefined,
          defaults: { x: 1, y: 2 },
        },
      ],
    } as unknown as KeySchema;
    const withText = {
      ...schema,
      keys: [
        {
          ...(schema.keys[0] as object),
          default: undefined,
          default_text: "sized from the cores",
        },
      ],
    } as unknown as KeySchema;

    const help = (given: KeySchema) =>
      keysHelp({ noun: "config" } as never, publish([given], "config"));

    expect(help(schema)).toContain("integer, default 30: d");
    expect(help(withDefaults)).toContain("default x 1, y 2: d");
    expect(help(withText)).toContain("default: sized from the cores: d");
  });
});

describe("merging key schemas", () => {
  const other = (key: string, owner: string): KeySchema => ({
    keys_version: 1,
    owner,
    placeholders: { name: "^.+$" },
    sections: [],
    keys: [{ key, type: "string", description: "d", example: "e" }],
  });

  it("fails the load when two owners publish keys of equal specificity that match one typed key, naming both", () => {
    const schemas = [
      other("sensors.<name>.command", "first"),
      other("sensors.<name>.command", "second"),
    ];

    expect(() => publish(schemas, "config")).toThrow(/first.*second/);
  });

  it("lets a literal segment sit beside a placeholder one", () => {
    expect(() =>
      publish([CORE_KEYS, other("sensors.structure.extra", "third")], "config"),
    ).not.toThrow();
  });
});
