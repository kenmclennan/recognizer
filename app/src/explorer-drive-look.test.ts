import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, FAKE_WORKER, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
window.__TAURI_INTERNALS__ = { invoke: async () => "0.0.0" };
import { showExplorer } from ${JSON.stringify(here("explorer.ts"))};
import { buildFooter } from ${JSON.stringify(here("footer-view.ts"))};
import { fakeWindow } from ${JSON.stringify(here("window-fake.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
${FAKE_WORKER}

const edge = (from, to, name) => ({ from, to, kind: "depends", line: 1, names: [name] });
const ids = ["app/hub.py", "app/m1.py", "app/m2.py", "app/m3.py", "lib/a.py", "lib/b.py"];
const scan = {
  modules: ids.map((id) => ({ id, kind: "module" })),
  edges: [edge("app/hub.py", "lib/a.py", "A"), edge("app/hub.py", "lib/b.py", "B")],
  foreign: [],
};
const loaded = { modules: ids, scans: [{ file: "scan.json", scan }], policy: null, notices: [], blocking: null, findings: [], sensors: [] };
const viewText = JSON.stringify({ schema_version: 1, description: "d", commit: null, steps: [{ kind: "pick", module: "app/hub.py" }] }, null, 2) + "\\n";

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

const footerHost = document.getElementById("footer");
const footer = buildFooter(footerHost);
const facts = {};

function mount(host, views) {
  const win = fakeWindow();
  const lines = [];
  host.style.cssText = "flex:none;height:800px;display:flex;flex-direction:column;width:1800px";
  document.getElementById("content").append(host);
  showExplorer(host, loaded, "demo", () => {}, views, undefined, null, undefined, undefined, undefined, undefined, win, (line) => { lines.push(line === null ? null : line.text); footer.setAgentLine(line); });
  return { win, lines, q: (s) => host.querySelector(s) };
}

const drive = (win, action, args = [], options = {}, by = "Claude") => win.drive({ action, args, options, by });
const lineNode = () => footerHost.querySelector(".agent-line");
const lineText = () => (lineNode().hidden ? null : lineNode().textContent);

(async () => {
  const views = fakeViews({ overview: viewText });
  const first = mount(document.createElement("div"), views);
  const second = mount(document.createElement("div"), fakeViews({}));
  await tick();
  const { win, q } = first;

  facts.addDone = await drive(win, "add", ["app/m1.py", "app/m2.py", "app/m3.py", "lib/a.py"]);
  await tick();
  facts.afterAdd = win.last().modules;
  facts.line = lineText();
  facts.undoButton = lineNode().querySelector("button").textContent;
  facts.role = lineNode().getAttribute("role");
  facts.backTitle = q(".view-back").title;
  facts.backAria = q(".view-back").getAttribute("aria-label");
  facts.secondUntouched = second.win.published.length === 0 || second.win.last().modules.length === 0;

  click(lineNode().querySelector("button"));
  await tick();
  facts.afterUndo = win.last().modules;
  facts.lineAfterUndo = lineText();
  facts.forwardTitle = q(".view-forward").title;
  facts.backAfterUndo = q(".view-back").title;

  click(q(".view-forward"));
  await tick();
  facts.afterForward = win.last().modules;
  facts.lineAfterForward = lineText();

  facts.noop = await drive(win, "add", ["app/m1.py"]);
  facts.lineAfterNoop = lineText();

  facts.unknownModule = await drive(win, "add", ["app/m1.py", "app/zzz.py"]);
  facts.unknownView = await drive(win, "open-view", ["nope"]);
  facts.unknownFolder = await drive(win, "fold", ["nowhere"]);
  facts.afterRefusals = win.last().modules;

  await drive(win, "add", ["app/hub.py"]);
  await tick();
  facts.lineBeforeUser = lineText();
  click(q('.tree .row[data-path="app"] .name'));
  click(q('.tree .row[data-path="lib"] .name'));
  await tick();
  click(q('.tree .row[data-path="lib/b.py"] .rcheck'));
  await tick();
  facts.lineAfterUser = lineText();
  facts.backAfterUser = q(".view-back").title;

  facts.removeDone = await drive(win, "remove", ["lib/b.py"]);
  await tick();
  facts.afterRemove = win.last().modules;
  facts.foldDone = await drive(win, "fold", ["lib"]);
  await tick();
  facts.afterFold = win.last().folded;
  facts.unfoldDone = await drive(win, "fold", ["lib"], { off: true });
  await tick();
  facts.afterUnfold = win.last().folded;
  facts.focusDone = await drive(win, "focus", ["app"]);
  await tick();
  facts.afterFocus = win.last().focus;
  facts.selectDone = await drive(win, "select", ["app/hub.py"]);
  await tick();
  facts.afterSelect = win.last().selection;
  facts.trailDone = await drive(win, "trail", ["uses", "lib/a.py"]);
  await tick();
  facts.afterTrail = win.last().trail.map((p) => p.selection && p.selection.id);
  facts.trailNotNeighbour = await drive(win, "trail", ["uses", "app/m1.py"]);
  facts.clearBad = await drive(win, "clear", ["everything"]);
  facts.clearSelection = await drive(win, "clear", ["selection"]);
  await tick();
  facts.afterClearSelection = win.last().selection;
  facts.clearAll = await drive(win, "clear", ["all"]);
  await tick();
  facts.afterClearAll = win.last().modules;

  facts.openViewDone = await drive(win, "open-view", ["overview"]);
  await tick();
  facts.afterOpenView = { view: win.last().view, modules: win.last().modules };
  facts.otherModules = second.win.published.length === 0 ? [] : second.win.last().modules;

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Answer =
  | { status: "done"; summary: string; changed: boolean }
  | { status: "refused"; reason: string };

type Facts = {
  addDone: Answer;
  afterAdd: string[];
  line: string | null;
  undoButton: string;
  role: string;
  backTitle: string;
  backAria: string;
  secondUntouched: boolean;
  afterUndo: string[];
  lineAfterUndo: string | null;
  forwardTitle: string;
  backAfterUndo: string;
  afterForward: string[];
  lineAfterForward: string | null;
  noop: Answer;
  lineAfterNoop: string | null;
  unknownModule: Answer;
  unknownView: Answer;
  unknownFolder: Answer;
  afterRefusals: string[];
  lineBeforeUser: string | null;
  lineAfterUser: string | null;
  backAfterUser: string;
  removeDone: Answer;
  afterRemove: string[];
  foldDone: Answer;
  afterFold: string[];
  unfoldDone: Answer;
  afterUnfold: string[];
  focusDone: Answer;
  afterFocus: string | null;
  selectDone: Answer;
  afterSelect: { kind: string; id: string } | null;
  trailDone: Answer;
  afterTrail: (string | null)[];
  trailNotNeighbour: Answer;
  clearBad: Answer;
  clearSelection: Answer;
  afterClearSelection: unknown;
  clearAll: Answer;
  afterClearAll: string[];
  openViewDone: Answer;
  afterOpenView: { view: string | null; modules: string[] };
  otherModules: string[];
};

describe.skipIf(chrome === undefined)("driving a window", () => {
  let f: Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "drive");
  }, 120000);

  it("add answers done and puts the modules on the canvas", () => {
    expect(f.addDone).toEqual({
      status: "done",
      summary: "added 4 modules",
      changed: true,
    });
    expect(f.afterAdd).toEqual([
      "app/m1.py",
      "app/m2.py",
      "app/m3.py",
      "lib/a.py",
    ]);
  });

  it("shows one footer line with an Undo button", () => {
    expect(f.line).toContain("Claude added 4 modules");
    expect(f.undoButton).toBe("Undo");
    expect(f.role).toBe("status");
  });

  it("labels the Back button as the agent's change", () => {
    expect(f.backTitle).toBe("Back - undo Claude: added 4 modules");
    expect(f.backAria).toBe(f.backTitle);
  });

  it("Undo steps back one entry and clears the line", () => {
    expect(f.afterUndo).toEqual([]);
    expect(f.lineAfterUndo).toBeNull();
    expect(f.backAfterUndo).toBe("Back");
  });

  it("names the agent on the Forward button after going back", () => {
    expect(f.forwardTitle).toBe("Forward - redo Claude: added 4 modules");
  });

  it("Forward redoes the change and clears the line", () => {
    expect(f.afterForward).toHaveLength(4);
    expect(f.lineAfterForward).toBeNull();
  });

  it("a command that changes nothing answers nothing changed and shows no line", () => {
    expect(f.noop).toEqual({
      status: "done",
      summary: "nothing changed",
      changed: false,
    });
    expect(f.lineAfterNoop).toBeNull();
  });

  it("refuses an unknown module, view or folder and leaves the window unchanged", () => {
    expect(f.unknownModule).toEqual({
      status: "refused",
      reason: "no module app/zzz.py in the scan",
    });
    expect(f.unknownView).toEqual({
      status: "refused",
      reason: "no saved view named nope",
    });
    expect(f.unknownFolder.status).toBe("refused");
    expect(f.afterRefusals).toHaveLength(4);
  });

  it("clears the line on the user's own change and labels that entry plainly", () => {
    expect(f.lineBeforeUser).toContain("Claude added 1 module");
    expect(f.lineAfterUser).toBeNull();
    expect(f.backAfterUser).toBe("Back");
  });

  it("applies remove, fold, unfold, focus and select", () => {
    expect(f.removeDone.status).toBe("done");
    expect(f.afterRemove).not.toContain("lib/b.py");
    expect(f.foldDone).toMatchObject({ summary: "folded 1 folder" });
    expect(f.afterFold).toEqual(["lib"]);
    expect(f.unfoldDone).toMatchObject({ summary: "unfolded 1 folder" });
    expect(f.afterUnfold).toEqual([]);
    expect(f.focusDone).toMatchObject({ summary: "focused app" });
    expect(f.afterFocus).toBe("app");
    expect(f.selectDone).toMatchObject({ summary: "selected app/hub.py" });
    expect(f.afterSelect).toEqual({ kind: "module", id: "app/hub.py" });
  });

  it("follows a trail relation, and refuses a module that is not a neighbour", () => {
    expect(f.trailDone).toMatchObject({ status: "done" });
    expect(f.afterTrail).toEqual(["app/hub.py", "lib/a.py"]);
    expect(f.trailNotNeighbour).toEqual({
      status: "refused",
      reason: "app/m1.py is not a direct dependency of lib/a.py",
    });
  });

  it("clears selection and all, and refuses another word", () => {
    expect(f.clearBad.status).toBe("refused");
    expect(f.clearSelection).toMatchObject({ summary: "cleared selection" });
    expect(f.afterClearSelection).toBeNull();
    expect(f.clearAll).toMatchObject({ summary: "cleared the canvas" });
    expect(f.afterClearAll).toEqual([]);
  });

  it("opens a saved view", () => {
    expect(f.openViewDone).toMatchObject({
      status: "done",
      summary: "opened view overview",
    });
    expect(f.afterOpenView).toEqual({
      view: "overview",
      modules: ["app/hub.py"],
    });
  });

  it("leaves another window untouched", () => {
    expect(f.secondUntouched).toBe(true);
    expect(f.otherModules).toEqual([]);
  });
});
