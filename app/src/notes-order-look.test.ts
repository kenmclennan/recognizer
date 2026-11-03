import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, FAKE_WORKER, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { showExplorer } from ${JSON.stringify(here("explorer.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
${FAKE_WORKER}
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};

const IDS = ["p/a.py", "p/b.py", "p/c.py", "p/d.py"];
const edge = { from: "p/a.py", to: "p/b.py", kind: "depends", line: 1, names: ["f"] };
const scan = { commit: "cur1234", modules: IDS.map((id) => ({ id, kind: "module" })), edges: [edge], foreign: [] };
const loaded = { modules: IDS, scans: [{ file: "scan.json", scan }], policy: null, notices: [], blocking: null, findings: [], sensors: [] };

const NOTES = [
  { module: "p/c.py", text: "First stop", by: "Ken" },
  { module: "p/a.py", text: "Second stop", by: "Ken" },
  { module: "p/b.py", text: "Third stop", by: "Ken" },
];
const make = (extra) => JSON.stringify({ schema_version: 4, description: "d", commit: "cur1234", ...extra, notes: NOTES, steps: IDS.map((module) => ({ kind: "pick", module })) }, null, 2) + "\\n";

const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const press = (key) => document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

async function mount(text) {
  const host = document.createElement("div");
  host.style.cssText = "width:1400px;height:800px;display:flex;flex-direction:column";
  document.body.append(host);
  const port = fakeViews({ order: text });
  const lines = [];
  showExplorer(host, loaded, "demo", () => {}, port, () => {}, null, undefined, undefined, undefined, undefined, undefined, (line) => lines.push(line));
  const q = (selector) => host.querySelector(selector);
  const all = (selector) => [...host.querySelectorAll(selector)];
  const m = { host, port, lines, q, all };
  m.saved = () => JSON.parse(port.files.get("order"));
  m.order = () => (m.saved().notes || []).map((n) => n.module);
  m.rows = () => all(".note-row").map((n) => n.dataset.path);
  m.numbers = () => all(".note-row .note-number").map((n) => n.textContent);
  m.bubble = () => q(".note-layer:not([hidden]) .note-bubble:not(.idle)");
  m.bubblePos = () => { const r = m.bubble().getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; };
  m.marks = () => all("[data-note-mark]").map((n) => [n.dataset.noteMark, n.textContent.trim(), n.classList.contains("numbered"), n.classList.contains("active")]);
  m.open = async () => { click(q(".view-list")); click(all(".view-item")[0]); await tick(); };
  m.notesPanel = async () => { click(q('[data-label="Notes"]') || all(".rail button").find((b) => b.getAttribute("data-label") === "Notes")); await tick(); };
  m.drag = async (from, toRow, below) => {
    const handle = all(".note-row")[from];
    const target = all(".note-row")[toRow].getBoundingClientRect();
    const start = handle.getBoundingClientRect();
    const y = below ? target.bottom - 2 : target.top + 2;
    const fire = (type, clientY) => handle.dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true, clientX: start.left + 30, clientY }));
    fire("pointerdown", start.top + start.height / 2);
    for (let i = 1; i <= 5; i += 1) { fire("pointermove", start.top + ((y - start.top) * i) / 5); await tick(10); }
    return { fire, y };
  };
  await tick();
  return m;
}

const facts = {};
(async () => {

  const m = await mount(make({}));
  await m.open();
  facts.landing = { text: m.bubble() && m.bubble().querySelector(".note-text").textContent, position: m.bubble() && m.bubble().querySelector(".note-position").textContent };
  await m.notesPanel();
  facts.panel = { rows: m.rows(), numbers: m.numbers(), draggable: m.all(".note-row.draggable").length, handles: m.all(".note-handle").length, toggle: m.q(".notes-order-toggle").textContent, pressed: m.q(".notes-order-toggle").getAttribute("aria-pressed") };
  facts.marks = m.marks();

  const drag = await m.drag(0, 2, true);
  drag.fire("pointerup", drag.y);
  await tick(80);
  facts.dragged = { rows: m.rows(), file: m.order(), numbers: m.numbers() };
  m.lines.at(-1).onUndo();
  await tick(80);
  facts.undone = { rows: m.rows(), file: m.order() };

  const cancel = await m.drag(0, 2, true);
  press("Escape");
  cancel.fire("pointerup", cancel.y);
  await tick(80);
  facts.escaped = { rows: m.rows(), file: m.order() };

  const same = await m.drag(1, 1, false);
  same.fire("pointerup", same.y);
  await tick(80);
  facts.sameSpot = m.order();

  click(m.q(".notes-order-toggle"));
  await tick(80);
  facts.lens = { ordered: m.saved().ordered, version: m.saved().schema_version, numbers: m.numbers(), draggable: m.all(".note-row.draggable").length, toggle: m.q(".notes-order-toggle").textContent, marks: m.marks(), buttons: m.all(".note-bubble .note-step").length };
  click(m.q(".notes-order-toggle"));
  await tick(80);
  facts.restored = { ordered: m.saved().ordered === undefined, numbers: m.numbers() };

  const w = await mount(make({}));
  await w.open();
  facts.step = { first: w.bubble().querySelector(".note-position").textContent, prevDisabled: w.bubble().querySelector(".note-previous").disabled };
  const before = w.bubblePos();
  click(w.bubble().querySelector(".note-next"));
  let after = null;
  for (let i = 0; i < 20; i += 1) { await tick(50); after = w.bubblePos(); }
  facts.step.second = w.bubble().querySelector(".note-position").textContent;
  facts.step.text = w.bubble().querySelector(".note-text").textContent;
  facts.step.stayed = [before, after];
  press("ArrowRight");
  for (let i = 0; i < 20; i += 1) await tick(50);
  facts.step.third = w.bubble().querySelector(".note-position").textContent;
  facts.step.nextDisabled = w.bubble().querySelector(".note-next").disabled;
  press("ArrowLeft");
  for (let i = 0; i < 20; i += 1) await tick(50);
  facts.step.back = w.bubble().querySelector(".note-position").textContent;
  facts.step.marks = w.marks();

  const l = await mount(make({ ordered: false }));
  await l.open();
  facts.unordered = { bubble: l.bubble() === null, marks: l.marks(), numbered: l.all(".note-mark.numbered").length };

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack + " FACTS " + JSON.stringify(facts)); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(chrome === undefined)("notes in order", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "notes-order");
  }, 240000);

  it("lands on note 1 with its bubble open when an ordered view opens", () => {
    expect(f.landing).toEqual({ text: "First stop", position: "1 of 3" });
  });

  it("numbers the panel rows in list order, each draggable as a whole with no handle strip, under an In order toggle", () => {
    expect(f.panel.rows).toEqual(["p/c.py", "p/a.py", "p/b.py"]);
    expect(f.panel.numbers).toEqual(["1", "2", "3"]);
    expect(f.panel.draggable).toBe(3);
    expect(f.panel.handles).toBe(0);
    expect(f.panel.toggle).toBe("In order");
    expect(f.panel.pressed).toBe("true");
  });

  it("draws filled numbered circles, the open one highlighted", () => {
    expect(f.marks).toEqual([
      ["p/a.py", "2", true, false],
      ["p/b.py", "3", true, false],
      ["p/c.py", "1", true, true],
    ]);
  });

  it("reorders by a real pointer drag and writes the file", () => {
    expect(f.dragged.rows).toEqual(["p/a.py", "p/b.py", "p/c.py"]);
    expect(f.dragged.file).toEqual(["p/a.py", "p/b.py", "p/c.py"]);
    expect(f.dragged.numbers).toEqual(["1", "2", "3"]);
  });

  it("cancels on Escape and does nothing when dropped on its own place", () => {
    expect(f.escaped.file).toEqual(f.undone.file);
    expect(f.sameSpot).toEqual(f.undone.file);
  });

  it("(non-gating) restores the order from the footer Undo", () => {
    expect(f.undone.file).toEqual(["p/c.py", "p/a.py", "p/b.py"]);
    expect(f.undone.rows).toEqual(["p/c.py", "p/a.py", "p/b.py"]);
  });

  it("flips to No order: no numbers or draggable rows, bubble marks, no Previous or Next, file says ordered false", () => {
    expect(f.lens.ordered).toBe(false);
    expect(f.lens.version).toBe(4);
    expect(f.lens.numbers).toEqual([]);
    expect(f.lens.draggable).toBe(0);
    expect(f.lens.toggle).toBe("No order");
    expect(f.lens.marks.every((mark: unknown[]) => mark[2] === false)).toBe(
      true,
    );
    expect(f.lens.buttons).toBe(0);
    expect(f.restored).toEqual({ ordered: true, numbers: ["1", "2", "3"] });
  });

  it("steps with Next and the arrows, keeps the bubble where it was and disables the ends", () => {
    expect(f.step.first).toBe("1 of 3");
    expect(f.step.prevDisabled).toBe(true);
    expect(f.step.second).toBe("2 of 3");
    expect(f.step.text).toBe("Second stop");
    expect(f.step.stayed[1]).toEqual(f.step.stayed[0]);
    expect(f.step.third).toBe("3 of 3");
    expect(f.step.nextDisabled).toBe(true);
    expect(f.step.back).toBe("2 of 3");
  });

  it("keeps the speech-bubble mark and a plain bubble on an unordered view", () => {
    expect(f.unordered.bubble).toBe(true);
    expect(f.unordered.numbered).toBe(0);
  });
});
