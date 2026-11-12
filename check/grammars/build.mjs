import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const provenancePath = join(here, "PROVENANCE.json");
const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
const work = mkdtempSync(join(tmpdir(), "recognizer-grammars-"));
const checkouts = new Map();

function checkout(source, revision) {
  const key = `${source}@${revision}`;

  if (!checkouts.has(key)) {
    const directory = join(work, String(checkouts.size));

    execFileSync("git", ["clone", "--quiet", source, directory], {
      stdio: "inherit",
    });
    execFileSync("git", ["-C", directory, "checkout", "--quiet", revision], {
      stdio: "inherit",
    });
    checkouts.set(key, directory);
  }

  return checkouts.get(key);
}

for (const [name, entry] of Object.entries(provenance.grammars)) {
  const root = checkout(entry.source, entry.revision);
  const directory =
    entry.directory === undefined ? root : join(root, entry.directory);
  const output = join(work, entry.file);

  execFileSync(
    "npx",
    [
      "--yes",
      `tree-sitter-cli@${provenance.tree_sitter_cli}`,
      "build",
      "--wasm",
      "-o",
      output,
      directory,
    ],
    { stdio: "inherit", cwd: directory },
  );

  copyFileSync(output, join(here, entry.file));
  entry.sha256 = createHash("sha256")
    .update(readFileSync(join(here, entry.file)))
    .digest("hex");
  process.stdout.write(`${name} ${entry.sha256}\n`);
}

writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
