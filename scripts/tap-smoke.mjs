import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allFormulae, loadUnits } from "./units.mjs";

export const INSTALL_COMMANDS = [
  "brew tap kenmclennan/tap",
  "brew trust kenmclennan/tap",
  "brew install --cask kenmclennan/tap/recognizer",
];

export const UNINSTALL_COMMANDS = [
  "recognizer agents uninstall",
  "brew uninstall --cask kenmclennan/tap/recognizer",
  "brew uninstall recognizer-plugins recognizer-scan-python recognizer-scan-typescript recognizer-scan-kotlin recognizer-scan-csharp recognizer-scan-rust recognizer-sense-crap recognizer-sense-mutation recognizer-sense-thresholds recognizer-describe-claude",
  "brew autoremove",
];

export function fencedBlock(markdown, heading) {
  const start = markdown.indexOf(`\n## ${heading}\n`);

  if (start === -1) {
    throw new Error(`README has no ${heading} section`);
  }

  const rest = markdown.slice(start + 1);
  const next = rest.indexOf("\n## ", 1);
  const section = next === -1 ? rest : rest.slice(0, next);
  const block = /```sh\n([\s\S]*?)```/.exec(section);

  if (block === null) {
    throw new Error(`README ${heading} section has no sh block`);
  }

  return block[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export function missingPluginCommands(json, commands) {
  const listed = new Set(JSON.parse(json).map((one) => basename(one.command)));

  return commands.filter((command) => !listed.has(command));
}

function sh(command, options = {}) {
  const result = spawnSync("sh", ["-c", command], {
    encoding: "utf8",
    ...options,
  });

  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");

  return result;
}

function must(command, options) {
  const result = sh(command, options);

  if (result.status !== 0) {
    throw new Error(`${command} exited ${result.status}`);
  }

  return result.stdout.trim();
}

function fail(message) {
  throw new Error(message);
}

export function smoke(root) {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const formulae = allFormulae(loadUnits(root));
  const commands = formulae.map((one) => one.command);

  for (const command of fencedBlock(readme, "Install")) {
    must(command);
  }

  for (const name of [
    ...formulae.map((one) => one.formula),
    "recognizer-plugins",
  ]) {
    must(`brew list --formula ${name} >/dev/null`);
  }

  const cask = JSON.parse(
    must("brew info --cask --json=v2 kenmclennan/tap/recognizer"),
  ).casks[0].version;
  const got = must("recognizer --version");

  if (got !== cask) {
    fail(`recognizer --version printed ${got}, the cask is ${cask}`);
  }

  const [absent] = missingPluginCommands(
    must("recognizer plugins --json"),
    commands,
  );

  if (absent !== undefined) {
    fail(`recognizer plugins does not name ${absent}`);
  }

  for (const command of commands) {
    must(`recognizer plugin check ${command}`);
  }

  const sample = mkdtempSync(join(tmpdir(), "tap-smoke-"));

  try {
    cpSync(join(root, "fixtures/python/sample"), sample, { recursive: true });
    must(`recognizer scan ${sample}`);
  } finally {
    rmSync(sample, { recursive: true, force: true });
  }

  const manifest = JSON.parse(must("recognizer-sense-mutation manifest"));
  const line = manifest.install.replaceAll("mutation", "crap");

  must("brew uninstall --ignore-dependencies recognizer-sense-crap");

  if (sh("command -v recognizer-sense-crap").status === 0) {
    fail(
      "recognizer-sense-crap is still on PATH after its formula was removed",
    );
  }

  for (let round = 0; round < 2; round++) {
    must(line);
    must("recognizer-sense-crap --version");
  }

  for (const command of fencedBlock(readme, "Uninstall")) {
    must(command);
  }

  const left = must("brew list --formula")
    .split("\n")
    .filter((name) => name.startsWith("recognizer"));

  if (left.length > 0) {
    fail(`formulae left after the uninstall block: ${left.join(", ")}`);
  }

  if (sh("command -v recognizer").status === 0) {
    fail("recognizer is still on PATH after the uninstall block");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    smoke(process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url)));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
