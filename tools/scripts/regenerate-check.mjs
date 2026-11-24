import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function changedPaths(repository) {
  return execFileSync("git", ["status", "--porcelain"], {
    cwd: repository,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));
}

export function check(repository) {
  const paths = changedPaths(repository);

  if (paths.length === 0) {
    return { code: 0, output: "every committed scan and baseline is current" };
  }

  return {
    code: 1,
    output: `npm run regenerate changed these files, commit them:\n${paths.join("\n")}`,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { code, output } = check(resolve(process.argv[2] ?? "."));

  (code === 0 ? process.stdout : process.stderr).write(`${output}\n`);
  process.exitCode = code;
}
