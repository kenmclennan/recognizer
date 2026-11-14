import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function filesUnder(root, folder = root) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);

    return entry.isDirectory() ? filesUnder(root, path) : [path];
  });
}

export function bundleTemplates(root) {
  const entries = filesUnder(root)
    .map((path) => [relative(root, path).split(sep).join("/"), path])
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  return Object.fromEntries(
    entries.map(([key, path]) => [key, readFileSync(path, "utf8")]),
  );
}

export function writeBundle(root, target) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(bundleTemplates(root), null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [root, target] = process.argv.slice(2);

  writeBundle(
    root ?? join(here, "..", "templates"),
    target ?? join(here, "..", "src", "generated", "templates.json"),
  );
}
