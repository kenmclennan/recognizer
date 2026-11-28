import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";

const MANIFEST = {
  kind: "describer",
  name: "fake",
  display: "Fake",
  description: "A describer that answers from a script.",
  version: "1.0.0",
  protocol: 4,
  install: "none",
  check: true,
  long_running: false,
  time_limit_seconds: 120,
  units: ["files"],
  settings: [
    {
      key: "model",
      type: "string",
      scope: "machine",
      label: "Model",
      default: "fake-default",
      description: "the model every description uses",
      example: "describing.model fake-default",
      order: 1,
    },
  ],
  prices: {
    haiku: { input: 0.1, output: 0.5 },
    opus: { input: 4, output: 20 },
    sonnet: { input: 2, output: 10 },
  },
  prompt_version: process.env.FAKE_PROMPT_VERSION ?? "1",
};

if (process.argv[2] === "manifest") {
  process.stdout.write(`${JSON.stringify(MANIFEST)}\n`);
  process.exit(0);
}

const args = process.argv.slice(process.argv[2] === "run" ? 3 : 2);
const shimmed = process.env.FAKE_REPOSITORY !== undefined;
const repository = shimmed ? process.env.FAKE_REPOSITORY : args[0];
const request = args[args.length - 1];
const flags = shimmed
  ? JSON.parse(process.env.FAKE_FLAGS ?? "[]")
  : args.slice(1, -1);
const { module } = JSON.parse(readFileSync(request, "utf8"));

function flagged(name) {
  return flags.some(
    (flag, index) => flag === name && flags[index + 1] === module,
  );
}

const cache = join(repository, ".recognizer", "cache");

mkdirSync(cache, { recursive: true });
appendFileSync(join(cache, "describer-calls.log"), `${module}\n`);

const concurrency = join(cache, "describer-concurrency.log");
const sleep = flags.indexOf("--sleep");
const hold = flags.indexOf("--hold");
const key = module.split("/").join("_");

appendFileSync(concurrency, `start ${module} ${process.pid} ${Date.now()}\n`);

if (hold !== -1) {
  const directory = flags[hold + 1];

  const parent = process.ppid;
  const capFlag = flags.indexOf("--cap");
  const cap =
    capFlag === -1 ? scaledTimeout(60000) : Number(flags[capFlag + 1]);
  const started = Date.now();

  while (
    !existsSync(join(directory, `release-${key}`)) &&
    !existsSync(join(directory, "release-all"))
  ) {
    if (
      !existsSync(directory) ||
      process.ppid !== parent ||
      Date.now() - started > cap
    ) {
      process.exit(1);
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

if (sleep !== -1) {
  await new Promise((resolve) => setTimeout(resolve, Number(flags[sleep + 1])));
}

appendFileSync(concurrency, `end ${module} ${process.pid} ${Date.now()}\n`);

const copy = flags.indexOf("--copy");

if (copy !== -1) {
  copyFileSync(request, flags[copy + 1]);
}

if (flagged("--fail")) {
  process.stderr.write(`cannot describe ${module}\n`);
  process.exit(1);
}

if (flagged("--limit")) {
  process.stderr.write("claude usage limit: Claude usage limit reached\n");
  process.exit(75);
}

if (flagged("--empty")) {
  process.exit(0);
}

if (flagged("--two-lines")) {
  process.stdout.write(`first ${module}\nsecond\n`);
  process.exit(0);
}

process.stdout.write(`describes ${module}\n`);
