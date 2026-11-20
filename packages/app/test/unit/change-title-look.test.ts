import { beforeAll, describe, expect, it } from "vitest";
import { collectFacts, FAKE_WORKER, here, webkit } from "../../src/look-page";

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
const selection = { extensions: [".py"], skip_directory_names: [], skip_directory_prefixes: [], skip_directory_suffixes: [], skip_directory_globs: [], skip_file_globs: [], skip_directories_containing: [] };
const scan = { commit: "cur1234", selection, modules: IDS.map((id) => ({ id, kind: "module" })), edges: [edge], foreign: [] };
const loaded = loadedOf({ modules: IDS, scans: [{ file: "scan.json", scan }] });

const sha = (c) => c.repeat(40);
const RS = String.fromCharCode(30);
const US = String.fromCharCode(31);
const record = (c, parent, subject, deco, files, author = "Ken") => RS + [sha(c), c.repeat(7), parent === null ? "" : sha(parent), author, "1700000000", subject, deco].join(US) + "\\n\\n" + files.map((f) => f + "\\n").join("");
const HISTORY = record("a", "b", "Newest", "HEAD -> main, origin/main", ["M\\tp/a.py"]) + record("b", "c", "Middle", "", ["A\\tp/b.py"]) + record("c", "d", "Older", "", ["M\\tp/c.py"]) + record("d", "e", "Oldest", "tag: v0.1.0", ["D\\tp/d.py"]) + record("e", null, "Root", "", ["A\\tp/a.py"]);
const SEVERAL = record("a", "b", "Newest", "HEAD -> main", ["M\\tp/a.py"]) + record("b", "c", "Middle", "", ["A\\tp/b.py"], "Ana") + record("c", "d", "Older", "", ["M\\tp/c.py"]) + record("d", "e", "Oldest", "", ["D\\tp/d.py"]) + record("e", null, "Root", "", ["A\\tp/a.py"]);
const BRANCHES = ["main", "feature/x"].map((name, i) => [name, String(i).repeat(7), "Ken", "1699000000"].join(US) + "\\n").join("");
const PRS = JSON.stringify([{ number: 9, title: "Gift cards", headRefName: "feature/x", headRefOid: sha("f"), author: { login: "lc" }, updatedAt: "2026-11-10T10:00:00Z", isDraft: false, statusCheckRollup: [] }]);
const ch = (status, path) => ({ status, path });
const facts = (ref, mergeBase, changes) => ({ ref, mergeBase, behind: 1, ahead: 2, changes });
const EPOCH = 1794933540;
const detail = (message) => "Ken" + US + EPOCH + US + message;
const DETAILS = {
  ["commit:" + sha("b")]: { git: detail("Add the middle thing\\n\\nFirst paragraph\\nwraps here.\\n\\nSecond."), pull: null, defaultRef: null },
  ["branch:feature/x"]: { git: detail("tip subject\\n"), pull: { status: "ok", detail: "", text: JSON.stringify([{ number: 1026, title: "feat(app): show length", isDraft: false, author: { login: "ken" }, statusCheckRollup: [] }]) }, defaultRef: "origin/main" },
  ["pr:9"]: { git: null, pull: { status: "ok", detail: "", text: JSON.stringify({ number: 9, title: "Gift cards", body: "<!-- lc:item=REC-9 -->\\n<!-- lc:body -->\\n\\nGift cards\\n\\nPara one\\nwraps.\\n\\nMore.", state: "OPEN", isDraft: false, author: { login: "lc" }, statusCheckRollup: [{ status: "IN_PROGRESS" }] }) }, defaultRef: "origin/main" },
};
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
let step = "";
const click = (node) => { if (!node) throw new Error("click on nothing at " + step); node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); };
const typeInto = (node, value) => { node.value = value; node.dispatchEvent(new Event("input", { bubbles: true })); };
const make = (extra) => JSON.stringify({ schema_version: 4, description: "d", commit: "cur1234", steps: [{ kind: "pick", module: "p/a.py" }], ...extra }, null, 2) + "\\n";
const rangeFor = () => ({ baseCommit: "base999", headCommit: "feed01", merged: false, changes: [{ status: "M", path: "p/a.py" }, { status: "A", path: "p/b.py" }] });

function mount(options = {}) {
  const host = document.createElement("div");
  host.style.cssText = "width:1400px;height:800px;display:flex;flex-direction:column";
  document.body.append(host);
  const views = fakeViews(options.files || {});
  for (const key of ["c..b", "d..a", "d..a", "c..feature/x", "b..f"]) {
    const [base, head] = key.split("..");
    views.ranges.set((base.length === 1 ? sha(base) : base) + ".." + (head.length === 1 ? sha(head) : head), rangeFor());
  }
  const commits = fakeCommits({
    history: { branch: "main", text: options.history || HISTORY },
    branches: { defaultRef: "origin/main", total: 2, text: BRANCHES },
    pullRequests: { status: "ok", detail: "", text: PRS },
    facts: [facts("main", sha("a"), []), facts("feature/x", sha("c"), [ch("M", "p/a.py"), ch("A", "p/b.py")]), facts(sha("f"), sha("b"), [ch("M", "p/a.py"), ch("A", "p/b.py")])],
    details: options.details === undefined ? DETAILS : options.details,
  });
  const explorer = mountExplorer({ container: host, loaded, title: "demo", views, commits, post: () => null, timeZone: "UTC" });
  const q = (selector) => host.querySelector(selector);
  const all = (selector) => [...host.querySelectorAll(selector)];
  return { host, views, commits, explorer, q, all };
}

const rowFor = (m, text) => m.all(".commits-row").find((r) => r.textContent.includes(text));
const tabNamed = (m, name) => m.all(".commits-tab").find((t) => t.textContent === name);
const openPanel = async (m) => { step = "panel"; click(m.q(".rail-commits")); await tick(150); };
const pickRow = async (m, text, tab) => { step = "pick " + text; if (tab) { click(tabNamed(m, tab)); await tick(150); } click(rowFor(m, text)); await tick(300); };
const heading = (m) => { const title = m.q(".view-heading-title"); return { present: title !== null, title: title === null ? null : title.textContent, lines: m.all(".view-heading-description tspan").map((n) => n.textContent) }; };
const bar = (m) => { const text = m.q(".view-name-text"); const chip = m.q(".view-range-chip"); return { present: text !== null && chip !== null, name: text.textContent, nameTitle: text.title, chip: chip.textContent, chipTitle: chip.title }; };
const dialog = (m) => { const confirm = m.q(".view-confirm"); return { present: confirm !== null, name: m.q(".view-field-name").value, title: m.q(".view-field-title").value, description: m.q(".view-field-description").value, disabled: confirm.disabled, problem: m.q(".view-problem").textContent }; };
const out = { errors: [] };
window.addEventListener("error", (e) => out.errors.push(e.message));
window.addEventListener("unhandledrejection", (e) => out.errors.push(String(e.reason && e.reason.stack || e.reason)));

(async () => {
  await tick();

  const c = mount({ files: { taken: make({}) } });
  await openPanel(c);
  await pickRow(c, "Middle");
  out.commit = { bar: bar(c), heading: heading(c) };
  step = "save"; click(c.q(".view-save"));
  await tick();
  out.commitDialog = dialog(c);
  typeInto(c.q(".view-field-name"), "taken");
  out.commitTaken = dialog(c);

  const b = mount({ details: {} });
  await openPanel(b);
  await pickRow(b, "Middle");
  out.nothing = { bar: bar(b), heading: heading(b), calls: b.commits.calls.details };

  const n = mount({ details: { ["commit:" + sha("b")]: { git: detail("Bare subject\\n"), pull: null, defaultRef: null } } });
  await openPanel(n);
  await pickRow(n, "Middle");
  click(n.q(".view-save"));
  await tick();
  out.bodyless = { heading: heading(n), dialog: dialog(n) };

  const g = mount();
  const original = g.commits.changeDetail;
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  g.commits.changeDetail = async (kind, reference) => { await gate; return original(kind, reference); };
  await openPanel(g);
  await pickRow(g, "Middle");
  click(g.q(".view-save"));
  await tick();
  out.heldBefore = dialog(g);
  typeInto(g.q(".view-field-description"), "typed by hand");
  typeInto(g.q(".view-field-title"), "my title");
  release();
  await tick(300);
  out.heldAfter = { dialog: dialog(g), bar: bar(g) };

  const r = mount();
  await openPanel(r);
  await pickRow(r, "Gift cards", "Pull requests");
  out.pull = { bar: bar(r), heading: heading(r), calls: r.commits.calls.details };

  const t = mount();
  await openPanel(t);
  await pickRow(t, "feature/x", "Branches");
  out.branch = { bar: bar(t), heading: heading(t), calls: t.commits.calls.details };
  click(t.q(".view-save"));
  await tick();
  out.branchDialog = dialog(t);

  const rangeOf = async (history) => {
    const m = mount({ history });
    await openPanel(m);
    click(m.q(".commits-mode-range"));
    await tick();
    click(rowFor(m, "Newest"));
    click(rowFor(m, "Older"));
    await tick(300);
    return { bar: bar(m), heading: heading(m), calls: m.commits.calls.details };
  };
  out.rangeOne = await rangeOf(HISTORY);
  out.rangeSeveral = await rangeOf(SEVERAL);

  const openSaved = async (name, change, extra = {}) => {
    const m = mount({ files: { [name]: make({ title: "Saved title", description: "Saved description", change, ...extra }) } });
    await tick(100);
    step = "list " + name; click(m.q(".view-list"));
    await tick();
    click(m.all(".view-item").find((item) => item.querySelector(".view-item-name").textContent === name));
    await tick(300);
    return { bar: bar(m), heading: heading(m), calls: m.commits.calls.details };
  };
  out.savedCommit = await openSaved("saved-commit", { base: sha("c"), head: sha("b"), name: "commit bbbbbbb" });
  out.savedBranch = await openSaved("saved-branch", { base: sha("c"), head: "feature/x", name: "branch feature/x" });
  out.savedPull = await openSaved("saved-pull", { base: sha("b"), head: sha("f"), name: "pull request #9" });
  out.savedRange = await openSaved("saved-range", { base: sha("d"), head: sha("a"), name: "ccccccc to aaaaaaa" });

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(out))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Bar = {
  present: boolean;
  name: string;
  nameTitle: string;
  chip: string;
  chipTitle: string;
};
type Heading = { present: boolean; title: string | null; lines: string[] };
type Dialog = {
  present: boolean;
  name: string;
  title: string;
  description: string;
  disabled: boolean;
  problem: string;
};
type Opened = { bar: Bar; heading: Heading; calls?: string[] };
type Facts = {
  errors: string[];
  commit: Opened;
  commitDialog: Dialog;
  commitTaken: Dialog;
  nothing: Opened;
  bodyless: { heading: Heading; dialog: Dialog };
  heldBefore: Dialog;
  heldAfter: { dialog: Dialog; bar: Bar };
  pull: Opened;
  branch: Opened;
  branchDialog: Dialog;
  rangeOne: Opened;
  rangeSeveral: Opened;
  savedCommit: Opened;
  savedBranch: Opened;
  savedPull: Opened;
  savedRange: Opened;
};

describe.skipIf(webkit === undefined)(
  "a change view titled from its change, in a real browser",
  () => {
    let f = {} as Facts;

    beforeAll(async () => {
      f = await collectFacts<Facts>(HARNESS, "change-title");
    }, 180_000);

    it("raises no page error", () => {
      expect(f.errors).toEqual([]);
    });

    it("titles a commit with its subject in the toolbar and the heading, with the chip dated", () => {
      expect(f.commit.bar.present).toBe(true);
      expect(f.commit.heading.present).toBe(true);
      expect(f.commit.bar.name).toBe("Add the middle thing");
      expect(f.commit.bar.nameTitle).toBe(f.commit.bar.name);
      expect(f.commit.heading.title).toBe(f.commit.bar.name);
      expect(f.commit.bar.chip).toBe("commit bbbbbbb · 17 Nov");
      expect(f.commit.heading.lines).toEqual([
        "First paragraph wraps here.",
        "Ken · 17 Nov 2026 16:39 · 2 files on the canvas",
      ]);
    });

    it("opens the save dialog with the name, title and description filled in and Save enabled", () => {
      expect(f.commitDialog.present).toBe(true);
      expect(f.commitDialog.name).toBe("add-the-middle-thing");
      expect(f.commitDialog.title).toBe(f.commit.bar.name);
      expect(f.commitDialog.description).toBe("First paragraph wraps here.");
      expect(f.commitDialog.disabled).toBe(false);
    });

    it("disables Save and names the problem when the default name already exists", () => {
      expect(f.commitTaken.present).toBe(true);
      expect(f.commitTaken.disabled).toBe(true);
      expect(f.commitTaken.problem).toBe("taken already exists");
    });

    it("shows the chip text as the title, never Change, when the detail is all null", () => {
      expect(f.nothing.bar.present).toBe(true);
      expect(f.nothing.heading.present).toBe(true);
      expect(f.nothing.bar.name).toBe("commit bbbbbbb");
      expect(f.nothing.bar.name).not.toBe("Change");
      expect(f.nothing.bar.chip).toBe("commit bbbbbbb");
      expect(f.nothing.heading.title).toBe("commit bbbbbbb");
      expect(f.nothing.heading.lines).toEqual(["2 files on the canvas"]);
      expect(f.nothing.calls).toEqual([`commit:${"b".repeat(40)}`]);
    });

    it("saves a body-less commit enabled with its facts line as the description", () => {
      expect(f.bodyless.heading.present).toBe(true);
      expect(f.bodyless.heading.lines).toEqual([
        "Ken · 17 Nov 2026 16:39 · 2 files on the canvas",
      ]);
      expect(f.bodyless.dialog.present).toBe(true);
      expect(f.bodyless.dialog.description).toBe(f.bodyless.heading.lines[0]);
      expect(f.bodyless.dialog.disabled).toBe(false);
    });

    it("never overwrites what is typed when the fetch resolves with the dialog open", () => {
      expect(f.heldBefore.name).toBe("commit-bbbbbbb");
      expect(f.heldBefore.title).toBe("commit bbbbbbb");
      expect(f.heldAfter.bar.name).toBe("Add the middle thing");
      expect(f.heldAfter.dialog.description).toBe("typed by hand");
      expect(f.heldAfter.dialog.title).toBe("my title");
      expect(f.heldAfter.dialog.name).toBe("commit-bbbbbbb");
    });

    it("titles a pull request #N title with its state and checks", () => {
      expect(f.pull.bar.present).toBe(true);
      expect(f.pull.heading.present).toBe(true);
      expect(f.pull.bar.name).toBe("#9 Gift cards");
      expect(f.pull.bar.chip).toBe("pull request #9");
      expect(f.pull.heading.title).toBe("#9 Gift cards");
      expect(f.pull.heading.lines).toEqual([
        "Para one wraps.",
        "lc · open · checks pending · 2 ahead, 1 behind main · 2 files on the canvas",
      ]);
      expect(f.pull.calls).toEqual(["pr:9"]);
    });

    it("titles a branch from its open pull request with two facts lines", () => {
      expect(f.branch.bar.present).toBe(true);
      expect(f.branch.heading.present).toBe(true);
      expect(f.branch.bar.name).toBe("#1026 feat(app): show length");
      expect(f.branch.bar.chip).toBe("branch feature/x");
      expect(f.branch.heading.title).toBe(f.branch.bar.name);
      expect(f.branch.heading.lines).toEqual([
        "2 ahead, 1 behind main · Ken · pull request #1026, open",
        "2 files on the canvas",
      ]);
      expect(f.branch.calls).toEqual(["branch:feature/x"]);
      expect(f.branchDialog.description).toBe(f.branch.heading.lines[0]);
      expect(f.branchDialog.disabled).toBe(false);
    });

    it("titles a range by one author and by several", () => {
      expect(f.rangeOne.bar.present).toBe(true);
      expect(f.rangeOne.bar.name).toBe("3 commits, ccccccc to aaaaaaa");
      expect(f.rangeOne.bar.chip).toBe("ccccccc to aaaaaaa");
      expect(f.rangeOne.heading.title).toBe(f.rangeOne.bar.name);
      expect(f.rangeOne.heading.lines).toEqual([
        "Newest and 2 earlier commits",
        "Ken · 14 Nov 2023 22:13 · 2 files on the canvas",
      ]);
      expect(f.rangeOne.calls).toEqual([]);
      expect(f.rangeSeveral.heading.lines[1]).toBe(
        "several authors · 14 Nov 2023 22:13 · 2 files on the canvas",
      );
    });

    it("keeps a saved commit view's name and heading and dates its chip", () => {
      expect(f.savedCommit.bar.present).toBe(true);
      expect(f.savedCommit.heading.present).toBe(true);
      expect(f.savedCommit.bar.name).toBe("saved-commit");
      expect(f.savedCommit.heading.title).toBe("Saved title");
      expect(f.savedCommit.heading.lines).toEqual(["Saved description"]);
      expect(f.savedCommit.bar.chip).toBe("commit bbbbbbb · 17 Nov");
      expect(f.savedCommit.calls).toEqual([`commit:${"b".repeat(40)}`]);
    });

    it("makes no detail call for a saved branch, pull request or range view", () => {
      for (const one of [f.savedBranch, f.savedPull, f.savedRange]) {
        expect(one.bar.present).toBe(true);
        expect(one.heading.present).toBe(true);
        expect(one.heading.title).toBe("Saved title");
        expect(one.calls).toEqual([]);
      }

      expect(f.savedBranch.bar.chip).toBe("branch feature/x");
      expect(f.savedPull.bar.chip).toBe("pull request #9");
      expect(f.savedRange.bar.chip).toBe("ccccccc to aaaaaaa");
    });
  },
);
