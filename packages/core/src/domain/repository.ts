import {
  type Call,
  type Dependency,
  Library,
  type TestImport,
  type UnresolvedImport,
} from "./dependency.js";
import type { Extraction } from "./extraction.js";
import type { File } from "./file.js";
import { Folder } from "./folder.js";
import { type Breach, InvalidEntity } from "./invalid-entity.js";
import { PolicyRule } from "./policy-rule.js";
import { sealedGroups } from "./sealed-hierarchy.js";
import { strongComponents } from "./strong-components.js";
import { Violation } from "./violation.js";
import { Warning } from "./warning.js";

export interface RepositoryParts {
  readonly files?: readonly File[];
  readonly dependencies?: readonly Dependency[];
  readonly libraries?: readonly Library[];
  readonly calls?: readonly Call[];
  readonly unresolvedImports?: readonly UnresolvedImport[];
  readonly testImports?: readonly TestImport[];
  readonly extractions?: readonly Extraction[];
}

export interface FindingTargets {
  readonly files: readonly string[];
  readonly members?: readonly {
    readonly file: string;
    readonly name: string;
  }[];
}

export interface KeptGraph {
  readonly edges: Dependency[];
  readonly declarations: Dependency[];
  readonly ids: Set<string>;
}

interface Group {
  file: string;
  rule: Violation["rule"];
  dependencies: { to: string; kind: string; lines: number[] }[];
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export class Repository {
  readonly folders: readonly Folder[];
  readonly files: readonly File[];
  readonly dependencies: readonly Dependency[];
  readonly libraries: readonly Library[];
  readonly calls: readonly Call[];
  readonly unresolvedImports: readonly UnresolvedImport[];
  readonly testImports: readonly TestImport[];
  readonly extractions: readonly Extraction[];
  readonly #index: Map<string, File[]>;
  readonly #folderIndex: Map<string, Folder>;

  private constructor(parts: RepositoryParts) {
    this.files = parts.files ?? [];
    this.dependencies = parts.dependencies ?? [];
    this.libraries = parts.libraries ?? [];
    this.calls = parts.calls ?? [];
    this.unresolvedImports = parts.unresolvedImports ?? [];
    this.testImports = parts.testImports ?? [];
    this.extractions = parts.extractions ?? [];
    this.folders = Folder.derive(this.files.map(({ path }) => path));
    this.#index = new Map();
    this.#folderIndex = new Map(
      this.folders.map((folder) => [folder.path, folder]),
    );

    const breaches: Breach[] = [];

    for (const file of this.files) {
      const at = this.#index.get(file.path) ?? [];

      if (at.some((one) => one.language === file.language)) {
        breaches.push({
          rule: "a path is repeated within one language",
          value: `${file.path} (${file.language})`,
        });
      }

      at.push(file);
      this.#index.set(file.path, at);
    }

    for (const dependency of this.dependencies) {
      for (const end of [dependency.from, dependency.to]) {
        const held = this.#index.get(end);

        if (
          held !== undefined &&
          !held.some((file) => file.language === dependency.language)
        ) {
          breaches.push({
            rule: "a dependency crosses languages",
            value: `${dependency.from} -> ${dependency.to} (${dependency.language})`,
          });
        }
      }
    }

    if (breaches.length > 0) {
      throw InvalidEntity.of("Repository", breaches);
    }
  }

  static of(parts: RepositoryParts = {}): Repository {
    return new Repository(parts);
  }

  static readonly empty: Repository = new Repository({});

  static join(parts: readonly Repository[]): Repository {
    return new Repository({
      files: parts.flatMap((part) => part.files),
      dependencies: parts.flatMap((part) => part.dependencies),
      libraries: parts.flatMap((part) => part.libraries),
      calls: parts.flatMap((part) => part.calls),
      unresolvedImports: parts.flatMap((part) => part.unresolvedImports),
      testImports: parts.flatMap((part) => part.testImports),
      extractions: parts.flatMap((part) => part.extractions),
    });
  }

  file(path: string, language?: string): File | undefined {
    const held = this.#index.get(path);

    return language === undefined
      ? held?.[0]
      : held?.find((file) => file.language === language);
  }

  filesAt(path: string): readonly File[] {
    return this.#index.get(path) ?? [];
  }

  hasFile(path: string): boolean {
    return this.#index.has(path);
  }

  folder(path: string): Folder | undefined {
    return this.#folderIndex.get(path);
  }

  filesIn(folderPath: string): File[] {
    return this.files.filter((file) => file.folder === folderPath);
  }

  dependentsOf(path: string): Dependency[] {
    return this.dependencies.filter((dependency) => dependency.to === path);
  }

  dependenciesOf(path: string): Dependency[] {
    return this.dependencies.filter((dependency) => dependency.from === path);
  }

  scannedHashes(): Map<string, string> {
    const hashes = new Map<string, string>();

    for (const extraction of this.extractions) {
      for (const file of extraction.files) {
        hashes.set(file.path, file.hash);
      }
    }

    return hashes;
  }

  missingTargetsOf(targets: FindingTargets): string[] {
    const missing = new Set<string>();

    for (const path of targets.files) {
      if (!this.hasFile(path)) {
        missing.add(path);
      }
    }

    for (const member of targets.members ?? []) {
      const files = this.filesAt(member.file);

      if (files.length === 0) {
        missing.add(member.file);
      } else if (!files.some((file) => file.holdsMemberNamed(member.name))) {
        missing.add(`${member.file}:${member.name}`);
      }
    }

    return [...missing];
  }

  holdsTargetsOf(finding: FindingTargets): boolean {
    return this.missingTargetsOf(finding).length === 0;
  }

  graphKeeping(rules: readonly PolicyRule[] | null): KeptGraph {
    const ignores = PolicyRule.ignores(rules);
    const dropped = (id: string) =>
      !Library.owns(id) && ignores.some((rule) => rule.ignores(id));

    const ids = new Set<string>();

    for (const file of this.files) {
      if (!dropped(file.path)) {
        ids.add(file.path);
      }
    }

    const kept = this.dependencies.filter(
      (edge) =>
        edge.inferred === undefined && !dropped(edge.from) && !dropped(edge.to),
    );
    const edges = kept.filter((edge) => edge.countsAsEdge);
    const declarations = kept.filter((edge) => !edge.countsAsEdge);

    for (const edge of edges) {
      ids.add(edge.from);

      if (!Library.owns(edge.to)) {
        ids.add(edge.to);
      }
    }

    return { edges, declarations, ids };
  }

  violations(rules: readonly PolicyRule[]): Violation[] {
    const forbids = PolicyRule.forbids(rules);
    const { edges } = this.graphKeeping(rules);
    const found = new Map<string, Group>();

    for (const edge of edges) {
      if (edge.from === edge.to) {
        continue;
      }

      for (const rule of forbids) {
        if (!rule.forbids(edge.from, edge.to)) {
          continue;
        }

        const key = `${edge.from}\u0000forbid ${rule.pattern}`;
        let group = found.get(key);

        if (group === undefined) {
          group = {
            file: edge.from,
            rule: { type: "forbid", pattern: rule.pattern },
            dependencies: [],
          };
          found.set(key, group);
        }

        const existing = group.dependencies.find(
          (one) => one.to === edge.to && one.kind === edge.kind,
        );

        if (existing) {
          existing.lines.push(edge.line);
        } else {
          group.dependencies.push({
            to: edge.to,
            kind: edge.kind,
            lines: [edge.line],
          });
        }
      }
    }

    const textOf = (group: Group) =>
      group.rule.type === "forbid" ? `forbid ${group.rule.pattern}` : "";

    return [...found.values()]
      .sort(
        (a, b) =>
          byCodeUnit(a.file, b.file) || byCodeUnit(textOf(a), textOf(b)),
      )
      .map(
        (group) =>
          new Violation({
            file: group.file,
            rule: group.rule,
            dependencies: group.dependencies
              .map((one) => ({
                to: one.to,
                kind: one.kind,
                lines: [...new Set(one.lines)].sort((a, b) => a - b),
              }))
              .sort(
                (a, b) => byCodeUnit(a.to, b.to) || byCodeUnit(a.kind, b.kind),
              ),
          }),
      );
  }

  cycleWarnings(rules: readonly PolicyRule[]): Warning[] {
    const { edges, ids } = this.graphKeeping(rules);
    const internal = new Map<string, Set<string>>();

    for (const id of ids) {
      internal.set(id, new Set());
    }

    for (const edge of edges) {
      if (edge.from === edge.to || Library.owns(edge.to)) {
        continue;
      }

      internal.get(edge.from)?.add(edge.to);
    }

    const sorted = [...ids].sort(byCodeUnit);
    const groups = sealedGroups(this, edges);
    const groupOf = (id: string) => groups.get(id) ?? id;
    const crossing = new Map<string, Set<string>>();
    const groupSuccessors = new Map<string, Set<string>>();

    for (const id of sorted) {
      crossing.set(id, new Set());
      groupSuccessors.set(groupOf(id), new Set());
    }

    for (const id of sorted) {
      for (const to of internal.get(id) ?? []) {
        if (groupOf(to) !== groupOf(id)) {
          crossing.get(id)?.add(to);
          groupSuccessors.get(groupOf(id))?.add(groupOf(to));
        }
      }
    }

    const groupIds = [...groupSuccessors.keys()].sort(byCodeUnit);
    const successors = new Map<string, string[]>();

    for (const group of groupIds) {
      successors.set(
        group,
        [...(groupSuccessors.get(group) ?? [])].sort(byCodeUnit),
      );
    }

    return strongComponents(groupIds, successors)
      .filter((component) => component.length >= 2)
      .map((component): Warning => {
        const members = new Set(component);
        const inside = sorted.flatMap((from) =>
          members.has(groupOf(from))
            ? [...(crossing.get(from) ?? [])]
                .filter((to) => members.has(groupOf(to)))
                .sort(byCodeUnit)
                .map((to) => ({ from, to }))
            : [],
        );
        const files = [
          ...new Set(inside.flatMap((edge) => [edge.from, edge.to])),
        ].sort(byCodeUnit);

        return new Warning({
          summary: `cycle of ${files.length} files: ${files.join(", ")}`,
          files,
          dependencies: inside,
        });
      })
      .sort((a, b) => byCodeUnit(a.files[0] ?? "", b.files[0] ?? ""));
  }
}
