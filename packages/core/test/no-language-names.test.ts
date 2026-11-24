import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = join(import.meta.dirname, "../src");

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}

function hits(pattern: RegExp, files: string[]): string[] {
  return files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) =>
        pattern.test(line) ? [`${relative(SOURCE, file)}:${index + 1}`] : [],
      ),
  );
}

describe("core names no language", () => {
  const files = filesUnder(SOURCE).filter((file) => file.endsWith(".ts"));

  it("holds no language name", () => {
    expect(
      hits(/\b(?:kotlin|csharp|python|typescript|tsx|rust|conftest)\b/i, files),
    ).toEqual([]);
  });

  it("holds no test-file convention", () => {
    expect(
      hits(/"(?:Test|Tests|__tests__)"|\.(?:py|cs)(?:[^a-z]|$)/, files),
    ).toEqual([]);
  });

  it("holds no C# or Kotlin node name in function naming or span code", () => {
    const own = files.filter((file) =>
      /duplication\/(?:span|functions)\.ts$/.test(file),
    );

    expect(
      hits(
        /destructor_declaration|operator_declaration|conversion_operator_declaration|accessor_declaration|arrow_expression_clause|annotated_lambda|lambda_literal|call_suffix|navigation_suffix|object_literal|function_body|class_body|jump_expression/,
        own,
      ),
    ).toEqual([]);
  });

  it("holds none of the removed rule tables", () => {
    expect(
      hits(/SCRIPT_EXTENSIONS|KOTLIN_SCOPE_CALLS|csharpName/, files),
    ).toEqual([]);
  });
});
