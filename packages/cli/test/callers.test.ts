import { describe, expect, it } from "vitest";
import { buildCallerIndex, type Scan } from "../src/index.js";

const scan: Scan = {
  modules: ["m/api.py", "m/impl.py", "m/use.py"].map((id) => ({
    id,
    kind: "module" as const,
  })),
  edges: [],
  calls: [
    { from: "m/use.py::go", to: "m/api.py::Api.run", line: 1, how: "inferred" },
    {
      from: "m/api.py::Api.run",
      to: "m/impl.py::Impl.run",
      line: 1,
      how: "dispatch",
    },
    {
      from: "m/use.py::make",
      to: "m/impl.py::Impl",
      line: 2,
      how: "construct",
    },
  ],
  foreign: [],
};

describe("buildCallerIndex", () => {
  const index = buildCallerIndex([scan]);

  it("reaches an implementation through its abstraction", () => {
    expect(index.of("m/impl.py", "Impl.run").callers).toEqual([
      { module: "m/use.py", through: "Api" },
    ]);
  });

  it("records construction", () => {
    expect(index.of("m/impl.py", "Impl").constructed).toBe(true);
    expect(index.of("m/impl.py", "Impl.run").constructed).toBe(false);
  });

  it("does not know modules of a scan without calls", () => {
    expect(
      buildCallerIndex([{ ...scan, calls: undefined }]).known("m/api.py"),
    ).toBe(false);
    expect(index.known("m/api.py")).toBe(true);
  });
});
