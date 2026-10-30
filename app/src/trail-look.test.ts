import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, FAKE_WORKER, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { showExplorer } from ${JSON.stringify(here("explorer.ts"))};
${FAKE_WORKER}

const edge = (from, to, name) => ({ from, to, kind: "depends", line: 1, names: [name] });
const scan = {
  modules: ["app/hub.py", "lib/a.py", "lib/b.py", "lib/c.py", "lib/d.py"].map((id) => ({ id, kind: "module" })),
  edges: [
    edge("app/hub.py", "lib/a.py", "A"),
    edge("app/hub.py", "lib/b.py", "B"),
    edge("lib/a.py", "lib/c.py", "C"),
    edge("lib/c.py", "lib/d.py", "D"),
    edge("lib/b.py", "lib/d.py", "D"),
  ],
  foreign: [],
};
const loaded = { modules: scan.modules.map((m) => m.id), scans: [{ file: "scan.json", scan }], policy: null, notices: [], blocking: null };

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const keyOn = (node, key) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  node.dispatchEvent(event);
  return event;
};

let current = null;
const q = (selector) => current.wrap.querySelector(selector);
const qa = (selector) => [...current.wrap.querySelectorAll(selector)];
const seenAtDocument = [];
document.addEventListener("keydown", (event) => seenAtDocument.push(event.key));

async function mount(width, widths) {
  if (current) {
    current.explorer.dispose();
    current.wrap.remove();
  }
  const wrap = document.createElement("div");
  wrap.style.cssText = "flex:none;height:800px;display:flex;flex-direction:column;width:" + width + "px";
  document.getElementById("content").append(wrap);
  const store = { getItem: () => JSON.stringify(widths), setItem() {} };
  const explorer = showExplorer(wrap, loaded, "demo", () => {}, undefined, undefined, null, undefined, store);
  current = { wrap, explorer };
  await tick();
  click(q('.tree .row[data-path="app"] .name'));
  click(q('.tree .row[data-path="lib"] .name'));
  click(q('.tree .row[data-path="app/hub.py"] .rcheck'));
  await tick();
  click(q('.box[data-id="app/hub.py"] .box-body'));
  await tick();
  click(q('.selection-bar [aria-label^="Dependencies"]'));
  await tick();
}

const inspector = () => q(".inspector");
const panels = () => qa(".inspector-panel");
const rowIn = (index, id, relation) => panels()[index].querySelector('.row[data-id="' + id + '"][data-follow="' + relation + '"]');
const activePanel = () => panels().find((p) => p.classList.contains("active"));
const followActive = async (id, relation = "uses") => {
  click(arrowOf(activePanel().querySelector('.row[data-id="' + id + '"][data-follow="' + relation + '"]')));
  await tick();
};
const arrowOf = (row) => row.parentElement.querySelector(".follow");
const follow = async (index, id, relation = "uses") => { click(arrowOf(rowIn(index, id, relation))); await tick(); };
const canvasCell = () => q(".explorer").children[2];
const snap = () => ({
  shown: panels().length,
  strips: qa(".inspector-strip").map((s) => s.title),
  widths: panels().map((p) => Math.round(p.getBoundingClientRect().width)),
  crumbs: qa(".inspector-crumbs .crumb").map((c) => c.textContent),
  active: panels().map((p) => p.classList.contains("active")),
  followed: panels().map((p) => [...p.querySelectorAll(".row.followed")].map((r) => r.dataset.id)),
  kbd: panels().map((p) => [...p.querySelectorAll(".row.kbd")].map((r) => r.dataset.id + ":" + r.dataset.follow)),
  heads: panels().map((p) => p.querySelector(".ih-name").textContent),
  route: q(".crumb-route") ? q(".crumb-route").disabled : null,
  routeTitle: q(".crumb-route") ? q(".crumb-route").title : null,
  canvas: Math.round(canvasCell().getBoundingClientRect().width),
  outlined: qa(".box.trail").map((n) => n.dataset.id),
  dimOutlined: qa(".box.trail.dim").length,
  onCanvas: qa(".box").map((n) => n.dataset.id),
  total: Math.round(q(".inspector").getBoundingClientRect().width),
});
const checked = (index, id, relation) => rowIn(index, id, relation).querySelector(".rcheck").getAttribute("aria-checked");

const facts = {};

(async () => {
  await mount(1800, { tree: 280, inspector: 340 });
  const reselect = async () => {
    click(q('.box[data-id="app/hub.py"] .box-body'));
    await tick();
    click(q('.selection-bar [aria-label^="Dependencies"]'));
    await tick();
  };

  const arrow = arrowOf(rowIn(0, "lib/a.py", "uses"));
  facts.arrow = {
    visibility: getComputedStyle(arrow).visibility,
    label: arrow.getAttribute("aria-label"),
    hoverRule: [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).some((rule) => rule.selectorText && /:hover/.test(rule.selectorText) && /\\.follow/.test(rule.selectorText) && rule.style.visibility === "visible"),
    inRow: q('.row[data-id="lib/a.py"]').querySelectorAll("button").length,
  };
  facts.single = snap();

  const input = inspector();
  facts.keys = {};
  keyOn(input, "ArrowDown"); await tick();
  facts.keys.down1 = snap().kbd;
  keyOn(input, "ArrowDown"); await tick();
  facts.keys.down2 = snap().kbd;
  keyOn(input, "ArrowDown"); await tick();
  facts.keys.downEnd = snap().kbd;
  keyOn(input, "ArrowUp"); await tick();
  facts.keys.up = snap().kbd;
  keyOn(input, "ArrowUp"); await tick();
  keyOn(input, "ArrowUp"); await tick();
  facts.keys.upEnd = snap().kbd;
  keyOn(input, "ArrowRight"); await tick();
  facts.keys.right = snap();
  keyOn(input, "ArrowLeft"); await tick();
  facts.keys.left = snap();
  facts.keys.leftOnFirst = { before: snap().active, handled: keyOn(input, "ArrowLeft").defaultPrevented };
  facts.keys.spaceBefore = checked(0, "lib/a.py", "uses");
  keyOn(input, "ArrowDown"); await tick();
  keyOn(input, "ArrowUp"); await tick();
  keyOn(input, " "); await tick();
  facts.keys.spaceOn = checked(0, "lib/a.py", "uses");
  keyOn(input, " "); await tick();
  facts.keys.spaceOff = checked(0, "lib/a.py", "uses");
  facts.keys.routeBeforeP = snap().route;
  keyOn(input, "p"); await tick();
  facts.keys.afterP = { onCanvas: snap().onCanvas, route: snap().route };
  seenAtDocument.length = 0;
  keyOn(input, "Escape"); await tick();
  facts.keys.escapeTwo = { shown: snap().shown, seenAtDocument: [...seenAtDocument] };
  seenAtDocument.length = 0;
  const lone = keyOn(input, "Escape"); await tick();
  facts.keys.escapeOne = { shown: snap().shown, prevented: lone.defaultPrevented, seenAtDocument: [...seenAtDocument] };

  await reselect();
  await follow(0, "lib/a.py");
  facts.followA = snap();
  await follow(1, "lib/c.py");
  facts.followC = snap();
  await follow(2, "lib/d.py");
  facts.four = snap();
  const stripEl = q(".inspector-strip");
  facts.stripLook = {
    writing: getComputedStyle(stripEl.querySelector(".strip-name")).writingMode,
    width: Math.round(stripEl.getBoundingClientRect().width),
  };

  click(qa(".inspector-strip")[0]);
  await tick();
  facts.broughtBack = snap();
  click(qa(".inspector-crumbs .crumb")[3]);
  await tick();
  facts.viaCrumb = snap();

  facts.routeEnabled = snap().route;
  click(q(".crumb-route"));
  await tick();
  facts.afterRoute = snap();
  facts.outline = {
    trail: getComputedStyle(q('.box[data-id="lib/c.py"] .box-body')).strokeDasharray,
    plain: getComputedStyle(q('.box[data-id="lib/b.py"] .box-body') || q('.box[data-id="lib/c.py"] .box-body')).strokeDasharray,
  };

  click(qa(".inspector-strip")[0]);
  await tick();
  await follow(0, "lib/b.py");
  facts.replaced = snap();

  const resizer = q(".panel-resizer-inspector");
  resizer.setPointerCapture = () => {};
  resizer.releasePointerCapture = () => {};
  const fire = (type, x) => resizer.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: x, bubbles: true }));
  fire("pointerdown", 1000);
  fire("pointermove", 960);
  fire("pointerup", 960);
  await tick();
  facts.dragged = snap();

  click(panels()[1].querySelector('.ib[aria-label="Close this panel"]'));
  await tick();
  facts.closed = snap();

  await follow(0, "lib/a.py");
  click(q('.box[data-id="lib/a.py"] .box-body'));
  await tick();
  facts.canvasClick = snap();

  await mount(1280, { tree: 280, inspector: 340 });
  await follow(0, "lib/a.py");
  await followActive("lib/c.py");
  await followActive("lib/d.py");
  facts.narrow = snap();
  click(qa(".inspector-strip")[0]);
  await tick();
  facts.narrowBack = snap();
  current.wrap.style.width = "1800px";
  click(qa(".inspector-strip")[0]);
  await tick();
  facts.widened = snap();

  await mount(1280, { tree: 280, inspector: 480 });
  await follow(0, "lib/a.py");
  facts.dragged480 = snap();

  await mount(1280, { tree: 280, inspector: 640 });
  await follow(0, "lib/a.py");
  facts.wide640 = snap();

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Snap = {
  shown: number;
  strips: string[];
  widths: number[];
  crumbs: string[];
  active: boolean[];
  followed: string[][];
  kbd: string[][];
  heads: string[];
  route: boolean | null;
  routeTitle: string | null;
  canvas: number;
  outlined: string[];
  dimOutlined: number;
  onCanvas: string[];
  total: number;
};

type Facts = {
  arrow: {
    visibility: string;
    label: string;
    hoverRule: boolean;
    inRow: number;
  };
  single: Snap;
  keys: {
    down1: string[][];
    down2: string[][];
    downEnd: string[][];
    up: string[][];
    upEnd: string[][];
    right: Snap;
    left: Snap;
    leftOnFirst: { before: boolean[]; handled: boolean };
    spaceBefore: string;
    spaceOn: string;
    spaceOff: string;
    routeBeforeP: boolean;
    afterP: { onCanvas: string[]; route: boolean };
    escapeTwo: { shown: number; seenAtDocument: string[] };
    escapeOne: { shown: number; prevented: boolean; seenAtDocument: string[] };
  };
  followA: Snap;
  followC: Snap;
  four: Snap;
  stripLook: { writing: string; width: number };
  broughtBack: Snap;
  viaCrumb: Snap;
  routeEnabled: boolean;
  afterRoute: Snap;
  outline: { trail: string; plain: string };
  replaced: Snap;
  dragged: Snap;
  closed: Snap;
  canvasClick: Snap;
  narrow: Snap;
  narrowBack: Snap;
  widened: Snap;
  dragged480: Snap;
  wide640: Snap;
};

describe.skipIf(chrome === undefined)("the trail", () => {
  let f: Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "trail");
  }, 120000);

  it("shows the follow arrow only on hover", () => {
    expect(f.arrow.visibility).toBe("hidden");
    expect(f.arrow.hoverRule).toBe(true);
    expect(f.arrow.label).toBe("Follow a into its own panel");
    expect(f.arrow.inRow).toBe(0);
  });

  it("opens a single panel with no breadcrumbs for a plain selection", () => {
    expect(f.single.shown).toBe(1);
    expect(f.single.crumbs).toEqual([]);
    expect(f.single.route).toBeNull();
    expect(f.single.widths).toEqual([340]);
    expect(f.single.outlined).toEqual([]);
  });

  it("follows a row into a panel on the right and highlights the followed row", () => {
    expect(f.followA.shown).toBe(2);
    expect(f.followA.heads).toEqual(["hub.py", "a.py"]);
    expect(f.followA.followed).toEqual([["lib/a.py"], []]);
    expect(f.followA.active).toEqual([false, true]);
  });

  it("names each module and each step's relationship in the breadcrumbs", () => {
    expect(f.followC.crumbs).toEqual(["hub.py", "uses a.py", "uses c.py"]);
    expect(f.followC.routeTitle).toBe("Put the trail on the canvas (P)");
  });

  it("shows at most three panels and folds the earlier ones into vertical strips", () => {
    expect(f.followC.shown).toBe(3);
    expect(f.followC.strips).toEqual([]);
    expect(f.four.shown).toBe(3);
    expect(f.four.strips).toEqual(["hub.py"]);
    expect(f.four.heads).toEqual(["a.py", "c.py", "d.py"]);
    expect(f.stripLook).toEqual({ writing: "vertical-rl", width: 28 });
  });

  it("brings a folded panel back from its strip, folding the later ones on the right", () => {
    expect(f.broughtBack.heads).toEqual(["hub.py", "a.py", "c.py"]);
    expect(f.broughtBack.strips).toEqual(["d.py"]);
    expect(f.broughtBack.active).toEqual([true, false, false]);
  });

  it("brings a panel back from its breadcrumb", () => {
    expect(f.viaCrumb.heads).toEqual(["a.py", "c.py", "d.py"]);
    expect(f.viaCrumb.active).toEqual([false, false, true]);
  });

  it("outlines the trail's modules on the canvas and never fades them", () => {
    expect(f.followA.outlined).toEqual(["app/hub.py", "lib/a.py"]);
    expect(f.afterRoute.outlined).toEqual([
      "app/hub.py",
      "lib/a.py",
      "lib/c.py",
      "lib/d.py",
    ]);
    expect(f.afterRoute.dimOutlined).toBe(0);
    expect(f.outline.trail).not.toBe("none");
  });

  it("puts the trail on the canvas and disables the route icon once it is all there", () => {
    expect(f.routeEnabled).toBe(false);
    expect(f.followA.onCanvas).toEqual(["app/hub.py", "lib/a.py"]);
    expect(f.afterRoute.onCanvas).toEqual([
      "app/hub.py",
      "lib/a.py",
      "lib/c.py",
      "lib/d.py",
    ]);
    expect(f.afterRoute.route).toBe(true);
  });

  it("replaces the rest of the trail when an earlier panel follows a different row", () => {
    expect(f.replaced.crumbs).toEqual(["hub.py", "uses b.py"]);
    expect(f.replaced.followed[0]).toEqual(["lib/b.py"]);
  });

  it("closes a panel and everything to its right", () => {
    expect(f.closed.shown).toBe(1);
    expect(f.closed.crumbs).toEqual([]);
  });

  it("starts a new trail when the canvas selects a box", () => {
    expect(f.canvasClick.shown).toBe(1);
    expect(f.canvasClick.heads).toEqual(["a.py"]);
    expect(f.canvasClick.crumbs).toEqual([]);
  });

  it("gives every panel one shared width that a drag changes for all of them", () => {
    expect(f.four.widths).toEqual([340, 340, 340]);
    expect(f.dragged.widths).toEqual([360, 360]);
    expect(f.dragged.total).toBe(720);
  });

  it("moves a highlighted row with Up and Down and stops at both ends", () => {
    expect(f.keys.down1).toEqual([["lib/a.py:uses"]]);
    expect(f.keys.down2).toEqual([["lib/b.py:uses"]]);
    expect(f.keys.downEnd).toEqual([["lib/b.py:uses"]]);
    expect(f.keys.up).toEqual([["lib/a.py:uses"]]);
    expect(f.keys.upEnd).toEqual([["lib/a.py:uses"]]);
  });

  it("follows the highlighted row with Right and goes back one panel with Left", () => {
    expect(f.keys.right.heads).toEqual(["hub.py", "a.py"]);
    expect(f.keys.right.active).toEqual([false, true]);
    expect(f.keys.left.active).toEqual([true, false]);
    expect(f.keys.left.kbd[0]).toEqual(["lib/a.py:uses"]);
    expect(f.keys.left.heads).toEqual(["hub.py", "a.py"]);
    expect(f.keys.leftOnFirst).toEqual({
      before: [true, false],
      handled: false,
    });
  });

  it("ticks the highlighted row on and off the canvas with Space", () => {
    expect(f.keys.spaceBefore).toBe("false");
    expect(f.keys.spaceOn).toBe("true");
    expect(f.keys.spaceOff).toBe("false");
  });

  it("puts the trail on the canvas with P", () => {
    expect(f.keys.routeBeforeP).toBe(false);
    expect(f.keys.afterP.onCanvas).toEqual(["app/hub.py", "lib/a.py"]);
    expect(f.keys.afterP.route).toBe(true);
  });

  it("closes the last panel with Escape and lets Escape through when only one is left", () => {
    expect(f.keys.escapeTwo.shown).toBe(1);
    expect(f.keys.escapeTwo.seenAtDocument).toEqual([]);
    expect(f.keys.escapeOne.prevented).toBe(true);
    expect(f.keys.escapeOne.seenAtDocument).toEqual(["Escape"]);
  });

  it("keeps the canvas at 400px by folding panels in a narrow explorer", () => {
    expect(f.narrow.shown).toBe(1);
    expect(f.narrow.strips).toEqual(["hub.py", "a.py", "c.py"]);
    expect(f.narrow.canvas).toBeGreaterThanOrEqual(400);
    expect(f.narrowBack.shown).toBe(1);
    expect(f.narrowBack.canvas).toBeGreaterThanOrEqual(400);
  });

  it("restores three panels with the canvas still at 400px when the explorer widens", () => {
    expect(f.widened.shown).toBe(3);
    expect(f.widened.strips).toEqual(["hub.py"]);
    expect(f.widened.canvas).toBeGreaterThanOrEqual(400);
  });

  it("folds a two-panel trail to one panel and a strip beside a 480px inspector", () => {
    expect(f.dragged480.shown).toBe(1);
    expect(f.dragged480.strips).toEqual(["hub.py"]);
    expect(f.dragged480.widths).toEqual([480]);
    expect(f.dragged480.canvas).toBeGreaterThanOrEqual(400);
  });

  it("never narrows or folds a single panel at a 640px inspector", () => {
    expect(f.wide640.shown).toBe(1);
    expect(f.wide640.strips).toEqual(["hub.py"]);
    expect(f.wide640.widths).toEqual([640]);
  });
});
