import { join } from "node:path";
import type { Io } from "../cli.js";
import type { FindingRecord } from "../findings-document.js";
import type { RecordedScan, Scan } from "../scan.js";
import {
  type DuplicationSettings,
  findingsForUnits,
  orderFindings,
  type Unit,
} from "./findings.js";
import { fingerprints } from "./fingerprint.js";
import { findFunctions } from "./functions.js";
import { type Grammar, grammarFor } from "./grammars.js";
import { assignIdentities } from "./identity.js";
import { countNodes, normalise } from "./normalise.js";
import type { Parsers } from "./parsers.js";
import { isTrivialShape } from "./shapes.js";
import {
  type CachedUnit,
  readUnitCache,
  reusable,
  type UnitCache,
  writeUnitCache,
} from "./unit-cache.js";

const DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function unitsInSource(
  module: string,
  path: string,
  source: string,
  grammar: Grammar,
  parsers: Parsers,
  settings: DuplicationSettings,
): Unit[] {
  const parser = parsers.get(grammar);
  const tree = parser?.parse(source) ?? null;

  if (tree === null) {
    return [];
  }

  try {
    const units: Unit[] = [];

    for (const found of findFunctions(tree.rootNode, grammar)) {
      const node = found.node;
      const lines = node.endPosition.row - node.startPosition.row + 1;

      if (node.hasError || lines < settings.min_lines) {
        continue;
      }

      if (countNodes(node) < settings.min_nodes || isTrivialShape(node)) {
        continue;
      }

      const normalised = normalise(node, new Set());

      if (normalised === null) {
        continue;
      }

      units.push({
        module,
        file: path,
        qualified: found.qualified,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startIndex: node.startIndex,
        endIndex: node.endIndex,
        fingerprints: fingerprints(normalised),
        identity: "",
      });
    }

    return units;
  } finally {
    tree.delete();
  }
}

export function withIdentities(units: Unit[]): Unit[] {
  const identities = assignIdentities(
    units.map((unit) => [unit.module, unit.qualified, unit.startLine] as const),
  );

  return units.map((unit, index) => ({
    ...unit,
    identity: identities[index] as string,
  }));
}

function decode(io: Io, path: string, bytes: Buffer): string | null {
  try {
    return DECODER.decode(bytes);
  } catch {
    io.stderr(`duplication: skipped ${path}: not valid UTF-8\n`);

    return null;
  }
}

interface Tally {
  parsed: number;
  reused: number;
}

function cachedOf(unit: Unit): CachedUnit {
  return {
    qualified: unit.qualified,
    startLine: unit.startLine,
    endLine: unit.endLine,
    startIndex: unit.startIndex,
    endIndex: unit.endIndex,
    fingerprints: [...unit.fingerprints],
  };
}

function unitOf(module: string, cached: CachedUnit): Unit {
  return {
    module,
    file: module,
    qualified: cached.qualified,
    startLine: cached.startLine,
    endLine: cached.endLine,
    startIndex: cached.startIndex,
    endIndex: cached.endIndex,
    fingerprints: new Set(cached.fingerprints),
    identity: "",
  };
}

function collectUnits(
  io: Io,
  root: string,
  scan: Scan,
  settings: DuplicationSettings,
  parsers: Parsers,
  cache: UnitCache | null,
  next: UnitCache,
  tally: Tally,
): Unit[] {
  const hashes = new Map(
    ((scan as Partial<RecordedScan>).files ?? []).map((file) => [
      file.path,
      file.hash,
    ]),
  );
  const units: Unit[] = [];

  for (const module of scan.modules) {
    const grammar = grammarFor(module.id);

    if (!hashes.has(module.id) || grammar === null) {
      continue;
    }

    const hash = hashes.get(module.id);
    const kept = cache?.[module.id];

    if (cache !== null && reusable(kept, hash, grammar, settings)) {
      next[module.id] = kept;
      tally.reused += 1;
      units.push(...kept.units.map((one) => unitOf(module.id, one)));

      continue;
    }

    let bytes: Buffer;

    try {
      bytes = io.readBytes(join(root, module.id));
    } catch {
      continue;
    }

    const source = decode(io, module.id, bytes);

    if (source === null) {
      continue;
    }

    const found = unitsInSource(
      module.id,
      module.id,
      source,
      grammar,
      parsers,
      settings,
    );

    tally.parsed += 1;
    units.push(...found);

    if (cache !== null && hash !== undefined) {
      next[module.id] = {
        hash,
        grammar,
        min_lines: settings.min_lines,
        min_nodes: settings.min_nodes,
        units: found.map(cachedOf),
      };
    }
  }

  return withIdentities(units);
}

export function measureDuplication(
  io: Io,
  root: string,
  scans: Scan[],
  settings: DuplicationSettings,
  parsers: Parsers,
  reuse = false,
): FindingRecord[] {
  const cache = reuse ? readUnitCache(io, root) : null;
  const next: UnitCache = {};
  const tally: Tally = { parsed: 0, reused: 0 };
  const findings = scans.flatMap((scan) =>
    findingsForUnits(
      collectUnits(io, root, scan, settings, parsers, cache, next, tally),
      settings,
    ),
  );

  if (cache !== null) {
    writeUnitCache(io, root, next);

    if (tally.parsed + tally.reused > 0) {
      io.stderr(
        `duplication: ${tally.parsed} files parsed, ${tally.reused} reused\n`,
      );
    }
  }

  return orderFindings(findings);
}
