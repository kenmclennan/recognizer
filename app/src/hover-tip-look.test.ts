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

const row = (key, ticked) => ({ key, name: key, tickable: true, ticked, disabled: false, state: { kind: "never-run" }, text: { icon: "circle-dashed", text: "never run" }, note: null, why: null, title: "About " + key });
const model = (ticked) => ({
  header: { text: "Scan", moved: null }, scope: null, mode: { value: "bring", disabled: false }, hint: null,
  freshness: { summary: { shape: "current", tone: "ok", icon: "circle-check", head: "Everything on the repository is current", line: "", bar: null } },
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

const removals = [];
const watch = new MutationObserver((records) => {
  for (const r of records) for (const n of r.removedNodes) if (n.classList && n.classList.contains("module-tip")) removals.push(1);
});
watch.observe(document.body, { childList: true });
const host = document.createElement("div");
document.body.append(host);
const make = (path, description) => {
  const r = document.createElement("div");
  r.style.cssText = "position:fixed;left:20px;width:200px;height:24px;top:300px";
  attachModuleTip(r, { path, description });
  return r;
};
const first = make("pkg/k.py", "Old text.");
host.append(first);
enter(first);
const tipNode = document.querySelector(".module-tip");
const second2 = make("pkg/k.py", "New text.");
host.replaceChildren(second2);
await flush();
enter(second2);
await flush();
facts.follow = {
  count: tips(),
  same: document.querySelector(".module-tip") === tipNode,
  removals: removals.length,
  text: tipNode.textContent,
};

const other = make("pkg/other.py", "Other.");
host.replaceChildren(other);
await flush();
facts.differentKey = tips();

const third = make("pkg/k.py", "Again.");
host.replaceChildren(third);
enter(third);
host.replaceChildren();
await flush();
facts.noReplacement = tips();

const fourth = make("pkg/k.py", "Four.");
host.append(fourth);
enter(fourth);
const decoy = make("pkg/decoy.py", "Decoy.");
const fifth = make("pkg/k.py", "Five.");
host.replaceChildren(decoy, fifth);
await flush();
facts.mixedFollow = [tips(), document.querySelector(".module-tip").textContent];
leave(fifth);
facts.leaveReplacement = tips();

const sixth = make("pkg/k.py", "Six.");
host.replaceChildren(sixth);
enter(sixth);
const seventh = make("pkg/k.py", "Seven.");
host.replaceChildren(seventh);
await flush();
seventh.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
facts.pointerdownReplacement = tips();
watch.disconnect();

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

  it("keeps a Scan panel row's tip open when a re-render replaces the row", () => {
    expect(f.scanOpen).toBe(1);
    expect(f.scanAfterRerender).toBe(1);
  });

  it("keeps the same tip node open when its anchor is replaced for the same key", () => {
    expect(f.follow.count).toBe(1);
    expect(f.follow.same).toBe(true);
    expect(f.follow.removals).toBe(0);
  });

  it("shows the replacement's own content in the followed tip", () => {
    expect(f.follow.text).toContain("New text.");
    expect(f.follow.text).not.toContain("Old text.");
  });

  it("closes the tip when the replacement is for a different key or there is none", () => {
    expect(f.differentKey).toBe(0);
    expect(f.noReplacement).toBe(0);
  });

  it("follows the same-key element when a different-key one is also present", () => {
    expect(f.mixedFollow).toEqual([1, expect.stringContaining("Five.")]);
  });

  it("closes the tip on mouseleave or pointerdown on the replacement", () => {
    expect(f.leaveReplacement).toBe(0);
    expect(f.pointerdownReplacement).toBe(0);
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
