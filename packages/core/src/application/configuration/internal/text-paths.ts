import { baseName } from "../../../domain/path.js";

export function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }

  return a > b ? 1 : 0;
}

export function extensionOf(path: string): string {
  const base = baseName(path);
  const at = base.lastIndexOf(".");

  return at <= 0 ? "" : base.slice(at);
}

export function normalizeDirectory(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];

  for (const part of path.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }

    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") {
        parts.pop();
      } else if (!absolute) {
        parts.push("..");
      }
    } else {
      parts.push(part);
    }
  }

  let normalized = parts.join("/");

  if (absolute) {
    normalized = `/${normalized}`;
  }

  if (normalized === "") {
    normalized = absolute ? "/" : ".";
  }

  return path.endsWith("/") && normalized !== "/"
    ? `${normalized}/`
    : normalized;
}
