import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, FAKE_WORKER, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
window.__TAURI_INTERNALS__ = { invoke: async () => "0.0.0" };
import { showExplorer } from ${JSON.stringify(here("explorer.ts"))};
import { buildFooter } from ${JSON.stringify(here("footer-view.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
import { fakeWindow } from ${JSON.stringify(here("window-fake.ts"))};
${FAKE_WORKER}

const edge = (from, to) => ({ from, to, kind: "depends", line: 1, names: ["X"] });
const ids = ["app/hub.py", "app/a.py", "lib/c.py"];
const scan = { commit: "cur1234", modules: ids.map((id) => ({ id, kind: "module" })), edges: [edge("app/hub.py", "app/a.py"), edge("app/hub.py", "lib/c.py")], foreign: [], };
const base = { modules: ids, scans: [{ file: "scan.json", scan }], policy: null, baseline: null, notices: [], blocking: null, findings: [], sensors: [], folderMetrics: [] };
const viewText = (steps, commit) => JSON.stringify({ schema_version: 1, description: "d", commit, steps }, null, 2) + "\\n";
const pick = (module) => ({ kind: "pick", module });
const tick = () => new Promise((resolve) => setTimeout(resolve, 40));
const click = (node, what = "node") => { if (!node) throw new Error("missing " + what); return node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); };

function session(options = {}) {
  const footerEl = document.createElement("footer");
  footerEl.className = "footer";
  document.body.append(footerEl);
  const footer = buildFooter(footerEl);
  const port = fakeViews(options.files || {}, options.views || {});
  const win = fakeWindow();
  const q = (selector) => footerEl.querySelector(selector);
  const all = (selector) => [...footerEl.querySelectorAll(selector)];
  const state = { explorer: null, host: null };
  const rows = () => all(".message-list .msg").map((row) => row.querySelector(".msg-text").textContent);
  const build = (loaded) => {
    state.explorer?.dispose();
    state.host?.remove();
    const host = document.createElement("div");
    host.style.cssText = "width:1400px;height:800px;display:flex;flex-direction:column";
    document.body.append(host);
    state.host = host;
    state.explorer = showExplorer(host, loaded, "demo", () => {}, port, footer.post, null, undefined, undefined, undefined, undefined, win, undefined, undefined, footer.withdraw, footer.reconcile);
  };
  const hostQ = (selector) => state.host.querySelector(selector);
  const hostAll = (selector) => [...state.host.querySelectorAll(selector)];
  return { footer, footerEl, q, all, rows, build, port, win, state, hostQ, hostAll };
}

const facts = {};

(async () => {
  const cond = session();
  cond.build({ ...base, baseline: "{nope" });
  await tick();
  facts.baselineOnce = { rows: cond.rows(), toast: !cond.q(".message-toast").hidden, quiet: cond.q(".bell-badge").classList.contains("quiet") };
  cond.build({ ...base, baseline: "{nope" });
  await tick();
  facts.baselineTwice = cond.rows();
  click(cond.q(".bell"));
  click(cond.q(".message-clear"));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  cond.build({ ...base, baseline: "{nope" });
  await tick();
  facts.baselineAfterClear = cond.rows();

  const fixed = session();
  fixed.build({ ...base, baseline: "{nope", notices: ["scan.go.json is not valid JSON: x"], overlaysUnreadable: ["cov"] });
  await tick();
  facts.three = fixed.rows();
  click(fixed.q(".bell"));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  fixed.build({ ...base, baseline: null, notices: ["scan.go.json is not valid JSON: x"], overlaysUnreadable: ["cov"] });
  await tick();
  facts.afterBaselineFixed = { rows: fixed.rows(), toastHidden: fixed.q(".message-toast").hidden };
  fixed.build({ ...base });
  await tick();
  facts.afterAllFixed = { rows: fixed.rows(), badgeHidden: fixed.q(".bell-badge").hidden, toastHidden: fixed.q(".message-toast").hidden };

  const keep = session();
  keep.build({ ...base });
  await tick();
  keep.footer.post({ kind: "done", text: "Saved a" });
  keep.build({ ...base, baseline: "{nope" });
  keep.build({ ...base });
  await tick();
  facts.eventSurvivesRescan = keep.rows();

  const dels = session({ files: { a: viewText([pick("app/hub.py"), pick("gone/a.py")], "cur1234"), b: viewText([pick("app/a.py"), pick("gone/b.py")], "cur1234") } });
  dels.build({ ...base });
  await tick();
  click(dels.hostQ(".rail-views"), "rail-views");
  await tick();
  const rowOf = (name) => dels.hostAll(".views-row").find((r) => r.dataset.view === name);
  click(rowOf("a") && rowOf("a").querySelector(".views-delete"), "delete a; rows=" + dels.hostAll(".views-row").length);
  await tick();
  click(rowOf("b").querySelector(".views-delete"));
  await tick();
  facts.afterDeletes = { rows: dels.rows(), files: [...dels.port.files.keys()], undos: dels.all(".message-list .msg-act").map((n) => n.textContent) };
  const undoOf = (name) => dels.all(".message-list .msg").find((row) => row.textContent.includes("Deleted " + name)).querySelector(".msg-act");
  click(undoOf("a"));
  await tick();
  facts.afterUndoA = { files: [...dels.port.files.keys()].sort(), actionsLeft: dels.all(".message-list .msg-act").length };
  click(undoOf("b"));
  await tick();
  facts.afterUndoB = { files: [...dels.port.files.keys()].sort(), actionsLeft: dels.all(".message-list .msg-act").length, rows: dels.rows() };

  const hist = session();
  hist.build({ ...base });
  await tick();
  await hist.win.drive({ action: "add", args: ["app/hub.py"], options: {}, by: "Claude" });
  await tick();
  await hist.win.drive({ action: "add", args: ["app/a.py"], options: {}, by: "Claude" });
  await tick();
  facts.history = { rows: hist.rows(), actions: hist.all(".message-list .msg").map((row) => row.querySelector(".msg-act") ? row.querySelector(".msg-act").textContent : null) };

  const bad = session({ files: { ok: viewText([pick("app/hub.py")], "cur1234") }, views: { listError: "no folder" } });
  bad.build({ ...base });
  await tick();
  facts.listFailed = bad.all(".message-list .msg.error").map((row) => row.textContent);

  const refused = session({ files: { ok: viewText([pick("app/hub.py")], "cur1234") }, views: { refused: ["views/x.json: unreadable"] } });
  refused.build({ ...base });
  await tick();
  facts.refused = refused.all(".message-list .msg.error").map((row) => row.textContent);

  const kept = session({ files: { ok: viewText([pick("app/hub.py")], "cur1234") }, views: { refused: ["views/x.json: unreadable"] } });
  kept.build({ ...base });
  await tick();
  kept.build({ ...base });
  facts.refusedKeptSync = kept.all(".message-list .msg.error").length;
  await tick();
  facts.refusedKept = kept.all(".message-list .msg.error").map((row) => row.textContent);

  const invalid = session({ files: { ok: viewText([pick("app/hub.py")], "cur1234") } });
  invalid.build({ ...base });
  await tick();
  invalid.port.edit("overview", "{nope");
  await tick();
  invalid.port.edit("overview", "{nope again");
  await tick();
  facts.invalid = invalid.all(".message-list .msg.error").map((row) => row.textContent);

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(chrome === undefined)("explorer messages in the tray", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "explorer-messages-look");
  }, 180000);

  it("posts an unreadable baseline once with a toast and an amber badge", () => {
    expect(f.baselineOnce.rows).toHaveLength(1);
    expect(f.baselineOnce.rows[0]).toContain("The baseline cannot be read");
    expect(f.baselineOnce.toast).toBe(true);
    expect(f.baselineOnce.quiet).toBe(false);
  });

  it("does not duplicate the baseline message on a second explorer build", () => {
    expect(f.baselineTwice).toHaveLength(1);
  });

  it("posts the baseline message again after Clear", () => {
    expect(f.baselineAfterClear).toHaveLength(1);
  });

  it("posts a scan file notice, the baseline and an unreadable overlay once each", () => {
    expect(f.three).toHaveLength(3);
    expect(f.three.join(" | ")).toContain("scan.go.json is not valid JSON");
    expect(f.three.join(" | ")).toContain("The baseline cannot be read");
    expect(f.three.join(" | ")).toContain("Overlay cov could not be read");
  });

  it("withdraws the baseline message when the baseline is fixed, with no new toast", () => {
    expect(f.afterBaselineFixed.rows).toHaveLength(2);
    expect(f.afterBaselineFixed.rows.join(" | ")).not.toContain("baseline");
    expect(f.afterBaselineFixed.toastHidden).toBe(true);
  });

  it("hides the badge once every condition is fixed", () => {
    expect(f.afterAllFixed.rows).toEqual([]);
    expect(f.afterAllFixed.badgeHidden).toBe(true);
    expect(f.afterAllFixed.toastHidden).toBe(true);
  });

  it("keeps an event message across rescans while conditions come and go", () => {
    expect(f.eventSurvivesRescan).toEqual(["Saved a"]);
  });

  it("gives each deletion its own Undo that restores that view once, in any order", () => {
    expect(f.afterDeletes.files).toEqual([]);
    expect(f.afterDeletes.undos).toEqual(["Undo", "Undo"]);
    expect(f.afterUndoA.files).toEqual(["a"]);
    expect(f.afterUndoA.actionsLeft).toBe(1);
    expect(f.afterUndoB.files).toEqual(["a", "b"]);
    expect(f.afterUndoB.actionsLeft).toBe(0);
    expect(f.afterUndoB.rows).toEqual(["Deleted b", "Deleted a"]);
  });

  it("keeps only the newest history message's Undo", () => {
    expect(f.history.rows).toHaveLength(2);
    expect(f.history.actions).toEqual(["Undo", null]);
  });

  it("posts a failed view list as a keyed error", () => {
    expect(f.listFailed).toHaveLength(1);
    expect(f.listFailed[0]).toContain("Could not list saved views");
    expect(f.listFailed[0]).toContain("no folder");
  });

  it("keeps a refused view list message through a rebuild", () => {
    expect(f.refusedKeptSync).toBe(1);
    expect(f.refusedKept).toHaveLength(1);
    expect(f.refusedKept[0]).toContain("views/x.json: unreadable");
  });

  it("posts a refused view file as an error", () => {
    expect(f.refused).toHaveLength(1);
    expect(f.refused[0]).toContain("views/x.json: unreadable");
  });
});
