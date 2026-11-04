import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import {
  appConfigDir,
  DESCRIBING_DEFAULTS,
  readDescribing,
} from "../src/app-settings.js";
import { type Io, nodeIo } from "../src/cli.js";
import { REPO } from "./helpers.js";

function ioFor(directory: string, home = "/home/someone"): Io {
  return {
    ...nodeIo(),
    env: (name) =>
      name === "RECOGNIZER_APP_CONFIG_DIR"
        ? directory
        : name === "HOME"
          ? home
          : undefined,
  };
}

function configIn(directory: string): string {
  return join(directory, "config.json");
}

describe("appConfigDir", () => {
  it("is the override when set and the application support folder otherwise", () => {
    expect(appConfigDir(ioFor("/somewhere"))).toBe("/somewhere");
    expect(
      appConfigDir({
        ...nodeIo(),
        env: (name) => (name === "HOME" ? "/h" : ""),
      }),
    ).toBe("/h/Library/Application Support/com.kenmclennan.recognizer");
  });
});

describe("readDescribing", () => {
  it("writes the seed into an empty folder and returns it", () => {
    const directory = makeTempDir("recognizer-settings-");

    expect(readDescribing(ioFor(directory))).toEqual({
      model: "sonnet",
      batch_size: 4,
    });
    expect(JSON.parse(readFileSync(configIn(directory), "utf8"))).toEqual({
      describing: { model: "sonnet", batch_size: 4 },
    });
    expect(existsSync(`${configIn(directory)}.tmp`)).toBe(false);
  });

  it("adds the seed to a file holding other keys and keeps them", () => {
    const directory = makeTempDir("recognizer-settings-");

    writeFileSync(
      configIn(directory),
      JSON.stringify({ editor: "code", unknown: [1, 2] }),
    );
    readDescribing(ioFor(directory));

    expect(JSON.parse(readFileSync(configIn(directory), "utf8"))).toEqual({
      editor: "code",
      unknown: [1, 2],
      describing: { model: "sonnet", batch_size: 4 },
    });
  });

  it("returns what the file holds without rewriting it", () => {
    const directory = makeTempDir("recognizer-settings-");
    const text = JSON.stringify({
      describing: { model: "opus", batch_size: 8 },
    });

    writeFileSync(configIn(directory), text);

    expect(readDescribing(ioFor(directory))).toEqual({
      model: "opus",
      batch_size: 8,
    });
    expect(readFileSync(configIn(directory), "utf8")).toBe(text);
  });

  it.each([
    ["model", { model: "-x", batch_size: 4 }],
    ["model", { model: "a b", batch_size: 4 }],
    ["model", { model: "", batch_size: 4 }],
    ["model", { model: 3, batch_size: 4 }],
    ["batch_size", { model: "sonnet", batch_size: 0 }],
    ["batch_size", { model: "sonnet", batch_size: 17 }],
    ["batch_size", { model: "sonnet", batch_size: 2.5 }],
    ["batch_size", { model: "sonnet", batch_size: "4" }],
  ])("rejects a bad %s", (key, describing) => {
    const directory = makeTempDir("recognizer-settings-");

    writeFileSync(configIn(directory), JSON.stringify({ describing }));

    expect(() => readDescribing(ioFor(directory))).toThrow(
      new RegExp(`describing\\.${key}`),
    );
  });

  it("rejects a describing that is not an object and a file that is not JSON", () => {
    const directory = makeTempDir("recognizer-settings-");

    writeFileSync(configIn(directory), JSON.stringify({ describing: 3 }));

    expect(() => readDescribing(ioFor(directory))).toThrow(/describing/);

    writeFileSync(configIn(directory), "not json");

    expect(() => readDescribing(ioFor(directory))).toThrow(/not valid JSON/);
  });

  it("equals the shared seed fixture", () => {
    expect(
      JSON.parse(
        readFileSync(
          join(REPO, "fixtures/settings/describing-defaults.json"),
          "utf8",
        ),
      ),
    ).toEqual(DESCRIBING_DEFAULTS);
  });
});
