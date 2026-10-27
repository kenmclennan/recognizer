import { describe, expect, it } from "vitest";
import { checkState, nextCheck } from "./row-model";

const on = new Set(["a", "b"]);
const isOpen = (id: string) => on.has(id);

describe("checkState", () => {
  it("is unchecked when none of the files is on the canvas", () => {
    expect(checkState(["x", "y"], isOpen)).toBe("unchecked");
  });

  it("is partial when some of the files are on the canvas", () => {
    expect(checkState(["a", "x"], isOpen)).toBe("partial");
  });

  it("is checked when every file is on the canvas", () => {
    expect(checkState(["a", "b"], isOpen)).toBe("checked");
  });

  it("is unchecked for an empty list", () => {
    expect(checkState([], isOpen)).toBe("unchecked");
  });
});

describe("nextCheck", () => {
  it("takes off only from the checked state, so a partial click completes the set", () => {
    expect(nextCheck("checked")).toBe("takeOff");
    expect(nextCheck("partial")).toBe("putOn");
    expect(nextCheck("unchecked")).toBe("putOn");
  });
});
