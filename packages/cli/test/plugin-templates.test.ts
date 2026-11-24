import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { KINDS, templateLanguages } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { PluginTemplatesAdapter } from "../src/adapters/plugins/plugin-templates-adapter.js";
import { run } from "../src/cli.js";
import { validateFindings } from "../src/findings-document.js";
import { validateScan } from "../src/scan.js";
import { capture } from "./helpers.js";

type Kind = (typeof KINDS)[number];
const LANGUAGES = templateLanguages(new PluginTemplatesAdapter().bundled());

type Language = string;

const VERB: Record<Kind, string> = {
  scanner: "scan",
  sensor: "sense",
  describer: "describe",
};

const REQUIRED = process.env.RECOGNIZER_REQUIRE_TEMPLATE_TOOLCHAINS === "1";

function works(command: string, args: string[]): boolean {
  return spawnSync(command, args, { encoding: "utf8" }).status === 0;
}

const TOOLCHAIN: Record<Language, boolean> = {
  python: works("python3", ["--version"]),
  typescript: works("node", [
    "--experimental-strip-types",
    "--disable-warning=ExperimentalWarning",
    "-e",
    "0",
  ]),
  rust: works("cargo", ["--version"]),
};

const PAIRS = LANGUAGES.flatMap((language) =>
  KINDS.map((kind) => [language, kind] as const),
);

const REQUEST =
  '{"module":"a.py","source":"x","members":[],"uses":[],"used_by":[]}';

interface Prepared {
  folder: string;
  command: string;
}

const prepared = new Map<string, Prepared>();

function prepare(language: Language, kind: Kind): Prepared {
  const key = `${language} ${kind}`;
  const known = prepared.get(key);

  if (known !== undefined) {
    return known;
  }

  const folder = makeTempDir("plugin-template-");
  const program = `recognizer-${VERB[kind]}-demo`;
  const captured = capture();
  const status = run(
    [
      "plugin",
      "init",
      "--kind",
      kind,
      "--language",
      language,
      "--name",
      "demo",
      folder,
    ],
    captured.io,
  );

  expect(status, captured.err()).toBe(0);

  let command = join(folder, program);

  if (language === "rust") {
    const built = spawnSync("cargo", ["build", "--offline"], {
      cwd: folder,
      encoding: "utf8",
    });

    expect(built.status, built.stderr).toBe(0);

    command = join(folder, "target", "debug", program);

    expect(existsSync(command)).toBe(true);
  }

  const result = { folder, command };

  prepared.set(key, result);

  return result;
}

function requestFile(): string {
  const file = join(makeTempDir("plugin-request-"), "request.json");

  writeFileSync(file, REQUEST);

  return file;
}

async function checked(command: string, kind: Kind) {
  const captured = capture();
  const extra = kind === "describer" ? ["--request", requestFile()] : [];
  const status = await run(
    ["plugin", "check", command, ...extra, "--json"],
    captured.io,
  );
  const report = JSON.parse(captured.out()) as {
    results: { name: string; status: string; reason?: string }[];
  };

  return { status, report, err: captured.err() };
}

function guardToolchain(language: Language): boolean {
  if (REQUIRED) {
    expect(TOOLCHAIN[language], `${language} toolchain is missing`).toBe(true);
  }

  return TOOLCHAIN[language];
}

function gitRepository(files: Record<string, string>): string {
  const repository = makeTempDir("plugin-repository-");

  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(repository, name), text);
  }

  const result = spawnSync("git", ["init", "-q"], { cwd: repository });

  expect(result.status).toBe(0);

  return repository;
}

const TIMEOUT = scaledTimeout(120_000);

describe("plugin templates conform as written", () => {
  for (const [language, kind] of PAIRS) {
    it.skipIf(!REQUIRED && !TOOLCHAIN[language])(
      `${language} ${kind}`,
      async () => {
        guardToolchain(language);

        const { command } = prepare(language, kind);
        const { status, report, err } = await checked(command, kind);

        expect(report.results, err).toHaveLength(13);

        for (const entry of report.results.filter(
          (result) => result.name !== "stop",
        )) {
          expect(entry, entry.name).toMatchObject({ status: "ok" });
        }

        const stop = report.results.find((entry) => entry.name === "stop");

        expect(
          ["ok", "warn"],
          JSON.stringify({ status: stop?.status, reason: stop?.reason }),
        ).toContain(stop?.status);
        expect(status).toBe(0);
      },
      TIMEOUT,
    );
  }
});

describe("scanner templates", () => {
  for (const language of LANGUAGES) {
    it.skipIf(!REQUIRED && !TOOLCHAIN[language])(
      `${language} scanner hashes files and escapes odd names`,
      () => {
        guardToolchain(language);

        const { command } = prepare(language, "scanner");
        const content = "line one\nline two\n";
        const repository = gitRepository({ "sample.demo": content });
        const output = join(makeTempDir("plugin-scan-"), "scan.json");
        const first = spawnSync(
          command,
          ["run", repository, "--output", output, "--commit", "abc123"],
          { encoding: "utf8" },
        );

        expect(first.status, first.stderr).toBe(0);

        const scan = JSON.parse(readFileSync(output, "utf8")) as {
          files: { path: string; hash: string }[];
          modules: { id: string }[];
          commit: string;
        };

        expect(scan.files[0]?.hash).toBe(
          createHash("sha256").update(content).digest("hex"),
        );
        expect(scan.modules[0]?.id).toBe(scan.files[0]?.path);
        expect(scan.commit).toBe("abc123");

        const odd = 'a "quoted".demo';

        writeFileSync(join(repository, odd), "other\n");

        const second = spawnSync(
          command,
          ["run", repository, "--output", output],
          { encoding: "utf8" },
        );

        expect(second.status, second.stderr).toBe(0);

        const rescanned = JSON.parse(readFileSync(output, "utf8")) as {
          modules: { id: string }[];
          files: { path: string; hash: string }[];
          commit: null;
          modified: null;
        };

        expect(() => validateScan(rescanned)).not.toThrow();
        expect(rescanned.modules.map((module) => module.id)).toContain(odd);
        expect(rescanned.files.find((file) => file.path === odd)?.hash).toBe(
          createHash("sha256").update("other\n").digest("hex"),
        );
        expect(rescanned.commit).toBeNull();
        expect(rescanned.modified).toBeNull();
      },
      TIMEOUT,
    );
  }
});

describe("sensor templates", () => {
  for (const language of LANGUAGES) {
    it.skipIf(!REQUIRED && !TOOLCHAIN[language])(
      `${language} sensor writes valid findings for the commit`,
      () => {
        guardToolchain(language);

        const { command } = prepare(language, "sensor");
        const repository = gitRepository({ "a.txt": "x\n" });
        const output = join(makeTempDir("plugin-sense-"), "findings.json");
        const done = spawnSync(
          command,
          [
            "run",
            "--repository",
            repository,
            "--commit",
            "abc123",
            "--output",
            output,
          ],
          { encoding: "utf8" },
        );

        expect(done.status, done.stderr).toBe(0);

        const document = validateFindings(
          JSON.parse(readFileSync(output, "utf8")),
          { name: "demo", commit: "abc123" },
        );

        expect(document.findings).toEqual([]);
        expect(document.commit).toBe("abc123");
      },
      TIMEOUT,
    );
  }
});

describe("typescript templates through a symlink", () => {
  for (const kind of KINDS) {
    it.skipIf(!REQUIRED && !TOOLCHAIN.typescript)(
      `typescript ${kind}`,
      async () => {
        guardToolchain("typescript");

        const { command } = prepare("typescript", kind);
        const bin = join(makeTempDir("plugin-bin-"), "bin");

        mkdirSync(bin);

        const link = join(bin, `recognizer-${VERB[kind]}-demo`);

        symlinkSync(command, link);

        const { status, report } = await checked(link, kind);

        expect(report.results).toHaveLength(13);
        expect(
          report.results.filter((entry) => entry.status === "fail"),
        ).toEqual([]);
        expect(status).toBe(0);
      },
      TIMEOUT,
    );
  }
});

describe("python sensor template stops inside its write", () => {
  it.skipIf(!REQUIRED && !TOOLCHAIN.python)(
    "a stop that lands inside the findings write leaves one valid stopped document and no temporary file",
    () => {
      guardToolchain("python");

      const { command } = prepare("python", "sensor");
      const folder = makeTempDir("plugin-stop-inside-write-");
      const output = join(folder, "findings.json");
      const harness = join(makeTempDir("plugin-stop-harness-"), "harness.py");

      writeFileSync(
        harness,
        [
          "import importlib.machinery, importlib.util, json, signal, sys",
          "loader = importlib.machinery.SourceFileLoader('sensor', sys.argv[1])",
          "spec = importlib.util.spec_from_loader('sensor', loader)",
          "sensor = importlib.util.module_from_spec(spec)",
          "loader.exec_module(sensor)",
          "sensor.state['commit'] = 'abc'",
          "sensor.state['output'] = sys.argv[2]",
          "signal.signal(signal.SIGTERM, sensor.on_term)",
          "real_dump = json.dump",
          "fired = []",
          "def dump(*args, **kwargs):",
          "    real_dump(*args, **kwargs)",
          "    if not fired:",
          "        fired.append(True)",
          "        signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)",
          "json.dump = dump",
          "try:",
          "    sensor.write_findings(False)",
          "except SystemExit as exit:",
          "    sys.exit(exit.code)",
          "sys.exit(0)",
          "",
        ].join("\n"),
      );

      const result = spawnSync("python3", [harness, command, output], {
        encoding: "utf8",
      });

      expect(result.status, result.stderr).toBe(143);

      const document = JSON.parse(readFileSync(output, "utf8"));

      expect(document).toHaveProperty("stopped");
      expect(document.stopped).toEqual({ measured: 0, total: 1 });
      expect(readdirSync(folder)).toEqual(["findings.json"]);
    },
    TIMEOUT,
  );
});

describe("python scanner template stops inside its write", () => {
  it.skipIf(!REQUIRED && !TOOLCHAIN.python)(
    "a stop that lands inside the scan write leaves one valid document and no temporary file",
    () => {
      guardToolchain("python");

      const { command } = prepare("python", "scanner");
      const folder = makeTempDir("plugin-stop-inside-write-");
      const output = join(folder, "scan.json");
      const harness = join(makeTempDir("plugin-stop-harness-"), "harness.py");

      writeFileSync(
        harness,
        [
          "import importlib.machinery, importlib.util, json, signal, sys",
          "loader = importlib.machinery.SourceFileLoader('scanner', sys.argv[1])",
          "spec = importlib.util.spec_from_loader('scanner', loader)",
          "scanner = importlib.util.module_from_spec(spec)",
          "loader.exec_module(scanner)",
          "scanner.state['commit'] = 'abc'",
          "scanner.state['output'] = sys.argv[2]",
          "signal.signal(signal.SIGTERM, scanner.on_term)",
          "real_dump = json.dump",
          "fired = []",
          "def dump(*args, **kwargs):",
          "    real_dump(*args, **kwargs)",
          "    if not fired:",
          "        fired.append(True)",
          "        signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)",
          "json.dump = dump",
          "try:",
          "    scanner.write_scan()",
          "except SystemExit as exit:",
          "    sys.exit(exit.code)",
          "sys.exit(0)",
          "",
        ].join("\n"),
      );

      const result = spawnSync("python3", [harness, command, output], {
        encoding: "utf8",
      });

      expect(result.status, result.stderr).toBe(143);

      const document = JSON.parse(readFileSync(output, "utf8"));

      expect(document.commit).toBe("abc");
      expect(readdirSync(folder)).toEqual(["scan.json"]);
    },
    TIMEOUT,
  );
});

describe("plugin template stop handlers (non-gating)", () => {
  it.todo(
    "a scanner and a sensor write their document on SIGTERM: a sample run ends in milliseconds, so no handle can keep it alive for a signal without a race",
  );
});
