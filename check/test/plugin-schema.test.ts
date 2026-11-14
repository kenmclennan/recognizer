import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { SCHEMA_NAMES } from "../src/plugin-schema.js";
import { capture, REPO } from "./helpers.js";

const NAMES = ["manifest", "events", "scan", "findings", "overlay", "check"];

describe("recognizer plugin schema", () => {
  it("knows the six names", () => {
    expect(SCHEMA_NAMES).toEqual(NAMES);
  });

  it.each(NAMES)("prints the committed %s schema", (name) => {
    const captured = capture();
    const status = run(["plugin", "schema", name], captured.io);
    const committed = JSON.parse(
      readFileSync(join(REPO, "schema", `${name}.schema.json`), "utf8"),
    ) as unknown;

    expect(status).toBe(0);
    expect(JSON.parse(captured.out())).toEqual(committed);
    expect(captured.out().endsWith("}\n")).toBe(true);
  });

  it.each([
    ["an unknown name", ["plugin", "schema", "nothing"]],
    ["no name", ["plugin", "schema"]],
    ["an extra argument", ["plugin", "schema", "scan", "extra"]],
  ])("exits 2 listing the six names on %s", (_title, args) => {
    const captured = capture();

    expect(run(args, captured.io)).toBe(2);
    expect(captured.out()).toBe("");

    for (const name of NAMES) {
      expect(captured.err()).toContain(name);
    }
  });
});
