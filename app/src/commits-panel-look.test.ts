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
const PRS = JSON.stringify([{ number: 9, title: "Gift cards", headRefName: "feature/x", headRefOid: sha("f"), author: { login: "lc" }, updatedAt: "2026-11-10T10:00:00Z", isDraft: false, statusCheckRollup: [] }]);
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
    facts: [facts("main", sha("a"), []), facts("feature/x", sha("c"), FX), facts("spike", sha("c"), []), facts(sha("f"), sha("b"), [ch("M", "p/a.py")])],
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
const rangeFor = (base, head) => ({ baseCommit: "base999", headCommit: "feed01", merged: false, changes: [{ status: "M", path: "p/a.py" }, { status: "A", path: "p/b.py" }] });
const calls = (m) => ({ history: m.commits.calls.history, branches: m.commits.calls.branches, pullRequests: m.commits.calls.pullRequests });
const out = { errors: [] };
window.addEventListener("error", (e) => out.errors.push(e.message));
window.addEventListener("unhandledrejection", (e) => out.errors.push(String(e.reason && e.reason.stack || e.reason)));

(async () => {
  await tick();

  const m = mount();
  m.views.ranges.set(sha("c") + ".." + sha("a"), rangeFor());
  window.dispatchEvent(new Event("focus"));
  document.dispatchEvent(new Event("visibilitychange"));
  await tick(1200);
  out.mounted = calls(m);
  out.railLabels = m.all(".rail button").map((b) => b.getAttribute("data-label"));
  m.views.ranges.set(sha("c") + ".." + sha("b"), rangeFor());
  click(m.q(".rail-commits"));
  await tick(100);
  out.opened = { open: m.q(".rail-commits").classList.contains("open"), display: getComputedStyle(m.q(".commits-panel")).display, calls: calls(m), rows: m.all(".commits-row").length, branch: m.q(".commits-on-branch").textContent, chips: m.all(".commits-chip").map((c) => c.textContent) };
  click(tabNamed(m, "Branches"));
  await tick(100);
  const hover = (node, type, x = 60, y = 60) => node.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: false }));
  const cardText = () => { const c = m.q(".commits-card"); return c.hidden ? null : [...c.children].map((n) => n.className + ":" + n.textContent); };
  const impactTexts = () => m.all(".commits-row").map((r) => ({ count: r.querySelector(".commits-impact-count").textContent, marks: [...r.querySelectorAll(".commits-impact-mark")].map((n) => n.className.replace("commits-impact-mark ", "") + n.textContent), other: (r.querySelector(".commits-impact-other") || { textContent: null }).textContent }));
  out.branchesHidden = { rows: m.all(".commits-row .commits-row-title").map((r) => r.textContent), hidden: m.q(".commits-hidden").textContent, on: m.q(".commits-hide").getAttribute("aria-checked") === "true", impact: impactTexts() };
  const impactNode = m.q(".commits-row .commits-impact");
  hover(impactNode, "pointerenter", 1390, 790);
  const countCard = m.q(".commits-card");
  const box = countCard.getBoundingClientRect();
  out.countCard = { lines: cardText(), insideWindow: box.right <= window.innerWidth && box.bottom <= window.innerHeight && box.left >= 0 && box.top >= 0 };
  hover(impactNode, "pointerleave");
  out.countCardGone = cardText();
  hover(m.q(".commits-row .commits-row-title"), "pointerenter");
  out.titleCard = cardText();
  hover(m.q(".commits-row .commits-row-title"), "pointerleave");
  m.q(".commits-hide").click();
  await tick();
  out.branches = { rows: m.all(".commits-row .commits-row-title").map((r) => r.textContent), defaultFirst: m.all(".commits-row")[0].textContent.includes("main"), impact: impactTexts(), hidden: m.q(".commits-hidden").textContent, calls: calls(m) };
  click(tabNamed(m, "Pull requests"));
  await tick(100);
  out.pulls = { calls: calls(m), rows: m.all(".commits-row").length, title: m.all(".commits-row-title").map((r) => r.textContent) };
  click(tabNamed(m, "History"));
  await tick();
  out.historyHide = { on: m.q(".commits-hide").getAttribute("aria-checked") === "true", rows: m.all(".commits-row").length };
  click(tabNamed(m, "Pull requests"));
  await tick();
  out.pullsAgain = calls(m);
  click(tabNamed(m, "History"));
  await tick();

  click(rowFor(m, "Middle"));
  await tick();
  out.pickTo = { to: slotText(m, "to"), from: slotText(m, "from"), open: m.q(".commits-range-open").textContent.split(String.fromCharCode(183)).join("|"), ready: m.q(".commits-range-open").classList.contains("ready"), summary: m.q(".commits-summary"), compare: m.q(".commits-compare"), openDisabled: m.q(".commits-range-open").disabled, fromActive: m.q(".commits-slot.from").classList.contains("active") };
  click(rowFor(m, "Oldest"));
  await tick();
  out.pickFrom = { from: slotText(m, "from"), shaded: m.all(".commits-row.shaded").map((r) => r.textContent.slice(0, 6)) };
  click(rowFor(m, "Older"));
  click(rowFor(m, "Older"));
  out.swap = { before: [slotText(m, "from"), slotText(m, "to")] };
  click(m.q(".commits-swap"));
  out.swap.after = [slotText(m, "from"), slotText(m, "to")];

  click(m.q(".commits-slot.from .commits-slot-clear"));
  click(m.q(".commits-slot.to .commits-slot-clear"));
  click(rowFor(m, "Newest"));
  click(rowFor(m, "Older"));
  await tick();
  out.viewsBefore = m.views.files.size;
  const askedByPanel = [...m.views.rangeCalls];
  click(m.q(".commits-range-open"));
  await tick(150);
  out.panelAsked = { keys: askedByPanel, unique: new Set(askedByPanel).size === askedByPanel.length };
  out.rangeCalls = m.views.rangeCalls.slice(askedByPanel.length);
  click(m.q(".rail-views"));
  await tick();
  const viewRows = m.all(".views-row").length;
  click(m.q(".rail-commits"));
  await tick();
  out.draft = {
    viewRows,
    name: m.q(".view-name-text").textContent,
    chip: m.q(".view-range-chip").textContent,
    unsaved: m.q(".view-unsaved") !== null && !m.q(".view-unsaved").hidden,
    saveShown: m.q(".commits-save") !== null && !m.q(".commits-save").hidden,
    boxes: m.all(".box").map((b) => b.dataset.id).sort(),
    files: m.views.files.size,
    recent: (await m.views.recent()).length,
  };
  out.countsBeforeBack = m.views.rangeCalls.length;
  m.explorer.show;
  click(m.q(".view-back"));
  await tick(100);
  out.back = { boxes: m.all(".box").length, name: m.q(".view-name-text").textContent, unsaved: !m.q(".view-unsaved").hidden };
  click(m.q(".view-forward"));
  await tick(150);
  out.forward = { name: m.q(".view-name-text").textContent, unsaved: !m.q(".view-unsaved").hidden, extraCalls: m.views.rangeCalls.length - out.countsBeforeBack, boxes: m.all(".box").map((b) => b.dataset.id).sort() };
  click(m.q(".commits-save"));
  await tick();
  const dialogName = m.q(".view-field-name");
  dialogName.value = "gifts";
  dialogName.dispatchEvent(new Event("input", { bubbles: true }));
  const description = m.q(".view-field-description");
  description.value = "what changed";
  description.dispatchEvent(new Event("input", { bubbles: true }));
  click(m.q(".view-confirm"));
  await tick(150);
  out.saved = { file: JSON.parse(m.views.files.get("gifts") || "null"), name: m.q(".view-name-text").textContent, unsaved: !m.q(".view-unsaved").hidden, saveButton: m.q(".commits-save").hidden };

  const WORDS = RS + [sha("a"), "aaaaaaa", sha("b"), "Ken", "1700000000", "Newest", ""].join(US) + "\\n\\nM\\tp/a.py\\n" + RS + [sha("b"), "bbbbbbb", sha("c"), "Ken", "1700000000", "Docs only", ""].join(US) + "\\n\\nM\\tdocs/x.md\\n" + RS + [sha("c"), "ccccccc", sha("d"), "Ken", "1700000000", "Version bump", ""].join(US) + "\\n\\n" + RS + [sha("d"), "ddddddd", "", "Ken", "1700000000", "Root", ""].join(US) + "\\n\\nA\\tp/a.py\\n";
  const filtered = mount({ history: WORDS });
  click(filtered.q(".rail-commits"));
  await tick(100);
  const titles = () => filtered.all(".commits-row .commits-row-title").map((r) => r.textContent);
  out.filtered = { on: filtered.q(".commits-hide").getAttribute("aria-checked") === "true", rows: titles(), hidden: filtered.q(".commits-hidden").textContent };
  filtered.q(".commits-hide").click();
  await tick();
  out.filtered.off = { rows: titles(), hidden: filtered.q(".commits-hidden").textContent, docs: rowFor(filtered, "Docs only").querySelector(".commits-impact").textContent, bump: rowFor(filtered, "Version bump").querySelector(".commits-impact").textContent };
  click(rowFor(filtered, "Docs only"));
  click(rowFor(filtered, "Version bump"));
  filtered.q(".commits-hide").click();
  await tick();
  out.filtered.pickedEmpty = { rows: titles(), hidden: filtered.q(".commits-hidden").textContent };
  click(filtered.q(".commits-slot.from .commits-slot-clear"));
  await tick();
  out.filtered.toOnly = titles();

  const pending = mount();
  click(pending.q(".rail-commits"));
  await tick(100);
  const openBox = () => pending.q(".commits-range-open").getBoundingClientRect();
  const slotsBox = pending.q(".commits-slots").getBoundingClientRect();
  out.pending = { first: { label: pending.q(".commits-range-open").textContent, disabled: pending.q(".commits-range-open").disabled }, abovTabs: openBox().bottom <= pending.q(".commits-tabs").getBoundingClientRect().top, belowSlots: openBox().top >= slotsBox.bottom };
  click(rowFor(pending, "Root"));
  await tick();
  out.pending.root = { label: pending.q(".commits-range-open").textContent, disabled: pending.q(".commits-range-open").disabled, note: pending.q(".commits-summary") && pending.q(".commits-summary").textContent };
  click(rowFor(pending, "Older"));
  await tick();
  out.pending.both = { label: pending.q(".commits-range-open").textContent, disabled: pending.q(".commits-range-open").disabled, ready: pending.q(".commits-range-open").classList.contains("ready") };

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
  modified.views.ranges.set(sha("c") + ".." + sha("a"), rangeFor());
  await tick();
  click(modified.q(".view-list"));
  click(modified.q(".view-item"));
  await tick(100);
  click(modified.q('.tree .row[data-path="p"] .reye'));
  await tick();
  click(modified.q(".rail-commits"));
  await tick(100);
  click(rowFor(modified, "Newest"));
  click(rowFor(modified, "Older"));
  const askedBefore = modified.views.rangeCalls.length;
  click(modified.q(".commits-range-open"));
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

  const reopen = mount();
  await tick();
  click(reopen.q(".rail-commits"));
  await tick(100);
  click(reopen.q(".rail-commits"));
  await tick();
  click(reopen.q(".rail-commits"));
  await tick(100);
  out.reopened = calls(reopen);

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

type Calls = { history: number; branches: number; pullRequests: number };

type GhFacts = {
  notice: string | null;
  rows: number;
  history: number;
  branches: number;
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
  countCard: { lines: string[] | null; insideWindow: boolean };
  countCardGone: string[] | null;
  titleCard: string[] | null;
  branches: {
    rows: string[];
    defaultFirst: boolean;
    impact: Impact[];
    hidden: string;
    calls: Calls;
  };
  historyHide: { on: boolean; rows: number };
  filtered: {
    on: boolean;
    rows: string[];
    hidden: string;
    off: { rows: string[]; hidden: string; docs: string; bump: string };
    pickedEmpty: { rows: string[]; hidden: string };
    toOnly: string[];
  };
  pending: {
    first: { label: string; disabled: boolean };
    abovTabs: boolean;
    belowSlots: boolean;
    root: { label: string; disabled: boolean; note: string | null };
    both: { label: string; disabled: boolean; ready: boolean };
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
  pulls: { calls: Calls; rows: number; title: string[] };
  pullsAgain: Calls;
  pickTo: {
    to: string;
    from: string;
    open: string;
    ready: boolean;
    summary: unknown;
    compare: unknown;
    openDisabled: boolean;
    fromActive: boolean;
  };
  pickFrom: { from: string; shaded: string[] };
  swap: { before: string[]; after: string[] };
  viewsBefore: number;
  panelAsked: { keys: string[]; unique: boolean };
  rangeCalls: string[];
  draft: {
    name: string;
    chip: string;
    unsaved: boolean;
    saveShown: boolean;
    boxes: string[];
    files: number;
    recent: number;
    viewRows: number;
  };
  back: { boxes: number; name: string; unsaved: boolean };
  forward: {
    name: string;
    unsaved: boolean;
    extraCalls: number;
    boxes: string[];
  };
  saved: {
    file: { change: { base: string; head: string } };
    name: string;
    unsaved: boolean;
    saveButton: boolean;
  };
  guard: { dialog: string | null; ranges: number };
  gh_missing: GhFacts;
  "gh_signed-out": GhFacts;
  gh_failed: GhFacts;
  reopened: Calls;
  failing: string;
};

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

    it("hides the empty default branch and spike by default, shows the bold count with squares and the not-on-the-canvas line, and lists them all with the switch off", () => {
      expect(f.branchesHidden.on).toBe(true);
      expect(f.branchesHidden.rows).toEqual(["feature/x"]);
      expect(f.branchesHidden.hidden).toBe("2 hidden");
      expect(f.branchesHidden.impact).toEqual([
        {
          count: "3 files",
          marks: ["added1", "modified1", "removed1"],
          other: "+1 not on the canvas",
        },
      ]);
      expect(f.branches.defaultFirst).toBe(true);
      expect(f.branches.rows).toEqual(["main", "feature/x", "spike"]);
      expect(f.branches.impact.map((one) => one.count)).toEqual([
        "no files",
        "3 files",
        "no files",
      ]);
      expect(f.branches.hidden).toBe("");
      expect(f.branches.calls.pullRequests).toBe(0);
      expect(f.pulls.calls.pullRequests).toBe(1);
      expect(f.pulls.rows).toBe(1);
      expect(f.pulls.title).toEqual(["#9 Gift cards"]);
      expect(f.pullsAgain.pullRequests).toBe(1);
      expect(f.historyHide).toEqual({ on: true, rows: 5 });
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

    it("hides rows with no files on the canvas, keeps the picked ends and the unknown rows, and counts them", () => {
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
      });
      expect(f.filtered.toOnly).toEqual(["Newest", "Docs only", "Root"]);
    });

    it("puts Open under From and To, disabled while an end is missing and naming which, then accent with the range and its count", () => {
      expect(f.pending.first).toEqual({
        label: "pick To below",
        disabled: true,
      });
      expect(f.pending.abovTabs).toBe(true);
      expect(f.pending.belowSlots).toBe(true);
      expect(f.pending.root.label).toBe("pick From below");
      expect(f.pending.root.disabled).toBe(true);
      expect(f.pending.root.note).toBe("no parent commit");
      expect(f.pending.both.disabled).toBe(false);
      expect(f.pending.both.ready).toBe(true);
      expect(f.pending.both.label).toMatch(/^Open ccccccc\.\.eeeeeee/);
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

    it("fills To then From, shades the commits between them and swaps the slots", () => {
      expect(f.pickTo.to).toBe("bbbbbbb");
      expect(f.pickTo.from).toBe("ccccccc");
      expect(f.pickTo.open).toBe(
        `Open ${"c".repeat(7)}..${"b".repeat(7)} | 2 files`,
      );
      expect(f.pickTo.ready).toBe(true);
      expect(f.pickTo.summary).toBeNull();
      expect(f.pickTo.compare).toBeNull();
      expect(f.pickTo.openDisabled).toBe(false);
      expect(f.pickTo.fromActive).toBe(true);
      expect(f.pickFrom.from).toBe("ddddddd");
      expect(f.pickFrom.shaded).toHaveLength(1);
      expect(f.swap.before).toEqual(["ccccccc", "bbbbbbb"]);
      expect(f.swap.after).toEqual(["bbbbbbb", "ccccccc"]);
    });

    it("opens a range as an unsaved change view named Change with its chip and Save as view, leaving the Views and recent lists alone", () => {
      expect(f.viewsBefore).toBe(0);
      expect(f.panelAsked.keys.at(-1)).toBe(
        `${"c".repeat(40)}..${"a".repeat(40)}`,
      );
      expect(f.rangeCalls).toEqual([`${"c".repeat(40)}..${"a".repeat(40)}`]);
      expect(f.draft.name).toBe("Change");
      expect(f.draft.chip).toBe(`${"c".repeat(40)}..${"a".repeat(40)}`);
      expect(f.draft.unsaved).toBe(true);
      expect(f.draft.saveShown).toBe(true);
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
      expect(f.forward.extraCalls).toBe(1);
      expect(f.forward.boxes).toEqual(["p/a.py", "p/b.py"]);
    });

    it("saves the draft as a view whose change equals the range and drops the unsaved badge", () => {
      expect(f.saved.file.change).toEqual({
        base: "c".repeat(40),
        head: "a".repeat(40),
      });
      expect(f.saved.name).toBe("gifts");
      expect(f.saved.unsaved).toBe(false);
      expect(f.saved.saveButton).toBe(true);
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
        expect(f[key].branches).toBe(1);
      }
    });

    it("loads each list again when the panel is closed and reopened", () => {
      expect(f.reopened).toEqual({ history: 2, branches: 2, pullRequests: 0 });
    });

    it("shows a history error as the notice", () => {
      expect(f.failing).toBe(
        "Could not read the history: fatal: not a git repository",
      );
    });
  },
);
