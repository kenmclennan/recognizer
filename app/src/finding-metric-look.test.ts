import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, FAKE_WORKER, here } from "./look-page";

const SCAN_COMMIT = "0123456789abcdef0123456789abcdef01234567";

const shipped = JSON.parse(
  readFileSync(here("../../schema/overlay-examples/valid/crap.json"), "utf8"),
);
const fresh = JSON.stringify({ ...shipped, commit: SCAN_COMMIT });
const stale = JSON.stringify({
  ...shipped,
  commit: "ffffffffffffffffffffffffffffffffffffffff",
});

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { showExplorer } from ${JSON.stringify(here("explorer.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
${FAKE_WORKER}

const ids = ["app/risk.py", "src/other.ts"];
const scanOf = () => ({
  commit: ${JSON.stringify(SCAN_COMMIT)},
  modified: false,
  modules: ids.map((id) => ({ id, kind: "module" })),
  edges: [],
  foreign: [],
});
const finding = (id, metric) => ({ id, kind: "threshold", severity: "warning", principle: "keep-it-small", summary: "complexity above 5", ...(metric === undefined ? {} : { metric }), evidence: { modules: [ids[0]], measures: { complexity: 8 } } });
const doc = (findings) => ({ findings_version: 1, sensor: { name: "thresholds", version: "1" }, commit: ${JSON.stringify(SCAN_COMMIT)}, modified: false, settings: {}, findings });
const loadedOf = (overlay, findings) => ({
  modules: ids,
  scans: [{ file: "scan.json", scan: scanOf() }],
  policy: null,
  notices: [],
  blocking: null,
  findings: [doc(findings)],
  sensors: [{ name: "thresholds", status: "ran" }],
  overlays: [{ name: "crap", text: overlay }],
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const host = document.getElementById("content");
const q = (selector) => host.querySelector(selector);
const qa = (selector) => [...host.querySelectorAll(selector)];
const port = fakeViews({});
const footer = { text: null };
const facts = {};
const bars = () => qa('.box[data-id="app/risk.py"] .metric-bar').map((bar) => bar.dataset.metric);
const shows = (scope) => qa(scope + " .finding-metric").map((b) => b.textContent);

(async () => {
  const mount = (overlay, findings) => {
    host.replaceChildren();
    return showExplorer(host, loadedOf(overlay, findings), "demo", () => {}, port, () => {}, null, undefined, undefined, undefined, undefined, undefined, undefined, (text) => { footer.text = text; });
  };
  const plain = finding("t:plain");
  const measured = finding("t:measured", "complexity");
  const unknown = finding("t:unknown", "no_such_metric");

  let explorer = mount(${JSON.stringify(fresh)}, [plain, measured, unknown]);
  await tick();
  click(q(".rail-findings"));
  await tick();
  click(q('.finding-row[data-id="t:plain"]'));
  await tick();
  facts.plain = shows(".findings-panel");
  click(q('.finding-row[data-id="t:unknown"]'));
  await tick();
  facts.unknown = shows(".findings-panel");
  click(q('.finding-row[data-id="t:measured"]'));
  await tick();
  facts.panelButton = shows(".findings-panel");
  facts.barsBefore = bars();
  click(q(".findings-panel .finding-metric"));
  await tick();
  facts.barsAfter = bars();
  facts.footer = footer.text;
  click(q(".findings-panel .finding-metric"));
  await tick();
  facts.barsTwice = bars();
  explorer.dispose();

  explorer = mount(${JSON.stringify(fresh)}, [measured]);
  await tick();
  click(q('.tree .row[data-path="app"] .rcheck'));
  await tick();
  click(q('.box[data-id="app/risk.py"] .box-body'));
  await tick();
  click(q('.selection-bar .bar-button[title="Findings (W)"]'));
  await tick();
  click(q('.inspector-panel .finding-row[data-id="t:measured"]'));
  await tick();
  facts.inspectorButton = shows(".inspector-panel");
  click(q(".inspector-panel .finding-metric"));
  await tick();
  facts.inspectorBars = bars();
  explorer.dispose();

  explorer = mount(${JSON.stringify(stale)}, [measured]);
  await tick();
  click(q(".rail-findings"));
  await tick();
  click(q('.finding-row[data-id="t:measured"]'));
  await tick();
  facts.stale = { expanded: qa(".finding-detail").length, buttons: shows(".findings-panel") };
  explorer.dispose();

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(chrome === undefined)("Show a finding's metric", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "finding-metric-look");
  }, 180000);

  it("offers no button for a finding with no metric or one no overlay holds", () => {
    expect(f.plain).toEqual([]);
    expect(f.unknown).toEqual([]);
  });

  it("names the metric on the Findings panel row and ticks it on click", () => {
    expect(f.panelButton).toEqual(["Show complexity on the canvas"]);
    expect(f.barsBefore).toEqual([]);
    expect(f.barsAfter).toEqual(["crap/complexity"]);
    expect(f.footer).toBe("Showing complexity from crap");
  });

  it("keeps the metric ticked when clicked again", () => {
    expect(f.barsTwice).toEqual(["crap/complexity"]);
  });

  it("offers the same button on the inspector's Findings card", () => {
    expect(f.inspectorButton).toEqual(["Show complexity on the canvas"]);
    expect(f.inspectorBars).toEqual(["crap/complexity"]);
  });

  it("omits the button when the overlay is stale", () => {
    expect(f.stale).toEqual({ expanded: 1, buttons: [] });
  });
});
