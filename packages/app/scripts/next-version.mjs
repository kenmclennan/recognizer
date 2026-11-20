import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function parts(version) {
  return version.split(".").map(Number);
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }

  return 0;
}

function escapeRegExp(prefix) {
  return prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function nextVersion(committed, tags, prefix = "v") {
  const tag = new RegExp(`^${escapeRegExp(prefix)}(\\d+)\\.(\\d+)\\.(\\d+)$`);
  const found = tags
    .map((name) => tag.exec(name))
    .filter((match) => match !== null);

  if (found.length === 0) {
    return committed;
  }

  const last = found
    .map((match) => match.slice(1).map(Number))
    .reduce((a, b) => (compare(a, b) >= 0 ? a : b));
  const current = parts(committed);

  if (compare(current, last) > 0) {
    return committed;
  }

  return `${last[0]}.${last[1]}.${last[2] + 1}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tags = readFileSync(0, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  process.stdout.write(
    `${nextVersion(process.argv[2], tags, process.argv[3] ?? "v")}\n`,
  );
}
