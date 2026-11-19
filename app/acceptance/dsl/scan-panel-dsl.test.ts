import { describe, expect, it } from "vitest";
import { namesIn, newWorld } from "./scan-panel-dsl";

describe("scan panel DSL", () => {
  it("an empty expected cell is an error naming the cell", () => {
    expect(() => namesIn("", "what the scan senses")).toThrow(
      'The cell for what the scan senses is empty: write "nothing" for none',
    );
  });

  it("a whitespace-only expected cell is an error naming the cell", () => {
    expect(() => namesIn("   ", "what the scan senses")).toThrow(
      'The cell for what the scan senses is empty: write "nothing" for none',
    );
  });

  it("nothing is the empty list", () => {
    expect(namesIn("nothing")).toEqual([]);
  });

  it("A and B is two names", () => {
    expect(namesIn("C.R.A.P. and Mutation")).toEqual(["C.R.A.P.", "Mutation"]);
  });

  it("an unknown describes value is an error", async () => {
    const world = newWorld();

    await world.startScan();

    expect(() => world.scan.expectDescribes("some files")).toThrow(
      "Unknown describes value some files",
    );
  });

  it("an empty describes cell is an error", async () => {
    const world = newWorld();

    await world.startScan();

    expect(() => world.scan.expectDescribes("")).toThrow(
      'The cell for what the scan describes is empty: write "nothing", "all files" or "changed files only"',
    );
  });
});
