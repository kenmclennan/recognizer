function trimTrailing(path: string): string {
  let end = path.length;

  while (end > 1 && path.charAt(end - 1) === "/") {
    end -= 1;
  }

  return path.slice(0, end);
}

export function basename(path: string): string {
  const trimmed = trimTrailing(path);
  const at = trimmed.lastIndexOf("/");

  return trimmed === "/" ? "" : trimmed.slice(at + 1);
}

export function dirname(path: string): string {
  const trimmed = trimTrailing(path);
  const at = trimmed.lastIndexOf("/");

  if (at < 0) {
    return ".";
  }

  const head = trimTrailing(trimmed.slice(0, at));

  return head === "" ? "/" : head;
}

export function normalize(path: string): string {
  if (path === "") {
    return ".";
  }

  const absolute = path.startsWith("/");
  const trailing = path.endsWith("/");
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

  let joined = parts.join("/");

  if (joined === "" && !absolute) {
    joined = ".";
  }

  if (joined !== "" && trailing) {
    joined += "/";
  }

  return absolute ? `/${joined}` : joined;
}

export const posix = { basename, dirname, normalize };
