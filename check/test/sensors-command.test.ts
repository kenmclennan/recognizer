import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { capture, REPO } from "./helpers.js";

const list = JSON.parse(
  readFileSync(join(REPO, "fixtures/sensors/list.json"), "utf8"),
);

describe("recognizer sensors", () => {
  it("prints the list as JSON equal to the fixture", () => {
    const { io, out } = capture();

    expect(run(["sensors", "--json"], io)).toBe(0);
    expect(JSON.parse(out())).toEqual(list);
  });

  it("prints a duplication line in text", () => {
    const { io, out } = capture();

    expect(run(["sensors"], io)).toBe(0);
    expect(out()).toMatch(/^duplication {2}\S/m);
  });

  it("exits 2 on an unknown flag", () => {
    const { io } = capture();

    expect(run(["sensors", "--bogus"], io)).toBe(2);
  });

  it("exits 2 on an extra argument", () => {
    const { io } = capture();

    expect(run(["sensors", "extra"], io)).toBe(2);
  });

  it("is named by help", () => {
    const { io, out } = capture();

    expect(run(["help", "sensors"], io)).toBe(0);
    expect(out()).toContain("recognizer sensors");
  });
});
