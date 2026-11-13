import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { parseConfig } from "../src/config-parse.js";
import { REPO } from "./helpers.js";
import { fakeIo, ROOT } from "./scan-helpers.js";

const CONFIG = `${ROOT}/.recognizer/config.yaml`;

async function config(files: Record<string, string>, ...args: string[]) {
  const fake = fakeIo({ files });
  const code = await run(["config", ...args, "--repository", ROOT], fake.io);

  return { code, fake, text: fake.files.get(CONFIG), err: fake.err() };
}

describe("config: scanners and install", () => {
  it("parses both sections", () => {
    expect(
      parseConfig(
        "scanners:\n  csharp: csharp-alt\ninstall:\n  recognizer-sense-crap: get crap\n",
      ),
    ).toEqual({
      scanners: { csharp: "csharp-alt" },
      install: { "recognizer-sense-crap": "get crap" },
    });
  });

  it.each([
    ["scanners:\n  Py: x\n", "scanners"],
    ["scanners:\n  python: Bad_Name\n", "scanners"],
    ["scanners:\n  python: 3\n", "scanners"],
    ["install:\n  foo: x\n", "install"],
    ["install:\n  recognizer-sense-crap: ''\n", "install"],
    ["install:\n  recognizer-sense-crap: 3\n", "install"],
  ])("refuses %j", (text, section) => {
    expect(() => parseConfig(text)).toThrow(section);
  });

  it("keeps the sections only when they are read", () => {
    const text = "scanners:\n  python: x\ninstall:\n  recognizer-scan-x: y\n";

    expect(parseConfig(text, ["scanners"])).toEqual({
      scanners: { python: "x" },
    });
    expect(parseConfig(text, ["sensors"])).toEqual({});
  });

  it("sets and unsets scanners.<language> through recognizer config", async () => {
    const set = await config({}, "scanners.python", "python-alt");

    expect(set.code).toBe(0);
    expect(set.text).toContain("python: python-alt");

    const again = await config(
      { [CONFIG]: set.text as string },
      "--get",
      "scanners.python",
    );

    expect(again.code).toBe(0);
    expect(again.fake.out()).toBe("python-alt\n");

    const unset = await config(
      { [CONFIG]: set.text as string },
      "--unset",
      "scanners.python",
    );

    expect(unset.code).toBe(0);
    expect(unset.text).not.toContain("python-alt");
  });

  it("sets install.<program> through recognizer config", async () => {
    const set = await config({}, "install.recognizer-sense-crap", "get crap");

    expect(set.code).toBe(0);
    expect(parseConfig(set.text as string).install).toEqual({
      "recognizer-sense-crap": "get crap",
    });
  });

  it("refuses an install key that is not a plugin program", async () => {
    const refused = await config({}, "install.foo", "x");

    expect(refused.code).toBe(2);
  });

  it("lists scanners and install among the keys", async () => {
    const listed = await config({}, "--list");

    expect(listed.code).toBe(0);
  });
});

describe("the committed config examples", () => {
  const valid = join(REPO, "schema/config-examples/valid");

  it.each(readdirSync(valid))("%s still validates", (name) => {
    expect(() =>
      parseConfig(readFileSync(join(valid, name), "utf8")),
    ).not.toThrow();
  });

  it("validates this repository's own config", () => {
    expect(() =>
      parseConfig(readFileSync(join(REPO, ".recognizer/config.yaml"), "utf8")),
    ).not.toThrow();
  });
});
