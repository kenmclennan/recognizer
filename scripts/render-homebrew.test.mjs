import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { render, renderAll } from "./render-homebrew.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TOOLCHAIN = "a".repeat(64);
const APP = "b".repeat(64);

describe("render", () => {
  it("fills every placeholder", () => {
    expect(render("@@a@@-@@b@@", { a: "1", b: "2" })).toBe("1-2");
  });

  it("throws on a missing value", () => {
    expect(() => render("@@a@@-@@b@@", { a: "1" })).toThrow(/No value for b/);
  });
});

describe("renderAll on the committed templates", () => {
  const out = mkdtempSync(join(tmpdir(), "brew-"));

  renderAll(ROOT, "1.2.3", TOOLCHAIN, APP, out);

  const formula = readFileSync(join(out, "Formula/recognizer.rb"), "utf8");
  const cask = readFileSync(join(out, "Casks/recognizer.rb"), "utf8");

  it("puts the version, both URLs and both digests in the output", () => {
    expect(formula).toContain("v1.2.3/recognizer-toolchain.tar.gz");
    expect(formula).toContain(TOOLCHAIN);
    expect(cask).toContain('version "1.2.3"');
    expect(cask).toContain("recognizer.app.tar.gz");
    expect(cask).toContain(APP);
  });

  it("leaves no placeholder behind", () => {
    expect(formula).not.toContain("@@");
    expect(cask).not.toContain("@@");
  });

  it("installs each scanner onto the PATH", () => {
    expect(formula).toContain('libexec.install "node_modules"');
    expect(formula).toContain(
      'bin.install_symlink libexec/"node_modules/recognizer/dist/bin.js" => "recognizer"',
    );
    expect(formula).toContain(
      'bin.install_symlink libexec/"node_modules/recognizer-scan-typescript/dist/bin.js" => "recognizer-scan-typescript"',
    );
    expect(formula).not.toMatch(/npm|std_npm_args|\.tgz/);
    expect(formula).toContain("recognizer-scan-python");
  });

  it("installs the describer, the Kotlin scanner and the Rust binary offline", () => {
    expect(formula).toContain(
      'bin.install_symlink libexec/"node_modules/recognizer-describe-claude/dist/bin.js" => "recognizer-describe-claude"',
    );
    expect(formula).toContain(
      'bin.install_symlink libexec/"venv/bin/recognizer-scan-kotlin"',
    );
    expect(formula).toContain('bin.install "recognizer-scan-rust"');
    expect(formula).toContain('"--no-index", "--find-links", "wheelhouse"');
    expect(formula).toContain("recognizer_scan_kotlin-1.2.3-py3-none-any.whl");
    expect(formula).toContain("depends_on arch: :arm64");
  });

  it("tests the two scanner versions and the describer prompt version", () => {
    expect(formula).toContain(
      'shell_output("#{bin}/recognizer-scan-kotlin --version")',
    );
    expect(formula).toContain(
      'shell_output("#{bin}/recognizer-scan-rust --version")',
    );
    expect(formula).toContain(
      'shell_output("#{bin}/recognizer-describe-claude --prompt-version")',
    );
    expect(formula).toContain("prompt-[0-9a-f]{12}");
  });
});
