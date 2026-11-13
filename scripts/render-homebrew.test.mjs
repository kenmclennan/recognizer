import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMAND_LINKS } from "./build-toolchain.mjs";
import { render, renderAll } from "./render-homebrew.mjs";
import { makeTempDir } from "./temp-dirs.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const APP = "b".repeat(64);

describe("render", () => {
  it("fills every placeholder", () => {
    expect(render("@@a@@-@@b@@", { a: "1", b: "2" })).toBe("1-2");
  });

  it("throws on a missing value", () => {
    expect(() => render("@@a@@-@@b@@", { a: "1" })).toThrow(/No value for b/);
  });
});

describe("renderAll on the committed template", () => {
  const out = makeTempDir("brew-");

  renderAll(ROOT, "1.2.3", APP, out);

  const cask = readFileSync(join(out, "Casks/recognizer.rb"), "utf8");
  const binaries = [
    ...cask.matchAll(/^\s*binary "([^"]+)"(?:, target: "([^"]+)")?/gm),
  ];

  it("writes only the cask", () => {
    expect(readdirSync(out)).toEqual(["Casks"]);
    expect(readdirSync(join(out, "Casks"))).toEqual(["recognizer.rb"]);
    expect(
      existsSync(join(ROOT, "packaging/homebrew/recognizer.rb.tmpl")),
    ).toBe(false);
  });

  it("puts the version, the URL and the digest in the output", () => {
    expect(cask).toContain('version "1.2.3"');
    expect(cask).toContain("recognizer.app.tar.gz");
    expect(cask).toContain(APP);
  });

  it("depends on node and the plugins bundle and on no other formula", () => {
    const formulae = [...cask.matchAll(/depends_on formula: "([^"]+)"/g)].map(
      ([, name]) => name,
    );

    expect(formulae).toEqual(["node", "kenmclennan/tap/recognizer-plugins"]);
    expect(cask).not.toContain("python@3.13");
    expect(cask).toContain("depends_on arch: :arm64");
  });

  it("leaves no placeholder behind", () => {
    expect(cask).not.toContain("@@");
  });

  it("links exactly the toolchain commands onto the PATH", () => {
    expect(
      binaries.map(([, source, target]) => target ?? basename(source)),
    ).toEqual(COMMAND_LINKS.map(([name]) => name));
    expect(binaries).toHaveLength(1);

    for (const [, source, target] of binaries) {
      expect(source).toContain(
        "#{appdir}/Recognizer.app/Contents/Resources/toolchain/commands/",
      );
      expect(target).toBeUndefined();
    }
  });

  it("has no preflight_steps and keeps the quarantine postflight", () => {
    expect(cask).not.toContain("preflight_steps");
    expect(cask).toContain("postflight_steps do");
  });
});
