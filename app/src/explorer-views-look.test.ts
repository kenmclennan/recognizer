import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, here, webkit } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, mountExplorer } from ${JSON.stringify(here("look-support.ts"))};
import { buildFooter } from ${JSON.stringify(here("footer-view.ts"))};
import { createViewComparisons } from ${JSON.stringify(here("view-comparisons.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
import { fakeWindow } from ${JSON.stringify(here("window-fake.ts"))};
import { parseViewFile } from ${JSON.stringify(here("view-file.ts"))};

window.__fakeWorker = () => {
  const listeners = [];
  return {
    addEventListener: (type, listener) => listeners.push(listener),
    postMessage(request) {
      if (request.cmd !== "layout") return;
      let row = 0;
      const place = (node, depth) => {
        for (const child of node.children || []) {
          child.x = 10 + depth * 20 + (row % 3) * 200;
          child.y = 40 + row * 70;
          row += 1;
          place(child, depth + 1);
        }
      };
      const graph = JSON.parse(JSON.stringify(request.graph));
      place(graph, 0);
      for (const listener of listeners) listener({ data: { id: request.id, data: graph } });
    },
  };
};

const edge = (from, to) => ({ from, to, kind: "depends", line: 1, names: ["X"] });
const ids = ["app/hub.py", "app/a.py", "lib/c.py", "lib/d.py", "lib/e.py"];
const nowScan = {
  commit: "cur1234",
  modules: ids.map((id) => ({ id, kind: "module" })),
  edges: [edge("lib/c.py", "app/a.py"), edge("app/hub.py", "app/a.py"), edge("app/hub.py", "lib/c.py"), edge("app/hub.py", "lib/d.py"), edge("app/hub.py", "lib/e.py")],
  foreign: [],
};
const thenScan = {
  commit: "old1234",
  modules: [...ids, "lib/deleted.py"].map((id) => ({ id, kind: "module" })),
  edges: [edge("lib/c.py", "app/a.py"), edge("app/hub.py", "app/a.py"), edge("app/hub.py", "lib/e.py")],
  foreign: [],
};
const loaded = loadedOf({ modules: ids, scans: [{ file: "scan.json", scan: nowScan }] });

const viewText = (steps, commit, description = "d", extra) => JSON.stringify({ schema_version: extra ? 2 : 1, description, commit, ...(extra || {}), steps }, null, 2) + "\\n";
const pick = (module) => ({ kind: "pick", module });
const tick = () => new Promise((resolve) => setTimeout(resolve, 40));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const key = (k) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const typeInto = (input, value) => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); };

function mount(files, options, comparisons) {
  const footerEl = document.createElement("footer");
  footerEl.className = "footer";
  document.body.append(footerEl);
  const footer = buildFooter(footerEl);
  const host = document.createElement("div");
  host.style.cssText = "width:1400px;height:800px;display:flex;flex-direction:column";
  document.body.append(host);
  const port = fakeViews(files, options);
  port.scansByCommit.set("old1234", [thenScan]);
  const calls = { scans: [], renames: [] };
  const scansAt = port.scansAt;
  const renamesSince = port.renamesSince;
  port.scansAt = (commit) => { calls.scans.push(commit); return scansAt(commit); };
  port.renamesSince = (commit) => { calls.renames.push(commit); return renamesSince(commit); };
  const win = fakeWindow();
  const state = { count: "" };
  const notes = [];
  const explorer = mountExplorer({ container: host, loaded, title: "demo", onCount: (text) => { state.count = text; }, views: port, post: (input) => { notes.push(input.text); return footer.post(input); }, withdraw: footer.withdraw, reconcileMessages: footer.reconcile, windowPort: win, comparisons });
  const q = (selector) => host.querySelector(selector);
  const all = (selector) => [...host.querySelectorAll(selector)];
  const count = () => Number(/^(\\d+) of/.exec(state.count)[1]);
  const lastCurrent = () => win.last();
  const tray = () => [...footerEl.querySelectorAll(".message-list .msg")].map((row) => ({ text: row.querySelector(".msg-text").textContent, actions: [...row.querySelectorAll(".msg-act")].map((n) => n.textContent) }));
  const update = () => click(footerEl.querySelector(".message-list .msg-act"));
  const canvasKids = () => q(".canvas").children.length;
  const badge = () => ({ hidden: footerEl.querySelector(".bell-badge").hidden, count: footerEl.querySelector(".bell-badge").textContent });
  const selected = () => all(".box.selected").map((n) => n.dataset.id);
  return { explorer, footerEl, host, port, win, state, notes, q, all, count, lastCurrent, tray, update, canvasKids, badge, calls, selected };
}

const facts = {};

(async () => {
  await tick();

  const one = mount({});
  await tick();
  const shown = (selector) => { const node = one.q(selector); return node !== null && getComputedStyle(node).display !== "none"; };
  facts.freshOverlays = { menu: shown(".view-menu"), dialog: shown(".view-dialog") };
  facts.emptyStart = { count: one.count(), view: one.q(".view-name").textContent, bar: one.all(".view-bar button").length, writes: one.win.published.length, spinnerDisplay: getComputedStyle(one.q(".canvas-busy")).display, menuEmpty: (click(one.q(".view-list")), one.q(".view-menu").textContent) };
  click(one.q(".view-list"));
  click(one.q('.tree .row[data-path="app"] .rcheck'));
  await tick();
  facts.afterPutOn = one.lastCurrent();
  click(one.q(".view-save"));
  facts.dialog = { labels: one.all(".view-dialog label .view-field-label").map((n) => n.textContent), hint: one.q(".view-dialog .view-field-description").placeholder, disabled: one.q(".view-confirm").disabled };
  typeInto(one.q(".view-dialog .view-field-name"), "overview");
  facts.stillDisabled = one.q(".view-confirm").disabled;
  typeInto(one.q(".view-dialog .view-field-description"), "the app folder");
  facts.enabled = !one.q(".view-confirm").disabled;
  click(one.q(".view-confirm"));
  await tick();
  const saved = one.port.files.get("overview");
  const parsedSaved = parseViewFile(saved);
  const valid = parsedSaved.ok;
  const view = parsedSaved.ok ? parsedSaved.view : null;
  facts.saved = { valid, steps: view && view.steps, commit: view && view.commit, description: view && view.description, text: saved };
  facts.nameAfterSave = one.q(".view-name").textContent;
  facts.currentAfterSave = one.lastCurrent();

  click(one.q('.tree .row[data-path="app"] .rcheck'));
  await tick();
  facts.cleared = one.count();
  click(one.q(".view-list"));
  facts.menu = one.all(".view-item").map((n) => n.textContent);
  click(one.q(".view-item"));
  await tick();
  facts.reopened = { count: one.count(), footer: one.state.count, name: one.q(".view-name").textContent };

  click(one.q(".box .box-body"));
  await tick();
  facts.selection = one.lastCurrent().selection;
  click(one.q(".view-back"));
  await tick();
  facts.afterBackSelection = { current: one.lastCurrent().selection, selected: one.selected() };
  click(one.q(".view-forward"));
  await tick();
  facts.afterForwardSelection = { current: one.lastCurrent().selection, selected: one.selected() };
  click(one.q(".view-back"));
  click(one.q(".view-back"));
  await tick();
  facts.afterTwoBack = { count: one.count(), modules: one.lastCurrent().modules };
  click(one.q(".view-forward"));
  await tick();
  facts.afterForward = { count: one.count(), modules: one.lastCurrent().modules };
  click(one.q('.frame-label[data-kind="folder"][data-id="app"]'));
  await tick();
  key("z");
  await tick();
  facts.afterFold = one.lastCurrent().folded;
  key("z");
  await tick();
  facts.afterUnfold = one.lastCurrent().folded;
  facts.copyDisabled = one.q(".view-copy").disabled;
  click(one.q(".view-copy"));
  await tick();
  facts.copied = one.port.copied;
  facts.copyNote = one.notes[one.notes.length - 1];

  one.port.edit("overview", viewText([pick("app/hub.py"), pick("app/a.py"), pick("lib/d.py")], "cur1234"));
  await tick();
  facts.agentEdit = one.count();
  const before = one.win.published.length;
  one.port.edit("overview", "{nope");
  await tick();
  facts.invalidEdit = { count: one.count(), notice: one.notes.join(" | "), writes: one.win.published.length - before };
  const postedBefore = one.notes.length;
  one.port.edit("overview", viewText([pick("app/hub.py")], "cur1234"));
  await tick();
  facts.retried = { count: one.count(), quiet: one.notes.length === postedBefore };
  one.port.edit("overview", null);
  await tick();
  facts.deleted = { count: one.count(), name: one.q(".view-name").textContent, notice: one.notes.join(" | ") };
  click(one.q(".view-back"));
  await tick();
  facts.backToDeleted = one.q(".view-name").textContent.trim();

  const staleFile = viewText([pick("app/hub.py"), pick("lib/c.py"), pick("lib/deleted.py")], "old1234");
  const comparisons = createViewComparisons();
  const two = mount({ stale: staleFile, stale2: staleFile, current: viewText([pick("app/hub.py")], "cur1234") }, undefined, comparisons);
  two.port.renames = [{ from: "lib/deleted.py", to: "lib/e.py" }];
  await tick();
  click(two.q(".view-list"));
  const kidsBefore = two.canvasKids();
  click(two.all(".view-item")[1]);
  await tick();
  facts.stale = { panel: two.q(".stale-panel") !== null, kids: two.canvasKids() === kidsBefore, count: two.count(), tray: two.tray(), badge: two.badge() };
  click(two.q(".view-list"));
  click(two.all(".view-item")[1]);
  await tick();
  facts.reopened2 = { tray: two.tray().length, scans: two.calls.scans.length, renames: two.calls.renames.length };
  two.update();
  await tick();
  const updated = JSON.parse(two.port.files.get("stale"));
  facts.updated = { steps: updated.steps, commit: updated.commit, tray: two.tray(), badge: two.badge(), count: two.count(), valid: parseViewFile(two.port.files.get("stale")).ok };

  click(two.q(".view-list"));
  click(two.all(".view-item")[2]);
  await tick();
  facts.second = two.tray();
  two.update();
  await tick();
  const dropped = JSON.parse(two.port.files.get("stale2"));
  facts.droppedUpdate = { steps: dropped.steps, commit: dropped.commit, tray: two.tray() };

  click(two.q(".view-list"));
  click(two.all(".view-item")[0]);
  await tick();
  facts.currentView = two.tray();

  const mixed = mount({ one: staleFile, two: viewText([pick("app/hub.py"), pick("lib/deleted.py")], "old1234"), now: viewText([pick("app/hub.py")], "cur1234") });
  await tick();
  for (const index of [1, 2, 0]) {
    click(mixed.q(".view-list"));
    click(mixed.all(".view-item")[index]);
    await tick();
  }
  facts.mixed = mixed.tray();

  const three = mount({ late: staleFile }, { delayScans: true });
  await tick();
  click(three.q(".view-list"));
  click(three.q(".view-item"));
  await tick();
  facts.late = { count: three.count(), tray: three.tray().length };
  await three.port.settle();
  await tick();
  facts.lateDone = three.tray();

  const nowhere = mount({ gone: staleFile });
  nowhere.port.scansByCommit.delete("old1234");
  await tick();
  click(nowhere.q(".view-list"));
  click(nowhere.q(".view-item"));
  await tick();
  facts.unavailable = nowhere.tray();

  const four = mount({ plain: viewText([pick("app/hub.py")], "cur1234") });
  await tick();
  click(four.q(".view-list"));
  click(four.q(".view-item"));
  await tick();
  facts.sameCommit = { tray: four.tray().length, count: four.count() };
  click(four.q('.tree .row[data-path="lib"] .rcheck'));
  await tick();
  click(four.q(".view-save"));
  await tick();
  const resaved = JSON.parse(four.port.files.get("plain"));
  facts.resaved = { steps: resaved.steps, description: resaved.description };

  const five = mount({ listed: viewText([pick("app/hub.py")], "cur1234") });
  await tick();
  const fiveName = five.q(".view-list");
  const menuOf = () => five.q(".view-menu");
  const labels = {};
  for (const [selector, label] of [[".view-list", "Saved views"], [".view-back", "Back"], [".view-forward", "Forward"], [".view-save", "Save the view"], [".view-copy", "Copy the view's link"]]) {
    const node = five.q(selector);
    const svg = node.querySelector("svg");
    labels[selector] = { aria: node.getAttribute("aria-label") === label, title: node.title === label, text: node.textContent.trim(), width: svg && svg.getBoundingClientRect().width, stroke: svg && getComputedStyle(svg).strokeWidth };
  }
  const chevron = fiveName.querySelector("svg.view-chevron");
  facts.barLook = { labels, nameText: five.q(".view-name").textContent.trim(), nameChevron: five.q(".view-name svg") !== null, weight: getComputedStyle(five.q(".view-name")).fontWeight, chevron: chevron && chevron.getBoundingClientRect().width };
  click(fiveName);
  facts.listedMenu = { hidden: menuOf().hidden, items: five.all(".view-item").map((n) => n.textContent), expanded: fiveName.getAttribute("aria-expanded") };
  key("Escape");
  facts.afterEscape = { hidden: menuOf().hidden, expanded: fiveName.getAttribute("aria-expanded") };
  click(fiveName);
  five.host.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  facts.afterOutside = menuOf().hidden;
  click(fiveName);
  fiveName.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  facts.afterInside = menuOf().hidden;
  click(five.q(".view-item"));
  facts.afterChoose = menuOf().hidden;
  await tick();

  const six = mount({ ok: viewText([pick("app/hub.py")], "cur1234") }, { listError: "no folder" });
  await tick();
  click(six.q(".view-list"));
  const broken = mount({}, { writeError: "disk full" });
  await tick();
  click(broken.q('.tree .row[data-path="app"] .rcheck'));
  await tick();
  click(broken.q(".view-save"));
  typeInto(broken.q(".view-dialog .view-field-name"), "keep");
  typeInto(broken.q(".view-dialog .view-field-description"), "a long description kept after a failure");
  click(broken.q(".view-confirm"));
  await tick();
  const descriptionBox = broken.q(".view-dialog .view-field-description");
  facts.failedSave = {
    dialogOpen: !broken.q(".view-dialog").hidden,
    name: broken.q(".view-dialog .view-field-name").value,
    description: descriptionBox.value,
    problem: broken.q(".view-problem").textContent,
    notice: broken.notes.join(" | "),
    tag: descriptionBox.tagName,
    rows: descriptionBox.rows,
    wrapsInside: descriptionBox.offsetWidth <= broken.q(".view-dialog").offsetWidth,
    enterPrevented: !descriptionBox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })) ,
    enabled: !broken.q(".view-confirm").disabled,
  };
  facts.failedList = { menu: six.q(".view-menu").textContent, notice: six.notes.join(" | "), noticeShown: six.notes.length > 0 };

  const seven = mount({ ok: viewText([pick("app/hub.py")], "cur1234") }, { refused: ["views/x.json: unreadable"] });
  await tick();
  facts.refusedList = { notice: seven.notes.join(" | "), items: (click(seven.q(".view-list")), seven.all(".view-item").length) };

  const rename = mount({ alpha: viewText([pick("app/hub.py")], "cur1234"), beta: viewText([pick("app/a.py")], "cur1234") });
  await tick();
  click(rename.q(".view-list"));
  click(rename.all(".view-item")[0]);
  await tick();
  const card = () => rename.q(".view-details");
  const field = (kind) => rename.q(".view-details-" + kind);
  const press = (node, k, extra) => node.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));
  const headingNow = () => ({ title: rename.all(".view-heading-title tspan").map((t) => t.textContent).join(" "), description: rename.all(".view-heading-description tspan").map((t) => t.textContent).join(" ") });
  const cardShown = () => !card().hidden;
  const file = (n) => JSON.parse(rename.port.files.get(n));
  click(rename.q(".view-name"));
  facts.editing = { card: cardShown(), name: field("name").value, title: field("title").value, description: field("description").value, saveDisabled: field("save").disabled, nameVisible: !rename.q(".view-name").hidden, inlineFields: rename.all(".view-name-field-inline, .view-title-field-inline").length, descriptionTag: field("description").tagName, focused: document.activeElement === field("title") };
  facts.headingBefore = headingNow();
  typeInto(field("title"), "Draft title");
  typeInto(field("description"), "Draft description");
  await tick();
  facts.preview = { heading: headingNow(), saveDisabled: field("save").disabled };
  press(field("title"), "Escape");
  await tick();
  facts.escaped = { card: cardShown(), heading: headingNow(), name: rename.q(".view-name").textContent, renamed: rename.port.renamed.length };
  click(rename.q(".view-name"));
  typeInto(field("title"), "Draft again");
  await tick();
  document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  await tick();
  facts.outside = { card: cardShown(), heading: headingNow() };
  click(rename.q(".view-name"));
  typeInto(field("title"), "Draft cancel");
  await tick();
  click(field("cancel"));
  await tick();
  facts.cancelled = { card: cardShown(), heading: headingNow(), written: rename.port.files.get("alpha") };
  click(rename.q(".view-name"));
  typeInto(field("name"), "beta");
  facts.taken = { problem: field("problem").hidden ? "" : field("problem").textContent, invalid: field("name").getAttribute("aria-invalid"), saveDisabled: field("save").disabled, renamed: rename.port.renamed.length, files: [...rename.port.files.keys()] };
  typeInto(field("name"), "");
  facts.emptyName = { problem: field("problem").textContent, saveDisabled: field("save").disabled };
  typeInto(field("name"), "bad name!");
  facts.badName = { problem: field("problem").textContent, saveDisabled: field("save").disabled, renamed: rename.port.renamed.length };
  typeInto(field("name"), "alpha");
  typeInto(field("title"), "Own name");
  facts.ownName = { problem: field("problem").hidden ? "" : field("problem").textContent, saveDisabled: field("save").disabled };
  typeInto(field("description"), "   ");
  facts.blankDescription = { saveDisabled: field("save").disabled };
  typeInto(field("description"), "d");
  field("title").dispatchEvent(new FocusEvent("blur", { relatedTarget: null }));
  await tick();
  facts.blurred = { card: cardShown(), renamed: rename.port.renamed.length, title: file("alpha").title ?? null };
  press(field("title"), "Escape");
  await tick();
  click(rename.q(".view-name"));
  typeInto(field("name"), "gamma");
  typeInto(field("title"), "T3");
  typeInto(field("description"), "D3");
  press(field("description"), "Enter");
  facts.plainEnter = { card: cardShown(), renamed: rename.port.renamed.length };
  const before2 = rename.win.published.length;
  press(field("description"), "Enter", { metaKey: true });
  await tick();
  await tick();
  click(rename.q(".view-list"));
  facts.renamed = { card: cardShown(), name: rename.q(".view-name").textContent, port: rename.port.renamed, files: [...rename.port.files.keys()], saved: file("gamma"), menu: rename.all(".view-item").map((n) => n.querySelector(".view-item-name").textContent), current: rename.all(".view-item.current").map((n) => n.querySelector(".view-item-name").textContent), currentView: rename.lastCurrent().view, wrote: rename.win.published.length > before2, notice: rename.notes.join(" | "), heading: headingNow() };
  click(rename.q(".view-list"));
  click(rename.q(".view-name"));
  typeInto(field("title"), "T4");
  press(field("title"), "Enter");
  await tick();
  await tick();
  facts.enterTitle = { card: cardShown(), title: file("gamma").title };
  click(rename.q(".view-name"));
  typeInto(field("description"), "D5");
  press(field("name"), "Enter");
  await tick();
  await tick();
  facts.enterName = { card: cardShown(), description: file("gamma").description, renamed: rename.port.renamed.length };
  click(rename.q(".view-name"));
  typeInto(field("title"), "   ");
  press(field("title"), "Enter");
  await tick();
  await tick();
  facts.clearedTitle = { hasTitle: "title" in file("gamma") };
  const currentItem = rename.q(".view-item.current");
  const itemProbe = (css) => { const n = document.createElement("i"); n.style.color = css; n.style.backgroundColor = css; document.body.append(n); const c = [getComputedStyle(n).color, getComputedStyle(n).backgroundColor]; n.remove(); return c; };
  facts.currentItem = { before: getComputedStyle(currentItem.querySelector(".view-item-name"), "::before").content, background: getComputedStyle(currentItem).backgroundColor, name: getComputedStyle(currentItem.querySelector(".view-item-name")).color, selection: itemProbe("var(--sel)")[0], selectionBackground: itemProbe("var(--selbg)")[1] };
  click(rename.q(".view-back"));
  click(rename.q(".view-forward"));
  await tick();
  facts.afterRenameBack = rename.lastCurrent().view;

  const untitled = mount({ taken: viewText([pick("app/hub.py")], "cur1234") });
  await tick();
  click(untitled.q('.tree .row[data-path="app"] .rcheck'));
  await tick();
  click(untitled.q(".view-name"));
  const uf = (kind) => untitled.q(".view-details-" + kind);
  facts.untitledField = uf("name").value;
  facts.untitledFocus = document.activeElement === uf("name");
  typeInto(uf("name"), "taken");
  typeInto(uf("description"), "shows fresh");
  facts.untitledTaken = { problem: uf("problem").textContent, saveDisabled: uf("save").disabled, dialog: !untitled.q(".view-dialog").hidden };
  typeInto(uf("name"), "fresh");
  facts.untitledNamed = { saveDisabled: uf("save").disabled, dialog: !untitled.q(".view-dialog").hidden, written: [...untitled.port.files.keys()] };
  click(uf("save"));
  await tick();
  await tick();
  facts.untitledSaved = { files: [...untitled.port.files.keys()], name: untitled.q(".view-name").textContent, card: !untitled.q(".view-details").hidden, file: JSON.parse(untitled.port.files.get("fresh")) };

  const rowsFile = (extra, module = "app/a.py") => JSON.stringify({ schema_version: 4, description: "d", commit: "cur1234", ...extra, steps: [{ kind: "pick", module }] }, null, 2) + "\\n";
  const long = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty ".repeat(6);
  const rowsPanel = mount({
    titled: rowsFile({ title: "Titled view", description: long, notes: [{ module: "app/a.py", text: "x", by: "Ken" }] }),
    quiet: rowsFile({ title: "Quiet view" }),
    plain: rowsFile({}),
    changed: rowsFile({ title: "Changed view", change: { base: "a".repeat(40), head: "b".repeat(40) }, notes: [{ module: "app/a.py", text: "x", by: "Ken" }, { module: "app/hub.py", text: "y", by: "Ken" }] }),
    broken: rowsFile({ title: "Broken view" }, "app/missing.py"),
    bad: "{nope",
  });
  await tick();
  click(rowsPanel.q(".rail-views"));
  await tick();
  click(rowsPanel.all(".views-row").find((r) => r.dataset.view === "titled"));
  await tick();
  const rowIn = (name) => rowsPanel.all(".views-row").find((r) => r.dataset.view === name);
  const classesOf = (row) => [...row.children].map((c) => c.className);
  const probe = (css) => { const n = document.createElement("i"); n.style.color = css; n.style.backgroundColor = css; n.style.borderColor = css; document.body.append(n); const c = getComputedStyle(n).color; n.remove(); return c; };
  const open = rowIn("titled");
  const openStyle = getComputedStyle(open);
  const description = open.querySelector(".views-row-description");
  const lineHeight = parseFloat(getComputedStyle(description).lineHeight);
  const rowPair = rowsPanel.all(".views-row");
  facts.rows = {
    titledOrder: classesOf(open),
    clamp: getComputedStyle(description).webkitLineClamp,
    clampedLines: Math.round(description.getBoundingClientRect().height / lineHeight),
    openBackground: openStyle.backgroundColor,
    openBorder: openStyle.borderTopColor,
    openTitle: getComputedStyle(open.querySelector(".views-row-title")).color,
    openBefore: getComputedStyle(open, "::before").content,
    selection: probe("var(--sel)"),
    chips: rowsPanel.all(".views-panel [class*='chip']").length,
    quietOrder: classesOf(rowIn("quiet")),
    plainOrder: classesOf(rowIn("plain")),
    plainTitle: rowIn("plain").querySelector(".views-row-title").textContent,
    changedMeta: rowIn("changed").querySelector(".views-row-meta").textContent,
    invalidTag: rowIn("bad").tagName,
    invalidOrder: classesOf(rowIn("bad")),
    staleOrder: classesOf(rowIn("broken")),
    padding: openStyle.padding,
    gap: Math.round(rowPair[1].getBoundingClientRect().top - rowPair[0].getBoundingClientRect().bottom),
  };


  const openFirst = async (ctx) => {
    click(ctx.q(".view-list"));
    click(ctx.q(".view-item"));
    await tick();
  };
  const bar = (ctx) => {
    const mark = ctx.q(".view-modified");
    const revert = ctx.q(".view-revert");
    return { marker: mark !== null && !mark.hidden && getComputedStyle(mark).display !== "none", save: !ctx.q(".view-save").disabled, revertShown: revert !== null && !revert.hidden, revertEnabled: revert !== null && !revert.disabled, label: revert && revert.title, aria: revert && revert.getAttribute("aria-label") };
  };
  const camera = (ctx) => ctx.q(".canvas .world").getAttribute("transform");
  const zoomIn = (ctx) => click(ctx.all(".canvas .control").find((n) => n.textContent === "+"));
  const toggleLib = (ctx) => click(ctx.q('.tree .row[data-path="lib"] .rcheck'));
  const revertRows = (ctx) => ctx.tray().filter((row) => row.text.startsWith("Reverted"));

  const rv = mount({ v: viewText([pick("app/hub.py")], "cur1234"), w: viewText([pick("app/a.py")], "cur1234") });
  await tick();
  await openFirst(rv);
  const fitted0 = camera(rv);
  facts.revert = { fresh: bar(rv), freshCount: rv.count(), icon: { width: rv.q(".view-revert svg").getBoundingClientRect().width, paths: [...rv.q(".view-revert svg").querySelectorAll("path")].map((n) => n.getAttribute("d")) }, afterSave: rv.q(".view-save").nextElementSibling === rv.q(".view-revert") };
  toggleLib(rv);
  await tick();
  facts.revert.modified = { bar: bar(rv), count: rv.count() };
  toggleLib(rv);
  await tick();
  facts.revert.clearedByHand = { bar: bar(rv), count: rv.count() };
  toggleLib(rv);
  await tick();
  zoomIn(rv);
  const moved = camera(rv);
  facts.revert.beforeRevert = { moved: moved !== fitted0, count: rv.count() };
  click(rv.q(".view-revert"));
  await tick();
  facts.revert.reverted = { bar: bar(rv), count: rv.count(), fitted: camera(rv) === fitted0, rows: revertRows(rv), tray: rv.tray().length };
  click(rv.footerEl.querySelector(".message-list .msg-act"));
  await tick();
  facts.revert.undone = { bar: bar(rv), count: rv.count(), camera: camera(rv) === moved, rowsAfter: revertRows(rv).length };
  click(rv.q(".view-revert"));
  await tick();
  facts.revert.second = { count: rv.count() };
  click(rv.q(".view-list"));
  click(rv.all(".view-item").find((n) => n.textContent.startsWith("w")));
  await tick();
  const wCount = rv.count();
  const guardRow = rv.footerEl.querySelector(".message-list .msg-act");
  if (guardRow) click(guardRow);
  await tick();
  facts.revert.guard = { wCount, after: rv.count(), name: rv.q(".view-name").textContent.trim() };

  const cam = mount({ v: viewText([pick("app/hub.py")], "cur1234") });
  await tick();
  await openFirst(cam);
  const camFitted = camera(cam);
  zoomIn(cam);
  facts.revert.cameraOnly = { bar: bar(cam), moved: camera(cam) !== camFitted };
  click(cam.q(".view-revert"));
  await tick();
  facts.revert.cameraRestored = { fitted: camera(cam) === camFitted, tray: cam.tray().length, bar: bar(cam) };

  const unsaved = mount({});
  await tick();
  click(unsaved.q('.tree .row[data-path="app"] .rcheck'));
  await tick();
  facts.revert.unsaved = bar(unsaved);
  click(unsaved.q(".view-save"));
  facts.revert.unsavedDialog = !unsaved.q(".view-dialog").hidden;

  const saveIt = mount({ v: viewText([pick("app/hub.py")], "cur1234") });
  await tick();
  await openFirst(saveIt);
  toggleLib(saveIt);
  await tick();
  click(saveIt.q(".view-save"));
  await tick();
  facts.revert.savedClears = { bar: bar(saveIt), steps: JSON.parse(saveIt.port.files.get("v")).steps.length };

  const renamedPick = mount({ r: viewText([pick("app/hub.py"), pick("lib/deleted.py")], "old1234") });
  renamedPick.port.renames = [{ from: "lib/deleted.py", to: "lib/e.py" }];
  await tick();
  await openFirst(renamedPick);
  const renamedOpen = { bar: bar(renamedPick), count: renamedPick.count() };
  click(renamedPick.q(".view-revert"));
  await tick();
  facts.revert.renamedPick = { opened: renamedOpen, reverted: { bar: bar(renamedPick), count: renamedPick.count() } };


  const clearBtn = (ctx) => ctx.all(".canvas .control").find((n) => n.textContent === "Clear");
  const prompt = (ctx) => { const scrim = ctx.q(".unsaved-dialog-scrim"); const node = ctx.q(".unsaved-dialog"); return { shown: scrim !== null && !scrim.hidden, heading: node && node.querySelector(".unsaved-dialog-heading").textContent, body: node && node.querySelector(".unsaved-dialog-body").textContent, buttons: node ? [...node.querySelectorAll("button")].map((b) => b.textContent) : [], focused: node !== null && document.activeElement === node.querySelector(".unsaved-dialog-save"), inCanvas: scrim !== null && ctx.q(".canvas").contains(scrim), inExplorer: scrim !== null && ctx.q(".explorer").contains(scrim) }; };
  const closed = (ctx) => ({ name: ctx.q(".view-name").textContent.trim(), marker: bar(ctx).marker, save: bar(ctx).save, revertShown: bar(ctx).revertShown, copy: !ctx.q(".view-copy").disabled, count: ctx.count(), prompt: prompt(ctx).shown });
  const choose = (ctx, name) => click(ctx.q(".unsaved-dialog-" + name));
  const lastNote = (ctx) => ctx.notes[ctx.notes.length - 1];
  const modifiedView = async (files, options) => {
    const ctx = mount(files, options);
    await tick();
    await openFirst(ctx);
    toggleLib(ctx);
    await tick();
    return ctx;
  };
  const text0 = viewText([pick("app/hub.py")], "cur1234");
  facts.clr = {};

  const cu = mount({ v: text0 });
  await tick();
  await openFirst(cu);
  const cuNotes = cu.notes.length;
  click(clearBtn(cu));
  await tick();
  facts.clr.unmodified = { ...closed(cu), file: cu.port.files.get("v") === text0, newNotes: cu.notes.length - cuNotes };

  const cm = await modifiedView({ v: text0 });
  const cmCamera = camera(cm);
  const cmCount = cm.count();
  click(clearBtn(cm));
  facts.clr.asked = { prompt: prompt(cm), count: cm.count() === cmCount, file: cm.port.files.get("v") === text0 };
  choose(cm, "cancel");
  await tick();
  facts.clr.cancelled = { ...closed(cm), count: cm.count() === cmCount, camera: camera(cm) === cmCamera };
  zoomIn(cm);
  const cmZoomed = camera(cm);
  click(clearBtn(cm));
  zoomIn(cm);
  facts.clr.afterPan = { prompt: prompt(cm).shown, moved: camera(cm) !== cmZoomed };
  choose(cm, "discard");
  await tick();
  facts.clr.discarded = { ...closed(cm), file: cm.port.files.get("v") === text0, note: lastNote(cm) };
  click(cm.q(".view-back"));
  await tick();
  facts.clr.backAfterDiscard = { name: cm.q(".view-name").textContent.trim(), marker: bar(cm).marker, count: cm.count() === cmCount };

  const cs = await modifiedView({ v: text0 });
  const csNotes = cs.notes.length;
  click(clearBtn(cs));
  choose(cs, "save");
  await tick();
  facts.clr.saved = { ...closed(cs), steps: JSON.parse(cs.port.files.get("v")).steps.length, changed: cs.port.files.get("v") !== text0, notes: cs.notes.slice(csNotes) };
  click(cs.q(".view-back"));
  await tick();
  facts.clr.backAfterSave = { name: cs.q(".view-name").textContent.trim(), marker: bar(cs).marker, count: cs.count() };

  const cf = await modifiedView({ v: text0 }, { writeError: "disk full" });
  const cfCount = cf.count();
  const cfNotes = cf.notes.length;
  click(clearBtn(cf));
  choose(cf, "save");
  await tick();
  facts.clr.failed = { ...closed(cf), name: cf.q(".view-name").textContent.trim(), marker: bar(cf).marker, count: cf.count() === cfCount, notes: cf.notes.slice(cfNotes), file: cf.port.files.get("v") === text0 };

  const cr = await modifiedView({ v: text0, w: viewText([pick("app/a.py")], "cur1234") });
  click(clearBtn(cr));
  click(cr.q(".view-revert"));
  await tick();
  facts.clr.dismissRevert = { prompt: prompt(cr).shown, name: cr.q(".view-name").textContent.trim() };
  toggleLib(cr);
  await tick();
  click(clearBtn(cr));
  toggleLib(cr);
  await tick();
  facts.clr.dismissByHand = prompt(cr).shown;
  toggleLib(cr);
  await tick();
  click(clearBtn(cr));
  cr.port.edit("v", null);
  await tick();
  facts.clr.dismissOpen = { prompt: prompt(cr).shown, name: cr.q(".view-name").textContent.trim() };

  const cn = mount({});
  await tick();
  click(cn.q('.tree .row[data-path="app"] .rcheck'));
  await tick();
  const cnBefore = { count: cn.count(), save: bar(cn).save };
  click(clearBtn(cn));
  await tick();
  facts.clr.noView = { before: cnBefore, after: closed(cn) };

  const cp = await modifiedView({ v: text0 });
  click(clearBtn(cp));
  facts.clr.escape = (() => { cp.q(".unsaved-dialog").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); return prompt(cp).shown; })();


  facts.mg = {};
  const mgA = viewText([pick("app/hub.py")], "cur1234");
  const mgB = viewText([pick("app/a.py")], "cur1234");
  const nameOf = (ctx) => ctx.q(".view-name").textContent.trim();
  const showPanel = async (ctx) => { click(ctx.q(".rail-views")); await tick(); };
  const rowOf = (ctx, n) => ctx.all(".views-row").find((r) => r.dataset.view === n) || null;
  const act = (ctx, n, cls) => click(rowOf(ctx, n).querySelector("." + cls));
  const cardOf = (ctx) => ctx.q(".views-panel .view-details");
  const fill = (ctx, field, value) => typeInto(cardOf(ctx).querySelector(".view-details-" + field), value);
  const problemOf = (ctx) => { const n = cardOf(ctx) && cardOf(ctx).querySelector(".view-details-problem"); return n && !n.hidden ? n.textContent : null; };
  const undoNow = (ctx) => click([...ctx.footerEl.querySelectorAll(".message-list .msg-act")].find((n) => n.textContent === "Undo"));
  const parsedOf = (ctx, n) => { const r = parseViewFile(ctx.port.files.get(n)); return r.ok ? r.view : null; };
  const warned = (ctx) => ctx.notes.some((t) => t.includes("was deleted from"));

  const mr = mount({ a: mgA, b: mgB, bad: "{nope" });
  await tick();
  await showPanel(mr);
  const footOf = (ctx, n) => { const r = rowOf(ctx, n); const foot = r.querySelector(".views-row-foot"); return foot && { classes: [...foot.children].map((c) => c.className), labels: [...foot.querySelectorAll("button")].map((b) => b.textContent), aria: [...foot.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")), buttonsShown: [...foot.querySelectorAll("button")].every((b) => getComputedStyle(b).display !== "none"), tag: r.tagName, role: r.getAttribute("role"), tabindex: r.getAttribute("tabindex") }; };
  facts.mg.rows = { live: footOf(mr, "a"), invalid: { edit: rowOf(mr, "bad").querySelector(".views-edit"), del: rowOf(mr, "bad").querySelector(".views-delete") } };
  click(rowOf(mr, "b").querySelector(".views-row-title"));
  await tick();
  facts.mg.rows.clickTitle = nameOf(mr);
  click(rowOf(mr, "a").querySelector(".views-row-description"));
  await tick();
  facts.mg.rows.clickDescription = nameOf(mr);
  click(rowOf(mr, "b"));
  await tick();
  facts.mg.rows.clickRow = nameOf(mr);
  const mrEnter = mount({ a: mgA, b: mgB });
  await tick();
  await showPanel(mrEnter);
  rowOf(mrEnter, "b").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await tick();
  facts.mg.rows.enter = nameOf(mrEnter);
  const mrEdit = mount({ a: mgA, b: mgB });
  await tick();
  await showPanel(mrEdit);
  act(mrEdit, "b", "views-edit");
  await tick();
  facts.mg.rows.editDoesNotOpen = { name: nameOf(mrEdit), card: cardOf(mrEdit) !== null };
  const mrDel = mount({ a: mgA, b: mgB });
  await tick();
  await showPanel(mrDel);
  act(mrDel, "b", "views-delete");
  await tick();
  facts.mg.rows.deleteDoesNotOpen = nameOf(mrDel);

  const me = mount({ a: mgA, b: mgB });
  await tick();
  await openFirst(me);
  const meCount = me.count();
  await showPanel(me);
  act(me, "b", "views-edit");
  await tick();
  facts.mg.edit = { replaced: rowOf(me, "b") === null && cardOf(me) !== null, fields: ["name", "title", "description"].map((f) => cardOf(me).querySelector(".view-details-" + f).value) };
  fill(me, "name", "!!");
  facts.mg.edit.badName = problemOf(me);
  fill(me, "name", "a");
  facts.mg.edit.duplicate = problemOf(me);
  fill(me, "name", "b");
  fill(me, "title", "Edited title");
  fill(me, "description", "edited description");
  click(cardOf(me).querySelector(".view-details-save"));
  await tick();
  facts.mg.edit.saved = { title: parsedOf(me, "b").title, description: parsedOf(me, "b").description, aSame: me.port.files.get("a") === mgA, open: nameOf(me), count: me.count() === meCount, note: me.notes[me.notes.length - 1], card: cardOf(me) !== null, row: rowOf(me, "b") !== null };
  act(me, "b", "views-edit");
  await tick();
  fill(me, "name", "c");
  click(cardOf(me).querySelector(".view-details-save"));
  await tick();
  facts.mg.edit.renamed = { files: [...me.port.files.keys()].sort(), renamed: me.port.renamed, notes: me.notes.filter((t) => t.startsWith("Renamed")), open: nameOf(me) };

  const mo = await modifiedView({ a: mgA, b: mgB });
  const moCount = mo.count();
  await showPanel(mo);
  act(mo, "a", "views-edit");
  await tick();
  fill(mo, "title", "Open heading");
  fill(mo, "description", "open description");
  click(cardOf(mo).querySelector(".view-details-save"));
  await tick();
  facts.mg.editOpen = { heading: mo.q(".view-heading-title") && mo.q(".view-heading-title").textContent, marker: bar(mo).marker, count: mo.count() === moCount, savedTitle: parsedOf(mo, "a").title, savedSteps: parsedOf(mo, "a").steps.length };

  const mn = mount({ a: mgA, b: mgB });
  await tick();
  await openFirst(mn);
  click(mn.q(".view-list"));
  click(mn.all(".view-item").find((n) => n.textContent.startsWith("b")));
  await tick();
  await showPanel(mn);
  act(mn, "b", "views-edit");
  await tick();
  fill(mn, "name", "z");
  click(cardOf(mn).querySelector(".view-details-save"));
  await tick();
  const mnName = nameOf(mn);
  click(mn.q(".view-back"));
  await tick();
  const mnBack = nameOf(mn);
  click(mn.q(".view-forward"));
  await tick();
  facts.mg.renameOpen = { name: mnName, back: mnBack, forward: nameOf(mn) };

  const mf = mount({ a: mgA, b: mgB }, { writeError: "disk full" });
  await tick();
  await showPanel(mf);
  act(mf, "b", "views-edit");
  await tick();
  fill(mf, "description", "will not save");
  click(cardOf(mf).querySelector(".view-details-save"));
  await tick();
  facts.mg.editFails = { card: cardOf(mf) !== null, problem: problemOf(mf), row: rowOf(mf, "b") !== null, saved: mf.notes.some((t) => t.startsWith("Saved")), file: mf.port.files.get("b") === mgB };

  const ms = mount({ a: mgA, b: mgB });
  await tick();
  await showPanel(ms);
  act(ms, "b", "views-edit");
  await tick();
  const msCard = cardOf(ms);
  fill(ms, "title", "typing");
  toggleLib(ms);
  await tick();
  facts.mg.survives = { same: cardOf(ms) === msCard, value: cardOf(ms).querySelector(".view-details-title").value };
  ms.port.edit("b", null);
  await tick();
  facts.mg.survives.goneWithRow = cardOf(ms) === null;
  act(ms, "a", "views-edit");
  await tick();
  click(ms.q(".views-panel .view-details-cancel"));
  facts.mg.survives.cancelled = cardOf(ms) === null;
  act(ms, "a", "views-edit");
  await tick();
  ms.port.edit("c", mgB);
  await tick();
  facts.mg.survives.otherRowKeeps = cardOf(ms) !== null;
  cardOf(ms).querySelector(".view-details-title").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  facts.mg.survives.escape = cardOf(ms) === null;

  const dn = mount({ a: mgA, b: mgB });
  await tick();
  await openFirst(dn);
  await showPanel(dn);
  act(dn, "b", "views-delete");
  await tick();
  facts.mg.deleteOther = { gone: !dn.port.files.has("b"), dialog: prompt(dn).shown, tray: dn.tray(), open: nameOf(dn), row: rowOf(dn, "b") !== null };
  undoNow(dn);
  await tick();
  facts.mg.deleteOther.undone = { has: dn.port.files.has("b"), row: rowOf(dn, "b") !== null, open: nameOf(dn) };

  const delOpen = async (modify) => {
    const ctx = mount({ a: mgA, b: mgB });
    await tick();
    await openFirst(ctx);
    const saved = ctx.count();
    if (modify) { toggleLib(ctx); await tick(); }
    await showPanel(ctx);
    const filesBefore = [...ctx.port.files.keys()];
    act(ctx, "a", "views-delete");
    await tick();
    return { ctx, saved, filesBefore };
  };
  const closedState = (ctx) => ({ name: nameOf(ctx), count: ctx.count(), save: bar(ctx).save, copy: !ctx.q(".view-copy").disabled, warned: warned(ctx), files: [...ctx.port.files.keys()].sort(), steps: ctx.port.files.get("b") === mgB });
  facts.mg.deleteOpen = {};
  for (const modify of [false, true]) {
    const { ctx, saved } = await delOpen(modify);
    const after = closedState(ctx);
    undoNow(ctx);
    await tick();
    facts.mg.deleteOpen[modify ? "modified" : "plain"] = { after, saved, undone: { name: nameOf(ctx), count: ctx.count(), marker: bar(ctx).marker, has: ctx.port.files.has("a"), same: ctx.port.files.get("a") === mgA } };
  }
  const dm = await delOpen(false);
  click(dm.ctx.q('.tree .row[data-path="app"] .rcheck'));
  await tick();
  const dmCount = dm.ctx.count();
  undoNow(dm.ctx);
  await tick();
  facts.mg.deleteOpen.busy = { has: dm.ctx.port.files.has("a"), name: nameOf(dm.ctx), count: dm.ctx.count() === dmCount };
  const dh = await delOpen(false);
  const dhBack = await (async () => { click(dh.ctx.q(".view-back")); await tick(); return nameOf(dh.ctx); })();
  facts.mg.deleteOpen.history = dhBack;

  const guardOpen = async (ctx, entry) => {
    if (entry === "panel") { await showPanel(ctx); click(rowOf(ctx, "b").querySelector(".views-row-title")); }
    else if (entry === "menu") { click(ctx.q(".view-list")); click(ctx.all(".view-item").find((n) => n.textContent.startsWith("b"))); }
    else { ctx.port.pending.push("b"); ctx.explorer.openLinkedView(); }
    await tick();
  };
  const guarded = async (entry, choice, options) => {
    const ctx = await modifiedView({ a: mgA, b: mgB }, options);
    const count = ctx.count();
    const notesBefore = ctx.notes.length;
    await guardOpen(ctx, entry);
    const asked = { ...prompt(ctx), name: nameOf(ctx) };
    const written = ctx.port.files.get("a") === mgA;
    if (choice === "escape") {
      ctx.q(".unsaved-dialog").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    } else if (choice === "enter") {
      ctx.q(".unsaved-dialog-save").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    } else {
      choose(ctx, choice);
    }
    await tick();
    return { asked, askedClean: written, after: { shown: prompt(ctx).shown, name: nameOf(ctx), marker: bar(ctx).marker, same: ctx.port.files.get("a") === mgA, steps: JSON.parse(ctx.port.files.get("a")).steps.length, count: ctx.count() === count, notes: ctx.notes.slice(notesBefore) } };
  };
  facts.mg.guard = {};
  for (const entry of ["panel", "menu", "link"]) {
    facts.mg.guard[entry] = { cancel: await guarded(entry, "cancel"), discard: await guarded(entry, "discard"), save: await guarded(entry, "save") };
  }
  facts.mg.guard.escape = await guarded("panel", "escape");
  facts.mg.guard.enter = await guarded("panel", "enter");
  facts.mg.guard.failed = await guarded("menu", "save", { writeError: "disk full" });

  const unguarded = async (setup) => {
    const ctx = await setup();
    return { shown: prompt(ctx).shown, name: nameOf(ctx) };
  };
  facts.mg.noGuard = {
    unmodified: await unguarded(async () => { const c = mount({ a: mgA, b: mgB }); await tick(); await openFirst(c); await guardOpen(c, "menu"); return c; }),
    untitled: await unguarded(async () => { const c = mount({ a: mgA, b: mgB }); await tick(); click(c.q('.tree .row[data-path="app"] .rcheck')); await tick(); await guardOpen(c, "menu"); return c; }),
    same: await unguarded(async () => { const c = await modifiedView({ a: mgA, b: mgB }); click(c.q(".view-list")); click(c.all(".view-item").find((n) => n.textContent.startsWith("a"))); await tick(); return c; }),
    socket: await unguarded(async () => { const c = await modifiedView({ a: mgA, b: mgB }); await c.win.drive({ action: "open-view", args: ["b"], options: {}, by: "Claude" }); await tick(); return c; }),
    back: await unguarded(async () => { const c = mount({ a: mgA, b: mgB }); await tick(); await openFirst(c); await guardOpen(c, "menu"); toggleLib(c); await tick(); click(c.q(".view-back")); await tick(); return c; }),
  };
  const nb = mount({ a: mgA, b: mgB });
  await tick();
  await openFirst(nb);
  await guardOpen(nb, "menu");
  toggleLib(nb);
  await tick();
  click(nb.q(".view-back"));
  await tick();
  click(nb.q(".view-forward"));
  await tick();
  facts.mg.noGuard.forward = { shown: prompt(nb).shown };

  const trayUpdate = async (choice) => {
    const staleB = viewText([pick("app/hub.py"), pick("lib/c.py"), pick("lib/deleted.py")], "old1234");
    const ctx = mount({ a: mgA, b: staleB });
    await tick();
    click(ctx.q(".view-list"));
    click(ctx.all(".view-item").find((n) => n.textContent.startsWith("b")));
    await tick();
    click(ctx.q(".view-list"));
    click(ctx.all(".view-item").find((n) => n.textContent.startsWith("a")));
    await tick();
    toggleLib(ctx);
    await tick();
    const trayBefore = ctx.tray().length;
    ctx.update();
    await tick();
    const asked = { ...prompt(ctx), name: nameOf(ctx) };
    choose(ctx, choice);
    await tick();
    return { trayBefore, asked, after: { shown: prompt(ctx).shown, name: nameOf(ctx), commit: JSON.parse(ctx.port.files.get("b")).commit, aSame: ctx.port.files.get("a") === mgA, tray: ctx.tray() } };
  };
  facts.mg.trayUpdate = { cancel: await trayUpdate("cancel"), discard: await trayUpdate("discard"), save: await trayUpdate("save") };

  const cc = await modifiedView({ v: text0 });
  click(clearBtn(cc));
  facts.mg.clearBody = prompt(cc);

  const PLAN_PROPOSED = [
    { module: "app/hub.py", kind: "changes" },
    { module: "app/fresh.py", kind: "new" },
    { module: "lib/m.py", kind: "moves", from: "app/a.py" },
    { module: "app/hub.py", member: "Hub.run", kind: "changes" },
    { module: "app/hub.py", member: "Hub.fresh", kind: "new" },
  ];
  const planNotes = [
    { module: "app/hub.py", text: "First", by: "Ken" },
    { module: "app/a.py", text: "Second", by: "Ken" },
    { module: "lib/c.py", text: "Third", by: "Ken" },
  ];
  const planText = (plan) => JSON.stringify({ schema_version: 4, description: "d", commit: "old1234", ...(plan ? { plan: true } : {}), notes: planNotes, ...(plan ? { proposed: PLAN_PROPOSED } : {}), steps: [pick("app/hub.py"), pick("app/a.py"), pick("lib/c.py")] }, null, 2) + "\\n";
  const planFacts = async (plan) => {
    const ctx = mount({ plan: planText(plan) });
    await tick();
    await openFirst(ctx);
    const stages = {};
    const read = (stage) => {
      const text = ctx.port.files.get("plan");
      const parsed = parseViewFile(text);
      const file = JSON.parse(text);
      stages[stage] = { ok: parsed.ok, plan: file.plan, proposed: file.proposed, picks: file.steps.filter((step) => step.kind === "pick").map((step) => step.module), notes: (file.notes || []).map((n) => n.module), title: file.title, commit: file.commit };
    };
    ctx.update();
    await tick();
    read("update");
    toggleLib(ctx);
    await tick();
    click(ctx.q(".view-save"));
    await tick();
    read("save");
    click(ctx.q(".view-name"));
    typeInto(ctx.q(".view-details-title"), "A title");
    await tick();
    click(ctx.q(".view-details-save"));
    await tick();
    read("details");
    const target = plan ? "app/fresh.py" : "lib/e.py";
    click(ctx.q('.box[data-id="' + target + '"] .box-body'));
    await tick();
    key("n");
    await tick();
    typeInto(ctx.q(".note-bubble textarea"), "A fresh note");
    click([...ctx.all(".note-bubble button")].find((b) => b.textContent === "Save"));
    await tick();
    read("note");
    click(ctx.q(".rail-notes"));
    await tick();
    const rows = ctx.all(".note-row");
    const handle = rows[0];
    const lastRow = rows[rows.length - 1].getBoundingClientRect();
    const start = handle.getBoundingClientRect();
    const fire = (type, clientY) => handle.dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true, clientX: start.left + 30, clientY }));
    fire("pointerdown", start.top + start.height / 2);
    for (let i = 1; i <= 5; i += 1) { fire("pointermove", start.top + (((lastRow.bottom - 2) - start.top) * i) / 5); await tick(10); }
    fire("pointerup", lastRow.bottom - 2);
    await tick(80);
    read("reorder");
    return stages;
  };
  facts.planSaves = await planFacts(true);
  facts.plainSaves = await planFacts(false);

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

async function collect(): Promise<Facts> {
  return collectFacts<Facts>(HARNESS, "explorer-views", "light", "app");
}

describe.skipIf(webkit === undefined)("saved views in the explorer", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collect();
  }, scaledTimeout(180000));

  it("leads each Views panel row with the title and marks the open row without a glyph", () => {
    const r = f.rows;
    expect(r.titledOrder).toEqual([
      "views-row-title",
      "views-row-name",
      "views-row-description",
      "views-row-foot",
    ]);
    expect(r.clamp).toBe("3");
    expect(r.clampedLines).toBeLessThanOrEqual(3);
    expect(r.openBefore === "none" || r.openBefore === "normal").toBe(true);
    expect(r.openTitle).toBe(r.selection);
    expect(r.openBorder).toBe(r.selection);
    expect(r.openBackground).not.toBe("rgba(0, 0, 0, 0)");
    expect(r.chips).toBe(0);
    expect(r.quietOrder).toEqual([
      "views-row-title",
      "views-row-name",
      "views-row-description",
      "views-row-foot",
    ]);
    expect(r.plainOrder).toEqual([
      "views-row-title",
      "views-row-description",
      "views-row-foot",
    ]);
    expect(r.plainTitle).toBe("plain");
    expect(r.changedMeta).toBe("Changes aaaaaaa to bbbbbbb \u00b7 2 notes");
    expect(r.invalidTag).toBe("DIV");
    expect(r.invalidOrder).toEqual(["views-row-title", "views-row-reason"]);
    expect(r.staleOrder).toEqual([
      "views-row-title",
      "views-row-name",
      "views-row-description",
      "views-row-reason",
      "views-delete",
    ]);
  });

  it("(non-gating) pads each Views panel row 8px 10px with a 4px gap", () => {
    expect(f.rows.padding).toBe("8px 10px");
    expect(f.rows.gap).toBe(4);
  });

  it("opens on an empty canvas with an Untitled view and no saved views", () => {
    expect(f.emptyStart.count).toBe(0);
    expect(f.emptyStart.view).toBe("Untitled");
    expect(f.emptyStart.menuEmpty).toContain("No saved views");
    expect(f.emptyStart.writes).toBeGreaterThan(0);
    expect(f.emptyStart.spinnerDisplay).toBe("none");
  });

  it("shows no menu or dialog in a fresh window", () => {
    expect(f.freshOverlays).toEqual({
      menu: false,
      dialog: false,
    });
  });

  it("saves a valid view file of picks at the scan's commit", () => {
    expect(f.dialog.labels).toEqual(["Name", "Title", "Description"]);
    expect(f.dialog.hint).toBe("What it shows");
    expect(f.dialog.disabled).toBe(true);
    expect(f.stillDisabled).toBe(true);
    expect(f.enabled).toBe(true);
    expect(f.saved.valid).toBe(true);
    expect(f.saved.steps).toEqual([
      { kind: "pick", module: "app/a.py" },
      { kind: "pick", module: "app/hub.py" },
    ]);
    expect(f.saved.commit).toBe("cur1234");
    expect(f.saved.description).toBe("the app folder");
    expect(f.saved.text.endsWith("\n")).toBe(true);
    expect(f.nameAfterSave).toBe("overview");
    expect(f.currentAfterSave.view).toBe("overview");
  });

  it("restores the canvas when the view is opened from the menu", () => {
    expect(f.cleared).toBe(0);
    expect(f.menu).toHaveLength(1);
    expect(f.menu[0]).toContain("overview");
    expect(f.menu[0]).toContain("the app folder");
    expect(f.reopened.count).toBe(2);
    expect(f.reopened.footer).toContain("2 of 5");
    expect(f.reopened.name).toBe("overview");
  });

  it("publishes the window state after each change", () => {
    expect(f.afterPutOn.modules).toEqual(["app/a.py", "app/hub.py"]);
    expect(f.afterPutOn.view).toBeNull();
    expect(f.selection).toEqual({ kind: "module", id: expect.any(String) });
  });

  it("walks back and forward over modules and selection", () => {
    expect(f.afterBackSelection.current).toBeNull();
    expect(f.afterBackSelection.selected).toEqual([]);
    expect(f.afterForwardSelection.current).toEqual(f.selection);
    expect(f.afterForwardSelection.selected).toHaveLength(1);
    expect(f.afterTwoBack.count).toBe(0);
    expect(f.afterTwoBack.modules).toEqual([]);
    expect(f.afterForward.count).toBe(2);
  });

  it("publishes a folded folder and drops it on unfolding", () => {
    expect(f.afterFold).toEqual(["app"]);
    expect(f.afterUnfold).toEqual([]);
  });

  it("copies the link of the open view and names it", () => {
    expect(f.copyDisabled).toBe(false);
    expect(f.copied).toEqual(["recognizer://open?repo=%2Frepo&view=overview"]);
    expect(f.copyNote).toBe(
      "Copied recognizer://open?repo=%2Frepo&view=overview",
    );
  });

  it("applies an agent's edit without a click and keeps the canvas on an invalid one", () => {
    expect(f.agentEdit).toBe(3);
    expect(f.invalidEdit.count).toBe(3);
    expect(f.invalidEdit.notice).toContain("overview is not a valid view");
    expect(f.retried.count).toBe(1);
    expect(f.retried.quiet).toBe(true);
    expect(f.deleted.count).toBe(1);
    expect(f.deleted.name).toBe("Untitled");
    expect(f.deleted.notice).toContain("overview was deleted");
  });

  it("restores no view when Back reaches a step naming a deleted view", () => {
    expect(f.backToDeleted).toBe("Untitled");
  });

  it("opens a stale view drawing nothing on the canvas and posting one message with Update", () => {
    expect(f.stale.panel).toBe(false);
    expect(f.stale.kids).toBe(true);
    expect(f.stale.count).toBe(3);
    expect(f.stale.tray).toEqual([
      {
        text: "stale is out of date. Since old1234, deleted.py was renamed to e.py, 1 relation changed and d.py became relevant.",
        actions: ["Update"],
      },
    ]);
    expect(f.stale.badge).toEqual({ hidden: false, count: "1" });
  });

  it("compares the same pair once and posts once when the view is opened again", () => {
    expect(f.reopened2).toEqual({ tray: 1, scans: 1, renames: 1 });
  });

  it("updates the file with the rename followed and moves the commit, then withdraws the message", () => {
    expect(f.updated.valid).toBe(true);
    expect(f.updated.steps).toEqual([
      { kind: "pick", module: "app/hub.py" },
      { kind: "pick", module: "lib/c.py" },
      { kind: "pick", module: "lib/e.py" },
    ]);
    expect(f.updated.commit).toBe("cur1234");
    expect(f.updated.count).toBe(3);
    expect(f.updated.tray).toEqual([]);
    expect(f.updated.badge.hidden).toBe(true);
  });

  it("follows the rename on Update for a view opened from the menu", () => {
    expect(f.second).toHaveLength(1);
    expect(f.droppedUpdate.steps).toEqual([
      { kind: "pick", module: "app/hub.py" },
      { kind: "pick", module: "lib/c.py" },
      { kind: "pick", module: "lib/e.py" },
    ]);
    expect(f.droppedUpdate.commit).toBe("cur1234");
    expect(f.droppedUpdate.tray).toEqual([]);
  });

  it("posts nothing for a view at the scan commit", () => {
    expect(f.currentView).toEqual([]);
  });

  it("gives two rows with different texts for two out-of-date views and none for the current one", () => {
    expect(f.mixed.map((row: { text: string }) => row.text)).toEqual([
      "two is out of date. Since old1234, deleted.py is missing and 2 modules became relevant.",
      "one is out of date. Since old1234, deleted.py is missing, 1 relation changed and d.py became relevant.",
    ]);
  });

  it("draws the canvas before the commit comparison arrives and posts after it", () => {
    expect(f.late.count).toBe(2);
    expect(f.late.tray).toBe(0);
    expect(f.lateDone).toHaveLength(1);
    expect(f.lateDone[0].actions).toEqual(["Update"]);
  });

  it("says the view could not be compared, with no action, when the commit cannot be scanned", () => {
    expect(f.unavailable).toEqual([
      {
        text: "Could not compare gone with old1234. That commit could not be scanned.",
        actions: [],
      },
    ]);
  });

  it("draws the bar with 16px stroke icons labelled and titled, and a chevron after the name", () => {
    for (const [selector, entry] of Object.entries(f.barLook.labels) as [
      string,
      {
        aria: boolean;
        title: boolean;
        text: string;
        width: number;
        stroke: string;
      },
    ][]) {
      expect(entry.aria, selector).toBe(true);
      expect(entry.title, selector).toBe(true);
      expect(entry.text, selector).toBe("");
      expect(entry.width, selector).toBe(16);
      expect(entry.stroke, selector).toBe("2px");
    }

    expect(f.barLook.nameText).toBe("Untitled");
    expect(Number(f.barLook.weight)).toBeGreaterThanOrEqual(600);
    expect(f.barLook.chevron).toBe(12);
  });

  it("puts the saved-views list on its own folder-open button with a chevron before the name", () => {
    expect(f.barLook.labels[".view-list"].aria).toBe(true);
    expect(f.barLook.labels[".view-list"].title).toBe(true);
    expect(f.barLook.nameChevron).toBe(false);
  });

  it("opens one card with the three fields filled from the open view and Save disabled", () => {
    expect(f.editing).toEqual({
      card: true,
      name: "alpha",
      title: "",
      description: "d",
      saveDisabled: true,
      nameVisible: true,
      inlineFields: 0,
      descriptionTag: "TEXTAREA",
      focused: true,
    });
  });

  it("shows the draft title and description in the heading while typing", () => {
    expect(f.headingBefore.title).toBe("");
    expect(f.preview.heading).toEqual({
      title: "Draft title",
      description: "Draft description",
    });
    expect(f.preview.saveDisabled).toBe(false);
  });

  it("restores the heading on Escape, on a click outside and on Cancel", () => {
    expect(f.escaped).toEqual({
      card: false,
      heading: f.headingBefore,
      name: "alpha",
      renamed: 0,
    });
    expect(f.outside).toEqual({ card: false, heading: f.headingBefore });
    expect(f.cancelled.card).toBe(false);
    expect(f.cancelled.heading).toEqual(f.headingBefore);
    expect(JSON.parse(f.cancelled.written).title).toBeUndefined();
  });

  it("refuses a taken, empty or malformed name under the field and disables Save", () => {
    expect(f.taken.problem).toBe("beta already exists");
    expect(f.taken.invalid).toBe("true");
    expect(f.taken.saveDisabled).toBe(true);
    expect(f.taken.renamed).toBe(0);
    expect(f.taken.files).toEqual(["alpha", "beta"]);
    expect(f.emptyName).toEqual({
      problem: "A view needs a name",
      saveDisabled: true,
    });
    expect(f.badName.problem).toContain("Use letters");
    expect(f.badName.saveDisabled).toBe(true);
    expect(f.badName.renamed).toBe(0);
  });

  it("does not call the view's own name a clash and disables Save for a blank description", () => {
    expect(f.ownName).toEqual({ problem: "", saveDisabled: false });
    expect(f.blankDescription.saveDisabled).toBe(true);
  });

  it("does not commit on blur", () => {
    expect(f.blurred).toEqual({ card: true, renamed: 0, title: null });
  });

  it("saves the name, title and description in one action on Cmd+Enter in the description", () => {
    expect(f.plainEnter).toEqual({ card: true, renamed: 0 });
    expect(f.renamed.card).toBe(false);
    expect(f.renamed.name).toBe("gamma");
    expect(f.renamed.port).toEqual([{ from: "alpha", to: "gamma" }]);
    expect(f.renamed.saved.title).toBe("T3");
    expect(f.renamed.saved.description).toBe("D3");
    expect(f.renamed.notice).toContain("Renamed alpha to gamma");
    expect(f.renamed.notice).toContain("Saved gamma");
    expect(f.renamed.heading).toEqual({ title: "T3", description: "D3" });
  });

  it("saves on Enter in Title and in Name, and a blank title removes the title", () => {
    expect(f.enterTitle).toEqual({ card: false, title: "T4" });
    expect(f.enterName).toEqual({
      card: false,
      description: "D5",
      renamed: 1,
    });
    expect(f.clearedTitle.hasTitle).toBe(false);
  });

  it("marks the open dropdown item by selection colours with no glyph", () => {
    expect(
      f.currentItem.before === "none" || f.currentItem.before === "normal",
    ).toBe(true);
    expect(f.currentItem.name).toBe(f.currentItem.selection);
    expect(f.currentItem.background).toBe(f.currentItem.selectionBackground);
  });

  it("follows the rename everywhere", () => {
    expect(f.renamed.files).toEqual(["beta", "gamma"]);
    expect(f.renamed.menu).toEqual(["beta", "gamma"]);
    expect(f.renamed.current).toEqual(["gamma"]);
    expect(f.renamed.currentView).toBe("gamma");
    expect(f.renamed.wrote).toBe(true);
    expect(f.renamed.notice).not.toContain("deleted");
    expect(f.afterRenameBack).toBe("gamma");
  });

  it("opens the card with Name empty for an Untitled view and saves through saveNew", () => {
    expect(f.untitledField).toBe("");
    expect(f.untitledFocus).toBe(true);
    expect(f.untitledTaken.problem).toContain("taken already exists");
    expect(f.untitledTaken.saveDisabled).toBe(true);
    expect(f.untitledTaken.dialog).toBe(false);
    expect(f.untitledNamed).toEqual({
      saveDisabled: false,
      dialog: false,
      written: ["taken"],
    });
    expect([...f.untitledSaved.files].sort()).toEqual(["fresh", "taken"]);
    expect(f.untitledSaved.name).toBe("fresh");
    expect(f.untitledSaved.card).toBe(false);
    expect(f.untitledSaved.file.description).toBe("shows fresh");
  });

  it("lists the saved views the port holds at startup in the menu", () => {
    expect(f.listedMenu.hidden).toBe(false);
    expect(f.listedMenu.expanded).toBe("true");
    expect(f.listedMenu.items).toHaveLength(1);
    expect(f.listedMenu.items[0]).toContain("listed");
  });

  it("closes the menu on Escape, on a click outside it and on choosing a view, and not on a click inside the bar", () => {
    expect(f.afterEscape.hidden).toBe(true);
    expect(f.afterEscape.expanded).toBe("false");
    expect(f.afterOutside).toBe(true);
    expect(f.afterInside).toBe(false);
    expect(f.afterChoose).toBe(true);
  });

  it("keeps the dialog open with its values and says why when a save fails, in a wrapping three-line description", () => {
    expect(f.failedSave.dialogOpen).toBe(true);
    expect(f.failedSave.name).toBe("keep");
    expect(f.failedSave.description).toBe(
      "a long description kept after a failure",
    );
    expect(f.failedSave.problem).toContain("disk full");
    expect(f.failedSave.notice).toContain("Could not save keep");
    expect(f.failedSave.tag).toBe("TEXTAREA");
    expect(f.failedSave.rows).toBe(3);
    expect(f.failedSave.wrapsInside).toBe(true);
    expect(f.failedSave.enabled).toBe(true);
  });

  it("posts a failed list as a message and never says there are no saved views", () => {
    expect(f.failedList.noticeShown).toBe(true);
    expect(f.failedList.notice).toContain("Could not list saved views");
    expect(f.failedList.notice).toContain("no folder");
    expect(f.failedList.menu).toContain(
      "could not be listed: Error: no folder",
    );
    expect(f.failedList.menu).not.toContain("No saved views");
  });

  it("posts a view file the list refused as a message and still lists the rest", () => {
    expect(f.refusedList.notice).toContain("views/x.json: unreadable");
    expect(f.refusedList.items).toBe(1);
  });

  it("shows no warning for a view at the current commit and records only picks on save", () => {
    expect(f.sameCommit.tray).toBe(0);
    expect(f.sameCommit.count).toBe(1);
    expect(f.resaved.description).toBe("d");
    expect(f.resaved.steps).toEqual([
      { kind: "pick", module: "app/hub.py" },
      { kind: "pick", module: "lib/c.py" },
      { kind: "pick", module: "lib/d.py" },
      { kind: "pick", module: "lib/e.py" },
    ]);
  });
  it("shows a muted modified marker and enables Save only while the canvas differs from the saved file", () => {
    expect(f.revert.fresh).toMatchObject({ marker: false, save: false });
    expect(f.revert.modified.bar).toMatchObject({ marker: true, save: true });
    expect(f.revert.clearedByHand.bar).toMatchObject({
      marker: false,
      save: false,
    });
    expect(f.revert.clearedByHand.count).toBe(f.revert.freshCount);
  });

  it("puts a 16px rotate-ccw Revert beside Save, disabled when nothing differs", () => {
    expect(f.revert.afterSave).toBe(true);
    expect(f.revert.icon.width).toBe(16);
    expect(f.revert.icon.paths).toEqual([
      "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",
      "M3 3v5h5",
    ]);
    expect(f.revert.fresh).toMatchObject({
      revertShown: true,
      revertEnabled: false,
    });
  });

  it("reverts a modified view to its saved modules and fitted framing and offers Undo", () => {
    expect(f.revert.modified.bar).toMatchObject({
      revertEnabled: true,
      label: "Revert to saved",
      aria: "Revert to saved",
    });
    expect(f.revert.beforeRevert.moved).toBe(true);
    expect(f.revert.reverted.count).toBe(1);
    expect(f.revert.reverted.fitted).toBe(true);
    expect(f.revert.reverted.bar).toMatchObject({
      marker: false,
      save: false,
      revertEnabled: false,
    });
    expect(f.revert.reverted.rows).toEqual([
      { text: "Reverted v to its saved version.", actions: ["Undo"] },
    ]);
  });

  it("undoes a revert to the modules and camera from just before it", () => {
    expect(f.revert.undone.count).toBe(f.revert.beforeRevert.count);
    expect(f.revert.undone.camera).toBe(true);
    expect(f.revert.undone.bar.marker).toBe(true);
  });

  it("does nothing on Undo once another view is open", () => {
    expect(f.revert.guard.name).toBe("w");
    expect(f.revert.guard.after).toBe(f.revert.guard.wCount);
  });

  it("restores only the camera, without a message, when the view was only panned or zoomed", () => {
    expect(f.revert.cameraOnly.moved).toBe(true);
    expect(f.revert.cameraOnly.bar).toMatchObject({
      marker: false,
      save: false,
      revertEnabled: true,
      label: "Back to the saved position",
    });
    expect(f.revert.cameraRestored.fitted).toBe(true);
    expect(f.revert.cameraRestored.tray).toBe(0);
    expect(f.revert.cameraRestored.bar.revertEnabled).toBe(false);
  });

  it("gives an unsaved view no Revert and a Save that opens the naming dialog", () => {
    expect(f.revert.unsaved).toMatchObject({
      revertShown: false,
      marker: false,
      save: true,
    });
    expect(f.revert.unsavedDialog).toBe(true);
  });

  it("clears the marker when a modified view is saved", () => {
    expect(f.revert.savedClears.bar).toMatchObject({
      marker: false,
      save: false,
    });
    expect(f.revert.savedClears.steps).toBe(4);
  });

  it("reads a view with a renamed pick as modified on opening and clears it on Revert", () => {
    expect(f.revert.renamedPick.opened.bar.marker).toBe(true);
    expect(f.revert.renamedPick.opened.count).toBe(2);
    expect(f.revert.renamedPick.reverted.bar.marker).toBe(false);
    expect(f.revert.renamedPick.reverted.count).toBe(1);
  });

  it("closes an unmodified loaded view at once on Clear, writing nothing", () => {
    expect(f.clr.unmodified).toMatchObject({
      name: "Untitled",
      marker: false,
      save: false,
      revertShown: false,
      copy: false,
      count: 0,
      prompt: false,
      file: true,
      newNotes: 0,
    });
  });

  it("asks before clearing a modified view and leaves everything on Cancel", () => {
    expect(f.clr.asked.prompt).toMatchObject({
      shown: true,
      heading: "Save changes to v?",
      buttons: ["Cancel", "Don't save", "Save"],
      focused: true,
      body: "Clearing closes the view. Your changes since it was saved will be lost unless you save them.",
      inCanvas: false,
      inExplorer: true,
    });
    expect(f.clr.asked.count).toBe(true);
    expect(f.clr.asked.file).toBe(true);
    expect(f.clr.cancelled).toMatchObject({
      name: "v",
      marker: true,
      save: true,
      prompt: false,
      count: true,
      camera: true,
    });
  });

  it("keeps the prompt open across a pan or zoom", () => {
    expect(f.clr.afterPan).toEqual({ prompt: true, moved: true });
  });

  it("closes without writing on Don't save and Back returns the unsaved canvas", () => {
    expect(f.clr.discarded).toMatchObject({
      name: "Untitled",
      count: 0,
      prompt: false,
      file: true,
      note: "Closed v. The saved view is unchanged.",
    });
    expect(f.clr.backAfterDiscard).toEqual({
      name: "v",
      marker: true,
      count: true,
    });
  });

  it("writes then closes on Save with one toast, and Back returns the view", () => {
    expect(f.clr.saved).toMatchObject({
      name: "Untitled",
      count: 0,
      changed: true,
      notes: ["Saved v and closed it."],
    });
    expect(f.clr.saved.steps).toBeGreaterThan(1);
    expect(f.clr.backAfterSave).toMatchObject({ name: "v", marker: false });
    expect(f.clr.backAfterSave.count).toBeGreaterThan(0);
  });

  it("keeps the view open and modified when the prompt's Save fails", () => {
    expect(f.clr.failed).toMatchObject({
      name: "v",
      marker: true,
      prompt: false,
      count: true,
      file: true,
    });
    expect(f.clr.failed.notes.join(" ")).toContain("disk full");
    expect(f.clr.failed.notes.join(" ")).not.toContain("closed it");
  });

  it("dismisses the prompt when the view is reverted, undone by hand or another is opened", () => {
    expect(f.clr.dismissRevert).toEqual({ prompt: false, name: "v" });
    expect(f.clr.dismissByHand).toBe(false);
    expect(f.clr.dismissOpen).toEqual({ prompt: false, name: "Untitled" });
  });

  it("empties the canvas with no prompt when no view is loaded, then disables Save", () => {
    expect(f.clr.noView.before.save).toBe(true);
    expect(f.clr.noView.after).toMatchObject({
      name: "Untitled",
      count: 0,
      save: false,
      prompt: false,
    });
  });

  it("chooses cancel on Escape", () => {
    expect(f.clr.escape).toBe(false);
  });

  it("shows Edit and Delete on a live row's bottom line, Delete only on a stale row and neither on an invalid one", () => {
    const row = f.mg.rows.live;
    expect(row.classes).toEqual([
      "views-row-meta",
      "views-edit",
      "views-delete",
    ]);
    expect(row.labels).toEqual(["Edit", "Delete"]);
    expect(row.aria).toEqual(["Edit a", "Delete a"]);
    expect(row.buttonsShown).toBe(true);
    expect(row).toMatchObject({ tag: "DIV", role: "button", tabindex: "0" });
    expect(f.mg.rows.invalid).toEqual({ edit: null, del: null });
  });

  it("opens a live row on a click anywhere but its buttons and on Enter", () => {
    expect(f.mg.rows.clickTitle).toBe("b");
    expect(f.mg.rows.clickDescription).toBe("a");
    expect(f.mg.rows.clickRow).toBe("b");
    expect(f.mg.rows.enter).toBe("b");
    expect(f.mg.rows.editDoesNotOpen).toEqual({ name: "Untitled", card: true });
    expect(f.mg.rows.deleteDoesNotOpen).toBe("Untitled");
  });

  it("edits a view that is not open in place and saves only its details", () => {
    const e = f.mg.edit;
    expect(e.replaced).toBe(true);
    expect(e.fields).toEqual(["b", "", "d"]);
    expect(e.badName).toBe(
      "Use letters, digits, - and _, starting with a letter or digit (64 at most)",
    );
    expect(e.duplicate).toBe("a already exists");
    expect(e.saved).toMatchObject({
      title: "Edited title",
      description: "edited description",
      aSame: true,
      open: "a",
      count: true,
      note: "Saved b",
      card: false,
      row: true,
    });
    expect(e.renamed.files).toEqual(["a", "c"]);
    expect(e.renamed.renamed).toEqual([{ from: "b", to: "c" }]);
    expect(e.renamed.notes).toEqual(["Renamed b to c"]);
    expect(e.renamed.open).toBe("a");
  });

  it("edits the open view's details without touching a modified canvas", () => {
    expect(f.mg.editOpen.heading).toBe("Open heading");
    expect(f.mg.editOpen.marker).toBe(true);
    expect(f.mg.editOpen.count).toBe(true);
    expect(f.mg.editOpen.savedTitle).toBe("Open heading");
    expect(f.mg.editOpen.savedSteps).toBe(1);
  });

  it("renames the open view from the panel and keeps Back and Forward on it", () => {
    expect(f.mg.renameOpen).toEqual({ name: "z", back: "a", forward: "z" });
  });

  it("keeps the card and shows the error when the edit cannot be written", () => {
    expect(f.mg.editFails.card).toBe(true);
    expect(f.mg.editFails.problem).toContain("disk full");
    expect(f.mg.editFails.row).toBe(false);
    expect(f.mg.editFails.saved).toBe(false);
    expect(f.mg.editFails.file).toBe(true);
  });

  it("keeps the card and what was typed across re-renders, and drops it with its row or on Cancel and Escape", () => {
    expect(f.mg.survives.same).toBe(true);
    expect(f.mg.survives.value).toBe("typing");
    expect(f.mg.survives.goneWithRow).toBe(true);
    expect(f.mg.survives.cancelled).toBe(true);
    expect(f.mg.survives.otherRowKeeps).toBe(true);
    expect(f.mg.survives.escape).toBe(true);
  });

  it("deletes a live view that is not open at once, with Undo and no dialog", () => {
    const d = f.mg.deleteOther;
    expect(d.gone).toBe(true);
    expect(d.dialog).toBe(false);
    expect(d.open).toBe("a");
    expect(d.row).toBe(false);
    expect(d.tray).toEqual([{ text: "Deleted b", actions: ["Undo"] }]);
    expect(d.undone).toEqual({ has: true, row: true, open: "a" });
  });

  it("closes the open view to an empty canvas when it is deleted, and Undo reopens its saved version", () => {
    for (const kind of ["plain", "modified"]) {
      const d = f.mg.deleteOpen[kind];
      expect(d.after).toEqual({
        name: "Untitled",
        count: 0,
        save: false,
        copy: false,
        warned: false,
        files: ["b"],
        steps: true,
      });
      expect(d.undone).toEqual({
        name: "a",
        count: d.saved,
        marker: false,
        has: true,
        same: true,
      });
    }
  });

  it("restores only the file on Undo once something is on the canvas, and records one history step", () => {
    expect(f.mg.deleteOpen.busy).toEqual({
      has: true,
      name: "Untitled",
      count: true,
    });
    expect(f.mg.deleteOpen.history).toBe("Untitled");
  });

  it("asks before opening another view over a modified one from the panel, the drop-down and a link", () => {
    for (const entry of ["panel", "menu", "link"]) {
      const g = f.mg.guard[entry];
      expect(g.cancel.asked).toMatchObject({
        shown: true,
        heading: "Save changes to a?",
        body: "Opening b closes a. Your changes since it was saved will be lost unless you save them.",
        buttons: ["Cancel", "Don't save", "Save"],
        focused: true,
        inCanvas: false,
        inExplorer: true,
        name: "a",
      });
      expect(g.cancel.after).toMatchObject({
        shown: false,
        name: "a",
        marker: true,
        same: true,
        count: true,
      });
      expect(g.discard.after).toMatchObject({
        shown: false,
        name: "b",
        same: true,
      });
      expect(g.save.after).toMatchObject({
        shown: false,
        name: "b",
        same: false,
      });
      expect(g.save.after.steps).toBeGreaterThan(1);
      expect(g.save.after.notes).toContain("Saved a");
    }
  });

  it("asks before the tray's Update opens another view over a modified one and updates it once opened", () => {
    const t = f.mg.trayUpdate;
    for (const choice of ["cancel", "discard", "save"]) {
      expect(t[choice].trayBefore).toBe(1);
      expect(t[choice].asked).toMatchObject({
        shown: true,
        heading: "Save changes to a?",
        body: "Opening b closes a. Your changes since it was saved will be lost unless you save them.",
        name: "a",
      });
      expect(t[choice].after.shown).toBe(false);
    }
    expect(t.cancel.after).toMatchObject({
      name: "a",
      commit: "old1234",
      aSame: true,
    });
    for (const choice of ["discard", "save"]) {
      expect(t[choice].after).toMatchObject({ name: "b", commit: "cur1234" });
      expect(
        t[choice].after.tray.flatMap(
          (row: { actions: string[] }) => row.actions,
        ),
      ).toEqual([]);
    }
    expect(t.discard.after.aSame).toBe(true);
    expect(t.save.after.aSame).toBe(false);
  });

  it("cancels on Escape, saves on Enter and stays put when the guard's Save cannot be written", () => {
    expect(f.mg.guard.escape.after).toMatchObject({
      shown: false,
      name: "a",
      marker: true,
      same: true,
    });
    expect(f.mg.guard.enter.after).toMatchObject({
      shown: false,
      name: "b",
      same: false,
    });
    expect(f.mg.guard.failed.after).toMatchObject({
      shown: false,
      name: "a",
      marker: true,
      same: true,
    });
    expect(f.mg.guard.failed.after.notes.join(" ")).toContain("disk full");
    expect(f.mg.guard.failed.after.notes).not.toContain("Saved a");
  });

  it("opens without a dialog for an unmodified view, an unsaved canvas, the open view, Back, Forward and the socket", () => {
    expect(f.mg.noGuard.unmodified).toEqual({ shown: false, name: "b" });
    expect(f.mg.noGuard.untitled).toEqual({ shown: false, name: "b" });
    expect(f.mg.noGuard.same).toEqual({ shown: false, name: "a" });
    expect(f.mg.noGuard.socket).toEqual({ shown: false, name: "b" });
    expect(f.mg.noGuard.back.shown).toBe(false);
    expect(f.mg.noGuard.forward.shown).toBe(false);
  });

  it("uses the same dialog for Clear with the Clear body", () => {
    expect(f.mg.clearBody).toMatchObject({
      shown: true,
      heading: "Save changes to v?",
      body: "Clearing closes the view. Your changes since it was saved will be lost unless you save them.",
      inExplorer: true,
      inCanvas: false,
    });
  });

  it("keeps a plan and every proposed change through update, Save, a title edit, a note write and a reorder", () => {
    const proposed = [
      { module: "app/hub.py", kind: "changes" },
      { module: "app/fresh.py", kind: "new" },
      { module: "lib/m.py", kind: "moves", from: "app/a.py" },
      { module: "app/hub.py", member: "Hub.run", kind: "changes" },
      { module: "app/hub.py", member: "Hub.fresh", kind: "new" },
    ];

    for (const stage of ["update", "save", "details", "note", "reorder"]) {
      const saved = f.planSaves[stage];

      expect(saved.ok, stage).toBe(true);
      expect(saved.plan, stage).toBe(true);
      expect(saved.proposed, stage).toEqual(proposed);
      expect(saved.picks, stage).not.toContain("app/fresh.py");
      expect(saved.picks, stage).not.toContain("lib/m.py");
    }

    expect(f.planSaves.update.commit).toBe("cur1234");
    expect(f.planSaves.save.picks).toContain("lib/e.py");
    expect(f.planSaves.details.title).toBe("A title");
    expect(f.planSaves.note.notes).toContain("app/fresh.py");
    expect(f.planSaves.reorder.notes).not.toEqual(f.planSaves.note.notes);
  });

  it("writes no plan or proposed key for a plain view through the same sequence", () => {
    for (const stage of ["update", "save", "details", "note", "reorder"]) {
      const saved = f.plainSaves[stage];

      expect(saved.ok, stage).toBe(true);
      expect(saved.plan, stage).toBeUndefined();
      expect(saved.proposed, stage).toBeUndefined();
    }
  });
});
