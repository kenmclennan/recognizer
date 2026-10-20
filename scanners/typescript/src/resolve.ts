import { realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import ts from "typescript";

const ASSET_EXTENSIONS = new Set(
  (
    ".css .scss .sass .less .styl .svg .png .jpg .jpeg .gif .webp .avif .ico .bmp " +
    ".json .woff .woff2 .ttf .otf .eot .mp3 .mp4 .webm .wav .ogg .wasm .html .md " +
    ".txt .yaml .yml .csv"
  ).split(" "),
);

export type Target =
  | { kind: "project"; id: string }
  | { kind: "foreign"; name: string }
  | { kind: "none" };

const NONE: Target = { kind: "none" };

export function isAsset(specifier: string): boolean {
  const path = specifier.split("?")[0] ?? "";
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");

  return dot > slash && ASSET_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

function isPathSpecifier(specifier: string): boolean {
  return (
    specifier === "." ||
    specifier === ".." ||
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    isAbsolute(specifier)
  );
}

export function packageName(specifier: string): string {
  if (specifier.startsWith("node:")) {
    return `node:${specifier.slice(5).split("/")[0]}`;
  }

  const segments = specifier.split("/");

  return specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : (segments[0] ?? specifier);
}

function matchesPathKey(
  specifier: string,
  options: ts.CompilerOptions,
): boolean {
  return Object.keys(options.paths ?? {}).some((key) => {
    const star = key.indexOf("*");

    if (star < 0) {
      return key === specifier;
    }

    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);

    return (
      specifier.length >= prefix.length + suffix.length &&
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix)
    );
  });
}

function isNodeNext(options: ts.CompilerOptions): boolean {
  const module = options.module;

  return (
    module !== undefined &&
    module >= ts.ModuleKind.Node16 &&
    module <= ts.ModuleKind.NodeNext
  );
}

export class Resolver {
  private readonly caches = new Map<
    ts.CompilerOptions,
    ts.ModuleResolutionCache
  >();
  private readonly formats = new Map<string, ts.ResolutionMode>();

  constructor(
    private readonly root: string,
    private readonly modules: ReadonlySet<string>,
    private readonly workspaces: ReadonlyMap<string, string>,
  ) {}

  resolve(
    specifier: string,
    containingFile: string,
    options: ts.CompilerOptions,
    commonjs: boolean,
  ): Target {
    if (isAsset(specifier)) {
      return NONE;
    }

    const resolved = ts.resolveModuleName(
      specifier,
      containingFile,
      options,
      ts.sys,
      this.cacheFor(options),
      undefined,
      this.modeFor(containingFile, options, commonjs),
    ).resolvedModule;

    let insideRoot = false;

    if (resolved) {
      const real = this.realRelative(resolved.resolvedFileName);

      if (real !== null && this.modules.has(real)) {
        return { kind: "project", id: real };
      }

      insideRoot = real !== null && !real.split("/").includes("node_modules");
    }

    const name = packageName(specifier);
    const workspace = this.workspaces.get(name);

    if (workspace) {
      const hit = this.viaWorkspace(specifier, name, workspace, options);

      if (hit) {
        return hit;
      }
    }

    if (isPathSpecifier(specifier) || insideRoot) {
      return NONE;
    }

    if (!resolved && (workspace || matchesPathKey(specifier, options))) {
      return NONE;
    }

    return { kind: "foreign", name };
  }

  private viaWorkspace(
    specifier: string,
    name: string,
    workspace: string,
    options: ts.CompilerOptions,
  ): Target | null {
    const subpath = specifier.slice(name.length).replace(/^\//, "");
    const candidates = subpath
      ? [subpath, `src/${subpath}`]
      : ["src/index", "index"];

    for (const candidate of candidates) {
      const resolved = ts.resolveModuleName(
        `./${candidate}`,
        join(workspace, "index.ts"),
        options,
        ts.sys,
        this.cacheFor(options),
        undefined,
        isNodeNext(options) ? ts.ModuleKind.CommonJS : undefined,
      ).resolvedModule;

      const real = resolved
        ? this.realRelative(resolved.resolvedFileName)
        : null;

      if (real !== null && this.modules.has(real)) {
        return { kind: "project", id: real };
      }
    }

    return null;
  }

  private realRelative(file: string): string | null {
    let real = file;

    try {
      real = realpathSync(file);
    } catch {
      real = file;
    }

    const path = relative(this.root, real);

    if (path === "" || path.startsWith("..") || isAbsolute(path)) {
      return null;
    }

    return path.split(sep).join("/");
  }

  private cacheFor(options: ts.CompilerOptions): ts.ModuleResolutionCache {
    let cache = this.caches.get(options);

    if (!cache) {
      cache = ts.createModuleResolutionCache(
        this.root,
        (name) => name,
        options,
      );
      this.caches.set(options, cache);
    }

    return cache;
  }

  private modeFor(
    file: string,
    options: ts.CompilerOptions,
    commonjs: boolean,
  ): ts.ResolutionMode {
    if (!isNodeNext(options)) {
      return undefined;
    }

    if (commonjs) {
      return ts.ModuleKind.CommonJS;
    }

    const key = `${file}\0${options.module}`;

    if (!this.formats.has(key)) {
      this.formats.set(
        key,
        ts.getImpliedNodeFormatForFile(
          file as ts.Path,
          this.cacheFor(options).getPackageJsonInfoCache(),
          ts.sys,
          options,
        ),
      );
    }

    return this.formats.get(key);
  }
}
