import { beforeAll, describe, expect, it } from "vitest";
import { collectFacts, here, webkit } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { buildCanvasView } from ${JSON.stringify(here("canvas-view.ts"))};

const rect = (x, y, width, height) => ({ x, y, width, height });
const box = (id, kind, x, y) => ({ id, kind, rect: rect(x, y, 160, 40), label: id, subline: "", disc: "green" });
const scene = {
  drawOrder: ["frames", "lines", "boxes"],
  bounds: rect(0, 0, 600, 400),
  frames: [],
  boxes: [box("left", "module", 20, 20), box("right", "module", 420, 20), box("bottom", "module", 220, 360), box("plain", "module", 220, 20), box("dir", "folder", 20, 200)],
  lines: [],
  arrows: [],
};
const LONG = "Reads the configuration and hands each section to the part that owns it, " + "wrapping onto several lines. ".repeat(12);
const TEXT = { left: "Parses the input.", right: "Writes the output.", bottom: LONG, dir: "A folder's own line." };
const moduleBar = { kind: "module", dependencies: 0, notes: null, findings: null, files: null, focused: false, folded: false, inspectorTab: null };
const keys = { notesOpen: false, noteActive: false, findingsOpen: false };
const noteOn = (id) => ({ marks: new Set([id]), active: id, bubbles: [{ path: id, text: "A note.", by: null, editing: false, focused: true }], keys });
const titles = new Map();
const describe = (id) => (id === "dir" ? null : TEXT[id] ?? null);
const props = (over) => ({
  scene, selection: null, highlight: null, bar: null, titles, open: 5, total: 5,
  showInferred: true, notice: null, describe, ...over,
});

const actions = {
  camera() {}, find() {}, select() {}, clear() {}, setShowInferred() {}, measure: (t) => t.length * 7,
  takeOff() {}, toggleFold() {}, toggleFocus() {}, openContents() {}, openInEditor() {}, openTab() {},
  toggleMetric() {}, addNote() {}, openNote() {}, editNote() {}, cancelNote() {}, saveNote() {}, removeNoteAt() {}, removeNote() {},
  walkNotes() {}, stepNote() {}, walkFindings() {}, pickName() {},
};
const wrap = document.createElement("div");
wrap.style.cssText = "position: relative; width: 900px; height: 600px; display: flex;";
document.body.append(wrap);

const clock = { now: 0, next: 0, tasks: new Map() };
const scheduler = {
  after(fn, ms) { clock.next += 1; clock.tasks.set(clock.next, { at: clock.now + ms, fn }); return clock.next; },
  cancel(handle) { clock.tasks.delete(handle); },
};
const advance = (ms) => {
  clock.now += ms;
  for (const [id, task] of [...clock.tasks]) if (task.at <= clock.now) { clock.tasks.delete(id); task.fn(); }
};

const canvas = buildCanvasView(actions, scheduler);
canvas.element.style.flex = "1";
wrap.append(canvas.element);

const q = (sel) => canvas.element.querySelector(sel);
const r = (node) => { const b = node.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
const nodeOf = (id) => q('[data-id="' + id + '"]');
const bodyOf = (id) => r(nodeOf(id).querySelector(".box-body"));
const panel = () => q(".box-description");
const showing = () => panel().classList.contains("shown");
const move = (id) => nodeOf(id).dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
const hoverShow = (id) => { move(id); advance(250); };
const snapshot = (id) => ({ count: nodeOf(id).children.length, text: nodeOf(id).textContent });
const facts = {};

canvas.render(props());

facts.before = snapshot("left");
move("left");
facts.beforeDelay = showing();
advance(249);
facts.justBefore = showing();
advance(1);
facts.shown = showing();
facts.text = panel().textContent;
facts.panel = r(panel());
facts.box = bodyOf("left");
facts.stage = r(q(".stage"));
facts.after = snapshot("left");
facts.pointerEvents = getComputedStyle(panel()).pointerEvents;
facts.opacity = getComputedStyle(panel()).opacity;

nodeOf("left").dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
q(".surface").dispatchEvent(new PointerEvent("pointerleave"));
facts.afterLeave = showing();

hoverShow("left");
nodeOf("left").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
facts.afterPointerDown = showing();

hoverShow("left");
q(".stage").dispatchEvent(new WheelEvent("wheel", { deltaX: 0, deltaY: 5, bubbles: true, cancelable: true }));
facts.afterWheel = showing();

const classChanges = [];
const classWatch = new MutationObserver((records) => { for (const m of records) classChanges.push(m.attributeName); });
const leftNode = nodeOf("left");
hoverShow("left");
classWatch.observe(panel(), { attributes: true, attributeFilter: ["class"] });
canvas.render(props());
facts.keptSame = { shown: showing(), sameNode: nodeOf("left") === leftNode, changes: classChanges.length };
canvas.render(props({ describe: (id) => (id === "right" ? "Changed." : describe(id)) }));
facts.keptOtherChanged = showing();
classWatch.disconnect();
canvas.render(props({ describe: (id) => (id === "left" ? "Changed." : describe(id)) }));
facts.afterOwnText = showing();
canvas.render(props());

hoverShow("left");
canvas.render(props({ selection: { kind: "module", id: "left" }, bar: moduleBar }));
facts.afterSelection = showing();
canvas.render(props());

hoverShow("left");
canvas.render(props({ scene: { ...scene } }));
facts.afterScene = showing();

hoverShow("plain");
facts.noDescription = showing();
hoverShow("dir");
facts.folder = showing();

canvas.render(props({ notes: noteOn("left") }));
hoverShow("left");
facts.rightNote = { shown: showing(), panel: r(panel()), bubble: r(q(".note-bubble")), side: q(".note-bubble").classList.contains("right") ? "right" : "left" };
canvas.render(props({ notes: noteOn("right") }));
hoverShow("right");
facts.leftNote = { shown: showing(), panel: r(panel()), bubble: r(q(".note-bubble")), side: q(".note-bubble").classList.contains("right") ? "right" : "left" };

canvas.render(props());
hoverShow("bottom");
facts.longPanel = r(panel());
panel().style.pointerEvents = "auto";
const probes = [[0.1, 0.1], [0.5, 0.1], [0.9, 0.1], [0.1, 0.5], [0.5, 0.5], [0.9, 0.5], [0.1, 0.9], [0.5, 0.9], [0.9, 0.9]].map(([fx, fy]) => { const p = r(panel()); const hit = document.elementFromPoint(p.left + p.width * fx, p.top + p.height * fy); return !!hit && hit.closest(".box-description") !== null; });
facts.topmost = probes;
const zOf = (node) => { const z = Number.parseInt(getComputedStyle(node).zIndex, 10); return Number.isNaN(z) ? 0 : z; };
facts.panelZ = zOf(panel());
facts.otherZ = [...q(".stage").children].filter((n) => n !== panel()).map(zOf);
for (const node of q(".stage").querySelectorAll("*")) if (node.closest(".box-description") === null) facts.otherZ.push(zOf(node));
panel().style.pointerEvents = "";
canvas.render(props());
hoverShow("bottom");
facts.bottom = { shown: showing(), panel: r(panel()), box: bodyOf("bottom") };

canvas.render(props({ selection: { kind: "module", id: "bottom" }, bar: moduleBar }));
hoverShow("bottom");
facts.selected = { shown: showing(), panel: r(panel()), box: bodyOf("bottom"), bar: r(q(".selection-bar")) };

const note = document.createElement("div");
note.className = "note-bubble";
note.style.cssText = "position:absolute;left:0;top:0;visibility:hidden";
document.body.append(note);
const noteStyle = getComputedStyle(note);
const panelStyle = getComputedStyle(panel());
facts.surface = ["background-color", "border-top-color", "border-top-left-radius", "border-top-width", "box-shadow"].map((name) => [panelStyle.getPropertyValue(name), noteStyle.getPropertyValue(name)]);

document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
`;

type Rect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};
type Note = { shown: boolean; panel: Rect; bubble: Rect; side: string };
type Facts = {
  before: { count: number; text: string };
  after: { count: number; text: string };
  beforeDelay: boolean;
  justBefore: boolean;
  shown: boolean;
  text: string;
  panel: Rect;
  box: Rect;
  stage: Rect;
  pointerEvents: string;
  afterLeave: boolean;
  afterPointerDown: boolean;
  afterWheel: boolean;
  keptSame: { shown: boolean; sameNode: boolean; changes: number };
  keptOtherChanged: boolean;
  afterOwnText: boolean;
  afterSelection: boolean;
  afterScene: boolean;
  noDescription: boolean;
  folder: boolean;
  rightNote: Note;
  leftNote: Note;
  longPanel: Rect;
  topmost: boolean[];
  panelZ: number;
  otherZ: number[];
  bottom: { shown: boolean; panel: Rect; box: Rect };
  selected: { shown: boolean; panel: Rect; box: Rect; bar: Rect };
  surface: [string, string][];
};

const disjoint = (a: Rect, b: Rect) =>
  a.right <= b.left ||
  b.right <= a.left ||
  a.bottom <= b.top ||
  b.bottom <= a.top;

describe.skipIf(!webkit)("box description look", () => {
  let facts: Facts;

  beforeAll(async () => {
    facts = await collectFacts<Facts>(HARNESS, "box-description-look", "bare");
  }, 90000);

  it("shows under the hovered box once the delay has fired", () => {
    expect(facts.beforeDelay).toBe(false);
    expect(facts.justBefore).toBe(false);
    expect(facts.shown).toBe(true);
    expect(facts.text).toBe("Parses the input.");
    expect(facts.panel.left + facts.panel.width / 2).toBeCloseTo(
      facts.box.left + facts.box.width / 2,
      1,
    );
    expect(facts.panel.top - facts.box.bottom).toBeCloseTo(8, 1);
    expect(facts.pointerEvents).toBe("none");
  });

  it("is 320 wide for a long description and nothing paints over it", () => {
    expect(facts.longPanel.width).toBeCloseTo(320, 1);
    expect(facts.topmost.every(Boolean)).toBe(true);
    expect(facts.panelZ).toBeGreaterThan(Math.max(...facts.otherZ));
  });

  it("shows nothing for a box without a description or a folder box", () => {
    expect(facts.noDescription).toBe(false);
    expect(facts.folder).toBe(false);
  });

  it("goes away on leave, pointerdown and wheel", () => {
    expect(facts.afterLeave).toBe(false);
    expect(facts.afterPointerDown).toBe(false);
    expect(facts.afterWheel).toBe(false);
  });

  it("stays shown across a render that changes nothing about its box", () => {
    expect(facts.keptSame.shown).toBe(true);
    expect(facts.keptSame.sameNode).toBe(true);
    expect(facts.keptSame.changes).toBe(0);
    expect(facts.keptOtherChanged).toBe(true);
  });

  it("goes away on a render that changes its text, the selection or the scene", () => {
    expect(facts.afterOwnText).toBe(false);
    expect(facts.afterSelection).toBe(false);
    expect(facts.afterScene).toBe(false);
  });

  it("stays disjoint from the note bubble on both sides", () => {
    expect(facts.rightNote.side).toBe("right");
    expect(facts.rightNote.shown).toBe(true);
    expect(disjoint(facts.rightNote.panel, facts.rightNote.bubble)).toBe(true);
    expect(facts.leftNote.side).toBe("left");
    expect(facts.leftNote.shown).toBe(true);
    expect(disjoint(facts.leftNote.panel, facts.leftNote.bubble)).toBe(true);
  });

  it("goes above a box near the bottom edge", () => {
    expect(facts.bottom.shown).toBe(true);
    expect(facts.bottom.panel.bottom).toBeLessThanOrEqual(facts.bottom.box.top);
    expect(facts.bottom.panel.top).toBeGreaterThanOrEqual(facts.stage.top);
  });

  it("goes above the selection bar for the selected box", () => {
    expect(facts.selected.shown).toBe(true);
    expect(facts.selected.panel.bottom).toBeLessThanOrEqual(
      facts.selected.bar.top,
    );
    expect(disjoint(facts.selected.panel, facts.selected.bar)).toBe(true);
  });

  it("adds nothing to the hovered box", () => {
    expect(facts.after).toEqual(facts.before);
  });

  it("matches the note bubble's surface", () => {
    for (const [panel, bubble] of facts.surface) {
      expect(panel).toBe(bubble);
    }
  });
});
