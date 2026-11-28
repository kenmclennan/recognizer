export type KeyPathNoun = "key" | "section";

export function splitKeyPath(raw: string): string[] {
  return raw.split(".");
}

export function parseKeyPath(
  raw: string,
  noun: KeyPathNoun,
): { path: string[] } | { reason: string } {
  const path = splitKeyPath(raw);

  if (path.includes("")) {
    return { reason: `a ${noun} is dotted names with none empty` };
  }

  return { path };
}
