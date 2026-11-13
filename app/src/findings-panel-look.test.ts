import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import groupFile from "./finding-groups.json";
import { collectFacts, FAKE_WORKER, here, webkit } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, scanHostOf, mountExplorer } from ${JSON.stringify(here("look-support.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
import { fakeEditor } from ${JSON.stringify(here("editor-fake.ts"))};
import { fakeSensors } from ${JSON.stringify(here("sensors-fake.ts"))};
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
const longName = "a-very-long-module-name-".repeat(5) + "x.py";
const everyModule = [...ids, "app/" + longName];
const HASH = "1".repeat(64);
const scan = {
  commit: "cur1234",
  files: everyModule.map((id) => ({ path: id, hash: HASH })),
  modules: ids.map((id) => ({ id, kind: "module" })),
  edges: [{ from: ids[0], to: ids[1], kind: "depends", line: 4, names: ["X"] }],
  foreign: [],
};
const violation = { id: "rule-violation:a", kind: "rule-violation", severity: "violation", principle: "dependency-inversion-principle", summary: "depends on app/b.py at line 4", evidence: { modules: [ids[0]], edges: [{ from: ids[0], to: ids[1], kind: "depends", lines: [4], rules: [{ type: "level", from_level: "domain", to_level: "adapters" }] }] } };
const cycle = { id: "cycle:a,b", kind: "cycle", severity: "warning", principle: "levelization", summary: "cycle of 2 modules", fix_pattern: "break-cycle", evidence: { modules: [ids[0], ids[1]], edges: [{ from: ids[0], to: ids[1] }, { from: ids[1], to: ids[0] }] } };
const style = { id: "style:c", kind: "style", severity: "warning", principle: "name-your-constants", summary: "magic numbers", evidence: { modules: [ids[2]] } };
const longOne = { id: "orphan:long", kind: "orphan", severity: "warning", principle: "p", summary: "s", evidence: { modules: ["app/" + longName] } };
const longReport = { id: "note:long", kind: "note", severity: "warning", principle: "p", summary: "This is a long agent sentence that has to wrap at word boundaries inside a narrow panel and never be cut at the edge of it. ".repeat(3), evidence: { modules: [ids[2]] } };
const doc = (name, findings, commit = "cur1234") => ({ findings_version: 1, sensor: { name, version: "1" }, commit, modified: false, settings: {}, inputs: Object.fromEntries(everyModule.map((id) => [id, commit === "cur1234" ? HASH : "0".repeat(64)])), findings });
const base = loadedOf({ modules: ids, scans: [{ file: "scan.python.json", scan }] });
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
  const runs = [];
  const scanHost = scanHostOf({ port: fake, run: (modules, planned) => runs.push({ modules, planned }) });
  mountExplorer({ container: host, loaded: { ...base, ...loaded, sensors: status ?? [{ name: "alpha", status: "ran" }] }, title: "demo", onCount: (text) => counts.push(text), views: port, post: () => null, storage: { getItem: () => null, setItem: () => {} }, editor, scanHost });
  await tick();
  const q = (selector) => host.querySelector(selector);
  const all = (selector) => [...host.querySelectorAll(selector)];
  const shown = (selector) => { const n = q(selector); return n !== null && getComputedStyle(n).display !== "none"; };
  if (picks !== null) {
    click(q(".view-list"));
    click(all(".view-item")[0]);
    await tick();
  }
  return { host, port, q, all, shown, editor, counts, runs };
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
    heading: m.q(".findings-header").firstChild.textContent,
    fresh: m.q(".findings-fresh-text") === null ? null : m.q(".findings-fresh-text").textContent,
    line: m.q(".findings-line").textContent,
    chips: m.all(".findings-chip").length,
    groups: texts(m, ".finding-group-name"),
    counts: texts(m, ".finding-group-count"),
    marks: m.all(".finding-group-head .finding-mark").map((n) => n.className.split(" ")[1]),
    cards: m.all(".finding-card").length,
    freshShown: m.shown(".findings-fresh"),
    ghosts: m.all(".ghost, .ghost-add").length,
  };

  {
    const lines = m.all(".finding-group-line");
    const withIcon = lines[0];
    const withoutIcon = lines[2];
    const info = withIcon.querySelector(".finding-info");
    const tip = document.getElementById(info.getAttribute("aria-describedby"));
    const css = getComputedStyle(document.documentElement);
    const tipStyle = () => getComputedStyle(tip);
    const rect = info.querySelector("svg").getBoundingClientRect();
    const probe = (name) => { const n = document.createElement("span"); n.style.color = "var(" + name + ")"; document.body.append(n); const c = getComputedStyle(n).color; n.remove(); return c; };
    facts.info = {
      icons: m.all(".finding-group-line .finding-info").length,
      svg: info.querySelectorAll("svg").length,
      text: info.textContent,
      width: rect.width,
      height: rect.height,
      restColor: getComputedStyle(info).color,
      faint: probe("--faint"),
      noneOnReported: withoutIcon.querySelectorAll(".finding-info").length,
      sameHeight: withIcon.getBoundingClientRect().height === withoutIcon.getBoundingClientRect().height,
      label: info.getAttribute("aria-label"),
      role: tip.getAttribute("role"),
      hiddenAtRest: tipStyle().display === "none",
    };
    info.focus();
    await tick();
    const lineTexts = [...tip.querySelectorAll(".finding-tip-line")].map((n) => n.textContent);
    facts.info.focused = {
      shown: tipStyle().display !== "none",
      lines: lineTexts,
      background: tipStyle().backgroundColor,
      box: probe("--box"),
      border: tipStyle().borderTopColor,
      boxline: probe("--boxline"),
      color: tipStyle().color,
      fg: probe("--fg"),
      focusColor: getComputedStyle(info).color,
      sel: probe("--sel"),
    };
    info.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();
    facts.info.escaped = { hidden: tipStyle().display === "none", focused: document.activeElement === info };
    info.blur();
    info.focus();
    await tick();
    facts.info.refocused = tipStyle().display !== "none";
    info.blur();
    await tick();
    facts.info.blurred = tipStyle().display === "none";
    const open = () => m.all(".finding-group.open").length;
    const before = { open: open(), expanded: withIcon.querySelector(".finding-group-head").getAttribute("aria-expanded") };
    click(info);
    await tick();
    facts.info.clickIcon = { same: open() === before.open, expanded: m.all(".finding-group-line")[0].querySelector(".finding-group-head").getAttribute("aria-expanded") === before.expanded };
    click(m.all(".finding-group-line")[0].querySelector(".finding-group-count"));
    await tick();
    facts.info.clickCount = open();
    click(m.all(".finding-group-line")[0].querySelector(".finding-group-name"));
    await tick();
    facts.info.clickName = open();
  }

  click(m.all(".finding-group-head")[0]);
  await tick();
  facts.card = {
    groupsOpen: m.all(".finding-group.open").length,
    cards: m.all(".finding-card").length,
    name: m.q(".finding-card .finding-name").textContent,
    folder: m.q(".finding-card .finding-folder").textContent,
    sentence: m.q(".finding-card .finding-sentence").textContent,
    weight: getComputedStyle(m.q(".finding-card .finding-name")).fontWeight,
    extras: m.all(".finding-card .finding-principle, .finding-card .finding-sensor, .finding-card .finding-edit, .finding-card .finding-id").length,
    text: m.q(".finding-card").textContent,
  };

  click(m.all(".finding-group-head")[1]);
  await tick();
  const boxesBefore = m.all(".box").map((n) => n.dataset.id).sort();
  click(m.q('.finding-card[data-id="rule-violation:a"] .finding-card-head'));
  await tick();
  facts.oriented = {
    selected: m.all(".box.selected").map((n) => n.dataset.id),
    inspector: m.q(".explorer").classList.contains("inspector-open"),
    boxesSame: JSON.stringify(m.all(".box").map((n) => n.dataset.id).sort()) === JSON.stringify(boxesBefore),
    litBoxes: m.all(".box.lit-violation").map((n) => n.dataset.id).sort(),
    litLines: m.all(".line-group.lit-violation").length,
    dimmed: dimBoxes(m),
    open: m.all(".finding-card.open").length,
    rows: texts(m, ".finding-card.open .finding-item"),
    adds: m.all(".finding-card.open .finding-add").length,
  };

  click(m.q('.finding-card[data-id="cycle:a,b"] .finding-card-head'));
  await tick();
  facts.one = { open: m.all(".finding-card.open").map((n) => n.dataset.id), rows: texts(m, ".finding-card.open .finding-item") };

  click(m.q('.box[data-id="app/b.py"] .box-body'));
  await tick();
  facts.keptOnEvidence = { open: m.all(".finding-card.open").length, lit: m.all(".box.lit-warning").length, dim: m.all(".box.dim").length };
  click(m.q('.box[data-id="lib/c.py"] .box-body'));
  await tick();
  facts.droppedOnOther = { open: m.all(".finding-card.open").length, lit: m.all(".lit-violation, .lit-warning").length };

  press("j");
  await tick();
  facts.walkedFirst = { id: m.q(".finding-card.open")?.dataset.id ?? null };
  press("j");
  await tick();
  press("j");
  await tick();
  facts.walked = { id: m.q(".finding-card.open")?.dataset.id ?? null, groupOpen: m.all(".finding-group.open").length };
  press("k");
  await tick();
  facts.walkedBack = { id: m.q(".finding-card.open")?.dataset.id ?? null };
  press("Escape");
  await tick();
  facts.cleared = { open: m.all(".finding-card.open").length, dim: m.all(".dim").length, lit: m.all(".lit-violation, .lit-warning").length };

  click(m.q('.finding-card[data-id="rule-violation:a"] .finding-card-head'));
  await tick();
  click(m.q(".rail-files"));
  await tick();
  facts.switched = { lit: m.all(".box.lit-violation").length };
  click(m.q(".rail-findings"));
  await tick();
  click(m.q('.finding-card[data-id="rule-violation:a"] .finding-card-head'));
  await tick();
  facts.closedAgain = { open: m.all(".finding-card.open").length, lit: m.all(".lit-violation, .lit-warning").length };

  const bar = await mount({ findings: [doc("structure", [cycle, violation]), doc("lint", [style])] }, ["app/a.py", "app/b.py", "lib/c.py"]);
  click(bar.q('.box[data-id="app/a.py"] .box-body'));
  await tick();
  const findingsButton = () => bar.q('.selection-bar .bar-button[title="Findings (W)"]');
  facts.bar = { present: findingsButton() !== null, text: findingsButton().textContent, cls: findingsButton().className, order: bar.all(".selection-bar .bar-button").map((b) => b.title).slice(0, 3) };
  click(findingsButton());
  await tick();
  facts.barTab = { tab: texts(bar, ".itabs button.on"), groups: texts(bar, ".inspector-panel .finding-group-name"), counts: texts(bar, ".inspector-panel .finding-group-count"), closed: bar.all(".inspector-panel .finding-card").length, on: findingsButton().className, icons: bar.all(".inspector-panel .finding-group-line .finding-info svg").length };
  click(bar.q(".inspector-panel .finding-group-head"));
  await tick();
  facts.barOpened = { groups: bar.all(".inspector-panel .finding-group.open").length, cards: bar.all(".inspector-panel .finding-card").map((r) => r.dataset.id), name: bar.q(".inspector-panel .finding-card .finding-name").textContent, folder: bar.q(".inspector-panel .finding-card .finding-folder").textContent, panelGroupsOpen: bar.all(".findings-panel .finding-group.open").length };
  click(bar.all(".inspector-panel .finding-group-head")[1]);
  await tick();
  click(bar.q('.inspector-panel .finding-card[data-id="cycle:a,b"] .finding-card-head'));
  await tick();
  facts.tabFocus = { open: bar.all(".inspector-panel .finding-card.open").length, lit: bar.all(".box.lit-warning").map((n) => n.dataset.id).sort(), rows: texts(bar, ".inspector-panel .finding-card.open .finding-item"), selected: bar.all(".box.selected").map((n) => n.dataset.id) };
  click(bar.q('.box[data-id="lib/c.py"] .box-body'));
  await tick();
  facts.barWarn = findingsButton().className;
  const tree = await mount({ findings: [doc("structure", [cycle, violation]), doc("lint", [style])] }, ["app/a.py", "app/b.py", "lib/c.py"]);
  const folderBox = tree.q('.frame-label[data-kind="folder"][data-id="app"]');
  facts.folderBoxFound = folderBox !== null;
  if (folderBox) {
    click(folderBox);
    await tick();
    click(tree.q('.selection-bar .bar-button[title="Findings (W)"]'));
    await tick();
    facts.folderTab = { groups: texts(tree, ".inspector-panel .finding-group-name"), headings: tree.all(".inspector-panel .lnk").length };
    for (const head of tree.all(".inspector-panel .finding-group-head")) click(head);
    await tick();
    facts.folderCards = { names: texts(tree, ".inspector-panel .finding-card .finding-name"), groupsOpen: tree.all(".inspector-panel .finding-group.open").length };
  }
  const quiet = await mount({ findings: [doc("lint", [style])] }, ["app/a.py", "app/b.py", "lib/c.py"]);
  click(quiet.q('.box[data-id="app/a.py"] .box-body'));
  await tick();
  facts.barQuiet = { present: quiet.q('.selection-bar .bar-button[title="Findings (W)"]') !== null };
  click(quiet.q('.box[data-id="lib/c.py"] .box-body'));
  await tick();
  press("w");
  await tick();
  facts.keyW = texts(quiet, ".itabs button.on");

  const adder = await mount({ findings: [doc("structure", [cycle])] }, ["app/a.py"]);
  const savedBefore = adder.port.files.size;
  click(adder.q(".rail-findings"));
  await tick();
  click(adder.q(".finding-group-head"));
  await tick();
  click(adder.q(".finding-card-head"));
  await tick();
  facts.offView = {
    adds: texts(adder, ".finding-card.open .finding-add"),
    rows: texts(adder, ".finding-card.open .finding-item"),
    boxes: adder.all(".box").length,
    ghosts: adder.all(".ghost, .ghost-add").length,
    lit: adder.all(".box.lit-warning").map((n) => n.dataset.id),
  };
  click(adder.q(".finding-add"));
  await tick();
  await tick();
  facts.added = { boxes: adder.all(".box").map((n) => n.dataset.id).sort(), adds: adder.all(".finding-card.open .finding-add").length, open: adder.all(".finding-card.open").length, selected: adder.all(".box.selected").length, saved: adder.port.files.size - savedBefore };

  const wide = await mount({ findings: [doc("structure", [longOne]), doc("review", [longReport])] }, null);
  wide.host.querySelector(".tree").style.cssText += ";width:340px;flex:none";
  click(wide.q(".rail-findings"));
  await tick();
  for (const head of wide.all(".finding-group-head")) click(head);
  await tick();
  const measure = (node) => ({ scroll: node.scrollWidth, client: node.clientWidth, height: node.getBoundingClientRect().height });
  facts.wrap = {
    panel: wide.q(".findings-panel").clientWidth,
    cards: wide.all(".finding-card").map(measure),
    sentences: wide.all(".finding-sentence").map(measure),
    names: wide.all(".finding-name").map(measure),
    lineHeight: parseFloat(getComputedStyle(wide.q(".finding-sentence")).lineHeight),
  };

  const mixed = await mount({ findings: [doc("structure", [cycle])] }, ["app/a.py"]);
  click(mixed.q(".rail-findings"));
  await tick();
  click(mixed.q(".finding-group-head"));
  await tick();
  click(mixed.q(".finding-card-head"));
  await tick();
  facts.mixed = mixed.all(".finding-card.open .finding-item").map((row) => ({ text: row.textContent, add: row.querySelector(".finding-add") !== null }));

  const only = await mount({ findings: [doc("structure", [cycle, violation]), doc("lint", [style])] }, ["app/a.py"]);
  click(only.q(".rail-findings"));
  await tick();
  const snap = () => ({ line: only.q(".findings-line").textContent, groups: texts(only, ".finding-group-name"), counts: texts(only, ".finding-group-count"), checked: only.q(".findings-scope-canvas").getAttribute("aria-pressed"), all: only.q(".findings-scope-all").getAttribute("aria-pressed") });
  facts.only = { shown: only.shown(".findings-scope"), caption: only.q(".findings-scope-canvas").textContent, before: snap() };
  click(only.q(".findings-scope-canvas"));
  await tick();
  facts.only.on = snap();
  facts.only.marks = only.all(".box .finding-mark, .box.finding").length;
  click(only.q(".findings-scope-all"));
  await tick();
  facts.only.off = snap();
  const noView = await mount({ findings: [doc("structure", [cycle, violation]), doc("lint", [style])] }, null);
  click(noView.q(".rail-findings"));
  await tick();
  const untitled = () => ({ line: noView.q(".findings-line").textContent, canvas: noView.q(".findings-scope-canvas").getAttribute("aria-pressed") });
  facts.noView = { shown: noView.shown(".findings-scope"), caption: noView.q(".findings-scope-canvas").textContent, before: untitled() };
  click(noView.q(".rail-files"));
  await tick();
  click(noView.q(".reye"));
  await tick();
  click(noView.q(".rail-findings"));
  await tick();
  facts.noView.opened = noView.all(".box").length;
  facts.noView.afterOpen = { caption: noView.q(".findings-scope-canvas").textContent };
  click(noView.q(".findings-scope-canvas"));
  await tick();
  facts.noView.on = untitled();
  click(noView.q(".findings-scope-all"));
  await tick();
  facts.noView.off = untitled();

  const warn = await mount({ findings: [doc("lint", [style])] }, null);
  facts.warnings = { class: warn.q(".rail-findings .rail-count").className, hidden: warn.q(".rail-findings .rail-count").hidden };
  const none = await mount({ findings: [] }, null);
  click(none.q(".rail-findings"));
  await tick();
  facts.none = { hidden: none.q(".rail-findings .rail-count").hidden, empty: none.q(".findings-empty").textContent, rows: none.all(".finding-card").length };

  const other = await mount({ findings: [doc("structure", [violation], "other")] }, null);
  click(other.q(".rail-findings"));
  await tick();
  facts.otherCommit = { rows: other.all(".finding-card").length, hidden: other.q(".rail-findings .rail-count").hidden };

  const stale = await mount({ findings: [doc("structure", [violation]), doc("alpha", [style], "other")] }, null, [{ name: "alpha", status: "ran" }]);
  click(stale.q(".rail-findings"));
  await tick();
  facts.stale = { text: stale.q(".findings-fresh-text").textContent, link: stale.q(".findings-fresh-link").textContent, shown: stale.shown(".findings-fresh") };
  click(stale.q(".findings-fresh-link"));
  await tick();
  facts.staleClick = { ran: stale.runs.length, label: stale.runs[0] ? stale.runs[0].planned.label : null, findings: stale.shown(".findings-panel") };

  const fresh = await mount({ findings: [doc("structure", [violation])] }, null, [{ name: "alpha", status: "ran" }]);
  click(fresh.q(".rail-findings"));
  await tick();
  facts.fresh = { shown: fresh.shown(".findings-fresh") };

  const withPolicy = await mount({ findings: [doc("structure", [violation])], policy: "layers: []\\n" }, null, [{ name: "alpha", status: "ran" }]);
  click(withPolicy.q(".rail-findings"));
  await tick();
  const noPolicyNode = m.q(".findings-policy");
  const noPolicyInfo = noPolicyNode.querySelector(".finding-info");
  const noPolicyTip = document.getElementById(noPolicyInfo.getAttribute("aria-describedby"));
  facts.policy = {
    without: { shown: m.shown(".findings-policy"), text: noPolicyNode.querySelector(".findings-policy-text").textContent, icon: noPolicyInfo.querySelectorAll("svg").length, tip: noPolicyTip.textContent, banners: m.all(".findings-fresh").length },
    with: { shown: withPolicy.shown(".findings-policy"), nodes: withPolicy.all(".findings-policy .finding-info").length },
  };

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(webkit === undefined)("the Findings panel", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "findings-panel");
  }, scaledTimeout(180000));

  it("shows the header line and collapsed groups in the fixed order with counts and dots", () => {
    expect(f.panel.order).toEqual([
      "rail-files",
      "rail-commits",
      "rail-views",
      "rail-notes",
      "rail-scan",
      "rail-findings",
    ]);
    expect(f.panel.badge).toBe("1");
    expect(f.panel.badgeClass).toContain("red");
    expect(f.panel.label).toContain("Findings");
    expect(f.panel.open).toBe(true);
    expect(f.panel.files).toBe(false);
    expect(f.panel.heading).toBe("Findings");
    expect(f.panel.fresh).toBeNull();
    expect(f.panel.line).toBe("1 violation, 2 warnings");
    expect(f.panel.chips).toBe(0);
    expect(f.panel.groups).toEqual([
      "Breaks the policy",
      "Import cycle",
      "Style",
    ]);
    expect(f.panel.counts).toEqual(["1", "1", "1"]);
    expect(f.panel.marks).toEqual(["violation", "warning", "warning"]);
    expect(f.panel.cards).toBe(0);
    expect(f.panel.freshShown).toBe(false);
    expect(f.panel.ghosts).toBe(0);
  });

  it("says dependency direction is unchecked when the repository has no policy, and says nothing with one", () => {
    expect(f.policy.without.shown).toBe(true);
    expect(f.policy.without.text).toBe(
      "No policy: dependency direction isn't checked",
    );
    expect(f.policy.without.icon).toBe(1);
    expect(f.policy.without.tip).toContain(".recognizer/policy.yaml");
    expect(f.policy.without.tip).toContain("inner first");
    expect(f.policy.without.tip).toContain("policies/hexagonal.yaml");
    expect(f.policy.without.tip).toContain("policies/vertical-slices.yaml");
    expect(f.policy.without.banners).toBe(1);
    expect(f.policy.with.shown).toBe(false);
    expect(f.policy.with.nodes).toBe(0);
  });

  it("shows an info icon only on groups with help, with a tip reachable by keyboard", () => {
    expect(f.info.icons).toBe(2);
    expect(f.info.svg).toBe(1);
    expect(f.info.text).toBe("");
    expect(f.info.width).toBe(16);
    expect(f.info.height).toBe(16);
    expect(f.info.restColor).toBe(f.info.faint);
    expect(f.info.noneOnReported).toBe(0);
    expect(f.info.sameHeight).toBe(true);
    expect(f.info.label).toBe("About Breaks the policy");
    expect(f.info.role).toBe("tooltip");
    expect(f.info.hiddenAtRest).toBe(true);
    expect(f.info.focused.shown).toBe(true);
    expect(f.info.focused.lines).toEqual([
      `What it means${groupFile.groups[0]?.means}`,
      `What to do${groupFile.groups[0]?.todo}`,
    ]);
    expect(f.info.focused.focusColor).toBe(f.info.focused.sel);
    expect(f.info.blurred).toBe(true);
  });

  it("hides the tip on Escape while focus stays, and shows it again on the next focus", () => {
    expect(f.info.escaped).toEqual({ hidden: true, focused: true });
    expect(f.info.refocused).toBe(true);
  });

  it("clicking the icon leaves the group alone while the name and count still toggle it", () => {
    expect(f.info.clickIcon).toEqual({ same: true, expanded: true });
    expect(f.info.clickCount).toBe(1);
    expect(f.info.clickName).toBe(0);
  });

  it("colours the tip with the theme variables", () => {
    expect(f.info.focused.background).toBe(f.info.focused.box);
    expect(f.info.focused.border).toBe(f.info.focused.boxline);
    expect(f.info.focused.color).toBe(f.info.focused.fg);
  });

  it("a group is collapsed until clicked", () => {
    expect(f.panel.cards).toBe(0);
    expect(f.card.groupsOpen).toBe(1);
    expect(f.card.cards).toBe(1);
  });

  it("shows a card with its bold name, muted folder and one sentence, and nothing else", () => {
    expect(f.card.name).toBe("a.py");
    expect(f.card.folder).toBe("app");
    expect(f.card.sentence).toBe(
      "a.py imports b.py, which the policy forbids: domain may not use adapters.",
    );
    expect(f.card.weight).toBe("600");
    expect(f.card.extras).toBe(0);
    expect(f.card.text).not.toMatch(
      /dependencies-follow|rule-violation|Open in editor|Copy id|structure/,
    );
  });

  it("a clicked card lights the evidence, dims the rest, opens inline and changes no selection or box", () => {
    expect(f.oriented.selected).toEqual([]);
    expect(f.oriented.inspector).toBe(false);
    expect(f.oriented.boxesSame).toBe(true);
    expect(f.oriented.litBoxes).toEqual(["app/a.py", "app/b.py"]);
    expect(f.oriented.litLines).toBe(1);
    expect(f.oriented.dimmed).toEqual(["lib/c.py"]);
    expect(f.oriented.open).toBe(1);
    expect(f.oriented.rows).toEqual(["a.pyapp", "a.py -> b.py"]);
    expect(f.oriented.adds).toBe(0);
  });

  it("one card open at a time", () => {
    expect(f.one.open).toEqual(["cycle:a,b"]);
    expect(f.one.rows).toEqual([
      "a.pyapp",
      "b.pyapp",
      "a.py -> b.py",
      "b.py -> a.py",
    ]);
  });

  it("keeps the focus on a click inside the evidence and drops it on any other", () => {
    expect(f.keptOnEvidence.open).toBe(1);
    expect(f.keptOnEvidence.lit).toBe(2);
    expect(f.keptOnEvidence.dim).toBe(1);
    expect(f.droppedOnOther).toEqual({ open: 0, lit: 0 });
  });

  it("walks with j and k through the cards, opening the group, and clears with Escape", () => {
    expect(f.walkedFirst.id).toBe("rule-violation:a");
    expect(f.walked).toEqual({ id: "style:c", groupOpen: 3 });
    expect(f.walkedBack.id).toBe("cycle:a,b");
    expect(f.cleared).toEqual({ open: 0, dim: 0, lit: 0 });
  });

  it("keeps the focus over a panel switch and clears it on clicking the open card", () => {
    expect(f.switched.lit).toBe(2);
    expect(f.closedAgain).toEqual({ open: 0, lit: 0 });
  });

  it("shows the selection bar's findings button in the disc's colour, after dependencies, and opens the tab", () => {
    expect(f.bar.present).toBe(true);
    expect(f.bar.text).toBe("2");
    expect(f.bar.cls).toContain("findings-red");
    expect(f.bar.order).toEqual([
      "Contents (I)",
      "Dependencies (D)",
      "Findings (W)",
    ]);
    expect(f.barTab.tab[0]).toMatch(/^Findings/);
    expect(f.barTab.groups).toEqual(["Breaks the policy", "Import cycle"]);
    expect(f.barTab.icons).toBe(2);
    expect(f.barTab.counts).toEqual(["1", "1"]);
    expect(f.barTab.closed).toBe(0);
    expect(f.barTab.on).toContain("on");
    expect(f.barWarn).toContain("findings-amber");
    expect(f.barQuiet.present).toBe(false);
    expect(f.keyW[0]).toMatch(/^Findings/);
  });

  it("opens one inspector group on its own and heads its cards like the panel's", () => {
    expect(f.barOpened.groups).toBe(1);
    expect(f.barOpened.cards).toEqual(["rule-violation:a"]);
    expect(f.barOpened.name).toBe("a.py");
    expect(f.barOpened.folder).toBe("app");
    expect(f.barOpened.panelGroupsOpen).toBe(0);
  });

  it("groups a folder's findings by kind once each, not under per-module headings", () => {
    expect(f.folderBoxFound).toBe(true);
    expect(f.folderTab.groups).toEqual(["Breaks the policy", "Import cycle"]);
    expect(f.folderTab.headings).toBe(0);
    expect(f.folderCards.groupsOpen).toBe(2);
    expect(f.folderCards.names.sort()).toEqual(["a.py", "a.py"]);
  });

  it("focuses a finding from the inspector's tab exactly as the panel does", () => {
    expect(f.tabFocus.open).toBe(1);
    expect(f.tabFocus.lit).toEqual(["app/a.py", "app/b.py"]);
    expect(f.tabFocus.rows).toEqual([
      "a.pyapp",
      "b.pyapp",
      "a.py -> b.py",
      "b.py -> a.py",
    ]);
  });

  it("lists an off-view module with Add to view, which adds that one box and nothing else", () => {
    expect(f.offView.adds).toEqual(["Add to view"]);
    expect(f.offView.rows).toEqual([
      "a.pyapp",
      "b.pyappAdd to view",
      "a.py -> b.py",
      "b.py -> a.py",
    ]);
    expect(f.offView.boxes).toBe(1);
    expect(f.offView.ghosts).toBe(0);
    expect(f.offView.lit).toEqual(["app/a.py"]);
    expect(f.added).toEqual({
      boxes: ["app/a.py", "app/b.py"],
      adds: 0,
      open: 1,
      selected: 0,
      saved: 0,
    });
  });

  it("shows Add to view only on the rows whose module is absent", () => {
    expect(f.mixed).toEqual([
      { text: "a.pyapp", add: false },
      { text: "b.pyappAdd to view", add: true },
      { text: "a.py -> b.py", add: false },
      { text: "b.py -> a.py", add: false },
    ]);
  });

  it("wraps long text at word boundaries and never clips", () => {
    expect(f.wrap.panel).toBeLessThanOrEqual(340);
    expect(f.wrap.cards).toHaveLength(2);

    for (const node of [
      ...f.wrap.cards,
      ...f.wrap.sentences,
      ...f.wrap.names,
    ]) {
      expect(node.scroll).toBeLessThanOrEqual(node.client);
    }

    expect(f.wrap.names[0].height).toBeGreaterThan(30);

    for (const node of f.wrap.sentences) {
      expect(node.height).toBeGreaterThan(f.wrap.lineHeight * 1.5);
    }
  });

  it("limits the panel to the open view's findings when Only this view is on", () => {
    expect(f.only.shown).toBe(true);
    expect(f.only.caption).toBe("order, 1");
    expect(f.only.before).toEqual({
      line: "1 violation, 2 warnings",
      groups: ["Breaks the policy", "Import cycle", "Style"],
      counts: ["1", "1", "1"],
      checked: "false",
      all: "true",
    });
    expect(f.only.on).toEqual({
      line: "1 violation, 1 warning",
      groups: ["Breaks the policy", "Import cycle"],
      counts: ["1", "1"],
      checked: "true",
      all: "false",
    });
    expect(f.only.off).toEqual(f.only.before);
  });

  it("offers the canvas and whole-repository switch on an Untitled canvas and scopes by its open modules", () => {
    expect(f.noView.shown).toBe(true);
    expect(f.noView.caption).toBe("This canvas, 0");
    expect(f.noView.opened).toBeGreaterThan(0);
    expect(f.noView.afterOpen.caption).toBe(`This canvas, ${f.noView.opened}`);
    expect(f.noView.on.canvas).toBe("true");
    expect(f.noView.off).toEqual(f.noView.before);
    expect(f.noView.on.line).not.toBe(f.noView.before.line);
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

  it("says why findings are hidden with a link that starts the same run as the primary button; nothing when all are current", () => {
    expect(f.stale.text).toBe("Findings for 1 changed module is hidden.");
    expect(f.stale.link).toBe("Update them");
    expect(f.staleClick).toEqual({
      ran: 1,
      label: "Update 3 modules",
      findings: true,
    });
    expect(f.fresh.shown).toBe(false);
  });
});
