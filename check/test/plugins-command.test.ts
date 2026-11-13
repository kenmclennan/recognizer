import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
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
    expect(rows[0]).toMatch(/current {2}-$/);
    expect(rows[1]).toMatch(/current {2}scanner for python$/);
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
      used_by: "-",
      install: expect.any(String),
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
