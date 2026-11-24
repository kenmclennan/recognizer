import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASELINES,
  REVIEW_BY_HAND,
  SCAN_TARGETS,
} from "./regenerate-targets.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY = resolve(HERE, "../..");

export function scannerCommand(repository, scanner) {
  const name = `recognizer-scan-${scanner}`;
  const directory = join(repository, "packages/scanners", scanner);

  if (scanner === "rust") {
    return [
      "cargo",
      [
        "run",
        "--locked",
        "--quiet",
        "--manifest-path",
        join(directory, "Cargo.toml"),
        "--",
      ],
    ];
  }

  if (scanner === "typescript") {
    return ["node", [join(directory, "dist/bin.js")]];
  }

  return ["uv", ["run", "--locked", "--project", directory, name]];
}

export function scan(repository, scanner, root, output, options = {}) {
  const [command, base] = scannerCommand(repository, scanner);
  const args = [...base, "run", root, "--output", output];

  args.push(...(options.args ?? []));

  if (options.modified !== undefined) {
    args.push("--modified", String(options.modified));
  }

  const result = spawnSync(command, args, {
    cwd: repository,
    encoding: "utf8",
    env: options.outsideGit
      ? { ...process.env, GIT_DIR: join(tmpdir(), "recognizer-no-git") }
      : process.env,
  });

  if (result.status !== 0) {
    throw new Error(
      `recognizer-scan-${scanner} failed on ${root} (exit ${result.status}): ${result.stderr}`,
    );
  }

  return result.stderr;
}

function damagedCount(stderr) {
  return Number(/(\d+) of \d+ files had damaged spans/.exec(stderr)?.[1] ?? 0);
}

function measure(baseline, document, stderr) {
  const tauri = "packages/app/src-tauri/";
  const inTauri = (value) => value.startsWith(tauri);
  const edges =
    baseline.scanner === "rust"
      ? document.edges.filter((edge) => inTauri(edge.from))
      : document.edges;
  const kind = (wanted) => edges.filter((edge) => edge.kind === wanted).length;

  return {
    files:
      baseline.scanner === "rust"
        ? document.files.filter((file) => inTauri(file.path)).length
        : undefined,
    modules:
      baseline.scanner === "rust"
        ? document.modules.filter((module) => inTauri(module.id)).length
        : undefined,
    edges: edges.length,
    implements: kind("implements"),
    declares: kind("declares"),
    calls: document.calls?.length,
    damaged: damagedCount(stderr),
  };
}

function rewriteBaseline(repository, baseline, document, stderr) {
  const path = join(repository, baseline.file);
  const measured = measure(baseline, document, stderr);
  let text = readFileSync(path, "utf8");

  for (const field of baseline.fields) {
    text = text.replace(
      new RegExp(`("${field}": )\\d+`),
      `$1${measured[field]}`,
    );
  }

  writeFileSync(path, text);
}

export function regenerate(repository, env, log) {
  let missing = false;

  const typescript = SCAN_TARGETS.some((t) => t.scanner === "typescript");

  if (typescript) {
    const built = spawnSync(
      "npm",
      ["run", "build", "-w", "recognizer-scan-typescript"],
      { cwd: repository, encoding: "utf8" },
    );

    if (built.status !== 0) {
      throw new Error(
        `building the TypeScript scanner failed: ${built.stderr}`,
      );
    }
  }

  for (const target of SCAN_TARGETS) {
    scan(
      repository,
      target.scanner,
      join(repository, target.root),
      join(repository, target.output),
      { modified: target.modified, args: target.args, outsideGit: true },
    );
    log(`rewrote ${target.output}`);
  }

  const scratch = mkdtempSync(join(tmpdir(), "recognizer-regenerate-"));

  try {
    for (const baseline of BASELINES) {
      const root =
        baseline.root === "repository" ? repository : env[baseline.variable];

      if (!root) {
        log(`skipped ${baseline.file}: ${baseline.variable} is unset`);
        missing = true;

        continue;
      }

      const output = join(scratch, `${baseline.scanner}.json`);
      const stderr = scan(repository, baseline.scanner, root, output);

      rewriteBaseline(
        repository,
        baseline,
        JSON.parse(readFileSync(output, "utf8")),
        stderr,
      );
      log(`rewrote ${baseline.file}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  log("review by hand, these counts sit in test source:");

  for (const line of REVIEW_BY_HAND) {
    log(`  ${line}`);
  }

  return missing && env.RECOGNIZER_REQUIRE_REAL_CONTENT === "1" ? 1 : 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = regenerate(REPOSITORY, process.env, (line) =>
    process.stderr.write(`${line}\n`),
  );
}
