import { describe, expect, it } from "vitest";
import { requestFaults, type ScanRequest } from "../src/index.js";

function request(overrides: Partial<ScanRequest> = {}): ScanRequest {
  return {
    repository: "/work/repository",
    mode: "full",
    describe: false,
    sensors: null,
    analysis: true,
    ignoreRetiredConfig: false,
    invocation: [],
    ...overrides,
  };
}

const scope = (names: string[]) => ({ file: "/work/modules.json", names });

describe("request checks", () => {
  it("refuses each malformed request with its message", () => {
    const cases: [Partial<ScanRequest>, string][] = [
      [{ modules: scope([]) }, "the file scope is empty"],
      [{ modules: scope(["a", ""]) }, "a file id in the scope is empty"],
      [{ modules: scope(["a\0b"]) }, "a file id in the scope holds a NUL"],
      [
        { sensors: [{ name: "tally", suites: ["x".repeat(201)] }] },
        "a suite name is empty, over 200 characters or holds a NUL",
      ],
      [
        { sensors: [{ name: "tally", suites: ["a\0b"] }] },
        "a suite name is empty, over 200 characters or holds a NUL",
      ],
      [
        { sensors: [{ name: "tally", suites: [""] }] },
        "a suite name is empty, over 200 characters or holds a NUL",
      ],
      [
        { sensors: [{ name: "tally", suites: [] }] },
        "a sensor's suite list is empty",
      ],
      [{ sensors: [{ name: "Bad Name" }] }, "Bad Name is not a sensor name"],
      [{ sensors: [{ name: "" }] }, " is not a sensor name"],
    ];

    for (const [overrides, message] of cases) {
      expect(requestFaults(request(overrides))).toEqual([message]);
    }
  });

  it("refuses a request with a valid sensor and a NUL suite with the one message", () => {
    expect(
      requestFaults(
        request({
          modules: scope(["a"]),
          sensors: [{ name: "tally", suites: ["a\0b"] }],
        }),
      ),
    ).toEqual(["a suite name is empty, over 200 characters or holds a NUL"]);
  });

  it("accepts a suite name of 200 characters and refuses one of 201", () => {
    const sensors = (length: number) => [
      { name: "tally", suites: ["x".repeat(length)] },
    ];

    expect(requestFaults(request({ sensors: sensors(200) }))).toEqual([]);
    expect(requestFaults(request({ sensors: sensors(201) }))).toHaveLength(1);
  });

  it("accepts a well-formed request", () => {
    expect(
      requestFaults(
        request({
          modules: scope(["a.py"]),
          sensors: [{ name: "crap", suites: ["unit"] }],
        }),
      ),
    ).toEqual([]);
  });
});
