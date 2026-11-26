import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { machineSetting } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { appConfigDir, readDescribing } from "../src/app-settings.js";
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

const DESCRIBER = {
  command: [
    "node",
    join(REPO, "packages/cli/test/fixtures/fake-describer.mjs"),
    "run",
    "{request}",
  ],
};

const BARE = {
  command: [
    "node",
    join(REPO, "packages/cli/test/fixtures/fake-describer-no-model.mjs"),
    "run",
    "{request}",
  ],
};

const batch = machineSetting("describing.batch_size");
const spend = machineSetting("describing.confirm_above_usd");

function read(directory: string, describer = DESCRIBER) {
  return readDescribing(ioFor(directory), describer, directory);
}

describe("readDescribing", () => {
  it("reads the describer's published model and core's defaults from an empty folder and writes nothing", () => {
    const directory = makeTempDir("recognizer-settings-");
    const result = read(directory);

    expect(result.model).toBe("fake-default");
    expect(result.batch_size).toBe(batch.default);
    expect(result.confirm_above_usd).toBe(spend.default);
    expect(result.prices?.opus).toEqual({ input: 4, output: 20 });
    expect(existsSync(configIn(directory))).toBe(false);
    expect(existsSync(`${configIn(directory)}.tmp`)).toBe(false);
  });

  it("returns what the file holds without rewriting it", () => {
    const directory = makeTempDir("recognizer-settings-");
    const text = JSON.stringify({
      describing: { model: "opus", batch_size: 8 },
    });

    writeFileSync(configIn(directory), text);

    expect(read(directory)).toMatchObject({
      model: "opus",
      batch_size: 8,
      confirm_above_usd: spend.default,
    });
    expect(readFileSync(configIn(directory), "utf8")).toBe(text);
  });

  it("keeps a stored model and reads a missing threshold as core's default", () => {
    const directory = makeTempDir("recognizer-settings-");

    writeFileSync(
      configIn(directory),
      JSON.stringify({ describing: { model: "sonnet", batch_size: 2 } }),
    );

    expect(read(directory)).toMatchObject({
      model: "sonnet",
      batch_size: 2,
      confirm_above_usd: spend.default,
    });
  });

  it("fails naming describing.model when nothing stores a model and the describer publishes none", () => {
    const directory = makeTempDir("recognizer-settings-");

    expect(() => read(directory, BARE)).toThrow(/describing\.model/);

    writeFileSync(
      configIn(directory),
      JSON.stringify({ describing: { model: "opus" } }),
    );

    expect(read(directory, BARE).model).toBe("opus");
  });

  it.each([0, 10000, 0.5])("accepts a threshold of %s", (amount) => {
    const directory = makeTempDir("recognizer-settings-");

    writeFileSync(
      configIn(directory),
      JSON.stringify({
        describing: {
          model: "haiku",
          batch_size: 4,
          confirm_above_usd: amount,
        },
      }),
    );

    expect(read(directory).confirm_above_usd).toBe(amount);
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
    ["confirm_above_usd", { model: "a", batch_size: 4, confirm_above_usd: -1 }],
    [
      "confirm_above_usd",
      { model: "a", batch_size: 4, confirm_above_usd: "5" },
    ],
    [
      "confirm_above_usd",
      { model: "a", batch_size: 4, confirm_above_usd: null },
    ],
    [
      "confirm_above_usd",
      { model: "a", batch_size: 4, confirm_above_usd: 10001 },
    ],
  ])("rejects a bad %s", (key, describing) => {
    const directory = makeTempDir("recognizer-settings-");

    writeFileSync(configIn(directory), JSON.stringify({ describing }));

    expect(() => read(directory)).toThrow(new RegExp(`describing\\.${key}`));
  });

  it("rejects a describing that is not an object and a file that is not JSON", () => {
    const directory = makeTempDir("recognizer-settings-");

    writeFileSync(configIn(directory), JSON.stringify({ describing: 3 }));

    expect(() => read(directory)).toThrow(/describing/);

    writeFileSync(configIn(directory), "not json");

    expect(() => read(directory)).toThrow(/not valid JSON/);
  });
});
