import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkBump, latestReleaseTag, run } from "./schema-compat.mjs";
import { makeTempDir } from "./temp-dirs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function schema(version, extra = {}, required = ["schema_version", "modules"]) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required,
    properties: {
      schema_version: { const: version },
      modules: { type: "array" },
      ...extra,
    },
  };
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function write(cwd, path, value) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), `${JSON.stringify(value, null, 2)}\n`);
}

function repo({
  examples = { "one.json": { schema_version: 7, modules: [] } },
} = {}) {
  const cwd = makeTempDir("schema-compat-");

  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.email", "t@example.com");
  git(cwd, "config", "user.name", "t");
  write(cwd, "schema/scan.schema.json", schema(7));
  write(cwd, "schema/scan-breaking-versions.json", []);

  for (const [name, document] of Object.entries(examples)) {
    write(cwd, `schema/examples/valid/${name}`, document);
  }

  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "release");
  git(cwd, "tag", "v0.0.1");
  git(cwd, "checkout", "-q", "-b", "change");

  return cwd;
}

function commitChange(cwd, headSchema, breaks = []) {
  write(cwd, "schema/scan.schema.json", headSchema);
  write(cwd, "schema/scan-breaking-versions.json", breaks);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "change");
}

function check(cwd, breaks) {
  const file = join(makeTempDir("breaks-"), "breaks.json");

  writeFileSync(file, JSON.stringify(breaks ?? []));

  return run({ cwd, headRef: "HEAD", mainRef: "main", breaksFile: file });
}

describe("schema-compat: the bump", () => {
  it("passes an unchanged schema", () => {
    expect(check(repo()).code).toBe(0);
  });

  it("passes an added optional property with the const bumped", () => {
    const cwd = repo();

    commitChange(cwd, schema(8, { extra: { type: "string" } }));

    expect(check(cwd).code).toBe(0);
  });

  it("fails the same change with the const unchanged, naming both versions", () => {
    const cwd = repo();

    commitChange(cwd, schema(7, { extra: { type: "string" } }));

    const result = check(cwd);

    expect(result.code).toBe(1);
    expect(result.lines.join("\n")).toContain("schema_version is 7");
    expect(result.lines.join("\n")).toContain("merge base has 7");
  });

  it("compares only the const when nothing else moved", () => {
    expect(checkBump(schema(7), schema(7))).toBeNull();
    expect(checkBump(schema(7), schema(9))).toBeNull();
  });
});

describe("schema-compat: the released scans", () => {
  it("fails a removed property the example carries, once the const is bumped", () => {
    const cwd = repo({
      examples: { "one.json": { schema_version: 7, modules: [], gone: 1 } },
    });

    commitChange(cwd, schema(8));

    const result = check(cwd);

    expect(result.code).toBe(1);
    expect(result.lines.join("\n")).toContain("schema/examples/valid/one.json");
  });

  it("passes the same break when the const is listed, naming the example as skipped", () => {
    const cwd = repo({
      examples: { "one.json": { schema_version: 7, modules: [], gone: 1 } },
    });

    commitChange(cwd, schema(8), [8]);

    const result = check(cwd, [8]);

    expect(result.code).toBe(0);
    expect(result.lines.join("\n")).toContain(
      "skipped schema/examples/valid/one.json",
    );
  });

  it("names the one example that fails among two, not a count", () => {
    const cwd = repo({
      examples: {
        "good.json": { schema_version: 7, modules: [] },
        "bad.json": { schema_version: 7, modules: [], gone: 1 },
      },
    });

    commitChange(cwd, schema(8));

    const result = check(cwd);
    const text = result.lines.join("\n");

    expect(result.code).toBe(1);
    expect(text).toContain("bad.json");
    expect(text).not.toContain("good.json at the last release");
  });

  it("validates an older example with its version rewritten when breaks are empty", () => {
    const cwd = repo();

    commitChange(cwd, schema(8));

    expect(check(cwd, []).code).toBe(0);
  });

  it("skips an example whose version a break equal to the head const stands over, even if broken", () => {
    const cwd = repo({
      examples: { "one.json": { schema_version: 7, modules: "x" } },
    });

    commitChange(cwd, schema(8), [8]);

    const result = check(cwd, [8]);

    expect(result.code).toBe(0);
    expect(result.lines.join("\n")).toContain("skipped");
  });

  it("validates an example when the break equals its own version", () => {
    const cwd = repo({
      examples: { "one.json": { schema_version: 7, modules: "x" } },
    });

    commitChange(cwd, schema(8));

    const result = check(cwd, [7]);

    expect(result.code).toBe(1);
    expect(result.lines.join("\n")).toContain("one.json");
  });
});

describe("latestReleaseTag", () => {
  it("sorts by version number and ignores unit tags", () => {
    expect(
      latestReleaseTag(["v0.1.9", "v0.1.10", "sensors-v9.9.9", "v0.1.2", ""]),
    ).toBe("v0.1.10");
  });

  it("is null with no release tag", () => {
    expect(latestReleaseTag(["sensors-v1.0.0"])).toBeNull();
  });
});

describe("schema-compat against this repository", () => {
  const git = (args) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  const tags = git(["tag", "--list", "v*"]).stdout ?? "";
  const mainRef = ["origin/main", "main"].find(
    (ref) => git(["merge-base", ref, "HEAD"]).status === 0,
  );

  it.skipIf(tags.trim() === "" || mainRef === undefined)(
    "exits 0 for HEAD against the latest release tag",
    () => {
      const result = spawnSync(
        "node",
        [join(ROOT, "tools/scripts/schema-compat.mjs"), "HEAD", "", mainRef],
        { cwd: ROOT, encoding: "utf8" },
      );

      expect(result.status, result.stderr).toBe(0);
    },
  );
});
