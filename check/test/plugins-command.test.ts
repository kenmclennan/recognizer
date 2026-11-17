import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import type { InstalledPlugin } from "../src/plugin-discovery.js";
import { schemaMismatchLines } from "../src/plugins-command.js";
import {
  ioWithPath,
  manifestFor,
  tempDirectory,
  writeShim,
} from "./plugin-path.js";

interface Out {
  code: number;
  out: string;
  err: string;
}

async function plugins(directories: string[], args: string[]): Promise<Out> {
  let out = "";
  let err = "";
  const base = ioWithPath(directories);
  const io = {
    ...base,
    stdout: (text: string) => {
      out += text;
    },
    stderr: (text: string) => {
      err += text;
    },
  };
  const code = await run(["plugins", ...args], io);

  return { code, out, err };
}

const RULES = (name: string, extension: string) => ({
  languages: [
    {
      name,
      extensions: [extension],
      files: [],
      skip: {
        directory_names: [],
        directory_prefixes: [],
        directory_suffixes: [],
        directory_markers: [],
        file_globs: [],
      },
    },
  ],
});

function installed() {
  const bin = tempDirectory("recognizer-plugins-bin-");
  const repo = tempDirectory("recognizer-plugins-repo-");

  writeShim(bin, "recognizer-describe-d", manifestFor("describer", "d"));
  writeShim(bin, "recognizer-sense-s", manifestFor("sensor", "s"));
  writeShim(
    bin,
    "recognizer-scan-python",
    manifestFor("scanner", "python", {
      languages: [
        {
          name: "python",
          extensions: [".py"],
          files: [],
          skip: {
            directory_names: [],
            directory_prefixes: [],
            directory_suffixes: [],
            directory_markers: [],
            file_globs: [],
          },
        },
      ],
    }),
  );
  writeShim(
    bin,
    "recognizer-scan-alpha",
    manifestFor("scanner", "alpha", RULES("alpha", ".alpha")),
  );

  return { bin, repo };
}

async function withJson(bin: string, repo: string) {
  const listed = await plugins([bin], [repo, "--json"]);
  const text = await plugins([bin], [repo]);

  return {
    code: text.code,
    out: text.out,
    err: text.err,
    entries: JSON.parse(listed.out) as Record<string, unknown>[],
  };
}

describe("recognizer plugins", () => {
  it("lists scanners, then sensors, then describers, each by name, with what uses them", async () => {
    const { bin, repo } = installed();

    writeFileSync(join(repo, "a.py"), "");
    mkdirSync(join(repo, ".recognizer"));
    writeFileSync(
      join(repo, ".recognizer", "config.yaml"),
      "sensors:\n  s:\n    command: [recognizer-sense-s, run]\ndescriber:\n  command: [recognizer-describe-d, run]\n  version: v1\n",
    );

    const { code, out } = await plugins([bin], [repo]);
    const rows = out.trimEnd().split("\n");

    expect(code).toBe(0);
    expect(rows.map((row) => row.split("  ").slice(0, 2).join(" "))).toEqual([
      "scanner alpha",
      "scanner python",
      "sensor s",
      "describer d",
    ]);
    expect(rows[0]).toMatch(/current {2}schema 7 {2}-$/);
    expect(rows[1]).toMatch(/current {2}schema 7 {2}scanner for python$/);
    expect(rows[2]).toMatch(/current {2}registered$/);
    expect(rows[3]).toMatch(/current {2}registered$/);
  });

  it("prints - for sensors and describers when the repository has no config", async () => {
    const { bin, repo } = installed();
    const { out } = await plugins([bin], [repo]);

    expect(out).toMatch(/sensor {2}s {2}.*current {2}-\n/);
    expect(out).toMatch(/describer {2}d {2}.*current {2}-\n/);
  });

  it("prints the array of entries with --json", async () => {
    const { bin, repo } = installed();
    const { out } = await plugins([bin], [repo, "--json"]);
    const entries = JSON.parse(out) as Record<string, unknown>[];

    expect(entries.map((one) => `${one.kind}:${one.name}`)).toEqual([
      "scanner:alpha",
      "scanner:python",
      "sensor:s",
      "describer:d",
    ]);
    expect(entries[0]).toEqual({
      kind: "scanner",
      name: "alpha",
      command: join(bin, "recognizer-scan-alpha"),
      version: "0.1.0",
      protocol: 1,
      range: "current",
      scan_schema_version: 7,
      schema_range: "current",
      used_by: "-",
      install: expect.any(String),
    });
  });

  it("gives every json entry the two schema keys, null and undeclared for a non-scanner", async () => {
    const { bin, repo } = installed();
    const { out } = await plugins([bin], [repo, "--json"]);
    const entries = JSON.parse(out) as Record<string, unknown>[];
    const sensor = entries.find((one) => one.kind === "sensor");

    expect(entries.length).toBeGreaterThan(0);
    expect(sensor).toMatchObject({
      scan_schema_version: null,
      schema_range: "undeclared",
    });

    for (const entry of entries) {
      expect(entry).toHaveProperty("scan_schema_version");
      expect(entry).toHaveProperty("schema_range");
    }
  });

  it("prints schema - for a scanner that declares nothing and exits 0", async () => {
    const bin = tempDirectory("recognizer-plugins-bin-");
    const repo = tempDirectory("recognizer-plugins-repo-");
    const { scan_schema_version: _, ...undeclared } = manifestFor(
      "scanner",
      "plain",
      RULES("plain", ".plain"),
    );

    writeShim(bin, "recognizer-scan-plain", undeclared);

    const { code, out, err } = await plugins([bin], [repo]);

    expect(code).toBe(0);
    expect(out).toMatch(/scanner {2}plain {2}.*current {2}schema - {2}-\n/);
    expect(err).toBe("");
  });

  it("names a scanner on a newer scan schema with the cask fix, exits 1 and still lists the others", async () => {
    const { bin, repo } = installed();

    writeShim(
      bin,
      "recognizer-scan-newer",
      manifestFor("scanner", "newer", {
        ...RULES("newer", ".newer"),
        scan_schema_version: 8,
      }),
    );

    const { code, out, err, entries } = await withJson(bin, repo);

    expect(code).toBe(1);
    expect(out).toContain("scanner  python");
    expect(out).toMatch(/scanner {2}newer {2}.*schema 8 /);
    expect(err).toContain(
      "recognizer-scan-newer writes scan schema 8 and this recognizer reads 7: run brew upgrade --cask kenmclennan/tap/recognizer",
    );
    expect(entries.find((one) => one.name === "newer")).toMatchObject({
      scan_schema_version: 8,
      schema_range: "newer",
    });
  });

  it("names a scanner whose scan schema is broken with its install line", async () => {
    const { bin, repo } = installed();

    writeShim(
      bin,
      "recognizer-scan-stale",
      manifestFor("scanner", "stale", {
        ...RULES("stale", ".stale"),
        scan_schema_version: 6,
        install: "brew upgrade kenmclennan/tap/recognizer-scan-stale",
      }),
    );

    const { code, err, entries } = await withJson(bin, repo);

    expect(code).toBe(1);
    expect(err).toContain(
      "recognizer-scan-stale writes scan schema 6 and this recognizer cannot read it, because a change at or after 7 broke older scans: brew upgrade kenmclennan/tap/recognizer-scan-stale",
    );
    expect(entries.find((one) => one.name === "stale")).toMatchObject({
      schema_range: "broken",
    });
  });

  it("names an unreadable plugin on stderr, exits 1 and still prints the readable ones", async () => {
    const { bin, repo } = installed();

    writeShim(bin, "recognizer-sense-broken", "nope");

    const { code, out, err } = await plugins([bin], [repo]);

    expect(code).toBe(1);
    expect(out).toContain("scanner  python");
    expect(err).toContain(`${join(bin, "recognizer-sense-broken")}: `);
  });

  it("prints nothing and exits 0 when nothing is installed", async () => {
    const empty = tempDirectory("recognizer-plugins-empty-");
    const { code, out } = await plugins([empty], [empty]);

    expect(code).toBe(0);
    expect(out).toBe("");
  });

  it("exits 2 for a repository that is not a folder", async () => {
    const { bin } = installed();
    const { code } = await plugins([bin], ["/no/such/folder"]);

    expect(code).toBe(2);
  });

  it("shows - throughout when the config cannot be read", async () => {
    const { bin, repo } = installed();

    mkdirSync(join(repo, ".recognizer"));
    writeFileSync(join(repo, ".recognizer", "config.yaml"), "sensors: [");

    const { code, out } = await plugins([bin], [repo]);

    expect(code).toBe(0);
    expect(out).not.toContain("registered");
    expect(out).not.toContain("scanner for");
  });
});

describe("schemaMismatchLines", () => {
  function plugin(
    schema: InstalledPlugin["schema"],
    declared?: number,
  ): InstalledPlugin {
    return {
      kind: "scanner",
      name: "x",
      command: "/bin/recognizer-scan-x",
      judgement: "current",
      schema,
      manifest: {
        ...(manifestFor("scanner", "x") as object),
        scan_schema_version: declared,
      } as InstalledPlugin["manifest"],
    };
  }

  it("returns no line for an accepted older scanner", () => {
    expect(schemaMismatchLines([plugin("older", 6)])).toEqual([]);
  });

  it("returns no line for current or undeclared", () => {
    expect(schemaMismatchLines([plugin("current", 7)])).toEqual([]);
    expect(schemaMismatchLines([plugin("undeclared")])).toEqual([]);
  });

  it("returns a line for a newer one", () => {
    expect(schemaMismatchLines([plugin("newer", 8)])).toHaveLength(1);
  });
});
