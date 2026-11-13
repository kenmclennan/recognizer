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
import { findUnit, loadUnits } from "./units.mjs";

const WHEELHOUSE = "wheelhouse";
const PYTHON_FOLDER = "python";
const PYTHON_INTERPRETER = "/opt/homebrew/opt/python@3.13/bin/python3.13";
const RUST_TARGET = "aarch64-apple-darwin";

export const GRAMMARS = [
  { package: "tree-sitter-kotlin", project: "scanners/kotlin" },
  { package: "tree-sitter-c-sharp", project: "scanners/csharp" },
];

const KOTLIN = GRAMMARS[0];
const CSHARP = GRAMMARS[1];

const KINDS = {
  "scan-python": {
    kind: "python",
    module: "recognizer_scan_python",
    grammars: [],
  },
  "scan-kotlin": {
    kind: "python",
    module: "recognizer_scan_kotlin",
    grammars: [KOTLIN],
  },
  "scan-csharp": {
    kind: "python",
    module: "recognizer_scan_csharp",
    grammars: [CSHARP],
  },
  sensors: {
    kind: "python",
    module: "recognizer_sensors",
    grammars: [KOTLIN, CSHARP],
  },
  "scan-typescript": { kind: "node", package: "recognizer-scan-typescript" },
  "describe-claude": { kind: "node", package: "recognizer-describe-claude" },
  "scan-rust": { kind: "rust" },
};

export function kindOf(unit) {
  const found = KINDS[unit];

  if (found === undefined) {
    throw new Error(`unit ${unit} has no build recipe`);
  }

  return found;
}

export function wrapperScript(
  { command, module, entry = `${module}.cli:main` },
  interpreter = PYTHON_INTERPRETER,
) {
  const [entryModule, entryFunction] = entry.split(":");
  const program = [
    "import sys",
    "sys.path.insert(0, sys.argv.pop(1))",
    `sys.argv[0] = "${command}"`,
    `from ${entryModule} import ${entryFunction}`,
    `sys.exit(${entryFunction}())`,
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

export function wrapperEntries(entry) {
  const recipe = kindOf(entry.unit);

  return entry.formulae.map(({ command }) =>
    entry.unit === "sensors"
      ? {
          command,
          module: recipe.module,
          entry: `recognizer_sensors.entry:${command.replace("recognizer-sense-", "")}`,
        }
      : { command, module: recipe.module },
  );
}

export function pythonInstallArguments(wheelhouse, target, version, module) {
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
    RUST_TARGET,
    join(wheelhouse, `${module}-${version}-py3-none-any.whl`),
  ];
}

export function archiveEntries(entry, version, closurePaths = []) {
  const recipe = kindOf(entry.unit);
  const commands = entry.formulae.map(({ command }) => `bin/${command}`);
  const common = ["THIRD-PARTY-NOTICES.md", "LICENSE"];

  if (recipe.kind === "python") {
    return [
      `${PYTHON_FOLDER}/${recipe.module}/cli.py`,
      `${PYTHON_FOLDER}/${recipe.module}-${version}.dist-info/METADATA`,
      ...commands,
      ...common,
    ];
  }

  if (recipe.kind === "node") {
    return [
      `node_modules/${recipe.package}/package.json`,
      ...closurePaths.map((path) => `${path}/package.json`),
      ...commands,
      ...common,
    ];
  }

  return [...commands, ...common];
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

export function verifyArchive(listing, entry, version, closurePaths = []) {
  const present = new Set(
    listing
      .split("\n")
      .map((line) => line.trim().replace(/^\.\//, ""))
      .filter((line) => line !== ""),
  );
  const missing = archiveEntries(entry, version, closurePaths).filter(
    (name) => !present.has(name),
  );

  for (const grammar of kindOf(entry.unit).grammars ?? []) {
    const folder = `${PYTHON_FOLDER}/${grammar.package.replaceAll("-", "_")}/`;

    if (![...present].some((name) => name.startsWith(folder))) {
      missing.push(`${folder}*`);
    }
  }

  if (missing.length > 0) {
    throw new Error(`${entry.unit} archive is missing: ${missing.join(", ")}`);
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

function buildPython(root, entry, version, folder, packed) {
  const recipe = kindOf(entry.unit);
  const wheelhouse = join(packed, WHEELHOUSE);
  const folderOfUnit = join(root, entry.folder);

  mkdirSync(wheelhouse, { recursive: true });
  run("uv", ["build", "--wheel", "--out-dir", wheelhouse, entry.folder], {
    cwd: root,
  });

  const requirements = join(packed, "wheelhouse-requirements.txt");
  const exported = mergeRequirements([
    run("uv", exportArguments(), { cwd: folderOfUnit }),
  ]);

  writeFileSync(requirements, exported);

  if (exported.trim() !== "") {
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
  }

  for (const grammar of recipe.grammars) {
    buildGrammarWheel(
      grammarSource(
        readFileSync(join(folderOfUnit, "pyproject.toml"), "utf8"),
        grammar,
      ),
      wheelhouse,
    );
  }

  run(
    "uv",
    pythonInstallArguments(
      wheelhouse,
      join(folder, PYTHON_FOLDER),
      version,
      recipe.module,
    ),
  );
  mkdirSync(join(folder, "bin"), { recursive: true });

  for (const wrapper of wrapperEntries(entry)) {
    const path = join(folder, "bin", wrapper.command);

    writeFileSync(path, wrapperScript(wrapper));
    chmodSync(path, 0o755);
  }
}

function buildNode(root, entry, version, folder, packed, closurePaths, lock) {
  const recipe = kindOf(entry.unit);
  const dir = join(folder, "node_modules", recipe.package);

  run("npm", ["run", "build", "-w", "recognizer"], { cwd: root });
  run("npm", ["run", "build", "-w", recipe.package], { cwd: root });
  run("npm", ["pack", "-w", recipe.package, "--pack-destination", packed], {
    cwd: root,
  });
  mkdirSync(dir, { recursive: true });
  run("tar", [
    "-xzf",
    join(packed, `${recipe.package}-${version}.tgz`),
    "-C",
    dir,
    "--strip-components=1",
  ]);
  chmodSync(join(dir, "dist", "bin.js"), 0o755);

  const versions = {};

  for (const path of closurePaths) {
    cpSync(
      join(root, path.split("/node_modules/")[0]),
      join(folder, path.split("/node_modules/")[0]),
      {
        recursive: true,
      },
    );
  }

  for (const path of closurePaths) {
    versions[path] = JSON.parse(
      readFileSync(join(folder, path, "package.json"), "utf8"),
    ).version;
  }

  verifyVendored(lock, versions, [entry.folder]);
  mkdirSync(join(folder, "bin"), { recursive: true });

  for (const { command } of entry.formulae) {
    symlinkSync(
      `../node_modules/${recipe.package}/dist/bin.js`,
      join(folder, "bin", command),
    );
  }
}

function buildRust(root, entry, folder) {
  run(
    "cargo",
    [
      "build",
      "--release",
      "--locked",
      "--target",
      RUST_TARGET,
      "--manifest-path",
      `${entry.folder}/Cargo.toml`,
    ],
    { cwd: root },
  );

  mkdirSync(join(folder, "bin"), { recursive: true });

  const command = entry.formulae[0].command;

  copyFileSync(
    join(root, entry.folder, "target", RUST_TARGET, "release", command),
    join(folder, "bin", command),
  );
  chmodSync(join(folder, "bin", command), 0o755);
}

export function buildPlugin(root, unit, version, outDir) {
  const entry = findUnit(loadUnits(root), unit);
  const recipe = kindOf(unit);
  const lock = JSON.parse(
    readFileSync(join(root, "package-lock.json"), "utf8"),
  );
  const folder = join(outDir, `${unit}-${version}`);
  const packed = mkdtempSync(join(tmpdir(), "plugin-packed-"));
  const closure =
    recipe.kind === "node" ? closureFromLock(lock, [entry.folder]) : new Map();
  const closurePaths = [...closure.keys()];

  if (recipe.kind === "node") {
    assertNoInstallScripts(lock, [entry.folder]);
  }

  try {
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });

    if (recipe.kind === "python") {
      buildPython(root, entry, version, folder, packed);
    } else if (recipe.kind === "node") {
      buildNode(root, entry, version, folder, packed, closurePaths, lock);
    } else {
      buildRust(root, entry, folder);
    }

    copyFileSync(
      join(root, "THIRD-PARTY-NOTICES.md"),
      join(folder, "THIRD-PARTY-NOTICES.md"),
    );
    copyFileSync(join(root, "LICENSE"), join(folder, "LICENSE"));

    const archive = join(outDir, `${unit}-${version}.tar.gz`);

    run("tar", ["-czf", archive, "-C", folder, ...readdirSync(folder).sort()]);
    verifyArchive(run("tar", ["-tzf", archive]), entry, version, closurePaths);
    rmSync(folder, { recursive: true, force: true });

    return archive;
  } finally {
    rmSync(packed, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [unit, version, outDir] = process.argv.slice(2);

  if (!unit || !version || !outDir) {
    process.stderr.write("usage: build-plugin.mjs <unit> <version> <outdir>\n");
    process.exit(2);
  }

  process.stdout.write(
    `${buildPlugin(fileURLToPath(new URL("..", import.meta.url)), unit, version, outDir)}\n`,
  );
}
