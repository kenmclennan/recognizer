// {{program}}: a Recognizer sensor written in TypeScript. It runs on Node 22.6
// or later with type stripping, so it needs no build step and no dependency.
// Run `recognizer help plugin-guide` for the contract this program follows.
import { renameSync, writeFileSync, writeSync } from "node:fs";
import { spawnSync } from "node:child_process";

const PROGRAM = "{{program}}";
const VERSION = "0.1.0";

// EDIT HERE: declare each metric and finding kind this sensor produces.
const MANIFEST = {
  kind: "sensor",
  name: "{{name}}",
  display: "{{name}}",
  version: VERSION,
  protocol: {{protocol}},
  install: "put {{program}} on PATH (EDIT HERE: say how your users install it)",
  check: true,
  long_running: true,
  units: ["modules"],
  settings: [],
  metrics: [],
  findings: [],
  runs_tests: false,
  scoped: false,
};

const STOP_EXIT = 143;

const state = {
  commit: "",
  modified: false,
  output: null as string | null,
  measured: 0,
  total: 1,
};

function event(payload: object): void {
  writeSync(2, `recognizer-event ${JSON.stringify(payload)}\n`);
}

function writeFindings(stopped: boolean): void {
  const document = {
    findings_version: {{findings_version}},
    sensor: { name: "{{name}}", version: VERSION },
    commit: state.commit,
    modified: state.modified,
    inputs: {},
    settings: {},
    findings: [],
    ...(stopped ? { stopped: { measured: state.measured, total: state.total } } : {}),
  };
  const output = state.output as string;
  const temporary = `${output}.${process.pid}.tmp`;

  writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`);
  renameSync(temporary, output);
}

function usage(): number {
  writeSync(
    2,
    `usage: ${PROGRAM} manifest | check [--repository <dir>] | guide | run --repository <dir> --commit <sha> --output <file> [--settings <json>]\n`,
  );

  return 2;
}

function run(args: string[]): number {
  let repository: string | null = null;
  let commit: string | null = null;
  let output: string | null = null;

  for (let index = 0; index < args.length; index += 2) {
    const argument = args[index];
    const value = args[index + 1];

    if (value === undefined) {
      return usage();
    }

    if (argument === "--repository") {
      repository = value;
    } else if (argument === "--commit") {
      commit = value;
    } else if (argument === "--output") {
      output = value;
    } else if (argument !== "--settings") {
      return usage();
    }
  }

  if (repository === null || commit === null || output === null) {
    return usage();
  }

  const status = spawnSync("git", ["-C", repository, "status", "--porcelain"], { encoding: "utf8" });

  state.commit = commit;
  state.modified = status.stdout.trim() !== "";
  state.output = output;

  process.on("SIGTERM", () => {
    writeFindings(true);
    process.exit(STOP_EXIT);
  });

  event({ event: "start", total: state.total, unit: "modules" });

  // EDIT HERE: measure the repository and add to the findings list.
  state.measured = 1;

  event({ event: "progress", done: 1, total: state.total, unit: "modules" });
  writeFindings(false);

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
      `${PROGRAM} measures nothing yet and writes no findings.\nIt needs git on PATH and Node 22.6 or later.\nEdit the EDIT HERE lines in src/main.ts to measure something.\n`,
    );

    return 0;
  }

  if (verb === "run") {
    return run(rest);
  }

  return usage();
}

process.exitCode = main(process.argv.slice(2));
