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

view.fill({ editor: "", recognizerPath: "" });
facts.empty = {
  labels: [...host.querySelectorAll("label > span")].map((n) => n.textContent),
  placeholders: [...host.querySelectorAll("input")].map((n) => n.placeholder),
  values: [...host.querySelectorAll("input")].map((n) => n.value),
  hints: [...host.querySelectorAll(".hint")].map((n) => n.textContent),
  buttons: [...host.querySelectorAll(".buttons button")].map((n) => n.textContent),
  error: q(".error").textContent,
};

view.fill({ editor: "Sublime Text", recognizerPath: "/opt/bin/recognizer" });
facts.filled = [...host.querySelectorAll("input")].map((n) => n.value);

view.showError("the recognizer command must be an absolute path or blank");
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
facts.layout = {
  display: cs(q("form")).display,
  inputWidth: Math.round(q("input").getBoundingClientRect().width),
};

document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(chrome === undefined)("the settings window", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "settings-look");
  }, 180000);

  it("shows the editor and recognizer command fields with their placeholders, hints and buttons", () => {
    expect(f.empty.labels).toEqual(["Editor", "Recognizer command"]);
    expect(f.empty.placeholders).toEqual(["System default", "recognizer"]);
    expect(f.empty.values).toEqual(["", ""]);
    expect(f.empty.hints[0]).toContain("Sublime Text");
    expect(f.empty.hints[0]).toContain("Terminal editors are not supported");
    expect(f.empty.hints[1]).toContain("absolute");
    expect(f.empty.buttons).toEqual(["Cancel", "Save"]);
    expect(f.empty.error).toBe("");
  });

  it("fills the fields from the loaded settings", () => {
    expect(f.filled).toEqual(["Sublime Text", "/opt/bin/recognizer"]);
  });

  it("shows an error line as an alert in the error colour", () => {
    expect(f.errorShown.text).toBe(
      "the recognizer command must be an absolute path or blank",
    );
    expect(f.errorShown.role).toBe("alert");
    expect(f.errorShown.color).not.toBe(f.errorShown.hintColor);
  });

  it("saves the trimmed values and cancels without saving", () => {
    expect(f.saved).toEqual([
      { editor: "code --goto", recognizerPath: "/opt/bin/recognizer" },
    ]);
    expect(f.cancels).toBe(1);
  });

  it("lays the form out as a column of full-width fields", () => {
    expect(f.layout.display).toBe("flex");
    expect(f.layout.inputWidth).toBeGreaterThan(300);
  });
});
