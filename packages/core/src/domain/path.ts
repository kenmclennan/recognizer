export function joinPath(...parts: string[]): string {
  return parts
    .filter((part) => part !== "")
    .join("/")
    .replace(/\/+/g, "/");
}

export function baseName(path: string): string {
  const at = path.lastIndexOf("/");

  return at === -1 ? path : path.slice(at + 1);
}
