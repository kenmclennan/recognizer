import { describe, expect, it } from "vitest";
import { InvalidRequest, parseSuiteSelection } from "../../src/index.js";

describe("parseSuiteSelection", () => {
  const configured = ["unit", "web"];
  const sensors = [
    { name: "crap", runsTests: true },
    { name: "mutation", runsTests: true },
    { name: "duplication", runsTests: false },
  ];

  it("parses per-sensor arrays and deduplicates", () => {
    expect(
      parseSuiteSelection(
        '{"crap":["unit","unit"],"mutation":["unit","web"]}',
        configured,
        sensors,
      ),
    ).toEqual({ crap: ["unit"], mutation: ["unit", "web"] });
  });

  it("parses an empty object to no selection", () => {
    expect(parseSuiteSelection("{}", configured, sensors)).toEqual({});
  });

  it.each([
    ["malformed", "{", /not valid JSON/],
    ["not an object", "[]", /must be a JSON object/],
    ["null", "null", /must be a JSON object/],
    ["an unselected sensor", '{"other":["unit"]}', /not selected/],
    [
      "a sensor that runs no tests",
      '{"duplication":["unit"]}',
      /runs no tests/,
    ],
    ["an empty array", '{"crap":[]}', /at least one suite/],
    ["an unknown suite", '{"crap":["nope"]}', /no such suite: nope/],
    ["a non-array", '{"crap":"unit"}', /array of non-empty suite names/],
    ["an empty suite name", '{"crap":[""]}', /array of non-empty suite names/],
  ])("refuses %s with an InvalidRequest", (_, text, message) => {
    expect(() => parseSuiteSelection(text, configured, sensors)).toThrow(
      InvalidRequest,
    );
    expect(() => parseSuiteSelection(text, configured, sensors)).toThrow(
      message,
    );
  });

  it("names the unreadable sensor, not a sensor that runs no tests, first", () => {
    const mixed = [
      {
        name: "crap",
        runsTests: false,
        unreadable: "the crap program is not installed",
      },
      { name: "duplication", runsTests: false },
    ];

    expect(() =>
      parseSuiteSelection(
        '{"crap":["unit"],"duplication":["unit"]}',
        configured,
        mixed,
      ),
    ).toThrow(
      "--suites names crap, which cannot be read: the crap program is not installed",
    );
  });

  it("lists every unknown suite then the configured ones", () => {
    try {
      parseSuiteSelection('{"crap":["a","unit","b"]}', configured, sensors);
      expect.unreachable();
    } catch (error) {
      expect((error as InvalidRequest).messages).toEqual([
        "--suites crap: no such suite: a",
        "--suites crap: no such suite: b",
        "configured suites: unit, web",
      ]);
    }
  });
});
