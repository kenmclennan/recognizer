import { readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import ts from "typescript";
import { isSkippedDirectory } from "./files.js";

const NO_INPUTS = 18003;
const DECLARATION = /\.d\.[mc]?ts$/;

function commonDirectory(files: string[]): string | null {
  const [first, ...rest] = files.map((file) => dirname(file).split(sep));

  if (!first) {
    return null;
  }

  let length = first.length;

  for (const parts of rest) {
    let at = 0;

    while (at < length && at < parts.length && parts[at] === first[at]) {
      at += 1;
    }

    length = at;
  }

  return first.slice(0, length).join(sep) || sep;
}

interface ParsedConfig {
  path: string;
  options: ts.CompilerOptions;
  files: Set<string>;
  references: string[];
}

export interface OutputMapping {
  outDir: string;
  rootDir: string;
}

export interface SkippedProject {
  directory: string;
  config: string;
  message: string;
  inside: string | null;
}

const DEFAULT_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
};

export class TsconfigOptions {
  private readonly parsed = new Map<string, ParsedConfig | null>();
  private readonly nearest = new Map<string, string | null>();
  private readonly withJs = new WeakMap<
    ts.CompilerOptions,
    ts.CompilerOptions
  >();
  private readonly problems = new Map<string, string[]>();
  private readonly read = new Set<string>();

  constructor(private readonly root: string) {}

  optionsFor(file: string): ts.CompilerOptions {
    const configPath = this.nearestConfig(dirname(file));

    if (!configPath) {
      return DEFAULT_OPTIONS;
    }

    const config = this.parse(configPath);

    if (!config) {
      return DEFAULT_OPTIONS;
    }

    if (config.files.has(file)) {
      return this.allowJs(config.options);
    }

    const references = config.references
      .map((path) => this.parse(path))
      .filter((reference): reference is ParsedConfig => reference !== null);

    const listing = references.find((reference) => reference.files.has(file));

    if (listing) {
      return this.allowJs(listing.options);
    }

    const solutionStyle =
      config.references.length > 0 && config.files.size === 0;
    const first = references[0];

    if (solutionStyle && first) {
      return this.allowJs(first.options);
    }

    return this.allowJs(config.options);
  }

  readFiles(): string[] {
    return [...this.read]
      .filter((path) => !this.outside(path))
      .map((path) => this.idOf(path));
  }

  outputMappings(directory: string): OutputMapping[] {
    const mappings: OutputMapping[] = [];
    const seen = new Set<string>();

    const visit = (path: string) => {
      if (seen.has(path)) {
        return;
      }

      seen.add(path);

      const config = this.parse(path);

      if (!config) {
        return;
      }

      const mapping = this.mappingOf(config);

      if (mapping) {
        mappings.push(mapping);
      }

      for (const reference of config.references) {
        visit(reference);
      }
    };

    visit(join(directory, "tsconfig.json"));

    return mappings;
  }

  private mappingOf(config: ParsedConfig): OutputMapping | null {
    const { outDir, rootDir, noEmit } = config.options;

    if (noEmit === true || typeof outDir !== "string") {
      return null;
    }

    const root =
      typeof rootDir === "string"
        ? rootDir
        : (commonDirectory(
            [...config.files].filter((file) => !DECLARATION.test(file)),
          ) ?? dirname(config.path));

    if (this.outside(outDir) || this.outside(root)) {
      return null;
    }

    return { outDir: this.idOf(outDir), rootDir: this.idOf(root) };
  }

  private outside(path: string): boolean {
    const id = relative(this.root, path);

    return id === ".." || id.startsWith(`..${sep}`) || isAbsolute(id);
  }

  skippedProjects(): SkippedProject[] {
    const directories = this.projectDirectories();
    const failing = new Map<string, SkippedProject>();

    for (const directory of directories) {
      const failure = this.failureFrom(join(directory, "tsconfig.json"));

      if (failure) {
        failing.set(directory, {
          directory: this.idOf(directory),
          config: this.idOf(failure.path),
          message: failure.message,
          inside: null,
        });
      }
    }

    const records = [...failing.values()];

    for (const directory of directories) {
      const id = this.idOf(directory);

      if (failing.has(directory)) {
        continue;
      }

      const outer = records
        .filter((record) => isUnder(id, record.directory))
        .sort((a, b) => a.directory.length - b.directory.length)[0];

      if (outer) {
        records.push({
          directory: id,
          config: "",
          message: "",
          inside: outer.directory,
        });
      }
    }

    return records.sort((a, b) =>
      a.directory < b.directory ? -1 : a.directory > b.directory ? 1 : 0,
    );
  }

  private idOf(path: string): string {
    const id = relative(this.root, path).split(sep).join("/");

    return id === "" ? "." : id;
  }

  private projectDirectories(): string[] {
    const found: string[] = [];

    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!isSkippedDirectory(entry.name)) {
            walk(join(directory, entry.name));
          }
        } else if (entry.name === "tsconfig.json") {
          found.push(directory);
        }
      }
    };

    walk(this.root);

    return found;
  }

  private failureFrom(
    path: string,
    seen: Set<string> = new Set(),
  ): { path: string; message: string } | null {
    if (seen.has(path)) {
      return null;
    }

    seen.add(path);

    const config = this.parse(path);

    if (!config) {
      const messages = this.problems.get(path) ?? [];

      return { path, message: messages.join("; ") };
    }

    for (const reference of config.references) {
      const failure = this.failureFrom(reference, seen);

      if (failure) {
        return failure;
      }
    }

    return null;
  }

  private allowJs(options: ts.CompilerOptions): ts.CompilerOptions {
    let copy = this.withJs.get(options);

    if (!copy) {
      copy = { ...options, allowJs: true };
      this.withJs.set(options, copy);
    }

    return copy;
  }

  private nearestConfig(directory: string): string | null {
    const cached = this.nearest.get(directory);

    if (cached !== undefined) {
      return cached;
    }

    const candidate = join(directory, "tsconfig.json");
    let found: string | null = null;

    if (ts.sys.fileExists(candidate)) {
      found = candidate;
    } else if (directory !== this.root && dirname(directory) !== directory) {
      found = this.nearestConfig(dirname(directory));
    }

    this.nearest.set(directory, found);

    return found;
  }

  private parse(path: string): ParsedConfig | null {
    if (this.parsed.has(path)) {
      return this.parsed.get(path) ?? null;
    }

    this.parsed.set(path, null);

    const source = ts.readJsonConfigFile(path, ts.sys.readFile);
    const diagnostics: ts.Diagnostic[] = [];
    const first = (source as unknown as { parseDiagnostics: ts.Diagnostic[] })
      .parseDiagnostics[0];

    if (typeof source.text === "string") {
      this.read.add(path);
    }

    if (first) {
      diagnostics.push(first);
    }

    if (diagnostics.length === 0) {
      const content = ts.parseJsonSourceFileConfigFileContent(
        source,
        ts.sys,
        dirname(path),
        undefined,
        path,
      );

      for (const extended of source.extendedSourceFiles ?? []) {
        this.read.add(extended);
      }

      diagnostics.push(...content.errors);

      const failing = diagnostics.filter((d) => d.code !== NO_INPUTS);

      if (failing.length === 0) {
        const config: ParsedConfig = {
          path,
          options: content.options,
          files: new Set(content.fileNames),
          references: (content.projectReferences ?? []).map((reference) =>
            ts.resolveProjectReferencePath(reference),
          ),
        };

        this.parsed.set(path, config);

        return config;
      }
    }

    for (const diagnostic of diagnostics.filter((d) => d.code !== NO_INPUTS)) {
      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n",
      );
      this.problems.set(path, [...(this.problems.get(path) ?? []), message]);
    }

    return null;
  }
}

export function isUnder(id: string, directory: string): boolean {
  return (
    directory === "." || id === directory || id.startsWith(`${directory}/`)
  );
}
