import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMAND_LINKS } from "./build-toolchain.mjs";
import { closureFromLock, verifyVendored } from "./toolchain-closure.mjs";

const OWN = new Set([
  "recognizer",
  "recognizer-scan-typescript",
  "recognizer-describe-claude",
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

export function verifyCommands(dir) {
  const root = realpathSync(dir);
  const problems = [];

  for (const [name] of COMMAND_LINKS) {
    const path = join(dir, "commands", name);

    try {
      const resolved = realpathSync(path);

      if (!resolved.startsWith(`${root}${sep}`)) {
        problems.push(`${name} points outside the toolchain`);
        continue;
      }

      accessSync(resolved, constants.X_OK);
    } catch {
      problems.push(`${name} is missing or not executable`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`toolchain commands are wrong: ${problems.join(", ")}`);
  }
}

const PLUGIN_PREFIXES = [
  "recognizer-scan-",
  "recognizer-sense-",
  "recognizer-describe-",
];

export function pluginCommands() {
  return COMMAND_LINKS.map(([name]) => name).filter((name) =>
    PLUGIN_PREFIXES.some((prefix) => name.startsWith(prefix)),
  );
}

export function verifyPlugins(dir, env = process.env) {
  const failures = [];

  for (const name of pluginCommands()) {
    const result = spawnSync(
      join(dir, "commands", "recognizer"),
      ["plugin", "check", join(dir, "commands", name)],
      { encoding: "utf8", env },
    );

    if (result.status !== 0) {
      failures.push({
        name,
        output: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `${result.error.message}\n` : ""}`,
      });
    }
  }

  if (failures.length > 0) {
    const details = failures
      .map(({ name, output }) => `--- ${name}\n${output.trimEnd()}`)
      .join("\n");

    throw new Error(
      `plugin check failed for: ${failures.map(({ name }) => name).join(", ")}\n${details}`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lock = JSON.parse(
    readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
  );

  try {
    verifyToolchainDir(process.argv[2], lock);
    verifyCommands(process.argv[2]);
    verifyPlugins(process.argv[2]);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
