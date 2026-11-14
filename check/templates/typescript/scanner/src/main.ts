// {{program}}: a Recognizer scanner written in TypeScript. It runs on Node 22.6
// or later with type stripping, so it needs no build step and no dependency.
// Run `recognizer help plugin-guide` for the contract this program follows.
import { createHash } from "node:crypto";
import { readFileSync, renameSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const PROGRAM = "{{program}}";
const VERSION = "0.1.0";

// EDIT HERE: the extension of the files this scanner reads. A real scanner
// also parses each file and fills in members and edges.
const EXTENSION = ".{{name}}";

const MANIFEST = {
  kind: "scanner",
  name: "{{name}}",
  display: "{{name}}",
  version: VERSION,
  protocol: {{protocol}},
  install: "put {{program}} on PATH (EDIT HERE: say how your users install it)",
  check: true,
  long_running: true,
  units: ["files"],
  settings: [],
  languages: [
    {
      name: "{{name}}",
      extensions: [EXTENSION],
      files: [],
      skip: {
        directory_names: [],
        directory_prefixes: ["."],
        directory_suffixes: [],
        directory_markers: [],
        file_globs: [],
      },
    },
  ],
};

const SELECTION = {
  extensions: [EXTENSION],
  skip_directory_names: [],
  skip_directory_prefixes: [],
  skip_directory_suffixes: [],
  skip_directories_containing: [],
  skip_file_globs: [],
};

const STOP_EXIT = 143;

const state = {
  files: [] as { path: string; hash: string }[],
  modules: [] as object[],
  commit: null as string | null,
  modified: null as boolean | null,
  output: null as string | null,
};

function event(payload: object): void {
  writeSync(2, `recognizer-event ${JSON.stringify(payload)}\n`);
}

function git(repository: string, args: string[]) {
  return spawnSync("git", ["-C", repository, ...args], { encoding: "buffer" });
}

function listedFiles(repository: string): string[] {
  const done = git(repository, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);

  if (done.status !== 0) {
    return [];
  }

  const names = done.stdout.toString("utf8").split("\0");

  return [...new Set(names.filter((name) => name.endsWith(EXTENSION)))].sort();
}

function writeScan(): void {
  const document = {
    schema_version: {{scan_schema_version}},
    scanner: { name: PROGRAM, version: VERSION },
    commit: state.commit,
    modified: state.modified,
    files: state.files,
    selection: SELECTION,
    modules: state.modules,
    edges: [],
    foreign: [],
  };
  const output = state.output as string;
  const temporary = `${output}.${process.pid}.tmp`;

  writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`);
  renameSync(temporary, output);
}

function usage(): number {
  writeSync(
    2,
    `usage: ${PROGRAM} manifest | check | guide | run <repository> --output <file> [--commit <sha>]\n`,
  );

  return 2;
}

function run(args: string[]): number {
  let repository: string | null = null;
  let commit: string | null = null;
  let output: string | null = null;

  for (let index = 0; index < args.length; ) {
    const argument = args[index] as string;
    const value = args[index + 1];

    if (argument === "--output" && value !== undefined) {
      output = value;
      index += 2;
    } else if (argument === "--commit" && value !== undefined) {
      commit = value;
      index += 2;
    } else if (repository === null && !argument.startsWith("--")) {
      repository = argument;
      index += 1;
    } else {
      return usage();
    }
  }

  if (repository === null || output === null) {
    return usage();
  }

  state.commit = commit;

  if (commit !== null) {
    state.modified = git(repository, ["status", "--porcelain"]).stdout.toString("utf8").trim() !== "";
  }

  state.output = output;

  process.on("SIGTERM", () => {
    writeScan();
    process.exit(STOP_EXIT);
  });

  const names = listedFiles(repository);

  event({ event: "start", total: names.length, unit: "files" });

  names.forEach((name, position) => {
    const path = join(repository as string, name);

    if (statSync(path, { throwIfNoEntry: false })?.isFile()) {
      const hash = createHash("sha256").update(readFileSync(path)).digest("hex");

      // EDIT HERE: parse the file and fill in members; add edges between modules.
      state.files.push({ path: name, hash });
      state.modules.push({ id: name, language: "{{name}}", kind: "module", members: [] });
    }

    event({ event: "progress", done: position + 1, total: names.length, unit: "files" });
  });

  writeScan();

  return 0;
}

function main(args: string[]): number {
  const [verb, ...rest] = args;

  if (verb === "manifest") {
    writeSync(1, `${JSON.stringify(MANIFEST, null, 2)}\n`);

    return 0;
  }

  if (verb === "check") {
    writeSync(1, '{"gaps":[],"notes":[]}\n');

    return 0;
  }

  if (verb === "guide") {
    writeSync(
      1,
      `${PROGRAM} reads files ending in ${EXTENSION}.\nIt needs git on PATH and Node 22.6 or later.\nEdit the EDIT HERE lines in src/main.ts to make it read your language.\n`,
    );

    return 0;
  }

  if (verb === "run") {
    return run(rest);
  }

  return usage();
}

process.exitCode = main(process.argv.slice(2));
