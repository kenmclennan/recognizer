import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { decide, render } from "./ci-changes.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const UNITS = JSON.parse(
  readFileSync(`${ROOT}tools/packaging/units.json`, "utf8"),
).units;

const ALL = UNITS.map((entry) => entry.unit);

describe("ci-changes", () => {
  it("runs every unit and the toolchain on push", () => {
    expect(decide("push", [], UNITS)).toEqual({
      units: ALL,
      toolchain: true,
      rust: true,
    });
  });

  it("runs no unit for a core-only pull request, and the toolchain that packs core", () => {
    expect(decide("pull_request", ["packages/core/src/a.ts"], UNITS)).toEqual({
      units: [],
      toolchain: true,
      rust: false,
    });
  });

  it("runs only the scanner's unit for a scanner-only pull request, and no toolchain", () => {
    expect(
      decide("pull_request", ["packages/scanners/rust/src/lib.rs"], UNITS),
    ).toEqual({ units: ["scan-rust"], toolchain: false, rust: true });
  });

  it("runs every unit when what builds or verifies them changed", () => {
    for (const file of [
      "tools/scripts/build-plugin.mjs",
      "tools/packaging/units.json",
      "schema/scan.schema.json",
      "package-lock.json",
      ".github/workflows/check.yml",
    ]) {
      expect(decide("pull_request", [file], UNITS).units, file).toEqual(ALL);
    }
  });

  it("runs nothing self-hosted for a test-only change", () => {
    expect(decide("pull_request", ["fixtures/x.json"], UNITS)).toEqual({
      units: [],
      toolchain: false,
      rust: false,
    });
  });

  it("renders github output lines", () => {
    expect(render({ units: ["sensors"], toolchain: false, rust: false })).toBe(
      'units=["sensors"]\ntoolchain=false\nrust=false\n',
    );
  });

  it("gates the self-hosted jobs on the changes job and leaves test alone", () => {
    const jobs = parse(
      readFileSync(`${ROOT}.github/workflows/check.yml`, "utf8"),
    ).jobs;

    expect(jobs.changes["runs-on"]).toBe("ubuntu-latest");
    expect(jobs.toolchain.needs).toContain("changes");
    expect(jobs.plugins.needs).toContain("changes");
    expect(jobs.plugins.strategy.matrix.unit).toContain("fromJSON");
    expect(jobs.test.needs).toBeUndefined();
  });

  it("runs the rust checks for a change under the app's Rust crate or the Rust scanner only", () => {
    for (const file of [
      "packages/app/src-tauri/Cargo.lock",
      "packages/app/src-tauri/src/main.rs",
      "packages/scanners/rust/Cargo.toml",
    ]) {
      expect(decide("pull_request", [file], UNITS).rust, file).toBe(true);
    }

    for (const file of ["packages/app/src/main.ts", "packages/cli/src/a.ts"]) {
      expect(decide("pull_request", [file], UNITS).rust, file).toBe(false);
    }
  });

  it("gates the app check's Rust step on the changes job", () => {
    const jobs = parse(
      readFileSync(`${ROOT}.github/workflows/app.yml`, "utf8"),
    ).jobs;

    expect(jobs.changes["runs-on"]).toBe("ubuntu-latest");
    expect(jobs.check.needs).toContain("changes");
  });
});
