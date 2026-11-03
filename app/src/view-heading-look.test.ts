import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, mountExplorer } from ${JSON.stringify(here("look-support.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
import { fakeWindow } from ${JSON.stringify(here("window-fake.ts"))};
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
const loaded = loadedOf({ modules: ids, scans: [{ file: "scan.json", scan: nowScan }] });

const viewJson = (steps, extra) => JSON.stringify({ schema_version: 4, ...extra, commit: "cur1234", steps }, null, 2) + "\\n";
const pick = (module) => ({ kind: "pick", module });
const tick = () => new Promise((resolve) => setTimeout(resolve, 40));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const typeInto = (input, value) => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); };
const press = (input, k) => input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const REPEATED = Array.from({ length: 200 }, () => "word").join(" ");
const appOnly = [pick("app/hub.py"), pick("app/a.py")];
const both = [pick("app/hub.py"), pick("lib/c.py")];

function mount(files) {
  const host = document.createElement("div");
  host.style.cssText = "width:1400px;height:800px;display:flex;flex-direction:column";
  document.body.append(host);
  const port = fakeViews(files);
  const win = fakeWindow();
  mountExplorer({ container: host, loaded, title: "demo", onCount: () => {}, views: port, post: () => null, windowPort: win });
  const q = (selector) => host.querySelector(selector);
  const all = (selector) => [...host.querySelectorAll(selector)];
  return { host, port, q, all };
}

async function open(page, name) {
  click(page.q(".view-list"));
  click(page.all(".view-item").find((n) => n.querySelector(".view-item-name").textContent === name));
  await tick();
}

const frameRects = (page) => page.all(".frame").map((f) => { const r = f.querySelector("rect"); return { x: Number(r.getAttribute("x")), y: Number(r.getAttribute("y")), width: Number(r.getAttribute("width")) }; });
const headingOf = (page) => {
  const g = page.q(".view-heading");
  if (g === null) return null;
  const n = (name) => Number(g.dataset[name]);
  return { x: n("x"), y: n("y"), width: n("width"), height: n("height"), centre: n("x") + n("width") / 2, bottom: n("y") + n("height"), title: [...g.querySelectorAll(".view-heading-title tspan")].map((t) => t.textContent), description: [...g.querySelectorAll(".view-heading-description tspan")].map((t) => t.textContent), insideWorld: g.closest(".world") !== null, pointerEvents: g.style.pointerEvents };
};
const midpoint = (rects) => (Math.min(...rects.map((r) => r.x)) + Math.max(...rects.map((r) => r.x + r.width))) / 2;
const top = (rects) => Math.min(...rects.map((r) => r.y));
const facts = {};

(async () => {
  await tick();
  const page = mount({
    one: viewJson(appOnly, { title: "One folder", description: "Shows the app." }),
    two: viewJson(both, { title: "Two folders", description: "Shows both." }),
    untitled: viewJson(appOnly, { description: "Only a description." }),
    plain: viewJson(appOnly, { title: undefined, description: "Plain." }),
    long: viewJson(appOnly, { title: "Long", description: REPEATED }),
  });
  await tick();

  facts.emptyCanvas = page.q(".view-heading") === null;

  await open(page, "one");
  const oneFrames = frameRects(page);
  facts.one = { frames: oneFrames.length, heading: headingOf(page), centre: midpoint(oneFrames), top: top(oneFrames), title: page.q(".view-heading-title").textContent, pill: page.q(".view-name").textContent };

  const level = () => page.q(".level").textContent;
  const before = { level: level(), heading: headingOf(page) };
  click(page.q('.controls button[aria-label="Zoom in"]'));
  await tick();
  facts.zoom = { before: before.level, after: level(), same: JSON.stringify(before.heading) === JSON.stringify(headingOf(page)) };
  const surface = page.q(".surface").getBoundingClientRect();
  click([...page.all(".controls button")].find((b) => b.textContent === "Fit"));
  await tick();
  const screen = page.q(".view-heading").getBoundingClientRect();
  facts.fit = { insideSurface: screen.top >= surface.top && screen.bottom <= surface.bottom && screen.left >= surface.left && screen.right <= surface.right };

  await open(page, "two");
  const twoFrames = frameRects(page);
  facts.two = { frames: twoFrames.length, heading: headingOf(page), centre: midpoint(twoFrames), top: top(twoFrames) };

  await open(page, "untitled");
  facts.untitledView = headingOf(page);

  await open(page, "long");
  facts.long = { heading: headingOf(page), file: page.port.files.get("long") };

  await open(page, "one");
  page.port.edit("one", viewJson(appOnly, { title: "Edited outside", description: "Shows the app." }));
  await tick();
  await tick();
  facts.external = page.q(".view-heading-title") && page.q(".view-heading-title").textContent;

  click(page.q(".view-name"));
  const nameField = page.q(".view-name-field-inline");
  const titleField = page.q(".view-title-field-inline");
  facts.inline = { titleShown: !titleField.hidden, value: titleField.value, label: titleField.getAttribute("aria-label") };
  typeInto(titleField, "Retitled with Enter");
  press(titleField, "Enter");
  await tick();
  await tick();
  facts.retitledEnter = { text: JSON.parse(page.port.files.get("one")), heading: page.q(".view-heading-title").textContent, pill: page.q(".view-name").textContent };

  click(page.q(".view-name"));
  typeInto(page.q(".view-title-field-inline"), "Retitled on blur");
  page.q(".view-title-field-inline").dispatchEvent(new FocusEvent("blur", { relatedTarget: null }));
  await tick();
  await tick();
  facts.retitledBlur = JSON.parse(page.port.files.get("one")).title;

  click(page.q(".view-name"));
  typeInto(page.q(".view-title-field-inline"), "   ");
  press(page.q(".view-title-field-inline"), "Enter");
  await tick();
  await tick();
  facts.cleared = { hasTitle: "title" in JSON.parse(page.port.files.get("one")), heading: headingOf(page).title };

  click(page.q(".view-name"));
  typeInto(page.q(".view-name-field-inline"), "renamed");
  press(page.q(".view-name-field-inline"), "Enter");
  await tick();
  await tick();
  facts.nameOnly = { has: page.port.files.has("renamed"), title: "title" in JSON.parse(page.port.files.get("renamed")) };

  const fresh = mount({});
  await tick();
  click(fresh.q('.tree .row[data-path="app"] .rcheck'));
  await tick();
  click(fresh.q(".view-save"));
  facts.dialog = fresh.all(".view-dialog label .view-field-label").map((n) => n.textContent);
  facts.dialogHint = fresh.q(".view-field-title").placeholder;
  typeInto(fresh.q(".view-dialog .view-field-name"), "titled");
  typeInto(fresh.q(".view-dialog .view-field-title"), "  A heading  ");
  typeInto(fresh.q(".view-dialog .view-field-description"), "desc");
  click(fresh.q(".view-confirm"));
  await tick();
  facts.savedTitled = JSON.parse(fresh.port.files.get("titled"));
  facts.savedHeading = headingOf(fresh);

  const blank = mount({});
  await tick();
  click(blank.q('.tree .row[data-path="app"] .rcheck'));
  await tick();
  click(blank.q(".view-save"));
  typeInto(blank.q(".view-dialog .view-field-name"), "blank");
  typeInto(blank.q(".view-dialog .view-field-title"), "   ");
  typeInto(blank.q(".view-dialog .view-field-description"), "desc");
  click(blank.q(".view-confirm"));
  await tick();
  facts.savedBlank = "title" in JSON.parse(blank.port.files.get("blank"));

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(chrome === undefined)("the view heading", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "view-heading", "light", "app");
  }, 180000);

  it("draws no heading on an empty canvas", () => {
    expect(f.emptyCanvas).toBe(true);
  });

  it("centres on the outer frame and sits the fixed gap above it", () => {
    expect(f.one.frames).toBe(1);
    expect(Math.abs(f.one.heading.centre - f.one.centre)).toBeLessThan(0.5);
    expect(Math.abs(f.one.heading.bottom - (f.one.top - 16))).toBeLessThan(0.5);
    expect(f.one.heading.width).toBe(720);
    expect(f.one.heading.insideWorld).toBe(true);
    expect(f.one.heading.pointerEvents).toBe("none");
    expect(f.one.title).toBe("One folder");
    expect(f.one.pill).toBe("one");
  });

  it("centres on the combined extent of two top-level frames", () => {
    expect(f.two.frames).toBe(2);
    expect(Math.abs(f.two.heading.centre - f.two.centre)).toBeLessThan(0.5);
    expect(Math.abs(f.two.heading.bottom - (f.two.top - 16))).toBeLessThan(0.5);
  });

  it("scales with the world and is inside the surface after Fit", () => {
    expect(f.zoom.after).not.toBe(f.zoom.before);
    expect(f.zoom.same).toBe(true);
    expect(f.fit.insideSurface).toBe(true);
  });

  it("shows the description alone for a view with no title", () => {
    expect(f.untitledView.title).toEqual([]);
    expect(f.untitledView.description).toEqual(["Only a description."]);
  });

  it("caps a long description at three lines ending in an ellipsis and keeps the file text", () => {
    expect(f.long.heading.description).toHaveLength(3);
    expect(f.long.heading.description[2].endsWith("…")).toBe(true);
    expect(f.long.heading.description[0].split(" ").length).toBeGreaterThan(5);
    expect(JSON.parse(f.long.file).description).toContain(
      Array.from({ length: 200 }, () => "word").join(" "),
    );
  });

  it("redraws when the file text changes from outside", () => {
    expect(f.external).toBe("Edited outside");
  });

  it("edits the title in the pill with Enter and with blur, and clears it when blank", () => {
    expect(f.inline.titleShown).toBe(true);
    expect(f.inline.value).toBe("Edited outside");
    expect(f.inline.label).toBe("View title");
    expect(f.retitledEnter.text.title).toBe("Retitled with Enter");
    expect(f.retitledEnter.text.commit).toBe("cur1234");
    expect(f.retitledEnter.text.steps).toHaveLength(2);
    expect(f.retitledEnter.heading).toBe("Retitled with Enter");
    expect(f.retitledEnter.pill).toBe("one");
    expect(f.retitledBlur).toBe("Retitled on blur");
    expect(f.cleared.hasTitle).toBe(false);
    expect(f.cleared.heading).toEqual([]);
  });

  it("renames without writing a title", () => {
    expect(f.nameOnly.has).toBe(true);
    expect(f.nameOnly.title).toBe(false);
  });

  it("asks for the title in the save dialog and writes it only when filled", () => {
    expect(f.dialog).toEqual(["Name", "Title", "Description"]);
    expect(f.dialogHint).toBe("Heading shown above the diagram");
    expect(f.savedTitled.title).toBe("A heading");
    expect(Object.keys(f.savedTitled).slice(0, 3)).toEqual([
      "schema_version",
      "title",
      "description",
    ]);
    expect(f.savedHeading.title).toEqual(["A heading"]);
    expect(f.savedBlank).toBe(false);
  });
});
