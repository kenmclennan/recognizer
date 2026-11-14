import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  archiveEntries,
  buildGrammarWheel,
  buildPlugin,
  exportArguments,
  GRAMMARS,
  grammarSource,
  mergeRequirements,
  pythonInstallArguments,
  verifyArchive,
  wrapperEntries,
  wrapperScript,
} from "./build-plugin.mjs";
import { makeTempDir } from "./temp-dirs.mjs";
import { findUnit, loadUnits } from "./units.mjs";

const closure = ["node_modules/ajv", "node_modules/yaml"];
const PINNED_COMMIT = "f1c7c1ee21f56a33412c12efb8abe0c483f05f0d";
const KOTLIN_PINNED_COMMIT = "d6af96d2e23ef0a8ff5ab512864378cf08fba311";
const CSHARP = GRAMMARS.find((g) => g.package === "tree-sitter-c-sharp");
const KOTLIN = GRAMMARS.find((g) => g.package === "tree-sitter-kotlin");
const HOMEBREW_PYTHON = "/opt/homebrew/opt/python@3.13/bin/python3.13";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const UNITS = loadUnits(ROOT);
const unit = (id) => findUnit(UNITS, id);

describe("archiveEntries", () => {
  it("lists bin/<command> for exactly the unit's commands, the notices and the licence", () => {
    expect(
      Object.fromEntries(
        UNITS.map((entry) => [
          entry.unit,
          archiveEntries(entry, "1.2.3", closure).filter((name) =>
            name.startsWith("bin/"),
          ),
        ]),
      ),
    ).toEqual({
      "scan-python": ["bin/recognizer-scan-python"],
      "scan-typescript": ["bin/recognizer-scan-typescript"],
      "scan-kotlin": ["bin/recognizer-scan-kotlin"],
      "scan-csharp": ["bin/recognizer-scan-csharp"],
      "scan-rust": ["bin/recognizer-scan-rust"],
      sensors: [
        "bin/recognizer-sense-crap",
        "bin/recognizer-sense-mutation",
        "bin/recognizer-sense-thresholds",
      ],
      "describe-claude": ["bin/recognizer-describe-claude"],
    });

    for (const entry of UNITS) {
      expect(archiveEntries(entry, "1.2.3", closure)).toContain("LICENSE");
      expect(archiveEntries(entry, "1.2.3", closure)).toContain(
        "THIRD-PARTY-NOTICES.md",
      );
    }
  });

  it("names the installed Python package and its dist-info for a Python unit and the package and closure for a Node unit", () => {
    expect(archiveEntries(unit("sensors"), "1.2.3", closure)).toEqual([
      "python/recognizer_sensors/cli.py",
      "python/recognizer_sensors-1.2.3.dist-info/METADATA",
      "bin/recognizer-sense-crap",
      "bin/recognizer-sense-mutation",
      "bin/recognizer-sense-thresholds",
      "THIRD-PARTY-NOTICES.md",
      "LICENSE",
    ]);
    expect(archiveEntries(unit("scan-typescript"), "1.2.3", closure)).toEqual([
      "node_modules/recognizer-scan-typescript/package.json",
      "node_modules/ajv/package.json",
      "node_modules/yaml/package.json",
      "bin/recognizer-scan-typescript",
      "THIRD-PARTY-NOTICES.md",
      "LICENSE",
    ]);
  });
});

describe("the wrapper table", () => {
  it("generates exactly the four commands the pyprojects declare, with their entry points", () => {
    expect(wrapperEntries(unit("scan-kotlin"))).toEqual([
      { command: "recognizer-scan-kotlin", module: "recognizer_scan_kotlin" },
    ]);
    expect(wrapperEntries(unit("sensors"))).toEqual(
      ["crap", "mutation", "thresholds"].map((name) => ({
        command: `recognizer-sense-${name}`,
        module: "recognizer_sensors",
        entry: `recognizer_sensors.entry:${name}`,
      })),
    );
  });

  it("matches the commands each pyproject declares", () => {
    for (const entry of UNITS.filter(({ unit: id }) =>
      ["scan-python", "scan-kotlin", "scan-csharp", "sensors"].includes(id),
    )) {
      const text = readFileSync(
        join(ROOT, entry.folder, "pyproject.toml"),
        "utf8",
      );
      const section = /\[project\.scripts\]\n([^[]*)/.exec(text)[1];
      const declared = [...section.matchAll(/^(\S+)\s*=\s*"([^"]+)"/gm)].map(
        (match) => [match[1], match[2]],
      );

      expect(declared).toEqual(
        wrapperEntries(entry).map(({ command, module, entry: path }) => [
          command,
          path ?? `${module}.cli:main`,
        ]),
      );
    }
  });

  it("imports and calls the function an entry names instead of main", () => {
    const script = wrapperScript({
      command: "recognizer-sense-crap",
      module: "recognizer_sensors",
      entry: "recognizer_sensors.entry:crap",
    });

    expect(script).toContain("from recognizer_sensors.entry import crap");
    expect(script).toContain("sys.exit(crap())");
    expect(script).not.toContain("import main");
  });

  it("installs the four project wheels into the target for the Homebrew interpreter", () => {
    const args = pythonInstallArguments(
      "/w",
      "/t",
      "1.2.3",
      "recognizer_sensors",
    );

    expect(args).toContain("--target");
    expect(args).toContain("--no-index");
    expect(args).toContain("aarch64-apple-darwin");
    expect(args.slice(-1)).toEqual([
      "/w/recognizer_sensors-1.2.3-py3-none-any.whl",
    ]);
  });
});

describe("a wrapper", () => {
  const entry = wrapperEntries(unit("scan-python"))[0];
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

describe("verifyArchive", () => {
  const entry = unit("sensors");
  const entries = [
    ...archiveEntries(entry, "1.2.3", []),
    "python/tree_sitter_c_sharp/__init__.py",
    "python/tree_sitter_kotlin/__init__.py",
  ];
  const full = `${entries.join("\n")}\n`;

  it("accepts a complete listing", () => {
    expect(() => verifyArchive(full, entry, "1.2.3")).not.toThrow();
  });

  it("accepts a listing whose names carry a leading ./", () => {
    const listing = entries.map((name) => `./${name}`).join("\n");

    expect(() => verifyArchive(listing, entry, "1.2.3")).not.toThrow();
  });

  it.each([
    [
      "a command",
      "bin/recognizer-sense-mutation\n",
      /bin\/recognizer-sense-mutation/,
    ],
    [
      "the sensors package",
      "python/recognizer_sensors/cli.py\n",
      /python\/recognizer_sensors/,
    ],
    [
      "the dist-info",
      "python/recognizer_sensors-1.2.3.dist-info/METADATA\n",
      /recognizer_sensors-1\.2\.3/,
    ],
    [
      "the C# grammar package",
      "python/tree_sitter_c_sharp/__init__.py\n",
      /tree_sitter_c_sharp/,
    ],
    [
      "the Kotlin grammar package",
      "python/tree_sitter_kotlin/__init__.py\n",
      /tree_sitter_kotlin/,
    ],
    ["the notices file", "THIRD-PARTY-NOTICES.md\n", /THIRD-PARTY-NOTICES\.md/],
  ])("fails when %s is missing", (_, name, pattern) => {
    expect(() => verifyArchive(full.replace(name, ""), entry, "1.2.3")).toThrow(
      pattern,
    );
  });

  it("fails for a listing built for another version", () => {
    expect(() => verifyArchive(full, entry, "1.2.4")).toThrow(/1\.2\.4/);
  });

  it("names the missing closure package of a Node unit", () => {
    const node = unit("scan-typescript");
    const listing = archiveEntries(node, "1.2.3", closure)
      .filter((name) => name !== "node_modules/yaml/package.json")
      .join("\n");

    expect(() => verifyArchive(listing, node, "1.2.3", closure)).toThrow(
      /node_modules\/yaml/,
    );
  });
});

describe("buildPlugin on the describer", () => {
  it("writes an archive that lists its one command", () => {
    const out = mkdtempSync(join(tmpdir(), "build-plugin-"));

    try {
      const archive = buildPlugin(ROOT, "describe-claude", "0.1.0", out);
      const listing = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });

      expect(listing.stdout).toContain("bin/recognizer-describe-claude");
      expect(listing.stdout).not.toContain("bin/recognizer-scan-");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120000);

  it("refuses a unit it does not know", () => {
    expect(() => buildPlugin(ROOT, "scan-cobol", "0.1.0", tmpdir())).toThrow(
      /no unit scan-cobol/,
    );
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
