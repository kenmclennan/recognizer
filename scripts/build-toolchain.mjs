import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ARCHIVE = "recognizer-toolchain.tar.gz";

export function archiveEntries(version) {
  return [
    `recognizer-${version}.tgz`,
    `recognizer-scan-typescript-${version}.tgz`,
    `recognizer_scan_python-${version}-py3-none-any.whl`,
    "THIRD-PARTY-NOTICES.md",
    "LICENSE",
  ];
}

export function verifyArchive(listing, version) {
  const present = new Set(
    listing
      .split("\n")
      .map((line) => line.trim().replace(/^\.\//, ""))
      .filter((line) => line !== ""),
  );
  const missing = archiveEntries(version).filter((name) => !present.has(name));

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
  const staging = mkdtempSync(join(tmpdir(), "toolchain-"));

  try {
    run(
      "npm",
      [
        "pack",
        "-w",
        "recognizer",
        "-w",
        "recognizer-scan-typescript",
        "--pack-destination",
        staging,
      ],
      { cwd: root },
    );
    run("uv", ["build", "--wheel", "--out-dir", staging, "scanners/python"], {
      cwd: root,
    });
    copyFileSync(
      join(root, "THIRD-PARTY-NOTICES.md"),
      join(staging, "THIRD-PARTY-NOTICES.md"),
    );
    copyFileSync(join(root, "LICENSE"), join(staging, "LICENSE"));

    mkdirSync(outDir, { recursive: true });

    const archive = join(outDir, ARCHIVE);
    const wanted = new Set(archiveEntries(version));
    const names = readdirSync(staging)
      .filter((name) => wanted.has(name))
      .sort();

    run("tar", ["-czf", archive, "-C", staging, ...names]);

    const listing = run("tar", ["-tzf", archive]);

    verifyArchive(listing, version);

    return archive;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));

  process.stdout.write(
    `${buildToolchain(root, process.argv[2] ?? "dist-release")}\n`,
  );
}
