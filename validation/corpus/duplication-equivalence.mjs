import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readManifest } from "./manifest.mjs";
import { fetchPinned } from "./snapshot.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_BUFFER = 512 * 1024 * 1024;
const LIMIT_SECONDS = 3.0;

export const LIGHTCYCLE = {
  name: "lightcycle-c1933e0",
  upstream: "https://github.com/kenmclennan/lightcycle",
  commit: "c1933e0ed5c9c7bd1329ec232078d708b8e6607a",
  languages: ["python"],
  why: "The lightcycle checkout the Python duplication sensor is compared on",
  expectedPython: 45,
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    ...options,
  });

  return {
    status: result.error ? 127 : (result.status ?? 1),
    stdout: result.stdout ?? "",
    stderr: result.error ? result.error.message : (result.stderr ?? ""),
  };
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)];
}

export function skippedFiles(stderr) {
  return stderr
    .split("\n")
    .map((line) => /^duplication: skipped (.+): not valid UTF-8$/.exec(line))
    .filter((match) => match !== null)
    .map((match) => match[1]);
}

function filesOf(finding) {
  return finding.evidence.members.map((member) => member.file);
}

export function compareFindings(python, typescript, skipped = []) {
  const byId = (list) => new Map(list.map((finding) => [finding.id, finding]));
  const left = byId(python);
  const right = byId(typescript);
  const touchesSkipped = (finding) =>
    filesOf(finding).some((file) => skipped.includes(file));
  const differences = [];

  for (const [id, finding] of left) {
    const other = right.get(id);

    if (other === undefined) {
      differences.push({
        id,
        cause: touchesSkipped(finding) ? "invalid-utf8" : "missing-in-typescript",
      });
    } else if (JSON.stringify(finding) !== JSON.stringify(other)) {
      differences.push({ id, cause: "different-record" });
    }
  }

  for (const [id, finding] of right) {
    if (!left.has(id)) {
      differences.push({
        id,
        cause: touchesSkipped(finding) ? "invalid-utf8" : "extra-in-typescript",
      });
    }
  }

  return differences;
}

export function tableRow(row) {
  const causes = {};

  for (const difference of row.differences) {
    causes[difference.cause] = (causes[difference.cause] ?? 0) + 1;
  }

  const added = row.added === null ? "n/a" : `${row.added.toFixed(2)} s`;
  const warm =
    row.warm === null || row.warm === undefined
      ? "n/a"
      : `${row.warm.toFixed(2)} s`;
  const over = row.added !== null && row.added > LIMIT_SECONDS ? " OVER" : "";
  const detail = Object.entries(causes)
    .map(([cause, count]) => `${cause} ${count}`)
    .join(", ");

  return `${row.name} | python ${row.python} | typescript ${row.typescript} | differences ${row.differences.length}${detail ? ` (${detail})` : ""} | added ${added}${over} | warm ${warm} | load ${row.load.toFixed(1)}`;
}

function duplicationOf(document) {
  return document.findings.filter((finding) => finding.kind === "duplication");
}

export function unitCacheFile(clone) {
  return join(clone, ".recognizer/cache/duplication-units.json");
}

export function timed(tools, clone, runs, { cold = false } = {}) {
  const seconds = [];

  for (let at = 0; at < runs; at += 1) {
    if (cold) {
      rmSync(unitCacheFile(clone), { force: true });
    }

    const started = process.hrtime.bigint();
    const scan = run(tools.recognizer, ["scan", clone]);

    if (scan.status !== 0) {
      throw new Error(`recognizer scan exited ${scan.status}: ${scan.stderr}`);
    }

    seconds.push(Number(process.hrtime.bigint() - started) / 1e9);
  }

  return { median: median(seconds), stderr: "" };
}

function withConfig(clone, text, body) {
  const file = join(clone, ".recognizer/config.yaml");
  const kept = existsSync(file) ? readFileSync(file, "utf8") : null;

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);

  try {
    return body();
  } finally {
    if (kept === null) {
      rmSync(file, { force: true });
    } else {
      writeFileSync(file, kept);
    }
  }
}

export function measureRepository(entry, clone, tools, runs = 3) {
  const off = withConfig(
    clone,
    "sensors:\n  structure:\n    duplication: false\n",
    () => timed(tools, clone, runs),
  );
  const scan = run(tools.recognizer, ["scan", clone]);

  if (scan.status !== 0) {
    throw new Error(`recognizer scan exited ${scan.status}: ${scan.stderr}`);
  }

  const load = loadavg()[0];
  const on = timed(tools, clone, runs, { cold: true });
  const warm = timed(tools, clone, runs);
  const structure = JSON.parse(
    readFileSync(join(clone, ".recognizer/cache/findings/structure.json"), "utf8"),
  );
  const output = join(clone, ".recognizer/cache/python-duplication.json");
  const python = run(tools.sensors, [
    "duplication",
    "--repository",
    clone,
    "--output",
    output,
  ]);

  if (python.status !== 0) {
    throw new Error(`recognizer-sensors duplication exited ${python.status}: ${python.stderr}`);
  }

  const pythonFindings = duplicationOf(JSON.parse(readFileSync(output, "utf8")));
  const typescriptFindings = duplicationOf(structure);
  const differences = compareFindings(
    pythonFindings,
    typescriptFindings,
    skippedFiles(scan.stderr),
  );

  return {
    name: entry.name,
    python: pythonFindings.length,
    typescript: typescriptFindings.length,
    differences,
    added: on.median - off.median,
    warm: warm.median - off.median,
    load,
    expectedPython: entry.expectedPython ?? null,
  };
}

export function runEquivalence({
  manifestPath = join(HERE, "manifest.json"),
  out = join(homedir(), "recognizer-corpus"),
  only = null,
  tools = {},
  runs = 3,
  log = () => {},
} = {}) {
  const settled = {
    recognizer: tools.recognizer ?? "recognizer",
    sensors: tools.sensors ?? "recognizer-sensors",
  };
  const entries = [...readManifest(manifestPath), LIGHTCYCLE].filter(
    (entry) => only === null || only.includes(entry.name),
  );
  const rows = [];

  for (const entry of entries) {
    const clone = join(resolve(out), "repos", entry.name);

    log(`${entry.name}: fetching ${entry.commit.slice(0, 12)}`);

    try {
      fetchPinned(entry, clone);
      rows.push(measureRepository(entry, clone, settled, runs));
    } catch (error) {
      rows.push({
        name: entry.name,
        python: 0,
        typescript: 0,
        differences: [{ id: error.message, cause: "failed" }],
        added: null,
        warm: null,
        load: loadavg()[0],
        expectedPython: null,
      });
    }

    log(tableRow(rows.at(-1)));
  }

  return rows;
}

function parseArguments(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[(index += 1)];

    if (value === undefined) {
      throw new Error(`${argument} needs a value`);
    }

    if (argument === "--out") options.out = value;
    else if (argument === "--only") options.only = value.split(",");
    else if (argument === "--runs") options.runs = Number(value);
    else throw new Error(`unknown argument ${argument}`);
  }

  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const rows = runEquivalence({
      ...parseArguments(process.argv.slice(2)),
      log: (line) => console.error(line),
    });

    for (const row of rows) {
      console.log(tableRow(row));
    }

    const bad = rows.filter(
      (row) =>
        row.differences.some((difference) => difference.cause !== "invalid-utf8") ||
        (row.expectedPython !== null && row.python !== row.expectedPython),
    );

    process.exit(bad.length === 0 ? 0 : 1);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
