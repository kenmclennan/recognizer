import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, posix, relative, resolve } from "node:path";
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

const application = join(source, "application");
const SUBDOMAINS = ["run", "scanning", "describing", "sensing", "analysis"];
const SHARED_PORTS = ["clock", "git", "process", "store"];
const RUN_PORTS = SHARED_PORTS;

function misplacedSharedPort(file: string): boolean {
  const match = /^shared\/ports\/([^/]+)\.ts$/.exec(file);

  return match !== null && !SHARED_PORTS.includes(match[1] as string);
}

function targetOf(file: string, specifier: string): string {
  return posix.normalize(posix.join(posix.dirname(file), specifier));
}

function reachesInside(file: string, specifier: string): boolean {
  if (!specifier.startsWith(".")) {
    return false;
  }

  const own = file.split("/")[0];
  const segments = targetOf(file, specifier).split("/");

  return (
    SUBDOMAINS.includes(segments[0] as string) &&
    segments[0] !== own &&
    segments.length > 2
  );
}

function reachesSubdomain(file: string, specifier: string): boolean {
  return (
    specifier.startsWith(".") &&
    SUBDOMAINS.includes(targetOf(file, specifier).split("/")[0] as string)
  );
}

function importsPhasePort(file: string, specifier: string): boolean {
  if (!specifier.startsWith(".")) {
    return false;
  }

  const target = targetOf(file, specifier);
  const segments = target.split("/");

  if (!segments.includes("ports")) {
    return false;
  }

  return !(
    target.startsWith("run/ports/") ||
    RUN_PORTS.some((name) => target === `shared/ports/${name}.js`)
  );
}

function applicationFiles(folder: string): string[] {
  return filesUnder(join(application, folder)).map((file) =>
    relative(application, file),
  );
}

function offences(
  folder: string,
  offends: (file: string, specifier: string) => boolean,
): string[] {
  return applicationFiles(folder).flatMap((file) =>
    specifiersOf(join(application, file))
      .filter((specifier) => offends(file, specifier))
      .map((specifier) => `${file} imports ${specifier}`),
  );
}

function offencesOutside(
  skip: (file: string) => boolean,
  offends: (file: string, specifier: string) => boolean,
): string[] {
  return filesUnder(application)
    .map((file) => relative(application, file))
    .filter((file) => !skip(file))
    .flatMap((file) =>
      specifiersOf(join(application, file))
        .filter((specifier) => offends(file, specifier))
        .map((specifier) => `${file} imports ${specifier}`),
    );
}

const DOMAIN_FOLDERS = [
  "run",
  "scanning",
  "describing",
  "sensing",
  "analysis",
  "configuration",
  "history",
];

const domain = join(source, "domain");

function readsDomainFolder(file: string, specifier: string): boolean {
  if (!specifier.startsWith(".")) {
    return false;
  }

  const segments = targetOf(file, specifier).split("/");

  if (segments[0] !== ".." || segments[1] !== "domain") {
    return false;
  }

  const folder = segments[2] as string;

  if (!DOMAIN_FOLDERS.includes(folder) || segments.length < 4) {
    return false;
  }

  const own = file === "compose.ts" ? "run" : file.split("/")[0];

  return own !== folder;
}

function reachesDomainSubfolder(file: string, specifier: string): boolean {
  if (!specifier.startsWith(".")) {
    return false;
  }

  const segments = targetOf(file, specifier).split("/");

  return (
    DOMAIN_FOLDERS.includes(segments[0] as string) &&
    segments.length > 1 &&
    file.split("/")[0] !== segments[0]
  );
}

describe("core layers", () => {
  it("domain imports only the domain", () => {
    expect(layerFiles("domain").length).toBeGreaterThan(0);
    expect(violations("domain", ["domain"])).toEqual([]);
  });

  it("application imports only the domain and itself", () => {
    expect(layerFiles("application").length).toBeGreaterThan(0);
    expect(violations("application", ["domain", "application"])).toEqual([]);
    expect(
      filesUnder(application).filter((file) => file.endsWith("/index.ts")),
    ).toEqual([]);
  });

  it("core imports no node module", () => {
    for (const layer of ["domain", "application"]) {
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

  it("core has no top-level ports folder", () => {
    expect(existsSync(join(source, "ports"))).toBe(false);
    expect(existsSync(join(source, "application"))).toBe(true);
  });

  it("core has no barrel except the root", () => {
    const files = filesUnder(source);

    expect(files).toContain(join(source, "index.ts"));
    expect(
      files.filter(
        (file) =>
          file.endsWith("/index.ts") && file !== join(source, "index.ts"),
      ),
    ).toEqual([]);
  });

  it("ports sit in the subdomain the design names", () => {
    const named = [
      "scanning/ports/scanners.ts",
      "describing/ports/describer.ts",
      "describing/ports/confirm.ts",
      "shared/ports/clock.ts",
      "shared/ports/git.ts",
      "shared/ports/process.ts",
      "shared/ports/store.ts",
      "analysis/ports/analysis.ts",
      "sensing/ports/sensors.ts",
      "describing/ports/describer-ref.ts",
      "run/ports/scan.ts",
    ];

    for (const folder of [...SUBDOMAINS, "shared"]) {
      expect(existsSync(join(application, folder))).toBe(true);
    }

    for (const port of named) {
      expect(existsSync(join(application, port)), port).toBe(true);
    }
  });

  it("shared ports hold only cross-cutting infrastructure", () => {
    const shared = applicationFiles("shared/ports");

    expect(shared.length).toBeGreaterThan(0);
    expect(misplacedSharedPort("shared/ports/sensors.ts")).toBe(true);
    expect(misplacedSharedPort("shared/ports/analysis.ts")).toBe(true);
    expect(misplacedSharedPort("shared/ports/store.ts")).toBe(false);
    expect(shared.filter(misplacedSharedPort)).toEqual([]);
    expect(misplacedSharedPort("shared/ports/opaque.ts")).toBe(true);
    expect(misplacedSharedPort("shared/ports/describer-ref.ts")).toBe(true);
    expect(
      shared.map((file) => file.replace(/^shared\/ports\//, "")).sort(),
    ).toEqual(SHARED_PORTS.map((name) => `${name}.ts`).sort());
  });

  it("the describer handle is named only inside describing", () => {
    const names = (file: string) =>
      /\bDescriberRef\b/.test(readFileSync(join(application, file), "utf8"));
    const outside = (file: string) => !file.startsWith("describing/");

    expect(outside("sensing/x.ts")).toBe(true);
    expect(outside("describing/x.ts")).toBe(false);
    expect(
      filesUnder(application)
        .map((file) => relative(application, file))
        .filter(outside)
        .filter(names),
    ).toEqual([]);
  });

  it("opaque.ts is gone and the core root exports the moved types", () => {
    expect(existsSync(join(application, "shared/ports/opaque.ts"))).toBe(false);

    for (const file of ["repository", "config-document", "policy-rule"]) {
      expect(existsSync(join(source, "domain", `${file}.ts`)), file).toBe(true);
    }

    const root = readFileSync(join(source, "index.ts"), "utf8");

    expect(root).not.toMatch(/opaque/);
    expect(root).toMatch(/domain\/repository\.js/);
  });

  it("a subdomain imports another only from its use-case files", () => {
    for (const folder of SUBDOMAINS) {
      expect(applicationFiles(folder).length).toBeGreaterThan(0);
    }

    expect(reachesInside("analysis/x.ts", "../sensing/ports/sensors.js")).toBe(
      true,
    );
    expect(
      reachesInside("analysis/x.ts", "../sensing/internal/helper.js"),
    ).toBe(true);
    expect(
      reachesInside("analysis/x.ts", "../sensing/read-run-config.js"),
    ).toBe(false);
    expect(reachesInside("sensing/x.ts", "../shared/ports/store.js")).toBe(
      false,
    );
    expect(reachesInside("sensing/x.ts", "./internal/sensing-ports.js")).toBe(
      false,
    );

    expect(
      offencesOutside((file) => file === "compose.ts", reachesInside),
    ).toEqual([]);
  });

  it("shared reaches no subdomain", () => {
    expect(applicationFiles("shared").length).toBeGreaterThan(0);
    expect(reachesSubdomain("shared/ports/x.ts", "../../run/phases.js")).toBe(
      true,
    );
    expect(reachesSubdomain("shared/ports/x.ts", "./store.js")).toBe(false);
    expect(offences("shared", reachesSubdomain)).toEqual([]);
  });

  it("only compose and the root reach run", () => {
    expect(applicationFiles("run").length).toBeGreaterThan(0);

    const reachesRun = (file: string, specifier: string) =>
      specifier.startsWith(".") &&
      targetOf(file, specifier).split("/")[0] === "run" &&
      file.split("/")[0] !== "run";

    expect(reachesRun("scanning/x.ts", "../run/phases.js")).toBe(true);
    expect(reachesRun("run/x.ts", "./phases.js")).toBe(false);
    expect(
      offencesOutside(
        (file) => file === "compose.ts" || file.startsWith("run/"),
        reachesRun,
      ),
    ).toEqual([]);
  });

  it("run imports no phase port", () => {
    expect(applicationFiles("run").length).toBeGreaterThan(0);
    expect(importsPhasePort("run/x.ts", "../sensing/ports/sensors.js")).toBe(
      true,
    );
    expect(importsPhasePort("run/x.ts", "../analysis/ports/analysis.js")).toBe(
      true,
    );
    expect(importsPhasePort("run/x.ts", "../scanning/ports/scanners.js")).toBe(
      true,
    );
    expect(importsPhasePort("run/x.ts", "../shared/ports/store.js")).toBe(
      false,
    );
    expect(importsPhasePort("run/x.ts", "./ports/scan.js")).toBe(false);
    expect(offences("run", importsPhasePort)).toEqual([]);
  });

  it("run files call no phase port", () => {
    const files = applicationFiles("run");

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const text = readFileSync(join(application, file), "utf8").replace(
        /from "[^"]*"/g,
        "from",
      );

      expect(text.length).toBeGreaterThan(0);
      expect(text, file).not.toMatch(
        /\b(scanners|sensors|analysis|describer|confirm)\./,
      );
    }
  });

  it("core names no plugin", () => {
    const word = ["struc", "ture"].join("");

    const everyFile = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);

        if (entry.isDirectory()) {
          return ["node_modules", "dist"].includes(entry.name)
            ? []
            : everyFile(path);
        }

        return [path];
      });

    const files = everyFile(core);

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      expect(relative(core, file).toLowerCase(), file).not.toContain(word);

      const lines = readFileSync(file, "utf8")
        .replace(/infrastructure/gi, "")
        .split("\n");

      for (const line of lines) {
        expect(line.toLowerCase(), file).not.toContain(word);
      }
    }
  });

  it("domain holds only the folders the design names", () => {
    const unnamed = (names: string[]) =>
      names.filter((name) => !DOMAIN_FOLDERS.includes(name));
    const actual = readdirSync(domain, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(unnamed(["shared"])).toEqual(["shared"]);
    expect(actual).toContain("run");
    expect(actual).toContain("sensing");
    expect(unnamed(actual)).toEqual([]);
  });

  it("a type read by one subdomain lives in its folder", () => {
    for (const file of [
      "scan-plan.ts",
      "scan-status.ts",
      "sensor-request.ts",
      "run/scan-outcome.ts",
      "run/scan-request.ts",
      "run/scan-plan.ts",
      "sensing/tick-state.ts",
    ]) {
      expect(existsSync(join(domain, file)), file).toBe(true);
    }

    for (const file of ["scan-outcome.ts", "scan-request.ts"]) {
      expect(existsSync(join(domain, file)), file).toBe(false);
    }
  });

  it("a subdomain's domain folder is read only by its own application folder", () => {
    expect(
      readsDomainFolder("scanning/x.ts", "../../domain/run/scan-request.js"),
    ).toBe(true);
    expect(
      readsDomainFolder("run/scan-flow.ts", "../../domain/run/scan-request.js"),
    ).toBe(false);
    expect(
      readsDomainFolder(
        "shared/ports/store.ts",
        "../../../domain/sensing/tick-state.js",
      ),
    ).toBe(true);
    expect(
      readsDomainFolder("compose.ts", "../domain/run/scan-outcome.js"),
    ).toBe(false);
    expect(
      readsDomainFolder("compose.ts", "../domain/sensing/tick-state.js"),
    ).toBe(true);
    expect(readsDomainFolder("run/x.ts", "../../domain/gap.js")).toBe(false);

    expect(filesUnder(application).length).toBeGreaterThan(0);
    expect(offencesOutside(() => false, readsDomainFolder)).toEqual([]);
  });

  it("domain files reach a subfolder only from inside it", () => {
    expect(reachesDomainSubfolder("scan-plan.ts", "./run/scan-plan.js")).toBe(
      true,
    );
    expect(reachesDomainSubfolder("run/x.ts", "../gap.js")).toBe(false);
    expect(reachesDomainSubfolder("run/x.ts", "./y.js")).toBe(false);
    expect(reachesDomainSubfolder("run/x.ts", "../sensing/tick-state.js")).toBe(
      true,
    );

    const files = filesUnder(domain);

    expect(files.length).toBeGreaterThan(0);

    const found = files.flatMap((file) => {
      const name = relative(domain, file);

      return specifiersOf(file)
        .filter((specifier) => reachesDomainSubfolder(name, specifier))
        .map((specifier) => `${name} imports ${specifier}`);
    });

    expect(found).toEqual([]);
  });

  it("the root re-exports every domain file", () => {
    const missing = (root: string, files: string[]) =>
      files.filter(
        (file) => !root.includes(`export * from "./domain/${file}.js";`),
      );
    const files = filesUnder(domain).map((file) =>
      relative(domain, file).replace(/\.ts$/, ""),
    );
    const root = readFileSync(join(source, "index.ts"), "utf8");

    expect(
      missing('export * from "./domain/gap.js";', ["gap", "run/x"]),
    ).toEqual(["run/x"]);
    expect(files.length).toBeGreaterThan(0);
    expect(missing(root, files)).toEqual([]);
  });
});
