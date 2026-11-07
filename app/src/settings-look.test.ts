import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, here, webkit } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { buildSettings } from ${JSON.stringify(here("settings-view.ts"))};

const host = document.createElement("main");
host.className = "settings";
host.style.width = "480px";
document.body.append(host);

const saved = [];
let cancels = 0;
const view = buildSettings(host, { save: (values) => saved.push(values), cancel: () => { cancels += 1; } });
const q = (selector) => host.querySelector(selector);
const cs = (node) => getComputedStyle(node);
const facts = {};

view.fill({ editor: "", describing: { model: "haiku", batchSize: 4, confirmAboveUsd: 5 } });
facts.empty = {
  labels: [...host.querySelectorAll(".row-label")].map((n) => n.textContent),
  sections: [...host.querySelectorAll(".section-label")].map((n) => n.textContent),
  tips: [...host.querySelectorAll(".setting-tip")].map((n) => n.textContent),
  units: [...host.querySelectorAll(".unit")].map((n) => n.textContent),
  placeholders: [...host.querySelectorAll('input[type="text"]')].map((n) => n.placeholder),
  values: [...host.querySelectorAll('input[type="text"]')].map((n) => n.value),
  batch: { value: q('input[name="batch_size"]').value, min: q('input[name="batch_size"]').min, max: q('input[name="batch_size"]').max, step: q('input[name="batch_size"]').step },
  scanning: host.querySelector(".scanning, input[type=checkbox]") !== null,
  hints: [...host.querySelectorAll(".hint")].map((n) => n.textContent),
  buttons: [...host.querySelectorAll(".buttons button")].map((n) => n.textContent),
  error: q(".error").textContent,
};

view.fill({ editor: "Sublime Text", describing: { model: "opus", batchSize: 8, confirmAboveUsd: 7.5 } });
facts.filled = [...host.querySelectorAll('input[type="text"]')].map((n) => n.value);
facts.filledDescribing = { model: q('input[name="model"]').value, batch: q('input[name="batch_size"]').value, confirm: q('input[name="confirm_above_usd"]').value };

view.showError("the editor must be a single line");
facts.errorShown = {
  text: q(".error").textContent,
  role: q(".error").getAttribute("role"),
  color: cs(q(".error")).color,
  hintColor: cs(q(".hint")).color,
  height: Math.round(host.getBoundingClientRect().height),
};

host.querySelector('input[name="editor"]').value = "  code --goto  ";
q('input[name="batch_size"]').value = "17";
q("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
facts.invalidError = q(".error").textContent;
facts.savedAfterInvalid = saved.length;
q('input[name="batch_size"]').value = "6";
q("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
facts.saved = saved;
q('.buttons button[type="button"]').click();
facts.cancels = cancels;
view.showError("could not write the settings file: the folder is read-only or the disk is full, so the editor was not saved; check the folder permissions and try again");
facts.twoLineErrorHeight = Math.round(q(".error").getBoundingClientRect().height);
const save = q('.buttons button[type="submit"]').getBoundingClientRect();
facts.saveBottom = Math.round(save.bottom - host.getBoundingClientRect().top);
facts.saveBottomRaw = save.bottom - host.getBoundingClientRect().top;
const controls = [...host.querySelectorAll("input")];
const labels = [...host.querySelectorAll(".row-label")];
facts.layout = {
  controlLefts: controls.map((n) => Math.round(n.getBoundingClientRect().left)),
  labelWraps: labels.map((n) => n.getBoundingClientRect().height > parseFloat(cs(n).lineHeight) * 1.5 || n.scrollWidth > n.clientWidth),
  labelRights: labels.map((n) => Math.round(n.getBoundingClientRect().right)),
  rowTops: [...host.querySelectorAll(".setting")].map((n) => Math.round(n.getBoundingClientRect().top)),
  controlTops: controls.map((n) => n.getBoundingClientRect().top - n.closest(".setting").getBoundingClientRect().top),
  rowHeights: [...host.querySelectorAll(".setting")].map((n) => n.getBoundingClientRect().height),
  textWidth: Math.round(q('input[name="editor"]').getBoundingClientRect().width),
  modelWidth: Math.round(q('input[name="model"]').getBoundingClientRect().width),
  batchWidth: Math.round(q('input[name="batch_size"]').getBoundingClientRect().width),
  units: [...host.querySelectorAll(".unit")].map((n) => { const i = n.previousElementSibling.getBoundingClientRect(); const u = n.getBoundingClientRect(); return { sameLine: Math.abs((u.top + u.bottom) / 2 - (i.top + i.bottom) / 2) < 6, after: u.left >= i.right }; }),
  tipHidden: cs(q(".setting-tip")).display,
  info: host.querySelectorAll(".setting-info svg").length,
  sectionLabel: { transform: cs(q(".section-label")).textTransform, color: cs(q(".section-label")).color },
};
const box = (node) => { const r = node.getBoundingClientRect(); return { name: node.tagName + "." + node.className, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
const stack = (parent) => [...parent.children].map(box);
facts.stacks = [stack(q("form")), ...[...host.querySelectorAll(".group")].map(stack)];
facts.covers = [...host.querySelectorAll(".setting")].map((row) => {
  const r = row.getBoundingClientRect();
  const parts = [...row.querySelectorAll("label, input, .unit, .hint, .setting-info")].map((n) => n.getBoundingClientRect());
  return { height: r.height, coversContents: parts.every((p) => p.top >= r.top - 0.5 && p.bottom <= r.bottom + 0.5), cursor: cs(row).cursor, nowrap: cs(row).whiteSpace };
});
facts.nested = [...host.querySelectorAll(".group")].map((parent) => ({ parent: box(parent), children: stack(parent) }));
q(".setting-info").focus();
facts.tipShown = cs(q(".setting-tip")).display;
document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
`;

const outerHeight = Number(
  /const SETTINGS_HEIGHT: f64 = (\d+)/.exec(
    readFileSync(here("../src-tauri/src/lib.rs"), "utf8"),
  )?.[1],
);

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(webkit === undefined)("the settings window", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "settings-look");
  }, scaledTimeout(180000));

  it("shows an Editor and a Describing section with their labels, units, one hint and buttons", () => {
    expect(f.empty.sections).toEqual(["Editor", "Describing"]);
    expect(f.empty.labels).toEqual([
      "Open files in",
      "Model",
      "Batch size",
      "Ask above",
    ]);
    expect(f.empty.scanning).toBe(false);
    expect(f.empty.placeholders).toEqual(["System default", "haiku"]);
    expect(f.empty.values).toEqual(["", "haiku"]);
    expect(f.empty.batch).toEqual({
      value: "4",
      min: "1",
      max: "16",
      step: "1",
    });
    expect(f.empty.hints).toEqual(["An app name or a command"]);
    expect(f.empty.units).toEqual(["modules at a time", "USD per scan"]);
    expect(f.empty.buttons).toEqual(["Cancel", "Save"]);
    expect(f.empty.error).toBe("");
  });

  it("puts the long explanations behind info icons", () => {
    expect(f.empty.tips).toEqual([
      "An app name such as Sublime Text, or a command such as code -g {file}:{line}. Without {file} and {line} the file opens at the top. Terminal editors are not supported.",
      "The model every description uses, for scans started from the app and from a terminal.",
      "A scan asks before describing when its estimated cost, at API prices, is above this.",
    ]);
    expect(f.layout.info).toBe(3);
    expect(f.layout.tipHidden).toBe("none");
    expect(f.tipShown).toBe("block");
  });

  it("fills the fields from the loaded settings", () => {
    expect(f.filled).toEqual(["Sublime Text", "opus"]);
    expect(f.filledDescribing).toEqual({
      model: "opus",
      batch: "8",
      confirm: "7.50",
    });
  });

  it("shows an error line as an alert in the error colour", () => {
    expect(f.errorShown.text).toBe("the editor must be a single line");
    expect(f.errorShown.role).toBe("alert");
    expect(f.errorShown.color).not.toBe(f.errorShown.hintColor);
  });

  it("saves the trimmed values and cancels without saving", () => {
    expect(f.saved).toEqual([
      {
        editor: "code --goto",
        describing: { model: "opus", batchSize: 6, confirmAboveUsd: 7.5 },
      },
    ]);
    expect(f.invalidError).toContain("Batch size");
    expect(f.savedAfterInvalid).toBe(0);
    expect(f.cancels).toBe(1);
  });

  it("starts every control on one left edge and wraps no label", () => {
    expect(new Set(f.layout.controlLefts).size).toBe(1);
    expect(f.layout.labelWraps).toEqual([false, false, false, false]);
  });

  it("sizes the fields: text fields wide, number fields narrow with their unit after them on the same line", () => {
    expect(f.layout.textWidth).toBeGreaterThan(250);
    expect(f.layout.modelWidth).toBe(f.layout.textWidth);
    expect(f.layout.batchWidth).toBeLessThan(f.layout.textWidth / 2);
    for (const unit of f.layout.units) {
      expect(unit).toEqual({ sameLine: true, after: true });
    }
  });

  it("styles a section label as small uppercase muted text", () => {
    expect(f.layout.sectionLabel.transform).toBe("uppercase");
  });

  it("stacks each section's parts one below the next without overlap", () => {
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
    for (const cover of f.covers) {
      expect(cover.coversContents).toBe(true);
      expect(cover.height).toBeGreaterThan(26);
      expect(cover.cursor).not.toBe("pointer");
    }
  });

  it("gives the error room for two lines", () => {
    expect(f.twoLineErrorHeight).toBeGreaterThanOrEqual(30);
  });

  it("keeps the Save button fully inside the window with a margin below it", () => {
    expect(outerHeight).toBeGreaterThan(0);
    expect(f.saveBottom).toBeLessThanOrEqual(outerHeight - 16);
  });
});
