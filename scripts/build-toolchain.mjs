import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoInstallScripts,
  closureFromLock,
  verifyVendored,
} from "./toolchain-closure.mjs";

export const ARCHIVE = "recognizer-toolchain.tar.gz";

const OWN_PACKAGES = ["recognizer"];
const COMMANDS_FOLDER = "commands";
const FOLDER = "toolchain";

export const COMMAND_LINKS = [
  ["recognizer", "../node_modules/recognizer/dist/bin.js"],
];

export function writeCommandLinks(folder) {
  const commands = join(folder, COMMANDS_FOLDER);

  mkdirSync(commands, { recursive: true });

  for (const [name, target] of COMMAND_LINKS) {
    symlinkSync(target, join(commands, name));
  }
}

const SOURCE_GRAMMARS = [
  "python",
  "typescript",
  "tsx",
  "kotlin",
  "rust",
  "csharp",
];

export function archiveEntries(closurePaths) {
  return [
    ...OWN_PACKAGES.map((name) => `node_modules/${name}/package.json`),
    ...SOURCE_GRAMMARS.map(
      (name) => `node_modules/recognizer/grammars/${name}.wasm`,
    ),
    "node_modules/recognizer/grammars/PROVENANCE.json",
    ...closurePaths.map((path) => `${path}/package.json`),
    ...COMMAND_LINKS.map(([name]) => `${COMMANDS_FOLDER}/${name}`),
    "THIRD-PARTY-NOTICES.md",
    "LICENSE",
  ];
}

export function verifyArchive(listing, closurePaths) {
  const present = new Set(
    listing
      .split("\n")
      .map((line) => line.trim().replace(/^\.\//, ""))
      .filter((line) => line !== ""),
  );
  const missing = archiveEntries(closurePaths).filter(
    (name) => !present.has(name),
  );

  if (missing.length > 0) {
    throw new Error(`toolchain archive is missing: ${missing.join(", ")}`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}): ${result.stderr}`,
    );
  }

  return result.stdout;
}

export function buildToolchain(root, outDir) {
  const version = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ).version;
  const lock = JSON.parse(
    readFileSync(join(root, "package-lock.json"), "utf8"),
  );
  const closure = closureFromLock(lock);
  assertNoInstallScripts(lock);
  const closurePaths = [...closure.keys()];
  const folder = join(outDir, FOLDER);
  const packed = mkdtempSync(join(tmpdir(), "toolchain-packed-"));

  try {
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });

    run("npm", ["pack", "-w", "recognizer", "--pack-destination", packed], {
      cwd: root,
    });

    for (const name of OWN_PACKAGES) {
      const dir = join(folder, "node_modules", name);

      mkdirSync(dir, { recursive: true });
      run("tar", [
        "-xzf",
        join(packed, `${name}-${version}.tgz`),
        "-C",
        dir,
        "--strip-components=1",
      ]);
      chmodSync(join(dir, "dist", "bin.js"), 0o755);
    }

    const versions = {};

    for (const path of closurePaths) {
      const top = path.split("/node_modules/")[0];

      cpSync(join(root, top), join(folder, top), { recursive: true });
    }

    for (const path of closurePaths) {
      versions[path] = JSON.parse(
        readFileSync(join(folder, path, "package.json"), "utf8"),
      ).version;
    }

    verifyVendored(lock, versions);
    writeCommandLinks(folder);

    copyFileSync(
      join(root, "THIRD-PARTY-NOTICES.md"),
      join(folder, "THIRD-PARTY-NOTICES.md"),
    );
    copyFileSync(join(root, "LICENSE"), join(folder, "LICENSE"));

    const archive = join(outDir, ARCHIVE);
    const names = readdirSync(folder).sort();

    run("tar", ["-czf", archive, "-C", folder, ...names]);
    verifyArchive(run("tar", ["-tzf", archive]), closurePaths);

    return archive;
  } finally {
    rmSync(packed, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));

  process.stdout.write(
    `${buildToolchain(root, process.argv[2] ?? "dist-release")}\n`,
  );
}
