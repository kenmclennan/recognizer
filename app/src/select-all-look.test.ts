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
const describe = (id) => (id === "dir" ? null : TEXT[id] ?? null);
const props = (over) => ({
  scene, selection: null, highlight: null, bar: null, titles: new Map(), open: 5, total: 5,
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
hoverShow("left");

const input = document.createElement("input");
input.value = "typed value";
document.body.append(input);

const selectedText = () => String(window.getSelection());
const userSelect = (node) => getComputedStyle(node).webkitUserSelect;
const zoomButtons = [q('[aria-label="Zoom out"]'), q('[aria-label="Zoom in"]')];

document.activeElement && document.activeElement.blur();
document.execCommand("selectAll");
facts.outside = {
  text: selectedText(),
  panelShown: showing(),
  panelText: panel().textContent,
  label: userSelect(nodeOf("left")),
  panel: userSelect(panel()),
  zoom: zoomButtons.map(userSelect),
  zoomCount: zoomButtons.length,
};

window.getSelection().removeAllRanges();
input.focus();
document.execCommand("selectAll");
facts.inside = { selected: input.value.slice(input.selectionStart, input.selectionEnd), style: userSelect(input) };

document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
`;

type Facts = {
  outside: {
    text: string;
    panelShown: boolean;
    panelText: string;
    label: string;
    panel: string;
    zoom: string[];
    zoomCount: number;
  };
  inside: { selected: string; style: string };
};

describe.skipIf(!webkit)("select all look", () => {
  let facts: Facts;

  beforeAll(async () => {
    facts = await collectFacts<Facts>(HARNESS, "select-all-look", "bare");
  }, 90000);

  it("selects no canvas, description or zoom text outside a text field", () => {
    expect(facts.outside.panelShown).toBe(true);
    expect(facts.outside.panelText).toBe("Parses the input.");
    expect(facts.outside.zoomCount).toBe(2);
    expect(facts.outside.text).toBe("");
    expect(facts.outside.label).toBe("none");
    expect(facts.outside.panel).toBe("none");
    expect(facts.outside.zoom).toEqual(["none", "none"]);
  });

  it("still selects the value of a text input", () => {
    expect(facts.inside.style).toBe("text");
    expect(facts.inside.selected).toBe("typed value");
  });
});
