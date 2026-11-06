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

view.fill({ editor: "", describing: { model: "haiku", batchSize: 4 } });
facts.empty = {
  labels: [...host.querySelectorAll("label > span")].map((n) => n.textContent),
  placeholders: [...host.querySelectorAll('input[type="text"]')].map((n) => n.placeholder),
  values: [...host.querySelectorAll('input[type="text"]')].map((n) => n.value),
  batch: { value: q('input[name="batch_size"]').value, min: q('input[name="batch_size"]').min, max: q('input[name="batch_size"]').max, step: q('input[name="batch_size"]').step },
  describingLegend: q(".describing legend").textContent,
  scanning: host.querySelector(".scanning, input[type=checkbox]") !== null,
  hints: [...host.querySelectorAll(".hint")].map((n) => n.textContent),
  buttons: [...host.querySelectorAll(".buttons button")].map((n) => n.textContent),
  error: q(".error").textContent,
};

view.fill({ editor: "Sublime Text", describing: { model: "opus", batchSize: 8 } });
facts.filled = [...host.querySelectorAll('input[type="text"]')].map((n) => n.value);
facts.filledDescribing = { model: q('input[name="model"]').value, batch: q('input[name="batch_size"]').value };

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
facts.layout = {
  display: cs(q("form")).display,
  inputWidth: Math.round(q('input[type="text"]').getBoundingClientRect().width),
};

const box = (node) => { const r = node.getBoundingClientRect(); return { name: node.tagName + "." + node.className, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
const stack = (parent) => [...parent.children].map(box);
facts.stacks = [stack(q("form")), stack(q(".describing"))];
facts.nested = [q(".describing"), q(".describing-fields")].map((parent) => ({ parent: box(parent), children: stack(parent) }));
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

  it("shows the editor field and a Describing section with its placeholders, hints and buttons and no Scanning section", () => {
    expect(f.empty.labels).toEqual(["Editor", "Model", "Batch size"]);
    expect(f.empty.scanning).toBe(false);
    expect(f.empty.placeholders).toEqual(["System default", "haiku"]);
    expect(f.empty.values).toEqual(["", "haiku"]);
    expect(f.empty.batch).toEqual({
      value: "4",
      min: "1",
      max: "16",
      step: "1",
    });
    expect(f.empty.describingLegend).toBe("Describing");
    expect(f.empty.hints[0]).toContain("Sublime Text");
    expect(f.empty.hints[0]).toContain("Terminal editors are not supported");
    expect(f.empty.hints).toHaveLength(2);
    expect(f.empty.hints[1]).toContain(
      "how many modules are described at once",
    );
    expect(f.empty.hints[1]).toContain("from a terminal");
    expect(f.empty.buttons).toEqual(["Cancel", "Save"]);
    expect(f.empty.error).toBe("");
  });

  it("fills the fields from the loaded settings", () => {
    expect(f.filled).toEqual(["Sublime Text", "opus"]);
    expect(f.filledDescribing).toEqual({ model: "opus", batch: "8" });
  });

  it("shows an error line as an alert in the error colour", () => {
    expect(f.errorShown.text).toBe("the editor must be a single line");
    expect(f.errorShown.role).toBe("alert");
    expect(f.errorShown.color).not.toBe(f.errorShown.hintColor);
  });

  it("saves the trimmed values and cancels without saving", () => {
    expect(f.saved).toEqual([
      { editor: "code --goto", describing: { model: "opus", batchSize: 6 } },
    ]);
    expect(f.invalidError).toContain("Batch size");
    expect(f.savedAfterInvalid).toBe(0);
    expect(f.cancels).toBe(1);
  });

  it("lays the form out as a column of full-width fields", () => {
    expect(f.layout.display).toBe("flex");
    expect(f.layout.inputWidth).toBeGreaterThan(300);
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

  it("keeps the Describing parts inside the section and its row", () => {
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

  it("gives the error room for two lines", () => {
    expect(f.twoLineErrorHeight).toBeGreaterThanOrEqual(30);
  });

  it("keeps the Save button fully inside the window with a margin below it", () => {
    expect(outerHeight).toBeGreaterThan(0);
    expect(f.saveBottom).toBeLessThanOrEqual(outerHeight - 16);
  });
});
