import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parsePolicy,
  type Scan,
  type StructureSettings,
  structureSensor,
} from "../src/index.js";
import { REPO } from "./helpers.js";

const here = join(REPO, "fixtures/structure/corpus");

interface Case {
  id: string;
  scan: string;
  expect: "finding" | "no-finding";
  finding_id: string;
  measures: Record<string, number>;
  summary_includes?: string;
  derivation: string;
  known_defect: string | null;
}

interface MetricsRow {
  scan: string;
  folder: string;
  modules: number;
  afferent: number;
  efferent: number;
  instability: number | null;
  exported_members: number;
  abstract_members: number;
  abstractness: number | null;
  distance: number | null;
  derivation: string;
}

interface ScanDescription {
  settings: {
    entry_points?: string[];
    instability_gap?: number;
    composition_roots?: string[];
    warnings?: Record<string, boolean>;
  };
  policy?: string;
  modules: {
    id: string;
    kind: string;
    exports: string[];
    entry_point?: true;
  }[];
  edges: [string, string][];
}

const expected = JSON.parse(
  readFileSync(join(here, "expected.json"), "utf8"),
) as { cases: Case[]; folder_metrics: MetricsRow[] };

function read(name: string): ScanDescription {
  return JSON.parse(
    readFileSync(join(here, `${name}.json`), "utf8"),
  ) as ScanDescription;
}

function scanFrom(description: ScanDescription): Scan {
  const foreign = [
    ...new Set(
      description.edges
        .map(([, to]) => to)
        .filter((to) => to.startsWith("foreign:")),
    ),
  ];

  return {
    schema_version: 6,
    scanner: { name: "hand-written", version: "0" },
    commit: null,
    modified: false,
    files: [],
    selection: {
      extensions: [],
      skip_directory_names: [],
      skip_directory_prefixes: [],
      skip_directory_suffixes: [],
      skip_directories_containing: [],
      skip_file_globs: [],
    },
    modules: description.modules.map((module) => ({
      id: module.id,
      language: "typescript",
      kind: module.kind,
      ...(module.entry_point === true ? { entry_point: true } : {}),
      members: module.exports.map((kind, index) =>
        kind === "abstract"
          ? {
              name: `m${index}`,
              exported: true,
              kind: "class",
              line: index + 1,
              tags: ["abstract"],
            }
          : { name: `m${index}`, exported: true, kind, line: index + 1 },
      ),
    })),
    edges: description.edges.map(([from, to], index) => ({
      from,
      to,
      kind: "depends",
      line: index + 1,
    })),
    foreign: foreign.map((id) => ({ id, name: id.slice(8) })),
  } as unknown as Scan;
}

function settingsFrom(description: ScanDescription): StructureSettings {
  const off = {
    cycle: false,
    hub: false,
    folder_cycle: false,
    orphan: false,
    policy_drift: false,
    stable_dependencies: false,
    unused_exports: false,
  };

  return {
    hub_threshold: 10,
    instability_gap: description.settings.instability_gap ?? 0.2,
    composition_roots: description.settings.composition_roots ?? [],
    entry_points: description.settings.entry_points ?? [],
    warnings: { ...off, ...description.settings.warnings },
  };
}

function runScan(name: string) {
  const description = read(name);
  const policy =
    description.policy === undefined ? null : parsePolicy(description.policy);

  return structureSensor(
    [scanFrom(description)],
    policy,
    settingsFrom(description),
    { commit: "c", modified: false },
  );
}

const scans = [
  ...new Set([
    ...expected.cases.map((one) => one.scan),
    ...expected.folder_metrics.map((row) => row.scan),
  ]),
].sort();

function label(one: Case): string {
  return `${one.id} (${one.expect}, ${one.finding_id})`;
}

describe("structure corpus", () => {
  it("holds 30 labelled cases and 20 folder metric rows", () => {
    expect(expected.cases).toHaveLength(30);
    expect(expected.folder_metrics).toHaveLength(20);
  });

  it("has one scan file per scan name and no unlabelled scan file", () => {
    const files = readdirSync(here)
      .filter((file) => file !== "expected.json")
      .map((file) => file.replace(/\.json$/, ""))
      .sort();

    expect(files).toEqual(scans);
  });

  it("states a derivation for every case and metrics row", () => {
    for (const one of [...expected.cases, ...expected.folder_metrics]) {
      expect(one.derivation.trim()).not.toBe("");
    }
  });

  it("uses unique case ids", () => {
    const ids = expected.cases.map((one) => one.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const scan of scans) {
    describe(scan, () => {
      const result = runScan(scan);
      const found = result.document.findings;
      const cases = expected.cases.filter((one) => one.scan === scan);

      it("reports exactly the labelled findings: none missing, none extra", () => {
        const wanted = cases
          .filter(
            (one) => one.expect === "finding" && one.known_defect === null,
          )
          .map((one) => one.finding_id)
          .sort();
        const got = found.map((finding) => finding.id).sort();

        expect({
          missing: wanted.filter((id) => !got.includes(id)),
          extra: got.filter((id) => !wanted.includes(id)),
        }).toEqual({ missing: [], extra: [] });
      });

      for (const one of cases) {
        const run = one.known_defect === null ? it : it.fails;

        run(label(one), () => {
          const finding = found.find(
            (candidate) => candidate.id === one.finding_id,
          );

          if (one.expect === "no-finding") {
            expect(finding).toBeUndefined();

            return;
          }

          expect(finding).toBeDefined();
          expect(finding?.evidence.measures ?? {}).toEqual(one.measures);

          if (one.summary_includes !== undefined) {
            expect(finding?.summary).toContain(one.summary_includes);
          }
        });
      }

      for (const row of expected.folder_metrics.filter(
        (r) => r.scan === scan,
      )) {
        it(`measures folder ${row.folder} as the hand computation says`, () => {
          const {
            derivation: _derivation,
            scan: _scan,
            folder,
            ...wanted
          } = row;
          const got = result.folder_metrics.find((one) => one.id === folder);

          expect(got).toEqual({ id: folder, ...wanted });
        });
      }
    });
  }
});
