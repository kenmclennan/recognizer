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

const ENTRY = `
import { buildInspectorView } from ${JSON.stringify(join(SRC, "inspector-view.ts"))};
import { compactFolders } from ${JSON.stringify(join(SRC, "folder-compaction.ts"))};
import { inspectorContent } from ${JSON.stringify(join(SRC, "inspector-model.ts"))};

const scan = {
  modules: [
    { id: "p/m.py", kind: "module", members: [
      { name: "C", kind: "class", exported: true, bases: ["Exception", "Base"], fields: [{ name: "a", type: "int", line: 2, private: false }],
        methods: [{ name: "go", params: [{ name: "x" }], returns: "int" }, { name: "_h", params: [], private: true }] },
      { name: "f", kind: "function", exported: true, params: [] },
      { name: "_g", kind: "function", exported: false, params: [] },
    ] },
    { id: "p/o.py", kind: "module" },
    { id: "p/q.py", kind: "module", members: [{ name: "Z", kind: "class", exported: true }] },
    { id: "deep/folder/" + "n".repeat(120) + ".py", kind: "module" },
  ],
  edges: [],
  foreign: [],
  calls: [{ from: "p/o.py::x", to: "p/m.py::C.go", line: 1, how: "call" }],
};
const inputs = {
  scans: [scan],
  modules: scan.modules.map((m) => m.id),
  compaction: compactFolders(scan.modules.map((m) => m.id)),
  disc: () => "green",
  findings: () => [],
  onCanvas: (id) => id === "p/m.py",
  expanded: new Set(),
  showPrivate: true,
  tab: "contents",
  evidence: null,
  edgeOnCanvas: true,
  counts: () => ({ uses: 0, usedBy: 0 }),
  filter: "",
  collapsed: new Set(),
  responsibility: () => ({ state: { kind: "missing" }, busy: false, failure: null }), moduleNote: () => null,
};
const actions = { open() {}, close() {}, setTab() {}, toggleFold() {}, openFile() {}, hover() {}, putOnCanvas() {}, takeOff() {}, pickName() {}, toggleGroup() {}, setFilter() {}, openInEditor() {}, setShowPrivate() {} };
const mount = (id, selection, open) => {
  const view = buildInspectorView(actions);
  view.render(inspectorContent(selection, inputs), open);
  const host = document.getElementById(id);
  host.append(view.element);
};
mount("a-rail", { kind: "module", id: "p/m.py" }, false);
mount("a-panel", { kind: "module", id: "p/m.py" }, true);
mount("a-long", { kind: "module", id: "deep/folder/" + "n".repeat(120) + ".py" }, true);
mount("a-short", { kind: "module", id: "p/q.py" }, true);
mount("a-edge", { kind: "edge", id: "p/m.py>p/q.py" }, true);
`;

const PAGE = (css: string) => `<!doctype html>
<html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div id="a-rail" style="width:44px;height:300px;display:flex;flex-direction:column"></div>
<div id="a-panel" style="width:340px;height:600px;display:flex;flex-direction:column"></div>
<div id="a-long" style="width:340px;height:200px;display:flex;flex-direction:column"></div>
<div id="a-short" style="width:340px;height:200px;display:flex;flex-direction:column"></div>
<div id="a-edge" style="width:340px;height:200px;display:flex;flex-direction:column"></div>
<script src="look.js"></script>
<script>
const BOX = ["padding-top", "padding-right", "padding-bottom", "padding-left"];
const BORDER_L = ["border-left-width", "border-left-color"];
const ROW = ["display", "column-gap", "align-items", "color", "font-size", "font-weight", "border-top-left-radius", ...BOX];
const specs = {
  rail: ["#a-rail .inspector-rail", ["width", "display", "flex-direction", "align-items", "background-color", "box-sizing", "padding-top", ...BORDER_L]],
  railButton: ["#a-rail .inspector-rail .ib", ["width", "height", "color", "background-color", "border-top-left-radius"]],
  panel: ["#a-panel .inspector-panel", ["width", "box-sizing", "background-color", "overflow-x", "overflow-y", ...BOX, ...BORDER_L]],
  close: ["#a-panel .ih .ib", ["width", "height", "color", "border-top-left-radius", "background-color"]],
  tabs: ["#a-panel .itabs", ["display", "column-gap", "margin-bottom", "border-bottom-width", "border-bottom-color"]],
  tabOn: ["#a-panel .itabs button.on", ["padding-top", "padding-left", "color", "font-weight", "font-size", "box-shadow", "background-color"]],
  tabOff: ["#a-panel .itabs button:not(.on)", ["padding-top", "padding-left", "color", "font-weight", "font-size", "box-shadow", "background-color"]],
};
const read = (node, props) => {
  if (!node) return { missing: true };
  const style = getComputedStyle(node);
  return Object.fromEntries(props.map((p) => [p, style.getPropertyValue(p)]));
};
const app = {};
for (const [name, [a, props]] of Object.entries(specs)) {
  app[name] = read(document.querySelector(a), props);
}
const panel = document.querySelector("#a-panel");
const measureHead = (id) => {
  const text = document.querySelector("#" + id + " .ih-text");
  const [name, folder] = [text.querySelector("b"), text.querySelector(".muted")];
  const line = parseFloat(getComputedStyle(name).lineHeight) || name.getBoundingClientRect().height;
  return {
    nameHeight: name.getBoundingClientRect().height,
    nameScroll: name.scrollWidth,
    nameClient: name.clientWidth,
    overflow: getComputedStyle(name).textOverflow,
    nameTitle: name.title,
    nameText: name.textContent,
    nameBottom: name.getBoundingClientRect().bottom,
    folderTop: folder ? folder.getBoundingClientRect().top : null,
    folderTitle: folder ? folder.title : null,
    folderText: folder ? folder.textContent : null,
    lines: text.querySelectorAll(":scope > *").length,
    closeRight: document.querySelector("#" + id + " .ih .ib").getBoundingClientRect().right,
    panelRight: document.querySelector("#" + id + " .inspector-panel").getBoundingClientRect().right,
    line,
  };
};
const result = {
  dark: matchMedia("(prefers-color-scheme: dark)").matches,
  app,
  structure: {
    images: document.querySelectorAll(".inspector img").length,
    iconFonts: document.querySelectorAll(".inspector i").length,
    railSvgs: document.querySelectorAll("#a-rail .inspector-rail svg").length,
    railPath: [...document.querySelectorAll("#a-rail svg path")].map((n) => n.getAttribute("d")),
  },
  heads: { long: measureHead("a-long"), short: measureHead("a-short") },
  edgeLines: document.querySelectorAll("#a-edge .ih-text > *").length,
  links: document.querySelectorAll("#a-panel .cb").length,
  linkText: [...panel.querySelectorAll(".card")].map((n) => n.textContent).filter((t) => /(called|built|used) by/.test(t)).length,
};
document.body.insertAdjacentHTML("beforeend", "<pre id='out'></pre>");
document.getElementById("out").textContent = JSON.stringify(result);
</script></body></html>`;

type Styles = Record<string, Record<string, string | boolean>>;
type Report = {
  dark: boolean;
  app: Styles;
  structure: {
    images: number;
    iconFonts: number;
    railSvgs: number;
    railPath: string[];
  };
  heads: Record<string, Record<string, number | string | null>>;
  edgeLines: number;
  links: number;
  linkText: number;
};

const EXPECTED: Record<"light" | "dark", Styles> = {
  light: {
    rail: {
      width: "44px",
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      "background-color": "rgb(255, 255, 255)",
      "box-sizing": "border-box",
      "padding-top": "12px",
      "border-left-width": "1px",
      "border-left-color": "rgb(216, 222, 228)",
    },
    railButton: {
      width: "32px",
      height: "32px",
      color: "rgb(89, 99, 110)",
      "background-color": "rgba(0, 0, 0, 0)",
      "border-top-left-radius": "4px",
    },
    panel: {
      width: "340px",
      "box-sizing": "border-box",
      "background-color": "rgb(255, 255, 255)",
      "overflow-x": "auto",
      "overflow-y": "auto",
      "padding-top": "12px",
      "padding-right": "12px",
      "padding-bottom": "12px",
      "padding-left": "12px",
      "border-left-width": "1px",
      "border-left-color": "rgb(216, 222, 228)",
    },
    close: {
      width: "22px",
      height: "22px",
      color: "rgb(89, 99, 110)",
      "border-top-left-radius": "4px",
      "background-color": "rgba(0, 0, 0, 0)",
    },
    tabs: {
      display: "flex",
      "column-gap": "4px",
      "margin-bottom": "8px",
      "border-bottom-width": "1px",
      "border-bottom-color": "rgb(216, 222, 228)",
    },
    tabOn: {
      "padding-top": "6px",
      "padding-left": "8px",
      color: "rgb(31, 35, 40)",
      "font-weight": "600",
      "font-size": "12px",
      "box-shadow": "rgb(9, 105, 218) 0px -2px 0px 0px inset",
      "background-color": "rgba(0, 0, 0, 0)",
    },
    tabOff: {
      "padding-top": "6px",
      "padding-left": "8px",
      color: "rgb(89, 99, 110)",
      "font-weight": "400",
      "font-size": "12px",
      "box-shadow": "none",
      "background-color": "rgba(0, 0, 0, 0)",
    },
  },
  dark: {
    rail: {
      width: "44px",
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      "background-color": "rgb(31, 35, 40)",
      "box-sizing": "border-box",
      "padding-top": "12px",
      "border-left-width": "1px",
      "border-left-color": "rgb(48, 54, 61)",
    },
    railButton: {
      width: "32px",
      height: "32px",
      color: "rgb(145, 152, 161)",
      "background-color": "rgba(0, 0, 0, 0)",
      "border-top-left-radius": "4px",
    },
    panel: {
      width: "340px",
      "box-sizing": "border-box",
      "background-color": "rgb(31, 35, 40)",
      "overflow-x": "auto",
      "overflow-y": "auto",
      "padding-top": "12px",
      "padding-right": "12px",
      "padding-bottom": "12px",
      "padding-left": "12px",
      "border-left-width": "1px",
      "border-left-color": "rgb(48, 54, 61)",
    },
    close: {
      width: "22px",
      height: "22px",
      color: "rgb(145, 152, 161)",
      "border-top-left-radius": "4px",
      "background-color": "rgba(0, 0, 0, 0)",
    },
    tabs: {
      display: "flex",
      "column-gap": "4px",
      "margin-bottom": "8px",
      "border-bottom-width": "1px",
      "border-bottom-color": "rgb(48, 54, 61)",
    },
    tabOn: {
      "padding-top": "6px",
      "padding-left": "8px",
      color: "rgb(230, 237, 243)",
      "font-weight": "600",
      "font-size": "12px",
      "box-shadow": "rgb(68, 147, 248) 0px -2px 0px 0px inset",
      "background-color": "rgba(0, 0, 0, 0)",
    },
    tabOff: {
      "padding-top": "6px",
      "padding-left": "8px",
      color: "rgb(145, 152, 161)",
      "font-weight": "400",
      "font-size": "12px",
      "box-shadow": "none",
      "background-color": "rgba(0, 0, 0, 0)",
    },
  },
};

async function prepare(scheme: "light" | "dark"): Promise<Report> {
  const entryDir = mkdtempSync(join(tmpdir(), "inspector-entry-"));
  const dir = mkdtempSync(join(tmpdir(), "inspector-look-"));

  try {
    writeFileSync(join(entryDir, "entry.ts"), ENTRY);

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
    writeFileSync(join(dir, "page.html"), PAGE(css));

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
      { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
    );
    const match = /<pre id="out">([\s\S]*?)<\/pre>/.exec(run.stdout);

    if (!match) {
      throw new Error(
        `no report from the page: ${run.stderr.slice(0, 400)} ${run.error}`,
      );
    }

    return JSON.parse(
      (match[1] as string)
        .replaceAll("&quot;", '"')
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&"),
    ) as Report;
  } finally {
    rmSync(entryDir, { recursive: true, force: true, maxRetries: 10 });
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}

describe("the inspector, in a real browser", () => {
  for (const scheme of ["light", "dark"] as const) {
    it.skipIf(chrome === undefined)(
      `computes the designed styles in ${scheme}`,
      async () => {
        const report = await prepare(scheme);

        expect(report.dark).toBe(scheme === "dark");

        for (const name of Object.keys(EXPECTED[scheme])) {
          expect(report.app[name]).not.toHaveProperty("missing");
          expect({ [name]: report.app[name] }).toEqual({
            [name]: EXPECTED[scheme][name],
          });
        }
      },
      120000,
    );
  }

  it.skipIf(chrome === undefined)(
    "cuts a long name to one line with an ellipsis and puts the folder below",
    async () => {
      const { heads } = await prepare("light");
      const long = heads.long as Record<string, number | string>;
      const short = heads.short as Record<string, number | string>;

      expect(long.nameHeight).toBe(long.line);
      expect(long.nameScroll as number).toBeGreaterThan(
        long.nameClient as number,
      );
      expect(long.overflow).toBe("ellipsis");
      expect(long.nameTitle).toBe(long.nameText);
      expect((long.nameTitle as string).length).toBe(123);
      expect(long.folderTop as number).toBeGreaterThanOrEqual(
        long.nameBottom as number,
      );
      expect(long.folderTitle).toBe(long.folderText);
      expect(long.closeRight as number).toBeLessThanOrEqual(
        long.panelRight as number,
      );
      expect(short.nameScroll).toBe(short.nameClient);
    },
    120000,
  );

  it.skipIf(chrome === undefined)(
    "renders one line when the folder line is empty",
    async () => {
      const report = await prepare("light");

      expect(report.edgeLines).toBe(1);
    },
    120000,
  );

  it.skipIf(chrome === undefined)(
    "shows no links to other modules in Contents",
    async () => {
      const report = await prepare("light");

      expect(report.links).toBe(0);
      expect(report.linkText).toBe(0);
    },
    120000,
  );

  it.skipIf(chrome === undefined)(
    "draws every icon as one inline svg and uses no images or icon fonts",
    async () => {
      const { structure } = await prepare("light");

      expect(structure.images).toBe(0);
      expect(structure.iconFonts).toBe(0);
      expect(structure.railSvgs).toBe(1);
      expect(structure.railPath).toContain("M15 4v16");
    },
    120000,
  );
});
