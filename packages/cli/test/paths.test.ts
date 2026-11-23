import { Neighbours } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { repositoryFrom } from "./repository-from.js";

const scan = repositoryFrom({
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
});
const modules = scan.files.map((file) => file.path);

describe("shortestPath", () => {
  it("takes the lower id when two routes are equally short", () => {
    const steps = new Neighbours(scan, modules).shortestPath("s", "t");

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
    expect(new Neighbours(scan, modules).shortestPath("s", "s")).toEqual([]);
  });

  it("is null when unreachable", () => {
    expect(new Neighbours(scan, modules).shortestPath("t", "s")).toBeNull();
    expect(new Neighbours(scan, modules).shortestPath("s", "lone")).toBeNull();
  });
});
