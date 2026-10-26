import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { describe, expect, it } from "vitest";

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((path): path is string => typeof path === "string" && path !== "");

const chrome = CHROME_CANDIDATES.find((path) => existsSync(path));
const SRC = fileURLToPath(new URL(".", import.meta.url));
const PROTOTYPE = fileURLToPath(
  new URL("../../docs/prototype/explorer.html", import.meta.url),
);

const ENTRY = `
import { createPicker } from ${JSON.stringify(join(SRC, "picker-model.ts"))};
import { buildPickerView } from ${JSON.stringify(join(SRC, "picker-view.ts"))};

const edge = (to, names, extra = {}) => ({ from: "hub.py", to, kind: "depends", line: 1, names, ...extra });
const scan = {
  modules: [
    { id: "hub.py", kind: "module" },
    { id: "g/x.py", kind: "module", members: [{ name: "_hidden", exported: false }] },
    { id: "g/y.py", kind: "module" },
    { id: "g/w.py", kind: "module" },
    { id: "g/z.py", kind: "module" },
    { id: "p/q.py", kind: "module" },
  ],
  edges: [
    edge("g/x.py", ["_hidden"]),
    edge("g/y.py", ["m"], { inferred: { parameter: "p", methods: ["m"], class: "Y", implementations: [] } }),
    edge("g/w.py", ["Alpha"]),
    edge("g/z.py", ["Zed"]),
    edge("p/q.py", ["Beta"]),
  ],
  foreign: [],
};
const model = createPicker({
  scans: [scan],
  modules: scan.modules.map((m) => m.id),
  onCanvas: (id) => id === "g/z.py",
  source: { kind: "module", id: "hub.py", direction: "uses" },
});
const view = buildPickerView({
  toggle() {}, toggleGroup() {}, toggleCollapse() {}, setTab() {}, setFilter() {},
  tickAll() {}, add() {},
}, () => "green");
view.render(model);
view.element.style.position = "static";
document.getElementById("app").append(view.element);
window.tickOne = () => { model.toggle("g/w.py"); view.render(model); };
`;

const ROW = (
  cls: string,
  id: string,
  on: boolean,
  done: boolean,
  w: string,
  wcls = "",
) =>
  `<div class="pr${cls}${done ? " done" : ""}" data-m="${id}"><input type="checkbox" ${on ? "checked" : ""} ${done ? "disabled" : ""} tabindex="-1"><i class="disc d-ok"></i><span>x</span><span class="w${wcls}">${w}</span></div>`;

const PAGE = (css: string, protoCss: string) => `<!doctype html>
<html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div id="app" style="position:relative"></div>
<div id="host"></div>
<script src="look.js"></script>
<script>
const protoCss = ${JSON.stringify(protoCss)};
const ROW = ${ROW.toString()};
const shadow = document.getElementById("host").attachShadow({ mode: "open" });
shadow.innerHTML = '<style>:host{display:block;color:var(--fg)}' + protoCss + '</style>' +
  '<div id="pick" class="pop show"><div class="ph" style="padding:2px 4px 6px">t</div>' +
  '<input class="pf" autocomplete="off">' +
  '<div class="seg"><button data-tab="mod" class="on">By module</button><button data-tab="name">By name</button></div>' +
  '<div class="pl">' +
  '<div class="pg" data-g="g"><input type="checkbox"><svg class="i tw" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg><span>g/</span><span class="c">4</span></div>' +
  ROW(" in", "g/x.py", false, false, "_hidden", " pv") +
  ROW(" in", "g/y.py", false, false, "m · inferred", " if") +
  ROW(" in", "g/w.py", false, false, "Alpha") +
  ROW(" in", "g/z.py", true, true, "on canvas") +
  ROW("", "p/q.py", false, false, "Beta") +
  '</div><div class="pfoot"><span>1 already on the canvas</span><span style="flex:1"></span><button class="pbtn" disabled>Add</button></div></div>' +
  '<svg><g class="n gh"><rect width="10" height="10"/></g><path class="e gh" d="M0 0L10 10"/></svg>';
document.getElementById("app").insertAdjacentHTML("beforeend",
  '<svg id="scene"><g class="box module ghost"><rect class="box-body" width="10" height="10"/></g>' +
  '<polyline class="edge plain ghost" stroke-dasharray="3 3" points="0,0 10,10"/></svg>');

const q = (root, sel) => root.querySelector(sel);
const pick = (root, sel, props) => {
  const node = q(root, sel);
  if (!node) return { missing: sel };
  const style = getComputedStyle(node);
  const out = {};
  for (const p of props) out[p] = style.getPropertyValue(p);
  return out;
};
const BOX = ["padding-top", "padding-right", "padding-bottom", "padding-left"];
const RADIUS = ["border-top-left-radius"];
const BORDER = ["border-top-width", "border-top-color"];
const checks = (page, s) => ({
  panel: [page(s.panel, ["width", "max-height", "display", "flex-direction", "background-color", "color", "border-top-left-radius", ...BORDER, ...BOX])],
  filter: [page(s.filter, ["height", "border-top-left-radius", "background-color", "color", "padding-left", "padding-right", ...BORDER])],
  tabs: [page(s.tabs, ["background-color", "display", "column-gap", "border-top-left-radius", ...BOX])],
  tabOn: [page(s.tabOn, ["background-color", "padding-top", "padding-bottom", "border-top-left-radius", "font-weight", "color", "flex-grow"])],
  tabOff: [page(s.tabOff, ["background-color", "font-weight", "color"])],
  group: [page(s.group, ["height", "padding-left", "padding-right", "color", "font-weight", "border-top-left-radius", "column-gap", "display"])],
  count: [page(s.count, ["color", "font-weight"])],
  plain: [page(s.plain, ["min-height", "padding-left", "padding-right", "column-gap", "color", "border-top-left-radius"])],
  plainNames: [page(s.plainNames, ["color", "overflow-x", "text-overflow", "white-space", "font-size", "text-align", "flex-grow"])],
  indent: [page(s.indent, ["min-height", "padding-left", "column-gap", "color"])],
  done: [page(s.done, ["min-height", "padding-left", "color"])],
  doneNames: [page(s.doneNames, ["color"])],
  private: [page(s.private, ["color"])],
  inferred: [page(s.inferred, ["color"])],
  foot: [page(s.foot, ["border-top-width", "border-top-color", "padding-top", "padding-left", "column-gap", "color", "margin-top"])],
  addOff: [page(s.addOff, ["height", "padding-left", "padding-right", "border-top-left-radius", "background-color", "color", "opacity"])],
  addOn: [page(s.addOn, ["height", "background-color", "color", "opacity"])],
  ghostBox: [page(s.ghostBox, ["opacity"]), page(s.ghostBoxBody, ["stroke-dasharray"])],
  ghostLine: [page(s.ghostLine, ["stroke-dasharray", "stroke-opacity"])],
});
const app = document.getElementById("app");
const result = { dark: matchMedia("(prefers-color-scheme: dark)").matches };
const sel = (root, map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [root, v]]));
const pageOf = ([root, s], props) => pick(root, s, props);
const appMap = {
  panel: [app, ".picker"], filter: [app, ".picker-filter"], tabs: [app, ".picker-tabs"],
  tabOn: [app, ".picker-tabs button.on"], tabOff: [app, ".picker-tabs button:not(.on)"],
  group: [app, ".picker-group:not(.names)"], count: [app, ".picker-group .count"],
  plain: [app, '.picker-row[data-id="p/q.py"]'], plainNames: [app, '.picker-row[data-id="p/q.py"] .names'],
  indent: [app, '.picker-row[data-id="g/w.py"]'], done: [app, '.picker-row[data-id="g/z.py"]'],
  doneNames: [app, '.picker-row[data-id="g/z.py"] .names'],
  private: [app, '.picker-row[data-id="g/x.py"] .names'], inferred: [app, '.picker-row[data-id="g/y.py"] .names'],
  foot: [app, ".picker-foot"], addOff: [app, ".picker-add"], addOn: [app, ".picker-add"],
  ghostBox: [app, "#scene .box.ghost"], ghostBoxBody: [app, "#scene .box.ghost .box-body"], ghostLine: [app, "#scene .edge.ghost"],
};
const protoMap = {
  panel: [shadow, "#pick"], filter: [shadow, ".pf"], tabs: [shadow, ".seg"],
  tabOn: [shadow, ".seg button.on"], tabOff: [shadow, ".seg button:not(.on)"],
  group: [shadow, ".pg"], count: [shadow, ".pg .c"],
  plain: [shadow, '.pr[data-m="p/q.py"]'], plainNames: [shadow, '.pr[data-m="p/q.py"] .w'],
  indent: [shadow, '.pr[data-m="g/w.py"]'], done: [shadow, '.pr[data-m="g/z.py"]'],
  doneNames: [shadow, '.pr[data-m="g/z.py"] .w'],
  private: [shadow, '.pr[data-m="g/x.py"] .w'], inferred: [shadow, '.pr[data-m="g/y.py"] .w'],
  foot: [shadow, ".pfoot"], addOff: [shadow, ".pbtn"], addOn: [shadow, ".pbtn"],
  ghostBox: [shadow, ".n.gh"], ghostBoxBody: [shadow, ".n.gh rect"], ghostLine: [shadow, ".e.gh"],
};
const run = (map) => checks(pageOf, map);
const appFirst = run(appMap);
window.tickOne();
const appAfter = run(appMap);
shadow.querySelector(".pbtn").disabled = false;
const protoAfter = run(protoMap);
const protoFirst = (() => { shadow.querySelector(".pbtn").disabled = true; return run(protoMap); })();
const pane = app.querySelector(".picker");
const header = app.querySelector(".picker-group:not(.names)");
result.compare = { appOff: appFirst, appOn: appAfter, protoOff: protoFirst, protoOn: protoAfter };
result.structure = {
  headerInputs: header.querySelectorAll("input").length,
  headerSvgs: header.querySelectorAll("svg").length,
  headerPath: header.querySelector("svg path").getAttribute("d"),
  headerCounts: header.querySelectorAll(".count").length,
  rows: [...pane.querySelectorAll(".picker-row")].map((row) => [
    row.querySelectorAll("input").length,
    row.querySelectorAll(".disc").length,
    row.querySelectorAll("span:not(.disc)").length,
  ]),
  images: pane.querySelectorAll("img").length,
  iconFonts: pane.querySelectorAll("i").length,
};
document.body.insertAdjacentHTML("beforeend", "<pre id='out'></pre>");
document.getElementById("out").textContent = JSON.stringify(result);
</script></body></html>`;

type Styles = Record<string, Record<string, string>[]>;
type Report = {
  dark: boolean;
  compare: { appOff: Styles; appOn: Styles; protoOff: Styles; protoOn: Styles };
  structure: {
    headerInputs: number;
    headerSvgs: number;
    headerPath: string;
    headerCounts: number;
    rows: number[][];
    images: number;
    iconFonts: number;
  };
};

async function prepare(scheme: "light" | "dark"): Promise<Report> {
  const dir = mkdtempSync(join(tmpdir(), "picker-entry-"));

  try {
    writeFileSync(join(dir, "entry.ts"), ENTRY);

    return await inChromeWith(dir, scheme);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}

async function inChromeWith(
  entryDir: string,
  scheme: "light" | "dark",
): Promise<Report> {
  const dir = mkdtempSync(join(tmpdir(), "picker-look-"));

  try {
    await build({
      configFile: false,
      logLevel: "silent",
      root: fileURLToPath(new URL("..", import.meta.url)),
      build: {
        outDir: dir,
        emptyOutDir: false,
        minify: false,
        lib: {
          entry: join(entryDir, "entry.ts"),
          name: "Look",
          formats: ["iife"],
          fileName: () => "look.js",
        },
      },
    });

    const css = readFileSync(join(SRC, "style.css"), "utf8");
    const proto = readFileSync(PROTOTYPE, "utf8");
    const protoCss = /<style>([\s\S]*?)<\/style>/
      .exec(proto)?.[1]
      ?.replaceAll(":root{", ":host{") as string;

    writeFileSync(join(dir, "page.html"), PAGE(css, protoCss));

    const run = spawnSync(
      chrome as string,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        `--user-data-dir=${join(dir, "profile")}`,
        `--blink-settings=preferredColorScheme=${scheme === "dark" ? 0 : 1}`,
        "--allow-file-access-from-files",
        "--dump-dom",
        `file://${join(dir, "page.html")}`,
      ],
      { encoding: "utf8", timeout: 60000 },
    );
    const match = /<pre id="out">([\s\S]*?)<\/pre>/.exec(run.stdout);

    if (!match) {
      throw new Error(`no report from the page: ${run.stderr.slice(0, 400)}`);
    }

    return JSON.parse(
      (match[1] as string)
        .replaceAll("&quot;", '"')
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&"),
    ) as Report;
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}

describe("the picker against the prototype, in a real browser", () => {
  for (const scheme of ["light", "dark"] as const) {
    it.skipIf(chrome === undefined)(
      `computes the prototype's styles in ${scheme}`,
      async () => {
        const report = await prepare(scheme);

        expect(report.dark).toBe(scheme === "dark");

        const { appOff, appOn, protoOff, protoOn } = report.compare;
        const names = Object.keys(appOff).filter(
          (name) => name !== "addOn" && name !== "tabOff",
        );

        for (const name of names) {
          expect({ [name]: appOff[name] }).toEqual({ [name]: protoOff[name] });
        }

        expect(appOff.tabOff).toEqual(protoOff.tabOff);
        expect(appOn.addOn).toEqual(protoOn.addOn);
        expect(appOn.addOn?.[0]?.opacity).toBe("1");
        expect(appOff.addOff?.[0]?.opacity).toBe("0.4");
        expect(appOff.ghostBox?.[0]?.opacity).toBe("0.55");
        expect(appOff.ghostLine?.[0]?.["stroke-opacity"]).toBe("0.8");
      },
      120000,
    );
  }

  it.skipIf(chrome === undefined)(
    "builds the header, rows and icons from inline svg and plain elements",
    async () => {
      const { structure } = await prepare("light");
      const proto = readFileSync(PROTOTYPE, "utf8");

      expect(structure.headerInputs).toBe(1);
      expect(structure.headerSvgs).toBe(1);
      expect(structure.headerCounts).toBe(1);
      expect(proto).toContain(`o?"${structure.headerPath}"`);
      expect(structure.rows.every((row) => row.join() === "1,1,2")).toBe(true);
      expect(structure.images).toBe(0);
      expect(structure.iconFonts).toBe(0);
    },
    120000,
  );
});
