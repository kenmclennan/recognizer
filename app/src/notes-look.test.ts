import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((path): path is string => typeof path === "string" && path !== "");

const chrome = CHROME_CANDIDATES.find((path) => existsSync(path));

const here = (name: string) => fileURLToPath(new URL(name, import.meta.url));

const fakeWorker: Plugin = {
  name: "fake-layout-worker",
  setup(build) {
    build.onLoad({ filter: /layout-source\.ts$/ }, (args) => ({
      contents: readFileSync(args.path, "utf8").replace(
        'new Worker(new URL("./layout.worker.ts", import.meta.url))',
        "window.__fakeWorker()",
      ),
      loader: "ts",
    }));
  },
};

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { showExplorer } from ${JSON.stringify(here("explorer.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};

window.__fakeWorker = () => {
  const listeners = [];
  return {
    addEventListener: (type, listener) => listeners.push(listener),
    postMessage(request) {
      if (request.cmd !== "layout") return;
      let row = 0;
      const place = (node, depth) => {
        for (const child of node.children || []) {
          child.x = 10 + depth * 20 + (row % 3) * 200;
          child.y = 40 + row * 70;
          row += 1;
          place(child, depth + 1);
        }
      };
      const graph = JSON.parse(JSON.stringify(request.graph));
      place(graph, 0);
      for (const listener of listeners) listener({ data: { id: request.id, data: graph } });
    },
  };
};

const edge = (from, to) => ({ from, to, kind: "depends", line: 1, names: ["X"] });
const ids = ["app/hub.py", "app/a.py", "lib/c.py", "lib/d.py", "lib/e.py"];
const nowScan = {
  commit: "cur1234",
  modules: ids.map((id) => ({ id, kind: "module" })),
  edges: [edge("lib/c.py", "app/a.py"), edge("app/hub.py", "app/a.py"), edge("app/hub.py", "lib/c.py"), edge("app/hub.py", "lib/d.py"), edge("app/hub.py", "lib/e.py")],
  foreign: [],
};
const thenScan = {
  commit: "old1234",
  modules: [...ids, "lib/deleted.py"].map((id) => ({ id, kind: "module" })),
  edges: [edge("lib/c.py", "app/a.py"), edge("app/hub.py", "app/a.py"), edge("app/hub.py", "lib/e.py")],
  foreign: [],
};
const loaded = { modules: ids, scans: [{ file: "scan.json", scan: nowScan }], policy: null, notices: [], blocking: null, findings: [], sensors: [], folderMetrics: [] };

const HUB = "app/hub.py";
const A = "app/a.py";
const GONE = "lib/gone.py";
const make = (steps, notes) => JSON.stringify({ schema_version: notes ? 4 : 1, description: "d", commit: "cur1234", ...(notes ? { notes } : {}), steps }, null, 2) + "\\n";
const pick = (module) => ({ kind: "pick", module });
const PICKS = [pick(HUB), pick(A), pick("lib/c.py")];
const NOTES = [
  { module: HUB, text: "Hub note", by: "Ken" },
  { module: "app/", text: "Folder note", by: "Claude" },
  { module: GONE, text: "Lost note", by: "Ken" },
];
const tick = () => new Promise((resolve) => setTimeout(resolve, 40));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const typeInto = (input, value) => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); };
const press = (key, extra = {}, target = document.body) => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));

function mount(files, author) {
  const host = document.createElement("div");
  host.style.cssText = "width:1400px;height:800px;display:flex;flex-direction:column";
  document.body.append(host);
  const port = fakeViews(files);
  if (author) port.authorName = author;
  const lines = [];
  showExplorer(host, loaded, "demo", () => {}, port, () => {}, null, undefined, undefined, undefined, undefined, undefined, (line) => lines.push(line));
  const q = (selector) => host.querySelector(selector);
  const all = (selector) => [...host.querySelectorAll(selector)];
  const saved = (name) => JSON.parse(port.files.get(name));
  const shown = (selector) => { const node = q(selector); return node !== null && getComputedStyle(node).display !== "none"; };
  const openView = async (index = 0) => { click(q(".view-list")); click(all(".view-item")[index]); await tick(); press("Escape"); await tick(); };
  const clickBox = async (id) => { if (!q('.box[data-id="' + id + '"] .box-body')) throw new Error("no box " + id); click(q('.box[data-id="' + id + '"] .box-body')); await tick(); };
  const rect = (selector) => q(selector).getBoundingClientRect();
  const marks = () => all(".note-mark").map((n) => n.dataset.noteMark).sort();
  const bubbles = () => all(".note-layer:not([hidden]) .note-bubble");
  const bubbleText = () => (q(".note-bubble .note-text") || {}).textContent;
  const field = () => q(".note-bubble textarea");
  const button = (label) => all(".note-bubble button").find((b) => b.textContent === label);
  const noted = () => (saved("order").notes || []).map((n) => [n.module, n.text, n.by]);
  const world = () => q(".world").getAttribute("transform");
  return { host, port, lines, q, all, saved, shown, openView, clickBox, rect, marks, bubbles, bubbleText, field, button, noted, world };
}

(async () => {
  await tick();
  const facts = {};

  const bare = mount({ order: make(PICKS) }, "Ken");
  await tick();
  await bare.openView();
  const bareWidth = bare.rect('.box[data-id="' + HUB + '"] .box-body').width;

  const none = mount({});
  await tick();
  click(none.q(".rail-notes"));
  await tick();
  facts.noView = {
    panel: none.shown(".notes-panel"),
    prompt: none.q(".notes-hint").textContent,
    promptShown: none.shown(".notes-hint"),
    field: none.all(".notes-panel textarea").length,
    countHidden: none.q(".rail-count").hidden,
    viewNote: none.all(".view-note").length,
  };
  await none.clickBox(HUB).catch(() => {});
  press("n");
  await tick();
  facts.noViewN = { bubbles: none.bubbles().length, barButtons: none.all(".bar-notes").length };

  const m = mount({ order: make(PICKS, NOTES) }, "Ken");
  await tick();
  await m.openView();
  const hubMark = () => m.q('.box[data-id="' + HUB + '"] .note-mark');
  facts.rail = {
    order: m.all(".rail button").map((b) => b.className.split(" ")[1]),
    count: m.q(".rail-count").textContent,
    countHidden: m.q(".rail-count").hidden,
  };
  facts.old = { viewNote: m.all(".view-note").length, moduleNote: m.all(".module-note").length };
  facts.files = { treeHeader: m.shown(".tree-header"), notesPanel: m.shown(".notes-panel") };
  click(m.q(".rail-notes"));
  await tick();
  facts.swap = {
    treeHeader: m.shown(".tree-header"),
    notesPanel: m.shown(".notes-panel"),
    hidden: m.q(".explorer").classList.contains("tree-hidden"),
    notesPressed: m.q(".rail-notes").getAttribute("aria-pressed"),
    filesPressed: m.q(".rail-files").getAttribute("aria-pressed"),
  };
  click(m.q(".rail-files"));
  await tick();
  facts.swapBack = { treeHeader: m.shown(".tree-header"), notesPanel: m.shown(".notes-panel") };
  click(m.q(".rail-notes"));
  await tick();
  click(m.q(".rail-notes"));
  await tick();
  facts.hideActive = { hidden: m.q(".explorer").classList.contains("tree-hidden") };
  click(m.q(".rail-files"));
  await tick();

  facts.marks = {
    paths: m.marks(),
    onHub: m.all('.box[data-id="' + HUB + '"] .note-mark').length,
    onFrame: m.all('.frame[data-path="app"] .note-mark').length,
    tinted: m.all(".note-mark.person, .note-mark.agent").length,
    isSvgRect: m.all("rect.note-mark").length,
    sameWidth: m.rect('.box[data-id="' + HUB + '"] .box-body').width === bareWidth,
    drawn: m.all(".box").length >= 3 && m.all(".frame").length >= 1,
    noFigureText: m.all(".box text.figure").length === 0,
    bubbles: m.bubbles().length,
    atRightEnd: (() => { const box = m.q('.box[data-id="' + HUB + '"] .box-body').getBoundingClientRect(); const mark = hubMark().getBoundingClientRect(); return mark.right <= box.right && box.right - mark.right < 12 && mark.left > box.left; })(),
  };

  click(hubMark());
  await tick();
  facts.fromMark = {
    bubbles: m.bubbles().length,
    text: m.bubbleText(),
    by: m.q(".note-bubble .note-by").textContent,
    buttons: m.all(".note-bubble button").map((b) => b.textContent),
    selected: m.q('.box[data-id="' + HUB + '"]').classList.contains("selected"),
    barLit: m.q(".bar-notes").classList.contains("on"),
    barFigure: m.all(".bar-notes .bar-figure").length,
    besideBox: (() => { const el = m.q(".note-bubble"); const b = el.getBoundingClientRect(); const box = m.q('.box[data-id="' + HUB + '"] .box-body').getBoundingClientRect(); const onRight = el.classList.contains("right"); return (onRight ? b.left >= box.right : b.right <= box.left) && Math.abs(b.top - box.top) < 2; })(),
  };
  click(hubMark());
  await tick();
  facts.markToggles = { bubbles: m.bubbles().length };

  click(m.q(".bar-notes"));
  await tick();
  facts.fromBar = { bubbles: m.bubbles().length, text: m.bubbleText() };
  press("Escape");
  await tick();
  facts.escape = { bubbles: m.bubbles().length };

  await m.clickBox(HUB);
  press("n");
  await tick();
  facts.fromN = { bubbles: m.bubbles().length, text: m.bubbleText() };

  press("Escape");
  await tick();
  await m.clickBox(HUB);
  await tick();
  const frameMark = m.q('.frame[data-path="app"] .note-mark');
  const markBox = frameMark.getBoundingClientRect();
  const pointer = { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, clientX: markBox.left + markBox.width / 2, clientY: markBox.top + markBox.height / 2 };
  frameMark.dispatchEvent(new PointerEvent("pointerdown", pointer));
  frameMark.dispatchEvent(new PointerEvent("pointerup", pointer));
  const keptSelection = m.all(".box.selected").length;
  frameMark.dispatchEvent(new MouseEvent("click", pointer));
  await tick();
  facts.frameMarkPointer = { keptSelection, bubbles: m.bubbles().length, path: m.q(".note-bubble")?.dataset.path };
  press("Escape");
  await tick();

  click(m.q(".frame-label"));
  await tick();
  facts.folderSelected = { bubbles: m.bubbles().length, bar: m.all(".bar-notes").length };
  press("n");
  await tick();
  facts.folderN = { bubbles: m.bubbles().length, text: m.bubbleText(), path: m.q(".note-bubble").dataset.path };

  await m.clickBox(HUB);
  press("d");
  await tick();
  facts.noTab = m.all(".itabs button").filter((b) => b.textContent.startsWith("Notes")).length;
  press("Escape");
  await tick();

  await m.clickBox(A);
  press("n");
  await tick();
  press("Escape", {}, m.field());
  await tick();
  facts.cancelEmpty = { bubbles: m.bubbles().length, notes: m.noted().length };

  await m.clickBox(A);
  press("n");
  await tick();
  facts.emptyBox = {
    focused: m.field() !== null && document.activeElement === m.field(),
    barLit: m.q(".bar-notes").classList.contains("on"),
    saveDisabled: m.button("Save").disabled,
  };
  click(m.button("Cancel"));
  await tick();
  facts.emptyCancel = { bubbles: m.bubbles().length, notes: m.noted().length };

  click(hubMark());
  await tick();
  const worldBefore = m.world();
  click(m.q(".note-bubble .note-text"));
  await tick();
  facts.edit = { field: m.field() !== null, value: m.field().value, focused: document.activeElement === m.field() };
  typeInto(m.field(), "   ");
  facts.blank = { saveDisabled: m.button("Save").disabled };
  typeInto(m.field(), "  Edited ");
  press("Escape", {}, m.field());
  await tick();
  facts.editEscape = { text: m.bubbleText(), saved: m.noted()[0] };
  click(m.button("Edit"));
  await tick();
  typeInto(m.field(), "  Edited ");
  click(m.button("Save"));
  await tick();
  facts.save = {
    saved: m.noted().filter((n) => n[0] === HUB),
    text: m.bubbleText(),
    by: m.q(".note-bubble .note-by").textContent,
    sameViewport: m.world() === worldBefore,
    total: m.noted().length,
  };

  click(m.button("Remove"));
  await tick();
  facts.remove = {
    saved: m.noted().map((n) => n[0]),
    marks: m.marks(),
    bubbles: m.bubbles().length,
    line: m.lines.at(-1) === null ? null : m.lines.at(-1).text,
  };
  m.lines.at(-1).onUndo();
  await tick();
  facts.undo = { saved: m.noted().filter((n) => n[0] === HUB), marks: m.marks() };

  click(hubMark());
  await tick();
  click(m.button("Remove"));
  await tick();
  facts.removeAgain = { saved: m.noted().map((n) => n[0]) };
  press("z", { metaKey: true });
  await tick();
  facts.cmdZ = { saved: m.noted().filter((n) => n[0] === HUB), marks: m.marks() };
  click(m.q(".view-forward"));
  await tick();
  facts.backForward = { saved: m.noted().map((n) => n[0]), marks: m.marks() };
  click(m.q(".view-back"));
  await tick();

  const notified = [];
  const host = document.createElement("div");
  host.style.cssText = "width:1400px;height:800px;display:flex;flex-direction:column";
  document.body.append(host);
  const legacyPort = fakeViews({ legacy: make(PICKS, [{ module: HUB, text: "first", by: "Ken" }, { module: HUB, text: "second", by: "Claude" }]) });
  showExplorer(host, loaded, "demo", () => {}, legacyPort, (text) => notified.push(text));
  await tick();
  click(host.querySelector(".view-list"));
  click(host.querySelector(".view-item"));
  await tick();
  facts.legacy = {
    marks: host.querySelectorAll(".note-mark").length,
    text: (host.querySelector(".note-bubble .note-text") || {}).textContent,
    notified,
  };

  click(m.q(".rail-notes"));
  await tick();
  const panelRows = () => m.all(".notes-panel .note-row");
  facts.panel = {
    rows: panelRows().map((r) => [r.dataset.path, r.classList.contains("off")]),
    names: panelRows().map((r) => r.querySelector(".note-path").textContent),
    textareas: m.all(".notes-panel textarea").length,
    composer: m.all(".notes-panel .note-card-add, .notes-panel .note-composer").length,
    byTop: [HUB].map((id) => id),
  };
  click(panelRows()[0]);
  await tick();
  facts.panelRow = { bubbles: m.bubbles().length, active: m.all(".notes-panel .note-row.active").length };
  click(m.q(".notes-panel .note-row.off"));
  await tick();
  facts.offRow = { bubbles: m.bubbles().length };

  const rowOf = (path) => m.q('.notes-panel .note-row[data-path="' + path + '"]');
  click(rowOf(HUB));
  await tick();
  click(m.q(".notes-panel .note-row.active"));
  await tick();
  facts.rowToggle = { bubbles: m.bubbles().length, activeRows: m.all(".notes-panel .note-row.active").length, selected: m.q('.box[data-id="' + HUB + '"]').classList.contains("selected") };
  click(rowOf(HUB));
  await tick();
  await m.clickBox(HUB);
  facts.keepOnSame = { bubbles: m.bubbles().length, active: m.all(".notes-panel .note-row.active").length };
  await m.clickBox(A);
  facts.dropOnOther = { bubbles: m.bubbles().length, activeRows: m.all(".notes-panel .note-row.active").length };

  const walker = mount({ order: make(PICKS, NOTES) }, "Ken");
  await tick();
  await walker.openView();
  click(walker.q(".rail-notes"));
  await tick();
  const activeText = () => walker.all(".note-row.active .note-text").map((n) => n.textContent);
  const domOrder = walker.all(".notes-panel .note-row:not(.off)").map((r) => r.querySelector(".note-text").textContent);
  press("j");
  await tick();
  const j1 = activeText();
  press("j");
  await tick();
  const j2 = activeText();
  press("k");
  await tick();
  const k1 = activeText();
  for (let i = 0; i < 6; i++) { press("j"); await tick(); }
  const end = activeText();
  facts.walk = { domOrder, j1, j2, k1, end };

  const remover = mount({ order: make(PICKS, NOTES) }, "Ken");
  await tick();
  await remover.openView();
  click(remover.q(".rail-notes"));
  await tick();
  click(remover.q('.notes-panel .note-row[data-path="' + HUB + '"] .note-remove'));
  await tick();
  facts.rowRemove = {
    label: remover.q(".note-remove").getAttribute("aria-label"),
    after: remover.saved("order").notes.map((n) => n.text),
    marks: remover.marks(),
    count: remover.q(".rail-count").textContent,
  };
  click(remover.q(".note-row.off .note-remove"));
  await tick();
  facts.removeOff = { after: (remover.saved("order").notes || []).length, off: remover.all(".note-row.off").length };

  const live = mount({ plain: make(PICKS, [{ module: A, text: "Old", by: "Ken" }]) }, "Ken");
  await tick();
  await live.openView();
  click(live.q('.box[data-id="' + A + '"] .note-mark'));
  await tick();
  const liveWorld = live.world();
  live.port.edit("plain", make(PICKS, [{ module: A, text: "Agent says", by: "agent" }]));
  await tick();
  facts.live = {
    text: live.bubbleText(),
    by: live.q(".note-bubble .note-by").textContent,
    sameViewport: live.world() === liveWorld,
  };

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;
type Facts = ReturnType<typeof JSON.parse>;

async function collect(): Promise<Facts> {
  const dir = mkdtempSync(join(tmpdir(), "explorer-views-"));

  try {
    const bundle = (
      await build({
        stdin: { contents: HARNESS, resolveDir: here("."), loader: "ts" },
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        plugins: [fakeWorker],
      })
    ).outputFiles[0].text;
    const css = readFileSync(here("style.css"), "utf8");
    const page = join(dir, "page.html");
    const csp = `${JSON.parse(readFileSync(here("../src-tauri/tauri.conf.json"), "utf8")).app.security.csp}; script-src 'unsafe-inline'`;

    writeFileSync(
      page,
      `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${css}</style></head><body><div id="out"></div><span id="module-count"></span><div id="app" style="width:1400px;height:800px;display:flex;flex-direction:column"></div><script>${bundle.replaceAll("</script", "<\\/script")}</script></body></html>`,
    );

    const run = spawnSync(
      chrome as string,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--window-size=1500,900",
        "--virtual-time-budget=30000",
        `--user-data-dir=${join(dir, "profile")}`,
        "--dump-dom",
        `file://${page}`,
      ],
      { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
    );
    const match = /<div id="out">([^<]*)<\/div>/.exec(run.stdout);

    if (match === null || !/^[A-Za-z0-9+/=]+$/.test(match[1])) {
      throw new Error(
        `no harness output: ${run.stderr.slice(0, 500)} ${run.error}`,
      );
    }

    const text = Buffer.from(match[1], "base64").toString("utf8");

    if (text.startsWith("ERR ")) {
      throw new Error(text);
    }

    return JSON.parse(text);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}

describe.skipIf(chrome === undefined)("notes in the explorer", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collect();
  }, 180000);

  it("draws one untinted speech-bubble mark after a noted box's name and at a noted frame's corner, without growing the box", () => {
    expect(f.marks.paths).toEqual(["app/", "app/hub.py"]);
    expect(f.marks.onHub).toBe(1);
    expect(f.marks.onFrame).toBe(1);
    expect(f.marks.tinted).toBe(0);
    expect(f.marks.isSvgRect).toBe(0);
    expect(f.marks.sameWidth).toBe(true);
    expect(f.marks.drawn).toBe(true);
    expect(f.marks.noFigureText).toBe(true);
    expect(f.marks.bubbles).toBe(0);
    expect(f.marks.atRightEnd).toBe(true);
  });

  it("opens one bubble from the mark with the text, who wrote it, Edit and Remove, and closes it on a second click", () => {
    expect(f.fromMark).toEqual({
      bubbles: 1,
      text: "Hub note",
      by: "by Ken",
      buttons: ["Previous", "Next", "Edit", "Remove"],
      selected: true,
      barLit: true,
      barFigure: 0,
      besideBox: true,
    });
    expect(f.markToggles.bubbles).toBe(0);
  });

  it("opens the same bubble from the bar, N on a module, N on a folder selected by its frame, with no Notes tab in the inspector", () => {
    expect(f.fromBar).toEqual({ bubbles: 1, text: "Hub note" });
    expect(f.escape.bubbles).toBe(0);
    expect(f.fromN).toEqual({ bubbles: 1, text: "Hub note" });
    expect(f.folderSelected.bar).toBe(1);
    expect(f.folderN).toEqual({
      bubbles: 1,
      text: "Folder note",
      path: "app/",
    });
    expect(f.noTab).toBe(0);
  });

  it("opens the folder bubble from a real pointer press, release and click on a frame's corner mark", () => {
    expect(f.frameMarkPointer).toEqual({
      keptSelection: 1,
      bubbles: 1,
      path: "app/",
    });
  });

  it("opens a box with no note in edit mode and writes nothing on Cancel or Escape", () => {
    expect(f.cancelEmpty).toEqual({ bubbles: 0, notes: 3 });
    expect(f.emptyBox).toEqual({
      focused: true,
      barLit: false,
      saveDisabled: true,
    });
    expect(f.emptyCancel).toEqual({ bubbles: 0, notes: 3 });
  });

  it("edits in place, keeps Save disabled for blank, cancels on Escape and saves as the app user without moving the viewport", () => {
    expect(f.edit).toEqual({ field: true, value: "Hub note", focused: true });
    expect(f.blank.saveDisabled).toBe(true);
    expect(f.editEscape.text).toBe("Hub note");
    expect(f.editEscape.saved).toEqual(["app/hub.py", "Hub note", "Ken"]);
    expect(f.save).toEqual({
      saved: [["app/hub.py", "Edited", "Ken"]],
      text: "Edited",
      by: "by Ken",
      sameViewport: true,
      total: 3,
    });
  });

  it("removes through the history: the footer offers Undo, Undo and Cmd+Z restore it, Back then Forward removes it again", () => {
    expect(f.remove.saved).toEqual(["app/", "lib/gone.py"]);
    expect(f.remove.marks).toEqual(["app/"]);
    expect(f.remove.bubbles).toBe(0);
    expect(f.remove.line).toBe("Ken removed the note on app/hub.py");
    expect(f.undo.saved).toEqual([["app/hub.py", "Edited", "Ken"]]);
    expect(f.undo.marks).toEqual(["app/", "app/hub.py"]);
    expect(f.removeAgain.saved).toEqual(["app/", "lib/gone.py"]);
    expect(f.cmdZ.saved).toEqual([["app/hub.py", "Edited", "Ken"]]);
    expect(f.cmdZ.marks).toEqual(["app/", "app/hub.py"]);
    expect(f.backForward.saved).toEqual(["app/", "lib/gone.py"]);
    expect(f.backForward.marks).toEqual(["app/"]);
  });

  it("opens a view with two notes on one path showing the last one and notifying once", () => {
    expect(f.legacy.marks).toBe(1);
    expect(f.legacy.text).toBe("second");
    expect(f.legacy.notified).toEqual([
      "legacy: view holds 1 note on app/hub.py; kept the last on each",
    ]);
  });

  it("lists one row per noted box or folder in list order, greys the off-canvas one and has no composer", () => {
    expect(f.panel.rows.map((r: [string, boolean]) => r[0])).toEqual([
      "app/",
      "lib/gone.py",
      "app/hub.py",
    ]);
    expect(f.panel.rows.map((r: [string, boolean]) => r[1])).toEqual([
      false,
      true,
      false,
    ]);
    expect(f.panel.names).toEqual(["app/", "gone.py", "hub.py"]);
    expect(f.panel.textareas).toBe(0);
    expect(f.panel.composer).toBe(0);
    expect(f.panelRow).toEqual({ bubbles: 1, active: 1 });
    expect(f.offRow.bubbles).toBe(1);
  });

  it("prompts to open a view and offers no composer, count or bubble when none is open", () => {
    expect(f.noView).toEqual({
      panel: true,
      prompt: "Open or save a view to add notes",
      promptShown: true,
      field: 0,
      countHidden: true,
      viewNote: 0,
    });
    expect(f.noViewN).toEqual({ bubbles: 0, barButtons: 0 });
  });

  it("puts a Notes icon beside Files with the number of notes", () => {
    expect(f.rail).toEqual({
      order: [
        "rail-files",
        "rail-views",
        "rail-notes",
        "rail-scan",
        "rail-findings",
      ],
      count: "3",
      countHidden: false,
    });
  });

  it("shows none of REC-80's note surfaces", () => {
    expect(f.old).toEqual({ viewNote: 0, moduleNote: 0 });
  });

  it("swaps Files and Notes in one column and hides it from the active icon", () => {
    expect(f.files).toEqual({ treeHeader: true, notesPanel: false });
    expect(f.swap).toEqual({
      treeHeader: false,
      notesPanel: true,
      hidden: false,
      notesPressed: "true",
      filesPressed: "false",
    });
    expect(f.swapBack).toEqual({ treeHeader: true, notesPanel: false });
    expect(f.hideActive.hidden).toBe(true);
  });

  it("clears the focus when the focused panel row is clicked again, keeping the selection", () => {
    expect(f.rowToggle).toEqual({ bubbles: 0, activeRows: 0, selected: true });
  });

  it("keeps the focus on a click of the noted box and drops it on another box", () => {
    expect(f.keepOnSame).toEqual({ bubbles: 1, active: 1 });
    expect(f.dropOnOther).toEqual({ bubbles: 0, activeRows: 0 });
  });

  it("walks the list with J and K and clamps at the ends", () => {
    expect(f.walk.j1).toEqual([f.walk.domOrder[0]]);
    expect(f.walk.j2).toEqual([f.walk.domOrder[1]]);
    expect(f.walk.k1).toEqual([f.walk.domOrder[0]]);
    expect(f.walk.end).toEqual([f.walk.domOrder[f.walk.domOrder.length - 1]]);
  });

  it("removes a note from its row, on the canvas or not", () => {
    expect(f.rowRemove.label).toBe("Remove note");
    expect(f.rowRemove.after).toEqual(["Folder note", "Lost note"]);
    expect(f.rowRemove.marks).toEqual(["app/"]);
    expect(f.rowRemove.count).toBe("2");
    expect(f.removeOff).toEqual({ after: 1, off: 0 });
  });

  it("replaces the bubble text in place when the CLI sets the note on the open view", () => {
    expect(f.live).toEqual({
      text: "Agent says",
      by: "by agent",
      sameViewport: true,
    });
  });
});
