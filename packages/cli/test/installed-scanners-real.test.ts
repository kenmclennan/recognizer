import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registrationFileName, serializeRegistration } from "@recognizer/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { installedScanners } from "../src/adapters/plugins/installed-scanners.js";
import { nodeIo } from "../src/cli.js";
import { REPO } from "./helpers.js";

const saved = process.env.RECOGNIZER_PLUGIN_DIRS;

afterEach(() => {
  if (saved === undefined) {
    delete process.env.RECOGNIZER_PLUGIN_DIRS;
  } else {
    process.env.RECOGNIZER_PLUGIN_DIRS = saved;
  }
});

describe("installed scanners cache over the real typescript scanner", () => {
  it("registers_the_in_tree_typescript_scanner_and_holds_its_manifest", () => {
    const directory = makeTempDir("installed-scanners-real-");
    const counter = join(directory, "runs");
    const launcher = join(directory, "recognizer-scan-typescript");

    writeFileSync(counter, "");
    writeFileSync(
      launcher,
      `#!/bin/sh\necho "$1" >> ${counter}\nexec node ${REPO}/packages/scanners/typescript/dist/bin.js "$@"\n`,
    );
    chmodSync(launcher, 0o755);
    writeFileSync(
      join(directory, registrationFileName("scanner", "typescript")),
      serializeRegistration({
        kind: "scanner",
        name: "typescript",
        command: [launcher],
        manifest: [launcher, "manifest"],
      }),
    );
    process.env.RECOGNIZER_PLUGIN_DIRS = directory;

    const io = nodeIo();
    const runs = () =>
      readFileSync(counter, "utf8")
        .split("\n")
        .filter((line) => line === "manifest").length;

    expect(installedScanners(io).plugins.map((p) => p.name)).toEqual([
      "typescript",
    ]);

    const after = runs();

    expect(after).toBeGreaterThan(0);
    expect(installedScanners(io).plugins).toHaveLength(1);
    expect(runs()).toBe(after);
  });
});
