import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMAND_LINKS } from "./build-toolchain.mjs";
import {
  className,
  render,
  renderAll,
  renderBundle,
  renderCask,
  renderUnit,
} from "./render-homebrew.mjs";
import { makeTempDir } from "./temp-dirs.mjs";
import { allFormulae, loadUnits } from "./units.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const APP = "b".repeat(64);
const UNIT_SHA = "c".repeat(64);

describe("render", () => {
  it("fills every placeholder", () => {
    expect(render("@@a@@-@@b@@", { a: "1", b: "2" })).toBe("1-2");
  });

  it("throws on a missing value", () => {
    expect(() => render("@@a@@-@@b@@", { a: "1" })).toThrow(/No value for b/);
  });

  it("throws on an empty value", () => {
    expect(() => render("@@a@@", { a: "" })).toThrow(/No value for a/);
  });
});

describe("renderCask on the committed template", () => {
  const out = makeTempDir("brew-");

  renderCask(ROOT, "1.2.3", APP, out);

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
    expect(cask).toContain('  depends_on formula: "node"\n');
    expect(cask).toContain(
      '  depends_on formula: "kenmclennan/tap/recognizer-plugins"\n',
    );
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

describe("renderUnit and renderBundle on the committed templates", () => {
  const units = loadUnits(ROOT);

  function formulaFor(unit, name) {
    const out = makeTempDir("brew-unit-");

    renderUnit(ROOT, unit, "4.5.6", UNIT_SHA, out);

    return {
      out,
      text: readFileSync(join(out, "Formula", `${name}.rb`), "utf8"),
    };
  }

  it.each([
    ["scan-python", "recognizer-scan-python", '  depends_on "python@3.13"'],
    ["scan-typescript", "recognizer-scan-typescript", '  depends_on "node"'],
    ["scan-rust", "recognizer-scan-rust", null],
  ])("renders the %s formula with its runtime", (unit, name, runtime) => {
    const { text } = formulaFor(unit, name);
    const dependencies = [...text.matchAll(/^[ \t]*depends_on .*$/gm)].map(
      ([line]) => line,
    );

    expect(text).toContain(`class ${className(name)} < Formula`);
    expect(text).toContain(
      `releases/download/${unit}-v4.5.6/${unit}-4.5.6.tar.gz`,
    );
    expect(text).toContain(UNIT_SHA);
    expect(text).toContain(`bin.install_symlink libexec/"bin/${name}"`);
    expect(text).toContain(`#{bin}/${name} --version`);
    expect(dependencies).toEqual([
      "  depends_on arch: :arm64",
      "  depends_on :macos",
      ...(runtime === null ? [] : [runtime]),
    ]);
    expect(text).not.toContain("@@");
  });

  it("renders the sensors unit as three formulae with one url and different links", () => {
    const out = makeTempDir("brew-sensors-");
    const names = renderUnit(ROOT, "sensors", "4.5.6", UNIT_SHA, out);
    const texts = names.map((name) =>
      readFileSync(join(out, "Formula", `${name}.rb`), "utf8"),
    );
    const urls = texts.map((text) => /^\s*url "([^"]+)"/m.exec(text)[1]);
    const links = texts.map((text) => /install_symlink (.*)$/m.exec(text)[1]);

    expect(names).toEqual([
      "recognizer-sense-crap",
      "recognizer-sense-mutation",
      "recognizer-sense-thresholds",
    ]);
    expect(new Set(urls).size).toBe(1);
    expect(urls[0]).toContain("sensors-v4.5.6/sensors-4.5.6.tar.gz");
    expect(new Set(links).size).toBe(3);
  });

  it("renders the bundle depending on the nine formulae and nothing else", () => {
    const out = makeTempDir("brew-bundle-");

    renderBundle(ROOT, 3, UNIT_SHA, out);

    const text = readFileSync(
      join(out, "Formula/recognizer-plugins.rb"),
      "utf8",
    );
    const dependencies = [...text.matchAll(/depends_on "([^"]+)"/g)].map(
      ([, name]) => name,
    );

    expect(dependencies.sort()).toEqual(
      allFormulae(units)
        .map((one) => one.formula)
        .sort(),
    );
    expect(dependencies).toHaveLength(9);
    expect(text).toContain("recognizer-plugins-v3/recognizer-plugins-3.tar.gz");
    expect(text).toContain("class RecognizerPlugins < Formula");
  });

  it("renders every formula, the bundle and the cask together", () => {
    const out = makeTempDir("brew-all-");

    renderAll(ROOT, "1.2.3", APP, out);

    expect(readdirSync(join(out, "Formula")).sort()).toEqual(
      [
        ...allFormulae(units).map((one) => `${one.formula}.rb`),
        "recognizer-plugins.rb",
      ].sort(),
    );
    expect(readdirSync(join(out, "Casks"))).toEqual(["recognizer.rb"]);
  });

  it("still throws for an empty value", () => {
    expect(() =>
      renderUnit(ROOT, "sensors", "", UNIT_SHA, makeTempDir("x-")),
    ).toThrow(/No value for version/);
  });
});
