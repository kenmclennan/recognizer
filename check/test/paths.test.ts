import { describe, expect, it } from "vitest";
import { type Scan, shortestPath } from "../src/index.js";

const scan: Scan = {
  modules: ["s", "a", "b", "t", "lone"].map((id) => ({
    id,
    kind: "module" as const,
  })),
  edges: [
    { from: "s", to: "b", kind: "depends", line: 1 },
    { from: "s", to: "a", kind: "depends", line: 1 },
    { from: "b", to: "t", kind: "depends", line: 1, names: ["T"] },
    { from: "a", to: "t", kind: "depends", line: 1, names: ["T"] },
  ],
  foreign: [],
};
const modules = scan.modules.map((module) => module.id);

describe("shortestPath", () => {
  it("takes the lower id when two routes are equally short", () => {
    const steps = shortestPath([scan], modules, "s", "t");

    expect(steps?.map((step) => `${step.from}>${step.to}`)).toEqual([
      "s>a",
      "a>t",
    ]);
    expect(steps?.[1]).toEqual({
      from: "a",
      to: "t",
      names: ["T"],
      private: false,
      inferred: false,
    });
  });

  it("is empty from a module to itself", () => {
    expect(shortestPath([scan], modules, "s", "s")).toEqual([]);
  });

  it("is null when unreachable", () => {
    expect(shortestPath([scan], modules, "t", "s")).toBeNull();
    expect(shortestPath([scan], modules, "s", "lone")).toBeNull();
  });
});
