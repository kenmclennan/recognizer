import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, FAKE_WORKER, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { showExplorer } from ${JSON.stringify(here("explorer.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
import { fakeResponsibilities } from ${JSON.stringify(here("responsibilities-fake.ts"))};
${FAKE_WORKER}

const IDS = ["p/m.py", "p/o.py", "p/n.py", "p/q.py"];
const edge = { from: "p/m.py", to: "p/o.py", kind: "depends", line: 1, names: ["f"] };
const scan = { commit: "cur1234", modules: IDS.map((id) => ({ id, kind: "module" })), edges: [edge], foreign: [] };
const loaded = { modules: IDS, scans: [{ file: "scan.json", scan }], policy: null, notices: [], blocking: null, findings: [], sensors: [] };

const COMMAND = ["node", "d.js"];
const HASH = "a".repeat(64);
const entry = (line, hash = HASH) => ({ line, source_hash: hash, describer: COMMAND, version: "v1" });
const files = {
  responsibilities: JSON.stringify({ schema_version: 1, modules: { "p/m.py": entry("Reads the scans."), "p/o.py": entry("Old line.", "b".repeat(64)) } }),
  config: "describer:\\n  command: [node, d.js]\\n  version: v1\\n",
  refused: [],
  hashes: Object.fromEntries(IDS.map((id) => [id, HASH])),
};

const LONG = "x".repeat(90);
const NOTES = [
  { module: "p/m.py", text: "Split this module up", by: "Ken" },
  { module: "p/n.py", text: LONG, by: "Claude" },
];
const view = JSON.stringify({ schema_version: 3, description: "d", commit: "cur1234", notes: NOTES, steps: IDS.map((module) => ({ kind: "pick", module })) }, null, 2) + "\\n";

const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const host = document.getElementById("content");
const q = (selector) => host.querySelector(selector);
const qa = (selector) => [...host.querySelectorAll(selector)];
const body = (id) => q('.box[data-id="' + id + '"] .box-body');
const over = (node) => node.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 0, clientY: 0 }));
const out = () => q(".surface").dispatchEvent(new PointerEvent("pointerleave", { bubbles: false }));
const shown = () => { const tip = q(".box-tip"); return tip !== null && !tip.hidden; };
const tipLines = () => qa(".box-tip .tip-line").map((n) => [n.textContent, n.className.replace("tip-line ", "")]);
const bubbles = () => qa(".note-layer:not([hidden]) .note-bubble");

(async () => {
  await tick();
  const facts = {};
  host.style.cssText = "width:1400px;height:800px;display:flex;flex-direction:column";
  const port = fakeViews({ order: view });
  showExplorer(host, loaded, "demo", () => {}, port, () => {}, null, undefined, undefined, undefined, fakeResponsibilities(files));
  await tick();
  click(q(".view-list"));
  click(qa(".view-item")[0]);
  await tick();

  over(body("p/m.py"));
  facts.beforeDelay = shown();
  await tick(700);
  facts.unselected = { shown: shown(), lines: tipLines() };
  out();
  facts.afterOut = shown();

  click(body("p/m.py"));
  await tick();
  over(body("p/m.py"));
  await tick(700);
  const tip = q(".box-tip").getBoundingClientRect();
  const box = body("p/m.py").getBoundingClientRect();
  const bar = q(".selection-bar").getBoundingClientRect();
  facts.selected = {
    shown: shown(),
    lines: tipLines(),
    beneath: tip.top >= box.bottom,
    clearOfBar: tip.top >= bar.bottom || tip.bottom <= bar.top || tip.left >= bar.right || tip.right <= bar.left,
    dark: getComputedStyle(q(".box-tip")).backgroundColor !== "rgba(0, 0, 0, 0)",
  };
  out();

  over(body("p/o.py"));
  await tick(700);
  facts.stale = tipLines();
  out();
  over(body("p/q.py"));
  await tick(700);
  facts.missing = tipLines();
  out();
  over(body("p/n.py"));
  await tick(700);
  facts.longNote = tipLines().map((l) => l[0]);
  out();

  facts.toggle = { off: bubbles().length, pressed: q(".notes-toggle").getAttribute("aria-pressed"), after: qa(".controls .control").map((b) => b.textContent).slice(-3) };
  click(q(".notes-toggle"));
  await tick();
  const drawn = bubbles();
  facts.on = {
    pressed: q(".notes-toggle").getAttribute("aria-pressed"),
    count: drawn.length,
    paths: drawn.map((n) => n.dataset.path).sort(),
    idle: drawn.filter((n) => n.classList.contains("idle")).length,
    buttons: qa(".note-bubble .note-actions").length,
    marks: qa(".note-mark").length,
  };
  const idle = drawn.find((n) => n.dataset.path === "p/n.py");
  click(idle);
  await tick();
  facts.focusedByClick = {
    count: bubbles().length,
    focused: bubbles().filter((n) => !n.classList.contains("idle")).map((n) => n.dataset.path),
    selected: q('.box[data-id="p/n.py"]').classList.contains("selected"),
  };
  click(q(".notes-toggle"));
  await tick();
  facts.off = { count: bubbles().length, focused: bubbles().map((n) => n.dataset.path) };

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(chrome === undefined)("box tooltip and Notes toggle", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "notes-toggle");
  }, 180000);

  it("shows the tooltip only after a delay and hides it on pointer-out", () => {
    expect(f.beforeDelay).toBe(false);
    expect(f.unselected.shown).toBe(true);
    expect(f.afterOut).toBe(false);
  });

  it("shows the line and the note preview beneath a selected box without covering the bar", () => {
    expect(f.selected.shown).toBe(true);
    expect(f.selected.lines).toEqual([
      ["Reads the scans.", "normal"],
      ["Note: Split this module up", "muted"],
    ]);
    expect(f.selected.beneath).toBe(true);
    expect(f.selected.clearOfBar).toBe(true);
    expect(f.selected.dark).toBe(true);
  });

  it("dims an out-of-date line, mutes a missing one and cuts a long note at sixty characters", () => {
    expect(f.stale).toEqual([["Old line.", "dim"]]);
    expect(f.missing).toEqual([["No description yet", "muted"]]);
    expect(f.longNote).toEqual([
      "No description yet",
      `Note: ${"x".repeat(60)}…`,
    ]);
  });

  it("puts a Notes button after Legend that draws a read-only bubble for every note, leaving the marks as they were", () => {
    expect(f.toggle.off).toBe(0);
    expect(f.toggle.pressed).toBe("false");
    expect(f.toggle.after).toEqual(["Clear", "Legend", "Notes"]);
    expect(f.on).toEqual({
      pressed: "true",
      count: 2,
      paths: ["p/m.py", "p/n.py"],
      idle: 2,
      buttons: 0,
      marks: 2,
    });
  });

  it("focuses a bubble when it is clicked and draws only the focused one when the toggle goes off", () => {
    expect(f.focusedByClick).toEqual({
      count: 2,
      focused: ["p/n.py"],
      selected: true,
    });
    expect(f.off).toEqual({ count: 1, focused: ["p/n.py"] });
  });
});
