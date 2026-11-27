import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_FOLDER_NAME = "recognizer-cargo-target";

export function mainCheckout(root) {
  const result = spawnSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: root, encoding: "utf8" },
  );

  const common = result.status === 0 ? result.stdout.trim() : "";

  if (common === "" || basename(common) !== ".git") {
    return resolve(root);
  }

  return dirname(common);
}

export function cargoTargetDir(root, environment = process.env) {
  const configured = environment.CARGO_TARGET_DIR;

  if (configured !== undefined && configured !== "") {
    return isAbsolute(configured) ? configured : resolve(root, configured);
  }

  return join(dirname(mainCheckout(root)), DEFAULT_FOLDER_NAME);
}

export function withCargoTarget(root, environment = process.env) {
  return {
    ...environment,
    CARGO_TARGET_DIR: cargoTargetDir(root, environment),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: withCargoTarget(root),
  });

  process.exit(result.status ?? 1);
}
