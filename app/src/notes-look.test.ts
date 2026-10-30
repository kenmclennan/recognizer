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
const loaded = { modules: ids, scans: [{ file: "scan.json", scan: nowScan }], policy: null, notices: [], blocking: null };

const HUB = "app/hub.py";
const A = "app/a.py";
const make = (steps, extra) => JSON.stringify({ schema_version: extra ? 2 : 1, description: "d", commit: "cur1234", ...(extra || {}), steps }, null, 2) + "\\n";
const pick = (module) => ({ kind: "pick", module });
const PICKS = [pick(HUB), pick(A), pick("lib/c.py")];
const tick = () => new Promise((resolve) => setTimeout(resolve, 40));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const typeInto = (input, value) => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); };

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
  const select = async (id) => {
    click(q('.box[data-id="' + id + '"] .box-body'));
    await tick();
    if (!q(".inspector-panel .pswitch")) { click(q('.selection-bar [aria-label^="Contents"]')); await tick(); }
  };
  const firstRows = () => [...q(".inspector-panel").querySelectorAll(".module-note, .responsibility, .pswitch")].map((n) => n.className.split(" ")[0]);
  return { host, port, q, all, saved, shown, openView, select, firstRows };
}

const marks = (m) => m.all(".note-mark").map((n) => n.dataset.id).sort();

(async () => {
  await tick();
  const facts = {};

  const none = mount({});
  await tick();
  click(none.q('.tree .row[data-path="app"] .rcheck'));
  await tick();
  await none.select(HUB);
  facts.noView = { viewNote: none.shown(".view-note"), viewNoteChildren: none.all(".view-note > *").length, moduleNote: none.all(".module-note").length, marks: marks(none) };

  const noted = mount({
    order: make(PICKS, { note: { text: "Start at the hub", by: "Claude" }, module_notes: { [HUB]: { text: "The hub of everything", by: "Ken" } } }),
  });
  await tick();
  await noted.openView();
  const nameBox = noted.q(".view-name").getBoundingClientRect();
  const noteBox = noted.q(".view-note").getBoundingClientRect();
  facts.viewNote = { text: noted.q(".view-note .note-text").textContent, by: noted.q(".view-note .note-by").textContent, below: noteBox.top >= nameBox.bottom, left: Math.abs(noteBox.left - noted.q(".view-bar").getBoundingClientRect().left) < 12, inBar: noteBox.bottom <= noted.q(".view-bar").getBoundingClientRect().bottom + 0.5, flow: getComputedStyle(noted.q(".view-note")).position === "static", actions: noted.all(".view-note button").map((n) => n.textContent) };
  facts.marks = { ids: marks(noted), folders: noted.all(".box.folder .note-mark").length, inside: (() => { const mark = noted.q(".note-mark").getBoundingClientRect(); const body = noted.q('.box[data-id="' + HUB + '"] .box-body').getBoundingClientRect(); return mark.left >= body.left && mark.right <= body.right && mark.top >= body.top && mark.bottom <= body.bottom; })() };
  await noted.select(HUB);
  facts.moduleNote = { order: noted.firstRows(), text: noted.q(".module-note .note-text").textContent, by: noted.q(".module-note .note-by").textContent };
  await noted.select(A);
  facts.moduleWithout = { order: noted.firstRows(), actions: noted.all(".module-note button").map((n) => n.textContent), text: noted.all(".module-note .note-text").length };
  click(noted.q(".view-save"));
  await tick();
  const kept = noted.saved("order");
  facts.keptOnSave = { version: kept.schema_version, note: kept.note, moduleNotes: kept.module_notes };

  const writer = mount({ plain: make(PICKS) }, "Tester");
  await tick();
  await writer.openView();
  facts.plainShows = { actions: writer.all(".view-note button").map((n) => n.textContent), marks: marks(writer) };
  click(writer.q(".view-note .note-add"));
  facts.viewAddFocus = writer.q(".view-note .note-field") === document.activeElement;
  facts.addingDisabled = writer.q(".view-note .note-save").disabled;
  typeInto(writer.q(".view-note .note-field"), "  How it hangs together ");
  facts.addingEnabled = !writer.q(".view-note .note-save").disabled;
  click(writer.q(".view-note .note-save"));
  await tick();
  const wrote = writer.saved("plain");
  facts.viewWritten = { version: wrote.schema_version, note: wrote.note, steps: wrote.steps, keys: Object.keys(wrote), shown: writer.q(".view-note .note-text").textContent, by: writer.q(".view-note .note-by").textContent };
  click(writer.q(".view-note .note-edit"));
  facts.editField = writer.q(".view-note .note-field").value;
  const viewField = writer.q(".view-note .note-field");
  facts.viewEditFocus = { focused: viewField === document.activeElement, caret: [viewField.selectionStart, viewField.selectionEnd], length: viewField.value.length };
  viewField.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  facts.viewEscape = { fields: writer.all(".view-note .note-field").length, note: writer.saved("plain").note.text };
  click(writer.q(".view-note .note-edit"));
  typeInto(writer.q(".view-note .note-field"), "Reworded");
  click(writer.q(".view-note .note-save"));
  await tick();
  facts.viewEdited = writer.saved("plain").note;
  click(writer.q(".view-note .note-delete"));
  await tick();
  facts.viewDeleted = { keys: Object.keys(writer.saved("plain")), actions: writer.all(".view-note button").map((n) => n.textContent) };

  await writer.select(A);
  click(writer.q(".module-note .note-add"));
  facts.moduleAddFocus = writer.q(".module-note .note-field") === document.activeElement;
  facts.moduleAddDisabled = writer.q(".module-note .note-save").disabled;
  typeInto(writer.q(".module-note .note-field"), "Why a exists");
  click(writer.q(".module-note .note-save"));
  await tick();
  facts.moduleWritten = { notes: writer.saved("plain").module_notes, version: writer.saved("plain").schema_version, shown: writer.q(".module-note .note-text").textContent, by: writer.q(".module-note .note-by").textContent, marks: marks(writer) };
  click(writer.q(".module-note .note-edit"));
  facts.moduleEditField = writer.q(".module-note .note-field").value;
  const moduleField = writer.q(".module-note .note-field");
  facts.moduleEditFocus = { focused: moduleField === document.activeElement, caret: [moduleField.selectionStart, moduleField.selectionEnd], length: moduleField.value.length };
  moduleField.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  facts.moduleEscape = { fields: writer.all(".module-note .note-field").length, note: writer.saved("plain").module_notes["app/a.py"].text };
  click(writer.q(".module-note .note-edit"));
  typeInto(writer.q(".module-note .note-field"), "Changed");
  click(writer.q(".module-note .note-cancel"));
  facts.cancelled = { notes: writer.saved("plain").module_notes, editing: writer.all(".module-note .note-field").length };
  click(writer.q(".module-note .note-edit"));
  typeInto(writer.q(".module-note .note-field"), "Changed");
  click(writer.q(".module-note .note-save"));
  await tick();
  facts.moduleEdited = writer.saved("plain").module_notes;
  click(writer.q(".module-note .note-delete"));
  await tick();
  facts.moduleDeleted = { keys: Object.keys(writer.saved("plain")), marks: marks(writer), actions: writer.all(".module-note button").map((n) => n.textContent) };

  const live = mount({ plain: make(PICKS) });
  await tick();
  await live.openView();
  live.port.edit("plain", make(PICKS, { note: { text: "From the agent", by: "agent" }, module_notes: { [A]: { text: "Agent says", by: "agent" } } }));
  await tick();
  facts.live = { text: live.q(".view-note .note-text").textContent, by: live.q(".view-note .note-by").textContent, marks: marks(live) };

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

  it("has no note control, row or mark when no view is open", () => {
    expect(f.noView).toEqual({
      viewNote: false,
      viewNoteChildren: 0,
      moduleNote: 0,
      marks: [],
    });
  });

  it("shows the view's note under its name with its author", () => {
    expect(f.viewNote.text).toBe("Start at the hub");
    expect(f.viewNote.by).toBe("by Claude");
    expect(f.viewNote.below).toBe(true);
    expect(f.viewNote.left).toBe(true);
    expect(f.viewNote.inBar).toBe(true);
    expect(f.viewNote.flow).toBe(true);
    expect(f.viewNote.actions).toEqual(["Edit", "Delete"]);
  });

  it("marks the box of a noted module and no other box or folder", () => {
    expect(f.marks.ids).toEqual(["app/hub.py"]);
    expect(f.marks.folders).toBe(0);
    expect(f.marks.inside).toBe(true);
  });

  it("makes the module note the first row of Contents, above the responsibility, with its author", () => {
    expect(f.moduleNote.order).toEqual(["module-note", "responsibility"]);
    expect(f.moduleNote.text).toBe("The hub of everything");
    expect(f.moduleNote.by).toBe("by Ken");
  });

  it("offers only Add note on a module without one", () => {
    expect(f.moduleWithout.order[0]).toBe("module-note");
    expect(f.moduleWithout.actions).toEqual(["Add note"]);
    expect(f.moduleWithout.text).toBe(0);
  });

  it("keeps both kinds of note through a save of the open view", () => {
    expect(f.keptOnSave).toEqual({
      version: 2,
      note: { text: "Start at the hub", by: "Claude" },
      moduleNotes: {
        "app/hub.py": { text: "The hub of everything", by: "Ken" },
      },
    });
  });

  it("writes, edits and deletes the view note with the fake's author at version 2", () => {
    expect(f.plainShows).toEqual({ actions: ["Add note"], marks: [] });
    expect(f.viewAddFocus).toBe(true);
    expect(f.addingDisabled).toBe(true);
    expect(f.addingEnabled).toBe(true);
    expect(f.viewWritten.version).toBe(2);
    expect(f.viewWritten.note).toEqual({
      text: "How it hangs together",
      by: "Tester",
    });
    expect(f.viewWritten.steps).toHaveLength(3);
    expect(f.viewWritten.keys).toEqual([
      "schema_version",
      "description",
      "commit",
      "note",
      "steps",
    ]);
    expect(f.viewWritten.shown).toBe("How it hangs together");
    expect(f.viewWritten.by).toBe("by Tester");
    expect(f.editField).toBe("How it hangs together");
    expect(f.viewEditFocus).toEqual({
      focused: true,
      caret: [21, 21],
      length: 21,
    });
    expect(f.viewEscape).toEqual({ fields: 0, note: "How it hangs together" });
    expect(f.viewEdited).toEqual({ text: "Reworded", by: "Tester" });
    expect(f.viewDeleted.keys).not.toContain("note");
    expect(f.viewDeleted.actions).toEqual(["Add note"]);
  });

  it("writes, edits, cancels and deletes a module note and its mark", () => {
    expect(f.moduleAddFocus).toBe(true);
    expect(f.moduleAddDisabled).toBe(true);
    expect(f.moduleWritten.notes).toEqual({
      "app/a.py": { text: "Why a exists", by: "Tester" },
    });
    expect(f.moduleWritten.version).toBe(2);
    expect(f.moduleWritten.shown).toBe("Why a exists");
    expect(f.moduleWritten.by).toBe("by Tester");
    expect(f.moduleWritten.marks).toEqual(["app/a.py"]);
    expect(f.moduleEditField).toBe("Why a exists");
    expect(f.moduleEditFocus).toEqual({
      focused: true,
      caret: [12, 12],
      length: 12,
    });
    expect(f.moduleEscape).toEqual({ fields: 0, note: "Why a exists" });
    expect(f.cancelled).toEqual({
      notes: { "app/a.py": { text: "Why a exists", by: "Tester" } },
      editing: 0,
    });
    expect(f.moduleEdited).toEqual({
      "app/a.py": { text: "Changed", by: "Tester" },
    });
    expect(f.moduleDeleted.keys).not.toContain("module_notes");
    expect(f.moduleDeleted.marks).toEqual([]);
    expect(f.moduleDeleted.actions).toEqual(["Add note"]);
  });

  it("shows a note written by the CLI while the view is open", () => {
    expect(f.live).toEqual({
      text: "From the agent",
      by: "by agent",
      marks: ["app/a.py"],
    });
  });
});
