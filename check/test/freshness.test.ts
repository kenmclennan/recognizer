import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InputError } from "../src/errors.js";
import { freshScans } from "../src/freshness.js";
import { fakeIo, PYTHON, ROOT, scanJson, TYPESCRIPT } from "./scan-helpers.js";

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

const COMMIT = "abc123";
const CACHE = `${ROOT}/.recognizer/cache/scan.python.json`;
const cached = (commit: string | null) => scanJson(2, 1, { commit }, "  ");
const scanner = { [PYTHON]: { output: scanJson(2, 1, { commit: COMMIT }) } };

function setup(
  options: {
    status?: string;
    commit?: string;
    cache?: string | null;
    files?: Record<string, string>;
  } = {},
) {
  const fake = fakeIo({
    commit: options.commit ?? COMMIT,
    status: options.status,
    files: {
      [`${ROOT}/a.py`]: "",
      ...(options.cache === null
        ? {}
        : { [CACHE]: options.cache ?? cached(COMMIT) }),
      ...options.files,
    },
    scanners: scanner,
  });

  return fake;
}

const scannerRuns = (fake: ReturnType<typeof setup>) =>
  fake.calls.filter((call) => call.command === PYTHON).length;

describe("freshScans", () => {
  it("reuses a cache taken at the current commit with a clean tree", () => {
    const fake = setup();
    const result = freshScans(fake.io, ROOT);

    expect(result.scanned).toBe(false);
    expect(result.scans).toHaveLength(1);
    expect(scannerRuns(fake)).toBe(0);
  });

  it("scans when the commit is new", () => {
    const fake = setup({ cache: cached("old") });

    expect(freshScans(fake.io, ROOT).scanned).toBe(true);
    expect(scannerRuns(fake)).toBe(1);
  });

  it("scans when the tree is dirty", () => {
    const fake = setup({ status: " M a.py\n" });

    expect(freshScans(fake.io, ROOT).scanned).toBe(true);
  });

  it("ignores a dirty path under .recognizer by asking git to exclude it", () => {
    const fake = setup();

    freshScans(fake.io, ROOT);

    const status = fake.calls.find((call) => call.args.includes("status"));

    expect(status?.args.slice(-3)).toEqual(["--", ".", ":!.recognizer"]);
  });

  it("scans when the cache for a detected language is missing", () => {
    const fake = setup({ cache: null });

    expect(freshScans(fake.io, ROOT).scanned).toBe(true);
  });

  it("scans when the cache has a null commit", () => {
    const fake = setup({ cache: cached(null) });

    expect(freshScans(fake.io, ROOT).scanned).toBe(true);
  });

  it("scans when one of two detected languages has no cache", () => {
    const fake = setup({ files: { [`${ROOT}/b.ts`]: "" } });

    expect(() => freshScans(fake.io, ROOT)).toThrow(InputError);
    expect(scannerRuns(fake)).toBe(1);
  });

  it("reuses a cache whose recorded file hashes still match", () => {
    const cache = scanJson(
      2,
      1,
      {
        commit: COMMIT,
        files: [{ path: "a.py", hash: sha256("x = 1\n") }],
      },
      "  ",
    );
    const fake = setup({ cache, files: { [`${ROOT}/a.py`]: "x = 1\n" } });

    expect(freshScans(fake.io, ROOT).scanned).toBe(false);
    expect(scannerRuns(fake)).toBe(0);
  });

  it("scans when the cache was written from a modified tree even with a clean tree now", () => {
    const fake = setup({
      cache: scanJson(2, 1, { commit: COMMIT, modified: true }, "  "),
    });

    expect(freshScans(fake.io, ROOT).scanned).toBe(true);
  });

  it("scans when the modified flag is unknown", () => {
    const fake = setup({
      cache: scanJson(2, 1, { commit: COMMIT, modified: null }, "  "),
    });

    expect(freshScans(fake.io, ROOT).scanned).toBe(true);
  });

  it("scans when a recorded hash differs from the file now (dirty then reverted)", () => {
    const cache = scanJson(
      2,
      1,
      {
        commit: COMMIT,
        files: [{ path: "a.py", hash: sha256("edited\n") }],
      },
      "  ",
    );
    const fake = setup({ cache, files: { [`${ROOT}/a.py`]: "x = 1\n" } });

    expect(freshScans(fake.io, ROOT).scanned).toBe(true);
    expect(scannerRuns(fake)).toBe(1);
  });

  it("scans when a recorded file is gone", () => {
    const cache = scanJson(
      2,
      1,
      { commit: COMMIT, files: [{ path: "gone.py", hash: sha256("") }] },
      "  ",
    );
    const fake = setup({ cache });

    expect(freshScans(fake.io, ROOT).scanned).toBe(true);
  });

  it("scans when the cache is a version-3 scan", () => {
    const fake = setup({
      cache: scanJson(2, 1, { commit: COMMIT, schema_version: 3 }, "  "),
    });

    expect(freshScans(fake.io, ROOT).scanned).toBe(true);
  });

  it("rescans both languages when only one cache's hashes match", () => {
    const python = scanJson(
      2,
      1,
      { commit: COMMIT, files: [{ path: "a.py", hash: sha256("") }] },
      "  ",
    );
    const typescript = scanJson(
      2,
      1,
      { commit: COMMIT, files: [{ path: "b.ts", hash: sha256("old") }] },
      "  ",
    );
    const fake = fakeIo({
      commit: COMMIT,
      files: {
        [`${ROOT}/a.py`]: "",
        [`${ROOT}/b.ts`]: "new",
        [CACHE]: python,
        [`${ROOT}/.recognizer/cache/scan.typescript.json`]: typescript,
      },
      scanners: {
        [PYTHON]: { output: scanJson(2, 1, { commit: COMMIT }) },
        [TYPESCRIPT]: { output: scanJson(2, 1, { commit: COMMIT }) },
      },
    });

    expect(freshScans(fake.io, ROOT).scanned).toBe(true);
    expect(scannerRuns(fake)).toBe(1);
    expect(
      fake.calls.filter((call) => call.command === TYPESCRIPT),
    ).toHaveLength(1);
  });

  it("fails with an InputError when no language is detected", () => {
    const fake = fakeIo({ commit: COMMIT, scanners: scanner });

    expect(() => freshScans(fake.io, ROOT)).toThrow(InputError);
  });

  it("fails with an InputError when a scanner fails", () => {
    const fake = fakeIo({
      commit: COMMIT,
      files: { [`${ROOT}/a.py`]: "" },
      scanners: { [PYTHON]: { status: 1, stderr: "boom" } },
    });

    expect(() => freshScans(fake.io, ROOT)).toThrow(InputError);
  });

  it("leaves stdout empty and puts the scan summary on stderr", () => {
    const fake = setup({ cache: null });

    freshScans(fake.io, ROOT);

    expect(fake.out()).toBe("");
    expect(fake.err()).toContain("python: 2 modules, 1 edges");
  });

  it("rejects a root that is not a directory", () => {
    const fake = setup();

    expect(() => freshScans(fake.io, `${ROOT}/a.py`)).toThrow(InputError);
  });
});
