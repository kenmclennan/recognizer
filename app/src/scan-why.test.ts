import { describe, expect, it } from "vitest";
import { whyOf } from "./scan-why";

describe("whyOf", () => {
  it("points at the log exactly when the diagnosis has no fix", () => {
    expect(whyOf({ code: "custom-code", line: "No report" }).log).toBe(true);
    expect(
      whyOf({ code: "custom-code", line: "No report", fix: "run it" }).log,
    ).toBe(false);
  });

  it("points tests-failed at the log when it has no fix", () => {
    expect(
      whyOf({
        code: "tests-failed",
        line: "3 tests failed",
        failing: { count: 3, names: ["t::a"] },
      }),
    ).toMatchObject({ copy: null, log: true });
  });

  it("offers the fix to copy and marks it and the first failing name as code", () => {
    const why = whyOf({
      code: "custom-code",
      line: "Needs pytest-cov. Add it with uv add pytest-cov",
      fix: "uv add pytest-cov",
      failing: { names: ["t::a"] },
    });

    expect(why.copy).toBe("uv add pytest-cov");
    expect(why.segments).toContainEqual({
      text: "uv add pytest-cov",
      code: true,
    });
  });

  it("ends the line with a full stop once", () => {
    expect(whyOf({ code: "custom-code", line: "Stop." }).segments).toEqual([
      { text: "Stop.", code: false },
    ]);
    expect(whyOf({ code: "custom-code", line: "Stop" }).segments).toEqual([
      { text: "Stop.", code: false },
    ]);
  });
});
