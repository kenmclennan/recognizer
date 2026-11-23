import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const PREFIXES = {
  scanners: "recognizer-scan-",
  sensors: "recognizer-sense-",
  describers: "recognizer-describe-",
};

export function shippedPlugins(units) {
  const formulae = units.units.flatMap((unit) =>
    unit.formulae.map((one) => one.formula),
  );

  return Object.fromEntries(
    Object.entries(PREFIXES).map(([kind, prefix]) => [
      kind,
      formulae
        .filter((name) => name.startsWith(prefix))
        .map((name) => name.slice(prefix.length))
        .sort(),
    ]),
  );
}

export function writeShipped(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    `${JSON.stringify(shippedPlugins(JSON.parse(readFileSync(source, "utf8"))), null, 2)}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [source, target] = process.argv.slice(2);

  writeShipped(
    source ?? join(here, "..", "..", "..", "tools", "packaging", "units.json"),
    target ?? join(here, "..", "src", "generated", "shipped-plugins.json"),
  );
}
