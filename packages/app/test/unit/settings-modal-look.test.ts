import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { collectFacts, here, webkit } from "../../src/look-page";
import { paneSources } from "../fixtures";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { openSettingsModal } from ${JSON.stringify(here("settings-modal-view.ts"))};
import { fakeSettingsModal } from ${JSON.stringify(here("settings-modal-fake.ts"))};
import schema from ${JSON.stringify(here("../../../fixtures/sensors/config-keys.json"))};

const CONFIG = "sensors:\\n  structure:\\n    warnings:\\n      long_function:\\n        limit: 30\\n    duplication:\\n      min_lines: 6\\ntests:\\n  - name: unit\\n    language: python\\n    directory: packages/core\\n";
const plugins = ${JSON.stringify(paneSources())};
const sensors = (config) => ({ inputs: async () => ({ configText: config, config: null, configProblem: null, registeredSensors: [], policy: null, policyProblem: null, baseline: null, baselineProblem: null, refused: [] }), sensorList: async () => ({ status: "ok", sensors: [] }) });
const box = (node) => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
const text = (nodes) => [...nodes].map((n) => n.textContent);
const change = (node, value) => { node.value = value; node.dispatchEvent(new Event("change", { bubbles: true })); };
const facts = {};

(async () => {
  const port = fakeSettingsModal({ config: CONFIG, schema, plugins });
  const modal = openSettingsModal({ port, sensors: sensors(CONFIG), repository: true });
  facts.loading = { pane: modal.element.querySelector(".sm-pane").textContent, saveDisabled: modal.element.querySelector(".sm-foot .primary").disabled };
  await modal.ready;
  facts.loaded = modal.element.querySelector(".sm-loading") === null;
  const q = (selector) => modal.element.querySelector(selector);
  const qa = (selector) => modal.element.querySelectorAll(selector);
  const pick = (id) => q('[data-section="' + id + '"]').click();
  const rowOf = (key) => q('[data-key="' + key + '"]').closest(".sm-field");
  const resetOf = (row) => { const node = row.querySelector(".sm-reset"); const style = getComputedStyle(node); return { visibility: style.visibility, width: node.getBoundingClientRect().width, title: node.title }; };

  facts.groups = [...qa(".sm-group")].map((n) => n.firstChild.textContent);
  facts.entries = text(qa(".sm-entry"));
  facts.editorWhere = q(".sm-where").textContent;
  facts.appLabels = text(qa(".sm-name"));
  facts.editorPlaceholder = q('input[name="editor"]').placeholder;
  pick("describing");
  facts.describing = { labels: text(qa(".sm-name")), values: [...qa("input")].map((n) => n.value), units: text(qa(".sm-unit")) };
  facts.dots = Object.fromEntries([...qa(".sm-entry")].map((n) => [n.dataset.section, n.classList.contains("changed")]));

  const geometry = () => ({ window: { width: innerWidth, height: innerHeight }, modal: box(q(".settings-modal")), nav: box(q(".sm-nav")), pane: box(q(".sm-pane")), foot: box(q(".sm-foot")), save: box(q(".sm-foot .primary")) });
  facts.geometry = geometry();
  facts.footerStart = { text: q(".sm-message").textContent, saveDisabled: q(".sm-foot .primary").disabled };

  pick("structure");
  facts.structureWhere = q(".sm-where").textContent;
  facts.structure = {
    sections: text(qa(".sm-section")),
    rows: text(qa(".sm-name")),
    changedRows: text(qa(".sm-field.changed .sm-name")),
    resetTitles: [...qa(".sm-field.changed .sm-reset")].map((n) => n.title),
    amber: [...qa("input.changed")].map((n) => n.dataset.key),
    cycle: resetOf(rowOf("sensors.structure.warnings.cycle")),
    cycleText: rowOf("sensors.structure.warnings.cycle").textContent,
    nodes: resetOf(rowOf("sensors.structure.duplication.min_nodes")),
  };

  const limitRow = rowOf("sensors.structure.warnings.long_function.limit");
  facts.limit = { onDisabled: limitRow.querySelector("input").disabled, hasSwitch: limitRow.querySelector(".sm-switch") !== null };
  limitRow.querySelector(".sm-switch").click();
  facts.limit.offDisabled = rowOf("sensors.structure.warnings.long_function.limit").querySelector("input").disabled;
  facts.limit.offTitle = rowOf("sensors.structure.warnings.long_function.limit").querySelector(".sm-reset").title;
  rowOf("sensors.structure.warnings.long_function.limit").querySelector(".sm-switch").click();

  const nodesBefore = box(rowOf("sensors.structure.duplication.min_nodes"));
  change(q('input[name="sensors.structure.duplication.min_nodes"]'), "33");
  const nodesAfter = box(rowOf("sensors.structure.duplication.min_nodes"));
  facts.rowHeight = { before: nodesBefore.height, after: nodesAfter.height, resetAfter: resetOf(rowOf("sensors.structure.duplication.min_nodes")), amber: q('input[name="sensors.structure.duplication.min_nodes"]').classList.contains("changed") };
  facts.footerChanged = { text: q(".sm-message").textContent, saveDisabled: q(".sm-foot .primary").disabled };
  facts.dotsDirty = Object.fromEntries([...qa(".sm-entry")].map((n) => [n.dataset.section, n.classList.contains("changed")]));
  change(q('input[name="sensors.structure.duplication.min_nodes"]'), "20");

  const thresholdKey = "sensors.structure.duplication.threshold";
  const thresholdRow = () => rowOf(thresholdKey);
  const rowHeightBefore = box(thresholdRow()).height;
  const childrenBefore = thresholdRow().children.length;
  change(q('input[name="' + thresholdKey + '"]'), "1.5");
  facts.refused = { message: q(".sm-message").textContent, messageBad: q(".sm-message").classList.contains("bad"), refusedClass: q('input[name="' + thresholdKey + '"]').classList.contains("refused"), saveDisabled: q(".sm-foot .primary").disabled, heightSame: box(thresholdRow()).height === rowHeightBefore, childrenSame: thresholdRow().children.length === childrenBefore, errorNodes: qa(".sm-error").length };
  change(q('input[name="' + thresholdKey + '"]'), "0.9");
  facts.cleared = { refusedClass: q('input[name="' + thresholdKey + '"]').classList.contains("refused"), saveDisabled: q(".sm-foot .primary").disabled };
  change(q('input[name="' + thresholdKey + '"]'), "0.82");

  pick("crap");
  facts.crap = { rows: text(qa(".sm-name")), units: text(qa(".sm-unit")) };

  pick("mutation");
  facts.mutation = {
    rows: text(qa(".sm-name")),
    resets: [...qa(".sm-field")].map((r) => resetOf(r).visibility),
    maxMinutes: { disabled: rowOf("sensors.mutation.max_minutes").querySelector("input").disabled, placeholder: rowOf("sensors.mutation.max_minutes").querySelector("input").placeholder },
    workers: { placeholder: rowOf("sensors.mutation.max_workers").querySelector("input").placeholder },
    placeholdersFit: ["sensors.mutation.max_minutes", "sensors.mutation.max_workers"].map((key) => {
      const field = rowOf(key).querySelector("input");
      const style = getComputedStyle(field);
      const probe = document.createElement("canvas").getContext("2d");
      probe.font = style.font;
      const inner = field.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
      return probe.measureText(field.placeholder).width <= inner;
    }),
    rowHeights: ["sensors.mutation.max_minutes", "sensors.mutation.max_workers"].map((key) => rowOf(key).getBoundingClientRect().height),
  };

  facts.noResetSection = [];
  for (const id of ["editor", "describing", "setup", "structure", "suites", "crap", "mutation"]) {
    pick(id);
    facts.noResetSection.push(modal.element.textContent.includes("Reset section"));
  }

  pick("suites");
  facts.suites = { where: q(".sm-where").textContent, cards: qa("details.sm-suite").length, open: [...qa("details.sm-suite")].map((n) => n.open), summary: text(qa(".sm-suite summary")) };
  facts.suitesAdd = q(".sm-add").textContent;
  facts.savedSuite = { runner: q('[data-key="tests.unit.runner"]').value, runnerOptions: [...qa('[data-key="tests.unit.runner"] option')].map((n) => n.value), changedRows: qa(".sm-suite .sm-field.changed").length, amber: qa(".sm-suite input.changed, .sm-suite select.changed").length };
  pick("structure");
  const typedKey = "sensors.structure.duplication.min_nodes";
  const typedInput = q('input[name="' + typedKey + '"]');
  typedInput.value = "41";
  typedInput.dispatchEvent(new Event("input", { bubbles: true }));
  facts.typed = { footer: q(".sm-message").textContent, saveDisabled: q(".sm-foot .primary").disabled, amber: typedInput.classList.contains("changed"), dot: q('[data-section="structure"]').classList.contains("changed"), focusKept: q('input[name="' + typedKey + '"]') === typedInput };
  typedInput.value = "20";
  typedInput.dispatchEvent(new Event("input", { bubbles: true }));
  pick("suites");
  modal.element.querySelector('input[name="suite-name"]').value = "added";
  q(".sm-add").click();
  facts.suiteCards = text(qa(".sm-suite-name"));
  facts.suiteRows = text(qa(".sm-suite .sm-name")).slice(0, 7);

  const callsBeforeClose = port.calls.length;
  modal.close();
  facts.closedByClose = document.querySelector(".settings-scrim") === null;

  const second = openSettingsModal({ port, sensors: sensors(CONFIG), repository: true });
  await second.ready;
  second.element.querySelector('[data-section="structure"]').click();
  second.element.querySelectorAll(".sm-switch")[0].click();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  facts.escapeClosed = document.querySelector(".settings-scrim") === null;

  const third = openSettingsModal({ port, sensors: sensors(CONFIG), repository: true });
  await third.ready;
  third.element.querySelector(".sm-foot button").click();
  facts.cancelClosed = document.querySelector(".settings-scrim") === null;

  const fourth = openSettingsModal({ port, sensors: sensors(CONFIG), repository: true });
  await fourth.ready;
  fourth.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  facts.backdropClosed = document.querySelector(".settings-scrim") === null;
  facts.writesAfterDiscards = port.calls.filter((c) => c.startsWith("write")).length;
  facts.callsOnOpen = port.calls.slice(0, callsBeforeClose);

  const bare = fakeSettingsModal({ plugins });
  const none = openSettingsModal({ port: bare, sensors: sensors(null), repository: false });
  await none.ready;
  facts.noRepository = { groups: [...none.element.querySelectorAll(".sm-group")].map((n) => n.firstChild.textContent), entries: text(none.element.querySelectorAll(".sm-entry")), commands: bare.calls };
  none.close();

  const saving = fakeSettingsModal({ config: CONFIG, schema, plugins });
  const savingClosed = new Promise((resolve) => {
    const savingModal = openSettingsModal({ port: saving, sensors: sensors(CONFIG), repository: true, onClose: resolve });
    savingModal.ready.then(() => {
      savingModal.element.querySelector('[data-section="structure"]').click();
      const reset = [...savingModal.element.querySelectorAll(".sm-field.changed .sm-reset")][1];
      facts.resetPresent = reset !== undefined;
      reset.click();
      savingModal.element.querySelector(".sm-foot .primary").click();
    });
  });
  await savingClosed;
  facts.saved = { config: saving.config, closed: document.querySelector(".settings-scrim") === null };

  const held = fakeSettingsModal({ config: CONFIG, schema, plugins });
  const realWrite = held.writeRepositoryConfig.bind(held);
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  held.writeRepositoryConfig = async (...args) => { await gate; return realWrite(...args); };
  const heldClosed = new Promise((resolve) => {
    const heldModal = openSettingsModal({ port: held, sensors: sensors(CONFIG), repository: true, onClose: resolve });
    heldModal.ready.then(async () => {
      heldModal.element.querySelector('[data-section="structure"]').click();
      [...heldModal.element.querySelectorAll(".sm-field.changed .sm-reset")][1].click();
      heldModal.element.querySelector(".sm-foot .primary").click();
      await new Promise((r) => setTimeout(r, 0));
      facts.held = { config: held.config, open: document.querySelector(".settings-scrim") !== null };
      release();
    });
  });
  await heldClosed;
  facts.released = { config: held.config };

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})();
`;

const APP_HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { openSettingsModal } from ${JSON.stringify(here("settings-modal-view.ts"))};
import { fakeSettingsModal } from ${JSON.stringify(here("settings-modal-fake.ts"))};

const plugins = ${JSON.stringify(paneSources())};
const sensors = { inputs: async () => ({ configText: null, config: null, configProblem: null, registeredSensors: [], policy: null, policyProblem: null, baseline: null, baselineProblem: null, refused: [] }) };
const box = (node) => { const r = node.getBoundingClientRect(); return { name: node.tagName + "." + node.className, top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
const text = (nodes) => [...nodes].map((n) => n.textContent);
const typeInto = (node, value) => { node.value = value; node.dispatchEvent(new Event("change", { bubbles: true })); };
const facts = {};

(async () => {
  const port = fakeSettingsModal({ plugins, settings: { values: { editor: "Sublime Text", "describing.model": "opus", "describing.batch_size": "8", "describing.confirm_above_usd": "7.5", "setup.model": "sonnet" } } });
  let closed = () => {};
  const appClosed = new Promise((resolve) => { closed = resolve; });
  const modal = openSettingsModal({ port, sensors, repository: false, onClose: closed });
  await modal.ready;
  const q = (selector) => modal.element.querySelector(selector);
  const qa = (selector) => modal.element.querySelectorAll(selector);
  const pick = (id) => q('[data-section="' + id + '"]').click();

  facts.editorTitle = q(".sm-field").getAttribute("title");
  facts.filledEditor = q('input[name="editor"]').value;
  facts.groupLabel = { transform: getComputedStyle(q(".sm-group")).textTransform, size: parseFloat(getComputedStyle(q(".sm-group")).fontSize), bodySize: parseFloat(getComputedStyle(q(".sm-name")).fontSize), color: getComputedStyle(q(".sm-group")).color, fg: getComputedStyle(q(".sm-name")).color };
  facts.editorLayout = { rows: [...qa(".sm-field")].map(box), pane: box(q(".sm-pane")), unit: text(qa(".sm-unit")) };

  pick("describing");
  facts.describingTitle = [...qa(".sm-field")].map((n) => n.getAttribute("title"));
  facts.filledDescribing = { model: q('input[name="describing.model"]').value, batch: q('input[name="describing.batch_size"]').value, confirm: q('input[name="describing.confirm_above_usd"]').value };

  const controls = [...qa("input")];
  const labels = [...qa(".sm-name")];
  const cs = (node) => getComputedStyle(node);
  facts.layout = {
    controlLefts: controls.map((n) => Math.round(n.getBoundingClientRect().left)),
    labelWraps: labels.map((n) => n.getBoundingClientRect().height > parseFloat(cs(n).lineHeight) * 1.5 || n.scrollWidth > n.clientWidth),
    modelWidth: q('input[name="describing.model"]').getBoundingClientRect().width,
    batchWidth: q('input[name="describing.batch_size"]').getBoundingClientRect().width,
    askWidth: q('input[name="describing.confirm_above_usd"]').getBoundingClientRect().width,
    units: [...qa(".sm-unit")].map((n) => { const i = n.previousElementSibling.getBoundingClientRect(); const u = n.getBoundingClientRect(); return { sameLine: Math.abs((u.top + u.bottom) / 2 - (i.top + i.bottom) / 2) < 6, after: u.left >= i.right }; }),
  };
  const stack = (parent) => [...parent.children].map(box);
  facts.stacks = [stack(q(".sm-pane"))];
  facts.nested = [box(q(".sm-pane"))].map((parent) => ({ parent, children: [...qa(".sm-field")].map(box) }));
  facts.covers = [...qa(".sm-field")].map((row) => {
    const r = row.getBoundingClientRect();
    const parts = [...row.querySelectorAll(".sm-name, input, .sm-unit, .sm-reset")].map((n) => n.getBoundingClientRect());
    return { height: r.height, coversContents: parts.every((p) => p.top >= r.top - 0.5 && p.bottom <= r.bottom + 0.5), cursor: cs(row).cursor };
  });

  typeInto(q('input[name="describing.batch_size"]'), "17");
  const message = q(".sm-message");
  facts.errorShown = { text: message.textContent, role: message.getAttribute("role"), color: cs(message).color, unitColor: cs(q(".sm-unit")).color, oneLine: Math.round(message.getBoundingClientRect().height), refused: q('input[name="describing.batch_size"]').classList.contains("refused") };
  facts.savedAfterInvalid = port.calls.filter((c) => c === "write_settings").length;
  facts.saveDisabledWhileInvalid = q(".sm-foot .primary").disabled;

  typeInto(q('input[name="describing.batch_size"]'), "6");
  pick("editor");
  typeInto(q('input[name="editor"]'), "  code --goto  ");

  const realWrite = port.writeSettings.bind(port);
  port.writeSettings = async () => { throw new Error("could not write the settings file: the folder is read-only or the disk is full, so the editor was not saved; check the folder permissions and try again"); };
  q(".sm-foot .primary").click();
  await new Promise((r) => setTimeout(r, 0));
  const long = q(".sm-message");
  facts.twoLine = { height: Math.round(long.getBoundingClientRect().height), clipped: long.scrollHeight > long.clientHeight, bottom: long.getBoundingClientRect().bottom, footBottom: q(".sm-foot").getBoundingClientRect().bottom };
  port.writeSettings = realWrite;
  q(".sm-foot .primary").click();
  await appClosed;
  facts.saved = port.settings;
  facts.closedAfterSave = document.querySelector(".settings-scrim") === null;

  const cancelPort = fakeSettingsModal({ plugins });
  const cancelling = openSettingsModal({ port: cancelPort, sensors, repository: false });
  await cancelling.ready;
  typeInto(cancelling.element.querySelector('input[name="editor"]'), "vim");
  cancelling.element.querySelector(".sm-foot button").click();
  facts.cancelWrites = cancelPort.calls.filter((c) => c.startsWith("write")).length;

  const small = openSettingsModal({ port: fakeSettingsModal({ plugins }), sensors, repository: false });
  await small.ready;
  const modalBox = box(small.element.querySelector(".settings-modal"));
  const saveBox = box(small.element.querySelector(".sm-foot .primary"));
  facts.save = { bottom: saveBox.bottom, modalBottom: modalBox.bottom, footHeight: box(small.element.querySelector(".sm-foot")).height };

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})();
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(webkit === undefined)("the settings modal", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "settings-modal-look", "bare");
  }, scaledTimeout(180000));

  it("shows a This Mac group with the editor, describing and setup panes, labels, units and buttons", () => {
    expect(f.groups).toEqual(["This Mac", "This repository"]);
    expect(f.entries.slice(0, 3)).toEqual(["Editor", "Describing", "Setup"]);
    expect(f.appLabels).toEqual(["Open files in"]);
    expect(f.editorPlaceholder).toBe("System default");
    expect(f.editorWhere).toBe(
      "Stored for this Mac; applies to every repository.",
    );
    expect(f.describing.labels).toEqual([
      "Model",
      "Batch size",
      "Ask before spending over",
    ]);
    expect(f.describing.values).toEqual(["haiku", "4", "5"]);
    expect(f.describing.units).toEqual(["files at a time", "USD"]);
  });

  it("shows a loading state with Save disabled until the panes arrive", () => {
    expect(f.loading.pane).toBe("Loading settings...");
    expect(f.loading.saveDisabled).toBe(true);
    expect(f.loaded).toBe(true);
  });

  it("shows no runner for a suite that sets none and no amber or reset on a saved suite field", () => {
    expect(f.savedSuite.runner).toBe("");
    expect(f.savedSuite.runnerOptions[0]).toBe("");
    expect(f.savedSuite.changedRows).toBe(0);
    expect(f.savedSuite.amber).toBe(0);
  });

  it("counts a typed number on input, before it loses focus", () => {
    expect(f.typed.footer).toContain("1 unsaved change");
    expect(f.typed.saveDisabled).toBe(false);
    expect(f.typed.amber).toBe(true);
    expect(f.typed.dot).toBe(true);
    expect(f.typed.focusKept).toBe(true);
  });

  it("lists the repository sections that follow what is installed", () => {
    expect(f.entries).toEqual([
      "Editor",
      "Describing",
      "Setup",
      "Structural analysis",
      "C.R.A.P.",
      "Mutation",
      "Test suites",
    ]);
  });

  it("fits the modal within the window with the sidebar and pane side by side and the footer inside", () => {
    const g = f.geometry;

    expect(g.modal.left).toBeGreaterThanOrEqual(0);
    expect(g.modal.right).toBeLessThanOrEqual(g.window.width);
    expect(g.modal.top).toBeGreaterThanOrEqual(0);
    expect(g.modal.bottom).toBeLessThanOrEqual(g.window.height);
    expect(g.nav.right).toBeLessThanOrEqual(g.pane.left + 0.5);
    expect(Math.abs(g.nav.top - g.pane.top)).toBeLessThan(1);
    expect(g.foot.top).toBeGreaterThanOrEqual(g.pane.bottom - 0.5);
    expect(g.foot.bottom).toBeLessThanOrEqual(g.modal.bottom + 0.5);
    expect(g.save.bottom).toBeLessThanOrEqual(g.foot.bottom + 0.5);
    expect(g.save.top).toBeGreaterThanOrEqual(g.foot.top - 0.5);
  });

  it("shows a changed field's amber border and a reset whose title names the default", () => {
    expect(f.structureWhere).toBe(
      "Saved in .recognizer/config.yaml; findings follow on your next scan.",
    );
    expect(f.structure.sections).toEqual(["Warnings", "Limits", "Duplication"]);
    expect(f.structure.rows).toEqual([
      "Import cycles",
      "Orphan files",
      "Private imports",
      "Unused exports",
      "Long function",
      "Complexity",
      "Similarity",
      "Fewest lines compared",
      "Shorter of a pair",
      "Fewest syntax nodes",
    ]);
    expect(f.structure.changedRows).toEqual([
      "Long function",
      "Fewest lines compared",
    ]);
    expect(f.structure.resetTitles).toEqual([
      "Reset to 20 lines",
      "Reset to 4 lines",
    ]);
    expect(f.structure.amber).toEqual([
      "sensors.structure.warnings.long_function.limit",
      "sensors.structure.duplication.min_lines",
    ]);
  });

  it("holds a reserved reset cell so a row never changes height, and a toggle shows no default and no reset", () => {
    expect(f.structure.nodes.visibility).toBe("hidden");
    expect(f.structure.nodes.width).toBeGreaterThan(0);
    expect(f.structure.cycle.visibility).toBe("hidden");
    expect(f.structure.cycle.width).toBeGreaterThan(0);
    expect(f.structure.cycleText).not.toMatch(/default|reset/i);
    expect(f.rowHeight.after).toBe(f.rowHeight.before);
    expect(f.rowHeight.amber).toBe(true);
    expect(f.rowHeight.resetAfter.visibility).toBe("visible");
    expect(f.rowHeight.resetAfter.title).toBe("Reset to 20 nodes");
  });

  it("disables a limit's number when its toggle is off", () => {
    expect(f.limit.hasSwitch).toBe(true);
    expect(f.limit.onDisabled).toBe(false);
    expect(f.limit.offDisabled).toBe(true);
    expect(f.limit.offTitle).toBe("Reset to 20 lines");
  });

  it("marks a changed section in the sidebar and no unchanged one", () => {
    expect(Object.values(f.dots)).toEqual(Array(7).fill(false));
    expect(f.dotsDirty.structure).toBe(true);
    expect(f.dotsDirty.crap).toBe(false);
    expect(f.dotsDirty.mutation).toBe(false);
    expect(f.dotsDirty.describing).toBe(false);
  });

  it("counts unsaved changes in the footer and disables Save with none", () => {
    expect(f.footerStart).toEqual({ text: "No changes.", saveDisabled: true });
    expect(f.footerChanged.text).toContain("1 unsaved change.");
    expect(f.footerChanged.text).toContain(
      "Repository changes take effect on your next scan.",
    );
    expect(f.footerChanged.saveDisabled).toBe(false);
  });

  it("shows a refused value's reason in the footer, marks the field red and disables Save", () => {
    expect(f.refused.message).toContain("above the maximum 1");
    expect(f.refused.message).toContain("Fix the value");
    expect(f.refused.messageBad).toBe(true);
    expect(f.refused.refusedClass).toBe(true);
    expect(f.refused.saveDisabled).toBe(true);
    expect(f.refused.heightSame).toBe(true);
    expect(f.refused.childrenSame).toBe(true);
    expect(f.refused.errorNodes).toBe(0);
    expect(f.cleared.refusedClass).toBe(false);
    expect(f.cleared.saveDisabled).toBe(false);
  });

  it("names a default text in the reset title and shows no reset for an unset field", () => {
    expect(f.mutation.rows).toEqual([
      "Only what changed",
      "Timeout",
      "Stop a run after",
      "Workers",
    ]);
    expect(f.mutation.resets).toEqual(["hidden", "hidden", "hidden", "hidden"]);
    expect(f.mutation.maxMinutes.disabled).toBe(true);
    expect(f.mutation.maxMinutes.placeholder).toContain("no time budget");
    expect(f.mutation.workers.placeholder).toContain(
      "half the machine's cores",
    );
    expect(f.mutation.placeholdersFit).toEqual([true, true]);
    expect(f.mutation.rowHeights[0]).toBe(f.mutation.rowHeights[1]);
    expect(f.crap.rows).toEqual(["Report above", "Report coverage below"]);
    expect(f.crap.units).toEqual(["score", "0 to 1"]);
  });

  it("shows collapsible suite cards with the language and folder in the header", () => {
    expect(f.suites.where).toBe(
      "Saved in .recognizer/config.yaml; findings follow on your next scan.",
    );
    expect(f.suites.cards).toBe(1);
    expect(f.suites.open).toEqual([false]);
    expect(f.suites.summary[0]).toContain("unit");
    expect(f.suites.summary[0]).toContain("python");
    expect(f.suites.summary[0]).toContain("packages/core");
  });

  it("adds a suite card from the Add a test suite action", () => {
    expect(f.suitesAdd).toBe("Add a test suite");
    expect(f.suiteCards).toEqual(["unit", "added"]);
    expect(f.suiteRows).toEqual([
      "Language",
      "Directory",
      "Command",
      "Activate",
      "Runner",
      "Coverage report",
      "Coverage format",
    ]);
  });

  it("has no Reset section text anywhere in the modal", () => {
    expect(f.noResetSection.every((found: boolean) => !found)).toBe(true);
  });

  it("closes on Escape, Cancel, the backdrop and close with no write call", () => {
    expect(f.closedByClose).toBe(true);
    expect(f.escapeClosed).toBe(true);
    expect(f.cancelClosed).toBe(true);
    expect(f.backdropClosed).toBe(true);
    expect(f.writesAfterDiscards).toBe(0);
  });

  it("shows only the This Mac group with no repository and calls no repository command", () => {
    expect(f.noRepository.groups).toEqual(["This Mac"]);
    expect(f.noRepository.entries).toEqual(["Editor", "Describing", "Setup"]);
    expect(f.noRepository.commands).toEqual(["read_settings", "read_panes"]);
  });

  it("holds the old config until a pending write lands, then removes the key", () => {
    expect(f.held.open).toBe(true);
    expect(f.held.config).toContain("min_lines");
    expect(f.released.config).not.toContain("min_lines");
    expect(f.released.config).toContain("limit: 30");
  });

  it("saves a reset as a removal of the key and closes", () => {
    expect(f.resetPresent).toBe(true);
    expect(f.saved.config).not.toContain("min_lines");
    expect(f.saved.config).toContain("limit: 30");
    expect(f.saved.closed).toBe(true);
  });
});

describe.skipIf(webkit === undefined)("the settings modal's App group", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(
      APP_HARNESS,
      "settings-modal-app-look",
      "bare",
    );
  }, scaledTimeout(180000));

  it("puts the long explanations behind info icons", () => {
    expect(f.editorTitle).toContain("{file} and {line}");
    expect(f.describingTitle).toHaveLength(3);
    expect(f.describingTitle[0]).toContain("the model every description uses");
    expect(f.describingTitle[2]).toContain("estimated cost");
  });

  it("fills the fields from the loaded settings", () => {
    expect(f.filledEditor).toBe("Sublime Text");
    expect(f.filledDescribing).toEqual({
      model: "opus",
      batch: "8",
      confirm: "7.5",
    });
  });

  it("shows an error line as an alert in the error colour", () => {
    expect(f.errorShown.text).toContain("maximum");
    expect(f.errorShown.role).toBe("alert");
    expect(f.errorShown.refused).toBe(true);
    expect(f.errorShown.color).not.toBe(f.errorShown.unitColor);
  });

  it("saves the trimmed values and cancels without saving", () => {
    expect(f.saved).toEqual({
      values: {
        editor: "code --goto",
        "describing.model": "opus",
        "describing.batch_size": "6",
        "describing.confirm_above_usd": "7.5",
        "setup.model": "sonnet",
      },
    });
    expect(f.closedAfterSave).toBe(true);
    expect(f.savedAfterInvalid).toBe(0);
    expect(f.saveDisabledWhileInvalid).toBe(true);
    expect(f.cancelWrites).toBe(0);
  });

  it("starts every control on one left edge and wraps no label", () => {
    expect(new Set(f.layout.controlLefts).size).toBe(1);
    expect(f.layout.labelWraps).toEqual([false, false, false]);
  });

  it("sizes the fields: text fields wide, number fields narrow with their unit after them on the same line", () => {
    expect(f.layout.modelWidth).toBeGreaterThan(f.layout.batchWidth * 2);
    expect(f.layout.batchWidth).toBe(f.layout.askWidth);
    for (const unit of f.layout.units) {
      expect(unit).toEqual({ sameLine: true, after: true });
    }
  });

  it("styles a section label as small uppercase muted text", () => {
    expect(f.groupLabel.transform).toBe("uppercase");
    expect(f.groupLabel.size).toBeLessThan(f.groupLabel.bodySize);
    expect(f.groupLabel.color).not.toBe(f.groupLabel.fg);
  });

  it("stacks each section's parts one below the next without overlap", () => {
    expect(f.stacks.length).toBeGreaterThan(0);

    for (const parts of f.stacks) {
      for (let index = 1; index < parts.length; index += 1) {
        expect(
          parts[index].top,
          `${parts[index].name} overlaps ${parts[index - 1].name}`,
        ).toBeGreaterThanOrEqual(parts[index - 1].bottom - 0.5);
      }
    }
  });

  it("keeps each row inside its group, and the group's border encloses the rows' contents", () => {
    expect(f.nested[0].children.length).toBeGreaterThan(0);

    for (const { parent, children } of f.nested) {
      for (const child of children) {
        expect(
          child.top,
          `${child.name} above ${parent.name}`,
        ).toBeGreaterThanOrEqual(parent.top - 0.5);
        expect(
          child.bottom,
          `${child.name} below ${parent.name}`,
        ).toBeLessThanOrEqual(parent.bottom + 0.5);
      }
    }
  });

  it("sizes each setting row to cover its contents and applies no tree-row style", () => {
    expect(f.covers.length).toBeGreaterThan(0);

    for (const cover of f.covers) {
      expect(cover.coversContents).toBe(true);
      expect(cover.height).toBeGreaterThan(26);
      expect(cover.cursor).not.toBe("pointer");
    }
  });

  it("gives the error room for two lines", () => {
    expect(f.twoLine.height).toBeGreaterThanOrEqual(f.errorShown.oneLine);
    expect(f.twoLine.clipped).toBe(false);
    expect(f.twoLine.bottom).toBeLessThanOrEqual(f.twoLine.footBottom + 0.5);
  });

  it("keeps the Save button fully inside the modal with a margin below it", () => {
    expect(f.save.footHeight).toBeGreaterThan(0);
    expect(f.save.modalBottom - f.save.bottom).toBeGreaterThanOrEqual(8);
  });
});
