import { unregisteredWarning } from "recognizer";
import { describe, expect, it } from "vitest";
import { unregisteredNotices } from "./unregistered-notice";

const CRAP = "sensors:\n  crap: {}\n";

describe("unregisteredNotices", () => {
  it("names the unregistered sensors and the shipped describer only", () => {
    expect(
      unregisteredNotices(
        CRAP,
        { sense: ["crap", "mutation"], describe: true },
        "shipped",
      ),
    ).toEqual([
      {
        key: "unregistered:mutation",
        text: unregisteredWarning("mutation"),
      },
      { key: "unregistered:claude", text: unregisteredWarning("claude") },
    ]);
  });

  it("gives none for the describer when it is registered", () => {
    expect(
      unregisteredNotices(CRAP, { sense: ["crap"], describe: true }, "config"),
    ).toEqual([]);
  });

  it("gives none for the describer when the plan does not describe", () => {
    expect(
      unregisteredNotices(CRAP, { sense: [], describe: false }, "shipped"),
    ).toEqual([]);
  });

  it("treats a missing config as registering nothing", () => {
    expect(
      unregisteredNotices(null, { sense: ["crap"], describe: false }, null),
    ).toEqual([
      { key: "unregistered:crap", text: unregisteredWarning("crap") },
    ]);
  });

  it("gives none for an unparseable config", () => {
    expect(
      unregisteredNotices(
        "sensors: [",
        { sense: ["crap"], describe: true },
        "shipped",
      ),
    ).toEqual([]);
  });
});
