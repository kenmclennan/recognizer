import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { InstalledPlugin } from "../src/plugin-discovery.js";
import { chooseScanner } from "../src/scanners.js";

function scanner(name: string, languages: string[]): InstalledPlugin {
  return {
    kind: "scanner",
    name,
    command: `/bin/recognizer-scan-${name}`,
    judgement: "current",
    manifest: {
      kind: "scanner",
      name,
      display: name,
      version: "1",
      protocol: 1,
      install: `install ${name}`,
      check: false,
      long_running: false,
      units: [],
      settings: [],
      languages: languages.map((language) => ({
        name: language,
        extensions: [],
        files: [],
        skip: {},
      })),
    },
  };
}

const PYTHON = scanner("python", ["python"]);
const ALT = scanner("python-alt", ["python"]);
const KOTLIN = scanner("kotlin", ["kotlin"]);

describe("chooseScanner", () => {
  it("is not-installed when no scanner claims the language and nothing is named", () => {
    expect(chooseScanner("swift", [PYTHON], undefined)).toMatchObject({
      ok: false,
      reason: "not-installed",
    });
  });

  it("is not-installed when the config names a scanner and none is installed", () => {
    expect(chooseScanner("swift", [], "swift")).toMatchObject({
      ok: false,
      reason: "not-installed",
    });
  });

  it("is the one scanner that claims the language", () => {
    expect(chooseScanner("python", [PYTHON, KOTLIN], undefined)).toEqual({
      ok: true,
      scanner: PYTHON,
    });
  });

  it("is ambiguous-scanner with both claimants listed when two claim it", () => {
    expect(chooseScanner("python", [PYTHON, ALT], undefined)).toMatchObject({
      ok: false,
      reason: "ambiguous-scanner",
      claimants: ["python", "python-alt"],
    });
  });

  it.each(["python", "python-alt"])(
    "is the claimant %s the config names when two claim the language",
    (named) => {
      const choice = chooseScanner("python", [PYTHON, ALT], named);

      expect(choice).toMatchObject({ ok: true });
      expect(choice.ok && choice.scanner.name).toBe(named);
    },
  );

  it("is the named claimant even when another is the only other claimant", () => {
    const choice = chooseScanner("python", [PYTHON, ALT, KOTLIN], "python-alt");

    expect(choice.ok && choice.scanner.name).toBe("python-alt");
  });

  it("is invalid-choice when the config names an installed scanner that does not claim the language", () => {
    expect(chooseScanner("python", [PYTHON, KOTLIN], "kotlin")).toMatchObject({
      ok: false,
      reason: "invalid-choice",
    });
  });

  it("is not-installed when the config names a scanner that is not installed", () => {
    expect(chooseScanner("python", [PYTHON], "python-alt")).toMatchObject({
      ok: false,
      reason: "not-installed",
    });
  });
});

describe("the scanner install hints", () => {
  it("leave no cargo, pipx or uvx hint in the source", () => {
    const repo = fileURLToPath(new URL("../..", import.meta.url));
    const result = spawnSync(
      "grep",
      [
        "-rn",
        "--exclude-dir=generated",
        "-E",
        "cargo install|pipx|uvx",
        "check/src",
      ],
      { cwd: repo, encoding: "utf8" },
    );

    expect(result.stdout).toBe("");
  });
});
