import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, FAKE_WORKER, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { showExplorer } from ${JSON.stringify(here("explorer.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
import { fakeSensors } from ${JSON.stringify(here("sensors-fake.ts"))};
import { withSensors } from ${JSON.stringify(here("sensor-run.ts"))};
import { NO_RUN } from ${JSON.stringify(here("sensors-panel-model.ts"))};
${FAKE_WORKER}

const ids = ["app/a.py", "app/b.py"];
const scan = {
  commit: "cur1234",
  modules: ids.map((id) => ({ id, kind: "module" })),
  edges: [{ from: ids[0], to: ids[1], kind: "depends", line: 1, names: ["X"] }],
  foreign: [],
};
const base = { modules: ids, scans: [{ file: "scan.python.json", scan }], policy: null, baseline: null, notices: [], blocking: null, findings: [], sensors: [] };
const CONFIG = "sensors:\\n  alpha:\\n    command: [node, '{repository}/a.mjs', '{commit}', '{output}']\\n  beta:\\n    command: [node, '{repository}/b.mjs', '{commit}', '{output}']\\n";

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

async function scenario(plan) {
  const host = document.createElement("div");
  host.style.cssText = "width:1400px;height:700px;display:flex;flex-direction:column";
  document.body.append(host);
  const q = (selector) => host.querySelector(selector);
  const all = (selector) => [...host.querySelectorAll(selector)];
  const fake = fakeSensors({}, { config: CONFIG });
  fake.commit = "cur1234";
  fake.plan = plan;
  let release = () => {};
  fake.gate = new Promise((resolve) => { release = resolve; });
  const state = { ticked: [], run: NO_RUN };
  let explorer = null;
  let current = await withSensors(base, fake);
  const sensorsHost = {
    port: fake,
    scan: () => ({ origin: { branch: "main", commit: "cur1234" }, scannedAt: Date.now(), changes: { files: [], moved: null }, rescanning: false, sensors: [] }),
    refresh: async () => {
      current = await withSensors(current, fake);
      const carried = explorer.carry();
      explorer.dispose();
      host.replaceChildren();
      explorer = build(carried);
    },
    state,
  };
  const build = (carried) => showExplorer(host, current, "demo", () => {}, fakeViews({}), () => {}, carried, undefined, { getItem: () => null, setItem: () => {} }, undefined, undefined, undefined, undefined, sensorsHost);
  explorer = build(null);
  await tick();

  click(q(".rail-sensors"));
  await tick();

  const rows = () => all(".sensor-row").map((r) => ({ name: r.querySelector(".sensor-name").textContent, chip: r.querySelector(".sensor-chip").textContent, ticks: r.querySelectorAll(".sensor-tick").length, title: r.title }));
  const visible = (selector) => { const n = q(selector); return n !== null && getComputedStyle(n).display !== "none"; };
  const facts = {};

  facts.order = all(".rail button").map((b) => b.className.split(" ")[1]);
  facts.opened = { panel: visible(".sensors-panel"), files: visible(".tree-header"), ran: fake.ran.length, scan: q(".sensors-scan").textContent, note: q(".sensors-note").textContent };
  facts.before = { rows: rows(), runSelected: q(".sensors-run-selected").disabled, runAll: q(".sensors-run-all").disabled };

  const tickBox = all(".sensor-row")[1].querySelector(".sensor-tick");
  tickBox.checked = true;
  tickBox.dispatchEvent(new Event("change", { bubbles: true }));
  await tick();
  facts.ticked = { runSelected: q(".sensors-run-selected").disabled };

  click(q(".sensors-run-selected"));
  await tick();
  facts.during = { rows: rows(), runSelected: q(".sensors-run-selected").disabled, runAll: q(".sensors-run-all").disabled, ran: fake.ran };

  release();
  await tick();
  await tick();
  facts.after = { rows: rows(), panelStillOpen: visible(".sensors-panel"), dot: q(".rail-sensors .rail-dot") !== null && !q(".rail-sensors .rail-dot").hidden && getComputedStyle(q(".rail-sensors .rail-dot")).display !== "none", label: getComputedStyle(q(".rail-sensors"), "::after").content, titleAttr: q(".rail-sensors").title };

  return facts;
}

(async () => {
  const facts = {};
  facts.good = await scenario({});
  facts.bad = await scenario({ alpha: "the sensor broke" });
  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(chrome === undefined)("the Sensors panel", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "sensors-panel");
  }, 180000);

  it("sits third on the rail, swaps with the tree and runs nothing on open", () => {
    expect(f.good.order).toEqual(["rail-files", "rail-notes", "rail-sensors"]);
    expect(f.good.opened.panel).toBe(true);
    expect(f.good.opened.files).toBe(false);
    expect(f.good.opened.ran).toBe(0);
    expect(f.good.opened.scan).toContain("cur1234");
    expect(f.good.opened.scan).toContain("python");
    expect(f.good.opened.note).toBe("A run writes the findings file.");
  });

  it("lists structure without a tick box and the registered sensors with one", () => {
    expect(f.good.before.rows).toEqual([
      expect.objectContaining({
        name: "structure",
        chip: "runs with every scan",
        ticks: 0,
      }),
      expect.objectContaining({ name: "alpha", chip: "not run", ticks: 1 }),
      expect.objectContaining({ name: "beta", chip: "not run", ticks: 1 }),
    ]);
    expect(f.good.before.runSelected).toBe(true);
    expect(f.good.before.runAll).toBe(false);
    expect(f.good.ticked.runSelected).toBe(false);
  });

  it("shows running with both buttons disabled until the run resolves, then ran", () => {
    expect(f.good.during.rows[1].chip).toBe("running");
    expect(f.good.during.rows[2].chip).toBe("not run");
    expect(f.good.during.runSelected).toBe(true);
    expect(f.good.during.runAll).toBe(true);
    expect(f.good.during.ran).toEqual([["alpha"]]);
    expect(f.good.after.rows[1].chip).toMatch(/^ran/);
    expect(f.good.after.panelStillOpen).toBe(true);
    expect(f.good.after.dot).toBe(false);
  });

  it("shows failed with its reason on the row and a red dot on the rail icon", () => {
    expect(f.bad.after.rows[1].chip).toBe("failed");
    expect(f.bad.after.rows[1].title).toBe("the sensor broke");
    expect(f.bad.after.dot).toBe(true);
  });

  it("labels the rail icon with data-label and no native title", () => {
    expect(f.good.after.titleAttr).toBe("");
    expect(f.good.after.label).toContain("Sensors");
  });
});
