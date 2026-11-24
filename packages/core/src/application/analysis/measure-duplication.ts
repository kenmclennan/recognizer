import {
  type DuplicationSettings,
  findingsForUnits,
  orderFindings,
  type Unit,
} from "../../domain/analysis/duplication/findings.js";
import { fingerprints } from "../../domain/analysis/duplication/fingerprint.js";
import { findFunctions } from "../../domain/analysis/duplication/functions.js";
import {
  type GrammarRule,
  grammarFor,
} from "../../domain/analysis/duplication/grammars.js";
import { assignIdentities } from "../../domain/analysis/duplication/identity.js";
import {
  countNodes,
  normalise,
} from "../../domain/analysis/duplication/normalise.js";
import { isTrivialShape } from "../../domain/analysis/duplication/shapes.js";
import { comparedSpan } from "../../domain/analysis/duplication/span.js";
import { vocabularyOf } from "../../domain/analysis/duplication/vocabulary.js";
import type { File } from "../../domain/file.js";
import type { FindingsRepository } from "../../domain/findings-repository.js";
import type { Repository } from "../../domain/repository.js";
import {
  type CachedUnit,
  reusable,
  type UnitCache,
} from "../../domain/unit-cache.js";
import type { Warning } from "../../domain/warning.js";
import type { Say } from "../shared/ports/process.js";
import type { Digest } from "./ports/digest.js";
import type { Parsers } from "./ports/parsing.js";
import type { SourceFiles } from "./ports/source-files.js";

const DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export interface MeasurePorts {
  source: SourceFiles;
  digest: Digest;
  findings: FindingsRepository;
}

export function unitsInSource(
  module: string,
  path: string,
  source: string,
  rule: GrammarRule,
  parsers: Parsers,
  settings: DuplicationSettings,
  digest: (text: string) => string,
): Unit[] {
  const vocabulary = vocabularyOf(rule);
  const parser = parsers.get(rule.name);
  const tree = parser?.parse(source) ?? null;

  if (tree === null) {
    return [];
  }

  try {
    const units: Unit[] = [];

    for (const found of findFunctions(tree.rootNode, rule)) {
      const node = found.node;
      const span = comparedSpan(node, rule);

      if (span === null) {
        continue;
      }

      const body = span.node;
      const lines = span.lines;

      if (node.hasError || lines < settings.min_lines) {
        continue;
      }

      if (
        countNodes(body) < settings.min_nodes ||
        isTrivialShape(node, vocabulary)
      ) {
        continue;
      }

      const normalised = normalise(body, new Set(), vocabulary);

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
        fingerprints: fingerprints(normalised, digest),
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
  say: Say,
  path: string,
  bytes: Uint8Array,
  label = "duplication",
): string | null {
  try {
    return DECODER.decode(bytes);
  } catch {
    say("stderr", `${label}: skipped ${path}: not valid UTF-8\n`);

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
  ports: MeasurePorts,
  say: Say,
  root: string,
  files: readonly File[],
  hashes: ReadonlyMap<string, string>,
  settings: DuplicationSettings,
  parsers: Parsers,
  rules: readonly GrammarRule[],
  cache: UnitCache | null,
  next: UnitCache,
  tally: Tally,
): Unit[] {
  const units: Unit[] = [];

  for (const module of files) {
    const rule = grammarFor(module.path, rules);

    if (!hashes.has(module.path) || rule === null) {
      continue;
    }

    const hash = hashes.get(module.path);
    const kept = cache?.[module.path];

    if (cache !== null && reusable(kept, hash, rule.name, settings)) {
      next[module.path] = kept;
      tally.reused += 1;
      units.push(...kept.units.map((one) => unitOf(module.path, one)));

      continue;
    }

    let bytes: Uint8Array;

    try {
      bytes = ports.source.readBytes(root, module.path);
    } catch {
      continue;
    }

    const source = decode(say, module.path, bytes);

    if (source === null) {
      continue;
    }

    const found = unitsInSource(
      module.path,
      module.path,
      source,
      rule,
      parsers,
      settings,
      ports.digest.sha1Prefix,
    );

    tally.parsed += 1;
    units.push(...found);

    if (cache !== null && hash !== undefined) {
      next[module.path] = {
        hash,
        grammar: rule.name,
        min_lines: settings.min_lines,
        min_nodes: settings.min_nodes,
        units: found.map(cachedOf),
      };
    }
  }

  return withIdentities(units);
}

export function measureDuplication(
  ports: MeasurePorts,
  say: Say,
  root: string,
  repository: Repository,
  settings: DuplicationSettings,
  parsers: Parsers,
  rules: readonly GrammarRule[],
  reuse = false,
): Warning[] {
  let cache: UnitCache | null = null;

  if (reuse) {
    const read = ports.findings.readUnitCache(root);

    cache = read.cache;

    if (read.problem !== null) {
      say("stderr", read.problem);
    }
  }

  const next: UnitCache = {};
  const tally: Tally = { parsed: 0, reused: 0 };
  const hashes = repository.scannedHashes();
  const findings = repository.extractions.flatMap(({ language }) =>
    findingsForUnits(
      collectUnits(
        ports,
        say,
        root,
        repository.files.filter((file) => file.language === language),
        hashes,
        settings,
        parsers,
        rules,
        cache,
        next,
        tally,
      ),
      settings,
    ),
  );

  if (cache !== null) {
    const problem = ports.findings.writeUnitCache(root, next);

    if (problem !== null) {
      say("stderr", problem);
    }

    if (tally.parsed + tally.reused > 0) {
      say(
        "stderr",
        `duplication: ${tally.parsed} files parsed, ${tally.reused} reused\n`,
      );
    }
  }

  return orderFindings(findings);
}
