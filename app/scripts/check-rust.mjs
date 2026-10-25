import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const manifest = "app/src-tauri/Cargo.toml";

function available(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

function run(command, args) {
  process.stdout.write(`check:rust ${command} ${args.join(" ")}\n`);

  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const required = Boolean(process.env.CI || process.env.REQUIRE_RUST);

if (!available("cargo")) {
  if (required) {
    process.stderr.write(
      "check:rust FAILED: cargo not on PATH and CI or REQUIRE_RUST is set\n",
    );
    process.exit(1);
  }

  process.stderr.write("check:rust SKIPPED: cargo not on PATH (CI runs it)\n");
} else {
  mkdirSync(fileURLToPath(new URL("../dist", import.meta.url)), {
    recursive: true,
  });

  run("cargo", ["test", "--manifest-path", manifest]);
  run("cargo", ["fmt", "--manifest-path", manifest, "--check"]);
  run("cargo", [
    "clippy",
    "--manifest-path",
    manifest,
    "--all-targets",
    "--",
    "-D",
    "warnings",
  ]);
}
