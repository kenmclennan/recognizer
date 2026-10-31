import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, here } from "./look-page";

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

view.fill({ editor: "" });
facts.empty = {
  labels: [...host.querySelectorAll("label > span")].map((n) => n.textContent),
  placeholders: [...host.querySelectorAll("input")].map((n) => n.placeholder),
  values: [...host.querySelectorAll("input")].map((n) => n.value),
  hints: [...host.querySelectorAll(".hint")].map((n) => n.textContent),
  buttons: [...host.querySelectorAll(".buttons button")].map((n) => n.textContent),
  error: q(".error").textContent,
};

view.fill({ editor: "Sublime Text" });
facts.filled = [...host.querySelectorAll("input")].map((n) => n.value);

view.showError("the editor must be a single line");
facts.errorShown = {
  text: q(".error").textContent,
  role: q(".error").getAttribute("role"),
  color: cs(q(".error")).color,
  hintColor: cs(q(".hint")).color,
  height: Math.round(host.getBoundingClientRect().height),
};

host.querySelector('input[name="editor"]').value = "  code --goto  ";
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
  inputWidth: Math.round(q("input").getBoundingClientRect().width),
};

document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
`;

const outerHeight = Number(
  /const SETTINGS_HEIGHT: f64 = (\d+)/.exec(
    readFileSync(here("../src-tauri/src/lib.rs"), "utf8"),
  )?.[1],
);

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(chrome === undefined)("the settings window", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "settings-look");
  }, 180000);

  it("shows only the editor field with its placeholder, hint and buttons", () => {
    expect(f.empty.labels).toEqual(["Editor"]);
    expect(f.empty.placeholders).toEqual(["System default"]);
    expect(f.empty.values).toEqual([""]);
    expect(f.empty.hints[0]).toContain("Sublime Text");
    expect(f.empty.hints[0]).toContain("Terminal editors are not supported");
    expect(f.empty.hints).toHaveLength(1);
    expect(f.empty.buttons).toEqual(["Cancel", "Save"]);
    expect(f.empty.error).toBe("");
  });

  it("fills the fields from the loaded settings", () => {
    expect(f.filled).toEqual(["Sublime Text"]);
  });

  it("shows an error line as an alert in the error colour", () => {
    expect(f.errorShown.text).toBe("the editor must be a single line");
    expect(f.errorShown.role).toBe("alert");
    expect(f.errorShown.color).not.toBe(f.errorShown.hintColor);
  });

  it("saves the trimmed values and cancels without saving", () => {
    expect(f.saved).toEqual([{ editor: "code --goto" }]);
    expect(f.cancels).toBe(1);
  });

  it("lays the form out as a column of full-width fields", () => {
    expect(f.layout.display).toBe("flex");
    expect(f.layout.inputWidth).toBeGreaterThan(300);
  });

  it("gives the error room for two lines", () => {
    expect(f.twoLineErrorHeight).toBeGreaterThanOrEqual(30);
  });

  it("keeps the Save button fully inside the window with a margin below it", () => {
    expect(outerHeight).toBeGreaterThan(0);
    expect(f.saveBottom).toBeLessThanOrEqual(outerHeight - 16);
  });
});
