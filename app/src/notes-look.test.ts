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
  const clickBox = async (id) => { click(q('.box[data-id="' + id + '"] .box-body')); await tick(); };
  const rect = (selector) => q(selector).getBoundingClientRect();
  const marks = () => all(".note-mark").map((n) => n.dataset.id).sort();
  const cards = () => all(".note-card");
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
    prompt: none.q(".note-prompt").textContent,
    field: none.shown(".notes-panel .note-field"),
    add: none.shown(".notes-panel .note-add"),
    countHidden: none.q(".rail-count").hidden,
    viewNote: none.all(".view-note").length,
  };

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

  const world = () => m.q(".world").getAttribute("transform");
  click(m.q('.note-group[data-module="' + HUB + '"] .note-row'));
  await tick();
  const surface = m.rect(".surface");
  const hubBody = m.rect('.box[data-id="' + HUB + '"] .box-body');
  const cardBody = () => m.q(".note-card .note-card-body");
  const nums = (d) => d.match(/-?\\d+(\\.\\d+)?/g).map(Number);
  const leaderEnd = nums(m.q(".note-card .note-leader").getAttribute("d")).slice(-2);
  facts.orient = {
    selected: m.q('.box[data-id="' + HUB + '"]').classList.contains("selected"),
    centreDx: Math.abs(hubBody.left + hubBody.width / 2 - (surface.left + surface.width / 2)),
    centreDy: Math.abs(hubBody.top + hubBody.height / 2 - (surface.top + surface.height / 2)),
    cards: m.cards().length,
    cardText: m.q(".note-card .note-card-text").textContent,
    activeRows: m.all(".note-row.active").length,
    activeMark: m.all(".note-mark.active").map((n) => n.dataset.id),
    leaderEndsOnCard: Math.abs(leaderEnd[0] - Number(cardBody().getAttribute("x"))) < 0.01 && Math.abs(leaderEnd[1] - (Number(cardBody().getAttribute("y")) + Number(cardBody().getAttribute("height")) / 2)) < 0.01,
    leaderIsCurve: /C/.test(m.q(".note-card .note-leader").getAttribute("d")),
    tint: m.q(".note-card").classList.contains("person") ? "person" : "agent",
    gap: Number(cardBody().getAttribute("x")) - (Number(m.q('.box[data-id="' + HUB + '"] .box-body').getAttribute("x")) + Number(m.q('.box[data-id="' + HUB + '"] .box-body').getAttribute("width"))),
    top: Number(cardBody().getAttribute("y")) - Number(m.q('.box[data-id="' + HUB + '"] .box-body').getAttribute("y")),
  };

  click(m.q('.note-group[data-module="' + HUB + '"] .note-row:nth-of-type(2)'));
  await tick();
  facts.second = { cards: m.cards().length, text: m.q(".note-card .note-card-text").textContent, tint: m.q(".note-card").classList.contains("agent") ? "agent" : "person" };

  const offsetBefore = Number(cardBody().getAttribute("y")) - Number(m.q('.box[data-id="' + HUB + '"] .box-body').getAttribute("y"));
  click(m.q('.tree .row[data-path="lib"] .rcheck'));
  await tick();
  const hubNow = m.q('.box[data-id="' + HUB + '"] .box-body');
  facts.follows = {
    offsetBefore,
    offsetAfter: Number(cardBody().getAttribute("y")) - Number(hubNow.getAttribute("y")),
    xAfter: Number(cardBody().getAttribute("x")) - Number(hubNow.getAttribute("x")) - Number(hubNow.getAttribute("width")),
    cards: m.cards().length,
  };
  click(m.q('.tree .row[data-path="lib"] .rcheck'));
  await tick();

  await m.clickBox(A);
  facts.retarget = {
    target: m.q(".note-target").textContent,
    focused: document.activeElement === m.q(".notes-panel .note-field"),
    cardsAfterClick: m.cards().length,
  };
  typeInto(m.q(".notes-panel .note-field"), "");
  facts.addDisabledBlank = m.q(".notes-panel .note-add").disabled;
  typeInto(m.q(".notes-panel .note-field"), "  second thought ");
  facts.addEnabled = !m.q(".notes-panel .note-add").disabled;
  m.q(".notes-panel .note-field").focus();
  press("Escape", {}, m.q(".notes-panel .note-field"));
  facts.escape = { value: m.q(".notes-panel .note-field").value, focused: document.activeElement === m.q(".notes-panel .note-field"), added: m.saved("order").notes.length };

  typeInto(m.q(".notes-panel .note-field"), "  fresh note ");
  m.q(".notes-panel .note-field").focus();
  press("Enter", { metaKey: true }, m.q(".notes-panel .note-field"));
  await tick();
  const written = m.saved("order");
  facts.added = {
    notes: written.notes.slice(-1),
    total: written.notes.length,
    version: written.schema_version,
    keys: Object.keys(written),
    value: m.q(".notes-panel .note-field").value,
    cardText: m.q(".note-card .note-card-text") && m.q(".note-card .note-card-text").textContent,
    cards: m.cards().length,
    count: m.q(".rail-count").textContent,
    activeIsNew: m.all(".note-row.active .note-text").map((n) => n.textContent),
    off: (() => {
      const box = m.q('.box[data-id="' + A + '"]').getBoundingClientRect();
      const stage = m.q(".stage").getBoundingClientRect();
      return Math.hypot(box.left + box.width / 2 - (stage.left + stage.width / 2), box.top + box.height / 2 - (stage.top + stage.height / 2));
    })(),
  };

  const frame = m.q(".frame-label");
  click(frame);
  await tick();
  facts.folder = { prompt: m.shown(".note-prompt"), promptText: m.q(".note-prompt").textContent, field: m.shown(".notes-panel .note-field") };

  await m.clickBox(HUB);
  document.activeElement && document.activeElement.blur && document.activeElement.blur();
  press("n");
  await tick();
  facts.nKey = { focused: document.activeElement === m.q(".notes-panel .note-field"), target: m.q(".note-target").textContent };
  m.q(".notes-panel .note-field").blur();

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
  facts.backspaceBox = { boxes: m.all('.box[data-id="' + HUB + '"]').length, notes: m.saved("order").notes.length };

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
  click(remover.q(".note-off .note-remove"));
  await tick();
  facts.removeOff = { after: remover.saved("order").notes.length, off: remover.all(".note-off").length };

  const live = mount({ plain: make(PICKS) }, "Ken");
  await tick();
  await live.openView();
  click(live.q(".rail-notes"));
  await tick();
  const transform = live.q(".world").getAttribute("transform");
  live.port.edit("plain", make(PICKS, [{ module: A, text: "Agent says", by: "agent" }]));
  await tick();
  facts.live = {
    rows: live.rows().map((r) => r.querySelector(".note-text").textContent),
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
      field: false,
      add: false,
      countHidden: true,
      viewNote: 0,
    });
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

  it("selects a note's box, pans it to the centre and draws one card with a leader to it", () => {
    expect(f.orient.selected).toBe(true);
    expect(f.orient.centreDx).toBeLessThan(6);
    expect(f.orient.centreDy).toBeLessThan(6);
    expect(f.orient.cards).toBe(1);
    expect(f.orient.cardText).toBe("Hub one");
    expect(f.orient.activeRows).toBe(1);
    expect(f.orient.activeMark).toEqual(["app/hub.py"]);
    expect(f.orient.leaderEndsOnCard).toBe(true);
    expect(f.orient.leaderIsCurve).toBe(true);
    expect(f.orient.tint).toBe("person");
    expect(f.orient.gap).toBe(36);
    expect(f.orient.top).toBe(0);
  });

  it("draws only the active note as a card", () => {
    expect(f.second).toEqual({ cards: 1, text: "Hub two", tint: "agent" });
  });

  it("keeps the card beside its box when the layout moves it", () => {
    expect(f.follows.offsetAfter).toBe(f.follows.offsetBefore);
    expect(f.follows.xAfter).toBe(36);
    expect(f.follows.cards).toBe(1);
  });

  it("retargets the composer to another box without taking focus, and keeps Add off while blank", () => {
    expect(f.retarget.target).toBe("app/a.py");
    expect(f.retarget.focused).toBe(false);
    expect(f.addDisabledBlank).toBe(true);
    expect(f.addEnabled).toBe(true);
  });

  it("clears and blurs the field on Escape without adding", () => {
    expect(f.escape).toEqual({ value: "", focused: false, added: 4 });
  });

  it("adds on Cmd+Enter at version 3 with the fake's author and makes the new note active", () => {
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
    expect(f.added.cardText).toBe("fresh note");
    expect(f.added.cards).toBe(1);
    expect(f.added.count).toBe("5");
    expect(f.added.activeIsNew).toEqual(["fresh note"]);
    expect(f.added.off).toBeLessThan(2);
  });

  it("says to select a module when a folder is selected", () => {
    expect(f.folder).toEqual({
      prompt: true,
      promptText: "Select a module to add a note",
      field: false,
    });
  });

  it("focuses the composer on N for the selected module", () => {
    expect(f.nKey).toEqual({ focused: true, target: "app/hub.py" });
  });

  it("removes the active note on Backspace, but takes a freshly clicked box off the canvas", () => {
    expect(f.backspaceNote.after).toBe(f.backspaceNote.before - 1);
    expect(f.backspaceNote.removed).toBe(0);
    expect(f.backspaceNote.boxStillOn).toBe(1);
    expect(f.backspaceNote.cards).toBe(0);
    expect(f.backspaceBox.boxes).toBe(0);
    expect(f.backspaceBox.notes).toBe(f.backspaceNote.after);
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
    expect(f.removeOff).toEqual({ after: 2, off: 0 });
  });

  it("shows a note written by the CLI while the view is open without moving the viewport", () => {
    expect(f.live.rows).toEqual(["Agent says"]);
    expect(f.live.marks).toEqual(["app/a.py"]);
    expect(f.live.count).toBe("1");
    expect(f.live.sameViewport).toBe(true);
  });
});
