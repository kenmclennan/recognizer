import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Io } from "./cli.js";
import { isTestFile } from "./entry-points.js";

const SPACE = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0b, 0x0c]);

const ROOT_STEMS = new Set(["lib", "main", "mod"]);

const WORD = /[A-Za-z_][A-Za-z0-9_]*/g;

type Scanned = {
  items: [number, number][];
  fileLevel: boolean;
  modules: string[];
};

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

function trimSpace(text: string): string {
  return text.replace(/^[ \t\n\r\v\f]+|[ \t\n\r\v\f]+$/g, "");
}

function isTestAttribute(inner: string): boolean {
  if (inner.replace(/[ \t\n\r\v\f]/g, "") === "test") {
    return true;
  }

  let rest = trimSpace(inner);

  if (!rest.startsWith("cfg")) {
    return false;
  }

  rest = rest.slice(3).replace(/^[ \t\n\r\v\f]+/, "");

  if (!(rest.startsWith("(") && rest.endsWith(")"))) {
    return false;
  }

  const words: string[] = rest.slice(1, -1).match(WORD) ?? [];

  return words.includes("test") && !words.includes("not");
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

function declaredModule(text: Buffer): string | null {
  const n = text.length;
  const skipSpace = (at: number): number => {
    let i = at;

    while (i < n && SPACE.has(text[i] as number)) {
      i += 1;
    }

    return i;
  };
  let i = skipSpace(0);

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

  return i < n && text[i] === 0x3b ? name[0] : null;
}

function scan(data: Buffer): Scanned {
  const items: [number, number][] = [];
  const modules: string[] = [];
  let fileLevel = false;
  let i = 0;

  while (i < data.length) {
    const skipped = skipLiteral(data, i);

    if (skipped !== null) {
      i = skipped;
      continue;
    }

    if (startsWith(data, "#![", i)) {
      const end = attributeEnd(data, i + 3);

      if (isTestAttribute(attributeInner(data, i, end, 3))) {
        fileLevel = true;
      }

      i = end;
      continue;
    }

    if (startsWith(data, "#[", i)) {
      const start = i;
      let end = attributeEnd(data, i + 2);
      let isTest = isTestAttribute(attributeInner(data, i, end, 2));
      let follow = skipTrivia(data, end);

      while (startsWith(data, "#[", follow)) {
        end = attributeEnd(data, follow + 2);
        isTest =
          isTest || isTestAttribute(attributeInner(data, follow, end, 2));
        follow = skipTrivia(data, end);
      }

      if (!isTest) {
        i = end;
        continue;
      }

      const stop = itemEnd(data, end);

      items.push([start, stop]);

      const name = declaredModule(data.subarray(end, stop));

      if (name !== null) {
        modules.push(name);
      }

      i = Math.max(stop, end);
      continue;
    }

    i += 1;
  }

  return { items, fileLevel, modules };
}

function moduleDirectory(file: string): string {
  const parts = file.split("/");
  const name = parts.pop() as string;
  const stem = name.slice(0, -3);
  const parent = parts.join("/");

  if (ROOT_STEMS.has(stem)) {
    return parent;
  }

  return parent === "" ? stem : `${parent}/${stem}`;
}

function moduleNameOf(file: string): string {
  const parts = file.split("/");
  const stem = (parts.pop() as string).slice(0, -3);

  return stem === "mod" ? (parts.pop() ?? "") : stem;
}

function readOrNull(io: Io, path: string): Buffer | null {
  try {
    return io.readBytes(path);
  } catch {
    return null;
  }
}

export function inFileTestHashes(
  io: Io,
  root: string,
  paths: readonly string[],
): Map<string, string> {
  const sources = [
    ...new Set(paths.filter((path) => path.endsWith(".rs"))),
  ].sort();
  const entries = new Map<string, string>();
  const declared: [string, string][] = [];

  for (const path of sources) {
    if (isTestFile(path)) {
      continue;
    }

    const data = readOrNull(io, join(root, path));

    if (data === null || data.indexOf("test") < 0) {
      continue;
    }

    const { items, fileLevel, modules } = scan(data);

    items.forEach(([start, stop], number) => {
      entries.set(`${path}#${number}`, sha256(data.subarray(start, stop)));
    });

    if (fileLevel) {
      entries.set(`${path}#file`, sha256(data));
    }

    for (const name of modules) {
      declared.push([path, name]);
    }
  }

  for (const [declaring, name] of declared) {
    const directory = moduleDirectory(declaring);
    const prefix = directory === "" ? "" : `${directory}/`;

    for (const path of sources) {
      if (!path.startsWith(prefix) || moduleNameOf(path) !== name) {
        continue;
      }

      const data = readOrNull(io, join(root, path));

      if (data !== null) {
        entries.set(`${path}#file`, sha256(data));
      }
    }
  }

  return entries;
}
