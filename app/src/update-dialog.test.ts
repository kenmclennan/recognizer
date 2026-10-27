import { describe, expect, it } from "vitest";
import {
  canDismiss,
  dialogButtons,
  dialogError,
  dialogFromOutcome,
  dialogMessage,
} from "./update-dialog";

describe("update dialog", () => {
  it("maps each check outcome to a state", () => {
    expect(dialogFromOutcome({ kind: "found", version: "0.2.0" })).toEqual({
      kind: "found",
      version: "0.2.0",
      error: null,
    });
    expect(dialogFromOutcome({ kind: "up-to-date" })).toEqual({
      kind: "current",
    });
    expect(dialogFromOutcome({ kind: "failed", reason: "offline" })).toEqual({
      kind: "failed",
      reason: "offline",
    });
    expect(dialogFromOutcome({ kind: "installing", version: "0.2.0" })).toEqual(
      { kind: "upgrading", version: "0.2.0" },
    );
  });

  it("words every state", () => {
    expect(dialogMessage({ kind: "checking" }, "0.1.0")).toBe(
      "Checking for updates...",
    );
    expect(
      dialogMessage({ kind: "found", version: "0.2.0", error: null }, "0.1.0"),
    ).toBe("Recognizer 0.2.0 is available (you have 0.1.0)");
    expect(dialogMessage({ kind: "current" }, "0.1.0")).toBe(
      "Recognizer 0.1.0 is the latest version",
    );
    expect(dialogMessage({ kind: "failed", reason: "offline" }, "0.1.0")).toBe(
      "Couldn't check for updates: offline",
    );
    expect(
      dialogMessage({ kind: "upgrading", version: "0.2.0" }, "0.1.0"),
    ).toBe("Downloading Recognizer 0.2.0...");
  });

  it("offers Upgrade only when found and no buttons while upgrading", () => {
    expect(dialogButtons({ kind: "checking" })).toEqual(["close"]);
    expect(
      dialogButtons({ kind: "found", version: "0.2.0", error: null }),
    ).toEqual(["upgrade", "close"]);
    expect(dialogButtons({ kind: "current" })).toEqual(["close"]);
    expect(dialogButtons({ kind: "failed", reason: "x" })).toEqual(["close"]);
    expect(dialogButtons({ kind: "upgrading", version: "0.2.0" })).toEqual([]);
  });

  it("blocks dismissal only while upgrading", () => {
    expect(canDismiss({ kind: "upgrading", version: "0.2.0" })).toBe(false);
    expect(canDismiss({ kind: "checking" })).toBe(true);
    expect(canDismiss({ kind: "found", version: "0.2.0", error: "boom" })).toBe(
      true,
    );
  });

  it("exposes the install error on a found state", () => {
    expect(
      dialogError({ kind: "found", version: "0.2.0", error: "disk full" }),
    ).toBe("disk full");
    expect(dialogError({ kind: "current" })).toBeNull();
  });
});
