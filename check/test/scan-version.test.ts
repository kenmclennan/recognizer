import { describe, expect, it } from "vitest";
import { InputError } from "../src/errors.js";
import {
  judgeScanVersion,
  SCAN_BREAKING_VERSIONS,
  SCAN_SCHEMA_VERSION,
  validateAcceptedScan,
} from "../src/scan.js";
import { scanJson } from "./scan-helpers.js";

describe("judgeScanVersion", () => {
  it.each([
    [8, 8, [7], "current"],
    [9, 8, [7], "newer"],
    [7, 8, [7], "older"],
    [6, 8, [7], "broken"],
    [7, 8, [8], "broken"],
    [8, 8, [8], "current"],
    [1, 8, [], "older"],
    [6, 7, [7], "broken"],
    [1, 7, [7], "broken"],
    [7, 7, [7], "current"],
  ] as const)(
    "judges %i against %i with breaks %j as %s",
    (found, current, breaks, verdict) => {
      expect(judgeScanVersion(found, current, breaks)).toBe(verdict);
    },
  );

  it("holds the real list as the seeded break at 7", () => {
    expect(SCAN_BREAKING_VERSIONS).toEqual([7]);
    expect(SCAN_SCHEMA_VERSION).toBe(7);
  });
});

function scanAt(version: number, overrides: Record<string, unknown> = {}) {
  return JSON.parse(scanJson(1, 0, { schema_version: version, ...overrides }));
}

describe("validateAcceptedScan", () => {
  it("returns a current scan unchanged", () => {
    const scan = scanAt(SCAN_SCHEMA_VERSION);

    expect(validateAcceptedScan(scan)).toBe(scan);
  });

  it.each([
    ["newer", SCAN_SCHEMA_VERSION + 1],
    ["broken", SCAN_SCHEMA_VERSION - 1],
  ])("refuses a %s scan with the existing text", (_, version) => {
    expect(() => validateAcceptedScan(scanAt(version))).toThrow(
      `scan has schema_version ${version}, recognizer accepts ${SCAN_SCHEMA_VERSION}`,
    );
  });

  it("refuses a non-integer version as invalid", () => {
    expect(() => validateAcceptedScan(scanAt(7.5))).toThrow(InputError);
    expect(() => validateAcceptedScan({ modules: [] })).toThrow(InputError);
  });
});

describe("validateAcceptedScan over an older accepted version", () => {
  it("accepts an older current-shape scan and keeps its own version", () => {
    const scan = scanAt(SCAN_SCHEMA_VERSION - 1);

    expect(scan.schema_version).not.toBe(SCAN_SCHEMA_VERSION);
    expect(validateAcceptedScan(scan, SCAN_SCHEMA_VERSION, [])).toBe(scan);
    expect(scan.schema_version).toBe(SCAN_SCHEMA_VERSION - 1);
  });

  it("accepts a scan one version behind an app that is one ahead of the schema", () => {
    const scan = scanAt(SCAN_SCHEMA_VERSION);

    expect(validateAcceptedScan(scan, SCAN_SCHEMA_VERSION + 1, [])).toBe(scan);
  });

  it("refuses an older scan whose break lies between it and the app", () => {
    const scan = scanAt(SCAN_SCHEMA_VERSION - 2);

    expect(() =>
      validateAcceptedScan(scan, SCAN_SCHEMA_VERSION, [
        SCAN_SCHEMA_VERSION - 1,
      ]),
    ).toThrow(`recognizer accepts ${SCAN_SCHEMA_VERSION}`);
  });

  it("refuses an older scan that is structurally invalid as invalid-scan", () => {
    const scan = scanAt(SCAN_SCHEMA_VERSION - 1, { modules: "x" });

    expect(scan.schema_version).not.toBe(SCAN_SCHEMA_VERSION);
    expect(() => validateAcceptedScan(scan, SCAN_SCHEMA_VERSION, [])).toThrow(
      /scan\/modules/,
    );
  });
});
