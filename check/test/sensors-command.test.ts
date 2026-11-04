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

  it("gives every entry the registry keys with crap and mutation running tests", () => {
    const { io, out } = capture();

    run(["sensors", "--json"], io);

    const entries = JSON.parse(out());

    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual([
        "defaults",
        "display",
        "line",
        "listed",
        "metrics",
        "name",
        "runs_tests",
        "scoped",
      ]);
    }

    expect(
      entries
        .filter((e: { runs_tests: boolean }) => e.runs_tests)
        .map((e: { name: string }) => e.name),
    ).toEqual(["crap", "mutation"]);
    expect(
      entries
        .filter((e: { listed: boolean }) => !e.listed)
        .map((e: { name: string }) => e.name),
    ).toEqual(["thresholds"]);
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

  it("lists C.R.A.P., Duplication and Mutation, in the order the Scan panel shows them", () => {
    const { io, out } = capture();

    run(["sensors", "--json"], io);

    const shown = JSON.parse(out())
      .filter((e: { listed: boolean }) => e.listed)
      .map((e: { display: string }) => e.display)
      .sort((a: string, b: string) => a.localeCompare(b));

    expect(shown).toEqual(["C.R.A.P.", "Duplication", "Mutation"]);
  });
});
