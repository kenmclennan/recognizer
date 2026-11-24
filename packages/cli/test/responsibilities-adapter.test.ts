import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { InvalidRequest, Responsibilities } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { ResponsibilitiesAdapter } from "../src/adapters/filesystem/responsibilities-adapter.js";
import { nodeIo } from "../src/cli.js";
import { REPO } from "./helpers.js";

const EXAMPLES = join(REPO, "schema/responsibilities-examples");

function rootWith(text: string | null): string {
  const root = makeTempDir("recognizer-responsibilities-");

  mkdirSync(join(root, ".recognizer"), { recursive: true });

  if (text !== null) {
    nodeIo().writeFile(join(root, ".recognizer/responsibilities.json"), text);
  }

  return root;
}

describe("the responsibilities adapter", () => {
  it("reads an empty set when the file is absent", () => {
    const adapter = new ResponsibilitiesAdapter(nodeIo());

    expect(adapter.read(rootWith(null)).ids()).toEqual([]);
  });

  it.each(readdirSync(join(EXAMPLES, "valid")))("reads %s", (file) => {
    const root = rootWith(readFileSync(join(EXAMPLES, "valid", file), "utf8"));
    const lines = new ResponsibilitiesAdapter(nodeIo()).read(root);

    expect(lines.ids()).toHaveLength(file === "one.json" ? 1 : 0);
  });

  it.each(readdirSync(join(EXAMPLES, "invalid")))("refuses %s", (file) => {
    const root = rootWith(
      readFileSync(join(EXAMPLES, "invalid", file), "utf8"),
    );
    const read = () => new ResponsibilitiesAdapter(nodeIo()).read(root);

    expect(read).toThrow(InvalidRequest);
    expect(read).toThrow(/^responsibilities/);
  });

  it("refuses text that is not JSON", () => {
    const root = rootWith("{nope");

    expect(() => new ResponsibilitiesAdapter(nodeIo()).read(root)).toThrow(
      /^responsibilities is not valid JSON: /,
    );
  });

  it("writes sorted ids, ordered keys, two-space indent and a trailing newline through a rename", () => {
    const root = rootWith(null);
    const adapter = new ResponsibilitiesAdapter(nodeIo());
    const lines = new Responsibilities();
    const hash = "a".repeat(64);

    lines.set("b.py", {
      line: "Second.",
      sourceHash: hash,
      describer: ["d", "{request}"],
      version: "v1",
    });
    lines.set("a.py", {
      line: "First.",
      sourceHash: hash,
      describer: ["d", "{request}"],
      version: "v1",
    });
    adapter.write(root, lines);

    const entry = (line: string) =>
      `      "line": "${line}",\n      "source_hash": "${hash}",\n      "describer": [\n        "d",\n        "{request}"\n      ],\n      "version": "v1"\n`;

    expect(
      readFileSync(join(root, ".recognizer/responsibilities.json"), "utf8"),
    ).toBe(
      `{\n  "schema_version": 1,\n  "modules": {\n    "a.py": {\n${entry("First.")}    },\n    "b.py": {\n${entry("Second.")}    }\n  }\n}\n`,
    );
    expect(
      existsSync(join(root, ".recognizer/responsibilities.json.tmp")),
    ).toBe(false);
    expect(adapter.read(root).ids()).toEqual(["a.py", "b.py"]);
  });
});
