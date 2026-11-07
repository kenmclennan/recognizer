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
import {
  assertNoInstallScripts,
  closureFromLock,
  verifyVendored,
} from "./toolchain-closure.mjs";

export const ARCHIVE = "recognizer-toolchain.tar.gz";

const OWN_PACKAGES = [
  "recognizer",
  "recognizer-scan-typescript",
  "recognizer-describe-claude",
];
const RUST_BINARY = "recognizer-scan-rust";
const WHEELHOUSE = "wheelhouse";
export const GRAMMARS = [
  { package: "tree-sitter-kotlin", project: "scanners/kotlin" },
  { package: "tree-sitter-c-sharp", project: "scanners/csharp" },
];
const PYTHON_FOLDER = "python";
const FOLDER = "toolchain";
const PYTHON_INTERPRETER = "/opt/homebrew/opt/python@3.13/bin/python3.13";

export const PYTHON_COMMANDS = [
  {
    command: "recognizer-scan-python",
    module: "recognizer_scan_python",
    project: "scanners/python",
  },
  {
    command: "recognizer-scan-kotlin",
    module: "recognizer_scan_kotlin",
    project: "scanners/kotlin",
  },
  {
    command: "recognizer-scan-csharp",
    module: "recognizer_scan_csharp",
    project: "scanners/csharp",
  },
  {
    command: "recognizer-sensors",
    module: "recognizer_sensors",
    project: "sensors",
  },
];

export function wrapperScript(
  { command, module },
  interpreter = PYTHON_INTERPRETER,
) {
  const program = [
    "import sys",
    "sys.path.insert(0, sys.argv.pop(1))",
    `sys.argv[0] = "${command}"`,
    `from ${module}.cli import main`,
    "sys.exit(main())",
  ].join("; ");

  return [
    "#!/bin/sh",
    "self=$0",
    'while [ -L "$self" ]; do',
    '  dir=$(cd "$(dirname "$self")" && pwd)',
    '  link=$(readlink "$self")',
    '  case "$link" in',
    "    /*) self=$link ;;",
    "    *) self=$dir/$link ;;",
    "  esac",
    "done",
    'here=$(cd "$(dirname "$self")" && pwd)',
    `exec "${interpreter}" -c '${program}' "$here/../${PYTHON_FOLDER}" "$@"`,
    "",
  ].join("\n");
}

export function pythonInstallArguments(wheelhouse, target, version) {
  return [
    "pip",
    "install",
    "--target",
    target,
    "--no-index",
    "--find-links",
    wheelhouse,
    "--python-version",
    "3.13",
    "--python-platform",
    "aarch64-apple-darwin",
    ...PYTHON_COMMANDS.map(({ module }) =>
      join(wheelhouse, `${module}-${version}-py3-none-any.whl`),
    ),
  ];
}

export function archiveEntries(version, closurePaths) {
  return [
    ...OWN_PACKAGES.map((name) => `node_modules/${name}/package.json`),
    ...closurePaths.map((path) => `${path}/package.json`),
    ...PYTHON_COMMANDS.map(({ module }) => `${PYTHON_FOLDER}/${module}/cli.py`),
    ...PYTHON_COMMANDS.map(
      ({ module }) =>
        `${PYTHON_FOLDER}/${module}-${version}.dist-info/METADATA`,
    ),
    ...PYTHON_COMMANDS.map(({ command }) => `bin/${command}`),
    RUST_BINARY,
    "THIRD-PARTY-NOTICES.md",
    "LICENSE",
  ];
}

export function mergeRequirements(exports) {
  const blocks = new Map();

  for (const text of exports) {
    let current = null;

    for (const line of text.split("\n")) {
      if (line.trim() === "" || line.startsWith("#")) {
        continue;
      }

      if (!/^\s/.test(line)) {
        current = line.replace(/\s*\\$/, "").trim();

        if (!blocks.has(current)) {
          blocks.set(current, []);
        } else {
          current = null;
        }
      }

      if (current !== null) {
        blocks.get(current).push(line);
      }
    }
  }

  return `${[...blocks.values()].flat().join("\n")}\n`;
}

export function exportArguments() {
  return [
    "export",
    "--frozen",
    "--no-dev",
    "--no-emit-project",
    ...GRAMMARS.flatMap((grammar) => ["--no-emit-package", grammar.package]),
    "--format",
    "requirements-txt",
  ];
}

export function grammarSource(pyproject, grammar) {
  const entry = new RegExp(`^${grammar.package}\\s*=\\s*\\{[^}]*\\}`, "m").exec(
    pyproject,
  );
  const git = /git\s*=\s*"([^"]+)"/.exec(entry?.[0] ?? "");
  const rev = /rev\s*=\s*"([0-9a-f]{40})"/.exec(entry?.[0] ?? "");

  if (!git || !rev) {
    throw new Error(
      `${grammar.project}/pyproject.toml has no pinned git source for ${grammar.package}`,
    );
  }

  return { url: git[1], rev: rev[1] };
}

export function buildGrammarWheel(source, outDir, exec = run) {
  const checkout = mkdtempSync(join(tmpdir(), "grammar-"));

  try {
    exec("git", ["init", "--quiet"], { cwd: checkout });
    exec("git", ["remote", "add", "origin", source.url], { cwd: checkout });
    exec("git", ["fetch", "--quiet", "--depth", "1", "origin", source.rev], {
      cwd: checkout,
    });
    exec("git", ["checkout", "--quiet", "FETCH_HEAD"], { cwd: checkout });

    const head = exec("git", ["rev-parse", "HEAD"], { cwd: checkout }).trim();

    if (head !== source.rev) {
      throw new Error(
        `grammar checkout is ${head}, not the pinned ${source.rev}`,
      );
    }

    exec("uv", ["build", "--wheel", "--out-dir", outDir, checkout]);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
}

export function verifyArchive(listing, version, closurePaths) {
  const present = new Set(
    listing
      .split("\n")
      .map((line) => line.trim().replace(/^\.\//, ""))
      .filter((line) => line !== ""),
  );
  const missing = archiveEntries(version, closurePaths).filter(
    (name) => !present.has(name),
  );

  for (const grammar of GRAMMARS) {
    const folder = `${PYTHON_FOLDER}/${grammar.package.replaceAll("-", "_")}/`;

    if (![...present].some((name) => name.startsWith(folder))) {
      missing.push(`${folder}*`);
    }
  }

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

    const wheelhouse = join(packed, WHEELHOUSE);

    mkdirSync(wheelhouse, { recursive: true });

    for (const { project } of PYTHON_COMMANDS) {
      run("uv", ["build", "--wheel", "--out-dir", wheelhouse, project], {
        cwd: root,
      });
    }

    const requirements = join(packed, "wheelhouse-requirements.txt");
    const exported = ["scanners/kotlin", "scanners/csharp", "sensors"].map(
      (project) => run("uv", exportArguments(), { cwd: join(root, project) }),
    );

    writeFileSync(requirements, mergeRequirements(exported));
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

    for (const grammar of GRAMMARS) {
      buildGrammarWheel(
        grammarSource(
          readFileSync(join(root, grammar.project, "pyproject.toml"), "utf8"),
          grammar,
        ),
        wheelhouse,
      );
    }

    run(
      "uv",
      pythonInstallArguments(wheelhouse, join(folder, PYTHON_FOLDER), version),
    );

    mkdirSync(join(folder, "bin"), { recursive: true });

    for (const entry of PYTHON_COMMANDS) {
      const path = join(folder, "bin", entry.command);

      writeFileSync(path, wrapperScript(entry));
      chmodSync(path, 0o755);
    }

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
      join(folder, RUST_BINARY),
    );
    chmodSync(join(folder, RUST_BINARY), 0o755);

    copyFileSync(
      join(root, "THIRD-PARTY-NOTICES.md"),
      join(folder, "THIRD-PARTY-NOTICES.md"),
    );
    copyFileSync(join(root, "LICENSE"), join(folder, "LICENSE"));

    const archive = join(outDir, ARCHIVE);
    const names = readdirSync(folder).sort();

    run("tar", ["-czf", archive, "-C", folder, ...names]);

    const listing = run("tar", ["-tzf", archive]);

    verifyArchive(listing, version, closurePaths);

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
