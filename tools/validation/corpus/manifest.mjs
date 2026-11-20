import { readFileSync } from "node:fs";

export const LANGUAGES = ["python", "typescript", "rust", "kotlin", "csharp"];

const COMMIT = /^[0-9a-f]{40}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function parseManifest(text) {
  let entries;

  try {
    entries = JSON.parse(text);
  } catch (error) {
    throw new Error(`manifest is not valid JSON: ${error.message}`);
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("manifest must be a non-empty array");
  }

  const seen = new Set();

  return entries.map((entry, index) => {
    const where = `entry ${index}`;

    if (typeof entry !== "object" || entry === null) {
      throw new Error(`${where} is not an object`);
    }

    const { name, upstream, commit, languages, why } = entry;

    if (typeof name !== "string" || !NAME.test(name)) {
      throw new Error(`${where} has an invalid name`);
    }

    if (seen.has(name)) {
      throw new Error(`${where} repeats the name ${name}`);
    }

    seen.add(name);

    if (typeof upstream !== "string" || upstream === "") {
      throw new Error(`${name} has no upstream`);
    }

    if (typeof commit !== "string" || !COMMIT.test(commit)) {
      throw new Error(`${name} needs a full 40-character commit`);
    }

    if (
      !Array.isArray(languages) ||
      languages.length === 0 ||
      languages.some((language) => !LANGUAGES.includes(language))
    ) {
      throw new Error(
        `${name} needs languages from ${LANGUAGES.join(", ")}`,
      );
    }

    if (typeof why !== "string" || why.trim() === "") {
      throw new Error(`${name} needs a one-line why`);
    }

    return { name, upstream, commit, languages: [...languages], why };
  });
}

export function readManifest(path) {
  return parseManifest(readFileSync(path, "utf8"));
}
