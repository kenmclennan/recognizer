import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
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

async function add(bin: string, repo: string, args: string[]): Promise<Out> {
  let out = "";
  let err = "";
  const io = {
    ...ioWithPath([bin]),
    stdout: (text: string) => {
      out += text;
    },
    stderr: (text: string) => {
      err += text;
    },
  };
  const code = await run(["plugin", "add", ...args, "--repository", repo], io);

  return { code, out, err };
}

function configOf(repo: string): string {
  return readFileSync(join(repo, ".recognizer", "config.yaml"), "utf8");
}

function fresh() {
  return {
    bin: tempDirectory("recognizer-add-bin-"),
    repo: tempDirectory("recognizer-add-repo-"),
  };
}

describe("recognizer plugin add", () => {
  it("registers a shipped-named sensor as an empty mapping and records its install line", async () => {
    const { bin, repo } = fresh();

    writeShim(
      bin,
      "recognizer-sense-crap",
      manifestFor("sensor", "crap", { install: "get crap" }),
    );

    const { code, out } = await add(bin, repo, ["crap"]);

    expect(code).toBe(0);
    expect(out).toContain("registered as sensors.crap");
    expect(parse(configOf(repo))).toEqual({
      sensors: { crap: {} },
      install: { "recognizer-sense-crap": "get crap" },
    });
  });

  it("registers a third-party sensor with the words of its command", async () => {
    const { bin, repo } = fresh();

    writeShim(
      bin,
      "recognizer-sense-mine",
      manifestFor("sensor", "mine", { install: "get mine" }),
    );

    expect((await add(bin, repo, ["mine"])).code).toBe(0);
    expect(parse(configOf(repo))).toEqual({
      sensors: {
        mine: {
          command: [
            "recognizer-sense-mine",
            "run",
            "--repository",
            "{repository}",
            "--commit",
            "{commit}",
            "--output",
            "{output}",
          ],
        },
      },
      install: { "recognizer-sense-mine": "get mine" },
    });
  });

  it("registers a describer with its command, version and install line", async () => {
    const { bin, repo } = fresh();

    writeShim(
      bin,
      "recognizer-describe-d",
      manifestFor("describer", "d", {
        prompt_version: "p-1",
        install: "get d",
      }),
    );

    expect((await add(bin, repo, ["d"])).code).toBe(0);
    expect(parse(configOf(repo))).toEqual({
      describer: {
        command: [
          "recognizer-describe-d",
          "run",
          "--model",
          "{model}",
          "{request}",
        ],
        version: "p-1",
      },
      install: { "recognizer-describe-d": "get d" },
    });
  });

  it("refuses a second, different describer, names the first and writes nothing", async () => {
    const { bin, repo } = fresh();

    writeShim(
      bin,
      "recognizer-describe-d",
      manifestFor("describer", "d", { prompt_version: "p-1" }),
    );
    writeShim(
      bin,
      "recognizer-describe-e",
      manifestFor("describer", "e", { prompt_version: "p-2" }),
    );
    await add(bin, repo, ["d"]);

    const before = configOf(repo);
    const { code, err } = await add(bin, repo, ["e"]);

    expect(code).toBe(2);
    expect(err).toContain("recognizer-describe-d");
    expect(configOf(repo)).toBe(before);
  });

  it("needs --kind when the name is both a sensor and a describer", async () => {
    const { bin, repo } = fresh();

    writeShim(bin, "recognizer-sense-both", manifestFor("sensor", "both"));
    writeShim(
      bin,
      "recognizer-describe-both",
      manifestFor("describer", "both", { prompt_version: "p" }),
    );

    const refused = await add(bin, repo, ["both"]);

    expect(refused.code).toBe(2);
    expect(refused.err).toContain("--kind");
    expect(existsSync(join(repo, ".recognizer", "config.yaml"))).toBe(false);
    expect((await add(bin, repo, ["both", "--kind", "describer"])).code).toBe(
      0,
    );
    expect(parse(configOf(repo)).describer.command[0]).toBe(
      "recognizer-describe-both",
    );
  });

  it("exits 2 for a scanner name and names the way to choose it", async () => {
    const { bin, repo } = fresh();

    writeShim(bin, "recognizer-scan-python", manifestFor("scanner", "python"));

    const { code, err } = await add(bin, repo, ["python"]);

    expect(code).toBe(2);
    expect(err).toContain("recognizer config scanners.<language> python");
  });

  it("exits 2 naming the programs it looked for when the plugin is not installed", async () => {
    const { bin, repo } = fresh();
    const { code, err } = await add(bin, repo, ["ghost"]);

    expect(code).toBe(2);
    expect(err).toContain("recognizer-sense-ghost");
    expect(err).toContain("recognizer-describe-ghost");
  });

  it("refuses a plugin outside the protocol range with exit 1 and writes nothing", async () => {
    const { bin, repo } = fresh();

    writeShim(
      bin,
      "recognizer-sense-old",
      manifestFor("sensor", "old", { protocol: 9, install: "get old" }),
    );

    const { code, err } = await add(bin, repo, ["old"]);

    expect(code).toBe(1);
    expect(err).toContain("recognizer-sense-old");
    expect(err).toContain("protocol 9");
    expect(err).toContain("protocol 1");
    expect(err).toContain("get old");
    expect(existsSync(join(repo, ".recognizer", "config.yaml"))).toBe(false);
  });

  it("says already registered and leaves the file byte-identical when run twice", async () => {
    const { bin, repo } = fresh();

    writeShim(
      bin,
      "recognizer-sense-mine",
      manifestFor("sensor", "mine", { install: "get mine" }),
    );
    await add(bin, repo, ["mine"]);

    const once = configOf(repo);
    const second = await add(bin, repo, ["mine"]);

    expect(second.code).toBe(0);
    expect(second.out).toContain("already registered");
    expect(configOf(repo)).toBe(once);
  });

  it("replaces a recorded install line with the manifest's on a second run", async () => {
    const { bin, repo } = fresh();

    writeShim(
      bin,
      "recognizer-sense-mine",
      manifestFor("sensor", "mine", { install: "get mine" }),
    );
    await add(bin, repo, ["mine"]);
    writeShim(
      bin,
      "recognizer-sense-mine",
      manifestFor("sensor", "mine", { install: "get mine v2" }),
    );

    const second = await add(bin, repo, ["mine"]);

    expect(second.out).toContain("already registered");
    expect(parse(configOf(repo)).install).toEqual({
      "recognizer-sense-mine": "get mine v2",
    });
  });

  it("keeps the settings of an already registered shipped sensor", async () => {
    const { bin, repo } = fresh();

    writeShim(bin, "recognizer-sense-crap", manifestFor("sensor", "crap"));
    mkdirSync(join(repo, ".recognizer"));
    writeFileSync(
      join(repo, ".recognizer", "config.yaml"),
      "sensors:\n  crap:\n    threshold: 20\n",
    );

    expect((await add(bin, repo, ["crap"])).code).toBe(0);
    expect(parse(configOf(repo)).sensors.crap).toEqual({ threshold: 20 });
  });

  it("exits 2 for a missing name and for an unknown kind", async () => {
    const { bin, repo } = fresh();

    expect((await add(bin, repo, [])).code).toBe(2);
    expect((await add(bin, repo, ["x", "--kind", "scanner"])).code).toBe(2);
  });
});
