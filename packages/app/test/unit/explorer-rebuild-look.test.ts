import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { collectFacts, FAKE_WORKER, here, webkit } from "../../src/look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, mountExplorer, scanHostOf } from ${JSON.stringify(here("../test/unit/look-support.ts"))};
import { fakeViews } from ${JSON.stringify(here("../test/unit/views-fake.ts"))};
import { fakeCommits } from ${JSON.stringify(here("commits-fake.ts"))};
import { fakeWindow } from ${JSON.stringify(here("window-fake.ts"))};
import { parseBranches, parseHistory, parsePullRequests } from "@recognizer/core";
${FAKE_WORKER}

const edge = (from, to, name) => ({ from, to, kind: "depends", line: 1, names: [name] });
const HASH = "1".repeat(64);
const before = ["app/hub.py", "lib/a.py", "lib/b.py", "lib/c.py", "lib/d.py"];
const after = ["app/hub.py", "lib/a.py", "lib/b.py", "lib/c.py"];
const scanOf = (ids) => ({
  commit: "cur1234",
  files: ids.map((path) => ({ path, hash: HASH })),
  modules: ids.map((id) => ({ id, kind: "module" })),
  edges: [edge("app/hub.py", "lib/a.py", "A"), edge("app/hub.py", "lib/b.py", "B"), edge("lib/a.py", "lib/c.py", "C")],
  foreign: [],
});
const cycle = { id: "cycle:a,c", kind: "cycle", severity: "warning", principle: "levelization", summary: "cycle of 2 modules", fix_pattern: "break-cycle", evidence: { modules: ["lib/a.py", "lib/c.py"], edges: [{ from: "lib/a.py", to: "lib/c.py" }, { from: "lib/c.py", to: "lib/a.py" }] } };
const style = { id: "style:b", kind: "style", severity: "warning", principle: "name-your-constants", summary: "magic numbers", evidence: { modules: ["lib/b.py"] } };
const doc = (ids, findings) => ({ findings_version: 1, sensor: { name: "structure", version: "1" }, commit: "cur1234", modified: false, settings: {}, inputs: Object.fromEntries(ids.map((id) => [id, HASH])), findings });
const loadedFor = (ids, findings) => loadedOf({ modules: ids, scans: [{ file: "scan.json", scan: scanOf(ids) }], findings: [doc(ids, findings)], sensors: [{ name: "structure", status: "ran" }] });
const make = (picks) => JSON.stringify({ schema_version: 4, description: "d", commit: "cur1234", steps: picks.map((module) => ({ kind: "pick", module })) }, null, 2) + "\\n";

const tick = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
const click = (node) => (node || (() => { throw new Error("null click, facts so far " + Object.keys(window.__facts || {}).join(",")); })()).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const clickSel = (sel) => { const n = q(sel); if (!n) throw new Error("missing " + sel); click(n); };
const typeInto = (input, value) => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); };
const host = document.createElement("div");
host.style.cssText = "width:1500px;height:800px;display:flex;flex-direction:column";
document.getElementById("content").append(host);
const q = (selector) => host.querySelector(selector);
const all = (selector) => [...host.querySelectorAll(selector)];

const SHA = (c) => c.repeat(40);
const commitsFake = () => fakeCommits({
  history: { branch: "main", ...parseHistory("") },
  branches: { defaultRef: "origin/main", total: 0, ...parseBranches("") },
  pullRequests: { status: "ok", detail: "", ...parsePullRequests("[]") },
});

let live = null;
function start(ids, findings, options = {}) {
  if (live) live.explorer.dispose();
  host.replaceChildren();
  const win = fakeWindow();
  const explorer = mountExplorer({ container: host, loaded: loadedFor(ids, findings), title: "demo", views: options.views || fakeViews({}), commits: options.commits || commitsFake(), windowPort: win, storage: { getItem: () => null, setItem: () => {} }, post: () => null, ...(options.carried ? { carried: options.carried } : {}) });
  live = { explorer, win };
  return live;
}

async function rebuild(from, ids, findings, options = {}) {
  const carried = from.explorer.carry();
  from.explorer.dispose();
  const next = start(ids, findings, { ...options, carried });
  await tick();
  return { ...next, carried };
}

async function select(id) {
  const folder = id.slice(0, id.lastIndexOf("/"));
  if (!q('.tree .row[data-path="' + id + '"]')) {
    clickSel('.tree .row[data-path="' + folder + '"] .name');
    await tick();
  }
  if (!q('.box[data-id="' + id + '"] .box-body')) {
    clickSel('.tree .row[data-path="' + id + '"] .reye');
    await tick();
  }
  if (!q('.box[data-id="' + id + '"] .box-body')) throw new Error("facts " + Object.keys(window.__facts).join(",") + " boxes " + all(".box").map((b) => b.dataset.id).join(",") + " rows " + all(".tree .row").map((r) => r.dataset.path).join(","));
  clickSel('.box[data-id="' + id + '"] .box-body');
  await tick();
}

(async () => {
  const facts = {};
  window.__facts = facts;

  {
    const first = start(before, []);
    await tick();
    const expandedRows = () => all('.tree .row[data-path^="lib/"]').length;
    const rowsBefore = expandedRows();
    clickSel('.tree .row[data-path="lib"] .name');
    await tick();
    const rowsOpen = expandedRows();
    typeInto(q(".find"), "a");
    click(all(".filters .toggle")[1]);
    await tick();
    const filterNow = { text: q(".find").value, pressed: all(".filters .toggle").map((b) => b.classList.contains("on") || b.getAttribute("aria-pressed") === "true") };
    const second = await rebuild(first, after, []);
    const filterAfter = { text: q(".find").value, pressed: all(".filters .toggle").map((b) => b.classList.contains("on") || b.getAttribute("aria-pressed") === "true") };
    clickSel(".filters .toggle:nth-of-type(2)");
    typeInto(q(".find"), "");
    await tick();
    facts.tree = { rowsBefore, rowsOpen, filterNow, filterAfter, rowsAfter: expandedRows() };
  }

  {
    const first = start(before, []);
    await tick();
    await select("app/hub.py");
    clickSel('.selection-bar [aria-label^="Dependencies"]');
    await tick();
    const panels = () => all(".inspector-panel");
    click(panels()[0].querySelector('.row[data-id="lib/a.py"][data-follow="uses"]').parentElement.querySelector(".follow"));
    await tick();
    const snap = (win) => ({ open: q(".inspector-open") !== null, tab: all(".itabs button.on").map((b) => b.textContent), panels: panels().length, published: win.last().inspector });
    facts.inspectorBefore = snap(first.win);
    const second = await rebuild(first, after, []);
    facts.inspectorAfter = snap(second.win);
  }

  {
    const views = fakeViews({ order: make(["app/hub.py", "lib/a.py"]) });
    const first = start(before, [], { views });
    await tick();
    clickSel(".view-list");
    click(all(".view-item")[0]);
    await tick();
    await select("app/hub.py");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true, cancelable: true }));
    await tick();
    const field = () => q(".note-bubble textarea");
    typeInto(field(), "half a thought");
    await tick();
    facts.noteBefore = { open: all(".note-layer:not([hidden]) .note-bubble").length, text: field() === null ? null : field().value };
    const second = await rebuild(first, after, [], { views });
    facts.noteAfter = { open: all(".note-layer:not([hidden]) .note-bubble").length, text: field() === null ? null : field().value, notes: JSON.parse(views.files.get("order")).notes ?? null, };
  }

  {
    const run = async (ids, findings, afterIds, afterFindings) => {
      const views = fakeViews({ order: make(["app/hub.py", "lib/a.py", "lib/c.py", "lib/b.py"]) });
      const first = start(ids, findings, { views });
      await tick();
      clickSel(".view-list");
      click(all(".view-item")[0]);
      await tick();
      clickSel(".rail-findings");
      await tick();
      click(all(".finding-group-head")[0]);
      await tick();
      clickSel(".findings-scope-canvas");
      await tick();
      clickSel(".finding-card-head");
      await tick();
      const snap = () => ({ groups: all(".finding-group.open").length, scoped: q(".findings-scope-canvas") && q(".findings-scope-canvas").getAttribute("aria-pressed"), focused: all(".finding-card.open").map((n) => n.dataset.id) });
      const beforeSnap = snap();
      const second = await rebuild(first, afterIds, afterFindings, { views });
      return { before: beforeSnap, after: snap() };
    };
    facts.findings = await run(before, [cycle, style], after, [cycle, style]);
    facts.findingsGone = await run(before, [cycle, style], after, [style]);
  }

  {
    const first = start(before, []);
    await tick();
    clickSel(".rail-scan");
    await tick();
    clickSel(".scan-run-mode-full");
    await tick();
    const pressed = () => q(".scan-run-mode-full") && q(".scan-run-mode-full").getAttribute("aria-pressed");
    const beforePressed = pressed();
    const second = await rebuild(first, after, []);
    clickSel(".rail-scan");
    await tick();
    facts.scanMode = { before: beforePressed, after: pressed(), panelOpen: q(".scan-panel") !== null };
  }

  {
    const commits = commitsFake();
    const first = start(before, [], { commits });
    await tick();
    clickSel(".rail-commits");
    await tick(100);
    const tabNamed = (name) => all(".commits-tab").find((t) => t.textContent === name);
    click(tabNamed("Pull requests"));
    await tick(100);
    clickSel(".commits-hide");
    await tick();
    const snap = () => ({ tab: all(".commits-tab.on, .commits-tab[aria-selected='true']").map((t) => t.textContent), hide: q(".commits-hide") && q(".commits-hide").getAttribute("aria-checked") });
    facts.commitsBefore = snap();
    const second = await rebuild(first, after, [], { commits });
    await tick(100);
    facts.commitsAfter = snap();
  }

  {
    const many = ["app/hub.py", ...Array.from({ length: 90 }, (_, i) => "big/f" + String(i).padStart(2, "0") + ".py")];
    const fewer = many.slice(0, 40);
    const run = async (afterIds) => {
      const first = start(many, []);
      await tick();
      clickSel('.tree .row[data-path="big"] .name');
      await tick();
      const rows = q(".tree .rows");
      rows.scrollTop = 300;
      await tick();
      const beforeTop = rows.scrollTop;
      await rebuild(first, afterIds, []);
      const next = q(".tree .rows");
      return { before: beforeTop, after: next.scrollTop, max: next.scrollHeight - next.clientHeight };
    };
    facts.scrollKept = await run(many);
    facts.scrollClamped = await run(fewer);
  }

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(webkit === undefined)(
  "an explorer rebuilt from a carried one",
  () => {
    let f = null as unknown as Facts;

    beforeAll(async () => {
      f = await collectFacts<Facts>(HARNESS, "explorer-rebuild");
    }, scaledTimeout(180000));

    it("keeps the expanded folders and the tree filter", () => {
      expect(f.tree.rowsOpen).toBeGreaterThan(f.tree.rowsBefore);
      expect(f.tree.filterNow.text).toBe("a");
      expect(f.tree.filterAfter).toEqual(f.tree.filterNow);
      expect(f.tree.rowsAfter).toBe(f.tree.rowsOpen - 1);
    });

    it("keeps the inspector, its tab and its trail", () => {
      expect(f.inspectorBefore.open).toBe(true);
      expect(f.inspectorBefore.panels).toBeGreaterThan(1);
      expect(f.inspectorAfter.open).toBe(true);
      expect(f.inspectorAfter.tab).toEqual(f.inspectorBefore.tab);
      expect(f.inspectorAfter.panels).toBe(f.inspectorBefore.panels);
      expect(f.inspectorBefore.published.open).toBe(true);
      expect(f.inspectorAfter.published).toEqual(f.inspectorBefore.published);
    });

    it("keeps an open note bubble and its unsaved text", () => {
      expect(f.noteBefore).toEqual({ open: 1, text: "half a thought" });
      expect(f.noteAfter.open).toBe(1);
      expect(f.noteAfter.text).toBe("half a thought");
      expect(f.noteAfter.notes).toBeNull();
    });

    it("keeps the findings panel state", () => {
      expect(f.findings.before.groups).toBe(1);
      expect(f.findings.before.scoped).toBe("true");
      expect(f.findings.before.focused).toHaveLength(1);
      expect(f.findings.after).toEqual(f.findings.before);
      expect(f.findingsGone.before.focused).toHaveLength(1);
      expect(f.findingsGone.after.focused).not.toContain(
        f.findingsGone.before.focused[0],
      );
    });

    it("keeps the scan results mode and the commits tab and filter", () => {
      expect(f.scanMode.before).toBe("true");
      expect(f.scanMode.after).toBe("true");
      expect(f.commitsBefore.hide).toBe("false");
      expect(f.commitsAfter).toEqual(f.commitsBefore);
    });

    it("restores a scrolled panel's offset after a rebuild, clamped to the new content", () => {
      expect(f.scrollKept.before).toBeGreaterThan(0);
      expect(f.scrollKept.after).toBe(f.scrollKept.before);
      expect(f.scrollClamped.after).toBeGreaterThan(0);
      expect(f.scrollClamped.after).toBeLessThanOrEqual(f.scrollClamped.max);
    });
  },
);
