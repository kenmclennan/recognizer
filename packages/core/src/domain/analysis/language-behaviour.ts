import type { LanguageRule, TestFileRule } from "../language-rule.js";

interface CompiledTestRule {
  extensions: readonly string[];
  directoryNames: ReadonlySet<string>;
  directorySuffixes: readonly string[];
  basenamePatterns: readonly RegExp[];
  stemSuffixes: readonly string[];
}

function compile(rule: TestFileRule): CompiledTestRule {
  return {
    extensions: rule.extensions,
    directoryNames: new Set(rule.directory_names),
    directorySuffixes: rule.directory_suffixes,
    basenamePatterns: rule.basename_patterns.map(
      (pattern) => new RegExp(pattern),
    ),
    stemSuffixes: rule.stem_suffixes,
  };
}

function stemOf(basename: string): string {
  const dot = basename.lastIndexOf(".");

  return dot > 0 ? basename.slice(0, dot) : basename;
}

function matches(
  rule: CompiledTestRule,
  directories: readonly string[],
  basename: string,
): boolean {
  if (
    rule.extensions.length > 0 &&
    !rule.extensions.some((extension) => basename.endsWith(extension))
  ) {
    return false;
  }

  if (directories.some((segment) => rule.directoryNames.has(segment))) {
    return true;
  }

  if (
    directories.some((segment) =>
      rule.directorySuffixes.some((suffix) => segment.endsWith(suffix)),
    )
  ) {
    return true;
  }

  if (rule.basenamePatterns.some((pattern) => pattern.test(basename))) {
    return true;
  }

  const stem = stemOf(basename);

  return rule.stemSuffixes.some((suffix) => stem.endsWith(suffix));
}

export class LanguageBehaviour {
  private readonly testRules: readonly CompiledTestRule[];
  private readonly supertypes: ReadonlySet<string>;
  private readonly privates: ReadonlySet<string>;

  constructor(rules: readonly LanguageRule[]) {
    this.testRules = rules.flatMap((rule) =>
      (rule.test_files ?? []).map(compile),
    );
    this.supertypes = new Set(
      rules.filter((rule) => rule.supertype_links === true).map((r) => r.name),
    );
    this.privates = new Set(
      rules.filter((rule) => rule.private_imports === true).map((r) => r.name),
    );
  }

  isTestFile(path: string): boolean {
    const segments = path.split("/");
    const basename = segments[segments.length - 1] as string;
    const directories = segments.slice(0, -1);

    return this.testRules.some((rule) => matches(rule, directories, basename));
  }

  linksSupertypes(language: string): boolean {
    return this.supertypes.has(language);
  }

  checksPrivateImports(language: string): boolean {
    return this.privates.has(language);
  }
}
