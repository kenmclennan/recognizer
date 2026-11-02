import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, FAKE_WORKER, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { showExplorer } from ${JSON.stringify(here("explorer.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
import { fakeEditor } from ${JSON.stringify(here("editor-fake.ts"))};
import { fakeSensors } from ${JSON.stringify(here("sensors-fake.ts"))};
import { NO_RUN } from ${JSON.stringify(here("scan-panel-model.ts"))};
${FAKE_WORKER}
const plainWorker = window.__fakeWorker;
window.__fakeWorker = () => {
  const inner = plainWorker();
  return {
    addEventListener: (type, listener) => inner.addEventListener(type, (event) => {
      const route = (node) => {
        for (const edge of node.edges || []) edge.sections = [{ startPoint: { x: 10, y: 10 }, endPoint: { x: 110, y: 90 } }];
        for (const child of node.children || []) route(child);
      };
      route(event.data.data);
      listener(event);
    }),
    postMessage: (request) => inner.postMessage(request),
  };
};

const ids = ["app/a.py", "app/b.py", "lib/c.py"];
const scan = {
  commit: "cur1234",
  modules: ids.map((id) => ({ id, kind: "module" })),
  edges: [{ from: ids[0], to: ids[1], kind: "depends", line: 4, names: ["X"] }],
  foreign: [],
};
const violation = { id: "rule-violation:a", kind: "rule-violation", severity: "violation", principle: "dependencies-follow-the-policy", summary: "depends on app/b.py at line 4", evidence: { modules: [ids[0]], edges: [{ from: ids[0], to: ids[1], kind: "depends", lines: [4] }] } };
const cycle = { id: "cycle:a,b", kind: "cycle", severity: "warning", principle: "no-cycles", summary: "cycle of 2 modules", fix_pattern: "break-cycle", evidence: { modules: [ids[0], ids[1]], edges: [{ from: ids[0], to: ids[1] }, { from: ids[1], to: ids[0] }] } };
const style = { id: "style:c", kind: "style", severity: "warning", principle: "name-your-constants", summary: "magic numbers", evidence: { modules: [ids[2]] } };
const doc = (name, findings, commit = "cur1234") => ({ findings_version: 1, sensor: { name, version: "1" }, commit, modified: false, settings: {}, findings });
const base = { modules: ids, scans: [{ file: "scan.python.json", scan }], policy: null, baseline: null, notices: [], blocking: null, findings: [], sensors: [], folderMetrics: [] };
const CONFIG = "sensors:\\n  alpha:\\n    command: [node, '{repository}/a.mjs', '{commit}', '{output}']\\n";
const make = (picks) => JSON.stringify({ schema_version: 1, description: "d", commit: "cur1234", steps: picks.map((module) => ({ kind: "pick", module })) }, null, 2) + "\\n";

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const press = (key) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

async function mount(loaded, picks, status) {
  const host = document.createElement("div");
  host.style.cssText = "width:1400px;height:800px;display:flex;flex-direction:column";
  document.body.append(host);
  const port = fakeViews(picks === null ? {} : { order: make(picks) });
  const fake = fakeSensors({}, { config: CONFIG });
  const editor = fakeEditor();
  const counts = [];
  const scanHost = {
    port: fake,
    scan: () => null,
    ticks: () => ({ describe: false, sensors: false, ticked: null }),
    setTicks: () => {},
    runState: () => NO_RUN,
    running: () => false,
    run: () => {},
    stop: () => {},
  };
  showExplorer(host, { ...base, ...loaded, sensors: status ?? [{ name: "alpha", status: "ran" }] }, "demo", (text) => counts.push(text), port, () => {}, null, undefined, { getItem: () => null, setItem: () => {} }, editor, undefined, undefined, undefined, scanHost);
  await tick();
  const q = (selector) => host.querySelector(selector);
  const all = (selector) => [...host.querySelectorAll(selector)];
  const shown = (selector) => { const n = q(selector); return n !== null && getComputedStyle(n).display !== "none"; };
  if (picks !== null) {
    click(q(".view-list"));
    click(all(".view-item")[0]);
    await tick();
  }
  return { host, port, q, all, shown, editor, counts };
}

const texts = (m, selector) => m.all(selector).map((n) => n.textContent);
const dimBoxes = (m) => m.all(".box.dim").map((n) => n.dataset.id).sort();

(async () => {
  const facts = {};

  const m = await mount({ findings: [doc("structure", [cycle, violation]), doc("lint", [style])] }, ["app/a.py", "app/b.py", "lib/c.py"]);
  click(m.q(".rail-findings"));
  await tick();
  facts.panel = {
    order: m.all(".rail button").map((b) => b.className.split(" ")[1]),
    badge: m.q(".rail-findings .rail-count").textContent,
    badgeClass: m.q(".rail-findings .rail-count").className,
    label: getComputedStyle(m.q(".rail-findings"), "::after").content,
    open: m.shown(".findings-panel"),
    files: m.shown(".tree-header"),
    rows: m.all(".finding-row").map((r) => r.dataset.id),
    firstRow: { file: m.q(".finding-row .finding-file").textContent, folder: m.q(".finding-row .finding-folder").textContent, sensor: m.q(".finding-row .finding-sensor").textContent, principle: m.q(".finding-row .finding-principle").textContent },
    chips: m.all(".findings-chip").map((c) => c.textContent),
    titles: m.all(".finding-severity-title, .finding-group-title").map((n) => n.textContent),
    stale: m.shown(".findings-stale"),
    cards: m.all(".finding-card").length,
    expanded: m.all(".finding-detail").length,
  };

  click(m.all(".findings-chip")[1]);
  await tick();
  facts.violationsOnly = m.all(".finding-row").map((r) => r.dataset.id);
  click(m.all(".findings-chip")[0]);
  await tick();

  click(m.q('.finding-row[data-id="rule-violation:a"]'));
  await tick();
  facts.oriented = {
    selected: m.all(".box.selected").map((n) => n.dataset.id),
    litBoxes: m.all(".box.lit-violation").map((n) => n.dataset.id).sort(),
    litLines: m.all(".line-group.lit-violation").length,
    dimmed: dimBoxes(m),
    cards: m.all(".finding-card").length,
    expanded: m.all(".finding-entry.focused").length,
    evidence: texts(m, ".finding-detail .finding-evidence"),
    fix: texts(m, ".finding-detail .finding-fix"),
    buttons: texts(m, ".finding-detail-buttons button"),
  };
  click(m.q(".finding-edit"));
  await tick();
  click(m.q(".finding-id"));
  await tick();
  facts.actions = { opened: m.editor.opened, copied: m.port.copied };

  click(m.q('.box[data-id="app/b.py"] .box-body'));
  await tick();
  facts.keptOnEvidence = { expanded: m.all(".finding-entry.focused").length, lit: m.all(".box.lit-violation").length, dim: m.all(".box.dim").length };
  click(m.q('.box[data-id="lib/c.py"] .box-body'));
  await tick();
  facts.droppedOnOther = { expanded: m.all(".finding-entry.focused").length, lit: m.all(".lit-violation, .lit-warning").length };

  press("j");
  await tick();
  press("j");
  await tick();
  facts.walked = { expanded: texts(m, ".finding-entry.focused .finding-fix"), id: m.q(".finding-entry.focused .finding-row").dataset.id };
  press("Escape");
  await tick();
  facts.cleared = { expanded: m.all(".finding-entry.focused").length, dim: m.all(".dim").length, lit: m.all(".lit-violation, .lit-warning").length };

  click(m.q('.finding-row[data-id="rule-violation:a"]'));
  await tick();
  click(m.q(".rail-files"));
  await tick();
  facts.switched = { lit: m.all(".box.lit-violation").length };
  click(m.q(".rail-findings"));
  await tick();
  click(m.q('.finding-row[data-id="rule-violation:a"]'));
  await tick();
  facts.collapsedAgain = { expanded: m.all(".finding-entry.focused").length, lit: m.all(".lit-violation, .lit-warning").length };

  const bar = await mount({ findings: [doc("structure", [cycle, violation]), doc("lint", [style])] }, ["app/a.py", "app/b.py", "lib/c.py"]);
  click(bar.q('.box[data-id="app/a.py"] .box-body'));
  await tick();
  const findingsButton = () => bar.q('.selection-bar .bar-button[title="Findings (W)"]');
  facts.bar = { present: findingsButton() !== null, text: findingsButton().textContent, cls: findingsButton().className, order: bar.all(".selection-bar .bar-button").map((b) => b.title).slice(0, 3) };
  click(findingsButton());
  await tick();
  facts.barTab = { tab: texts(bar, ".itabs button.on"), rows: bar.all(".inspector-panel .finding-row").map((r) => r.dataset.id), on: findingsButton().className };
  click(bar.q('.inspector-panel .finding-row[data-id="cycle:a,b"]'));
  await tick();
  facts.tabFocus = { detail: bar.all(".inspector-panel .finding-detail").length, lit: bar.all(".box.lit-warning").map((n) => n.dataset.id).sort(), evidence: texts(bar, ".inspector-panel .finding-evidence") };
  click(bar.q('.box[data-id="lib/c.py"] .box-body'));
  await tick();
  facts.barWarn = findingsButton().className;
  const quiet = await mount({ findings: [doc("lint", [style])] }, ["app/a.py", "app/b.py", "lib/c.py"]);
  click(quiet.q('.box[data-id="app/a.py"] .box-body'));
  await tick();
  facts.barQuiet = { present: quiet.q('.selection-bar .bar-button[title="Findings (W)"]') !== null };
  click(quiet.q('.box[data-id="lib/c.py"] .box-body'));
  await tick();
  press("w");
  await tick();
  facts.keyW = texts(quiet, ".itabs button.on");

  const ghost = await mount({ findings: [doc("structure", [violation])] }, ["app/a.py"]);
  const before = ghost.counts.at(-1);
  const savedBefore = ghost.port.files.size;
  click(ghost.q('.finding-row[data-id="rule-violation:a"]'));
  await tick();
  const ghostBox = ghost.q(".ghost");
  facts.ghost = {
    count: ghost.all(".ghost").length,
    dashed: getComputedStyle(ghost.q(".ghost .ghost-body")).strokeDasharray,
    lit: ghostBox.getAttribute("class"),
    selectable: ghost.all(".ghost [data-id]").length,
    button: texts(ghost, ".ghost-add"),
    boxes: ghost.all(".box").length,
    footerSame: ghost.counts.at(-1) === before,
  };
  click(ghost.q(".ghost-add"));
  await tick();
  await tick();
  facts.ghostAdded = { ghosts: ghost.all(".ghost").length, box: ghost.all('.box[data-id="app/b.py"]').length, expanded: ghost.all(".finding-entry.focused").length, saved: ghost.port.files.size - savedBefore };
  const away = await mount({ findings: [doc("structure", [violation])] }, ["app/a.py"]);
  click(away.q('.finding-row[data-id="rule-violation:a"]'));
  await tick();
  click(away.q('.finding-row[data-id="rule-violation:a"]'));
  await tick();
  facts.ghostCleared = { ghosts: away.all(".ghost").length, box: away.all('.box[data-id="app/b.py"]').length, buttons: away.all(".ghost-add").length };

  const off = await mount({ findings: [doc("lint", [style])] }, ["app/a.py", "app/b.py"]);
  click(off.q(".rail-findings"));
  await tick();
  click(off.q(".finding-row"));
  await tick();
  facts.offCanvas = { box: off.all('.box[data-id="lib/c.py"]').length, card: off.all(".finding-card").length };

  const warn = await mount({ findings: [doc("lint", [style])] }, null);
  facts.warnings = { class: warn.q(".rail-findings .rail-count").className, hidden: warn.q(".rail-findings .rail-count").hidden };
  const none = await mount({ findings: [] }, null);
  click(none.q(".rail-findings"));
  await tick();
  facts.none = { hidden: none.q(".rail-findings .rail-count").hidden, empty: none.q(".findings-empty").textContent, rows: none.all(".finding-row").length };

  const other = await mount({ findings: [doc("structure", [violation], "other")] }, null);
  click(other.q(".rail-findings"));
  await tick();
  facts.otherCommit = { rows: other.all(".finding-row").length, hidden: other.q(".rail-findings .rail-count").hidden };

  const stale = await mount({ findings: [doc("structure", [violation])] }, null, [{ name: "alpha", status: "stale" }]);
  click(stale.q(".rail-findings"));
  await tick();
  facts.stale = { text: stale.q(".findings-stale").textContent, shown: stale.shown(".findings-stale") };
  click(stale.q(".findings-stale"));
  await tick();
  facts.staleClick = { sensors: stale.shown(".scan-panel"), findings: stale.shown(".findings-panel") };

  const fresh = await mount({ findings: [doc("structure", [violation])] }, null, [{ name: "alpha", status: "ran" }]);
  click(fresh.q(".rail-findings"));
  await tick();
  facts.fresh = { shown: fresh.shown(".findings-stale") };

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(chrome === undefined)("the Findings panel", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "findings-panel");
  }, 180000);

  it("sits last on the rail with a red count and lists violations before warnings", () => {
    expect(f.panel.order).toEqual([
      "rail-files",
      "rail-notes",
      "rail-scan",
      "rail-findings",
    ]);
    expect(f.panel.badge).toBe("3");
    expect(f.panel.badgeClass).toContain("red");
    expect(f.panel.label).toContain("Findings");
    expect(f.panel.open).toBe(true);
    expect(f.panel.files).toBe(false);
    expect(f.panel.rows).toEqual(["rule-violation:a", "cycle:a,b", "style:c"]);
    expect(f.panel.cards).toBe(0);
    expect(f.panel.expanded).toBe(0);
    expect(f.panel.stale).toBe(false);
    expect(f.panel.titles).toEqual([
      "Violations 1",
      "Rule violation 1",
      "Warnings 2",
      "Cycle 1",
      "Style 1",
    ]);
  });

  it("shows the file name, folder, principle and sensor on a row", () => {
    expect(f.panel.firstRow).toEqual({
      file: "a.py",
      folder: "app",
      sensor: "structure",
      principle: "dependencies-follow-the-policy",
    });
  });

  it("offers a chip per severity and sensor and narrows by it", () => {
    expect(f.panel.chips).toEqual([
      "all 3",
      "violations 1",
      "warnings 2",
      "lint 1",
      "structure 2",
    ]);
    expect(f.violationsOnly).toEqual(["rule-violation:a"]);
  });

  it("orients a clicked row: selects, lights the evidence, dims the rest and expands in place", () => {
    expect(f.oriented.selected).toEqual(["app/a.py"]);
    expect(f.oriented.litBoxes).toEqual(["app/a.py", "app/b.py"]);
    expect(f.oriented.litLines).toBe(1);
    expect(f.oriented.dimmed).toEqual(["lib/c.py"]);
    expect(f.oriented.cards).toBe(0);
    expect(f.oriented.expanded).toBe(1);
    expect(f.oriented.evidence).toEqual(["app/a.py -> app/b.py at line 4"]);
    expect(f.oriented.fix).toEqual(["no fix pattern recorded"]);
    expect(f.oriented.buttons).toEqual(["Open in editor", "Copy id"]);
  });

  it("opens the evidence line in the editor and copies the id", () => {
    expect(f.actions.opened).toEqual([{ file: "app/a.py", line: 4 }]);
    expect(f.actions.copied).toEqual(["rule-violation:a"]);
  });

  it("keeps the focus on a click inside the evidence and drops it on any other", () => {
    expect(f.keptOnEvidence.expanded).toBe(1);
    expect(f.keptOnEvidence.lit).toBe(2);
    expect(f.keptOnEvidence.dim).toBe(1);
    expect(f.droppedOnOther).toEqual({ expanded: 0, lit: 0 });
  });

  it("walks with j and clears with Escape", () => {
    expect(f.walked.id).toBe("cycle:a,b");
    expect(f.walked.expanded).toEqual(["break-cycle"]);
    expect(f.cleared).toEqual({ expanded: 0, dim: 0, lit: 0 });
  });

  it("keeps the focus over a panel switch and clears it on clicking the focused row", () => {
    expect(f.switched.lit).toBe(2);
    expect(f.collapsedAgain).toEqual({ expanded: 0, lit: 0 });
  });

  it("shows the selection bar's findings button in the disc's colour, after dependencies, and opens the tab", () => {
    expect(f.bar.present).toBe(true);
    expect(f.bar.text).toBe("2");
    expect(f.bar.cls).toContain("findings-red");
    expect(f.bar.order).toEqual([
      "Dependencies (D)",
      "Notes (N)",
      "Findings (W)",
    ]);
    expect(f.barTab.tab[0]).toMatch(/^Findings/);
    expect(f.barTab.rows).toEqual(["rule-violation:a", "cycle:a,b"]);
    expect(f.barTab.on).toContain("on");
    expect(f.barWarn).toContain("findings-amber");
    expect(f.barQuiet.present).toBe(false);
    expect(f.keyW[0]).toMatch(/^Findings/);
  });

  it("focuses a finding from the inspector's tab exactly as the panel does", () => {
    expect(f.tabFocus.detail).toBe(1);
    expect(f.tabFocus.lit).toEqual(["app/a.py", "app/b.py"]);
    expect(f.tabFocus.evidence).toEqual([
      "app/a.py -> app/b.py",
      "app/b.py -> app/a.py",
    ]);
  });

  it("draws a dashed ghost for evidence off the view, with an Add button that makes it a box", () => {
    expect(f.ghost.count).toBe(1);
    expect(f.ghost.dashed).not.toBe("none");
    expect(f.ghost.lit).toContain("lit-violation");
    expect(f.ghost.selectable).toBe(0);
    expect(f.ghost.button).toEqual(["Add b.py to the view"]);
    expect(f.ghost.boxes).toBe(1);
    expect(f.ghost.footerSame).toBe(true);
    expect(f.ghostAdded).toEqual({ ghosts: 0, box: 1, expanded: 1, saved: 0 });
  });

  it("removes a ghost that was not added when the focus clears", () => {
    expect(f.ghostCleared).toEqual({ ghosts: 0, box: 0, buttons: 0 });
  });

  it("shows amber for warnings only, hides the badge at zero and ignores another commit", () => {
    expect(f.warnings.class).toContain("amber");
    expect(f.warnings.hidden).toBe(false);
    expect(f.none).toEqual({
      hidden: true,
      empty: "No findings for this scan.",
      rows: 0,
    });
    expect(f.otherCommit).toEqual({ rows: 0, hidden: true });
  });

  it("names a stale sensor and links to the Sensors panel; none when all ran", () => {
    expect(f.stale.text).toBe("Not current: alpha (stale)");
    expect(f.staleClick).toEqual({ sensors: true, findings: false });
    expect(f.fresh.shown).toBe(false);
  });

  it("puts a finding's module on the canvas when it is not there", () => {
    expect(f.offCanvas).toEqual({ box: 1, card: 0 });
  });
});
