import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

export function stampVersion(root, version) {
  const json = /^(\s*"version":\s*")[^"]*(")/m;

  rewrite(join(root, "app/src-tauri/tauri.conf.json"), json, version);
  rewrite(
    join(root, "app/src-tauri/Cargo.toml"),
    /^(version = ")[^"]*(")/m,
    version,
  );
  rewrite(join(root, "app/package.json"), json, version);
  rewrite(join(root, "package.json"), json, version);
  rewrite(join(root, "check/package.json"), json, version);
  rewrite(join(root, "scanners/typescript/package.json"), json, version);
  rewrite(
    join(root, "scanners/python/pyproject.toml"),
    /^(version = ")[^"]*(")/m,
    version,
  );
  rewrite(
    join(root, "scanners/kotlin/pyproject.toml"),
    /^(version = ")[^"]*(")/m,
    version,
  );
  rewrite(join(root, "describers/claude/package.json"), json, version);
  rewrite(
    join(root, "scanners/rust/Cargo.toml"),
    /^(version = ")[^"]*(")/m,
    version,
  );
  rewrite(
    join(root, "scanners/rust/Cargo.lock"),
    /(name = "recognizer-scan-rust"\nversion = ")[^"]*(")/,
    version,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  stampVersion(
    fileURLToPath(new URL("../..", import.meta.url)),
    process.argv[2],
  );
}
