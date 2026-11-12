import { describe, expect, it } from "vitest";
import { runLogPath } from "./run-log-path";

describe("runLogPath", () => {
  it("builds the run record's path under the cache log folder from its id", () => {
    expect(runLogPath("x-scan")).toBe(".recognizer/cache/log/x-scan.json");
  });
});
