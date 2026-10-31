import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, FAKE_WORKER, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { showExplorer } from ${JSON.stringify(here("explorer.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
import { fakeSensors } from ${JSON.stringify(here("sensors-fake.ts"))};
import { NO_RUN } from ${JSON.stringify(here("sensors-panel-model.ts"))};
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
const base = { modules: ids, scans: [{ file: "scan.python.json", scan }], policy: null, baseline: null, notices: [], blocking: null, findings: [], sensors: [] };
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
  const sensorsHost = {
    port: fake,
    scan: () => null,
    refresh: async () => {},
    state: { ticked: [], run: NO_RUN },
  };
  showExplorer(host, { ...base, ...loaded, sensors: status ?? [{ name: "alpha", status: "ran" }] }, "demo", () => {}, port, () => {}, null, undefined, { getItem: () => null, setItem: () => {} }, undefined, undefined, undefined, undefined, sensorsHost);
  await tick();
  const q = (selector) => host.querySelector(selector);
  const all = (selector) => [...host.querySelectorAll(selector)];
  const shown = (selector) => { const n = q(selector); return n !== null && getComputedStyle(n).display !== "none"; };
  if (picks !== null) {
    click(q(".view-list"));
    click(all(".view-item")[0]);
    await tick();
  }
  return { host, port, q, all, shown };
}

const cardText = (m) => m.all(".finding-card-text tspan").map((t) => t.textContent).join(" ");
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
    card: cardText(m),
    cardCount: m.all(".finding-card").length,
    cardWidth: Number(m.q(".finding-card-body").getAttribute("width")),
    cardLines: m.all(".finding-card-text tspan").map((t) => t.textContent),
  };
  press("j");
  await tick();
  facts.walked = { card: cardText(m), tone: m.q(".finding-card").getAttribute("class") };
  press("Escape");
  await tick();
  facts.cleared = { cards: m.all(".finding-card").length, dim: m.all(".dim").length, lit: m.all(".lit-violation, .lit-warning").length };

  click(m.q('.finding-row[data-id="rule-violation:a"]'));
  await tick();
  click(m.q('[data-action="finding-open"]'));
  await tick();
  facts.open = { tab: m.all(".itabs button.on").map((b) => b.textContent), selected: m.all(".box.selected").map((n) => n.dataset.id) };
  click(m.q('[data-action="finding-copy"]'));
  await tick();
  facts.copied = m.port.copied;

  click(m.q('.box[data-id="lib/c.py"] .box-body'));
  await tick();
  facts.canvasSelect = { cards: m.all(".finding-card").length, dim: m.all(".lit-violation").length };

  click(m.q('.finding-row[data-id="rule-violation:a"]'));
  await tick();
  click(m.q(".rail-files"));
  await tick();
  facts.switched = { cards: m.all(".finding-card").length };

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
  facts.staleClick = { sensors: stale.shown(".sensors-panel"), findings: stale.shown(".findings-panel") };

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
      "rail-sensors",
      "rail-findings",
    ]);
    expect(f.panel.badge).toBe("3");
    expect(f.panel.badgeClass).toContain("red");
    expect(f.panel.label).toContain("Findings");
    expect(f.panel.open).toBe(true);
    expect(f.panel.files).toBe(false);
    expect(f.panel.rows).toEqual(["rule-violation:a", "cycle:a,b", "style:c"]);
    expect(f.panel.cards).toBe(0);
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

  it("orients a clicked row: selects, lights the evidence, dims the rest and draws the card", () => {
    expect(f.oriented.selected).toEqual(["app/a.py"]);
    expect(f.oriented.litBoxes).toEqual(["app/a.py", "app/b.py"]);
    expect(f.oriented.litLines).toBe(1);
    expect(f.oriented.dimmed).toEqual(["lib/c.py"]);
    expect(f.oriented.cardCount).toBe(1);
    expect(f.oriented.cardWidth).toBe(420);
    expect(
      f.oriented.cardLines.every((line: string) => line.length <= 56),
    ).toBe(true);
    expect(f.oriented.card).toContain("rule-violation - structure");
    expect(f.oriented.card).toContain("a.py -> app/b.py at line 4");
    expect(f.oriented.card).toContain("Principle:");
  });

  it("walks with j and clears with Escape", () => {
    expect(f.walked.card).toContain("cycle - structure");
    expect(f.walked.card).toContain("Fix: break-cycle");
    expect(f.walked.tone).toContain("warning");
    expect(f.cleared).toEqual({ cards: 0, dim: 0, lit: 0 });
  });

  it("opens the inspector's Findings tab and copies the id from the card", () => {
    expect(f.open.selected).toEqual(["app/a.py"]);
    expect(f.open.tab[0]).toMatch(/^Findings/);
    expect(f.copied).toEqual(["rule-violation:a"]);
  });

  it("clears the orientation on a canvas selection or a panel switch", () => {
    expect(f.canvasSelect).toEqual({ cards: 0, dim: 0 });
    expect(f.switched.cards).toBe(0);
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
    expect(f.offCanvas).toEqual({ box: 1, card: 1 });
  });
});
