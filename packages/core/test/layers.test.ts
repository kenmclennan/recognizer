import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const core = resolve(here, "..");
const source = join(core, "src");

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    return entry.isDirectory()
      ? filesUnder(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });
}

function specifiersOf(file: string): string[] {
  const text = readFileSync(file, "utf8");

  return [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
    (match) => match[1] as string,
  );
}

function layerFiles(layer: string): string[] {
  return filesUnder(join(source, layer));
}

function escapes(file: string, allowed: string[]): string[] {
  return specifiersOf(file).filter((specifier) => {
    if (!specifier.startsWith(".")) {
      return true;
    }

    const target = relative(source, resolve(dirname(file), specifier));

    return !allowed.some(
      (layer) => target === layer || target.startsWith(`${layer}/`),
    );
  });
}

function violations(layer: string, allowed: string[]): string[] {
  return layerFiles(layer).flatMap((file) =>
    escapes(file, allowed).map(
      (specifier) => `${relative(core, file)} imports ${specifier}`,
    ),
  );
}

describe("core layers", () => {
  it("domain imports only the domain", () => {
    expect(layerFiles("domain").length).toBeGreaterThan(0);
    expect(violations("domain", ["domain"])).toEqual([]);
  });

  it("ports import only the domain", () => {
    expect(layerFiles("ports").length).toBeGreaterThan(0);
    expect(violations("ports", ["domain", "ports"])).toEqual([]);
  });

  it("application imports only the domain and ports", () => {
    expect(layerFiles("application").length).toBeGreaterThan(0);
    expect(
      violations("application", ["domain", "ports", "application"]),
    ).toEqual([]);
  });

  it("core imports no node module", () => {
    for (const layer of ["domain", "ports", "application"]) {
      expect(layerFiles(layer).length).toBeGreaterThan(0);
    }

    const builtins = new Set(builtinModules);
    const found = filesUnder(source).flatMap((file) =>
      specifiersOf(file)
        .filter(
          (specifier) =>
            specifier.startsWith("node:") || builtins.has(specifier),
        )
        .map((specifier) => `${relative(core, file)} imports ${specifier}`),
    );

    expect(found).toEqual([]);
  });

  it("core depends on no other package", () => {
    const own = JSON.parse(readFileSync(join(core, "package.json"), "utf8"));
    const cli = JSON.parse(
      readFileSync(join(core, "..", "cli", "package.json"), "utf8"),
    );

    expect(own.dependencies ?? {}).toEqual({});
    expect(cli.dependencies["@recognizer/core"]).toBeDefined();
    expect(own.name).toBe("@recognizer/core");
  });
});
