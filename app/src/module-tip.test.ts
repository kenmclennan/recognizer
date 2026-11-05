import { describe, expect, it } from "vitest";
import { descriptionOf } from "./module-tip";

describe("descriptionOf", () => {
  it("shows a current line", () => {
    expect(descriptionOf({ kind: "current", line: "Does it." })).toBe(
      "Does it.",
    );
  });

  it("hides a line whose module source changed", () => {
    expect(
      descriptionOf({
        kind: "out-of-date",
        line: "Does it.",
        reasons: ["source"],
      }),
    ).toBeNull();
    expect(
      descriptionOf({
        kind: "out-of-date",
        line: "Does it.",
        reasons: ["describer", "source"],
      }),
    ).toBeNull();
  });

  it("shows a line out of date only because the describer or version changed", () => {
    expect(
      descriptionOf({
        kind: "out-of-date",
        line: "Does it.",
        reasons: ["describer", "version"],
      }),
    ).toBe("Does it.");
  });

  it("shows nothing for a missing, unknown or empty line", () => {
    expect(descriptionOf({ kind: "missing" })).toBeNull();
    expect(descriptionOf({ kind: "unknown" })).toBeNull();
    expect(descriptionOf({ kind: "current", line: "" })).toBeNull();
  });
});
