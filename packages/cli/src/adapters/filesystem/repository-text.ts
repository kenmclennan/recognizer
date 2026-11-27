import { createHash } from "node:crypto";
import type { RepositoryText } from "@recognizer/core";
import type { Io } from "../../cli.js";

export function readRepositoryText(io: Io, file: string): RepositoryText {
  const present = io.exists(file);
  const text = present ? io.readFile(file) : "";

  return {
    present,
    text,
    hash: createHash("sha256").update(text, "utf8").digest("hex"),
  };
}

export { saveRepositoryText } from "./save-repository-text.js";
