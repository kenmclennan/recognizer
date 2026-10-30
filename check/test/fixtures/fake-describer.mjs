import { appendFileSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
