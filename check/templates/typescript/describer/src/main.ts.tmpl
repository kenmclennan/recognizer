// {{program}}: a Recognizer describer written in TypeScript. It runs on Node
// 22.6 or later with type stripping, so it needs no build step and no dependency.
// Run `recognizer help plugin-guide` for the contract this program follows.
import { readFileSync, writeSync } from "node:fs";

const PROGRAM = "{{program}}";
const VERSION = "0.1.0";

// EDIT HERE: change prompt_version whenever the way you describe modules changes.
const MANIFEST = {
  kind: "describer",
  name: "{{name}}",
  display: "{{name}}",
  version: VERSION,
  protocol: {{protocol}},
  install: "put {{program}} on PATH (EDIT HERE: say how your users install it)",
  check: true,
  long_running: false,
  time_limit_seconds: 120,
  units: ["modules"],
  settings: [],
  prompt_version: "1",
};

const STOP_EXIT = 143;

function event(payload: object): void {
  writeSync(2, `recognizer-event ${JSON.stringify(payload)}\n`);
}

function usage(): number {
  writeSync(2, `usage: ${PROGRAM} manifest | check | guide | run --model <name> <request-file>\n`);

  return 2;
}

function run(args: string[]): number {
  let model: string | null = null;
  let request: string | null = null;

  for (let index = 0; index < args.length; ) {
    const argument = args[index] as string;
    const value = args[index + 1];

    if (argument === "--model" && value !== undefined) {
      model = value;
      index += 2;
    } else if (request === null && !argument.startsWith("--")) {
      request = argument;
      index += 1;
    } else {
      return usage();
    }
  }

  if (model === null || request === null) {
    return usage();
  }

  process.on("SIGTERM", () => process.exit(STOP_EXIT));

  const parsed = JSON.parse(readFileSync(request, "utf8")) as { module: string };

  event({ event: "start", total: 1, unit: "modules" });

  // EDIT HERE: describe the module in one line, for example by asking a model.
  const line = `${parsed.module}: replace this line with what the module is responsible for`;

  writeSync(1, `${line.replace(/\n/g, " ")}\n`);
  event({ event: "progress", done: 1, total: 1, unit: "modules" });

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
      `${PROGRAM} describes a module with a fixed line.\nIt needs Node 22.6 or later.\nEdit the EDIT HERE lines in src/main.ts to describe modules properly.\n`,
    );

    return 0;
  }

  if (verb === "run") {
    return run(rest);
  }

  return usage();
}

process.exitCode = main(process.argv.slice(2));
