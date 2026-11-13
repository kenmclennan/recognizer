import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const JSON_VERSION = /^(\s*"version":\s*")[^"]*(")/m;
const TOML_VERSION = /^(version = ")[^"]*(")/m;

const CLI_AND_APP = [
  ["app/src-tauri/tauri.conf.json", JSON_VERSION],
  ["app/src-tauri/Cargo.toml", TOML_VERSION],
  ["app/package.json", JSON_VERSION],
  ["package.json", JSON_VERSION],
  ["check/package.json", JSON_VERSION],
];

export const UNIT_FILES = {
  "scan-python": [["scanners/python/pyproject.toml", TOML_VERSION]],
  "scan-typescript": [["scanners/typescript/package.json", JSON_VERSION]],
  "scan-kotlin": [["scanners/kotlin/pyproject.toml", TOML_VERSION]],
  "scan-csharp": [["scanners/csharp/pyproject.toml", TOML_VERSION]],
  "scan-rust": [
    ["scanners/rust/Cargo.toml", TOML_VERSION],
    [
      "scanners/rust/Cargo.lock",
      /(name = "recognizer-scan-rust"\nversion = ")[^"]*(")/,
    ],
  ],
  sensors: [["sensors/pyproject.toml", TOML_VERSION]],
  "describe-claude": [["describers/claude/package.json", JSON_VERSION]],
};

function rewrite(path, pattern, version) {
  const text = readFileSync(path, "utf8");

  if (!pattern.test(text)) {
    throw new Error(`No version found in ${path}`);
  }

  writeFileSync(
    path,
    text.replace(pattern, (_, head, tail) => `${head}${version}${tail}`),
  );
}

export function stampVersion(root, version, unit) {
  const files = unit === undefined ? CLI_AND_APP : UNIT_FILES[unit];

  if (files === undefined) {
    throw new Error(
      `No unit ${unit}; the units are ${Object.keys(UNIT_FILES).join(", ")}`,
    );
  }

  for (const [path, pattern] of files) {
    rewrite(join(root, path), pattern, version);
  }
}

export function committedVersion(root, unit) {
  const files = UNIT_FILES[unit];

  if (files === undefined) {
    throw new Error(
      `No unit ${unit}; the units are ${Object.keys(UNIT_FILES).join(", ")}`,
    );
  }

  const [path, pattern] = files[0];
  const found = pattern.exec(readFileSync(join(root, path), "utf8"));

  if (found === null) {
    throw new Error(`No version found in ${path}`);
  }

  return /"?version"?(?::\s*"|\s*=\s*")([^"]*)"/.exec(found[0])?.[1] ?? "";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../..", import.meta.url));

  if (process.argv[2] === "committed") {
    process.stdout.write(`${committedVersion(root, process.argv[3])}\n`);
  } else {
    stampVersion(root, process.argv[2], process.argv[3]);
  }
}
