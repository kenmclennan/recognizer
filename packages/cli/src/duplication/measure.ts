import { join } from "node:path";
import { type File, type Repository, scannedHashes } from "@recognizer/core";
import type { Io } from "../cli.js";
import type { FindingRecord } from "../findings-document.js";
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
import { comparedSpan } from "./span.js";
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
      const span = comparedSpan(node, grammar);

      if (span === null) {
        continue;
      }

      const body = span.node;
      const lines = span.lines;

      if (node.hasError || lines < settings.min_lines) {
        continue;
      }

      if (countNodes(body) < settings.min_nodes || isTrivialShape(node)) {
        continue;
      }

      const normalised = normalise(body, new Set());

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
        floorLines: lines,
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

export function decode(
  io: Io,
  path: string,
  bytes: Buffer,
  label = "duplication",
): string | null {
  try {
    return DECODER.decode(bytes);
  } catch {
    io.stderr(`${label}: skipped ${path}: not valid UTF-8\n`);

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
    floorLines: unit.floorLines,
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
    floorLines: cached.floorLines,
    fingerprints: new Set(cached.fingerprints),
    identity: "",
  };
}

function collectUnits(
  io: Io,
  root: string,
  files: readonly File[],
  hashes: ReadonlyMap<string, string>,
  settings: DuplicationSettings,
  parsers: Parsers,
  cache: UnitCache | null,
  next: UnitCache,
  tally: Tally,
): Unit[] {
  const units: Unit[] = [];

  for (const module of files) {
    const grammar = grammarFor(module.path);

    if (!hashes.has(module.path) || grammar === null) {
      continue;
    }

    const hash = hashes.get(module.path);
    const kept = cache?.[module.path];

    if (cache !== null && reusable(kept, hash, grammar, settings)) {
      next[module.path] = kept;
      tally.reused += 1;
      units.push(...kept.units.map((one) => unitOf(module.path, one)));

      continue;
    }

    let bytes: Buffer;

    try {
      bytes = io.readBytes(join(root, module.path));
    } catch {
      continue;
    }

    const source = decode(io, module.path, bytes);

    if (source === null) {
      continue;
    }

    const found = unitsInSource(
      module.path,
      module.path,
      source,
      grammar,
      parsers,
      settings,
    );

    tally.parsed += 1;
    units.push(...found);

    if (cache !== null && hash !== undefined) {
      next[module.path] = {
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
  repository: Repository,
  settings: DuplicationSettings,
  parsers: Parsers,
  reuse = false,
): FindingRecord[] {
  const cache = reuse ? readUnitCache(io, root) : null;
  const next: UnitCache = {};
  const tally: Tally = { parsed: 0, reused: 0 };
  const hashes = scannedHashes(repository);
  const findings = repository.extractions.flatMap(({ language }) =>
    findingsForUnits(
      collectUnits(
        io,
        root,
        repository.files.filter((file) => file.language === language),
        hashes,
        settings,
        parsers,
        cache,
        next,
        tally,
      ),
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
