import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { closureFromLock, verifyVendored } from "./toolchain-closure.mjs";

const OWN = new Set([
  "recognizer",
  "recognizer-scan-typescript",
  ".bin",
  ".package-lock.json",
]);

function vendoredPaths(nodeModules, prefix = "node_modules") {
  const paths = [];

  for (const name of readdirSync(nodeModules)) {
    if (OWN.has(name) && prefix === "node_modules") {
      continue;
    }

    paths.push(`${prefix}/${name}`);
  }

  return paths;
}

export function verifyToolchainDir(dir, lock) {
  const versions = {};
  const nodeModules = join(dir, "node_modules");
  const candidates = new Set([
    ...closureFromLock(lock).keys(),
    ...(existsSync(nodeModules) ? vendoredPaths(nodeModules) : []),
  ]);

  for (const path of candidates) {
    const manifest = join(dir, path, "package.json");

    versions[path] = existsSync(manifest)
      ? JSON.parse(readFileSync(manifest, "utf8")).version
      : undefined;
  }

  verifyVendored(lock, versions);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lock = JSON.parse(
    readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
  );

  try {
    verifyToolchainDir(process.argv[2], lock);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
