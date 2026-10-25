import { describe, expect, it } from "vitest";
import { updateLabel } from "./update-label";

describe("updateLabel", () => {
  it("offers the install when an update is available", () => {
    expect(
      updateLabel("Recognizer", { kind: "available", version: "0.2.0" }),
    ).toBe("Recognizer 0.2.0 available - Install");
  });

  it("says it is installing", () => {
    expect(
      updateLabel("Recognizer", { kind: "installing", version: "0.2.0" }),
    ).toBe("Installing Recognizer 0.2.0...");
  });

  it("is empty when there is no update", () => {
    expect(updateLabel("Recognizer", { kind: "none" })).toBe("");
  });
});
