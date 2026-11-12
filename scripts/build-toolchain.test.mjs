import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  archiveEntries,
  buildGrammarWheel,
  COMMAND_LINKS,
  exportArguments,
  GRAMMARS,
  grammarSource,
  mergeRequirements,
  PYTHON_COMMANDS,
  pythonInstallArguments,
  verifyArchive,
  wrapperScript,
  writeCommandLinks,
} from "./build-toolchain.mjs";
import { makeTempDir } from "./temp-dirs.mjs";
import { verifyCommands } from "./verify-toolchain.mjs";

const closure = ["node_modules/ajv", "node_modules/yaml"];
const PINNED_COMMIT = "f1c7c1ee21f56a33412c12efb8abe0c483f05f0d";
const KOTLIN_PINNED_COMMIT = "d6af96d2e23ef0a8ff5ab512864378cf08fba311";
const CSHARP = GRAMMARS.find((g) => g.package === "tree-sitter-c-sharp");
const KOTLIN = GRAMMARS.find((g) => g.package === "tree-sitter-kotlin");
const HOMEBREW_PYTHON = "/opt/homebrew/opt/python@3.13/bin/python3.13";
const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("archiveEntries", () => {
  it("names the vendored packages, the installed Python folder, the wrappers, the notices and the licence", () => {
    expect(archiveEntries("1.2.3", closure)).toEqual([
      "node_modules/recognizer/package.json",
      "node_modules/recognizer-scan-typescript/package.json",
      "node_modules/recognizer-describe-claude/package.json",
      "node_modules/recognizer/grammars/python.wasm",
      "node_modules/recognizer/grammars/typescript.wasm",
      "node_modules/recognizer/grammars/tsx.wasm",
      "node_modules/recognizer/grammars/kotlin.wasm",
      "node_modules/recognizer/grammars/rust.wasm",
      "node_modules/recognizer/grammars/csharp.wasm",
      "node_modules/recognizer/grammars/PROVENANCE.json",
      "node_modules/ajv/package.json",
      "node_modules/yaml/package.json",
      "python/recognizer_scan_python/cli.py",
      "python/recognizer_scan_kotlin/cli.py",
      "python/recognizer_scan_csharp/cli.py",
      "python/recognizer_sensors/cli.py",
      "python/recognizer_scan_python-1.2.3.dist-info/METADATA",
      "python/recognizer_scan_kotlin-1.2.3.dist-info/METADATA",
      "python/recognizer_scan_csharp-1.2.3.dist-info/METADATA",
      "python/recognizer_sensors-1.2.3.dist-info/METADATA",
      "bin/recognizer-scan-python",
      "bin/recognizer-scan-kotlin",
      "bin/recognizer-scan-csharp",
      "bin/recognizer-sensors",
      "recognizer-scan-rust",
      "commands/recognizer",
      "commands/recognizer-scan-typescript",
      "commands/recognizer-describe-claude",
      "commands/recognizer-scan-python",
      "commands/recognizer-scan-kotlin",
      "commands/recognizer-scan-csharp",
      "commands/recognizer-sensors",
      "commands/recognizer-scan-rust",
      "THIRD-PARTY-NOTICES.md",
      "LICENSE",
    ]);
  });
});

describe("the wrapper table", () => {
  it("generates exactly the four commands the pyprojects declare, with their entry points", () => {
    const declared = PYTHON_COMMANDS.flatMap(({ project }) => {
      const text = readFileSync(join(ROOT, project, "pyproject.toml"), "utf8");
      const section = /\[project\.scripts\]\n([^[]*)/.exec(text)[1];

      return [...section.matchAll(/^(\S+)\s*=\s*"([^"]+)"/gm)].map((match) => [
        match[1],
        match[2],
      ]);
    });

    expect(declared).toEqual(
      PYTHON_COMMANDS.map(({ command, module }) => [
        command,
        `${module}.cli:main`,
      ]),
    );
    expect(PYTHON_COMMANDS).toHaveLength(4);

    for (const entry of PYTHON_COMMANDS) {
      expect(wrapperScript(entry)).toContain(
        `from ${entry.module}.cli import main`,
      );
    }
  });

  it("installs the four project wheels into the target for the Homebrew interpreter", () => {
    const args = pythonInstallArguments("/w", "/t", "1.2.3");

    expect(args).toContain("--target");
    expect(args).toContain("--no-index");
    expect(args).toContain("aarch64-apple-darwin");
    expect(args.slice(-4)).toEqual([
      "/w/recognizer_scan_python-1.2.3-py3-none-any.whl",
      "/w/recognizer_scan_kotlin-1.2.3-py3-none-any.whl",
      "/w/recognizer_scan_csharp-1.2.3-py3-none-any.whl",
      "/w/recognizer_sensors-1.2.3-py3-none-any.whl",
    ]);
  });
});

describe("a wrapper", () => {
  const entry = PYTHON_COMMANDS[0];

  function lay(dir, interpreterBody) {
    const interpreter = join(dir, "fake-python");

    writeFileSync(interpreter, interpreterBody);
    chmodSync(interpreter, 0o755);
    mkdirSync(join(dir, "toolchain/bin"), { recursive: true });
    mkdirSync(join(dir, "toolchain/python"), { recursive: true });

    const wrapper = join(dir, "toolchain/bin", entry.command);

    writeFileSync(wrapper, wrapperScript(entry, interpreter));
    chmodSync(wrapper, 0o755);

    return wrapper;
  }

  it("resolves a symlink chain to itself, forwards arguments and returns the exit code", () => {
    const dir = makeTempDir("wrapper-");
    const wrapper = lay(
      dir,
      '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done\nexit 7\n',
    );

    mkdirSync(join(dir, "links"));
    symlinkSync(wrapper, join(dir, "links/middle"));
    symlinkSync(join(dir, "links/middle"), join(dir, "links/outer"));

    const result = spawnSync(join(dir, "links/outer"), ["--flag", "a b"], {
      encoding: "utf8",
    });
    const lines = result.stdout.trim().split("\n");

    expect(result.status).toBe(7);
    expect(lines.slice(-2)).toEqual(["--flag", "a b"]);
    expect(lines.at(-3).endsWith("/toolchain/bin/../python")).toBe(true);
    expect(existsSync(lines.at(-3))).toBe(true);
  });

  it("leaves PYTHONPATH out of the interpreter's environment", () => {
    const dir = makeTempDir("wrapper-env-");
    const wrapper = lay(
      dir,
      '#!/bin/sh\nif [ -z "$PYTHONPATH" ]; then printf unset; else printf set; fi\n',
    );
    const result = spawnSync(wrapper, [], {
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin" },
    });

    expect(result.stdout).toBe("unset");
  });

  it.skipIf(!existsSync(HOMEBREW_PYTHON))(
    "runs the real wrapper over a real Python folder",
    () => {
      const dir = makeTempDir("wrapper-real-");
      const target = join(dir, "toolchain/python");

      mkdirSync(join(target, entry.module), { recursive: true });
      writeFileSync(join(target, entry.module, "__init__.py"), "");
      writeFileSync(
        join(target, entry.module, "cli.py"),
        "import sys\n\ndef main():\n    print('ok', *sys.argv)\n    return 3\n",
      );
      mkdirSync(join(dir, "toolchain/bin"), { recursive: true });

      const wrapper = join(dir, "toolchain/bin", entry.command);

      writeFileSync(wrapper, wrapperScript(entry));
      chmodSync(wrapper, 0o755);

      const result = spawnSync(wrapper, ["--version"], { encoding: "utf8" });

      expect(result.stdout.trim()).toBe(`ok ${entry.command} --version`);
      expect(result.status).toBe(3);
    },
  );
});

describe("mergeRequirements", () => {
  const kotlin =
    "# header\ntree-sitter==0.26.0 \\\n    --hash=sha256:aa \\\n    --hash=sha256:bb\ntree-sitter-kotlin==1.1.0 \\\n    --hash=sha256:cc\n";
  const sensors =
    "# header\ntree-sitter==0.26.0 \\\n    --hash=sha256:aa \\\n    --hash=sha256:bb\ntree-sitter-rust==0.24.2 \\\n    --hash=sha256:dd\ntree-sitter-kotlin==1.1.0 \\\n    --hash=sha256:cc\n";

  it("keeps each requirement once with its own hashes", () => {
    expect(mergeRequirements([kotlin, sensors])).toBe(
      "tree-sitter==0.26.0 \\\n    --hash=sha256:aa \\\n    --hash=sha256:bb\ntree-sitter-kotlin==1.1.0 \\\n    --hash=sha256:cc\ntree-sitter-rust==0.24.2 \\\n    --hash=sha256:dd\n",
    );
  });
});

describe("the commands folder", () => {
  it("holds the eight commands as links that resolve to executables inside the folder", () => {
    const folder = makeTempDir("commands-");

    for (const [, target] of COMMAND_LINKS) {
      const real = join(folder, target.replace("../", ""));

      mkdirSync(dirname(real), { recursive: true });
      writeFileSync(real, "#!/bin/sh\n");
      chmodSync(real, 0o755);
    }

    writeCommandLinks(folder);

    expect(readdirSync(join(folder, "commands")).sort()).toEqual(
      COMMAND_LINKS.map(([name]) => name).sort(),
    );
    expect(COMMAND_LINKS).toHaveLength(8);
    expect(() => verifyCommands(folder)).not.toThrow();
  });

  it("fails verification when an entry is missing or points outside", () => {
    const folder = makeTempDir("commands-bad-");
    const outside = makeTempDir("commands-out-");

    writeFileSync(join(outside, "tool"), "#!/bin/sh\n");
    chmodSync(join(outside, "tool"), 0o755);

    for (const [, target] of COMMAND_LINKS) {
      const real = join(folder, target.replace("../", ""));

      mkdirSync(dirname(real), { recursive: true });
      writeFileSync(real, "#!/bin/sh\n");
      chmodSync(real, 0o755);
    }

    writeCommandLinks(folder);
    rmSync(join(folder, "commands/recognizer-sensors"));
    rmSync(join(folder, "commands/recognizer"));
    symlinkSync(join(outside, "tool"), join(folder, "commands/recognizer"));

    expect(() => verifyCommands(folder)).toThrow(
      /recognizer points outside.*recognizer-sensors is missing/,
    );
  });
});

describe("verifyArchive", () => {
  const entries = [
    ...archiveEntries("1.2.3", closure),
    "python/tree_sitter_c_sharp/__init__.py",
    "python/tree_sitter_kotlin/__init__.py",
  ];
  const full = `${entries.join("\n")}\n`;

  it("accepts a complete listing", () => {
    expect(() => verifyArchive(full, "1.2.3", closure)).not.toThrow();
  });

  it("accepts a listing whose names carry a leading ./", () => {
    const listing = entries.map((name) => `./${name}`).join("\n");

    expect(() => verifyArchive(listing, "1.2.3", closure)).not.toThrow();
  });

  it.each([
    [
      "a wrapper",
      "bin/recognizer-scan-kotlin\n",
      /bin\/recognizer-scan-kotlin/,
    ],
    [
      "the sensors package",
      "python/recognizer_sensors/cli.py\n",
      /python\/recognizer_sensors/,
    ],
    [
      "a dist-info",
      "python/recognizer_scan_csharp-1.2.3.dist-info/METADATA\n",
      /recognizer_scan_csharp-1\.2\.3/,
    ],
    ["the Rust binary", "recognizer-scan-rust\n", /recognizer-scan-rust/],
    [
      "the grammar package",
      "python/tree_sitter_c_sharp/__init__.py\n",
      /tree_sitter_c_sharp/,
    ],
    [
      "the Kotlin grammar package",
      "python/tree_sitter_kotlin/__init__.py\n",
      /tree_sitter_kotlin/,
    ],
    [
      "the describer",
      "node_modules/recognizer-describe-claude/package.json\n",
      /recognizer-describe-claude/,
    ],
    ["the notices file", "THIRD-PARTY-NOTICES.md\n", /THIRD-PARTY-NOTICES\.md/],
    [
      "a vendored source grammar",
      "node_modules/recognizer/grammars/kotlin.wasm\n",
      /grammars\/kotlin\.wasm/,
    ],
    [
      "a closure package",
      "node_modules/yaml/package.json\n",
      /node_modules\/yaml/,
    ],
  ])("fails when %s is missing", (_, entry, pattern) => {
    expect(() =>
      verifyArchive(full.replace(entry, ""), "1.2.3", closure),
    ).toThrow(pattern);
  });

  it("fails for a listing built for another version", () => {
    expect(() => verifyArchive(full, "1.2.4", closure)).toThrow(/1\.2\.4/);
  });
});

describe("the grammar wheel", () => {
  const pyproject = readFileSync(
    fileURLToPath(
      new URL("../scanners/csharp/pyproject.toml", import.meta.url),
    ),
    "utf8",
  );

  it("reads the pinned commit from the scanner's pyproject", () => {
    expect(grammarSource(pyproject, CSHARP)).toEqual({
      url: "https://github.com/tree-sitter/tree-sitter-c-sharp",
      rev: PINNED_COMMIT,
    });
  });

  it("reads each grammar's pin from its own project's pyproject, the Kotlin scanner and the sensors alike", () => {
    for (const project of ["scanners/kotlin", "sensors"]) {
      const text = readFileSync(
        fileURLToPath(new URL(`../${project}/pyproject.toml`, import.meta.url)),
        "utf8",
      );

      expect(grammarSource(text, KOTLIN)).toEqual({
        url: "https://github.com/fwcd/tree-sitter-kotlin",
        rev: KOTLIN_PINNED_COMMIT,
      });
    }
  });

  it("refuses a pyproject with no pinned git source, naming the project and package", () => {
    expect(() => grammarSource('[project]\nname = "x"\n', CSHARP)).toThrow(
      /scanners\/csharp\/pyproject.toml has no pinned git source for tree-sitter-c-sharp/,
    );
    expect(() => grammarSource('[project]\nname = "x"\n', KOTLIN)).toThrow(
      /scanners\/kotlin\/pyproject.toml has no pinned git source for tree-sitter-kotlin/,
    );
  });

  it("keeps the grammar out of the hash-checked requirements", () => {
    const args = exportArguments();

    expect(args.slice(args.indexOf("--no-emit-package"))).toEqual([
      "--no-emit-package",
      "tree-sitter-kotlin",
      "--no-emit-package",
      "tree-sitter-c-sharp",
      "--format",
      "requirements-txt",
    ]);
  });

  it("fetches the pinned commit, checks it out and builds one wheel into the wheelhouse", () => {
    const calls = [];
    const exec = (command, args, options = {}) => {
      calls.push([command, args, options.cwd]);

      return command === "git" && args[0] === "rev-parse"
        ? `${PINNED_COMMIT}\n`
        : "";
    };

    buildGrammarWheel(grammarSource(pyproject, CSHARP), "/wheelhouse", exec);

    const cwd = calls[0][2];

    expect(
      calls.map(([command, args]) => [command, ...args.slice(0, 2)]),
    ).toEqual([
      ["git", "init", "--quiet"],
      ["git", "remote", "add"],
      ["git", "fetch", "--quiet"],
      ["git", "checkout", "--quiet"],
      ["git", "rev-parse", "HEAD"],
      ["uv", "build", "--wheel"],
    ]);
    expect(calls[2][1]).toEqual([
      "fetch",
      "--quiet",
      "--depth",
      "1",
      "origin",
      PINNED_COMMIT,
    ]);
    expect(calls[5][1]).toEqual([
      "build",
      "--wheel",
      "--out-dir",
      "/wheelhouse",
      cwd,
    ]);
  });

  it("refuses a checkout that is not the pinned commit", () => {
    const exec = (command, args) =>
      command === "git" && args[0] === "rev-parse" ? "deadbeef\n" : "";

    expect(() =>
      buildGrammarWheel(grammarSource(pyproject, CSHARP), "/wheelhouse", exec),
    ).toThrow(/not the pinned/);
  });
});
