import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Io } from "./cli.js";

export function readSource(
  io: Io,
  root: string,
  path: string,
): { text: string; hash: string } | null {
  try {
    const raw = io.readBytes(join(root, path));

    return {
      text: raw.toString("utf8"),
      hash: createHash("sha256").update(raw).digest("hex"),
    };
  } catch {
    return null;
  }
}
