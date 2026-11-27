import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { type Io, run } from "../src/cli.js";
import { readSource } from "../src/module-source.js";
import { capture, REPO } from "./helpers.js";
import { useScannerShim } from "./scan-helpers.js";

const FAKE = join(REPO, "packages/cli/test/fixtures/fake-describer.mjs");
const DOMAIN = "app/src/main/kotlin/shop/domain";
const ORDER = `${DOMAIN}/Order.kt`;
const CURRENCY = `${DOMAIN}/Currency.kt`;
const roots: string[] = [];

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function repository(): string {
  const root = makeTempDir("recognizer-module-source-");

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
    "run",
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

async function exec(root: string, ...args: string[]) {
  const out = capture();
  const code = await run([...args, "--repository", root], out.io);

  return { code, out: out.out(), err: out.err() };
}

async function counts(root: string) {
  return JSON.parse(
    (await exec(root, "describe", "--check", "--json")).out,
  ) as {
    counts: Record<string, number>;
    modules: { module: string; status: string; reasons: string[] }[];
  };
}

async function statusOf(root: string, id: string): Promise<string> {
  return (
    (await counts(root)).modules.find((entry) => entry.module === id)?.status ??
    ""
  );
}

let restorePath: () => void = () => {};

beforeEach(() => {
  restorePath = useScannerShim("kotlin");
});

afterEach(() => {
  restorePath();

  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("readSource", () => {
  it("hashes the raw bytes of a file that is not valid UTF-8", () => {
    const bytes = Buffer.from([0x70, 0x72, 0xff, 0x0a]);
    const io = {
      readBytes: () => bytes,
    } as unknown as Io;
    const found = readSource(io, "/r", "solo.py");

    expect(found?.hash).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(found?.hash).not.toBe(sha(bytes.toString("utf8")));
  });
});

describe("describe over a Kotlin file module", () => {
  it("sends the one file, tracks edits to it and agrees with show", async () => {
    const root = repository();

    expect((await exec(root, "describe", ORDER)).code).toBe(0);

    const request = JSON.parse(
      readFileSync(join(root, ".recognizer/request.json"), "utf8"),
    );

    expect(request.files).toEqual([ORDER]);
    expect(request.source).toBe(readFileSync(join(root, ORDER), "utf8"));
    expect(await statusOf(root, ORDER)).toBe("current");

    const shown = async () =>
      JSON.parse((await exec(root, "show", ORDER, "--json")).out)
        .responsibility;

    expect((await shown()).status).toBe("current");

    const path = join(root, ORDER);
    const before = readFileSync(path, "utf8");

    writeFileSync(path, `${before}\n// edited\n`);
    commit(root);

    const stale = (await counts(root)).modules.find((m) => m.module === ORDER);

    expect(stale?.status).toBe("out-of-date");
    expect(stale?.reasons).toEqual(["source"]);
    expect((await shown()).status).toBe("out-of-date");
    expect(await statusOf(root, CURRENCY)).toBe("missing");

    writeFileSync(path, before);
    commit(root);

    expect(await statusOf(root, ORDER)).toBe("current");
  });

  it("reports 10 current and none unreadable after describe --all", async () => {
    const root = repository();

    expect((await exec(root, "describe", "--all")).code).toBe(0);
    expect((await counts(root)).counts).toEqual({
      current: 10,
      outOfDate: 0,
      missing: 0,
      unreadable: 0,
    });
  });
});
