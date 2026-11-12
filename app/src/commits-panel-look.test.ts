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
const facts = (ref, mergeBase) => ({ ref, mergeBase, behind: 1, ahead: 2, added: 1, modified: 1, removed: 0 });
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const make = (extra, steps) => JSON.stringify({ schema_version: 4, description: "d", commit: "cur1234", ...extra, steps: steps || [{ kind: "pick", module: "p/a.py" }] }, null, 2) + "\\n";

function mount(options = {}, files = {}) {
  const host = document.createElement("div");
  host.style.cssText = "width:1400px;height:800px;display:flex;flex-direction:column";
  document.body.append(host);
  const views = fakeViews(files);
  const commits = fakeCommits({
    history: { branch: "main", text: HISTORY },
    branches: { defaultRef: "origin/main", total: 3, text: BRANCHES },
    pullRequests: options.pullRequests || { status: "ok", detail: "", text: PRS },
    facts: [facts("main", sha("a")), facts("feature/x", sha("c")), facts("spike", sha("c")), facts(sha("f"), sha("b"))],
  });
  const lines = [];
  const explorer = mountExplorer({ container: host, loaded, title: "demo", views, commits, post: (input) => { lines.push(input); return lines.length; } });
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
  click(m.q(".rail-commits"));
  await tick(100);
  out.opened = { open: m.q(".rail-commits").classList.contains("open"), display: getComputedStyle(m.q(".commits-panel")).display, calls: calls(m), rows: m.all(".commits-row").length, branch: m.q(".commits-on-branch").textContent, chips: m.all(".commits-chip").map((c) => c.textContent) };
  click(tabNamed(m, "Branches"));
  await tick(100);
  out.branches = { rows: m.all(".commits-row .commits-row-title").map((r) => r.textContent), defaultFirst: m.all(".commits-row")[0].textContent.includes("main"), counts: m.all(".commits-counts").map((c) => c.textContent), calls: calls(m) };
  click(tabNamed(m, "Pull requests"));
  await tick(100);
  out.pulls = { calls: calls(m), rows: m.all(".commits-row").length, title: m.all(".commits-row-title").map((r) => r.textContent) };
  click(tabNamed(m, "History"));
  await tick();
  click(tabNamed(m, "Pull requests"));
  await tick();
  out.pullsAgain = calls(m);
  click(tabNamed(m, "History"));
  await tick();

  click(rowFor(m, "Middle"));
  await tick();
  out.pickTo = { to: slotText(m, "to"), from: slotText(m, "from"), summary: m.q(".commits-summary").textContent, openDisabled: m.q(".commits-range-open").disabled, fromActive: m.q(".commits-slot.from").classList.contains("active") };
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
  click(m.q(".commits-range-open"));
  await tick(150);
  out.rangeCalls = [...m.views.rangeCalls];
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
  click(modified.q(".commits-range-open"));
  await tick(100);
  out.guard = { dialog: modified.q(".unsaved-dialog-body") === null ? null : modified.q(".unsaved-dialog-body").textContent, ranges: modified.views.rangeCalls.length };

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
  branches: {
    rows: string[];
    defaultFirst: boolean;
    counts: string[];
    calls: Calls;
  };
  pulls: { calls: Calls; rows: number; title: string[] };
  pullsAgain: Calls;
  pickTo: {
    to: string;
    from: string;
    summary: string;
    openDisabled: boolean;
    fromActive: boolean;
  };
  pickFrom: { from: string; shaded: string[] };
  swap: { before: string[]; after: string[] };
  viewsBefore: number;
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

    it("puts the Commits button last on the rail and loads nothing until the panel opens", () => {
      expect(f.railLabels.at(-1)).toBe("Commits");
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

    it("lists the default branch first with counts, and loads the pull requests once when their tab first shows", () => {
      expect(f.branches.defaultFirst).toBe(true);
      expect(f.branches.rows).toEqual(["main", "feature/x", "spike"]);
      expect(f.branches.counts).toEqual(["+1 ~1 -0", "+1 ~1 -0", "+1 ~1 -0"]);
      expect(f.branches.calls.pullRequests).toBe(0);
      expect(f.pulls.calls.pullRequests).toBe(1);
      expect(f.pulls.rows).toBe(1);
      expect(f.pulls.title).toEqual(["#9 Gift cards"]);
      expect(f.pullsAgain.pullRequests).toBe(1);
    });

    it("fills To then From, shades the commits between them and swaps the slots", () => {
      expect(f.pickTo.to).toBe("bbbbbbb");
      expect(f.pickTo.from).toBe("ccccccc");
      expect(f.pickTo.summary).toBe(`${"c".repeat(7)}..${"b".repeat(7)}`);
      expect(f.pickTo.openDisabled).toBe(false);
      expect(f.pickTo.fromActive).toBe(true);
      expect(f.pickFrom.from).toBe("ddddddd");
      expect(f.pickFrom.shaded).toHaveLength(1);
      expect(f.swap.before).toEqual(["ccccccc", "bbbbbbb"]);
      expect(f.swap.after).toEqual(["bbbbbbb", "ccccccc"]);
    });

    it("opens a range as an unsaved change view named Change with its chip and Save as view, leaving the Views and recent lists alone", () => {
      expect(f.viewsBefore).toBe(0);
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
        expect(f[key].branches).toBe(3);
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
