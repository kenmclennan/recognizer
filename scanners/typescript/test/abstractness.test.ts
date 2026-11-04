import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../scripts/temp-dirs.mjs";
import { scan } from "../src/index.js";
import { PACKAGE, REPO, readJson, validate } from "./helpers.js";

const DIR = join(REPO, "fixtures/abstractness/typescript");
const EXPECTED = readJson(join(DIR, "expected-scan.json"));

const version = (
  JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as {
    version: string;
  }
).version;

function memberOf(source: string, name: string) {
  const dir = makeTempDir("recognizer-ts-abstract-");

  writeFileSync(join(dir, "package.json"), '{"name":"t","private":true}');
  writeFileSync(join(dir, "m.ts"), source);

  const doc = scan(dir, null);
  const module = doc.modules.find((m) => m.id === "m.ts");

  return {
    kind: module?.kind,
    member: module?.members.find((m) => m.name === name),
  };
}

function counts(source: string, name = "X"): boolean {
  const { member } = memberOf(source, name);

  return (member?.tags as string[] | undefined)?.includes("abstract") ?? false;
}

describe("abstractness fixture", () => {
  it("matches the expected scan and validates", () => {
    const doc = scan(join(DIR, "sample"), null);

    validate(doc);
    expect(doc).toEqual({
      ...EXPECTED,
      scanner: { ...EXPECTED.scanner, version },
    });
  });

  it("makes contracts an interface module and shapes and impl modules", () => {
    const doc = scan(join(DIR, "sample"), null);
    const kinds = Object.fromEntries(doc.modules.map((m) => [m.id, m.kind]));

    expect(kinds).toEqual({
      "src/contracts.ts": "interface",
      "src/impl.ts": "module",
      "src/shapes.ts": "module",
    });
  });
});

describe("which type aliases carry the abstract tag", () => {
  it.each([
    ["a function type", "export type X = (e: string) => void;"],
    ["a constructor type", "export type X = new () => object;"],
    [
      "an abstract constructor type",
      "export type X = abstract new () => object;",
    ],
    ["a method signature", "export type X = { find(id: string): string };"],
    ["a call signature", "export type X = { (x: string): void };"],
    ["a construct signature", "export type X = { new (x: string): object };"],
    ["a function-typed property", "export type X = { run: () => void };"],
    ["a generic function type", "export type X<T> = (e: T) => void;"],
    ["a parenthesised function type", "export type X = ((e: string) => void);"],
  ])("counts %s", (_, source) => {
    expect(counts(source)).toBe(true);
  });

  it.each([
    ["a property-only object type", "export type X = { id: string };"],
    ["a literal union", 'export type X = "a" | "b";'],
    ["a keyword", "export type X = string;"],
    ["a utility reference", "export type X = Partial<{ id: string }>;"],
    ["a mapped type", "export type X = { [K in 'a']: number };"],
    ["an intersection", "export type X = { id: string } & { run(): void };"],
    ["a getter-only object type", "export type X = { get id(): string };"],
    ["a tuple", "export type X = [string, number];"],
  ])("does not count %s", (_, source) => {
    expect(counts(source)).toBe(false);
  });

  it("does not mark a callable alias that is not exported as exported", () => {
    const { member } = memberOf("type X = () => void;", "X");

    expect(member?.exported).toBe(false);
  });

  it("leaves an exported default interface a plain interface", () => {
    const { kind, member } = memberOf(
      "export default interface X { id: string }",
      "X",
    );

    expect(member?.kind).toBe("interface");
    expect(member?.tags).toBeUndefined();
    expect(kind).toBe("interface");
  });

  it("makes a file of only concrete aliases a module", () => {
    expect(memberOf("export type X = string;", "X").kind).toBe("module");
  });
});
