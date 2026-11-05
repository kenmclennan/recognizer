import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_PATH = "schema/scan.schema.json";

export function schemaVersion(text) {
  const version = JSON.parse(text)?.properties?.schema_version?.const;

  if (!Number.isInteger(version)) {
    throw new Error("no integer schema_version const in the scan schema");
  }

  return version;
}

export function behindMessage(main, branch) {
  if (branch >= main) {
    return null;
  }

  return `main is on scan schema ${main}, this branch is on ${branch}: rebase onto main`;
}

function versionAt(ref) {
  return schemaVersion(
    execFileSync("git", ["show", `${ref}:${SCHEMA_PATH}`], {
      encoding: "utf8",
    }),
  );
}

export function run(argv, versionOf = versionAt) {
  const numeric = argv[0] === "--versions";
  const [mainArg, branchArg] = numeric ? argv.slice(1) : argv;

  if (!mainArg || !branchArg) {
    return {
      code: 2,
      output:
        "usage: schema-behind.mjs <main-ref> <branch-ref> | --versions <main> <branch>",
    };
  }

  const main = numeric ? Number(mainArg) : versionOf(mainArg);
  const branch = numeric ? Number(branchArg) : versionOf(branchArg);
  const message = behindMessage(main, branch);

  return message ? { code: 1, output: message } : { code: 0, output: "" };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { code, output } = run(process.argv.slice(2));

  if (output) {
    (code === 0 ? console.log : console.error)(output);
  }

  process.exit(code);
}
