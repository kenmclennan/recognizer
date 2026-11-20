import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const PROMPT_FILE = new URL("../prompt.md", import.meta.url);

export function readPrompt(): string {
  return readFileSync(PROMPT_FILE, "utf8");
}

export function versionOf(prompt: string | Uint8Array): string {
  return `prompt-${createHash("sha256").update(prompt).digest("hex").slice(0, 12)}`;
}

export function promptVersion(): string {
  return versionOf(readFileSync(PROMPT_FILE));
}
