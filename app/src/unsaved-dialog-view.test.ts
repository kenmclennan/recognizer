import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, here, webkit } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { const g = fresh();
g.show("v");
const gb = buttons(g);
const focusAfter = (key, shiftKey) => { document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })); return gb.indexOf(document.activeElement); };
facts.tabs = [focusAfter("Tab", false), focusAfter("Tab", false), focusAfter("Tab", false)];
gb[0].focus();
facts.shiftTabWrap = focusAfter("Tab", true);

const h = fresh();
h.show("v");
click(h.prompt.element);
facts.backdrop = h.choices;

document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { buildUnsavedDialog } from ${JSON.stringify(here("unsaved-dialog-view.ts"))};

const facts = {};
const press = (node, key) => node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const fresh = () => {
  const prompt = buildUnsavedDialog();
  const choices = [];
  document.body.append(prompt.element);
  return { prompt, choices, show: (name) => prompt.show(name, "body for " + name, (choice) => choices.push(choice)) };
};
const buttons = (p) => [...p.prompt.element.querySelectorAll("button")];

const a = fresh();
facts.hiddenAtStart = a.prompt.element.hidden;
a.show("overview");
facts.shown = {
  hidden: a.prompt.element.hidden,
  heading: a.prompt.element.querySelector(".unsaved-dialog-heading").textContent,
  labels: buttons(a).map((b) => b.textContent),
  focusedSave: document.activeElement === a.prompt.element.querySelector(".unsaved-dialog-save"),
  body: a.prompt.element.querySelector(".unsaved-dialog-body").textContent,
  modal: a.prompt.element.querySelector(".unsaved-dialog").getAttribute("aria-modal"),
};
a.prompt.show("other", "Another body line.", () => {});
facts.bodyFollowsShow = a.prompt.element.querySelector(".unsaved-dialog-body").textContent;
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
press(d.prompt.element.querySelector(".unsaved-dialog-save"), "Enter");
facts.enter = d.choices;

const e = fresh();
e.show("<b>x</b>");
facts.literal = { heading: e.prompt.element.querySelector(".unsaved-dialog-heading").textContent, injected: e.prompt.element.querySelector(".unsaved-dialog-heading b") !== null };

const g = fresh();
g.show("v");
const gb = buttons(g);
const focusAfter = (key, shiftKey) => { document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })); return gb.indexOf(document.activeElement); };
facts.tabs = [focusAfter("Tab", false), focusAfter("Tab", false), focusAfter("Tab", false)];
gb[0].focus();
facts.shiftTabWrap = focusAfter("Tab", true);

const h = fresh();
h.show("v");
click(h.prompt.element);
facts.backdrop = h.choices;

document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(webkit === undefined)("the unsaved-changes dialog view", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "unsaved-dialog-view");
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

  it("shows the body line it is given and is modal", () => {
    expect(f.shown.body).toBe("body for overview");
    expect(f.bodyFollowsShow).toBe("Another body line.");
    expect(f.shown.modal).toBe("true");
  });

  it("wraps Tab and Shift+Tab among the three buttons and ignores a backdrop click", () => {
    expect(f.tabs).toEqual([0, 1, 2]);
    expect(f.shiftTabWrap).toBe(2);
    expect(f.backdrop).toEqual([]);
  });

  it("renders the name as text, not HTML", () => {
    expect(f.literal.heading).toBe("Save changes to <b>x</b>?");
    expect(f.literal.injected).toBe(false);
  });
});
