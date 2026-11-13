import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, here, webkit } from "./look-page";
import { CONFIRM_INFO, EDITOR_INFO, MODEL_INFO } from "./settings-modal-view";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { openSettingsModal } from ${JSON.stringify(here("settings-modal-view.ts"))};
import { fakeSettingsModal } from ${JSON.stringify(here("settings-modal-fake.ts"))};
import schema from ${JSON.stringify(here("../../fixtures/sensors/config-keys.json"))};

const CONFIG = "sensors:\\n  structure:\\n    warnings:\\n      long_function:\\n        limit: 30\\n    duplication:\\n      min_lines: 6\\n";
const shipped = ["crap", "mutation", "thresholds"].map((name) => ({ name, display: name, line: "", defaults: {}, runsTests: name !== "thresholds", listed: true }));
const sensors = (config) => ({ readInputs: async () => ({ policy: null, config, baseline: null, refused: [] }), shipped: async () => ({ status: "ok", sensors: shipped }) });
const box = (node) => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
const text = (nodes) => [...nodes].map((n) => n.textContent);
const change = (node, value) => { node.value = value; node.dispatchEvent(new Event("change", { bubbles: true })); };
const facts = {};

(async () => {
  const port = fakeSettingsModal({ config: CONFIG, schema, settings: { editor: "", describing: { model: "haiku", batchSize: 4, confirmAboveUsd: 5 } } });
  const modal = openSettingsModal({ port, sensors: sensors(CONFIG), repository: true });
  await modal.ready;
  const q = (selector) => modal.element.querySelector(selector);
  const qa = (selector) => modal.element.querySelectorAll(selector);

  facts.groups = [...qa(".sm-group")].map((n) => n.firstChild.textContent);
  facts.entries = text(qa(".sm-entry"));
  facts.appLabels = text(qa(".sm-name"));
  facts.editorPlaceholder = q('input[name="editor"]').placeholder;
  q('[data-section="describing"]').click();
  facts.describing = { labels: text(qa(".sm-name")), values: [...qa("input")].map((n) => n.value) };
  facts.dots = Object.fromEntries([...qa(".sm-entry")].map((n) => [n.dataset.section, n.classList.contains("changed")]));

  const geometry = () => ({ window: { width: innerWidth, height: innerHeight }, modal: box(q(".settings-modal")), nav: box(q(".sm-nav")), pane: box(q(".sm-pane")), foot: box(q(".sm-foot")), save: box(q(".sm-foot .primary")) });
  facts.geometry = geometry();

  q('[data-section="structure"]').click();
  facts.structure = {
    resetCount: qa(".sm-default .sm-link").length,
    defaults: text(qa(".sm-default")).map((t) => t.replace("Reset", "")),
    rows: text(qa(".sm-name")),
    sectionReset: q(".sm-title .sm-link").disabled,
  };

  q('[data-section="duplication"]').click();
  facts.duplication = { resetCount: qa(".sm-default .sm-link").length, defaults: text(qa(".sm-default")).map((t) => t.replace("Reset", "")), values: [...qa("input")].map((n) => n.value) };
  change(q('input[name="sensors.structure.duplication.threshold"]'), "1.5");
  facts.refused = { error: q(".sm-error").textContent, role: q(".sm-error").getAttribute("role"), saveDisabled: q(".sm-foot .primary").disabled, errorBelowInput: q(".sm-error").getBoundingClientRect().top >= q('input[name="sensors.structure.duplication.threshold"]').getBoundingClientRect().bottom - 0.5, message: q(".sm-message").textContent };
  change(q('input[name="sensors.structure.duplication.threshold"]'), "0.9");
  facts.cleared = { errors: qa(".sm-error").length, saveDisabled: q(".sm-foot .primary").disabled };

  q('[data-section="mutation"]').click();
  facts.mutation = { defaults: text(qa(".sm-default")), resets: qa(".sm-default .sm-link").length };

  q('[data-section="suites"]').click();
  facts.suitesAdd = q(".sm-add").textContent;
  modal.element.querySelector('input[name="suite-name"]').value = "unit";
  q(".sm-add").click();
  facts.suiteCards = text(qa(".sm-card-head")).slice(0, 1);

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

  const bare = fakeSettingsModal({});
  const none = openSettingsModal({ port: bare, sensors: sensors(null), repository: false });
  await none.ready;
  facts.noRepository = { groups: [...none.element.querySelectorAll(".sm-group")].map((n) => n.firstChild.textContent), entries: text(none.element.querySelectorAll(".sm-entry")), commands: bare.calls };
  none.close();

  const saving = fakeSettingsModal({ config: CONFIG, schema });
  const savingModal = openSettingsModal({ port: saving, sensors: sensors(CONFIG), repository: true });
  await savingModal.ready;
  savingModal.element.querySelector('[data-section="duplication"]').click();
  const reset = [...savingModal.element.querySelectorAll(".sm-default .sm-link")][0];
  facts.resetPresent = reset !== undefined;
  reset.click();
  savingModal.element.querySelector(".sm-foot .primary").click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  facts.saved = { config: saving.config, closed: document.querySelector(".settings-scrim") === null };

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})();
`;

const APP_HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { openSettingsModal } from ${JSON.stringify(here("settings-modal-view.ts"))};
import { fakeSettingsModal } from ${JSON.stringify(here("settings-modal-fake.ts"))};

const sensors = { readInputs: async () => ({ policy: null, config: null, baseline: null, refused: [] }), shipped: async () => ({ status: "ok", sensors: [] }) };
const box = (node) => { const r = node.getBoundingClientRect(); return { name: node.tagName + "." + node.className, top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
const text = (nodes) => [...nodes].map((n) => n.textContent);
const typeInto = (node, value) => { node.value = value; node.dispatchEvent(new Event("input", { bubbles: true })); };
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const facts = {};

(async () => {
  const port = fakeSettingsModal({ settings: { editor: "Sublime Text", describing: { model: "opus", batchSize: 8, confirmAboveUsd: 7.5 } } });
  const modal = openSettingsModal({ port, sensors, repository: false });
  await modal.ready;
  const q = (selector) => modal.element.querySelector(selector);
  const qa = (selector) => modal.element.querySelectorAll(selector);
  const pick = (id) => q('[data-section="' + id + '"]').click();

  facts.editorTitle = q(".sm-card").getAttribute("title");
  facts.filledEditor = q('input[name="editor"]').value;
  facts.groupLabel = { transform: getComputedStyle(q(".sm-group")).textTransform, size: parseFloat(getComputedStyle(q(".sm-group")).fontSize), bodySize: parseFloat(getComputedStyle(q(".sm-name")).fontSize), color: getComputedStyle(q(".sm-group")).color, fg: getComputedStyle(q(".sm-name")).color };
  facts.editorLayout = { rows: [...qa(".sm-field")].map(box), card: box(q(".sm-card")), unit: text(qa(".sm-unit")) };

  pick("describing");
  facts.describingTitle = q(".sm-card").getAttribute("title");
  facts.filledDescribing = { model: q('input[name="model"]').value, batch: q('input[name="batch_size"]').value, confirm: q('input[name="confirm_above_usd"]').value };

  const controls = [...qa("input")];
  const labels = [...qa(".sm-name")];
  const cs = (node) => getComputedStyle(node);
  facts.layout = {
    controlLefts: controls.map((n) => Math.round(n.getBoundingClientRect().left)),
    labelWraps: labels.map((n) => n.getBoundingClientRect().height > parseFloat(cs(n).lineHeight) * 1.5 || n.scrollWidth > n.clientWidth),
    modelWidth: q('input[name="model"]').getBoundingClientRect().width,
    batchWidth: q('input[name="batch_size"]').getBoundingClientRect().width,
    askWidth: q('input[name="confirm_above_usd"]').getBoundingClientRect().width,
    units: [...qa(".sm-unit")].map((n) => { const i = n.previousElementSibling.getBoundingClientRect(); const u = n.getBoundingClientRect(); return { sameLine: Math.abs((u.top + u.bottom) / 2 - (i.top + i.bottom) / 2) < 6, after: u.left >= i.right }; }),
  };
  const stack = (parent) => [...parent.children].map(box);
  facts.stacks = [stack(q(".sm-pane")), stack(q(".sm-card"))];
  facts.nested = [box(q(".sm-card"))].map((parent) => ({ parent, children: [...qa(".sm-field")].map(box) }));
  facts.covers = [...qa(".sm-field")].map((row) => {
    const r = row.getBoundingClientRect();
    const parts = [...row.querySelectorAll(".sm-name, input, .sm-unit, .sm-default")].map((n) => n.getBoundingClientRect());
    return { height: r.height, coversContents: parts.every((p) => p.top >= r.top - 0.5 && p.bottom <= r.bottom + 0.5), cursor: cs(row).cursor };
  });

  typeInto(q('input[name="batch_size"]'), "17");
  const error = q(".sm-error");
  facts.errorShown = { text: error.textContent, role: error.getAttribute("role"), color: cs(error).color, unitColor: cs(q(".sm-unit")).color, oneLine: Math.round(error.getBoundingClientRect().height) };
  facts.savedAfterInvalid = port.calls.filter((c) => c === "write_settings").length;
  facts.saveDisabledWhileInvalid = q(".sm-foot .primary").disabled;

  q(".sm-error").textContent = "could not write the settings file: the folder is read-only or the disk is full, so the editor was not saved; check the folder permissions and try again";
  const long = q(".sm-error");
  facts.twoLine = { height: Math.round(long.getBoundingClientRect().height), clipped: long.scrollHeight > long.clientHeight, bottom: long.getBoundingClientRect().bottom, paneBottom: q(".sm-pane").getBoundingClientRect().bottom };
  typeInto(q('input[name="batch_size"]'), "6");
  pick("editor");
  typeInto(q('input[name="editor"]'), "  code --goto  ");
  q(".sm-foot .primary").click();
  await settle();
  facts.saved = port.settings;
  facts.closedAfterSave = document.querySelector(".settings-scrim") === null;

  const cancelPort = fakeSettingsModal({});
  const cancelling = openSettingsModal({ port: cancelPort, sensors, repository: false });
  await cancelling.ready;
  typeInto(cancelling.element.querySelector('input[name="editor"]'), "vim");
  cancelling.element.querySelector(".sm-foot button").click();
  facts.cancelWrites = cancelPort.calls.filter((c) => c.startsWith("write")).length;

  const small = openSettingsModal({ port: fakeSettingsModal({}), sensors, repository: false });
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

  it("shows an App group with Editor and Describing, labels, units and buttons", () => {
    expect(f.groups).toEqual(["App", "Repository"]);
    expect(f.entries.slice(0, 2)).toEqual(["Editor", "Describing"]);
    expect(f.appLabels).toEqual(["Open files in"]);
    expect(f.editorPlaceholder).toBe("System default");
    expect(f.describing.labels).toEqual(["Model", "Batch size", "Ask above"]);
    expect(f.describing.values).toEqual(["haiku", "4", "5.00"]);
  });

  it("lists the repository sections that follow what is shipped", () => {
    expect(f.entries).toEqual([
      "Editor",
      "Describing",
      "Structure",
      "Duplication",
      "C.R.A.P.",
      "Complexity and coverage",
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

  it("shows a changed field's default and Reset beside it", () => {
    expect(f.structure.resetCount).toBeGreaterThan(0);
    expect(f.structure.defaults).toEqual(["default 20"]);
    expect(f.duplication.resetCount).toBeGreaterThan(0);
    expect(f.duplication.defaults).toEqual(["default 4"]);
    expect(f.duplication.values[0]).toBe("0.82");
  });

  it("marks a changed section in the sidebar and no unchanged one", () => {
    expect(f.dots.structure).toBe(true);
    expect(f.dots.duplication).toBe(true);
    expect(f.dots.crap).toBe(false);
    expect(f.dots.mutation).toBe(false);
  });

  it("shows a refused value's reason under its field and disables Save", () => {
    expect(f.refused.error).toContain("above the maximum 1");
    expect(f.refused.role).toBe("alert");
    expect(f.refused.errorBelowInput).toBe(true);
    expect(f.refused.saveDisabled).toBe(true);
    expect(f.refused.message).toContain("Fix the value");
    expect(f.cleared.errors).toBe(0);
    expect(f.cleared.saveDisabled).toBe(false);
  });

  it("shows the default text of a blank mutation field and no Reset", () => {
    expect(f.mutation.defaults).toHaveLength(2);
    expect(f.mutation.defaults[0]).toContain("no time budget");
    expect(f.mutation.defaults[1]).toContain("sized from the machine's cores");
    expect(f.mutation.resets).toBe(0);
  });

  it("adds a suite card from the Add a suite action", () => {
    expect(f.suitesAdd).toBe("+ Add a suite");
    expect(f.suiteCards).toEqual(["unit"]);
  });

  it("closes on Escape, Cancel, the backdrop and close with no write call", () => {
    expect(f.closedByClose).toBe(true);
    expect(f.escapeClosed).toBe(true);
    expect(f.cancelClosed).toBe(true);
    expect(f.backdropClosed).toBe(true);
    expect(f.writesAfterDiscards).toBe(0);
  });

  it("shows only the App group with no repository and calls no repository command", () => {
    expect(f.noRepository.groups).toEqual(["App"]);
    expect(f.noRepository.entries).toEqual(["Editor", "Describing"]);
    expect(f.noRepository.commands).toEqual(["read_settings"]);
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
    expect(f.editorTitle).toBe(EDITOR_INFO);
    expect(f.describingTitle).toBe(`${MODEL_INFO} ${CONFIRM_INFO}`);
    expect(f.editorTitle).toContain("{file} and {line}");
  });

  it("fills the fields from the loaded settings", () => {
    expect(f.filledEditor).toBe("Sublime Text");
    expect(f.filledDescribing).toEqual({
      model: "opus",
      batch: "8",
      confirm: "7.50",
    });
  });

  it("shows an error line as an alert in the error colour", () => {
    expect(f.errorShown.text).toContain("Batch size");
    expect(f.errorShown.role).toBe("alert");
    expect(f.errorShown.color).not.toBe(f.errorShown.unitColor);
  });

  it("saves the trimmed values and cancels without saving", () => {
    expect(f.saved).toEqual({
      editor: "code --goto",
      describing: { model: "opus", batchSize: 6, confirmAboveUsd: 7.5 },
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
    expect(f.twoLine.height).toBeGreaterThanOrEqual(f.errorShown.oneLine * 1.5);
    expect(f.twoLine.clipped).toBe(false);
    expect(f.twoLine.bottom).toBeLessThanOrEqual(f.twoLine.paneBottom + 0.5);
  });

  it("keeps the Save button fully inside the modal with a margin below it", () => {
    expect(f.save.footHeight).toBeGreaterThan(0);
    expect(f.save.modalBottom - f.save.bottom).toBeGreaterThanOrEqual(8);
  });
});
