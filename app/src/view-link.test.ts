import { describe, expect, it } from "vitest";
import { resolveLinkedView } from "./view-link";

describe("resolveLinkedView", () => {
  it("opens a listed view", () => {
    expect(resolveLinkedView(["overview", "api"], "api")).toEqual({
      open: "api",
    });
  });

  it("refuses an unlisted view naming it", () => {
    expect(resolveLinkedView(["overview"], "gone")).toEqual({
      refuse: "gone is not a saved view in this repository",
    });
  });

  it("refuses every view when none are saved", () => {
    expect(resolveLinkedView([], "overview")).toEqual({
      refuse: "overview is not a saved view in this repository",
    });
  });
});
