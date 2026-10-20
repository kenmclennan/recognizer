import { dirname, join } from "node:path";
import ts from "typescript";

const NO_INPUTS = 18003;

interface ParsedConfig {
  path: string;
  options: ts.CompilerOptions;
  files: Set<string>;
  references: string[];
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
  private readonly problems: string[] = [];

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

  failures(): string[] {
    return this.problems;
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

    const read = ts.readConfigFile(path, ts.sys.readFile);
    const diagnostics: ts.Diagnostic[] = [];

    if (read.error) {
      diagnostics.push(read.error);
    }

    if (diagnostics.length === 0) {
      const content = ts.parseJsonConfigFileContent(
        read.config,
        ts.sys,
        dirname(path),
        undefined,
        path,
      );

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
      this.problems.push(`${path}:0: ${message}`);
    }

    return null;
  }
}
