import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { type Overlay, validateOverlay } from "../src/overlays.js";
import { REPO } from "./helpers.js";

const EXAMPLES = join(REPO, "schema/overlay-examples");
const metrics = [
  { name: "m", type: "ratio", granularity: "module", bad: "low" },
] as const;
const expected = { commit: "abc", modified: false, metrics: [...metrics] };

function overlay(changes: Record<string, unknown> = {}): unknown {
  return {
    overlay_version: 1,
    commit: "abc",
    modified: false,
    producer: { name: "p", version: "1" },
    metrics: [...metrics],
    values: { m: { "a.py": 0.5 } },
    ...changes,
  };
}

describe("overlay schema examples", () => {
  const validate = new Ajv2020({ allErrors: true }).compile(
    JSON.parse(readFileSync(join(REPO, "schema/overlay.schema.json"), "utf8")),
  );

  it.each(readdirSync(join(EXAMPLES, "valid")))("accepts %s", (file) => {
    const value = JSON.parse(
      readFileSync(join(EXAMPLES, "valid", file), "utf8"),
    );

    expect(validate(value)).toBe(true);
  });

  it.each(readdirSync(join(EXAMPLES, "invalid")))("rejects %s", (file) => {
    const value = JSON.parse(
      readFileSync(join(EXAMPLES, "invalid", file), "utf8"),
    );

    expect(validate(value)).toBe(false);
  });
});

describe("validateOverlay", () => {
  it("accepts a conforming overlay", () => {
    expect(validateOverlay(overlay(), expected)).toEqual(overlay() as Overlay);
  });

  it("accepts a declared metric with no values", () => {
    expect(() =>
      validateOverlay(overlay({ values: {} }), expected),
    ).not.toThrow();
  });

  it("accepts the declarations in any order", () => {
    const two = [
      ...metrics,
      { name: "n", type: "count", granularity: "member", bad: "high" },
    ];

    expect(() =>
      validateOverlay(overlay({ metrics: [...two].reverse(), values: {} }), {
        ...expected,
        metrics: two as never,
      }),
    ).not.toThrow();
  });

  it.each([
    ["commit", { commit: "def" }, /commit/],
    ["modified", { modified: true }, /modified/],
    [
      "metrics",
      {
        metrics: [
          { name: "m", type: "count", granularity: "module", bad: "low" },
        ],
        values: {},
      },
      /metrics/,
    ],
    [
      "undeclared metric",
      { values: { other: { "a.py": 1 } } },
      /undeclared metric other/,
    ],
    ["ratio of 1.5", { values: { m: { "a.py": 1.5 } } }, /values m a\.py/],
    [
      "count of 1.5",
      {
        metrics: [
          { name: "m", type: "count", granularity: "module", bad: "low" },
        ],
        values: { m: { "a.py": 1.5 } },
      },
      /values m a\.py/,
    ],
    ["number as a string", { values: { m: { "a.py": "1" } } }, /values/],
  ])("rejects %s naming the field", (label, changes, reason) => {
    const target =
      label === "count of 1.5"
        ? {
            ...expected,
            metrics: [
              { name: "m", type: "count", granularity: "module", bad: "low" },
            ] as never,
          }
        : expected;

    expect(() => validateOverlay(overlay(changes), target)).toThrow(reason);
  });

  it("rejects a number metric given a string", () => {
    const number = [
      { name: "m", type: "number", granularity: "module", bad: "low" },
    ] as never;

    expect(() =>
      validateOverlay(
        overlay({ metrics: number, values: { m: { "a.py": "1" } } }),
        { ...expected, metrics: number },
      ),
    ).toThrow(/values/);
  });
});
