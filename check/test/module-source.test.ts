import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Io, run } from "../src/cli.js";
import { moduleSource } from "../src/module-source.js";
import type { Scan } from "../src/scan.js";
import { capture, REPO } from "./helpers.js";

const FAKE = join(REPO, "check/test/fixtures/fake-describer.mjs");
const DOMAIN = "app/src/main/kotlin/shop/domain";
const WEB = "app/src/main/kotlin/shop/web";
const CURRENCY = `${DOMAIN}/Currency.kt`;
const ORDER = `${DOMAIN}/Order.kt`;
const PINNED =
  "8c5ccc8157d9f901a5f999662456b9559edddc914a4c9e5524ef731881cc2429";
const roots: string[] = [];

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "recognizer-module-source-"));

  roots.push(root);
  cpSync(join(REPO, "fixtures/kotlin/sample"), root, { recursive: true });
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "sample");
  writeScan(root);

  const command = [
    "node",
    FAKE,
    "{repository}",
    "--copy",
    `${root}/.recognizer/request.json`,
    "{request}",
  ];

  writeFileSync(
    join(root, ".recognizer/config.yaml"),
    `describer:\n  command: ${JSON.stringify(command)}\n  version: "v1"\n`,
  );

  return root;
}

function writeScan(root: string): void {
  const scan = JSON.parse(
    readFileSync(join(REPO, "fixtures/kotlin/expected-scan.json"), "utf8"),
  );

  scan.commit = git(root, "rev-parse", "HEAD").trim();
  scan.modified = false;
  scan.files = scan.files
    .filter((entry: { path: string }) => existsSync(join(root, entry.path)))
    .map((entry: { path: string }) => ({
      ...entry,
      hash: sha(readFileSync(join(root, entry.path), "utf8")),
    }));
  mkdirSync(join(root, ".recognizer/cache"), { recursive: true });
  writeFileSync(
    join(root, ".recognizer/cache/scan.kotlin.json"),
    JSON.stringify(scan),
  );
}

function commit(root: string): void {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "change");
  writeScan(root);
}

function exec(root: string, ...args: string[]) {
  const out = capture();
  const code = run([...args, "--repository", root], out.io);

  return { code, out: out.out(), err: out.err() };
}

function counts(root: string) {
  return JSON.parse(exec(root, "describe", "--check", "--json").out) as {
    counts: Record<string, number>;
    modules: { module: string; status: string; reasons: string[] }[];
  };
}

function statusOf(root: string, id: string): string {
  return (
    counts(root).modules.find((entry) => entry.module === id)?.status ?? ""
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("moduleSource", () => {
  const scan = {
    modules: [{ id: "shop" }, { id: "shop/sub" }, { id: "solo.py" }],
    files: [
      { path: "shop/sub/C.kt", hash: "x" },
      { path: "shop/B.kt", hash: "x" },
      { path: "shop/A.kt", hash: "x" },
      { path: "solo.py", hash: "x" },
    ],
  } as unknown as Scan;

  function io(files: Record<string, string>): Io {
    return {
      readFile: (path: string) => {
        const text = files[path];

        if (text === undefined) {
          throw new Error("missing");
        }

        return text;
      },
    } as unknown as Io;
  }

  const files = {
    "/r/shop/A.kt": "package shop\n\nclass A\n",
    "/r/shop/B.kt": "package shop\n\nclass B",
    "/r/shop/sub/C.kt": "package sub\n",
    "/r/solo.py": "print(1)",
  };

  it("pins the worked two-file hash", () => {
    const found = moduleSource(io(files), "/r", [scan], "shop");

    expect(found?.files).toEqual(["shop/A.kt", "shop/B.kt"]);
    expect(found?.source).toBe(
      "==> shop/A.kt <==\npackage shop\n\nclass A\n==> shop/B.kt <==\npackage shop\n\nclass B\n",
    );
    expect(found?.hash).toBe(PINNED);
  });

  it("hashes a file module as the file's text", () => {
    const found = moduleSource(io(files), "/r", [scan], "solo.py");

    expect(found?.files).toEqual(["solo.py"]);
    expect(found?.source).toBe("print(1)");
    expect(found?.hash).toBe(sha("print(1)"));
  });

  it("leaves subdirectory files to their own module", () => {
    expect(moduleSource(io(files), "/r", [scan], "shop/sub")?.files).toEqual([
      "shop/sub/C.kt",
    ]);
  });

  it("is unreadable when a listed file is missing or the module is unscanned", () => {
    const { "/r/shop/A.kt": _, ...rest } = files;

    expect(moduleSource(io(rest), "/r", [scan], "shop")).toBeNull();
    expect(moduleSource(io(files), "/r", [scan], "nowhere")).toBeNull();
  });
});

describe("describe over a Kotlin package module", () => {
  it("sends both files, tracks edits to either and agrees with show", () => {
    const root = repository();

    expect(exec(root, "describe", DOMAIN).code).toBe(0);

    const request = JSON.parse(
      readFileSync(join(root, ".recognizer/request.json"), "utf8"),
    );
    const expected = [CURRENCY, ORDER]
      .map((file) => {
        const text = readFileSync(join(root, file), "utf8");

        return `==> ${file} <==\n${text}${text.endsWith("\n") ? "" : "\n"}`;
      })
      .join("");

    expect(request.files).toEqual([CURRENCY, ORDER]);
    expect(request.source).toBe(expected);
    expect(statusOf(root, DOMAIN)).toBe("current");

    const shown = () =>
      JSON.parse(exec(root, "show", DOMAIN, "--json").out).responsibility;

    expect(shown().status).toBe("current");

    for (const file of [CURRENCY, ORDER]) {
      const path = join(root, file);
      const before = readFileSync(path, "utf8");

      writeFileSync(path, `${before}\n// edited\n`);
      commit(root);

      const stale = counts(root).modules.find((m) => m.module === DOMAIN);

      expect(stale?.status).toBe("out-of-date");
      expect(stale?.reasons).toEqual(["source"]);
      expect(shown().status).toBe("out-of-date");

      writeFileSync(path, before);
      commit(root);

      expect(statusOf(root, DOMAIN)).toBe("current");
    }
  });

  it("reports 8 current and none unreadable after describe --all", () => {
    const root = repository();

    expect(exec(root, "describe", "--all").code).toBe(0);
    expect(counts(root).counts).toEqual({
      current: 8,
      outOfDate: 0,
      missing: 0,
      unreadable: 0,
    });
  });

  it("does not take a subdirectory's files", () => {
    const root = repository();
    const nested = join(root, WEB, "sub/Extra.kt");

    mkdirSync(dirname(nested), { recursive: true });
    writeFileSync(nested, "package shop.web.sub\n");
    commit(root);

    const scan = JSON.parse(
      readFileSync(join(root, ".recognizer/cache/scan.kotlin.json"), "utf8"),
    );

    scan.files.push({
      path: `${WEB}/sub/Extra.kt`,
      hash: sha("package shop.web.sub\n"),
    });
    writeFileSync(
      join(root, ".recognizer/cache/scan.kotlin.json"),
      JSON.stringify(scan),
    );

    exec(root, "describe", WEB);

    const request = JSON.parse(
      readFileSync(join(root, ".recognizer/request.json"), "utf8"),
    );

    expect(request.files.every((file: string) => !file.includes("/sub/"))).toBe(
      true,
    );
  });
});
