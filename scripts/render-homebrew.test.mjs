import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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

  it("depends on Homebrew's node and python@3.13, not on a formula of its own", () => {
    expect(cask).toContain('depends_on formula: "node"');
    expect(cask).toContain('depends_on formula: "python@3.13"');
    expect(cask).not.toContain("kenmclennan/tap/recognizer");
    expect(cask).toContain("depends_on arch: :arm64");
  });

  it("leaves no placeholder behind", () => {
    expect(cask).not.toContain("@@");
  });

  it("links exactly the eight commands onto the PATH", () => {
    expect(
      binaries.map(([, source, target]) => target ?? basename(source)),
    ).toEqual([
      "recognizer",
      "recognizer-scan-typescript",
      "recognizer-describe-claude",
      "recognizer-scan-python",
      "recognizer-scan-kotlin",
      "recognizer-scan-csharp",
      "recognizer-sensors",
      "recognizer-scan-rust",
    ]);

    for (const [, source] of binaries) {
      expect(source).toContain(
        "#{appdir}/Recognizer.app/Contents/Resources/toolchain/",
      );
    }
  });
});
