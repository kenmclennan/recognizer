import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, here, webkit } from "./look-page";

const HARNESS = `
import { attachModuleTip } from ${JSON.stringify(here("module-tip.ts"))};
import { buildScanPanelView } from ${JSON.stringify(here("scan-panel-view.ts"))};

(async () => {
const enter = (node) => node.dispatchEvent(new MouseEvent("mouseenter"));
const leave = (node) => node.dispatchEvent(new MouseEvent("mouseleave"));
const tips = () => document.querySelectorAll(".module-tip, .scan-tip").length;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const facts = {};

const treeHost = document.createElement("div");
document.body.append(treeHost);
const treeRow = document.createElement("div");
treeRow.className = "row";
treeHost.append(treeRow);
attachModuleTip(treeRow, { path: "pkg/a.py", description: "Does a thing." });
enter(treeRow);
facts.treeOpen = tips();
treeHost.replaceChildren();
await flush();
facts.treeAfterRemoval = tips();

const row = (key, ticked) => ({ key, name: key, tickable: true, ticked, disabled: false, state: { text: "idle", tone: "idle" }, note: null, why: null, title: "About " + key });
const model = (ticked) => ({
  header: { text: "Scan", changed: null }, scope: null, mode: { value: "bring", disabled: false }, report: null,
  rows: [row("alpha", ticked === "alpha"), row("beta", ticked === "beta")],
  reports: [], button: { scanning: false, label: "Scan", disabled: false }, planned: null, pending: false, mark: false,
});
const panel = buildScanPanelView({ tick() {}, setOnlyView() {}, run() {}, stop() {}, clearReport() {} });
document.body.append(panel.element);
panel.render(model("alpha"));
enter(panel.element.querySelector('[data-sensor="alpha"]'));
facts.scanOpen = tips();
panel.render(model("beta"));
await flush();
facts.scanAfterRerender = tips();

enter(panel.element.querySelector('[data-sensor="alpha"]'));
enter(panel.element.querySelector('[data-sensor="beta"]'));
facts.second = tips();
facts.secondText = document.querySelector(".scan-tip").textContent;

enter(panel.element.querySelector('[data-sensor="alpha"]'));
const moduleRow = document.createElement("div");
document.body.append(moduleRow);
attachModuleTip(moduleRow, { path: "pkg/b.py", description: null });
enter(moduleRow);
facts.mixed = [document.querySelectorAll(".module-tip").length, document.querySelectorAll(".scan-tip").length];

const rowA = document.createElement("div");
const rowB = document.createElement("div");
for (const [r, top, path] of [[rowA, 200, "pkg/a.py"], [rowB, 226, "pkg/b.py"]]) {
  r.style.cssText = "position:fixed;left:20px;width:200px;height:24px;top:" + top + "px";
  document.body.append(r);
  attachModuleTip(r, { path, description: "Long description that wraps across several lines of the tip box so it is tall." });
}
leave(moduleRow);
enter(rowA);
const tipA = document.querySelector(".module-tip");
const boxA = tipA.getBoundingClientRect();
const boxB = rowB.getBoundingClientRect();
facts.coversNext = boxA.top < boxB.bottom && boxA.bottom > boxB.top && boxA.left < boxB.right && boxA.right > boxB.left;
facts.tipInert = getComputedStyle(tipA).pointerEvents;
facts.hitIsRow = document.elementFromPoint(boxB.left + 5, boxB.top + 5) === rowB;
leave(rowA);
enter(rowB);
facts.afterMove = [tips(), document.querySelector(".module-tip .module-tip-path").textContent];
leave(rowB);
facts.afterLeave = tips();

document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(webkit === undefined)("the hover tip", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "hover-tip-look");
  }, scaledTimeout(180000));

  it("closes a tree row's tip when a re-render removes the row", () => {
    expect(f.treeOpen).toBe(1);
    expect(f.treeAfterRemoval).toBe(0);
  });

  it("closes a Scan panel row's tip when a re-render replaces the row", () => {
    expect(f.scanOpen).toBe(1);
    expect(f.scanAfterRerender).toBe(0);
  });

  it("keeps at most one tip open, across both kinds", () => {
    expect(f.second).toBe(1);
    expect(f.secondText).toBe("About beta");
    expect(f.mixed).toEqual([1, 0]);
  });

  it("never lets a tip take the pointer from the row under it", () => {
    expect(f.coversNext).toBe(true);
    expect(f.tipInert).toBe("none");
    expect(f.hitIsRow).toBe(true);
  });

  it("shows exactly one tip, for the row now under the pointer, and none after leaving", () => {
    expect(f.afterMove).toEqual([1, "pkg/b.py"]);
    expect(f.afterLeave).toBe(0);
  });
});
