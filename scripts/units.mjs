import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function parseUnits(text, root) {
  const units = JSON.parse(text).units;

  if (!Array.isArray(units)) {
    throw new Error("units.json has no units list");
  }

  const formulae = new Set();
  const commands = new Set();
  const ids = new Set();

  for (const entry of units) {
    const name = entry.unit ?? "(unnamed)";

    if (ids.has(entry.unit)) {
      throw new Error(`unit ${name} is listed twice`);
    }

    ids.add(entry.unit);

    if (typeof entry.folder !== "string") {
      throw new Error(`unit ${name} has no folder`);
    }

    if (root !== undefined && !existsSync(join(root, entry.folder))) {
      throw new Error(
        `unit ${name} names a folder that does not exist: ${entry.folder}`,
      );
    }

    if (entry.runtime !== null && typeof entry.runtime !== "string") {
      throw new Error(
        `unit ${name} has a runtime that is neither a string nor null`,
      );
    }

    if (!Array.isArray(entry.formulae) || entry.formulae.length === 0) {
      throw new Error(`unit ${name} has no formulae`);
    }

    for (const one of entry.formulae) {
      if (formulae.has(one.formula)) {
        throw new Error(`formula ${one.formula} is listed twice`);
      }

      if (commands.has(one.command)) {
        throw new Error(`command ${one.command} is listed twice`);
      }

      formulae.add(one.formula);
      commands.add(one.command);
    }
  }

  return units;
}

export function loadUnits(root) {
  return parseUnits(
    readFileSync(join(root, "packaging/units.json"), "utf8"),
    root,
  );
}

export function findUnit(units, id) {
  const found = units.find((entry) => entry.unit === id);

  if (found === undefined) {
    throw new Error(
      `no unit ${id}; the units are ${units.map((entry) => entry.unit).join(", ")}`,
    );
  }

  return found;
}

export function allFormulae(units) {
  return units.flatMap((entry) =>
    entry.formulae.map((one) => ({
      ...one,
      unit: entry.unit,
      runtime: entry.runtime,
    })),
  );
}
