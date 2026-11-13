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
import { kindOf } from "./build-plugin.mjs";
import { closureFromLock, verifyVendored } from "./toolchain-closure.mjs";
import { findUnit, loadUnits } from "./units.mjs";

export function pluginCommands(entry) {
  return entry.formulae.map(({ command }) => command);
}

export function verifyBin(dir, entry) {
  const root = realpathSync(dir);
  const problems = [];

  for (const name of pluginCommands(entry)) {
    try {
      const resolved = realpathSync(join(dir, "bin", name));

      if (!resolved.startsWith(`${root}${sep}`)) {
        problems.push(`${name} points outside the archive`);
        continue;
      }

      accessSync(resolved, constants.X_OK);
    } catch {
      problems.push(`${name} is missing or not executable`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`${entry.unit} commands are wrong: ${problems.join(", ")}`);
  }
}

export function verifyClosure(dir, entry, lock) {
  const recipe = kindOf(entry.unit);

  if (recipe.kind !== "node") {
    return;
  }

  const nodeModules = join(dir, "node_modules");
  const own = new Set([recipe.package, ".bin", ".package-lock.json"]);
  const candidates = new Set([
    ...closureFromLock(lock, [entry.folder]).keys(),
    ...(existsSync(nodeModules)
      ? readdirSync(nodeModules)
          .filter((name) => !own.has(name))
          .map((name) => `node_modules/${name}`)
      : []),
  ]);
  const versions = {};

  for (const path of candidates) {
    const manifest = join(dir, path, "package.json");

    versions[path] = existsSync(manifest)
      ? JSON.parse(readFileSync(manifest, "utf8")).version
      : undefined;
  }

  verifyVendored(lock, versions, [entry.folder]);
}

export function verifyPlugins(dir, entry, recognizer, env = process.env) {
  const failures = [];
  const [program, ...leading] = recognizer;

  for (const name of pluginCommands(entry)) {
    const result = spawnSync(
      program,
      [...leading, "plugin", "check", join(dir, "bin", name)],
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
  const root = fileURLToPath(new URL("..", import.meta.url));
  const [unit, dir] = process.argv.slice(2);
  const lock = JSON.parse(
    readFileSync(join(root, "package-lock.json"), "utf8"),
  );

  try {
    const entry = findUnit(loadUnits(root), unit);

    verifyBin(dir, entry);
    verifyClosure(dir, entry, lock);
    verifyPlugins(dir, entry, [
      process.execPath,
      join(root, "check/dist/bin.js"),
    ]);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
