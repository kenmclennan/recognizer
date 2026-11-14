import { beforeAll, describe, expect, it } from "vitest";
import { collectFacts, FAKE_WORKER, here, webkit } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, mountExplorer } from ${JSON.stringify(here("look-support.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
import { fakeCommits } from ${JSON.stringify(here("commits-fake.ts"))};
${FAKE_WORKER}
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};

const IDS = ["p/a.py", "p/b.py", "p/c.py", "p/d.py"];
const edge = { from: "p/a.py", to: "p/b.py", kind: "depends", line: 1, names: ["f"] };
const selection = { extensions: [".py"], skip_directory_names: [], skip_directory_prefixes: [], skip_directory_suffixes: [], skip_directories_containing: [], skip_directory_globs: [], skip_file_globs: [] };
const scan = { commit: "cur1234", selection, modules: IDS.map((id) => ({ id, kind: "module" })), edges: [edge], foreign: [] };
const loaded = loadedOf({ modules: IDS, scans: [{ file: "scan.json", scan }] });

const sha = (c) => c.repeat(40);
const RS = String.fromCharCode(30);
const US = String.fromCharCode(31);
const record = (c, parent, subject, deco, files) => RS + [sha(c), c.repeat(7), parent === null ? "" : sha(parent), "Ken", "1700000000", subject, deco].join(US) + "\\n\\n" + files.map((f) => f + "\\n").join("");
const HISTORY = record("a", "b", "Newest", "HEAD -> main, origin/main", ["M\\tp/a.py"]) + record("b", "c", "Middle", "", ["A\\tp/b.py"]) + record("c", "d", "Older", "", ["M\\tp/c.py"]) + record("d", "e", "Oldest", "tag: v0.1.0", ["D\\tp/d.py"]) + record("e", null, "Root", "", ["A\\tp/a.py"]);
const BRANCHES = ["main", "feature/x", "spike"].map((name, i) => [name, String(i).repeat(7), "Ken", "1699000000"].join(US) + "\\n").join("");
const PRS = JSON.stringify([{ number: 9, title: "Gift cards", headRefName: "feature/x", headRefOid: sha("f"), author: { login: "lc" }, updatedAt: "2026-11-10T10:00:00Z", isDraft: false, statusCheckRollup: [] }, { number: 10, title: "Docs only", headRefName: "docs/only", headRefOid: sha("9"), author: { login: "lc" }, updatedAt: "2026-11-10T09:00:00Z", isDraft: false, statusCheckRollup: [] }]);
const ch = (status, path) => ({ status, path });
const facts = (ref, mergeBase, changes) => ({ ref, mergeBase, behind: 1, ahead: 2, changes });
const FX = [ch("M", "p/a.py"), ch("A", "p/b.py"), ch("D", "p/zzz.py"), ch("A", "docs/x.md")];
const mem = () => { const store = new Map(); return { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), store }; };
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const make = (extra, steps) => JSON.stringify({ schema_version: 4, description: "d", commit: "cur1234", ...extra, steps: steps || [{ kind: "pick", module: "p/a.py" }] }, null, 2) + "\\n";

function mount(options = {}, files = {}) {
  const host = document.createElement("div");
  host.style.cssText = "width:1400px;height:800px;display:flex;flex-direction:column";
  document.body.append(host);
  const views = fakeViews(files);
  const commits = fakeCommits({
    history: { branch: "main", text: options.history || HISTORY },
    branches: { defaultRef: "origin/main", total: 3, text: BRANCHES },
    pullRequests: options.pullRequests || { status: "ok", detail: "", text: PRS },
    facts: [facts("main", sha("a"), []), facts("feature/x", sha("c"), FX), facts("spike", sha("c"), []), facts(sha("f"), sha("b"), [ch("M", "p/a.py")]), facts(sha("9"), sha("b"), [ch("A", "docs/y.md")])],
  });
  const lines = [];
  const explorer = mountExplorer({ container: host, loaded, title: "demo", views, commits, post: (input) => { lines.push(input); return lines.length; }, storage: options.storage });
  const q = (selector) => host.querySelector(selector);
  const all = (selector) => [...host.querySelectorAll(selector)];
  return { host, views, commits, explorer, q, all, lines };
}

const rowFor = (m, text) => m.all(".commits-row").find((r) => r.textContent.includes(text));
const tabNamed = (m, name) => m.all(".commits-tab").find((t) => t.textContent === name);
const slotText = (m, which) => m.q(".commits-slot." + which + " .commits-slot-value").textContent;
const slotHint = (m, which) => { const n = m.q(".commits-slot." + which + " .commits-slot-hint"); return n === null ? null : n.textContent; };
const guide = (m) => m.q(".commits-summary").textContent;
const modeButton = (m, which) => m.q(".commits-mode-" + which);
const titlesOf = (m, selector) => m.all(selector).map((r) => r.querySelector(".commits-row-title").textContent);
const endBadges = (m) => m.all(".commits-row").filter((r) => r.querySelector(".commits-picked")).map((r) => r.querySelector(".commits-row-title").textContent + ":" + r.querySelector(".commits-picked").textContent);
const rangeFor = (base, head) => ({ baseCommit: "base999", headCommit: "feed01", merged: false, changes: [{ status: "M", path: "p/a.py" }, { status: "A", path: "p/b.py" }] });
const calls = (m) => ({ history: m.commits.calls.history, branches: m.commits.calls.branches, pullRequests: m.commits.calls.pullRequests });
const out = { errors: [] };
window.addEventListener("error", (e) => out.errors.push(e.message));
window.addEventListener("unhandledrejection", (e) => out.errors.push(String(e.reason && e.reason.stack || e.reason)));

(async () => {
  await tick();

  const m = mount();
  m.views.ranges.set(sha("d") + ".." + sha("a"), rangeFor());
  window.dispatchEvent(new Event("focus"));
  document.dispatchEvent(new Event("visibilitychange"));
  await tick(1200);
  out.mounted = calls(m);
  out.railLabels = m.all(".rail button").map((b) => b.getAttribute("data-label"));
  m.views.ranges.set(sha("e") + ".." + sha("b"), rangeFor());
  click(m.q(".rail-commits"));
  await tick(100);
  out.opened = { open: m.q(".rail-commits").classList.contains("open"), display: getComputedStyle(m.q(".commits-panel")).display, calls: calls(m), rows: m.all(".commits-row").length, branch: m.q(".commits-on-branch").textContent, chips: m.all(".commits-chip").map((c) => c.textContent) };
  click(tabNamed(m, "Branches"));
  await tick(100);
  const hover = (node, type, x = 60, y = 60) => node.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: false }));
  const cardText = () => { const c = m.q(".commits-card"); return c.hidden ? null : [...c.children].map((n) => n.className + ":" + n.textContent); };
  const impactTexts = () => m.all(".commits-row").map((r) => ({ count: r.querySelector(".commits-impact-count").textContent, marks: [...r.querySelectorAll(".commits-impact-mark")].map((n) => n.className.replace("commits-impact-mark ", "") + n.textContent), other: (r.querySelector(".commits-impact-other") || { textContent: null }).textContent }));
  out.branchesHidden = { rows: m.all(".commits-row .commits-row-title").map((r) => r.textContent), hidden: m.q(".commits-hidden").textContent, on: m.q(".commits-hide").getAttribute("aria-checked") === "true", impact: impactTexts() };
  const impactNode = rowFor(m, "feature/x").querySelector(".commits-impact");
  hover(impactNode, "pointerenter", 1390, 790);
  const countCard = m.q(".commits-card");
  const box = countCard.getBoundingClientRect();
  out.countCard = { lines: cardText(), insideWindow: box.right <= window.innerWidth && box.bottom <= window.innerHeight && box.left >= 0 && box.top >= 0 };
  hover(impactNode, "pointerleave");
  out.countCardGone = cardText();
  hover(rowFor(m, "feature/x").querySelector(".commits-row-title"), "pointerenter");
  out.titleCard = cardText();
  hover(m.q(".commits-row .commits-row-title"), "pointerleave");
  out.branchesPanel = { toggle: m.q(".commits-mode") !== null, cards: m.all(".commits-slot").length, filterHidden: m.q(".commits-filter").hidden, guide: guide(m), removed: [".commits-swap", ".commits-range-open", ".commits-save", ".commits-open-bar"].filter((selector) => m.q(selector) !== null) };
  out.branches = { calls: calls(m) };
  click(tabNamed(m, "Pull requests"));
  await tick(100);
  out.pulls = { calls: calls(m), rows: m.all(".commits-row").length, title: m.all(".commits-row-title").map((r) => r.textContent), toggle: m.q(".commits-mode") !== null, cards: m.all(".commits-slot").length, filterHidden: m.q(".commits-filter").hidden, guide: guide(m) };
  click(tabNamed(m, "History"));
  await tick();
  out.historyHide = { on: m.q(".commits-hide").getAttribute("aria-checked") === "true", rows: m.all(".commits-row").length, filterHidden: m.q(".commits-filter").hidden };
  click(tabNamed(m, "Pull requests"));
  await tick();
  out.pullsAgain = calls(m);
  click(tabNamed(m, "History"));
  await tick();

  const sameStyles = (one, other) => { const x = getComputedStyle(one); const y = getComputedStyle(other); return ["backgroundColor", "color", "borderRadius", "padding", "fontSize", "border"].every((key) => x[key] === y[key]); };
  const scanTrack = m.q(".scan-run-mode:not(.commits-mode)");
  out.toggle = {
    labels: m.all(".commits-mode button").map((b) => b.textContent),
    on: m.q(".commits-mode .on").textContent,
    aboveList: m.q(".commits-mode").getBoundingClientRect().bottom <= m.q(".commits-list").getBoundingClientRect().top,
    scanFound: scanTrack !== null && scanTrack.querySelector(".on") !== null && scanTrack.querySelector("button:not(.on)") !== null,
    track: scanTrack !== null && sameStyles(m.q(".commits-mode"), scanTrack),
    onButton: scanTrack !== null && sameStyles(m.q(".commits-mode .on"), scanTrack.querySelector(".on")),
    offButton: scanTrack !== null && sameStyles(m.q(".commits-mode button:not(.on)"), scanTrack.querySelector("button:not(.on)")),
    cards: m.all(".commits-slot").length,
    guide: guide(m),
    filterHidden: m.q(".commits-filter").hidden,
    removed: [".commits-swap", ".commits-range-open", ".commits-save", ".commits-open-bar"].filter((selector) => m.q(selector) !== null),
  };
  const oneBefore = m.views.rangeCalls.length;
  click(rowFor(m, "Middle"));
  await tick(100);
  out.one = { chip: m.q(".view-range-chip").textContent, chipTitle: m.q(".view-range-chip").title, calls: m.views.rangeCalls.slice(oneBefore), cards: m.all(".commits-slot").length, picked: titlesOf(m, ".commits-row.picked") };
  click(modeButton(m, "range"));
  await tick();
  out.rangeEmpty = { names: m.all(".commits-slot-name").map((n) => n.textContent), values: m.all(".commits-slot-value").map((n) => n.textContent), firstActive: m.q(".commits-slot.first").classList.contains("active"), lastActive: m.q(".commits-slot.last").classList.contains("active"), guide: guide(m), picked: m.all(".commits-row.picked").length, clears: m.all(".commits-slot-clear").length, on: m.q(".commits-mode .on").textContent };
  const rangeBefore = m.views.rangeCalls.length;
  click(rowFor(m, "Middle"));
  await tick();
  out.rangeFirst = { first: slotText(m, "first"), hint: slotHint(m, "first"), last: slotText(m, "last"), lastActive: m.q(".commits-slot.last").classList.contains("active"), firstActive: m.q(".commits-slot.first").classList.contains("active"), guide: guide(m), calls: m.views.rangeCalls.length - rangeBefore, badges: endBadges(m), clears: m.all(".commits-slot-clear").length, clearIcon: m.q(".commits-slot-clear svg") !== null };
  click(rowFor(m, "Oldest"));
  await tick(100);
  out.rangeBoth = { first: slotText(m, "first"), last: slotText(m, "last"), firstHint: slotHint(m, "first"), lastHint: slotHint(m, "last"), shaded: titlesOf(m, ".commits-row.shaded"), badges: endBadges(m), guide: guide(m), calls: m.views.rangeCalls.slice(rangeBefore) };
  click(m.q(".commits-slot.first .commits-slot-clear"));
  await tick();
  out.cleared = { first: slotText(m, "first"), last: slotText(m, "last"), shaded: m.all(".commits-row.shaded").length };
  click(m.q(".commits-slot.first .commits-slot-clear"));
  await tick();
  out.clearedAll = { first: slotText(m, "first"), last: slotText(m, "last"), clears: m.all(".commits-slot-clear").length };
  const orderBefore = m.views.rangeCalls.length;
  click(rowFor(m, "Middle"));
  click(rowFor(m, "Oldest"));
  await tick(100);
  click(m.q(".commits-slot.first .commits-slot-clear"));
  click(m.q(".commits-slot.first .commits-slot-clear"));
  click(rowFor(m, "Oldest"));
  click(rowFor(m, "Middle"));
  await tick(100);
  out.orders = m.views.rangeCalls.slice(orderBefore);

  const d = mount();
  d.views.ranges.set(sha("d") + ".." + sha("a"), rangeFor());
  click(d.q(".rail-commits"));
  await tick(100);
  click(modeButton(d, "range"));
  const finalBefore = d.views.rangeCalls.length;
  click(rowFor(d, "Newest"));
  click(rowFor(d, "Older"));
  await tick();
  out.viewsBefore = d.views.files.size;
  await tick(150);
  out.rangeCalls = d.views.rangeCalls.slice(-1);
  out.openedOnce = d.views.rangeCalls.length - finalBefore;
  click(d.q(".rail-views"));
  await tick();
  const viewRows = d.all(".views-row").length;
  click(d.q(".rail-commits"));
  await tick();
  out.draft = {
    viewRows,
    name: d.q(".view-name-text").textContent,
    chip: d.q(".view-range-chip").textContent,
    chipTitle: d.q(".view-range-chip").title,
    unsaved: d.q(".view-unsaved") !== null && !d.q(".view-unsaved").hidden,
    saveGone: d.q(".commits-save") === null,
    boxes: d.all(".box").map((b) => b.dataset.id).sort(),
    files: d.views.files.size,
    recent: (await d.views.recent()).length,
  };
  out.countsBeforeBack = d.views.rangeCalls.length;
  d.explorer.show;
  click(d.q(".view-back"));
  await tick(100);
  out.back = { boxes: d.all(".box").length, name: d.q(".view-name-text").textContent, unsaved: !d.q(".view-unsaved").hidden };
  click(d.q(".view-forward"));
  await tick(150);
  out.forward = { chip: d.q(".view-range-chip").textContent, chipTitle: d.q(".view-range-chip").title, name: d.q(".view-name-text").textContent, unsaved: !d.q(".view-unsaved").hidden, extraCalls: d.views.rangeCalls.length - out.countsBeforeBack, boxes: d.all(".box").map((b) => b.dataset.id).sort() };
  click(d.q(".view-save"));
  await tick();
  const dialogName = d.q(".view-field-name");
  dialogName.value = "gifts";
  dialogName.dispatchEvent(new Event("input", { bubbles: true }));
  const description = d.q(".view-field-description");
  description.value = "what changed";
  description.dispatchEvent(new Event("input", { bubbles: true }));
  click(d.q(".view-confirm"));
  await tick(150);
  out.saved = { file: JSON.parse(d.views.files.get("gifts") || "null"), name: d.q(".view-name-text").textContent, unsaved: !d.q(".view-unsaved").hidden };

  const WORDS = RS + [sha("a"), "aaaaaaa", sha("b"), "Ken", "1700000000", "Newest", ""].join(US) + "\\n\\nM\\tp/a.py\\n" + RS + [sha("b"), "bbbbbbb", sha("c"), "Ken", "1700000000", "Docs only", ""].join(US) + "\\n\\nM\\tdocs/x.md\\n" + RS + [sha("c"), "ccccccc", sha("d"), "Ken", "1700000000", "Version bump", ""].join(US) + "\\n\\n" + RS + [sha("d"), "ddddddd", "", "Ken", "1700000000", "Root", ""].join(US) + "\\n\\nA\\tp/a.py\\n";
  const filtered = mount({ history: WORDS });
  click(filtered.q(".rail-commits"));
  await tick(100);
  const titles = () => filtered.all(".commits-row .commits-row-title").map((r) => r.textContent);
  out.filtered = { on: filtered.q(".commits-hide").getAttribute("aria-checked") === "true", rows: titles(), hidden: filtered.q(".commits-hidden").textContent };
  filtered.q(".commits-hide").click();
  await tick();
  out.filtered.off = { rows: titles(), hidden: filtered.q(".commits-hidden").textContent, docs: rowFor(filtered, "Docs only").querySelector(".commits-impact").textContent, bump: rowFor(filtered, "Version bump").querySelector(".commits-impact").textContent };
  click(modeButton(filtered, "range"));
  click(rowFor(filtered, "Docs only"));
  click(rowFor(filtered, "Version bump"));
  filtered.q(".commits-hide").click();
  await tick();
  out.filtered.pickedEmpty = { rows: titles(), hidden: filtered.q(".commits-hidden").textContent, badges: endBadges(filtered) };
  click(filtered.q(".commits-slot.first .commits-slot-clear"));
  await tick();
  out.filtered.toOnly = titles();

  const pending = mount();
  click(pending.q(".rail-commits"));
  await tick(100);
  click(rowFor(pending, "Root"));
  await tick();
  out.pending = { note: guide(pending), opened: pending.views.rangeCalls.length, picked: pending.all(".commits-row.picked").length, busy: pending.q(".canvas-loading").hidden };
  click(rowFor(pending, "Older"));
  await tick(100);
  out.pending.after = { note: guide(pending), opened: pending.views.rangeCalls.length };

  const store = mem();
  const sized = mount({ storage: store });
  const widthOfTree = () => sized.q(".tree").getBoundingClientRect().width;
  const dragTree = (dx) => { const node = sized.q(".panel-resizer-tree"); const fire = (type, x) => node.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: x, bubbles: true })); fire("pointerdown", 500); fire("pointermove", 500 + dx); fire("pointerup", 500 + dx); };
  click(sized.q(".rail-commits"));
  await tick(100);
  const start = widthOfTree();
  dragTree(60);
  await tick();
  const wider = widthOfTree();
  dragTree(5000);
  await tick();
  const most = widthOfTree();
  dragTree(-5000);
  await tick();
  const least = widthOfTree();
  click(sized.q(".rail-files"));
  await tick();
  const files = widthOfTree();
  dragTree(5000);
  await tick();
  const filesMax = widthOfTree();
  dragTree(-5000);
  await tick();
  const filesMin = widthOfTree();
  out.resize = { grew: wider > start, mostIsMax: most, leastIsMin: least, filesBackToOwn: files < start, filesMax, filesMin, stored: JSON.parse(store.store.get("recognizer.panel-widths")) };
  const restored = mount({ storage: store });
  click(restored.q(".rail-commits"));
  await tick(100);
  out.resize.restored = restored.q(".tree").getBoundingClientRect().width;

  const modified = mount({}, { v: make({}, [{ kind: "pick", module: "p/a.py" }]) });
  modified.views.ranges.set(sha("d") + ".." + sha("a"), rangeFor());
  await tick();
  click(modified.q(".view-list"));
  click(modified.q(".view-item"));
  await tick(100);
  click(modified.q('.tree .row[data-path="p"] .reye'));
  await tick();
  click(modified.q(".rail-commits"));
  await tick(100);
  click(modeButton(modified, "range"));
  click(rowFor(modified, "Newest"));
  const askedBefore = modified.views.rangeCalls.length;
  click(rowFor(modified, "Older"));
  await tick(100);
  out.guard = { dialog: modified.q(".unsaved-dialog-body") === null ? null : modified.q(".unsaved-dialog-body").textContent, ranges: modified.views.rangeCalls.length - askedBefore };

  for (const status of ["missing", "signed-out", "failed"]) {
    const gh = mount({ pullRequests: { status, detail: "rate limited", text: "" } });
    click(gh.q(".rail-commits"));
    await tick(100);
    click(tabNamed(gh, "Pull requests"));
    await tick(100);
    out["gh_" + status] = { notice: gh.q(".commits-notice") && gh.q(".commits-notice").textContent, rows: gh.all(".commits-row").length };
    click(tabNamed(gh, "History"));
    await tick();
    out["gh_" + status].history = gh.all(".commits-row").length;
    click(tabNamed(gh, "Branches"));
    await tick();
    out["gh_" + status].branches = gh.all(".commits-row").length;
  }

  const rangeAnswer = { baseCommit: "base999", headCommit: "feed01", merged: false, changes: [{ status: "M", path: "p/a.py" }] };
  const spin = mount();
  const gates = [];
  spin.views.changeRange = (base, head) => { spin.views.rangeCalls.push(base + ".." + head); return new Promise((resolve) => gates.push(resolve)); };
  const release = async (answer) => { gates.shift()(answer); await tick(150); };
  const loadingNow = () => ({ text: spin.q(".canvas-loading").hidden ? null : spin.q(".canvas-loading").textContent, spinner: !spin.q(".canvas-loading").hidden && spin.q(".canvas-loading .spinner") !== null, rowSpinners: spin.all(".commits-row .commits-row-busy").length, busyTitles: spin.all(".commits-row").filter((r) => r.querySelector(".commits-row-busy")).map((r) => r.querySelector(".commits-row-title").textContent) });
  click(spin.q(".rail-commits"));
  await tick(100);
  out.spin = { start: loadingNow() };
  click(rowFor(spin, "Middle"));
  await tick();
  out.spin.commit = loadingNow();
  out.spin.commitRowIcon = rowFor(spin, "Middle").querySelector("svg.spinner-icon") !== null;
  await release(rangeAnswer);
  out.spin.commitDone = loadingNow();
  out.spin.commitDoneIcon = rowFor(spin, "Middle").querySelector(".commits-row-busy") === null && rowFor(spin, "Middle").querySelector("svg") !== null;
  click(modeButton(spin, "range"));
  click(rowFor(spin, "Newest"));
  await tick();
  out.spin.rangeHalf = loadingNow();
  click(rowFor(spin, "Older"));
  await tick();
  out.spin.range = loadingNow();
  await release({ baseCommit: "base999", headCommit: null, merged: false, changes: [] });
  out.spin.rangeFailed = loadingNow();
  click(tabNamed(spin, "Branches"));
  await tick(100);
  click(rowFor(spin, "feature/x"));
  await tick();
  out.spin.branch = loadingNow();
  await release(rangeAnswer);
  out.spin.branchDone = loadingNow();
  out.spin.branchCall = spin.views.rangeCalls.at(-1);
  click(tabNamed(spin, "Pull requests"));
  await tick(100);
  click(rowFor(spin, "Gift cards"));
  await tick();
  out.spin.pull = loadingNow();
  await release(rangeAnswer);
  out.spin.pullDone = loadingNow();
  out.spin.pullCall = spin.views.rangeCalls.at(-1);
  click(tabNamed(spin, "History"));
  click(modeButton(spin, "one"));
  click(rowFor(spin, "Oldest"));
  await tick();
  await release(null);
  out.spin.unavailable = loadingNow();

  const slow = mount();
  const held = [];
  const slowly = (name, reply) => { slow.commits[name] = () => new Promise((resolve) => held.push(() => resolve(reply))); };
  slowly("listHistory", { branch: "main", text: HISTORY });
  slowly("listBranches", { defaultRef: "origin/main", total: 3, text: BRANCHES });
  slowly("listPullRequests", { status: "ok", detail: "", text: PRS });
  click(slow.q(".rail-commits"));
  await tick();
  const listLoading = () => ({ text: slow.q(".commits-loading") === null ? null : slow.q(".commits-loading").textContent, spinner: slow.q(".commits-list .spinner") !== null, rows: slow.all(".commits-row").length });
  out.listLoading = { history: listLoading() };
  click(tabNamed(slow, "Branches"));
  await tick();
  out.listLoading.branches = listLoading();
  click(tabNamed(slow, "Pull requests"));
  await tick();
  out.listLoading.prs = listLoading();
  click(tabNamed(slow, "History"));
  held.splice(0).forEach((run) => run());
  await tick(100);
  out.listLoading.after = listLoading();

  const reopen = mount();
  await tick();
  click(reopen.q(".rail-commits"));
  await tick(100);
  click(reopen.q(".rail-commits"));
  await tick();
  click(reopen.q(".rail-commits"));
  await tick(100);
  out.reopened = calls(reopen);


  const live = mount();
  await tick();
  click(live.q(".rail-commits"));
  await tick(100);
  const scroller = () => live.q(".commits-list");
  const rowsOf = () => titlesOf(live, ".commits-row");
  const sawLoading = [];
  const watcher = new MutationObserver(() => { if (live.q(".commits-loading") !== null) sawLoading.push(true); });
  watcher.observe(live.host, { childList: true, subtree: true });
  const withNew = record("f", "a", "Brand new", "", ["M\\tp/a.py"]) + HISTORY;
  live.commits.history = { branch: "main", text: withNew };
  const historyBefore = live.commits.calls.history;
  live.commits.emitGitChanged();
  await tick(100);
  out.refreshed = { rows: rowsOf(), loading: sawLoading.length, reads: live.commits.calls.history - historyBefore };

  click(modeButton(live, "range"));
  await tick();
  click(rowFor(live, "Brand new"));
  click(rowFor(live, "Oldest"));
  await tick(100);
  const rangeShade = () => ({ first: slotText(live, "first"), last: slotText(live, "last"), shaded: titlesOf(live, ".commits-row.shaded"), badges: endBadges(live) });
  const rangeHeld = rangeShade();
  live.commits.emitGitChanged();
  await tick(100);
  out.rangeKept = { before: rangeHeld, after: rangeShade() };
  live.commits.history = { branch: "main", text: HISTORY };
  live.commits.emitGitChanged();
  await tick(100);
  out.rangeLastGone = { first: slotText(live, "first"), last: slotText(live, "last") };
  live.commits.history = { branch: "main", text: withNew };
  live.commits.emitGitChanged();
  await tick(100);

  scroller().style.flex = "none";
  scroller().style.height = "60px";
  scroller().style.overflow = "auto";
  scroller().scrollTop = 20;
  const scrollBefore = scroller().scrollTop;
  live.commits.emitGitChanged();
  await tick(100);
  out.scrollKept = { before: scrollBefore, after: scroller().scrollTop };
  watcher.disconnect();

  click(live.q(".rail-commits"));
  await tick();
  const closedBefore = calls(live);
  live.commits.emitGitChanged();
  live.commits.emitFocus();
  await tick(100);
  out.closedQuiet = { before: closedBefore, after: calls(live) };
  click(live.q(".rail-commits"));
  await tick(100);
  const reopenedBefore = calls(live);
  live.commits.emitGitChanged();
  await tick(100);
  out.reopenedOnce = { history: live.commits.calls.history - reopenedBefore.history, branches: live.commits.calls.branches - reopenedBefore.branches };

  const prsPanel = mount();
  await tick();
  click(prsPanel.q(".rail-commits"));
  await tick(100);
  const focusHistoryBefore = prsPanel.commits.calls.pullRequests;
  prsPanel.commits.emitFocus();
  await tick(60);
  out.focusOnHistory = prsPanel.commits.calls.pullRequests - focusHistoryBefore;
  click(tabNamed(prsPanel, "Pull requests"));
  await tick(100);
  const prsBefore = prsPanel.commits.calls.pullRequests;
  out.noButtonElsewhere = { historyTab: false, branchesTab: false };
  prsPanel.commits.emitFocus();
  await tick(100);
  out.focusOnPrs = { reads: prsPanel.commits.calls.pullRequests - prsBefore, loading: prsPanel.q(".commits-loading") !== null, rows: prsPanel.all(".commits-row").length };
  const pressBefore = prsPanel.commits.calls.pullRequests;
  let releasePrs;
  prsPanel.commits.holds.pullRequests.push(new Promise((resolve) => { releasePrs = resolve; }));
  const refreshButton = () => prsPanel.q(".commits-refresh");
  const buttonState = () => ({ present: refreshButton() !== null, disabled: refreshButton() !== null && refreshButton().disabled, spinner: refreshButton() !== null && refreshButton().querySelector(".spinner") !== null, icon: refreshButton() !== null && refreshButton().querySelector("svg.i") !== null, label: refreshButton() === null ? null : refreshButton().getAttribute("aria-label"), loading: prsPanel.q(".commits-loading") !== null, rows: prsPanel.all(".commits-row").length });
  out.buttonIdle = buttonState();
  click(refreshButton());
  await tick(60);
  out.buttonBusy = buttonState();
  prsPanel.commits.emitFocus();
  click(refreshButton());
  await tick(60);
  out.busyReads = prsPanel.commits.calls.pullRequests - pressBefore;
  releasePrs();
  await tick(100);
  out.buttonDone = buttonState();
  click(tabNamed(prsPanel, "History"));
  await tick();
  out.noButtonElsewhere.historyTab = prsPanel.q(".commits-refresh") === null;
  click(tabNamed(prsPanel, "Branches"));
  await tick();
  out.noButtonElsewhere.branchesTab = prsPanel.q(".commits-refresh") === null;

  const broken = mount();
  await tick();
  click(broken.q(".rail-commits"));
  await tick(100);
  broken.commits.history = new Error("index.lock exists");
  broken.commits.emitGitChanged();
  await tick(100);
  out.failedRefresh = { rows: titlesOf(broken, ".commits-row"), notice: broken.q(".commits-notice") !== null };

  const raced = mount();
  await tick();
  let releaseFirst;
  let releaseSecond;
  raced.commits.holds.history.push(new Promise((resolve) => { releaseFirst = resolve; }), new Promise((resolve) => { releaseSecond = resolve; }));
  click(raced.q(".rail-commits"));
  await tick(30);
  raced.commits.history = { branch: "main", text: record("f", "a", "Raced new", "", ["M\\tp/a.py"]) };
  raced.commits.emitGitChanged();
  await tick(30);
  releaseSecond();
  await tick(60);
  releaseFirst();
  await tick(100);
  out.raced = titlesOf(raced, ".commits-row");

  const failing = mount();
  failing.commits.history = new Error("fatal: not a git repository");
  click(failing.q(".rail-commits"));
  await tick(100);
  out.failing = failing.q(".commits-notice").textContent;

  document.getElementById("out").textContent = btoa(JSON.stringify(out));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Impact = {
  count: string;
  marks: string[];
  other: string | null;
};

type Refresh = {
  refreshed: { rows: string[]; loading: number; reads: number };
  rangeKept: {
    before: { first: string; last: string; shaded: string[]; badges: string[] };
    after: { first: string; last: string; shaded: string[]; badges: string[] };
  };
  rangeLastGone: { first: string; last: string };
  scrollKept: { before: number; after: number };
  closedQuiet: { before: Calls; after: Calls };
  reopenedOnce: { history: number; branches: number };
  focusOnHistory: number;
  focusOnPrs: { reads: number; loading: boolean; rows: number };
  buttonIdle: ButtonState;
  buttonBusy: ButtonState;
  buttonDone: ButtonState;
  busyReads: number;
  noButtonElsewhere: { historyTab: boolean; branchesTab: boolean };
  failedRefresh: { rows: string[]; notice: boolean };
  raced: string[];
};

type ButtonState = {
  present: boolean;
  disabled: boolean;
  spinner: boolean;
  icon: boolean;
  label: string | null;
  loading: boolean;
  rows: number;
};

type Calls = { history: number; branches: number; pullRequests: number };

type GhFacts = {
  notice: string | null;
  rows: number;
  history: number;
  branches: number;
};

type Loading = {
  text: string | null;
  spinner: boolean;
  rowSpinners: number;
  busyTitles: string[];
};

type ListLoading = { text: string | null; spinner: boolean; rows: number };

type Panel = {
  toggle: boolean;
  cards: number;
  filterHidden: boolean;
  guide: string;
};

type Facts = {
  errors: string[];
  mounted: Calls;
  railLabels: string[];
  opened: {
    open: boolean;
    display: string;
    calls: Calls;
    rows: number;
    branch: string;
    chips: string[];
  };
  branchesHidden: {
    rows: string[];
    hidden: string;
    on: boolean;
    impact: Impact[];
  };
  branchesPanel: Panel & { removed: string[] };
  countCard: { lines: string[] | null; insideWindow: boolean };
  countCardGone: string[] | null;
  titleCard: string[] | null;
  branches: { calls: Calls };
  historyHide: { on: boolean; rows: number; filterHidden: boolean };
  filtered: {
    on: boolean;
    rows: string[];
    hidden: string;
    off: { rows: string[]; hidden: string; docs: string; bump: string };
    pickedEmpty: { rows: string[]; hidden: string; badges: string[] };
    toOnly: string[];
  };
  pending: {
    note: string;
    opened: number;
    picked: number;
    busy: boolean;
    after: { note: string; opened: number };
  };
  resize: {
    grew: boolean;
    mostIsMax: number;
    leastIsMin: number;
    filesBackToOwn: boolean;
    filesMax: number;
    filesMin: number;
    stored: { tree: number; inspector: number; commits: number };
    restored: number;
  };
  pulls: Panel & { calls: Calls; rows: number; title: string[] };
  pullsAgain: Calls;
  toggle: {
    labels: string[];
    on: string;
    aboveList: boolean;
    scanFound: boolean;
    track: boolean;
    onButton: boolean;
    offButton: boolean;
    cards: number;
    guide: string;
    filterHidden: boolean;
    removed: string[];
  };
  one: {
    chip: string;
    chipTitle: string;
    calls: string[];
    cards: number;
    picked: string[];
  };
  rangeEmpty: {
    names: string[];
    values: string[];
    firstActive: boolean;
    lastActive: boolean;
    guide: string;
    picked: number;
    clears: number;
    on: string;
  };
  rangeFirst: {
    first: string;
    hint: string | null;
    last: string;
    lastActive: boolean;
    firstActive: boolean;
    guide: string;
    calls: number;
    badges: string[];
    clears: number;
    clearIcon: boolean;
  };
  rangeBoth: {
    first: string;
    last: string;
    firstHint: string | null;
    lastHint: string | null;
    shaded: string[];
    badges: string[];
    guide: string;
    calls: string[];
  };
  cleared: { first: string; last: string; shaded: number };
  clearedAll: { first: string; last: string; clears: number };
  orders: string[];
  viewsBefore: number;
  rangeCalls: string[];
  openedOnce: number;
  draft: {
    name: string;
    chip: string;
    chipTitle: string;
    unsaved: boolean;
    saveGone: boolean;
    boxes: string[];
    files: number;
    recent: number;
    viewRows: number;
  };
  back: { boxes: number; name: string; unsaved: boolean };
  forward: {
    chip: string;
    chipTitle: string;
    name: string;
    unsaved: boolean;
    extraCalls: number;
    boxes: string[];
  };
  saved: {
    file: { change: { base: string; head: string } };
    name: string;
    unsaved: boolean;
  };
  guard: { dialog: string | null; ranges: number };
  spin: {
    start: Loading;
    commit: Loading;
    commitRowIcon: boolean;
    commitDone: Loading;
    commitDoneIcon: boolean;
    rangeHalf: Loading;
    range: Loading;
    rangeFailed: Loading;
    branch: Loading;
    branchDone: Loading;
    branchCall: string;
    pull: Loading;
    pullDone: Loading;
    pullCall: string;
    unavailable: Loading;
  };
  listLoading: {
    history: ListLoading;
    branches: ListLoading;
    prs: ListLoading;
    after: ListLoading;
  };
  gh_missing: GhFacts;
  "gh_signed-out": GhFacts;
  gh_failed: GhFacts;
  reopened: Calls;
  failing: string;
} & Refresh;

describe.skipIf(webkit === undefined)(
  "the Commits panel in a real browser",
  () => {
    let f = {} as Facts;

    beforeAll(async () => {
      f = await collectFacts<Facts>(HARNESS, "commits-panel");
    }, 180_000);

    it("raises no error while the panel is driven", () => {
      expect(f.errors).toEqual([]);
    });

    it("puts the Commits button directly under Files on the rail and loads nothing until the panel opens", () => {
      expect(f.railLabels).toEqual([
        "Files",
        "Commits",
        "Views",
        "Notes",
        "Scan",
        "Findings",
        "Settings",
      ]);
      expect(f.mounted).toEqual({ history: 0, branches: 0, pullRequests: 0 });
    });

    it("opens the panel on the rail click and loads History and Branches once, never the pull requests", () => {
      expect(f.opened.open).toBe(true);
      expect(f.opened.display).not.toBe("none");
      expect(f.opened.calls).toEqual({
        history: 1,
        branches: 1,
        pullRequests: 0,
      });
      expect(f.opened.rows).toBe(5);
      expect(f.opened.branch).toBe("main");
      expect(f.opened.chips).toEqual(["main", "v0.1.0"]);
    });

    it("shows every branch and pull request with the History switch on, including those with no file on the canvas, and shows the bold count with squares and the not-on-the-canvas line", () => {
      expect(f.branchesHidden.on).toBe(true);
      expect(f.branchesHidden.rows).toEqual(["main", "feature/x", "spike"]);
      expect(f.branchesHidden.hidden).toBe("");
      expect(f.branchesPanel.filterHidden).toBe(true);
      expect(f.branchesHidden.impact).toEqual([
        { count: "no files", marks: [], other: null },
        {
          count: "3 files",
          marks: ["added1", "modified1", "removed1"],
          other: "+1 not on the canvas",
        },
        { count: "no files", marks: [], other: null },
      ]);
      expect(f.branches.calls.pullRequests).toBe(0);
      expect(f.pulls.calls.pullRequests).toBe(1);
      expect(f.pulls.rows).toBe(2);
      expect(f.pulls.title).toEqual(["#9 Gift cards", "#10 Docs only"]);
      expect(f.pullsAgain.pullRequests).toBe(1);
      expect(f.historyHide).toEqual({
        on: true,
        rows: 5,
        filterHidden: false,
      });
    });

    it("shows the count card with a file under each status and the title card, clamped inside the window, and hides them on leave", () => {
      expect(f.countCard.lines).toEqual([
        "commits-card-heading:3 files on the canvas",
        "commits-card-group added:1 added",
        "commits-card-file added:p/b.py",
        "commits-card-group modified:1 modified",
        "commits-card-file modified:p/a.py",
        "commits-card-group removed:1 removed",
        "commits-card-file removed:p/zzz.py",
        "commits-card-group:1 file not on the canvas",
        "commits-card-file:docs/x.md",
      ]);
      expect(f.countCard.insideWindow).toBe(true);
      expect(f.countCardGone).toBeNull();
      expect(f.titleCard?.[0]).toBe("commits-card-heading:feature/x");
    });

    it("hides rows with no files on the canvas on History, keeps the held ends and the unknown rows, and counts them", () => {
      expect(f.filtered.on).toBe(true);
      expect(f.filtered.rows).toEqual(["Newest", "Root"]);
      expect(f.filtered.hidden).toBe("2 hidden");
      expect(f.filtered.off.rows).toEqual([
        "Newest",
        "Docs only",
        "Version bump",
        "Root",
      ]);
      expect(f.filtered.off.hidden).toBe("");
      expect(f.filtered.off.docs).toBe("no files+1 not on the canvas");
      expect(f.filtered.off.bump).toBe("no files");
      expect(f.filtered.pickedEmpty).toEqual({
        rows: ["Newest", "Docs only", "Version bump", "Root"],
        hidden: "",
        badges: ["Docs only:Last", "Version bump:First"],
      });
      expect(f.filtered.toOnly).toEqual(["Newest", "Docs only", "Root"]);
    });

    it("refuses a root commit with its note, opens nothing and holds nothing until the next click", () => {
      expect(f.pending.note).toBe("no parent commit");
      expect(f.pending.opened).toBe(0);
      expect(f.pending.picked).toBe(0);
      expect(f.pending.busy).toBe(true);
      expect(f.pending.after).toEqual({
        note: "Click a commit to see what it changed.",
        opened: 1,
      });
    });

    it("drags the left column's edge within 260 and 640 for Commits, keeps the Files limits at 200 and 480 and restores the stored width", () => {
      expect(f.resize.grew).toBe(true);
      expect(f.resize.mostIsMax).toBe(640);
      expect(f.resize.leastIsMin).toBe(260);
      expect(f.resize.filesBackToOwn).toBe(true);
      expect(f.resize.filesMax).toBe(480);
      expect(f.resize.filesMin).toBe(200);
      expect(f.resize.stored.commits).toBe(260);
      expect(f.resize.restored).toBe(f.resize.stored.commits);
    });

    it("has a One commit | Range toggle on History only, styled like the Scan panel's toggle, and no From, To, swap, Open or Save as view", () => {
      expect(f.toggle.labels).toEqual(["One commit", "Range"]);
      expect(f.toggle.on).toBe("One commit");
      expect(f.toggle.aboveList).toBe(true);
      expect(f.toggle.scanFound).toBe(true);
      expect(f.toggle.track).toBe(true);
      expect(f.toggle.onButton).toBe(true);
      expect(f.toggle.offButton).toBe(true);
      expect(f.toggle.cards).toBe(0);
      expect(f.toggle.guide).toBe("Click a commit to see what it changed.");
      expect(f.toggle.filterHidden).toBe(false);
      expect(f.toggle.removed).toEqual([]);
      expect(f.branchesPanel.toggle).toBe(false);
      expect(f.pulls.toggle).toBe(false);
      expect(f.branchesPanel.removed).toEqual([]);
    });

    it("in One commit mode a click opens the commit's parent to the commit at once", () => {
      expect(f.one.calls).toEqual([`${"c".repeat(40)}..${"b".repeat(40)}`]);
      expect(f.one.chip).toBe("commit bbbbbbb");
      expect(f.one.chipTitle).toBe(`${"c".repeat(40)}..${"b".repeat(40)}`);
      expect(f.one.cards).toBe(0);
      expect(f.one.picked).toEqual(["Middle"]);
    });

    it("in Range mode the cards read First and Last with click a commit while empty and highlight the next click", () => {
      expect(f.rangeEmpty.on).toBe("Range");
      expect(f.rangeEmpty.names).toEqual(["First", "Last"]);
      expect(f.rangeEmpty.values).toEqual(["click a commit", "click a commit"]);
      expect(f.rangeEmpty.firstActive).toBe(true);
      expect(f.rangeEmpty.lastActive).toBe(false);
      expect(f.rangeEmpty.guide).toBe("Click the first commit of the range.");
      expect(f.rangeEmpty.picked).toBe(0);
      expect(f.rangeEmpty.clears).toBe(0);
    });

    it("in Range mode the first click fills First with the short id and subject, opens nothing and moves the highlight to Last", () => {
      expect(f.rangeFirst.first).toBe("bbbbbbb");
      expect(f.rangeFirst.hint).toBe("Middle");
      expect(f.rangeFirst.last).toBe("click a commit");
      expect(f.rangeFirst.lastActive).toBe(true);
      expect(f.rangeFirst.firstActive).toBe(false);
      expect(f.rangeFirst.guide).toBe("Now click the last commit.");
      expect(f.rangeFirst.calls).toBe(0);
      expect(f.rangeFirst.badges).toEqual(["Middle:First"]);
      expect(f.rangeFirst.clears).toBe(1);
      expect(f.rangeFirst.clearIcon).toBe(true);
    });

    it("in Range mode the second click fills Last, the rows between are shaded and the ends carry First and Last badges", () => {
      expect(f.rangeBoth.first).toBe("ddddddd");
      expect(f.rangeBoth.firstHint).toBe("Oldest");
      expect(f.rangeBoth.last).toBe("bbbbbbb");
      expect(f.rangeBoth.lastHint).toBe("Middle");
      expect(f.rangeBoth.shaded).toEqual(["Older"]);
      expect(f.rangeBoth.badges).toEqual(["Middle:Last", "Oldest:First"]);
      expect(f.rangeBoth.guide).toBe("3 commits, both ends included.");
      expect(f.rangeBoth.shaded.length + 2).toBe(3);
      expect(f.rangeBoth.calls).toEqual([
        `${"e".repeat(40)}..${"b".repeat(40)}`,
      ]);
    });

    it("in Range mode clearing First makes the remaining commit First and clearing again empties both", () => {
      expect(f.cleared).toEqual({
        first: "bbbbbbb",
        last: "click a commit",
        shaded: 0,
      });
      expect(f.clearedAll).toEqual({
        first: "click a commit",
        last: "click a commit",
        clears: 0,
      });
    });

    it("in Range mode opens the older commit's parent to the newer commit in both click orders", () => {
      expect(f.orders).toEqual([
        `${"e".repeat(40)}..${"b".repeat(40)}`,
        `${"e".repeat(40)}..${"b".repeat(40)}`,
      ]);
    });

    it("on Branches and Pull requests shows no toggle and no cards, names the default branch and hides the filter row", () => {
      expect(f.branchesPanel.cards).toBe(0);
      expect(f.branchesPanel.guide).toBe(
        "Each branch shows what it changes against main.",
      );
      expect(f.pulls.cards).toBe(0);
      expect(f.pulls.filterHidden).toBe(true);
      expect(f.pulls.guide).toBe(
        "Each pull request shows what it changes against main.",
      );
    });

    it("shows the canvas spinner with the labelled text from the click until the change view is drawn, then removes it", () => {
      expect(f.spin.start).toEqual({
        text: null,
        spinner: false,
        rowSpinners: 0,
        busyTitles: [],
      });
      expect(f.spin.commit.text).toBe("Loading commit bbbbbbb");
      expect(f.spin.commit.spinner).toBe(true);
      expect(f.spin.commitDone.text).toBeNull();
      expect(f.spin.commitDone.spinner).toBe(false);
      expect(f.spin.rangeHalf.text).toBeNull();
      expect(f.spin.range.text).toBe("Loading range ccccccc to aaaaaaa");
      expect(f.spin.branch.text).toBe("Loading branch feature/x");
      expect(f.spin.branchDone.text).toBeNull();
      expect(f.spin.pull.text).toBe("Loading pull request #9");
      expect(f.spin.pullDone.text).toBeNull();
    });

    it("removes the canvas spinner when the open fails", () => {
      expect(f.spin.rangeFailed.text).toBeNull();
      expect(f.spin.rangeFailed.rowSpinners).toBe(0);
      expect(f.spin.unavailable.text).toBeNull();
      expect(f.spin.unavailable.rowSpinners).toBe(0);
    });

    it("turns the clicked row's icon into a spinner while loading and back after", () => {
      expect(f.spin.commit.rowSpinners).toBe(1);
      expect(f.spin.commit.busyTitles).toEqual(["Middle"]);
      expect(f.spin.commitRowIcon).toBe(true);
      expect(f.spin.commitDone.rowSpinners).toBe(0);
      expect(f.spin.commitDoneIcon).toBe(true);
      expect(f.spin.range.busyTitles).toEqual(["Newest"]);
      expect(f.spin.branch.busyTitles).toEqual(["feature/x"]);
      expect(f.spin.pull.busyTitles).toEqual(["#9 Gift cards"]);
    });

    it("opens a branch from its merge base to its head and a pull request from its merge base to its head sha", () => {
      expect(f.spin.branchCall).toBe(`${"c".repeat(40)}..feature/x`);
      expect(f.spin.pullCall).toBe(`${"b".repeat(40)}..${"f".repeat(40)}`);
    });

    it("shows a spinner with Loading commits, branches and pull requests while an empty list loads, then the rows", () => {
      expect(f.listLoading.history).toEqual({
        text: "Loading commits",
        spinner: true,
        rows: 0,
      });
      expect(f.listLoading.branches.text).toBe("Loading branches");
      expect(f.listLoading.branches.spinner).toBe(true);
      expect(f.listLoading.prs.text).toBe("Loading pull requests");
      expect(f.listLoading.prs.spinner).toBe(true);
      expect(f.listLoading.after).toEqual({
        text: null,
        spinner: false,
        rows: 5,
      });
    });

    it("opens a range as an unsaved change view named Change with its chip, leaving the Views and recent lists alone", () => {
      expect(f.viewsBefore).toBe(0);
      expect(f.rangeCalls).toEqual([`${"d".repeat(40)}..${"a".repeat(40)}`]);
      expect(f.openedOnce).toBe(1);
      expect(f.draft.name).toBe("Change");
      expect(f.draft.chip).toBe("ccccccc to aaaaaaa");
      expect(f.draft.chipTitle).toBe(`${"d".repeat(40)}..${"a".repeat(40)}`);
      expect(f.draft.unsaved).toBe(true);
      expect(f.draft.saveGone).toBe(true);
      expect(f.draft.files).toBe(0);
      expect(f.draft.viewRows).toBe(0);
      expect(f.draft.recent).toBe(0);
      expect(f.draft.boxes).toEqual(["p/a.py", "p/b.py"]);
    });

    it("steps back off the draft and forward onto it, asking the views port for the range once more", () => {
      expect(f.back.unsaved).toBe(false);
      expect(f.back.name).toBe("Untitled");
      expect(f.back.boxes).toBe(0);
      expect(f.forward.unsaved).toBe(true);
      expect(f.forward.name).toBe("Change");
      expect(f.forward.chip).toBe(f.draft.chip);
      expect(f.forward.chipTitle).toBe(f.draft.chipTitle);
      expect(f.forward.extraCalls).toBe(1);
      expect(f.forward.boxes).toEqual(["p/a.py", "p/b.py"]);
    });

    it("saves the draft as a view whose change equals the range and drops the unsaved badge", () => {
      expect(f.saved.file.change).toEqual({
        base: "d".repeat(40),
        head: "a".repeat(40),
        name: f.draft.chip,
      });
      expect(f.saved.name).toBe("gifts");
      expect(f.saved.unsaved).toBe(false);
    });

    it("asks before opening a range over a modified saved view and opens nothing until answered", () => {
      expect(f.guard.dialog).toContain(
        "Opening the range closes the open view.",
      );
      expect(f.guard.ranges).toBe(0);
    });

    it("shows the gh text in the pull requests tab with no rows while History and Branches still list", () => {
      expect(f.gh_missing.notice).toBe(
        "Pull requests need the GitHub CLI (gh). Install it from cli.github.com, then reopen this tab.",
      );
      expect(f["gh_signed-out"].notice).toBe(
        "Sign in to the GitHub CLI with gh auth login, then reopen this tab.",
      );
      expect(f.gh_failed.notice).toBe("rate limited");

      for (const key of ["gh_missing", "gh_signed-out", "gh_failed"] as const) {
        expect(f[key].rows).toBe(0);
        expect(f[key].history).toBe(5);
        expect(f[key].branches).toBe(3);
      }
    });

    it("loads each list again when the panel is closed and reopened", () => {
      expect(f.reopened).toEqual({ history: 2, branches: 2, pullRequests: 0 });
    });

    it("refreshes History in place on a git change with no loading state and one more read", () => {
      expect(f.refreshed.rows[0]).toBe("Brand new");
      expect(f.refreshed.rows).toHaveLength(6);
      expect(f.refreshed.loading).toBe(0);
      expect(f.refreshed.reads).toBe(1);
    });

    it("keeps both range ends and the shading across a refresh that still lists them", () => {
      expect(f.rangeKept.before.badges).toHaveLength(2);
      expect(f.rangeKept.before.shaded.length).toBeGreaterThan(0);
      expect(f.rangeKept.after).toEqual(f.rangeKept.before);
    });

    it("keeps First and empties Last when the last commit is gone after a refresh", () => {
      expect(f.rangeKept.before.last).not.toBe("click a commit");
      expect(f.rangeLastGone.first).toBe(f.rangeKept.before.first);
      expect(f.rangeLastGone.last).toBe("click a commit");
    });

    it("keeps the list's scroll position across a refresh", () => {
      expect(f.scrollKept.before).toBeGreaterThan(0);
      expect(f.scrollKept.after).toBe(f.scrollKept.before);
    });

    it("reads nothing on a git change or focus with the panel closed, and one refresh per change once reopened", () => {
      expect(f.closedQuiet.after).toEqual(f.closedQuiet.before);
      expect(f.reopenedOnce).toEqual({ history: 1, branches: 1 });
    });

    it("reads pull requests once on focus only while the Pull requests tab is showing, with no loading state", () => {
      expect(f.focusOnHistory).toBe(0);
      expect(f.focusOnPrs).toEqual({ reads: 1, loading: false, rows: 2 });
    });

    it("shows the refresh button only on the Pull requests tab, with a spinner and disabled while a read is in flight", () => {
      expect(f.buttonIdle).toEqual({
        present: true,
        disabled: false,
        spinner: false,
        icon: true,
        label: "Refresh pull requests",
        loading: false,
        rows: 2,
      });
      expect(f.buttonBusy.spinner).toBe(true);
      expect(f.buttonBusy.disabled).toBe(true);
      expect(f.buttonBusy.icon).toBe(false);
      expect(f.buttonBusy.loading).toBe(false);
      expect(f.buttonBusy.rows).toBe(2);
      expect(f.busyReads).toBe(1);
      expect(f.buttonDone.spinner).toBe(false);
      expect(f.buttonDone.icon).toBe(true);
      expect(f.noButtonElsewhere).toEqual({
        historyTab: true,
        branchesTab: true,
      });
    });

    it("keeps the earlier rows when a refresh read fails", () => {
      expect(f.failedRefresh.rows).toHaveLength(5);
      expect(f.failedRefresh.notice).toBe(false);
    });

    it("leaves the refresh's rows when the initial reply lands after the refresh's", () => {
      expect(f.raced).toEqual(["Raced new"]);
    });

    it("shows a history error as the notice", () => {
      expect(f.failing).toBe(
        "Could not read the history: fatal: not a git repository",
      );
    });
  },
);
