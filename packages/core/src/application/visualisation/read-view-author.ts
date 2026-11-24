import type { Git } from "../shared/ports/git.js";

const DEFAULT_AUTHOR = "Me";
const AUTHOR_LIMIT = 64;

export function readViewAuthor(ports: { git: Git }, root: string): string {
  const name = ports.git.userName(root)?.trim() ?? "";

  return name === ""
    ? DEFAULT_AUTHOR
    : [...name].slice(0, AUTHOR_LIMIT).join("");
}
