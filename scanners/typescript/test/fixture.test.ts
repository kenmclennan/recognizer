import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import { scan } from "../src/index.js";
import {
  ajvValidate,
  BIN,
  FIXTURE,
  listFiles,
  PACKAGE,
  REPO,
  readJson,
  runBin,
  validate,
} from "./helpers.js";

const SAMPLE = join(FIXTURE, "sample");
const EXPECTED = readJson(join(FIXTURE, "expected-scan.json"));

describe("schema examples", () => {
  const valid = join(REPO, "schema/examples/valid");
  const invalid = join(REPO, "schema/examples/invalid");

  it.each(listFiles(valid))("validates valid example %s", (name) => {
    expect(
      ajvValidate(JSON.parse(readFileSync(join(valid, name), "utf8"))),
    ).toBe(true);
  });

  it.each(listFiles(invalid))("rejects invalid example %s", (name) => {
    expect(
      ajvValidate(JSON.parse(readFileSync(join(invalid, name), "utf8"))),
    ).toBe(false);
  });
});

describe("fixture", () => {
  const version = (
    JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;

  it("matches the expected scan and validates", () => {
    const doc = scan(SAMPLE, null);

    expect(doc.scanner.name).toBe("recognizer-scan-typescript");
    expect(doc.scanner.version).toBe(version);

    validate(doc);
    expect(doc).toEqual({
      ...EXPECTED,
      scanner: { ...EXPECTED.scanner, version },
    });
  });

  it("has the expected module and edge counts and exactly the fixture calls", () => {
    const doc = scan(SAMPLE, null);

    expect(doc.modules).toHaveLength(15);
    expect(doc.edges).toHaveLength(21);
    expect(doc.calls.map((c) => `${c.from} -> ${c.to} ${c.how}`)).toEqual([
      "api/src/base-store.ts::BaseStore.count -> api/src/base-store.ts::BaseStore.grow call",
      "api/src/base-store.ts::makeBase -> api/src/base-store.ts::BaseStore construct",
      "api/src/memory-store.ts::fresh -> api/src/base-store.ts::makeBase call",
      "api/src/place.ts::place -> api/src/types.ts::Store.save inferred",
      "api/src/types.ts::Store.save -> api/src/memory-store.ts::MemoryStore.save dispatch",
      "web/src/App.tsx::App -> api/src/memory-store.ts::MemoryStore construct",
    ]);
  });

  it("lists the fixture's source files with their sha256 and its selection", () => {
    const doc = scan(SAMPLE, null);

    const listed = doc.files.map((f) => f.path);

    expect(doc.files).toHaveLength(20);
    expect(listed).toEqual([...listed].sort());

    for (const module of doc.modules) {
      expect(listed).toContain(module.id);
    }

    for (const entry of doc.files) {
      const bytes = readFileSync(join(SAMPLE, entry.path));

      expect(entry.hash).toBe(createHash("sha256").update(bytes).digest("hex"));
    }

    expect(doc.selection).toEqual({
      extensions: [
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".mts",
        ".cts",
      ],
      skip_directory_names: [
        "node_modules",
        "dist",
        "build",
        "test",
        "tests",
        "__tests__",
      ],
      skip_directory_prefixes: ["."],
      skip_directory_suffixes: [],
      skip_directories_containing: [],
      skip_file_globs: ["*.d.ts", "*.d.mts", "*.d.cts", "*.test.*", "*.spec.*"],
      input_file_globs: ["package.json", "tsconfig.json", "*.html"],
    });
  });

  it("emits no package module and no unknown member kind", () => {
    const doc = scan(SAMPLE, null);
    const kinds = new Set(
      doc.modules.flatMap((m) => m.members.map((x) => x.kind)),
    );

    expect(doc.modules.every((m) => m.kind !== ("package" as string))).toBe(
      true,
    );
    expect(
      [...kinds].every((k) =>
        ["class", "function", "interface", "type", "constant", "enum"].includes(
          k,
        ),
      ),
    ).toBe(true);
  });
});

describe("cli", () => {
  it("prints the expected scan with --commit and writes identical bytes with --output", () => {
    const first = runBin(SAMPLE, "--commit", "abc1234", "--modified", "false");
    const second = runBin(SAMPLE, "--commit", "abc1234", "--modified", "false");

    expect(first.status).toBe(0);
    expect(first.stdout).toBe(second.stdout);

    const doc = JSON.parse(first.stdout);
    validate(doc);
    expect(doc).toEqual({
      ...EXPECTED,
      commit: "abc1234",
      modified: false,
      scanner: doc.scanner,
    });

    const output = join(makeTempDir("recognizer-ts-out-"), "scan.json");
    const written = runBin(
      SAMPLE,
      "--commit",
      "abc1234",
      "--modified",
      "false",
      "--output",
      output,
    );

    expect(written.status).toBe(0);
    expect(written.stdout).toBe("");
    expect(readFileSync(output, "utf8")).toBe(first.stdout);
  });

  it("exits 2 on a usage error", () => {
    const result = runBin(SAMPLE, "--bogus");

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
  });
});

describe("verbs and events", () => {
  const verbs = "manifest, check, run, guide";

  it("reports start and progress events that end at the total", () => {
    const result = runBin(SAMPLE);
    const events = result.stderr
      .split("\n")
      .filter((line) => line.startsWith("recognizer-event "))
      .map(
        (line) =>
          JSON.parse(line.slice("recognizer-event ".length)) as Record<
            string,
            unknown
          >,
      );
    const [first, ...rest] = events;

    expect(result.status).toBe(0);
    expect(first?.event).toBe("start");
    expect(first?.unit).toBe("files");
    expect(
      rest.every((event) => (event.done as number) <= (event.total as number)),
    ).toBe(true);
    expect(events.at(-1)).toEqual({
      event: "progress",
      done: first?.total,
      total: first?.total,
      unit: "files",
    });
  });

  it("exits 2 on check without printing a document", () => {
    const result = spawnSync("node", [BIN, "check"], { encoding: "utf8" });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(verbs);
  });

  it("prints nothing for guide", () => {
    const result = spawnSync("node", [BIN, "guide"], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it.each([[SAMPLE], ["--output"]])(
    "exits 2 naming the verbs for %s",
    (first) => {
      const result = spawnSync("node", [BIN, first], { encoding: "utf8" });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain(verbs);
    },
  );
});

describe("--version", () => {
  it("prints the manifest version", () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE, "package.json"), "utf8"),
    ) as { version: string };
    const result = spawnSync("node", [BIN, "--version"], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${manifest.version}\n`);
  });
});
