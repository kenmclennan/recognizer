import { describe, expect, it } from "vitest";
import { changedKeys, type ProgressInput, progressKeys } from "./progress-keys";

function input(over: Partial<ProgressInput> = {}): ProgressInput {
  return {
    findings: {
      line: { text: "Findings are current.", link: "" },
      action: { label: "Open Scan", openScan: true },
      none: [false, true],
      everyChanged: false,
      empty: null,
    },
    overlays: {
      changed: ["a.py", "b.py"],
      groups: [
        {
          name: "mutation",
          enabled: true,
          notes: [{ text: "running 1 of 4" }],
        },
        { name: "crap", enabled: false, notes: [] },
      ],
    },
    ...over,
  };
}

function withFindings(change: Partial<ProgressInput["findings"]>) {
  return input({ findings: { ...input().findings, ...change } });
}

function withGroups(groups: ProgressInput["overlays"]["groups"]) {
  return input({ overlays: { ...input().overlays, groups } });
}

describe("progress keys", () => {
  it("is equal for two identical inputs", () => {
    expect(progressKeys(input())).toEqual(progressKeys(input()));
  });

  it("changes findings when the findings line changes", () => {
    const next = progressKeys(
      withFindings({ line: { text: "Out of date.", link: "Update" } }),
    );

    expect(next.findings).not.toBe(progressKeys(input()).findings);
    expect(next.overlays).toBe(progressKeys(input()).overlays);
  });

  it("changes findings when an action label changes", () => {
    const next = progressKeys(
      withFindings({ action: { label: "Update them", openScan: false } }),
    );

    expect(next.findings).not.toBe(progressKeys(input()).findings);
  });

  it("changes findings when a group's none flag changes", () => {
    const next = progressKeys(withFindings({ none: [true, true] }));

    expect(next.findings).not.toBe(progressKeys(input()).findings);
  });

  it("changes findings when everyChanged changes", () => {
    const next = progressKeys(withFindings({ everyChanged: true }));

    expect(next.findings).not.toBe(progressKeys(input()).findings);
  });

  it("changes overlays when a module becomes changed or unchanged", () => {
    const base = progressKeys(input());
    const more = progressKeys(
      input({ overlays: { ...input().overlays, changed: ["a.py"] } }),
    );

    expect(more.overlays).not.toBe(base.overlays);
    expect(more.findings).toBe(base.findings);
  });

  it("changes overlays when a group is enabled or disabled", () => {
    const next = progressKeys(
      withGroups([
        {
          name: "mutation",
          enabled: false,
          notes: [{ text: "running 1 of 4" }],
        },
        { name: "crap", enabled: false, notes: [] },
      ]),
    );

    expect(next.overlays).not.toBe(progressKeys(input()).overlays);
  });

  it("changes overlays when a running note's done count advances", () => {
    const next = progressKeys(
      withGroups([
        {
          name: "mutation",
          enabled: true,
          notes: [{ text: "running 2 of 4" }],
        },
        { name: "crap", enabled: false, notes: [] },
      ]),
    );

    expect(next.overlays).not.toBe(progressKeys(input()).overlays);
  });

  it("does not change overlays when only the module order differs", () => {
    const next = progressKeys(
      input({ overlays: { ...input().overlays, changed: ["b.py", "a.py"] } }),
    );

    expect(next.overlays).toBe(progressKeys(input()).overlays);
  });
});

describe("changed keys", () => {
  const base = progressKeys(input());

  it("reports both when there is no previous", () => {
    expect(changedKeys(null, base)).toEqual({ findings: true, overlays: true });
  });

  it("reports neither when equal", () => {
    expect(changedKeys(base, progressKeys(input()))).toEqual({
      findings: false,
      overlays: false,
    });
  });

  it("reports only overlays when findings are equal", () => {
    const next = progressKeys(withGroups([]));

    expect(changedKeys(base, next)).toEqual({
      findings: false,
      overlays: true,
    });
  });

  it("reports only findings when overlays are equal", () => {
    const next = progressKeys(withFindings({ everyChanged: true }));

    expect(changedKeys(base, next)).toEqual({
      findings: true,
      overlays: false,
    });
  });
});
