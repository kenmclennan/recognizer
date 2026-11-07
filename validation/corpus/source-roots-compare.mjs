import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readManifest } from "./manifest.mjs";
import { fetchPinned } from "./snapshot.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_BUFFER = 512 * 1024 * 1024;
const COLUMNS = [
  "repository",
  "run",
  "modules",
  "in-repo edges",
  "foreign self-edges",
  "hub",
  "orphan",
];

export function selfPackageNames(scan) {
  const names = new Set();

  for (const { id } of scan.modules) {
    const parts = id.split("/");
    const at = parts.lastIndexOf("src");
    const start = at === -1 ? 0 : at + 1;

    if (parts.length > start + 1) {
      names.add(parts[start]);
    } else if (parts.length === start + 1) {
      names.add(parts[start].replace(/\.py$/, ""));
    }
  }

  return names;
}

export function summarise(scan, check) {
  const names = selfPackageNames(scan);
  const warnings = check.warnings ?? [];
  const orphans = warnings
    .filter((warning) => warning.id === "orphan")
    .flatMap((warning) => warning.evidence?.modules ?? []);

  return {
    modules: scan.modules.length,
    inRepoEdges: scan.edges.filter((edge) => !edge.to.startsWith("foreign:"))
      .length,
    foreignSelfEdges: scan.edges.filter(
      (edge) =>
        edge.to.startsWith("foreign:") && names.has(edge.to.slice("foreign:".length)),
    ).length,
    hubs: warnings.filter((warning) => warning.id === "hub").length,
    orphans: orphans.length,
    orphanModules: orphans,
  };
}

export function formatRow(repository, run, summary) {
  return [
    repository,
    run,
    summary.modules,
    summary.inRepoEdges,
    summary.foreignSelfEdges,
    summary.hubs,
    summary.orphans,
  ].join(" | ");
}

export function formatTable(rows) {
  return [COLUMNS.join(" | "), ...rows].join("\n");
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });

  return {
    status: result.error ? 127 : (result.status ?? 1),
    stdout: result.stdout ?? "",
    stderr: result.error ? result.error.message : (result.stderr ?? ""),
  };
}

function measure(clone, folder, label, flags, tools) {
  const scanFile = join(folder, `scan.${label}.json`);
  const scanned = run(tools.scanner, [clone, ...flags, "--output", scanFile]);

  if (scanned.status !== 0) {
    throw new Error(`scan ${label} exited ${scanned.status}: ${scanned.stderr.trim()}`);
  }

  const checked = run(tools.recognizer, ["check", "--scan", scanFile]);

  if (checked.status > 1) {
    throw new Error(`check ${label} exited ${checked.status}: ${checked.stderr.trim()}`);
  }

  return summarise(JSON.parse(readFileSync(scanFile, "utf8")), JSON.parse(checked.stdout));
}

export function compareCorpus({
  manifestPath = join(HERE, "manifest.json"),
  only = null,
  tools = {},
  log = () => {},
} = {}) {
  const settled = {
    scanner: tools.scanner ?? "recognizer-scan-python",
    recognizer: tools.recognizer ?? "recognizer",
  };
  const entries = readManifest(manifestPath).filter(
    (entry) =>
      entry.languages.includes("python") && (only === null || only.includes(entry.name)),
  );

  if (entries.length === 0) {
    throw new Error("no Python manifest entry matches");
  }

  const work = mkdtempSync(join(tmpdir(), "source-roots-compare-"));
  const rows = [];
  const summaries = {};

  try {
    for (const entry of entries) {
      const clone = join(work, "repos", entry.name);
      const folder = join(work, "scans", entry.name);

      log(`${entry.name}: fetching ${entry.commit.slice(0, 12)}`);
      fetchPinned(entry, clone);
      mkdirSync(folder, { recursive: true });

      const before = measure(clone, folder, "before", ["--source-root", "."], settled);
      const after = measure(clone, folder, "after", [], settled);

      summaries[entry.name] = { before, after };
      rows.push(formatRow(entry.name, "before", before), formatRow(entry.name, "after", after));
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  return { table: formatTable(rows), summaries };
}

function parseArguments(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--only") {
      const value = argv[(index += 1)];

      if (value === undefined) {
        throw new Error("--only needs a value");
      }

      options.only = value.split(",");
    } else {
      throw new Error(`unknown argument ${argv[index]}`);
    }
  }

  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { table } = compareCorpus({
      ...parseArguments(process.argv.slice(2)),
      log: (line) => console.error(line),
    });

    console.log(table);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
