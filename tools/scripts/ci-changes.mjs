import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export const PLUGIN_SHARED = [
  "tools/scripts/build-plugin.mjs",
  "tools/scripts/verify-plugin.mjs",
  "tools/scripts/units.mjs",
  "tools/packaging/",
  "schema/",
  "package-lock.json",
  ".github/workflows/check.yml",
];

export const TOOLCHAIN_INPUTS = [
  "packages/core/",
  "packages/cli/",
  "tools/scripts/build-toolchain.mjs",
  "tools/scripts/verify-toolchain.mjs",
  "tools/scripts/toolchain-closure.mjs",
  "THIRD-PARTY-NOTICES.md",
  "LICENSE",
  "package.json",
  "package-lock.json",
  ".github/workflows/check.yml",
];

function touches(files, prefixes) {
  return files.some((file) =>
    prefixes.some((prefix) =>
      prefix.endsWith("/") ? file.startsWith(prefix) : file === prefix,
    ),
  );
}

export function decide(event, files, units) {
  if (event !== "pull_request") {
    return { units: units.map((entry) => entry.unit), toolchain: true };
  }

  const everything = touches(files, PLUGIN_SHARED);

  return {
    units: units
      .filter((entry) => everything || touches(files, [`${entry.folder}/`]))
      .map((entry) => entry.unit),
    toolchain: touches(files, TOOLCHAIN_INPUTS),
  };
}

export function render({ units, toolchain }) {
  return `units=${JSON.stringify(units)}\ntoolchain=${toolchain}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [event, base, head] = process.argv.slice(2);
  const units = JSON.parse(
    readFileSync(`${ROOT}tools/packaging/units.json`, "utf8"),
  ).units;
  let files = [];

  if (event === "pull_request") {
    const result = spawnSync(
      "git",
      ["diff", "--name-only", `${base}...${head}`],
      { cwd: ROOT, encoding: "utf8" },
    );

    if (result.status !== 0) {
      throw new Error(`git diff failed: ${result.stderr}`);
    }

    files = result.stdout.split("\n").filter((line) => line !== "");
  }

  process.stdout.write(render(decide(event, files, units)));
}
