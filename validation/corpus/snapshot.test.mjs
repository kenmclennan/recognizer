import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import { parseManifest, readManifest } from "./manifest.mjs";
import { runCorpus } from "./snapshot.mjs";

const SHA = "a".repeat(40);

function entry(overrides = {}) {
  return {
    name: "sample",
    upstream: "https://example.test/sample",
    commit: SHA,
    languages: ["python"],
    why: "a reason",
    ...overrides,
  };
}

function git(directory, ...args) {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
}

function fixtureRepository() {
  const directory = makeTempDir("corpus-fixture-");

  git(directory, "init", "--quiet");
  git(directory, "config", "user.email", "t@example.test");
  git(directory, "config", "user.name", "t");
  git(directory, "config", "uploadpack.allowAnySHA1InWant", "true");
  writeFileSync(join(directory, "a.py"), "x = 1\n");
  git(directory, "add", "a.py");
  git(directory, "commit", "--quiet", "-m", "first");

  const first = git(directory, "rev-parse", "HEAD");

  writeFileSync(join(directory, "a.py"), "x = 2\n");
  git(directory, "commit", "--quiet", "-am", "second");

  return { directory, first };
}

function stubTools(failScan = false) {
  const bin = makeTempDir("corpus-bin-");
  const recognizer = join(bin, "recognizer");
  const sensors = join(bin, "recognizer-sensors");

  writeFileSync(
    recognizer,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("9.9.9"); process.exit(0); }
if (args[0] === "scan") {
  if (${failScan}) { console.error("scan blew up"); process.exit(1); }
  const cache = path.join(args[1], ".recognizer/cache");
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, "scan.python.json"), "{\\"scan\\":true}");
  process.exit(0);
}
if (args[0] === "check") { console.log("{\\"check\\":true}"); console.error("warnings: 0"); process.exit(0); }
process.exit(2);
`,
  );
  writeFileSync(
    sensors,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
require("node:fs").writeFileSync(args[args.indexOf("--output") + 1], "{\\"sensor\\":\\"duplication\\"}");
`,
  );
  chmodSync(recognizer, 0o755);
  chmodSync(sensors, 0o755);

  return { recognizer, sensors };
}

describe("parseManifest", () => {
  it("accepts a valid entry", () => {
    expect(parseManifest(JSON.stringify([entry()]))).toEqual([entry()]);
  });

  it.each([
    ["not json", "{", /not valid JSON/],
    ["an empty array", "[]", /non-empty/],
    ["a short commit", JSON.stringify([entry({ commit: "abc" })]), /40-character/],
    [
      "an unknown language",
      JSON.stringify([entry({ languages: ["cobol"] })]),
      /languages/,
    ],
    ["no why", JSON.stringify([entry({ why: " " })]), /why/],
    ["a bad name", JSON.stringify([entry({ name: "../x" })]), /invalid name/],
    [
      "a repeated name",
      JSON.stringify([entry(), entry()]),
      /repeats the name/,
    ],
  ])("rejects %s", (_label, text, message) => {
    expect(() => parseManifest(text)).toThrow(message);
  });
});

describe("the committed manifest", () => {
  const entries = readManifest(new URL("./manifest.json", import.meta.url).pathname);

  it("pins every repository and covers every language", () => {
    expect(entries.length).toBe(18);
    expect(new Set(entries.flatMap((one) => one.languages))).toEqual(
      new Set(["python", "typescript", "rust", "kotlin", "csharp"]),
    );
  });
});

describe("runCorpus", () => {
  function manifestFor(directory, commit, extra = []) {
    const path = join(makeTempDir("corpus-manifest-"), "manifest.json");

    writeFileSync(
      path,
      JSON.stringify([
        entry({ upstream: `file://${directory}`, commit }),
        ...extra,
      ]),
    );

    return path;
  }

  it("writes the snapshot layout and deletes the clone it made", () => {
    const { directory, first } = fixtureRepository();
    const out = makeTempDir("corpus-out-");
    const { snapshot, failures } = runCorpus({
      manifestPath: manifestFor(directory, first),
      out,
      date: "2026-01-02",
      tools: stubTools(),
    });

    expect(failures).toEqual({});
    expect(snapshot).toBe(join(out, "2026-01-02"));
    expect(readdirSync(snapshot).sort()).toEqual([
      "commits.txt",
      "recognizer-version.txt",
      "sample",
    ]);
    expect(readFileSync(join(snapshot, "commits.txt"), "utf8")).toBe(
      `sample ${first}\n`,
    );
    expect(readFileSync(join(snapshot, "recognizer-version.txt"), "utf8")).toBe(
      "9.9.9\n",
    );
    expect(readdirSync(join(snapshot, "sample")).sort()).toEqual([
      "check.python.err",
      "check.python.json",
      "duplication.json",
      "scan.python.json",
    ]);
    expect(readFileSync(join(snapshot, "sample/check.python.json"), "utf8")).toBe(
      '{"check":true}\n',
    );
    expect(existsSync(join(out, "repos/sample"))).toBe(false);
  });

  it("fetches exactly the pinned commit, not the tip", () => {
    const { directory, first } = fixtureRepository();
    const out = makeTempDir("corpus-out-");

    runCorpus({
      manifestPath: manifestFor(directory, first),
      out,
      date: "2026-01-02",
      keepClones: true,
      tools: stubTools(),
    });

    const clone = join(out, "repos/sample");

    expect(git(clone, "rev-parse", "HEAD")).toBe(first);
    expect(readFileSync(join(clone, "a.py"), "utf8")).toBe("x = 1\n");
    expect(git(clone, "rev-list", "--count", "HEAD")).toBe("1");
  });

  it("keeps a reused clone and records a failed scan then continues", () => {
    const { directory, first } = fixtureRepository();
    const out = makeTempDir("corpus-out-");
    const manifestPath = manifestFor(directory, first);

    runCorpus({ manifestPath, out, date: "d1", keepClones: true, tools: stubTools() });

    const { snapshot, failures } = runCorpus({
      manifestPath: manifestFor(directory, first, [
        entry({ name: "missing", upstream: `file://${directory}/nope` }),
      ]),
      out,
      date: "d2",
      tools: stubTools(true),
    });

    expect(failures.sample[0]).toMatch(/recognizer scan exited 1: scan blew up/);
    expect(failures.missing[0]).toMatch(/git fetch/);
    expect(readFileSync(join(snapshot, "sample/error.txt"), "utf8")).toMatch(
      /scan blew up/,
    );
    expect(existsSync(join(snapshot, "missing/error.txt"))).toBe(true);
    expect(existsSync(join(snapshot, "sample/duplication.json"))).toBe(true);
    expect(existsSync(join(out, "repos/sample/.git"))).toBe(true);
  });

  it("refuses an output folder inside the Recognizer repository", () => {
    const { directory, first } = fixtureRepository();

    expect(() =>
      runCorpus({
        manifestPath: manifestFor(directory, first),
        out: join(import.meta.dirname, "snapshots"),
        tools: stubTools(),
      }),
    ).toThrow(/outside the Recognizer repository/);
    expect(existsSync(join(import.meta.dirname, "snapshots"))).toBe(false);
  });

  it("limits the run to --only names", () => {
    const { directory, first } = fixtureRepository();
    const out = makeTempDir("corpus-out-");
    const { snapshot } = runCorpus({
      manifestPath: manifestFor(directory, first, [entry({ name: "other" })]),
      out,
      date: "d",
      only: ["sample"],
      tools: stubTools(),
    });

    expect(readdirSync(snapshot)).not.toContain("other");
  });
});
