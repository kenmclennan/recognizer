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
const loaded = { modules: ids, scans: [{ file: "scan.json", scan: nowScan }], policy: null, notices: [], blocking: null, findings: [], sensors: [] };

const HUB = "app/hub.py";
const A = "app/a.py";
const GONE = "lib/gone.py";
const make = (steps, notes) => JSON.stringify({ schema_version: notes ? 3 : 1, description: "d", commit: "cur1234", ...(notes ? { notes } : {}), steps }, null, 2) + "\\n";
const pick = (module) => ({ kind: "pick", module });
const PICKS = [pick(HUB), pick(A), pick("lib/c.py")];
const NOTES = [
  { module: HUB, text: "Hub one", by: "Ken" },
  { module: A, text: "A agent note", by: "Claude" },
  { module: HUB, text: "Hub two", by: "Claude" },
  { module: GONE, text: "Lost one", by: "Ken" },
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
  showExplorer(host, loaded, "demo", () => {}, port, () => {});
  const q = (selector) => host.querySelector(selector);
  const all = (selector) => [...host.querySelectorAll(selector)];
  const saved = (name) => JSON.parse(port.files.get(name));
  const shown = (selector) => { const node = q(selector); return node !== null && getComputedStyle(node).display !== "none"; };
  const openView = async (index = 0) => { click(q(".view-list")); click(all(".view-item")[index]); await tick(); };
  const clickBox = async (id) => { if (!q('.box[data-id="' + id + '"] .box-body')) throw new Error("no box " + id); click(q('.box[data-id="' + id + '"] .box-body')); await tick(); };
  const rect = (selector) => q(selector).getBoundingClientRect();
  const marks = () => all(".note-mark").map((n) => n.dataset.id).sort();
  const cards = () => all(".note-layer:not([hidden]) .note-card");
  const rows = () => all(".note-panel .note-row, .notes-panel .note-row");
  return { host, port, q, all, saved, shown, openView, clickBox, rect, marks, cards, rows };
}

(async () => {
  await tick();
  const facts = {};

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
  await none.clickBox("app/hub.py").catch(() => {});
  press("n");
  await tick();
  facts.noViewN = { cards: none.cards().length, barButtons: none.all(".bar-notes").length };

  const m = mount({ order: make(PICKS, NOTES) }, "Ken");
  await tick();
  await m.openView();
  facts.rail = {
    order: m.all(".rail button").map((b) => b.className.split(" ")[1]),
    count: m.q(".rail-count").textContent,
    countHidden: m.q(".rail-count").hidden,
  };
  facts.marks = {
    ids: m.marks(),
    folders: m.all(".box.folder .note-mark").length,
    inside: (() => { const mark = m.q('.box[data-id="' + HUB + '"] .note-mark').getBoundingClientRect(); const body = m.rect('.box[data-id="' + HUB + '"] .box-body'); return mark.left >= body.left && mark.right <= body.right && mark.top >= body.top && mark.bottom <= body.bottom; })(),
    cardsBefore: m.cards().length,
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
  click(m.q(".rail-notes"));
  await tick();

  const boxY = (id) => m.rect('.box[data-id="' + id + '"] .box-body').top;
  facts.order = {
    groups: m.all(".note-group").map((g) => g.dataset.module),
    byTop: [HUB, A].sort((a, b) => boxY(a) - boxY(b)),
    titles: m.all(".note-group-title strong").map((n) => n.textContent),
    hubRows: m.all('.note-group[data-module="' + HUB + '"] .note-row').map((r) => r.querySelector(".note-text").textContent),
    offHeading: m.q(".note-off .note-group-title").textContent,
    offRows: m.all(".note-off .note-row").map((r) => [r.querySelector(".note-text").textContent, r.classList.contains("off")]),
    offOpacity: getComputedStyle(m.q(".note-off .note-row")).color !== getComputedStyle(m.q(".note-group .note-row")).color,
    tints: m.rows().map((r) => [r.querySelector(".note-text").textContent, r.classList.contains("person") ? "person" : r.classList.contains("agent") ? "agent" : "none"]),
  };

  click(m.q(".note-off .note-row"));
  await tick();
  facts.offClick = { cards: m.cards().length };

  click(m.q('.note-group[data-module="' + HUB + '"] .note-row'));
  await tick();
  const surface = m.rect(".surface");
  const hubBody = m.rect('.box[data-id="' + HUB + '"] .box-body');
  const card = () => m.q(".note-card");
  const cardBox = () => ({ x: parseFloat(card().style.left), y: parseFloat(card().style.top), height: card().offsetHeight });
  const nums = (d) => d.match(/-?\\d+(\\.\\d+)?/g).map(Number);
  const leaderEnd = nums(m.q(".note-leader").getAttribute("d")).slice(-2);
  const hubAttr = (name) => Number(m.q('.box[data-id="' + HUB + '"] .box-body').getAttribute(name));
  const blocks = () => m.all(".note-card .note-block").map((b) => [b.querySelector(".note-text").textContent, b.classList.contains("person") ? "person" : "agent", b.classList.contains("active"), b.querySelectorAll(".note-remove").length]);
  facts.orient = {
    selected: m.q('.box[data-id="' + HUB + '"]').classList.contains("selected"),
    centreDx: Math.abs(hubBody.left + hubBody.width / 2 - (surface.left + surface.width / 2)),
    centreDy: Math.abs(hubBody.top + hubBody.height / 2 - (surface.top + surface.height / 2)),
    cards: m.cards().length,
    blocks: blocks(),
    activeRows: m.all(".note-row.active").length,
    activeMark: m.all(".note-mark.active").map((n) => n.dataset.id),
    leaderEndsOnCard: Math.abs(leaderEnd[0] - cardBox().x) < 0.01 && Math.abs(leaderEnd[1] - (cardBox().y + cardBox().height / 2)) < 0.01,
    leaderIsCurve: /C/.test(m.q(".note-leader").getAttribute("d")),
    gap: cardBox().x - (hubAttr("x") + hubAttr("width")),
    top: cardBox().y - hubAttr("y"),
    html: card().tagName === "DIV" && m.all(".note-card-text, .note-card-body").length === 0 && card().querySelector("textarea") !== null,
    composerLast: card().lastElementChild.tagName === "BUTTON" && card().lastElementChild.textContent === "Add note",
    removeTitle: m.q(".note-card .note-remove").title,
    frameGap: (() => { const c = card(); const last = c.lastElementChild.getBoundingClientRect().bottom; const k = c.getBoundingClientRect().height / c.offsetHeight; return Math.abs((c.getBoundingClientRect().bottom - last) / k - 9); })(),
    noScroll: card().scrollHeight <= card().offsetHeight,
  };

  const worldShift = () => m.q(".world").getAttribute("transform");
  const layerShift = () => m.q(".note-layer").style.transform;
  const offsetFromBox = () => card().getBoundingClientRect().left - m.q('.box[data-id="' + HUB + '"] .box-body').getBoundingClientRect().left;
  const offsetBefore0 = offsetFromBox();
  const boxLeft0 = m.q('.box[data-id="' + HUB + '"] .box-body').getBoundingClientRect().left;
  m.q(".stage").dispatchEvent(new WheelEvent("wheel", { deltaX: 31, deltaY: 17, bubbles: true, cancelable: true }));
  await tick();
  facts.pan = {
    boxMoved: m.q('.box[data-id="' + HUB + '"] .box-body').getBoundingClientRect().left !== boxLeft0,
    sameOffset: Math.abs(offsetFromBox() - offsetBefore0) < 0.5,
    world: worldShift(),
    layer: layerShift(),
  };

  click(m.q('.note-group[data-module="' + HUB + '"] .note-row:nth-of-type(2)'));
  await tick();
  facts.second = { cards: m.cards().length, blocks: blocks().map((b) => [b[0], b[2]]) };

  const offsetBefore = cardBox().y - hubAttr("y");
  click(m.q('.tree .row[data-path="lib"] .rcheck'));
  await tick();
  facts.follows = {
    offsetBefore,
    offsetAfter: cardBox().y - hubAttr("y"),
    xAfter: cardBox().x - hubAttr("x") - hubAttr("width"),
    cards: m.cards().length,
  };
  click(m.q('.tree .row[data-path="lib"] .rcheck'));
  await tick();
  click(m.q('.tree .row[data-path="lib"] .rcheck'));
  await tick();

  click(m.q('.note-group[data-module="' + HUB + '"] .note-row.active'));
  await tick();
  facts.rowToggle = { cards: m.cards().length, activeRows: m.all(".note-row.active").length, selected: m.q('.box[data-id="' + HUB + '"]').classList.contains("selected") };

  click(m.q('.note-group[data-module="' + HUB + '"] .note-row'));
  await tick();
  await m.clickBox(HUB);
  facts.keepOnSame = { cards: m.cards().length, active: blocks().filter((b) => b[2]).length };
  await m.clickBox(A);
  facts.dropOnOther = { cards: m.cards().length, activeRows: m.all(".note-row.active").length };

  const markOf = (id) => m.q('.box[data-id="' + id + '"] .note-mark');
  click(markOf(A));
  await tick();
  facts.mark = {
    cards: m.cards().length,
    texts: blocks().map((b) => b[0]),
    selected: m.q('.box[data-id="' + A + '"]').classList.contains("selected"),
    activeRows: m.all(".note-row.active .note-text").map((n) => n.textContent),
    markActive: m.all(".note-mark.active").map((n) => n.dataset.id),
    pointerEvents: getComputedStyle(markOf(A)).pointerEvents,
  };
  press("Escape");
  await tick();
  facts.escapeClose = { cards: m.cards().length, selected: m.all(".box.selected").length };

  click(markOf(HUB));
  await tick();
  facts.markHub = { texts: blocks().map((b) => b[0]), activeRows: m.all(".note-row.active .note-text").map((n) => n.textContent) };
  await m.clickBox(A);
  const field = () => m.q(".note-card textarea");
  const addButton = () => m.q(".note-card .note-card-add");
  press("n");
  await tick();
  facts.nKey = {
    cards: m.cards().length,
    focused: field() !== null && document.activeElement === field(),
    panelFields: m.all(".notes-panel textarea").length,
    panelComposer: m.all(".notes-panel .note-card-add").length,
    texts: blocks().map((b) => b[0]),
  };
  typeInto(field(), "");
  facts.addDisabledBlank = addButton().disabled;
  typeInto(field(), "  second thought ");
  facts.addEnabled = !addButton().disabled;
  press("Escape", {}, field());
  facts.escape = { value: field().value, focused: document.activeElement === field(), added: m.saved("order").notes.length, cards: m.cards().length };

  typeInto(field(), "  fresh note ");
  field().focus();
  const worldBeforeAdd = worldShift();
  press("Enter", { metaKey: true }, field());
  await tick();
  const written = m.saved("order");
  facts.added = {
    notes: written.notes.slice(-1),
    total: written.notes.length,
    version: written.schema_version,
    keys: Object.keys(written),
    value: field().value,
    blocks: blocks().map((b) => [b[0], b[2]]),
    cards: m.cards().length,
    count: m.q(".rail-count").textContent,
    activeIsNew: m.all(".note-row.active .note-text").map((n) => n.textContent),
    sameViewport: worldShift() === worldBeforeAdd,
    addDisabled: addButton().disabled,
  };
  typeInto(field(), "by button");
  click(addButton());
  await tick();
  facts.addedByButton = { last: m.saved("order").notes.slice(-1)[0].text, total: m.saved("order").notes.length, cards: m.cards().length };

  const cardsBeforeFolder = m.cards().length;
  const frame = m.q(".frame-label");
  click(frame);
  await tick();
  facts.folder = { opened: cardsBeforeFolder, cards: m.cards().length, button: m.all(".bar-notes").length, nKey: (() => { press("n"); return m.cards().length; })() };

  await m.clickBox("lib/c.py");
  facts.barZero = {
    titles: m.all(".selection-bar .bar-button").map((b) => b.title),
    figure: m.all(".bar-notes .bar-figure").length,
    lit: m.q(".bar-notes").classList.contains("on"),
  };
  click(m.q(".bar-notes"));
  await tick();
  facts.barOpen = { cards: m.cards().length, texts: blocks().map((b) => b[0]), focused: document.activeElement === field(), lit: m.q(".bar-notes").classList.contains("on") };

  await m.clickBox(HUB);
  facts.barCount = { title: m.q(".bar-notes").title, figure: m.q(".bar-notes .bar-figure").textContent, lit: m.q(".bar-notes").classList.contains("on"), cards: m.cards().length };
  click(m.q(".bar-notes"));
  await tick();
  facts.barHub = { texts: blocks().map((b) => b[0]), focused: document.activeElement === field() };
  field().blur();

  press("d");
  await tick();
  const tabButton = () => [...m.all(".itabs button")].find((b) => b.textContent.startsWith("Notes"));
  facts.tabLabels = m.all(".itabs button").map((b) => b.textContent);
  click(tabButton());
  await tick();
  facts.inspectorNotes = {
    on: m.all(".itabs button.on").map((b) => b.textContent),
    rows: m.all(".inspector-panel .note-row").map((r) => r.querySelector(".note-text").textContent),
    panelRows: m.all('.notes-panel .note-group[data-module="' + HUB + '"] .note-row').map((r) => r.querySelector(".note-text").textContent),
    addLabel: m.q(".inspector-panel .add-note").textContent,
  };
  m.q(".inspector-panel .add-note").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await tick();
  facts.inspectorAdd = { cards: m.cards().length, focused: document.activeElement === field() };
  field().blur();

  const hubFirst = m.q('.note-group[data-module="' + HUB + '"] .note-row');
  click(hubFirst);
  await tick();
  const before = m.saved("order").notes.length;
  press("Backspace");
  await tick();
  facts.backspaceNote = {
    after: m.saved("order").notes.length,
    before,
    removed: m.saved("order").notes.filter((n) => n.text === "Hub one").length,
    boxStillOn: m.all('.box[data-id="' + HUB + '"]').length,
    cards: m.cards().length,
  };

  await m.clickBox(HUB);
  press("Backspace");
  await tick();
  facts.backspaceBox = { boxes: m.all('.box[data-id="' + HUB + '"]').length, notes: m.saved("order").notes.length, cards: m.cards().length };

  const walker = mount({ order: make(PICKS, NOTES) }, "Ken");
  await tick();
  await walker.openView();
  click(walker.q(".rail-notes"));
  await tick();
  const activeText = () => walker.all(".note-row.active .note-text").map((n) => n.textContent);
  const domOrder = walker.all(".note-group .note-row").map((r) => r.querySelector(".note-text").textContent);
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
  facts.walk = { domOrder, j1, j2, k1, end, cards: walker.cards().length };

  const remover = mount({ order: make(PICKS, NOTES) }, "Ken");
  await tick();
  await remover.openView();
  click(remover.q(".rail-notes"));
  await tick();
  const countBefore = remover.saved("order").notes.length;
  click(remover.q('.note-group[data-module="' + A + '"] .note-remove'));
  await tick();
  facts.remove = {
    label: remover.q(".note-remove").getAttribute("aria-label"),
    before: countBefore,
    after: remover.saved("order").notes.map((n) => n.text),
    marks: remover.marks(),
    count: remover.q(".rail-count").textContent,
  };
  click(remover.q('.note-group[data-module="' + HUB + '"] .note-row'));
  await tick();
  const cardRemovals = [];
  for (let i = 0; i < 2; i++) {
    click(remover.q(".note-card .note-remove"));
    await tick();
    cardRemovals.push([remover.cards().length, remover.all(".note-card .note-block").length, remover.all(".note-card textarea").length, remover.saved("order").notes.length]);
  }
  facts.cardRemove = cardRemovals;
  click(remover.q(".note-off .note-remove"));
  await tick();
  facts.removeOff = { after: (remover.saved("order").notes || []).length, off: remover.all(".note-off").length };

  const live = mount({ plain: make(PICKS) }, "Ken");
  await tick();
  await live.openView();
  click(live.q(".rail-notes"));
  await tick();
  const transform = live.q(".world").getAttribute("transform");
  await live.clickBox(A);
  press("n");
  await tick();
  live.port.edit("plain", make(PICKS, [{ module: A, text: "Agent says", by: "agent" }]));
  await tick();
  facts.live = {
    rows: live.rows().map((r) => r.querySelector(".note-text").textContent),
    cardTexts: live.all(".note-card .note-block .note-text").map((n) => n.textContent),
    marks: live.marks(),
    count: live.q(".rail-count").textContent,
    sameViewport: live.q(".world").getAttribute("transform") === transform,
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

  it("prompts to open a view and offers no composer or count when none is open", () => {
    expect(f.noView).toEqual({
      panel: true,
      prompt: "Open or save a view to add notes",
      promptShown: true,
      field: 0,
      countHidden: true,
      viewNote: 0,
    });
    expect(f.noViewN).toEqual({ cards: 0, barButtons: 0 });
  });

  it("puts a Notes icon beside Files with the number of notes", () => {
    expect(f.rail).toEqual({
      order: ["rail-files", "rail-notes", "rail-sensors", "rail-findings"],
      count: "4",
      countHidden: false,
    });
  });

  it("marks the box of every noted module and no folder, and draws no card until one is chosen", () => {
    expect(f.marks.ids).toEqual(["app/a.py", "app/hub.py"]);
    expect(f.marks.folders).toBe(0);
    expect(f.marks.inside).toBe(true);
    expect(f.marks.cardsBefore).toBe(0);
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

  it("lists notes grouped by box in canvas order, with the unplaced ones greyed under Not on the canvas", () => {
    expect(f.order.groups).toEqual(f.order.byTop);
    expect(f.order.titles.sort()).toEqual(["a.py", "hub.py"]);
    expect(f.order.hubRows).toEqual(["Hub one", "Hub two"]);
    expect(f.order.offHeading).toBe("Not on the canvas");
    expect(f.order.offRows).toEqual([["Lost one", true]]);
    expect(f.order.offOpacity).toBe(true);
    expect(f.offClick.cards).toBe(0);
  });

  it("tints a person's notes and an agent's differently", () => {
    expect(Object.fromEntries(f.order.tints)).toEqual({
      "Hub one": "person",
      "A agent note": "agent",
      "Hub two": "agent",
      "Lost one": "person",
    });
  });

  it("selects a note's box, pans it to the centre and draws one HTML card with a leader to it", () => {
    expect(f.orient.selected).toBe(true);
    expect(f.orient.centreDx).toBeLessThan(6);
    expect(f.orient.centreDy).toBeLessThan(6);
    expect(f.orient.cards).toBe(1);
    expect(f.orient.activeRows).toBe(1);
    expect(f.orient.activeMark).toEqual(["app/hub.py"]);
    expect(f.orient.leaderEndsOnCard).toBe(true);
    expect(f.orient.leaderIsCurve).toBe(true);
    expect(f.orient.gap).toBe(36);
    expect(f.orient.top).toBe(0);
    expect(f.orient.html).toBe(true);
    expect(f.orient.removeTitle).toBe("Remove note");
  });

  it("sizes the card frame to its measured content, with no band below Add note", () => {
    expect(f.orient.frameGap).toBeLessThan(0.5);
    expect(f.orient.noScroll).toBe(true);
  });

  it("lists every note on the box in order, tinted, each removable, with the composer last", () => {
    expect(f.orient.blocks).toEqual([
      ["Hub one", "person", true, 1],
      ["Hub two", "agent", false, 1],
    ]);
    expect(f.orient.composerLast).toBe(true);
  });

  it("pans with its box", () => {
    expect(f.pan.boxMoved).toBe(true);
    expect(f.pan.sameOffset).toBe(true);

    const nums = (text: string) => text.match(/-?\d+(\.\d+)?/g);

    expect(nums(f.pan.layer)).toEqual(nums(f.pan.world));
  });

  it("outlines another note of the same box without opening a second card", () => {
    expect(f.second).toEqual({
      cards: 1,
      blocks: [
        ["Hub one", false],
        ["Hub two", true],
      ],
    });
  });

  it("keeps the card beside its box when the layout moves it", () => {
    expect(f.follows.offsetAfter).toBe(f.follows.offsetBefore);
    expect(f.follows.xAfter).toBe(36);
    expect(f.follows.cards).toBe(1);
  });

  it("clears the focus when the focused panel row is clicked again, keeping the selection", () => {
    expect(f.rowToggle).toEqual({ cards: 0, activeRows: 0, selected: true });
  });

  it("keeps the focus on a click of the noted box and drops it on another box", () => {
    expect(f.keepOnSame).toEqual({ cards: 1, active: 1 });
    expect(f.dropOnOther).toEqual({ cards: 0, activeRows: 0 });
  });

  it("opens the card from the corner mark, selecting the box and outlining its first note", () => {
    expect(f.mark).toEqual({
      cards: 1,
      texts: ["A agent note"],
      selected: true,
      activeRows: ["A agent note"],
      markActive: ["app/a.py"],
      pointerEvents: "auto",
    });
    expect(f.markHub.texts).toEqual(["Hub one", "Hub two"]);
    expect(f.markHub.activeRows).toEqual(["Hub one"]);
  });

  it("closes the card on Escape", () => {
    expect(f.escapeClose).toEqual({ cards: 0, selected: 0 });
  });

  it("opens the card on N with the composer focused and no composer in the panel", () => {
    expect(f.nKey).toEqual({
      cards: 1,
      focused: true,
      panelFields: 0,
      panelComposer: 0,
      texts: ["A agent note"],
    });
  });

  it("keeps Add off while blank and leaves the card open when Escape clears the field", () => {
    expect(f.addDisabledBlank).toBe(true);
    expect(f.addEnabled).toBe(true);
    expect(f.escape).toEqual({ value: "", focused: false, added: 4, cards: 1 });
  });

  it("adds on Cmd+Enter at version 3 as the app user, outlines the new note and does not move the viewport", () => {
    expect(f.added.notes).toEqual([
      { module: "app/a.py", text: "fresh note", by: "Ken" },
    ]);
    expect(f.added.total).toBe(5);
    expect(f.added.version).toBe(3);
    expect(f.added.keys).toEqual([
      "schema_version",
      "description",
      "commit",
      "notes",
      "steps",
    ]);
    expect(f.added.value).toBe("");
    expect(f.added.blocks).toEqual([
      ["A agent note", false],
      ["fresh note", true],
    ]);
    expect(f.added.cards).toBe(1);
    expect(f.added.count).toBe("5");
    expect(f.added.activeIsNew).toEqual(["fresh note"]);
    expect(f.added.sameViewport).toBe(true);
    expect(f.added.addDisabled).toBe(true);
    expect(f.addedByButton).toEqual({ last: "by button", total: 6, cards: 1 });
  });

  it("has no notes button on a folder's bar and N does nothing there", () => {
    expect(f.folder).toEqual({ opened: 1, cards: 0, button: 0, nKey: 0 });
  });

  it("puts the notes button after Dependencies, bare at zero notes, and opens the card with the composer focused", () => {
    expect(f.barZero.titles.slice(0, 2)).toEqual([
      "Dependencies (D)",
      "Notes (N)",
    ]);
    expect(f.barZero.figure).toBe(0);
    expect(f.barZero.lit).toBe(false);
    expect(f.barOpen).toEqual({
      cards: 1,
      texts: [],
      focused: true,
      lit: true,
    });
  });

  it("shows the count on the notes button and opens the card with every note", () => {
    expect(f.barCount).toEqual({
      title: "Notes (N)",
      figure: "2",
      lit: false,
      cards: 0,
    });
    expect(f.barHub).toEqual({ texts: ["Hub one", "Hub two"], focused: true });
  });

  it("lists the panel's rows on the inspector's Notes tab and its button opens the card with the composer focused", () => {
    expect(f.tabLabels).toContain("Notes 2");
    expect(f.inspectorNotes.on).toEqual(["Notes 2"]);
    expect(f.inspectorNotes.rows).toEqual(f.inspectorNotes.panelRows);
    expect(f.inspectorNotes.rows).toEqual(["Hub one", "Hub two"]);
    expect(f.inspectorNotes.addLabel).toBe("Add a note");
    expect(f.inspectorAdd).toEqual({ cards: 1, focused: true });
  });

  it("removes the active note on Backspace and keeps the card, but takes a freshly clicked box off the canvas", () => {
    expect(f.backspaceNote.after).toBe(f.backspaceNote.before - 1);
    expect(f.backspaceNote.removed).toBe(0);
    expect(f.backspaceNote.boxStillOn).toBe(1);
    expect(f.backspaceNote.cards).toBe(1);
    expect(f.backspaceBox.boxes).toBe(0);
    expect(f.backspaceBox.notes).toBe(f.backspaceNote.after);
    expect(f.backspaceBox.cards).toBe(0);
  });

  it("walks the list with J and K and clamps at the ends", () => {
    expect(f.walk.j1).toEqual([f.walk.domOrder[0]]);
    expect(f.walk.j2).toEqual([f.walk.domOrder[1]]);
    expect(f.walk.k1).toEqual([f.walk.domOrder[0]]);
    expect(f.walk.end).toEqual([f.walk.domOrder[f.walk.domOrder.length - 1]]);
    expect(f.walk.cards).toBe(1);
  });

  it("removes a note from its row, on the canvas or not", () => {
    expect(f.remove.label).toBe("Remove note");
    expect(f.remove.after).toEqual(["Hub one", "Hub two", "Lost one"]);
    expect(f.remove.marks).toEqual(["app/hub.py"]);
    expect(f.remove.count).toBe("3");
    expect(f.cardRemove).toEqual([
      [1, 1, 1, 2],
      [1, 0, 1, 1],
    ]);
    expect(f.removeOff).toEqual({ after: 0, off: 0 });
  });

  it("shows a note written by the CLI while the view is open without moving the viewport", () => {
    expect(f.live.rows).toEqual(["Agent says"]);
    expect(f.live.cardTexts).toEqual(["Agent says"]);
    expect(f.live.marks).toEqual(["app/a.py"]);
    expect(f.live.count).toBe("1");
    expect(f.live.sameViewport).toBe(true);
  });
});
