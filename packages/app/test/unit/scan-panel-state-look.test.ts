import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { installedSensors } from "../../src/installed-fake";
import { collectFacts, FAKE_WORKER, here, webkit } from "../../src/look-page";

const SCAN_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const HASH = "1".repeat(64);

const example = JSON.parse(
  readFileSync(
    here("../../../schema/overlay-examples/valid/crap.json"),
    "utf8",
  ),
);
const overlay = JSON.stringify({
  ...example,
  commit: SCAN_COMMIT,
  inputs: { "app/risk.py": HASH, "src/other.ts": HASH, "lib/none.py": HASH },
});

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, mountExplorer, scanHostOf } from ${JSON.stringify(here("../test/unit/look-support.ts"))};
import { fakeSensors } from ${JSON.stringify(here("sensors-fake.ts"))};
import { fakeViews } from ${JSON.stringify(here("../test/unit/views-fake.ts"))};
import { fakeRepositoryState } from ${JSON.stringify(here("repository-state-fake.ts"))};
import { createRepositoryStateHolder } from ${JSON.stringify(here("repository-state-holder.ts"))};
import { installedSensorsOf, storedResultsOf } from ${JSON.stringify(here("repository-state-model.ts"))};
import { withSensors } from ${JSON.stringify(here("sensor-run.ts"))};
import { NO_RUN } from ${JSON.stringify(here("scan-panel-model.ts"))};
${FAKE_WORKER}

const ids = ["app/risk.py", "src/other.ts", "lib/none.py"];
const COMMIT = ${JSON.stringify(SCAN_COMMIT)};
const HASH = ${JSON.stringify(HASH)};
const INPUTS = { "app/risk.py": HASH, "src/other.ts": HASH, "lib/none.py": HASH };
const scan = {
  commit: COMMIT,
  modified: false,
  files: ids.map((id) => ({ path: id, hash: HASH })),
  modules: ids.map((id) => ({ id, kind: "module" })),
  edges: [{ from: ids[0], to: ids[1], kind: "depends", line: 1, names: ["X"] }],
  foreign: [],
};
const INSTALLED = ${JSON.stringify(
  installedSensors().filter(
    (one) => one.name === "crap" || one.name === "mutation",
  ),
)};
const manifest = (one) => ({ display: one.display, runsTests: one.runsTests, scoped: one.scoped, listed: one.listed, description: one.description, metrics: one.metrics, findings: [], settings: [] });
const TALLY = { display: "Tally", runsTests: false, scoped: false, listed: true, description: "Counts.", metrics: [], findings: [], settings: [] };
const CONFIG = "sensors:\\n  crap: {}\\n  mutation: {}\\n  tally:\\n    command: [node, t.mjs]\\n";
const entries = [...INSTALLED.map((one) => ({ name: one.name, registered: true, manifest: manifest(one), reason: null })), { name: "tally", registered: true, manifest: TALLY, reason: null }];
const state = {
  repository: "/repo",
  revision: 7,
  registry: { catalog: { state: "read" }, entries },
  run: null,
  results: { crap: { unreadable: 0, results: [{ commit: COMMIT, modified: false, findings: null, overlay: "overlay:crap", inputsDigest: null, testsDigest: null, reportedAt: "2026-11-24T10:00:00Z", unreadable: false }] } },
  freshness: {},
  unreadableReports: 0,
  inputsDigest: "d",
};

const fakeState = fakeRepositoryState(state);
fakeState.setTexts("crap", { overlay: ${JSON.stringify(overlay)} });
const holder = createRepositoryStateHolder(fakeState);
const base = fakeSensors({}, { config: CONFIG }, {}, []);
const sensors = { ...base, sensorList: async () => installedSensorsOf(await holder.latest()), readResults: async () => storedResultsOf(await holder.latest(), await fakeState.readResults()) };

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const host = document.getElementById("content");
const q = (selector) => host.querySelector(selector);
const qa = (selector) => [...host.querySelectorAll(selector)];
const views = fakeViews({});
const facts = {};

const loadedNow = async () => {
  const sensed = await withSensors(loadedOf({ modules: ids, scans: [{ file: "scan.json", scan }] }), sensors);
  facts.overlayNames = (sensed.overlays ?? []).map((one) => one.name);
  return { ...sensed, sensors: [...sensed.sensors.filter((one) => one.name !== "crap"), { name: "crap", status: "ran", commit: COMMIT, findings: 0, measured: { inputs: INPUTS } }] };
};
const runningHost = () => scanHostOf({ port: sensors, running: () => true, runState: () => ({ ...NO_RUN, running: ["mutation"], started: "run-1" }) });
const mount = async (carried) => mountExplorer({ container: host, loaded: await loadedNow(), title: "demo", views, post: () => null, carried, scanHost: runningHost() });
const panel = () => ({
  rows: qa(".scan-row:not(.scan-suite)").map((r) => ({ key: r.dataset.sensor, name: r.querySelector(".scan-row-label").textContent })),
  controls: qa(".controls .control").map((b) => b.textContent),
});

(async () => {
  let explorer = await mount(null);
  await tick();
  facts.before = panel();

  const carried = explorer.carry();
  explorer.dispose();
  host.replaceChildren();
  explorer = await mount(carried);
  await tick();
  facts.after = panel();

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(webkit === undefined)(
  "the Scan panel over a repository snapshot",
  () => {
    let f = null as unknown as Facts;

    beforeAll(async () => {
      f = await collectFacts<Facts>(HARNESS, "scan-panel-state-look");
    }, scaledTimeout(180000));

    it("rows_and_overlay_survive_an_explorer_replace_mid_run", () => {
      const named = (rows: { key: string }[]) =>
        rows
          .map((row) => row.key)
          .filter((key) => ["crap", "mutation", "tally"].includes(key));

      expect(named(f.before.rows).sort()).toEqual([
        "crap",
        "mutation",
        "tally",
      ]);
      expect(f.before.controls).toContain("Metrics");
      expect(f.overlayNames).toContain("crap");
      expect(named(f.after.rows)).toEqual(named(f.before.rows));
      expect(f.after.rows).toEqual(f.before.rows);
      expect(f.after.controls).toContain("Metrics");
    });
  },
);
