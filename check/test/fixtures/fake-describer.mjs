import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { scaledTimeout } from "../../../scripts/pool-scale.mjs";

const args = process.argv.slice(2);
const repository = args[0];
const request = args[args.length - 1];
const flags = args.slice(1, -1);
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

if (flagged("--empty")) {
  process.exit(0);
}

if (flagged("--two-lines")) {
  process.stdout.write(`first ${module}\nsecond\n`);
  process.exit(0);
}

process.stdout.write(`describes ${module}\n`);
