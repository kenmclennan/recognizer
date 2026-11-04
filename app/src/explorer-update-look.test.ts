import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { chrome, collectFacts, FAKE_WORKER, here } from "./look-page";

const SCAN_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const shipped = JSON.parse(
  readFileSync(here("../../schema/overlay-examples/valid/crap.json"), "utf8"),
);
const overlay = JSON.stringify({ ...shipped, commit: SCAN_COMMIT });

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, mountExplorer } from ${JSON.stringify(here("look-support.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
${FAKE_WORKER}

const ids = ["app/risk.py", "src/other.ts", "lib/none.py"];
const scan = {
  commit: ${JSON.stringify(SCAN_COMMIT)},
  modified: false,
  modules: ids.map((id) => ({ id, kind: "module" })),
  edges: [{ from: ids[0], to: ids[1], kind: "depends", line: 1, names: ["X"] }],
  foreign: [],
};
const style = { id: "style:c", kind: "style", severity: "warning", principle: "name-your-constants", summary: "magic numbers", evidence: { modules: [ids[2]] } };
const doc = (findings) => ({ findings_version: 1, sensor: { name: "lint", version: "1" }, commit: ${JSON.stringify(SCAN_COMMIT)}, modified: false, settings: {}, findings });
const loadedFor = (modules, overlays, findings) => loadedOf({
  modules,
  scans: [{ file: "scan.json", scan: { ...scan, modules: modules.map((id) => ({ id, kind: "module" })) } }],
  overlays,
  findings,
  sensors: [{ name: "lint", status: "ran" }],
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 80));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const host = document.getElementById("content");
const q = (selector) => host.querySelector(selector);
const qa = (selector) => [...host.querySelectorAll(selector)];
const port = fakeViews({});
const facts = {};

const panBy = (dx, dy) => q(".stage").dispatchEvent(new WheelEvent("wheel", { deltaX: -dx, deltaY: -dy, bubbles: true, cancelable: true }));
const shown = () => ({
  canvas: q(".canvas"),
  transform: q(".world").getAttribute("transform"),
  panel: q(".findings-panel") !== null && getComputedStyle(q(".findings-panel")).display !== "none",
  badge: [q(".rail-findings .rail-count"), q(".findings-line")].map((n) => (n === null ? null : n.textContent)).join("|"),
  metrics: qa(".metric-row").map((r) => r.dataset.metric),
});

(async () => {
  const explorer = mountExplorer({ container: host, loaded: loadedFor(ids, [], []), title: "demo", views: port, post: () => null, carried: null, showMetrics: () => {} });
  await tick();
  for (const folder of ["app", "src", "lib"]) {
    click(q('.tree .row[data-path="' + folder + '"] .rcheck'));
    await tick();
  }
  panBy(37, 21);
  await tick();
  click(q('.box[data-id="app/risk.py"]'));
  await tick();
  click(q(".metrics-toggle"));
  click(q(".rail-findings"));
  await tick();

  const before = shown();
  const beforeCarry = explorer.carry();
  const beforeSelection = JSON.stringify(beforeCarry.snapshot.selection);

  explorer.update(loadedFor(ids, [{ name: "crap", text: ${JSON.stringify(overlay)} }], [doc([style])]));
  await tick();

  const after = shown();
  const afterCarry = explorer.carry();
  facts.inPlace = {
    sameCanvas: before.canvas === after.canvas,
    sameTransform: before.transform === after.transform,
    transformIsPanned: before.transform !== "translate(0 0) scale(1)",
    selection: beforeSelection === JSON.stringify(afterCarry.snapshot.selection) && beforeSelection !== "null",
    leftPanel: [beforeCarry.leftPanel, afterCarry.leftPanel],
    sameHistory: beforeCarry.history === afterCarry.history,
    badge: [before.badge, after.badge],
    metrics: [before.metrics, after.metrics],
  };

  const camera = explorer.carry().camera;
  explorer.dispose();
  host.replaceChildren();
  const rebuilt = mountExplorer({ container: host, loaded: loadedFor(ids.slice(0, 2), [], []), title: "demo", views: port, post: () => null, carried: { ...afterCarry, camera }, showMetrics: () => {} });
  await tick();
  facts.rebuilt = { transform: q(".world").getAttribute("transform"), wanted: afterCarry.camera === null ? null : "translate(" + afterCarry.camera.x + " " + afterCarry.camera.y + ") scale(" + afterCarry.camera.k + ")" };
  rebuilt.dispose();

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(chrome === undefined)("an explorer updated in place", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "explorer-update");
  }, scaledTimeout(180000));

  it("keeps the canvas, its camera, the selection and the left panel", () => {
    expect(f.inPlace.sameCanvas).toBe(true);
    expect(f.inPlace.transformIsPanned).toBe(true);
    expect(f.inPlace.sameTransform).toBe(true);
    expect(f.inPlace.selection).toBe(true);
    expect(f.inPlace.leftPanel[0]).toBe("findings");
    expect(f.inPlace.leftPanel[1]).toBe("findings");
    expect(f.inPlace.sameHistory).toBe(true);
  });

  it("shows the new findings and overlay values", () => {
    expect(f.inPlace.badge[1]).not.toBe(f.inPlace.badge[0]);
    expect(f.inPlace.metrics[0]).toHaveLength(0);
    expect(f.inPlace.metrics[1].length).toBeGreaterThan(0);
  });

  it("starts a rebuilt canvas at the carried camera", () => {
    expect(f.rebuilt.wanted).not.toBeNull();
    expect(f.rebuilt.transform).toBe(f.rebuilt.wanted);
  });
});
