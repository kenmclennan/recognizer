import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, FAKE_WORKER, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { showExplorer } from ${JSON.stringify(here("explorer.ts"))};
import { fakeWindow } from ${JSON.stringify(here("window-fake.ts"))};
${FAKE_WORKER}

const edge = (from, to, name) => ({ from, to, kind: "depends", line: 1, names: [name] });
const scan = {
  modules: ["app/hub.py", "lib/a.py", "lib/b.py"].map((id) => ({ id, kind: "module" })),
  edges: [edge("app/hub.py", "lib/a.py", "A"), edge("app/hub.py", "lib/b.py", "B")],
  foreign: [],
};
const loaded = { modules: scan.modules.map((m) => m.id), scans: [{ file: "scan.json", scan }], policy: null, notices: [], blocking: null, findings: [], sensors: [] };

const tick = () => new Promise((resolve) => setTimeout(resolve, 40));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const key = (k) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

const facts = {};

(async () => {
  const wrap = document.createElement("div");
  wrap.style.cssText = "flex:none;height:800px;display:flex;flex-direction:column;width:1800px";
  document.getElementById("content").append(wrap);
  const win = fakeWindow();
  const store = { getItem: () => JSON.stringify({ tree: 280, inspector: 340 }), setItem() {} };
  showExplorer(wrap, loaded, "demo", () => {}, undefined, undefined, null, undefined, store, undefined, undefined, win);
  const q = (selector) => wrap.querySelector(selector);
  await tick();

  facts.opening = win.last();

  click(q('.tree .row[data-path="app"] .name'));
  click(q('.tree .row[data-path="lib"] .name'));
  click(q('.tree .row[data-path="app/hub.py"] .rcheck'));
  click(q('.tree .row[data-path="lib/a.py"] .rcheck'));
  await tick();
  click(q('.frame-label[data-kind="folder"][data-id="lib"]'));
  await tick();
  key("z");
  await tick();
  click(q('.box[data-id="app/hub.py"] .box-body'));
  await tick();
  click(q('.selection-bar [aria-label^="Dependencies"]'));
  await tick();
  click(q('.row[data-id="lib/a.py"][data-follow="uses"]').parentElement.querySelector(".follow"));
  await tick();

  facts.arrived = win.last();
  facts.arrivedKeys = Object.keys(facts.arrived).sort();

  const before = win.published.length;
  click(q('.selection-bar [aria-label^="Dependencies"]'));
  await tick();
  facts.unchanged = win.published.length - before;

  const beforeTab = win.published.length;
  click(q('.selection-bar [aria-label^="Contents"]'));
  await tick();
  facts.afterTab = { added: win.published.length - beforeTab, state: win.last() };

  facts.neverTwiceInARow = win.published.every((text, index) => index === 0 || text !== win.published[index - 1]);

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Panel = {
  selection: { kind: string; id: string } | null;
  relation: string | null;
  tab: string;
  active: boolean;
};

type State = {
  view: string | null;
  modules: string[];
  folded: string[];
  focus: string | null;
  selection: { kind: string; id: string } | null;
  trail: Panel[];
  inspector: { open: boolean; tab: string };
};

type Facts = {
  opening: State;
  arrived: State;
  arrivedKeys: string[];
  unchanged: number;
  afterTab: { added: number; state: State };
  neverTwiceInARow: boolean;
};

describe.skipIf(chrome === undefined)("the window's published state", () => {
  let f: Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "window");
  }, 120000);

  it("publishes once the window has rendered, with nothing on the canvas", () => {
    expect(f.opening.modules).toEqual([]);
    expect(f.opening.trail).toHaveLength(1);
    expect(f.opening.inspector.open).toBe(false);
  });

  it("holds the fields `recognizer window` documents, without id or folder", () => {
    expect(f.arrivedKeys).toEqual([
      "focus",
      "folded",
      "inspector",
      "modules",
      "selection",
      "trail",
      "view",
    ]);
  });

  it("holds the modules, fold, selection, a two-panel trail and the Dependencies tab", () => {
    expect(f.arrived.modules).toEqual(["app/hub.py", "lib/a.py"]);
    expect(f.arrived.folded).toEqual(["lib"]);
    expect(f.arrived.focus).toBeNull();
    expect(f.arrived.selection).toEqual({ kind: "module", id: "app/hub.py" });
    expect(f.arrived.trail).toHaveLength(2);
    expect(f.arrived.trail.map((panel) => panel.active)).toEqual([false, true]);
    expect(f.arrived.trail[1]?.relation).toBe("uses");
    expect(f.arrived.trail[1]?.selection).toEqual({
      kind: "module",
      id: "lib/a.py",
    });
    expect(f.arrived.inspector).toEqual({ open: true, tab: "dependencies" });
  });

  it("publishes nothing for a render that changes nothing", () => {
    expect(f.unchanged).toBe(0);
    expect(f.neverTwiceInARow).toBe(true);
  });

  it("publishes a tab change that made no history record", () => {
    expect(f.afterTab.added).toBeGreaterThan(0);
    expect(f.afterTab.state.inspector.tab).toBe("contents");
  });
});
