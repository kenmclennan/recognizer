import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, here, webkit } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { buildClearPrompt } from ${JSON.stringify(here("clear-prompt-view.ts"))};

const facts = {};
const press = (node, key) => node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const fresh = () => {
  const prompt = buildClearPrompt();
  const choices = [];
  document.body.append(prompt.element);
  return { prompt, choices, show: (name) => prompt.show(name, (choice) => choices.push(choice)) };
};
const buttons = (p) => [...p.prompt.element.querySelectorAll("button")];

const a = fresh();
facts.hiddenAtStart = a.prompt.element.hidden;
a.show("overview");
facts.shown = {
  hidden: a.prompt.element.hidden,
  heading: a.prompt.element.querySelector(".clear-prompt-heading").textContent,
  labels: buttons(a).map((b) => b.textContent),
  focusedSave: document.activeElement === a.prompt.element.querySelector(".clear-prompt-save"),
  body: a.prompt.element.querySelector(".clear-prompt-body").textContent,
};
a.prompt.hide();
facts.hiddenAfter = a.prompt.element.hidden;

const b = fresh();
const picked = [];
for (const label of ["Cancel", "Don't save"]) {
  b.show("v");
  click(buttons(b).find((n) => n.textContent === label));
  picked.push(b.choices[b.choices.length - 1]);
}
b.show("v");
click(buttons(b).find((n) => n.textContent === "Save"));
picked.push(b.choices[b.choices.length - 1]);
facts.picked = picked;
facts.disabledAfterSave = buttons(b).map((n) => n.disabled);
click(buttons(b)[2]);
facts.saveClicksIgnored = b.choices.filter((c) => c === "save").length;
b.show("v");
facts.reenabled = buttons(b).map((n) => n.disabled);
b.prompt.hide();

const c = fresh();
c.show("v");
press(c.prompt.element, "Escape");
facts.escape = c.choices;

const d = fresh();
d.show("v");
press(d.prompt.element.querySelector(".clear-prompt-save"), "Enter");
facts.enter = d.choices;

const e = fresh();
e.show("<b>x</b>");
facts.literal = { heading: e.prompt.element.querySelector(".clear-prompt-heading").textContent, injected: e.prompt.element.querySelector(".clear-prompt-heading b") !== null };

document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(webkit === undefined)("the clear prompt view", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "clear-prompt-view");
  }, scaledTimeout(180000));

  it("shows the name and three buttons with Save focused, and hide removes it", () => {
    expect(f.hiddenAtStart).toBe(true);
    expect(f.shown.hidden).toBe(false);
    expect(f.shown.heading).toBe("Save changes to overview?");
    expect(f.shown.labels).toEqual(["Cancel", "Don't save", "Save"]);
    expect(f.shown.focusedSave).toBe(true);
    expect(f.hiddenAfter).toBe(true);
  });

  it("reports each button, Escape and Enter as its choice", () => {
    expect(f.picked).toEqual(["cancel", "discard", "save"]);
    expect(f.escape).toEqual(["cancel"]);
    expect(f.enter).toEqual(["save"]);
  });

  it("disables the buttons after a save choice until the prompt is shown again", () => {
    expect(f.disabledAfterSave).toEqual([true, true, true]);
    expect(f.saveClicksIgnored).toBe(1);
    expect(f.reenabled).toEqual([false, false, false]);
  });

  it("renders the name as text, not HTML", () => {
    expect(f.literal.heading).toBe("Save changes to <b>x</b>?");
    expect(f.literal.injected).toBe(false);
  });
});
