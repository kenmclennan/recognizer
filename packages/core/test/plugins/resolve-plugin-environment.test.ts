import { describe, expect, it } from "vitest";
import { resolvePluginEnvironment } from "../../src/index.js";

const LOGIN = { PATH: "/usr/bin:/bin", HOME: "/h" };
const FOLDER = "/t/commands";

describe("resolvePluginEnvironment", () => {
  it("puts the toolchain folder first on PATH", () => {
    const pairs = resolvePluginEnvironment({
      pairs: LOGIN,
      toolchainFolder: FOLDER,
    });

    expect(pairs.HOME).toBe("/h");
    expect(pairs.PATH).toBe("/t/commands:/usr/bin:/bin");
  });

  it("leaves the pairs unchanged with no toolchain folder", () => {
    expect(
      resolvePluginEnvironment({ pairs: LOGIN, toolchainFolder: null }),
    ).toEqual(LOGIN);
  });

  it.each([
    ["empty", { PATH: "" }],
    ["absent", {}],
  ])("uses the folder alone when the login PATH is %s", (_name, pairs) => {
    expect(
      resolvePluginEnvironment({ pairs, toolchainFolder: FOLDER }).PATH,
    ).toBe(FOLDER);
  });

  it("never carries the folder as a pair", () => {
    const pairs = resolvePluginEnvironment({
      pairs: { ...LOGIN, RECOGNIZER_TOOLCHAIN_COMMANDS: FOLDER },
      toolchainFolder: FOLDER,
    });

    expect(pairs.HOME).toBe("/h");
    expect(Object.keys(pairs)).not.toContain("RECOGNIZER_TOOLCHAIN_COMMANDS");
  });
});
