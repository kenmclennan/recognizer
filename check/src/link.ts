import type { Io } from "./cli.js";

const SCHEME = "recognizer://";
const VIEW_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface Link {
  repo: string;
  view: string | null;
}

export type LinkParse =
  | { ok: true; link: Link }
  | { ok: false; reason: string };

export function isLink(argument: string): boolean {
  return argument.slice(0, SCHEME.length).toLowerCase() === SCHEME;
}

function hex(code: number): number {
  if (code >= 48 && code <= 57) {
    return code - 48;
  }

  if (code >= 97 && code <= 102) {
    return code - 87;
  }

  if (code >= 65 && code <= 70) {
    return code - 55;
  }

  return -1;
}

function decode(raw: string, name: string): string {
  const input = new TextEncoder().encode(raw);
  const out: number[] = [];

  for (let at = 0; at < input.length; at++) {
    const byte = input[at] as number;

    if (byte !== 37) {
      out.push(byte);
      continue;
    }

    const high = hex(input[at + 1] ?? -1);
    const low = hex(input[at + 2] ?? -1);

    if (high < 0 || low < 0) {
      throw new Error(`${name} has a malformed percent escape`);
    }

    out.push(high * 16 + low);
    at += 2;
  }

  let text: string;

  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(out),
    );
  } catch {
    throw new Error(`${name} is not valid UTF-8`);
  }

  if (text.includes("\0")) {
    throw new Error(`${name} contains a NUL`);
  }

  return text;
}

function parseOrThrow(url: string): Link {
  if (!isLink(url)) {
    throw new Error("not a recognizer:// link");
  }

  const rest = url.slice(SCHEME.length);

  if (rest.includes("#")) {
    throw new Error("a link takes no fragment");
  }

  const mark = rest.indexOf("?");
  const head = mark < 0 ? rest : rest.slice(0, mark);
  const query = mark < 0 ? "" : rest.slice(mark + 1);

  if (head !== "open" && head !== "open/") {
    throw new Error("only recognizer://open is a link");
  }

  const values: { repo?: string; view?: string } = {};

  for (const pair of query.split("&")) {
    const equals = pair.indexOf("=");

    if (equals < 0) {
      throw new Error(
        pair === ""
          ? "the link needs a repo"
          : `parameter ${pair} has no value`,
      );
    }

    const key = pair.slice(0, equals);
    const value = pair.slice(equals + 1);

    if (key !== "repo" && key !== "view") {
      throw new Error(`unknown parameter ${key}`);
    }

    if (value === "") {
      throw new Error(`${key} is empty`);
    }

    if (values[key] !== undefined) {
      throw new Error(`${key} is given twice`);
    }

    values[key] = decode(value, key);
  }

  if (values.repo === undefined) {
    throw new Error("the link needs a repo");
  }

  if (!values.repo.startsWith("/")) {
    throw new Error(`repo must be an absolute path: ${values.repo}`);
  }

  if (values.view !== undefined && !VIEW_NAME.test(values.view)) {
    throw new Error(`${JSON.stringify(values.view)} is not a valid view name`);
  }

  return { repo: values.repo, view: values.view ?? null };
}

export function parseLink(url: string): LinkParse {
  try {
    return { ok: true, link: parseOrThrow(url) };
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
}

export function checkLink(link: Link, io: Io): string | null {
  try {
    io.readDir(link.repo);
  } catch {
    return `folder not found or not a directory: ${link.repo}`;
  }

  if (
    link.view !== null &&
    !io.exists(
      `${link.repo.replace(/\/$/, "")}/.recognizer/views/${link.view}.json`,
    )
  ) {
    return `${link.view} is not a saved view in ${link.repo}`;
  }

  return null;
}
