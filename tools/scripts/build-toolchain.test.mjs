import {
  chmodSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  archiveEntries,
  COMMAND_LINKS,
  verifyArchive,
  writeCommandLinks,
} from "./build-toolchain.mjs";
import { makeTempDir } from "./temp-dirs.mjs";
import { verifyCommands } from "./verify-toolchain.mjs";

const closure = ["node_modules/ajv", "node_modules/yaml"];

describe("archiveEntries", () => {
  it("names the vendored packages, the installed Python folder, the wrappers, the notices and the licence", () => {
    expect(archiveEntries(closure)).toEqual([
      "node_modules/recognizer/package.json",
      "node_modules/recognizer/grammars/python.wasm",
      "node_modules/recognizer/grammars/typescript.wasm",
      "node_modules/recognizer/grammars/tsx.wasm",
      "node_modules/recognizer/grammars/kotlin.wasm",
      "node_modules/recognizer/grammars/rust.wasm",
      "node_modules/recognizer/grammars/csharp.wasm",
      "node_modules/recognizer/grammars/PROVENANCE.json",
      "node_modules/ajv/package.json",
      "node_modules/yaml/package.json",
      "commands/recognizer",
      "THIRD-PARTY-NOTICES.md",
      "LICENSE",
    ]);
  });
});

describe("the commands folder", () => {
  function lay(folder) {
    for (const [, target] of COMMAND_LINKS) {
      const real = join(folder, target.replace("../", ""));

      mkdirSync(dirname(real), { recursive: true });
      writeFileSync(real, "#!/bin/sh\n");
      chmodSync(real, 0o755);
    }
  }

  it("holds the one command as a link that resolves to an executable inside the folder", () => {
    const folder = makeTempDir("commands-");

    lay(folder);
    writeCommandLinks(folder);

    expect(readdirSync(join(folder, "commands")).sort()).toEqual([
      "recognizer",
    ]);
    expect(COMMAND_LINKS).toHaveLength(1);
    expect(() => verifyCommands(folder)).not.toThrow();
  });

  it("fails verification when an entry is missing or points outside", () => {
    const folder = makeTempDir("commands-bad-");
    const outside = makeTempDir("commands-out-");

    writeFileSync(join(outside, "tool"), "#!/bin/sh\n");
    chmodSync(join(outside, "tool"), 0o755);
    lay(folder);
    writeCommandLinks(folder);
    rmSync(join(folder, "commands/recognizer"));

    expect(() => verifyCommands(folder)).toThrow(
      /recognizer is missing or not executable/,
    );

    symlinkSync(join(outside, "tool"), join(folder, "commands/recognizer"));

    expect(() => verifyCommands(folder)).toThrow(
      /recognizer points outside the toolchain/,
    );
  });
});

describe("verifyArchive", () => {
  const entries = archiveEntries(closure);
  const full = `${entries.join("\n")}\n`;

  it("accepts a complete listing", () => {
    expect(() => verifyArchive(full, closure)).not.toThrow();
  });

  it("accepts a listing whose names carry a leading ./", () => {
    const listing = entries.map((name) => `./${name}`).join("\n");

    expect(() => verifyArchive(listing, closure)).not.toThrow();
  });

  it.each([
    [
      "the CLI",
      "node_modules/recognizer/package.json\n",
      /node_modules\/recognizer\/package\.json/,
    ],
    ["the recognizer link", "commands/recognizer\n", /commands\/recognizer/],
    ["the notices file", "THIRD-PARTY-NOTICES.md\n", /THIRD-PARTY-NOTICES\.md/],
    [
      "a vendored source grammar",
      "node_modules/recognizer/grammars/kotlin.wasm\n",
      /grammars\/kotlin\.wasm/,
    ],
    [
      "a closure package",
      "node_modules/yaml/package.json\n",
      /node_modules\/yaml/,
    ],
  ])("fails when %s is missing", (_, entry, pattern) => {
    expect(() => verifyArchive(full.replace(entry, ""), closure)).toThrow(
      pattern,
    );
  });
});
