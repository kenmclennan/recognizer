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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { closureFromLock, verifyVendored } from "./toolchain-closure.mjs";

export const ARCHIVE = "recognizer-toolchain.tar.gz";

const OWN_PACKAGES = [
  "recognizer",
  "recognizer-scan-typescript",
  "recognizer-describe-claude",
];
const RUST_BINARY = "recognizer-scan-rust";
const WHEELHOUSE = "wheelhouse";

export function archiveEntries(version, closurePaths, wheelhouseFiles = []) {
  return [
    ...OWN_PACKAGES.map((name) => `node_modules/${name}/package.json`),
    ...closurePaths.map((path) => `${path}/package.json`),
    `recognizer_scan_python-${version}-py3-none-any.whl`,
    `recognizer_scan_kotlin-${version}-py3-none-any.whl`,
    ...wheelhouseFiles.map((name) => `${WHEELHOUSE}/${name}`),
    RUST_BINARY,
    "THIRD-PARTY-NOTICES.md",
    "LICENSE",
  ];
}

export function verifyArchive(
  listing,
  version,
  closurePaths,
  wheelhouseFiles = [],
) {
  const present = new Set(
    listing
      .split("\n")
      .map((line) => line.trim().replace(/^\.\//, ""))
      .filter((line) => line !== ""),
  );
  const missing = archiveEntries(version, closurePaths, wheelhouseFiles).filter(
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
  const closurePaths = [...closure.keys()];
  const staging = mkdtempSync(join(tmpdir(), "toolchain-"));
  const packed = mkdtempSync(join(tmpdir(), "toolchain-packed-"));

  try {
    run(
      "npm",
      [
        "pack",
        "-w",
        "recognizer",
        "-w",
        "recognizer-scan-typescript",
        "-w",
        "recognizer-describe-claude",
        "--pack-destination",
        packed,
      ],
      { cwd: root },
    );

    for (const name of OWN_PACKAGES) {
      const dir = join(staging, "node_modules", name);

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

      cpSync(join(root, top), join(staging, top), { recursive: true });
    }

    for (const path of closurePaths) {
      versions[path] = JSON.parse(
        readFileSync(join(staging, path, "package.json"), "utf8"),
      ).version;
    }

    verifyVendored(lock, versions);

    run("uv", ["build", "--wheel", "--out-dir", staging, "scanners/python"], {
      cwd: root,
    });
    run("uv", ["build", "--wheel", "--out-dir", staging, "scanners/kotlin"], {
      cwd: root,
    });

    const wheelhouse = join(staging, WHEELHOUSE);
    const requirements = join(packed, "kotlin-requirements.txt");
    const exported = run(
      "uv",
      [
        "export",
        "--frozen",
        "--no-dev",
        "--no-emit-project",
        "--format",
        "requirements-txt",
      ],
      { cwd: join(root, "scanners/kotlin") },
    );

    writeFileSync(requirements, exported);
    mkdirSync(wheelhouse, { recursive: true });
    run("python3", [
      "-m",
      "pip",
      "download",
      "--require-hashes",
      "--only-binary=:all:",
      "--platform",
      "macosx_11_0_arm64",
      "--python-version",
      "3.13",
      "--implementation",
      "cp",
      "--abi",
      "cp313",
      "-r",
      requirements,
      "-d",
      wheelhouse,
    ]);

    const wheelhouseFiles = readdirSync(wheelhouse).sort();

    run(
      "cargo",
      [
        "build",
        "--release",
        "--locked",
        "--target",
        "aarch64-apple-darwin",
        "--manifest-path",
        "scanners/rust/Cargo.toml",
      ],
      { cwd: root },
    );
    copyFileSync(
      join(
        root,
        "scanners/rust/target/aarch64-apple-darwin/release",
        RUST_BINARY,
      ),
      join(staging, RUST_BINARY),
    );
    chmodSync(join(staging, RUST_BINARY), 0o755);

    copyFileSync(
      join(root, "THIRD-PARTY-NOTICES.md"),
      join(staging, "THIRD-PARTY-NOTICES.md"),
    );
    copyFileSync(join(root, "LICENSE"), join(staging, "LICENSE"));

    mkdirSync(outDir, { recursive: true });

    const archive = join(outDir, ARCHIVE);
    const names = readdirSync(staging).sort();

    run("tar", ["-czf", archive, "-C", staging, ...names]);

    const listing = run("tar", ["-tzf", archive]);

    verifyArchive(listing, version, closurePaths, wheelhouseFiles);

    return archive;
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(packed, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));

  process.stdout.write(
    `${buildToolchain(root, process.argv[2] ?? "dist-release")}\n`,
  );
}
