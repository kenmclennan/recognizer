import { describe, expect, it } from "vitest";
import {
  type SuiteResult,
  type SuiteStanding,
  suiteStanding,
  suiteStandings,
  suiteState,
} from "../../src/index.js";

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-11-12T12:00:00.000Z");

const standing = (over: Partial<SuiteStanding> = {}): SuiteStanding => ({
  name: "unit",
  kind: "ok",
  at: NOW - 3 * HOUR,
  measured: 0,
  total: 0,
  reason: null,
  ...over,
});

describe("suite states", () => {
  it("reads each status as its short text and full hover text", () => {
    expect(suiteState(standing(), NOW)).toEqual({
      kind: "ok",
      text: "3h",
      title: "current, 3 hours ago",
    });
    expect(
      suiteState(
        standing({
          name: "web",
          kind: "failed",
          at: NOW - 5 * MINUTE,
          reason: "no coverage report",
        }),
        NOW,
      ),
    ).toEqual({
      kind: "failed",
      text: "5m",
      title: "failed 5 minutes ago: no coverage report",
    });
    expect(
      suiteState(
        standing({
          kind: "partial",
          at: NOW - 2 * DAY,
          measured: 11,
          total: 29,
        }),
        NOW,
      ),
    ).toEqual({
      kind: "partial",
      text: "11/29",
      title: "11 of 29 functions, 2 days ago",
    });
    expect(suiteState(undefined, NOW)).toEqual({
      kind: "never",
      text: "never",
      title: "never run",
    });
  });

  it("reads a failed suite without a reason as its age alone", () => {
    expect(
      suiteState(standing({ kind: "failed", at: NOW - HOUR }), NOW),
    ).toEqual({ kind: "failed", text: "1h", title: "failed 1 hour ago" });
  });

  it("reads a never standing as never run", () => {
    expect(suiteState(standing({ kind: "never", at: null }), NOW)).toEqual({
      kind: "never",
      text: "never",
      title: "never run",
    });
  });

  it("reads an ok standing with no time as empty text and an empty age", () => {
    expect(suiteState(standing({ at: null }), NOW)).toEqual({
      kind: "ok",
      text: "",
      title: "current, ",
    });
  });

  it("reads a running suite first, with the count when it has one", () => {
    expect(
      suiteState(standing(), NOW, { suite: "unit", done: 11, total: 29 }),
    ).toEqual({ kind: "running", text: "11/29", title: "11 of 29 functions" });
    expect(
      suiteState(standing(), NOW, { suite: "unit", done: null, total: null }),
    ).toEqual({ kind: "running", text: "running", title: "running" });
  });
});

describe("suite standings", () => {
  const result = (over: Partial<SuiteResult> = {}): SuiteResult => ({
    name: "unit",
    status: "ok",
    ranAt: "2026-11-12T09:00:00.000Z",
    ...over,
  });

  it("reads the instant a suite ran as epoch milliseconds", () => {
    expect(suiteStanding(result()).at).toBe(
      Date.parse("2026-11-12T09:00:00.000Z"),
    );
  });

  it("reads a missing or unparseable time as null", () => {
    expect(suiteStanding(result({ ranAt: null })).at).toBeNull();
    expect(suiteStanding(result({ ranAt: "yesterday-ish" })).at).toBeNull();
  });

  it("defaults the counts to 0 and the reason to null", () => {
    expect(suiteStanding(result())).toMatchObject({
      name: "unit",
      kind: "ok",
      measured: 0,
      total: 0,
      reason: null,
    });
    expect(
      suiteStanding(
        result({ status: "failed", measured: 9, total: 12, reason: "boom" }),
      ),
    ).toMatchObject({ kind: "failed", measured: 9, total: 12, reason: "boom" });
  });

  it("answers null for no results and keeps the order of a list", () => {
    expect(suiteStandings(undefined)).toBeNull();
    expect(
      suiteStandings([
        result({ name: "web" }),
        result({ name: "unit", status: "never", ranAt: null }),
      ])?.map(({ name, kind }) => [name, kind]),
    ).toEqual([
      ["web", "ok"],
      ["unit", "never"],
    ]);
  });
});
