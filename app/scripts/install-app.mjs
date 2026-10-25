import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const appDir = join(root, "app");
const targetDir = join(appDir, "src-tauri", "target");

function fail(message) {
  process.stderr.write(`install-app FAILED: ${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  process.stdout.write(`install-app ${command} ${args.join(" ")}\n`);

  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} exited with ${result.status ?? "a signal"}`,
    );
  }
}

const config = JSON.parse(
  readFileSync(join(appDir, "src-tauri", "tauri.conf.json"), "utf8"),
);
const bundleName = `${config.productName}.app`;

run("npm", ["run", "build", "-w", "recognizer"]);
run("npm", ["run", "build", "-w", "@recognizer/app"]);
run(
  "npm",
  [
    "run",
    "tauri",
    "-w",
    "@recognizer/app",
    "--",
    "build",
    "--bundles",
    "app",
    "--no-sign",
  ],
  {
    env: { ...process.env, CARGO_TARGET_DIR: targetDir },
  },
);

const built = join(targetDir, "release", "bundle", "macos", bundleName);

if (!existsSync(built)) {
  fail(`expected the bundle at ${built}`);
}

const applications = join(homedir(), "Applications");
const installed = join(applications, bundleName);
const staging = `${installed}.new`;

mkdirSync(applications, { recursive: true });
rmSync(staging, { recursive: true, force: true });
run("ditto", [built, staging]);
rmSync(installed, { recursive: true, force: true });
renameSync(staging, installed);

process.stdout.write(`install-app installed ${installed}\n`);
