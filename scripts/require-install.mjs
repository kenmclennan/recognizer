import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MESSAGE = "run npm ci at the repository root";

export function installProblem(root) {
  const modules = join(root, "node_modules");
  const installed = join(modules, ".package-lock.json");

  if (!existsSync(modules) || !existsSync(installed)) {
    return `node_modules is missing: ${MESSAGE}`;
  }

  const lock = join(root, "package-lock.json");

  if (
    existsSync(lock) &&
    statSync(installed).mtimeMs < statSync(lock).mtimeMs
  ) {
    return `node_modules is older than package-lock.json: ${MESSAGE}`;
  }

  const { workspaces = [] } = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );

  for (const workspace of workspaces) {
    const { name } = JSON.parse(
      readFileSync(join(root, workspace, "package.json"), "utf8"),
    );

    if (!existsSync(join(modules, name))) {
      return `workspace ${name} is not installed: ${MESSAGE}`;
    }
  }

  return null;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const problem = installProblem(
    resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  );

  if (problem) {
    console.error(problem);
    process.exit(1);
  }
}
