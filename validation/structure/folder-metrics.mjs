import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePolicy, structureSensor } from "../../check/dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const corpus = join(root, "fixtures/structure/corpus");
const expected = JSON.parse(readFileSync(join(corpus, "expected.json"), "utf8"));

function scanOf(description) {
  const foreign = [...new Set(description.edges.map(([, to]) => to).filter((to) => to.startsWith("foreign:")))];

  return {
    schema_version: 6,
    scanner: { name: "hand-written", version: "0" },
    commit: null,
    modified: false,
    files: [],
    selection: { extensions: [], skip_directory_names: [], skip_directory_prefixes: [], skip_directory_suffixes: [], skip_directories_containing: [], skip_file_globs: [] },
    modules: description.modules.map((module) => ({
      id: module.id,
      language: "typescript",
      kind: module.kind,
      members: module.exports.map((kind, index) => ({ name: `m${index}`, exported: true, kind, line: index + 1 })),
    })),
    edges: description.edges.map(([from, to], index) => ({ from, to, kind: "depends", line: index + 1 })),
    foreign: foreign.map((id) => ({ id, name: id.slice(8) })),
  };
}

const off = { cycle: false, hub: false, folder_cycle: false, orphan: false, policy_drift: false, stable_dependencies: false, unused_exports: false };
const fields = ["modules", "afferent", "efferent", "instability", "exported_members", "abstract_members", "abstractness", "distance"];
const compact = ["| scan | folder | Ca | Ce | I | A | D |", "| --- | --- | --- | --- | --- | --- | --- |"];
const cell = (hand, sensor) => (hand === sensor ? `${hand} = ${sensor}` : `${hand} vs ${sensor}`);
const rows = ["| scan | folder | field | hand | sensor | agree |", "| --- | --- | --- | --- | --- | --- |"];
let disagreements = 0;

for (const row of expected.folder_metrics) {
  const description = JSON.parse(readFileSync(join(corpus, `${row.scan}.json`), "utf8"));
  const result = structureSensor([scanOf(description)], null, { hub_threshold: 10, instability_gap: 0, composition_roots: [], entry_points: [], warnings: off }, { commit: "c", modified: false });
  const got = result.folder_metrics.find((one) => one.id === row.folder);

  compact.push(`| ${row.scan} | ${row.folder} | ${cell(row.afferent, got?.afferent)} | ${cell(row.efferent, got?.efferent)} | ${cell(row.instability, got?.instability)} | ${cell(row.abstractness, got?.abstractness)} | ${cell(row.distance, got?.distance)} |`);

  for (const field of fields) {
    const agree = got?.[field] === row[field];
    disagreements += agree ? 0 : 1;
    rows.push(`| ${row.scan} | ${row.folder} | ${field} | ${row[field]} | ${got?.[field]} | ${agree ? "yes" : "NO"} |`);
  }
}

process.stdout.write(`${(process.argv.includes("--full") ? rows : compact).join("\n")}\n\ndisagreements: ${disagreements} of ${expected.folder_metrics.length * fields.length} values\n`);
