import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readManifest } from "./manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, "../..");
const MAX_BUFFER = 512 * 1024 * 1024;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    ...options,
  });

  if (result.error) {
    return { status: 127, stdout: "", stderr: result.error.message };
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function failure(label, result) {
  const detail = (result.stderr || result.stdout || "").trim();

  return `${label} exited ${result.status}${detail ? `: ${detail}` : ""}`;
}

function insideRepository(path) {
  const real = existsSync(path) ? realpathSync(path) : resolve(path);
  const from = relative(realpathSync(REPOSITORY_ROOT), real);

  return from === "" || (!from.startsWith("..") && !from.startsWith("/"));
}

function headOf(directory) {
  const result = run("git", ["rev-parse", "HEAD"], { cwd: directory });

  return result.status === 0 ? result.stdout.trim() : null;
}

export function fetchPinned(entry, directory) {
  if (existsSync(join(directory, ".git")) && headOf(directory) === entry.commit) {
    return { created: false };
  }

  const created = !existsSync(join(directory, ".git"));

  mkdirSync(directory, { recursive: true });

  if (created) {
    const init = run("git", ["init", "--quiet"], { cwd: directory });

    if (init.status !== 0) {
      throw new Error(failure("git init", init));
    }
  }

  const fetched = run(
    "git",
    ["fetch", "--quiet", "--depth", "1", entry.upstream, entry.commit],
    { cwd: directory },
  );

  if (fetched.status !== 0) {
    throw new Error(failure("git fetch", fetched));
  }

  const checkout = run(
    "git",
    ["-c", "core.hooksPath=/dev/null", "checkout", "--quiet", "--force", "FETCH_HEAD"],
    { cwd: directory },
  );

  if (checkout.status !== 0) {
    throw new Error(failure("git checkout", checkout));
  }

  if (headOf(directory) !== entry.commit) {
    throw new Error(`fetched ${headOf(directory)}, expected ${entry.commit}`);
  }

  return { created };
}

function snapshotRepository(entry, clone, folder, tools) {
  const errors = [];

  mkdirSync(folder, { recursive: true });

  const scan = run(tools.recognizer, ["scan", clone]);

  if (scan.status !== 0) {
    errors.push(failure("recognizer scan", scan));
  }

  for (const language of entry.languages) {
    const scanned = join(clone, ".recognizer/cache", `scan.${language}.json`);

    if (!existsSync(scanned)) {
      errors.push(`no ${language} scan was written`);

      continue;
    }

    const kept = join(folder, `scan.${language}.json`);

    copyFileSync(scanned, kept);

    const check = run(tools.recognizer, ["check", "--scan", kept]);

    writeFileSync(join(folder, `check.${language}.json`), check.stdout);
    writeFileSync(join(folder, `check.${language}.err`), check.stderr);

    if (check.status > 1) {
      errors.push(failure(`recognizer check (${language})`, check));
    }
  }

  const structure = join(clone, ".recognizer/cache/findings/structure.json");

  if (existsSync(structure)) {
    copyFileSync(structure, join(folder, "structure.json"));
  }

  if (errors.length > 0) {
    writeFileSync(join(folder, "error.txt"), `${errors.join("\n")}\n`);
  }

  return errors;
}

export function runCorpus({
  manifestPath = join(HERE, "manifest.json"),
  out = join(homedir(), "recognizer-corpus"),
  date = new Date().toISOString().slice(0, 10),
  keepClones = false,
  only = null,
  tools = {},
  log = () => {},
} = {}) {
  const settled = {
    recognizer: tools.recognizer ?? "recognizer",
  };

  const target = resolve(out);

  if (insideRepository(target)) {
    throw new Error("the output folder must be outside the Recognizer repository");
  }

  const entries = readManifest(manifestPath).filter(
    (entry) => only === null || only.includes(entry.name),
  );

  if (entries.length === 0) {
    throw new Error("no manifest entry matches");
  }

  const version = run(settled.recognizer, ["--version"]);

  if (version.status !== 0) {
    throw new Error(failure("recognizer --version", version));
  }

  const snapshot = join(target, date);

  mkdirSync(snapshot, { recursive: true });

  writeFileSync(join(snapshot, "recognizer-version.txt"), version.stdout);

  const failures = {};

  for (const entry of entries) {
    const clone = join(target, "repos", entry.name);
    const folder = join(snapshot, entry.name);
    let created = false;

    log(`${entry.name}: fetching ${entry.commit.slice(0, 12)}`);

    try {
      ({ created } = fetchPinned(entry, clone));

      const errors = snapshotRepository(entry, clone, folder, settled);

      if (errors.length > 0) {
        failures[entry.name] = errors;
      }
    } catch (error) {
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "error.txt"), `${error.message}\n`);
      failures[entry.name] = [error.message];
    }

    if (created && !keepClones) {
      rmSync(clone, { recursive: true, force: true });
    }

    log(`${entry.name}: ${failures[entry.name] ? "recorded errors" : "done"}`);
  }

  writeFileSync(
    join(snapshot, "commits.txt"),
    `${entries.map((entry) => `${entry.name} ${entry.commit}`).join("\n")}\n`,
  );

  return { snapshot, failures };
}

function parseArguments(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--keep-clones") {
      options.keepClones = true;
    } else if (argument === "--out" || argument === "--only" || argument === "--date") {
      const value = argv[(index += 1)];

      if (value === undefined) {
        throw new Error(`${argument} needs a value`);
      }

      if (argument === "--out") options.out = value;
      if (argument === "--only") options.only = value.split(",");
      if (argument === "--date") options.date = value;
    } else {
      throw new Error(`unknown argument ${argument}`);
    }
  }

  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { snapshot, failures } = runCorpus({
      ...parseArguments(process.argv.slice(2)),
      log: (line) => console.error(line),
    });
    const failed = Object.keys(failures);

    console.log(snapshot);

    if (failed.length > 0) {
      console.error(`errors recorded for: ${failed.join(", ")}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
