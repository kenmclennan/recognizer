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
import { parseViewFile } from ${JSON.stringify(here("view-file.ts"))};

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

const viewText = (steps, commit, description = "d") => JSON.stringify({ schema_version: 1, description, commit, steps }, null, 2) + "\\n";
const pick = (module) => ({ kind: "pick", module });
const tick = () => new Promise((resolve) => setTimeout(resolve, 40));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const key = (k) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const typeInto = (input, value) => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); };

function mount(files, options) {
  const host = document.createElement("div");
  host.style.cssText = "width:1400px;height:800px;display:flex;flex-direction:column";
  document.body.append(host);
  const port = fakeViews(files, options);
  port.scansByCommit.set("old1234", [thenScan]);
  const state = { count: "" };
  const notes = [];
  showExplorer(host, loaded, "demo", (text) => { state.count = text; }, port, (text) => notes.push(text));
  const q = (selector) => host.querySelector(selector);
  const all = (selector) => [...host.querySelectorAll(selector)];
  const count = () => Number(/^(\\d+) of/.exec(state.count)[1]);
  const lastCurrent = () => JSON.parse(port.current[port.current.length - 1]);
  const panelRows = () => all(".stale-panel .row").map((row) => ({ name: row.querySelector(".name").textContent, checked: row.querySelector(".rcheck").getAttribute("aria-checked") === "true", disc: row.querySelectorAll(".disc").length }));
  const panelRow = (name) => all(".stale-panel .row").find((row) => row.querySelector(".name").textContent === name);
  const selected = () => all(".box.selected").map((n) => n.dataset.id);
  return { host, port, state, notes, q, all, count, lastCurrent, panelRows, panelRow, selected };
}

const facts = {};

(async () => {
  await tick();

  const one = mount({});
  await tick();
  const shown = (selector) => { const node = one.q(selector); return node !== null && getComputedStyle(node).display !== "none"; };
  facts.freshOverlays = { menu: shown(".view-menu"), dialog: shown(".view-dialog"), stale: shown(".stale-panel") };
  facts.emptyStart = { count: one.count(), view: one.q(".view-name").textContent, bar: one.all(".view-bar button").length, writes: one.port.current.length, menuEmpty: (click(one.q(".view-list")), one.q(".view-menu").textContent) };
  click(one.q(".view-list"));
  click(one.q('.tree .row[data-path="app"] .rcheck'));
  await tick();
  facts.afterPutOn = one.lastCurrent();
  click(one.q(".view-save"));
  facts.dialog = { labels: one.all(".view-dialog label .view-field-label").map((n) => n.textContent), hint: one.q(".view-dialog .view-field-description").placeholder, disabled: one.q(".view-confirm").disabled };
  typeInto(one.q(".view-dialog .view-field-name"), "overview");
  facts.stillDisabled = one.q(".view-confirm").disabled;
  typeInto(one.q(".view-dialog .view-field-description"), "the app folder");
  facts.enabled = !one.q(".view-confirm").disabled;
  click(one.q(".view-confirm"));
  await tick();
  const saved = one.port.files.get("overview");
  const parsedSaved = parseViewFile(saved);
  const valid = parsedSaved.ok;
  const view = parsedSaved.ok ? parsedSaved.view : null;
  facts.saved = { valid, steps: view && view.steps, commit: view && view.commit, description: view && view.description, text: saved };
  facts.nameAfterSave = one.q(".view-name").textContent;
  facts.currentAfterSave = one.lastCurrent();

  click(one.q('.tree .row[data-path="app"] .rcheck'));
  await tick();
  facts.cleared = one.count();
  click(one.q(".view-list"));
  facts.menu = one.all(".view-item").map((n) => n.textContent);
  click(one.q(".view-item"));
  await tick();
  facts.reopened = { count: one.count(), footer: one.state.count, name: one.q(".view-name").textContent, panel: !one.q(".stale-panel").hidden };

  click(one.q(".box .box-body"));
  await tick();
  facts.selection = one.lastCurrent().selection;
  click(one.q(".view-back"));
  await tick();
  facts.afterBackSelection = { current: one.lastCurrent().selection, selected: one.selected() };
  click(one.q(".view-forward"));
  await tick();
  facts.afterForwardSelection = { current: one.lastCurrent().selection, selected: one.selected() };
  click(one.q(".view-back"));
  click(one.q(".view-back"));
  await tick();
  facts.afterTwoBack = { count: one.count(), modules: one.lastCurrent().modules };
  click(one.q(".view-forward"));
  await tick();
  facts.afterForward = { count: one.count(), modules: one.lastCurrent().modules };
  facts.copyDisabled = one.q(".view-copy").disabled;
  click(one.q(".view-copy"));
  await tick();
  facts.copied = one.port.copied;
  facts.copyNote = one.notes[one.notes.length - 1];

  one.port.edit("overview", viewText([pick("app/hub.py"), pick("app/a.py"), pick("lib/d.py")], "cur1234"));
  await tick();
  facts.agentEdit = one.count();
  const before = one.port.current.length;
  one.port.edit("overview", "{nope");
  await tick();
  facts.invalidEdit = { count: one.count(), notice: one.q(".notices").textContent, writes: one.port.current.length - before };
  one.port.edit("overview", viewText([pick("app/hub.py")], "cur1234"));
  await tick();
  facts.retried = { count: one.count(), notice: one.q(".notices").hidden };
  one.port.edit("overview", null);
  await tick();
  facts.deleted = { count: one.count(), name: one.q(".view-name").textContent, notice: one.q(".notices").textContent };

  const staleFile = viewText([pick("app/hub.py"), pick("lib/c.py"), pick("lib/deleted.py")], "old1234");
  const two = mount({ stale: staleFile, stale2: staleFile });
  two.port.renames = [{ from: "lib/deleted.py", to: "lib/e.py" }];
  await tick();
  click(two.q(".view-list"));
  click(two.all(".view-item")[0]);
  await tick();
  const panel = two.q(".stale-panel");
  facts.stale = {
    hidden: panel.hidden,
    text: panel.textContent,
    count: two.count(),
    rows: two.panelRows(),
    sections: [...panel.querySelectorAll("h4")].map((n) => n.textContent),
  };
  const historyBefore = two.port.current.length;
  click(two.panelRow("lib/d.py").querySelector(".rcheck"));
  await tick();
  facts.ticked = { count: two.count(), rows: two.panelRows(), writes: two.port.current.length - historyBefore };
  click(two.q(".view-back"));
  await tick();
  facts.backUntick = { count: two.count(), rows: two.panelRows() };
  click(two.q(".view-forward"));
  await tick();
  click(two.panelRow("lib/d.py").querySelector(".rcheck"));
  await tick();
  facts.unticked = { count: two.count(), rows: two.panelRows() };
  click(two.panelRow("lib/d.py").querySelector(".rcheck"));
  await tick();
  click(two.q(".stale-update"));
  await tick();
  const updated = JSON.parse(two.port.files.get("stale"));
  facts.updated = { steps: updated.steps, commit: updated.commit, panelHidden: two.q(".stale-panel").hidden, count: two.count(), valid: parseViewFile(two.port.files.get("stale")).ok };

  click(two.q(".view-list"));
  click(two.all(".view-item")[1]);
  await tick();
  click(two.panelRow("lib/e.py").querySelector(".rcheck"));
  await tick();
  facts.renameUnticked = { count: two.count(), rows: two.panelRows() };
  click(two.q(".stale-update"));
  await tick();
  const dropped = JSON.parse(two.port.files.get("stale2"));
  facts.droppedUpdate = { steps: dropped.steps, commit: dropped.commit };

  click(two.q(".view-list"));
  click(two.all(".view-item")[1]);
  await tick();
  facts.leaveBefore = !two.q(".stale-panel").hidden;

  const three = mount({ late: staleFile }, { delayScans: true });
  await tick();
  click(three.q(".view-list"));
  click(three.q(".view-item"));
  await tick();
  facts.late = { count: three.count(), text: three.q(".stale-panel").textContent, hidden: three.q(".stale-panel").hidden };
  await three.port.settle();
  await tick();
  facts.lateDone = { text: three.q(".stale-panel").textContent, sections: [...three.q(".stale-panel").querySelectorAll("h4")].map((n) => n.textContent) };

  const four = mount({ plain: viewText([pick("app/hub.py")], "cur1234") });
  await tick();
  click(four.q(".view-list"));
  click(four.q(".view-item"));
  await tick();
  facts.sameCommit = { hidden: four.q(".stale-panel").hidden, count: four.count() };
  click(four.q('.tree .row[data-path="lib"] .rcheck'));
  await tick();
  click(four.q(".view-save"));
  await tick();
  const resaved = JSON.parse(four.port.files.get("plain"));
  facts.resaved = { steps: resaved.steps, description: resaved.description };

  const five = mount({ listed: viewText([pick("app/hub.py")], "cur1234") });
  await tick();
  const fiveName = five.q(".view-list");
  const menuOf = () => five.q(".view-menu");
  const labels = {};
  for (const [selector, label] of [[".view-list", "Saved views"], [".view-back", "Back"], [".view-forward", "Forward"], [".view-save", "Save the view"], [".view-copy", "Copy the view's path"]]) {
    const node = five.q(selector);
    const svg = node.querySelector("svg");
    labels[selector] = { aria: node.getAttribute("aria-label") === label, title: node.title === label, text: node.textContent.trim(), width: svg && svg.getBoundingClientRect().width, stroke: svg && getComputedStyle(svg).strokeWidth };
  }
  const chevron = fiveName.querySelector("svg.view-chevron");
  facts.barLook = { labels, nameText: five.q(".view-name").textContent.trim(), nameChevron: five.q(".view-name svg") !== null, weight: getComputedStyle(five.q(".view-name")).fontWeight, chevron: chevron && chevron.getBoundingClientRect().width };
  click(fiveName);
  facts.listedMenu = { hidden: menuOf().hidden, items: five.all(".view-item").map((n) => n.textContent), expanded: fiveName.getAttribute("aria-expanded") };
  key("Escape");
  facts.afterEscape = { hidden: menuOf().hidden, expanded: fiveName.getAttribute("aria-expanded") };
  click(fiveName);
  five.host.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  facts.afterOutside = menuOf().hidden;
  click(fiveName);
  fiveName.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  facts.afterInside = menuOf().hidden;
  click(five.q(".view-item"));
  facts.afterChoose = menuOf().hidden;
  await tick();

  const six = mount({ ok: viewText([pick("app/hub.py")], "cur1234") }, { listError: "no folder" });
  await tick();
  click(six.q(".view-list"));
  const broken = mount({}, { writeError: "disk full" });
  await tick();
  click(broken.q(".view-save"));
  typeInto(broken.q(".view-dialog .view-field-name"), "keep");
  typeInto(broken.q(".view-dialog .view-field-description"), "a long description kept after a failure");
  click(broken.q(".view-confirm"));
  await tick();
  const descriptionBox = broken.q(".view-dialog .view-field-description");
  facts.failedSave = {
    dialogOpen: !broken.q(".view-dialog").hidden,
    name: broken.q(".view-dialog .view-field-name").value,
    description: descriptionBox.value,
    problem: broken.q(".view-problem").textContent,
    notice: broken.q(".notices").textContent,
    tag: descriptionBox.tagName,
    rows: descriptionBox.rows,
    wrapsInside: descriptionBox.offsetWidth <= broken.q(".view-dialog").offsetWidth,
    enterPrevented: !descriptionBox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })) ,
    enabled: !broken.q(".view-confirm").disabled,
  };
  facts.failedList = { menu: six.q(".view-menu").textContent, notice: six.q(".notices").textContent, noticeShown: !six.q(".notices").hidden };

  const seven = mount({ ok: viewText([pick("app/hub.py")], "cur1234") }, { refused: ["views/x.json: unreadable"] });
  await tick();
  facts.refusedList = { notice: seven.q(".notices").textContent, items: (click(seven.q(".view-list")), seven.all(".view-item").length) };

  const rename = mount({ alpha: viewText([pick("app/hub.py")], "cur1234"), beta: viewText([pick("app/a.py")], "cur1234") });
  await tick();
  click(rename.q(".view-list"));
  click(rename.all(".view-item")[0]);
  await tick();
  const edit = (value, k) => {
    const field = rename.q(".view-name-field-inline");
    typeInto(field, value);
    field.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  };
  click(rename.q(".view-name"));
  facts.editing = { field: !rename.q(".view-name-field-inline").hidden, value: rename.q(".view-name-field-inline").value, nameHidden: rename.q(".view-name").hidden, weight: getComputedStyle(rename.q(".view-name-field-inline")).fontWeight, border: getComputedStyle(rename.q(".view-name-field-inline")).borderColor, selection: (() => { const probe = document.createElement("i"); probe.style.color = "var(--sel)"; document.body.append(probe); return getComputedStyle(probe).color; })() };
  edit("beta", "Enter");
  await tick();
  facts.taken = { field: !rename.q(".view-name-field-inline").hidden, problem: rename.q(".view-name-problem").hidden ? "" : rename.q(".view-name-problem").textContent, renamed: rename.port.renamed.length, files: [...rename.port.files.keys()] };
  edit("../x", "Enter");
  await tick();
  facts.badName = { field: !rename.q(".view-name-field-inline").hidden, problem: rename.q(".view-name-problem").textContent, renamed: rename.port.renamed.length };
  edit("alpha", "Escape");
  facts.escaped = { field: !rename.q(".view-name-field-inline").hidden, name: rename.q(".view-name").textContent, renamed: rename.port.renamed.length };
  click(rename.q(".view-name"));
  rename.q(".view-name-field-inline").dispatchEvent(new Event("blur"));
  facts.blurred = { field: !rename.q(".view-name-field-inline").hidden, renamed: rename.port.renamed.length };
  click(rename.q(".view-name"));
  const before2 = rename.port.current.length;
  edit("gamma", "Enter");
  await tick();
  click(rename.q(".view-list"));
  facts.renamed = { field: !rename.q(".view-name-field-inline").hidden, name: rename.q(".view-name").textContent, port: rename.port.renamed, files: [...rename.port.files.keys()], menu: rename.all(".view-item").map((n) => n.querySelector(".view-item-name").textContent), current: rename.all(".view-item.current").map((n) => n.querySelector(".view-item-name").textContent), currentView: rename.lastCurrent().view, wrote: rename.port.current.length > before2, notice: rename.q(".notices").textContent };
  click(rename.q(".view-back"));
  click(rename.q(".view-forward"));
  await tick();
  facts.afterRenameBack = rename.lastCurrent().view;

  const untitled = mount({ taken: viewText([pick("app/hub.py")], "cur1234") });
  await tick();
  click(untitled.q('.tree .row[data-path="app"] .rcheck'));
  await tick();
  click(untitled.q(".view-name"));
  facts.untitledField = untitled.q(".view-name-field-inline").value;
  const untitledEdit = (value) => {
    const field = untitled.q(".view-name-field-inline");
    typeInto(field, value);
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  };
  untitledEdit("taken");
  facts.untitledTaken = { problem: untitled.q(".view-name-problem").textContent, dialog: !untitled.q(".view-dialog").hidden };
  untitledEdit("fresh");
  facts.untitledNamed = { field: !untitled.q(".view-name-field-inline").hidden, dialog: !untitled.q(".view-dialog").hidden, name: untitled.q(".view-dialog .view-field-name").value, focused: document.activeElement === untitled.q(".view-dialog .view-field-description"), written: [...untitled.port.files.keys()] };
  typeInto(untitled.q(".view-dialog .view-field-description"), "shows fresh");
  click(untitled.q(".view-confirm"));
  await tick();
  facts.untitledSaved = { files: [...untitled.port.files.keys()], name: untitled.q(".view-name").textContent };

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

async function collect(): Promise<Facts> {
  const dir = mkdtempSync(join(tmpdir(), "explorer-views-"));

  try {
    const bundle = (
      await build({
        stdin: { contents: HARNESS, resolveDir: dir, loader: "ts" },
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
      { encoding: "utf8", timeout: 60000 },
    );
    const match = /<div id="out">([^<]*)<\/div>/.exec(run.stdout);

    if (match === null || !/^[A-Za-z0-9+/=]+$/.test(match[1])) {
      throw new Error(`no harness output: ${run.stderr.slice(0, 500)}`);
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

describe.skipIf(chrome === undefined)("saved views in the explorer", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collect();
  }, 180000);

  it("opens on an empty canvas with an Untitled view and no saved views", () => {
    expect(f.emptyStart.count).toBe(0);
    expect(f.emptyStart.view).toBe("Untitled");
    expect(f.emptyStart.menuEmpty).toContain("No saved views");
    expect(f.emptyStart.writes).toBeGreaterThan(0);
  });

  it("shows no menu, dialog or stale panel in a fresh window", () => {
    expect(f.freshOverlays).toEqual({
      menu: false,
      dialog: false,
      stale: false,
    });
  });

  it("saves a valid view file of picks at the scan's commit", () => {
    expect(f.dialog.labels).toEqual(["Name", "Description"]);
    expect(f.dialog.hint).toBe("What it shows");
    expect(f.dialog.disabled).toBe(true);
    expect(f.stillDisabled).toBe(true);
    expect(f.enabled).toBe(true);
    expect(f.saved.valid).toBe(true);
    expect(f.saved.steps).toEqual([
      { kind: "pick", module: "app/a.py" },
      { kind: "pick", module: "app/hub.py" },
    ]);
    expect(f.saved.commit).toBe("cur1234");
    expect(f.saved.description).toBe("the app folder");
    expect(f.saved.text.endsWith("\n")).toBe(true);
    expect(f.nameAfterSave).toBe("overview");
    expect(f.currentAfterSave.view).toBe("overview");
  });

  it("restores the canvas when the view is opened from the menu", () => {
    expect(f.cleared).toBe(0);
    expect(f.menu).toHaveLength(1);
    expect(f.menu[0]).toContain("overview");
    expect(f.menu[0]).toContain("the app folder");
    expect(f.reopened.count).toBe(2);
    expect(f.reopened.footer).toContain("2 of 5");
    expect(f.reopened.name).toBe("overview");
    expect(f.reopened.panel).toBe(false);
  });

  it("writes current-view.json after each change", () => {
    expect(f.afterPutOn.modules).toEqual(["app/a.py", "app/hub.py"]);
    expect(f.afterPutOn.schema_version).toBe(1);
    expect(f.afterPutOn.view).toBeNull();
    expect(f.selection).toEqual({ kind: "module", id: expect.any(String) });
  });

  it("walks back and forward over modules and selection", () => {
    expect(f.afterBackSelection.current).toBeNull();
    expect(f.afterBackSelection.selected).toEqual([]);
    expect(f.afterForwardSelection.current).toEqual(f.selection);
    expect(f.afterForwardSelection.selected).toHaveLength(1);
    expect(f.afterTwoBack.count).toBe(0);
    expect(f.afterTwoBack.modules).toEqual([]);
    expect(f.afterForward.count).toBe(2);
  });

  it("copies the absolute path of the open view and names it", () => {
    expect(f.copyDisabled).toBe(false);
    expect(f.copied).toEqual(["/repo/.recognizer/views/overview.json"]);
    expect(f.copyNote).toBe("Copied /repo/.recognizer/views/overview.json");
  });

  it("applies an agent's edit without a click and keeps the canvas on an invalid one", () => {
    expect(f.agentEdit).toBe(3);
    expect(f.invalidEdit.count).toBe(3);
    expect(f.invalidEdit.notice).toContain("overview is not a valid view");
    expect(f.retried.count).toBe(1);
    expect(f.retried.notice).toBe(true);
    expect(f.deleted.count).toBe(1);
    expect(f.deleted.name).toBe("Untitled");
    expect(f.deleted.notice).toContain("overview was deleted");
  });

  it("opens a stale view showing the rest with the missing path, its rename and the newly relevant modules", () => {
    expect(f.stale.hidden).toBe(false);
    expect(f.stale.text).toContain("lib/deleted.py");
    expect(f.stale.text).toContain("renamed to");
    expect(f.stale.sections).toEqual([
      "Missing",
      "Changed relations",
      "Newly relevant",
    ]);
    expect(f.stale.text).toContain("+ app/hub.py -> lib/c.py");
    expect(f.stale.count).toBe(3);
    expect(f.stale.rows).toEqual([
      { name: "lib/e.py", checked: true, disc: 1 },
      { name: "lib/d.py", checked: false, disc: 1 },
    ]);
  });

  it("draws a newly relevant module when its row is ticked and takes it off when unticked", () => {
    expect(f.ticked.count).toBe(4);
    expect(f.ticked.rows[1].checked).toBe(true);
    expect(f.ticked.writes).toBeGreaterThan(0);
    expect(f.backUntick.count).toBe(3);
    expect(f.backUntick.rows[1].checked).toBe(false);
    expect(f.unticked.count).toBe(3);
  });

  it("updates the file with the rename and the ticked module and moves the commit", () => {
    expect(f.updated.valid).toBe(true);
    expect(f.updated.steps).toEqual([
      { kind: "pick", module: "app/hub.py" },
      { kind: "pick", module: "lib/c.py" },
      { kind: "pick", module: "lib/e.py" },
      { kind: "pick", module: "lib/d.py" },
    ]);
    expect(f.updated.commit).toBe("cur1234");
    expect(f.updated.panelHidden).toBe(true);
    expect(f.updated.count).toBe(4);
  });

  it("deletes the old pick and adds no new path when the rename row is unticked", () => {
    expect(f.renameUnticked.count).toBe(2);
    expect(f.renameUnticked.rows[0]).toEqual({
      name: "lib/e.py",
      checked: false,
      disc: 1,
    });
    expect(f.droppedUpdate.steps).toEqual([
      { kind: "pick", module: "app/hub.py" },
      { kind: "pick", module: "lib/c.py" },
    ]);
    expect(f.droppedUpdate.commit).toBe("cur1234");
    expect(f.leaveBefore).toBe(false);
  });

  it("draws the canvas before the commit comparison arrives", () => {
    expect(f.late.hidden).toBe(false);
    expect(f.late.count).toBe(2);
    expect(f.late.text).toContain("Comparing with the commit...");
    expect(f.late.text).not.toContain("Changed relations");
    expect(f.lateDone.text).not.toContain("Comparing with the commit...");
    expect(f.lateDone.sections).toContain("Newly relevant");
  });

  it("draws the bar with 16px stroke icons labelled and titled, and a chevron after the name", () => {
    for (const [selector, entry] of Object.entries(f.barLook.labels) as [
      string,
      {
        aria: boolean;
        title: boolean;
        text: string;
        width: number;
        stroke: string;
      },
    ][]) {
      expect(entry.aria, selector).toBe(true);
      expect(entry.title, selector).toBe(true);
      expect(entry.text, selector).toBe("");
      expect(entry.width, selector).toBe(16);
      expect(entry.stroke, selector).toBe("2px");
    }

    expect(f.barLook.nameText).toBe("Untitled");
    expect(Number(f.barLook.weight)).toBeGreaterThanOrEqual(600);
    expect(f.barLook.chevron).toBe(12);
  });

  it("puts the saved-views list on its own folder-open button with a chevron before the name", () => {
    expect(f.barLook.labels[".view-list"].aria).toBe(true);
    expect(f.barLook.labels[".view-list"].title).toBe(true);
    expect(f.barLook.nameChevron).toBe(false);
  });

  it("turns the name into a bold text field with the selection colour focus ring", () => {
    expect(f.editing.field).toBe(true);
    expect(f.editing.nameHidden).toBe(true);
    expect(f.editing.value).toBe("alpha");
    expect(Number(f.editing.weight)).toBeGreaterThanOrEqual(600);
    expect(f.editing.border).toBe(f.editing.selection);
  });

  it("refuses a taken or malformed name in place and writes nothing", () => {
    expect(f.taken.field).toBe(true);
    expect(f.taken.problem).toContain("beta already exists");
    expect(f.taken.renamed).toBe(0);
    expect(f.taken.files).toEqual(["alpha", "beta"]);
    expect(f.badName.field).toBe(true);
    expect(f.badName.problem).toContain("Use letters");
    expect(f.badName.renamed).toBe(0);
  });

  it("cancels on Escape and on blur without change", () => {
    expect(f.escaped).toEqual({ field: false, name: "alpha", renamed: 0 });
    expect(f.blurred).toEqual({ field: false, renamed: 0 });
  });

  it("renames the open view on Enter and follows the new name everywhere", () => {
    expect(f.renamed.field).toBe(false);
    expect(f.renamed.name).toBe("gamma");
    expect(f.renamed.port).toEqual([{ from: "alpha", to: "gamma" }]);
    expect(f.renamed.files).toEqual(["beta", "gamma"]);
    expect(f.renamed.menu).toEqual(["beta", "gamma"]);
    expect(f.renamed.current).toEqual(["gamma"]);
    expect(f.renamed.currentView).toBe("gamma");
    expect(f.renamed.wrote).toBe(true);
    expect(f.renamed.notice).not.toContain("deleted");
    expect(f.afterRenameBack).toBe("gamma");
  });

  it("opens the save dialog with the name filled and the description focused when naming an Untitled view", () => {
    expect(f.untitledField).toBe("");
    expect(f.untitledTaken.problem).toContain("taken already exists");
    expect(f.untitledTaken.dialog).toBe(false);
    expect(f.untitledNamed).toEqual({
      field: false,
      dialog: true,
      name: "fresh",
      focused: true,
      written: ["taken"],
    });
    expect([...f.untitledSaved.files].sort()).toEqual(["fresh", "taken"]);
    expect(f.untitledSaved.name).toBe("fresh");
  });

  it("lists the saved views the port holds at startup in the menu", () => {
    expect(f.listedMenu.hidden).toBe(false);
    expect(f.listedMenu.expanded).toBe("true");
    expect(f.listedMenu.items).toHaveLength(1);
    expect(f.listedMenu.items[0]).toContain("listed");
  });

  it("closes the menu on Escape, on a click outside it and on choosing a view, and not on a click inside the bar", () => {
    expect(f.afterEscape.hidden).toBe(true);
    expect(f.afterEscape.expanded).toBe("false");
    expect(f.afterOutside).toBe(true);
    expect(f.afterInside).toBe(false);
    expect(f.afterChoose).toBe(true);
  });

  it("keeps the dialog open with its values and says why when a save fails, in a wrapping three-line description", () => {
    expect(f.failedSave.dialogOpen).toBe(true);
    expect(f.failedSave.name).toBe("keep");
    expect(f.failedSave.description).toBe(
      "a long description kept after a failure",
    );
    expect(f.failedSave.problem).toContain("disk full");
    expect(f.failedSave.notice).toContain("Could not save keep");
    expect(f.failedSave.tag).toBe("TEXTAREA");
    expect(f.failedSave.rows).toBe(3);
    expect(f.failedSave.wrapsInside).toBe(true);
    expect(f.failedSave.enabled).toBe(true);
  });

  it("shows a failed list in the notices and never says there are no saved views", () => {
    expect(f.failedList.noticeShown).toBe(true);
    expect(f.failedList.notice).toContain("Could not list saved views");
    expect(f.failedList.notice).toContain("no folder");
    expect(f.failedList.menu).toContain(
      "could not be listed: Error: no folder",
    );
    expect(f.failedList.menu).not.toContain("No saved views");
  });

  it("shows a view file the list refused in the notices and still lists the rest", () => {
    expect(f.refusedList.notice).toContain("views/x.json: unreadable");
    expect(f.refusedList.items).toBe(1);
  });

  it("shows no warning for a view at the current commit and records only picks on save", () => {
    expect(f.sameCommit.hidden).toBe(true);
    expect(f.sameCommit.count).toBe(1);
    expect(f.resaved.description).toBe("d");
    expect(f.resaved.steps).toEqual([
      { kind: "pick", module: "app/hub.py" },
      { kind: "pick", module: "lib/c.py" },
      { kind: "pick", module: "lib/d.py" },
      { kind: "pick", module: "lib/e.py" },
    ]);
  });
});
