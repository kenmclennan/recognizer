import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nodeIo, run } from "../src/cli.js";
import { type FakeOptions, fakeIo, ROOT } from "./scan-helpers.js";

const HOME = "/home/ken";
const USER_BUNDLE = `${HOME}/Applications/Recognizer.app`;
const SYSTEM_BUNDLE = "/Applications/Recognizer.app";

function bundle(
  path: string,
  ...executables: string[]
): Record<string, string> {
  return Object.fromEntries(
    executables.map((name) => [`${path}/Contents/MacOS/${name}`, ""]),
  );
}

function open(options: FakeOptions, ...args: string[]) {
  const fake = fakeIo({ env: { HOME }, ...options });
  const code = run(["open", ...args], fake.io);

  return { code, fake, err: fake.err() };
}

describe("recognizer open", () => {
  it("launches the user's bundle with the absolute folder", () => {
    const { code, fake } = open(
      { files: bundle(USER_BUNDLE, "recognizer_app") },
      ROOT,
    );

    expect(code).toBe(0);
    expect(fake.launches).toEqual([
      { command: `${USER_BUNDLE}/Contents/MacOS/recognizer_app`, args: [ROOT] },
    ]);
  });

  it("falls back to /Applications when the user has no bundle", () => {
    const { code, fake } = open(
      { files: bundle(SYSTEM_BUNDLE, "recognizer_app") },
      ROOT,
    );

    expect(code).toBe(0);
    expect(fake.launches[0]?.command).toBe(
      `${SYSTEM_BUNDLE}/Contents/MacOS/recognizer_app`,
    );
  });

  it("prefers RECOGNIZER_APP over both locations", () => {
    const custom = "/opt/Custom.app";
    const { code, fake } = open(
      {
        env: { HOME, RECOGNIZER_APP: custom },
        files: {
          ...bundle(USER_BUNDLE, "recognizer_app"),
          ...bundle(SYSTEM_BUNDLE, "recognizer_app"),
          ...bundle(custom, "viewer"),
        },
      },
      ROOT,
    );

    expect(code).toBe(0);
    expect(fake.launches[0]?.command).toBe(`${custom}/Contents/MacOS/viewer`);
  });

  it("treats an empty RECOGNIZER_APP as unset", () => {
    const { code, fake } = open(
      {
        env: { HOME, RECOGNIZER_APP: "" },
        files: bundle(USER_BUNDLE, "recognizer_app"),
      },
      ROOT,
    );

    expect(code).toBe(0);
    expect(fake.launches).toHaveLength(1);
  });

  it("exits 1 with the install hint when no bundle exists", () => {
    const { code, fake, err } = open({}, ROOT);

    expect(code).toBe(1);
    expect(err).toContain("npm run install-app");
    expect(fake.launches).toEqual([]);
  });

  it("exits 1 when RECOGNIZER_APP names a missing bundle", () => {
    const { code, fake, err } = open(
      {
        env: { HOME, RECOGNIZER_APP: "/opt/Gone.app" },
        files: bundle(USER_BUNDLE, "recognizer_app"),
      },
      ROOT,
    );

    expect(code).toBe(1);
    expect(err).toContain("npm run install-app");
    expect(fake.launches).toEqual([]);
  });

  it("exits 2 when the folder is not a directory", () => {
    const { code, fake, err } = open(
      { files: bundle(USER_BUNDLE, "recognizer_app") },
      "/nowhere",
    );

    expect(code).toBe(2);
    expect(err).toContain("folder is not a directory: /nowhere");
    expect(fake.launches).toEqual([]);
  });

  it("defaults the folder to the current directory, resolved", () => {
    const current = resolve(".");
    const { code, fake } = open({
      files: {
        ...bundle(USER_BUNDLE, "recognizer_app"),
        [`${current}/.keep`]: "",
      },
    });

    expect(code).toBe(0);
    expect(fake.launches[0]?.args).toEqual([current]);
  });

  it("exits 1 when Contents/MacOS holds two entries", () => {
    const { code, fake, err } = open(
      { files: bundle(USER_BUNDLE, "one", "two") },
      ROOT,
    );

    expect(code).toBe(1);
    expect(err).toContain(USER_BUNDLE);
    expect(fake.launches).toEqual([]);
  });

  it("exits 2 when RECOGNIZER_APP is relative", () => {
    const { code, fake, err } = open(
      {
        env: { HOME, RECOGNIZER_APP: "Recognizer.app" },
        files: bundle(USER_BUNDLE, "recognizer_app"),
      },
      ROOT,
    );

    expect(code).toBe(2);
    expect(err).toContain("RECOGNIZER_APP");
    expect(fake.launches).toEqual([]);
  });

  it("exits 1 with the reason when the launch fails", () => {
    const { code, err } = open(
      {
        files: bundle(USER_BUNDLE, "recognizer_app"),
        launchFails: "spawn denied",
      },
      ROOT,
    );

    expect(code).toBe(1);
    expect(err).toContain("spawn denied");
  });

  describe("with a link", () => {
    const repo = "/work/app";
    const files = {
      ...bundle(USER_BUNDLE, "recognizer_app"),
      [`${repo}/.recognizer/views/overview.json`]: "{}",
    };
    const good = "recognizer://open?repo=%2Fwork%2Fapp&view=overview";

    it("launches the bundle with exactly the link", () => {
      const { code, fake } = open({ files }, good);

      expect(code).toBe(0);
      expect(fake.launches).toEqual([
        {
          command: `${USER_BUNDLE}/Contents/MacOS/recognizer_app`,
          args: [good],
        },
      ]);
    });

    it("launches a link with no view", () => {
      const link = "recognizer://open?repo=%2Fwork%2Fapp";
      const { code, fake } = open({ files }, link);

      expect(code).toBe(0);
      expect(fake.launches[0]?.args).toEqual([link]);
    });

    it.each([
      ["a missing folder", "recognizer://open?repo=%2Fnowhere", "/nowhere"],
      [
        "a view that is not saved there",
        "recognizer://open?repo=%2Fwork%2Fapp&view=other",
        "other is not a saved view",
      ],
      [
        "a relative path",
        "recognizer://open?repo=work%2Fapp",
        "must be an absolute path",
      ],
      [
        "an unknown parameter",
        "recognizer://open?repo=%2Fwork%2Fapp&run=1",
        "unknown parameter run",
      ],
    ])("exits 2 without launching for %s", (_name, link, message) => {
      const { code, fake, err } = open({ files }, link);

      expect(code).toBe(2);
      expect(err).toContain("link refused");
      expect(err).toContain(message);
      expect(fake.launches).toEqual([]);
    });

    it("refuses a bad link before looking for the bundle", () => {
      const { code, err } = open({ files: {} }, "recognizer://open?repo=x");

      expect(code).toBe(2);
      expect(err).not.toContain("npm run install-app");
    });

    it("keeps the install hint for a valid link with no bundle", () => {
      const { code, err } = open(
        { files: { [`${repo}/.recognizer/views/overview.json`]: "{}" } },
        good,
      );

      expect(code).toBe(1);
      expect(err).toContain("npm run install-app");
    });

    it("refuses a view missing from the repository's own fixtures/check", () => {
      const fixture = resolve(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "fixtures",
        "check",
      );
      const errors: string[] = [];
      const code = run(
        [
          "open",
          `recognizer://open?repo=${encodeURIComponent(fixture)}&view=overview`,
        ],
        { ...nodeIo(), stderr: (text) => errors.push(text) },
      );

      expect(code).toBe(2);
      expect(errors.join("")).toContain("overview is not a saved view");
    });
  });
});
