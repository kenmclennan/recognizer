import { createHash } from "node:crypto";
import { join, posix } from "node:path";
import type { Io } from "./cli.js";
import { isTestFile } from "./entry-points.js";

const SPACE = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0b, 0x0c]);

const ROOT_NAMES = new Set(["lib.rs", "main.rs", "build.rs"]);

const PATH_VALUE = /^\s*path\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/s;

type Declaration = {
  scope: string[];
  name: string;
  path: string | null;
  isTest: boolean;
};

type Scanned = {
  items: [number, number][];
  fileLevel: boolean;
  declarations: Declaration[];
};

type ModuleHead = { name: string; inline: boolean; after: number };

function isIdentifierByte(byte: number): boolean {
  return (
    byte === 0x5f ||
    (byte >= 0x30 && byte <= 0x39) ||
    (byte >= 0x41 && byte <= 0x5a) ||
    (byte >= 0x61 && byte <= 0x7a)
  );
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function startsWith(data: Buffer, text: string, at: number): boolean {
  for (let k = 0; k < text.length; k += 1) {
    if (data[at + k] !== text.charCodeAt(k)) {
      return false;
    }
  }

  return true;
}

function skipBlockComment(data: Buffer, start: number): number {
  let depth = 0;
  let i = start;

  while (i < data.length) {
    if (startsWith(data, "/*", i)) {
      depth += 1;
      i += 2;
    } else if (startsWith(data, "*/", i)) {
      depth -= 1;
      i += 2;

      if (depth === 0) {
        return i;
      }
    } else {
      i += 1;
    }
  }

  return data.length;
}

function skipQuoted(data: Buffer, start: number): number {
  let i = start + 1;

  while (i < data.length) {
    if (data[i] === 0x5c) {
      i += 2;
    } else if (data[i] === 0x22) {
      return i + 1;
    } else {
      i += 1;
    }
  }

  return data.length;
}

function skipRaw(data: Buffer, start: number, hashes: number): number {
  const closing = Buffer.from(`"${"#".repeat(hashes)}`);
  const end = data.indexOf(closing, start);

  return end < 0 ? data.length : end + closing.length;
}

function skipCharacter(data: Buffer, start: number): number {
  const i = start + 1;

  if (i >= data.length) {
    return data.length;
  }

  if (data[i] === 0x5c) {
    const end = data.indexOf(0x27, i + 2);

    return end < 0 ? data.length : end + 1;
  }

  const lead = data[i] as number;
  const width = lead < 0xc0 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4;

  if (i + width < data.length && data[i + width] === 0x27) {
    return i + width + 1;
  }

  return start + 1;
}

function rawStart(data: Buffer, start: number): number | null {
  let i = start + 1;
  let hashes = 0;

  while (i < data.length && data[i] === 0x23) {
    hashes += 1;
    i += 1;
  }

  if (i < data.length && data[i] === 0x22) {
    return skipRaw(data, i + 1, hashes);
  }

  return null;
}

function skipLiteral(data: Buffer, i: number): number | null {
  const byte = data[i] as number;

  if (byte === 0x2f && startsWith(data, "//", i)) {
    const end = data.indexOf(0x0a, i);

    return end < 0 ? data.length : end;
  }

  if (byte === 0x2f && startsWith(data, "/*", i)) {
    return skipBlockComment(data, i);
  }

  if (byte === 0x22) {
    return skipQuoted(data, i);
  }

  if (byte === 0x27) {
    return skipCharacter(data, i);
  }

  if (
    (byte === 0x72 || byte === 0x62) &&
    (i === 0 || !isIdentifierByte(data[i - 1] as number))
  ) {
    const prefix = i + 1;

    if (byte === 0x62 && prefix < data.length) {
      if (data[prefix] === 0x22) {
        return skipQuoted(data, prefix);
      }

      if (data[prefix] === 0x27) {
        return skipCharacter(data, prefix);
      }

      if (data[prefix] === 0x72) {
        return rawStart(data, prefix);
      }
    }

    if (byte === 0x72) {
      return rawStart(data, i);
    }
  }

  return null;
}

function skipTrivia(data: Buffer, start: number): number {
  let i = start;

  while (i < data.length) {
    if (SPACE.has(data[i] as number)) {
      i += 1;
    } else if (startsWith(data, "//", i) || startsWith(data, "/*", i)) {
      i = skipLiteral(data, i) ?? i + 1;
    } else {
      break;
    }
  }

  return i;
}

function attributeEnd(data: Buffer, start: number): number {
  let depth = 1;
  let i = start;

  while (i < data.length) {
    const skipped = skipLiteral(data, i);

    if (skipped !== null) {
      i = skipped;
      continue;
    }

    if (data[i] === 0x5b) {
      depth += 1;
    } else if (data[i] === 0x5d) {
      depth -= 1;

      if (depth === 0) {
        return i + 1;
      }
    }

    i += 1;
  }

  return data.length;
}

function gateTokens(text: string): string[] | null {
  const tokens: string[] = [];
  let i = 0;

  while (i < text.length) {
    const c = text.charAt(i);

    if (/[ \t\n\r\v\f]/.test(c)) {
      i += 1;
    } else if (c === "(" || c === ")" || c === "," || c === "=") {
      tokens.push(c);
      i += 1;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;

      while (j < text.length && /[A-Za-z0-9_]/.test(text.charAt(j))) {
        j += 1;
      }

      tokens.push(text.slice(i, j));
      i = j;
    } else if (c === '"') {
      let j = i + 1;

      while (j < text.length && text.charAt(j) !== '"') {
        j += text.charAt(j) === "\\" ? 2 : 1;
      }

      if (j >= text.length) {
        return null;
      }

      tokens.push('"');
      i = j + 1;
    } else {
      return null;
    }
  }

  return tokens;
}

function gatePredicate(
  tokens: string[],
  at: number,
): { next: number; requiresTest: boolean } | null {
  const name = tokens[at];

  if (name === undefined || !/^[A-Za-z_]/.test(name)) {
    return null;
  }

  const after = tokens[at + 1];

  if (after === "=") {
    return tokens[at + 2] === '"'
      ? { next: at + 3, requiresTest: false }
      : null;
  }

  if (after !== "(") {
    return { next: at + 1, requiresTest: name === "test" };
  }

  const results: boolean[] = [];
  let i = at + 2;

  while (tokens[i] !== ")") {
    const item = gatePredicate(tokens, i);

    if (item === null) {
      return null;
    }

    results.push(item.requiresTest);
    i = item.next;

    if (tokens[i] === ",") {
      i += 1;
    } else if (tokens[i] !== ")") {
      return null;
    }
  }

  let requiresTest = false;

  if (name === "all") {
    requiresTest = results.some(Boolean);
  } else if (name === "any") {
    requiresTest = results.length > 0 && results.every(Boolean);
  }

  return { next: i + 1, requiresTest };
}

export function isTestAttribute(inner: string): boolean {
  if (inner.replace(/[ \t\n\r\v\f]/g, "") === "test") {
    return true;
  }

  const tokens = gateTokens(inner);

  if (tokens === null || tokens[0] !== "cfg" || tokens[1] !== "(") {
    return false;
  }

  const predicate = gatePredicate(tokens, 2);

  return (
    predicate !== null &&
    predicate.next === tokens.length - 1 &&
    tokens[predicate.next] === ")" &&
    predicate.requiresTest
  );
}

function attributeInner(
  data: Buffer,
  start: number,
  end: number,
  opener: number,
): string {
  return data.subarray(start + opener, end - 1).toString("latin1");
}

function itemEnd(data: Buffer, start: number): number {
  let depth = 0;
  let firstBrace: number | null = null;
  let i = start;

  while (i < data.length) {
    const skipped = skipLiteral(data, i);

    if (skipped !== null) {
      i = skipped;
      continue;
    }

    const byte = data[i] as number;

    if (byte === 0x28 || byte === 0x5b || byte === 0x7b) {
      if (byte === 0x7b && firstBrace === null) {
        firstBrace = depth;
      }

      depth += 1;
    } else if (byte === 0x29 || byte === 0x5d || byte === 0x7d) {
      if (depth === 0) {
        return i;
      }

      depth -= 1;

      if (byte === 0x7d && firstBrace === depth) {
        return i + 1;
      }
    } else if (byte === 0x3b && depth === 0) {
      return i + 1;
    }

    i += 1;
  }

  return data.length;
}

function moduleHead(text: Buffer, start: number): ModuleHead | null {
  const n = text.length;
  const skipSpace = (at: number): number => {
    let k = at;

    while (k < n && SPACE.has(text[k] as number)) {
      k += 1;
    }

    return k;
  };
  let i = skipSpace(start);

  if (startsWith(text, "pub", i)) {
    const after = i + 3;

    if (after < n && text[after] === 0x28) {
      const close = text.indexOf(0x29, after);

      if (close < 0) {
        return null;
      }

      i = skipSpace(close + 1);
    } else if (after < n && SPACE.has(text[after] as number)) {
      i = skipSpace(after);
    } else {
      return null;
    }
  }

  if (!startsWith(text, "mod", i)) {
    return null;
  }

  const after = i + 3;

  if (after >= n || !SPACE.has(text[after] as number)) {
    return null;
  }

  i = skipSpace(after);

  const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(
    text.subarray(i).toString("latin1"),
  );

  if (name === null) {
    return null;
  }

  i = skipSpace(i + name[0].length);

  if (i < n && text[i] === 0x3b) {
    return { name: name[0], inline: false, after: i + 1 };
  }

  if (i < n && text[i] === 0x7b) {
    return { name: name[0], inline: true, after: i + 1 };
  }

  return null;
}

function pathValue(inner: string): string | null {
  const match = PATH_VALUE.exec(inner);

  return match === null ? null : (match[1] as string);
}

function scan(data: Buffer): Scanned {
  const items: [number, number][] = [];
  const declarations: Declaration[] = [];
  const scope: [string, number][] = [];
  let fileLevel = false;
  let depth = 0;
  let i = 0;

  const enter = (
    head: ModuleHead,
    path: string | null,
    isTest: boolean,
  ): void => {
    if (head.inline) {
      scope.push([head.name, depth]);
      depth += 1;
    } else {
      declarations.push({
        scope: scope.map((entry) => entry[0]),
        name: head.name,
        path,
        isTest,
      });
    }
  };

  while (i < data.length) {
    const skipped = skipLiteral(data, i);

    if (skipped !== null) {
      i = skipped;
      continue;
    }

    if (startsWith(data, "#![", i)) {
      const end = attributeEnd(data, i + 3);

      if (depth === 0 && isTestAttribute(attributeInner(data, i, end, 3))) {
        fileLevel = true;
      }

      i = end;
      continue;
    }

    if (startsWith(data, "#[", i)) {
      const start = i;
      let end = attributeEnd(data, i + 2);
      let inner = attributeInner(data, i, end, 2);
      let isTest = isTestAttribute(inner);
      let path = pathValue(inner);
      let follow = skipTrivia(data, end);

      while (startsWith(data, "#[", follow)) {
        end = attributeEnd(data, follow + 2);
        inner = attributeInner(data, follow, end, 2);
        isTest = isTest || isTestAttribute(inner);
        path = path ?? pathValue(inner);
        follow = skipTrivia(data, end);
      }

      if (!isTest) {
        const head = moduleHead(data, end);

        if (head === null) {
          i = end;
        } else {
          enter(head, path, false);
          i = head.after;
        }

        continue;
      }

      const stop = itemEnd(data, end);

      items.push([start, stop]);

      const head = moduleHead(data.subarray(end, stop), 0);

      if (head !== null && !head.inline) {
        enter(head, path, true);
      }

      i = Math.max(stop, end);
      continue;
    }

    const byte = data[i] as number;

    if (byte === 0x7b) {
      depth += 1;
    } else if (byte === 0x7d) {
      depth -= 1;

      if (
        scope.length > 0 &&
        (scope[scope.length - 1] as [string, number])[1] === depth
      ) {
        scope.pop();
      }
    } else if (
      (byte === 0x6d || byte === 0x70) &&
      (i === 0 || !isIdentifierByte(data[i - 1] as number))
    ) {
      const head = moduleHead(data, i);

      if (head !== null) {
        enter(head, null, false);
        i = head.after;
        continue;
      }
    }

    i += 1;
  }

  return { items, fileLevel, declarations };
}

function isRootFile(path: string): boolean {
  const name = posix.basename(path);
  const parent = posix.dirname(path);

  if (ROOT_NAMES.has(name)) {
    return true;
  }

  const parentName = posix.basename(parent);

  if (parentName === "examples" || parentName === "benches") {
    return true;
  }

  return (
    parentName === "bin" && posix.basename(posix.dirname(parent)) === "src"
  );
}

function joinModule(base: string, tail: string): string | null {
  if (tail.startsWith("/")) {
    return null;
  }

  const joined = posix.normalize(base === "" ? tail : `${base}/${tail}`);

  return joined.startsWith("..") || joined === "." ? null : joined;
}

function moduleCandidates(file: string, declaration: Declaration): string[] {
  const parent = posix.dirname(file);
  const directory = parent === "." ? "" : parent;

  if (declaration.path !== null) {
    const found = joinModule(directory, declaration.path);

    return found === null ? [] : [found];
  }

  const name = posix.basename(file);
  const stem = name.slice(0, -3);
  let base =
    isRootFile(file) || name === "mod.rs"
      ? directory
      : (joinModule(directory, stem) ?? "");

  for (const segment of declaration.scope) {
    base = joinModule(base, segment) ?? "";
  }

  return [`${declaration.name}.rs`, `${declaration.name}/mod.rs`]
    .map((tail) => joinModule(base, tail))
    .filter((found): found is string => found !== null);
}

function resolvedDeclaration(
  file: string,
  declaration: Declaration,
  index: ReadonlySet<string>,
): string | null {
  return (
    moduleCandidates(file, declaration).find((found) => index.has(found)) ??
    null
  );
}

function readOrNull(io: Io, path: string): Buffer | null {
  try {
    return io.readBytes(path);
  } catch {
    return null;
  }
}

function firstPass(
  io: Io,
  root: string,
  sources: readonly string[],
): Map<string, { data: Buffer; scanned: Scanned }> {
  const found = new Map<string, { data: Buffer; scanned: Scanned }>();

  for (const path of sources) {
    if (isTestFile(path)) {
      continue;
    }

    const data = readOrNull(io, join(root, path));

    if (data === null || data.indexOf("test") < 0) {
      continue;
    }

    found.set(path, { data, scanned: scan(data) });
  }

  return found;
}

function testFileSet(
  io: Io,
  root: string,
  sources: readonly string[],
  first: Map<string, { data: Buffer; scanned: Scanned }>,
): Set<string> {
  const index = new Set(sources);
  const marked = new Set<string>();
  const pending: string[] = [];
  const mark = (path: string | null): void => {
    if (path !== null && !marked.has(path)) {
      marked.add(path);
      pending.push(path);
    }
  };

  for (const [path, { scanned }] of first) {
    if (scanned.fileLevel) {
      mark(path);
    }

    for (const declaration of scanned.declarations) {
      if (declaration.isTest) {
        mark(resolvedDeclaration(path, declaration, index));
      }
    }
  }

  while (pending.length > 0) {
    const file = pending.pop() as string;
    let declarations = first.get(file)?.scanned.declarations;

    if (declarations === undefined) {
      const data = readOrNull(io, join(root, file));

      declarations = data === null ? [] : scan(data).declarations;
    }

    for (const declaration of declarations) {
      mark(resolvedDeclaration(file, declaration, index));
    }
  }

  return marked;
}

function rustSources(paths: readonly string[]): string[] {
  return [...new Set(paths.filter((path) => path.endsWith(".rs")))].sort();
}

export function rustTestFiles(
  io: Io,
  root: string,
  paths: readonly string[],
): Set<string> {
  const sources = rustSources(paths);

  return testFileSet(io, root, sources, firstPass(io, root, sources));
}

export function inFileTestHashes(
  io: Io,
  root: string,
  paths: readonly string[],
): Map<string, string> {
  const sources = rustSources(paths);
  const first = firstPass(io, root, sources);
  const entries = new Map<string, string>();

  for (const [path, { data, scanned }] of first) {
    scanned.items.forEach(([start, stop], number) => {
      entries.set(`${path}#${number}`, sha256(data.subarray(start, stop)));
    });
  }

  for (const path of [...testFileSet(io, root, sources, first)].sort()) {
    const data = readOrNull(io, join(root, path));

    if (data !== null) {
      entries.set(`${path}#file`, sha256(data));
    }
  }

  return entries;
}
