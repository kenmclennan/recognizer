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
import { buildSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { BOX_HEIGHT, FOLDER_BOX_HEIGHT, FRAME_TOP } from "./canvas-layout";

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

const TOKENS = [
  "bg",
  "fg",
  "muted",
  "faint",
  "panel",
  "line",
  "box",
  "boxline",
  "sel",
  "selbg",
  "frame",
  "framefg",
  "framebg",
  "ok",
  "warn",
  "bad",
  "priv",
  "inf",
  "impl",
  "code",
  "dark",
  "darkfg",
];

const HARNESS = `
import { buildCanvasView } from "./canvas-view";

window.addEventListener("error", (event) => {
  document.getElementById("out").textContent = "ERR " + event.message + " " + (event.error && event.error.stack);
});
const TOKENS = ${JSON.stringify(TOKENS)};
const calls = [];
let selectHook = null;
const actions = {
  find() {}, select: (selection) => selectHook && selectHook(selection), clear: () => calls.push("clear"), setShowInferred() {},
  measure: (t) => t.length * 7,
  takeOff: () => calls.push("takeOff"), toggleFold: () => calls.push("fold"), openContents: () => calls.push("contents"),
  toggleFocus: () => calls.push("focus"), openTab: (t) => calls.push("tab:" + t),
};

const rect = (x, y, width, height) => ({ x, y, width, height });
const line = (id, style, dash, count, points) => ({
  id, points, style, dash, count,
  countAt: count > 1 ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 } : null,
});
const arrow = (lineId, hollow) => ({ lineId, hollow, points: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }] });
const scene = {
  drawOrder: ["frames", "lines", "boxes"],
  bounds: rect(0, 0, 420, 320),
  frames: [{ path: "f", rect: rect(0, 0, 300, 200), label: "f", figure: "1 of 2", disc: "green", labelRect: rect(0, 0, 300, 28) }],
  boxes: [
    { id: "f/a.py", kind: "module", rect: rect(14, 40, 160, 40), label: "a", figures: "+1↓ +2↑", subline: "", disc: "green" },
    { id: "g", kind: "folder", rect: rect(14, 240, 160, 50), label: "g/", figures: "", subline: "3 open, folded", disc: "amber" },
  ],
  lines: [
    line("plain", "plain", null, 2, [{ x: 20, y: 90 }, { x: 20, y: 140 }]),
    line("private", "private", "4 3", 1, [{ x: 60, y: 90 }, { x: 60, y: 140 }]),
    line("inferred", "inferred", "1.5 3", 1, [{ x: 100, y: 90 }, { x: 100, y: 140 }]),
    line("hollow", "hollow", null, 1, [{ x: 140, y: 90 }, { x: 140, y: 140 }]),
  ],
  arrows: [arrow("plain", false), arrow("private", false), arrow("inferred", false), arrow("hollow", true)],
};
const bar = (over) => ({ kind: "folder", dependencies: 2, files: { open: 1, held: 2 }, focused: false, folded: false, inspectorTab: null, ...over });
const props = (over) => ({
  scene, selection: null, highlight: null, bar: null, titles: new Map(),
  open: 3, total: 5, showInferred: true, notice: null, ...over,
});

const wrap = document.createElement("div");
wrap.style.cssText = "position: relative; width: 900px; height: 600px; display: flex;";
document.body.append(wrap);
const clock = { now: 0, next: 0, tasks: new Map() };
const scheduler = {
  after(fn, ms) { clock.next += 1; clock.tasks.set(clock.next, { at: clock.now + ms, fn }); return clock.next; },
  cancel(handle) { clock.tasks.delete(handle); },
};
const advance = (ms) => {
  clock.now += ms;
  for (const [id, task] of [...clock.tasks]) if (task.at <= clock.now) { clock.tasks.delete(id); task.fn(); }
};
const canvas = buildCanvasView(actions, scheduler);
canvas.element.style.flex = "1";
wrap.append(canvas.element);

const host = document.createElement("div");
document.body.append(host);
const shadow = host.attachShadow({ mode: "open" });
shadow.innerHTML = "<style>:host{display:block;color:var(--fg)}" + window.PROTO_CSS + "</style><div id='stage'></div>";
const g = (cls, inner) => '<g class="' + cls + '">' + inner + '</g>';
shadow.getElementById("stage").insertAdjacentHTML("beforeend",
  '<svg id="pe">' +
  g("fr", '<rect width="10" height="10" rx="8"/>') + g("fr s", '<rect width="10" height="10" rx="8"/>') +
  '<path class="e"/><path class="e pv"/><path class="e inf"/><path class="e impl"/><path class="e hi"/><path class="e hi inf"/><g class="e dim"></g>' +
  '<path class="ar"/><path class="arhi"/><path class="ah"/><text class="el">2</text>' +
  '<g class="fr"><text>f/ <tspan class="cnt">1 of 2</tspan></text></g>' +
  g("n s", '<rect class="halo"/><rect width="10" height="10" rx="7"/><text>a</text>') +
  g("n f", '<rect width="10" height="10"/><text>g/</text>') + g("n", '<rect width="10" height="10"/><text class="more">+1</text>') +
  '</svg>' +
  '<div id="zbar" class="float"><button>-</button><span class="z" id="zl">100%</span><button>+</button></div>' +
  '<div id="tbar" class="show"><span class="tsep"></span><button><svg class="i" viewBox="0 0 24 24"><path d="M1 1"/></svg>Uses</button></div>' +
  '<div id="hint">a<br>b</div>');

const pick = (node, names) => {
  if (!node) return { missing: true };
  const style = getComputedStyle(node);
  const out = {};
  for (const name of names) out[name] = style.getPropertyValue(name);
  return out;
};
const q = (sel) => canvas.element.querySelector(sel);
const p = (sel) => shadow.querySelector(sel);
const probe = (root) => {
  const node = document.createElement("i");
  root.append(node);
  const out = {};
  for (const token of TOKENS) {
    node.style.color = "var(--" + token + ")";
    out[token] = getComputedStyle(node).color;
  }
  node.remove();
  return out;
};
const STROKE = ["stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "fill", "opacity"];
const PANEL = ["background-color", "border-top-width", "border-top-color", "border-top-left-radius", "padding-top", "padding-left", "font-size", "color"];
const kids = (node) => [...node.children].map((child) => ({
  tag: child.tagName.toLowerCase(),
  cls: child.getAttribute("class"),
  text: child.textContent,
  aria: child.getAttribute("aria-label"),
  title: child.title,
  disabled: child.disabled === true,
  svgs: [...child.querySelectorAll("svg")].map((svg) => ({
    cls: svg.getAttribute("class"),
    path: svg.querySelector("path")?.getAttribute("d"),
    strokeWidth: getComputedStyle(svg).strokeWidth,
    width: getComputedStyle(svg).width,
  })),
}));

const result = { dark: matchMedia("(prefers-color-scheme: dark)").matches };
result.tokens = { app: probe(document.body), proto: probe(shadow) };
result.window = { body: pick(document.body, ["background-color", "color", "font-size"]), proto: getComputedStyle(document.body).backgroundColor };

canvas.render(props({ selection: { kind: "module", id: "f/a.py" }, highlight: new Set(["private"]), bar: bar({ kind: "module", files: null }) }));
const lineGroup = (id) => q('[data-line="' + id + '"]');
const edgeOf = (id) => pick(lineGroup(id).querySelector(".edge"), STROKE);
const arrowOf = (id) => pick(lineGroup(id).querySelector(".arrow"), STROKE);
result.edges = {
  plain: edgeOf("plain"), inferred: edgeOf("inferred"), hollow: edgeOf("hollow"), private: edgeOf("private"),
  dimmed: pick(lineGroup("plain"), ["opacity"]),
  arrowPlain: arrowOf("plain"), arrowHollow: arrowOf("hollow"), arrowHi: arrowOf("private"),
  count: pick(q(".count-label"), ["font-size", "fill"]),
  countText: q(".count-label").textContent,
  countLabels: canvas.element.querySelectorAll(".count-label").length,
  proto: {
    plain: pick(p(".e:not(.pv):not(.inf):not(.impl):not(.hi)"), STROKE), private: pick(p(".e.pv"), STROKE),
    inferred: pick(p(".e.inf:not(.hi)"), STROKE), hollow: pick(p(".e.impl"), STROKE), hi: pick(p(".e.hi:not(.inf)"), STROKE),
    dim: pick(p("g.e.dim"), ["opacity"]), arrow: pick(p(".ar"), STROKE), arrowHi: pick(p(".arhi"), STROKE),
    hollowArrow: pick(p(".ah"), STROKE), count: pick(p(".el"), ["font-size", "fill"]),
  },
};
result.boxes = {
  rxs: [...canvas.element.querySelectorAll(".box-body")].map((r) => [r.getAttribute("rx"), r.getAttribute("height")]),
  selected: pick(q('[data-id="f/a.py"] .box-body'), STROKE),
  halo: { ...pick(q('[data-id="f/a.py"] .halo'), ["display", "stroke", "stroke-opacity", "stroke-width", "fill"]), box: [q('[data-id="f/a.py"] .halo').getAttribute("x"), q('[data-id="f/a.py"] .halo').getAttribute("width")] },
  idleHalo: pick(q('[data-id="g"] .halo'), ["display"]),
  nameSelected: pick(q('[data-id="f/a.py"] .name'), ["font-weight", "font-size", "fill"]),
  nameIdle: pick(q('[data-id="g"] .name'), ["font-weight", "fill"]),
  hidden: pick(q('[data-id="f/a.py"] .figure'), ["font-size", "fill"]),
  hiddenText: q('[data-id="f/a.py"] .figure').textContent,
  folder: { body: pick(q('[data-id="g"] .box-body'), STROKE), name: q('[data-id="g"] .name').textContent, texts: [...q('[data-id="g"]').querySelectorAll("text")].map((t) => [t.textContent, getComputedStyle(t).fontSize, getComputedStyle(t).fill]) },
  proto: { selected: pick(p(".n.s rect:nth-child(2)"), STROKE), halo: pick(p(".n.s .halo"), ["stroke", "stroke-opacity", "stroke-width", "fill"]), folder: pick(p(".n.f rect"), STROKE), folderName: pick(p(".n.f text"), ["fill"]), more: pick(p(".n .more"), ["font-size", "fill"]) },
};
result.frameIdle = { ...pick(q(".frame-body"), STROKE), rx: q(".frame-body").getAttribute("rx") };
result.barModule = { kids: kids(q(".selection-bar")), style: pick(q(".selection-bar"), [...PANEL, "box-shadow", "display"]) };

canvas.render(props({ selection: { kind: "folder", id: "f" }, bar: bar() }));
result.frames = {
  body: result.frameIdle,
  label: pick(q(".frame-label"), ["fill", "stroke"]),
  selected: pick(q(".frame-body"), STROKE),
  parts: [...q(".frame").children].map((c) => c.tagName.toLowerCase() + "." + (c.getAttribute("class") || "")),
  name: pick(q(".frame-text .name"), ["font-weight", "fill", "font-size"]),
  nameText: q(".frame-text .name").textContent,
  cnt: pick(q(".frame-text .cnt"), ["fill", "font-weight"]),
  cntText: q(".frame-text .cnt").textContent,
  proto: { body: pick(p(".fr:not(.s) rect"), STROKE), selected: pick(p(".fr.s rect"), STROKE), text: pick(p(".fr text"), ["font-size", "fill"]), cnt: pick(p(".fr .cnt"), ["fill"]) },
};
q(".frame-label").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
result.frames.labelHover = pick(q(".frame-label"), ["fill", "stroke"]);
result.barFolder = {
  kids: kids(q(".selection-bar")),
  style: pick(q(".selection-bar"), [...PANEL, "box-shadow", "display"]),
  button: pick(q(".selection-bar .bar-button"), ["height", "border-top-left-radius", "padding-left", "font-size", "column-gap", "color", "background-color"]),
  sep: pick(q(".bar-sep"), ["width", "height", "background-color"]),
  proto: { bar: pick(p("#tbar"), [...PANEL, "box-shadow", "display"]), button: pick(p("#tbar button"), ["height", "border-top-left-radius", "padding-left", "font-size", "column-gap", "color", "background-color"]), sep: pick(p("#tbar .tsep"), ["width", "height"]) },
};
const clickBar = (aria) => q('.selection-bar [aria-label="' + aria + '"]').click();
calls.length = 0;
clickBar("Fold into one box (Z)");
clickBar("Only this folder (F)");
clickBar("Take off the canvas (Backspace)");
clickBar("Dependencies (D)");
clickBar("Pick files in it (I)");
result.barClicks = [...calls];
canvas.render(props({ selection: { kind: "folder", id: "f" }, bar: bar({ folded: true, focused: true }) }));
result.barFolded = kids(q(".selection-bar")).slice(-5).map((k) => [k.aria, k.title]);
canvas.render(props({ selection: { kind: "folder", id: "f" }, bar: bar({ dependencies: 0 }) }));
calls.length = 0;
const zeroDependencies = q('.selection-bar [aria-label="Dependencies (D)"]');
zeroDependencies.click();
result.barZero = { disabled: zeroDependencies.disabled, text: zeroDependencies.textContent, calls: [...calls] };

result.chrome = {
  topStrip: q(".canvas-bar") === null,
  countInCanvas: q("#canvas-count") !== null || q(".canvas-count") !== null,
  treeToggle: q(".tree-toggle") !== null,
  panelIcon: q(".canvas > button svg.i") !== null,
};
const hint = q(".empty-canvas");
result.hint = {
  text: hint.innerHTML,
  textContent: hint.textContent,
  shown: getComputedStyle(hint).display !== "none",
  style: pick(hint, ["text-align", "color", "position", "top", "line-height"]),
  proto: { style: pick(p("#hint"), ["text-align", "color", "position", "top", "line-height"]), html: p("#hint").innerHTML },
};
canvas.render(props({ open: 0, scene: null }));
result.hint.shownWhenEmpty = getComputedStyle(hint).display !== "none";

canvas.render(props());
const controls = q(".controls");
const buttons = () => [...controls.querySelectorAll("button")];
const byText = (t) => buttons().find((b) => b.textContent === t);
const levelNode = () => controls.querySelector(".level");
result.zoom = {
  order: [...controls.children].map((c) => c.textContent),
  tags: [...controls.children].map((c) => c.tagName.toLowerCase()),
  aria: [byText("\\u2212").getAttribute("aria-label"), byText("+").getAttribute("aria-label")],
  panel: pick(controls, [...PANEL, "position", "right", "bottom"]),
  level: pick(levelNode(), ["width", "color", "font-size", "text-align"]),
  button: pick(byText("Fit"), ["height", "min-width", "border-top-left-radius", "padding-left", "background-color"]),
  proto: { panel: pick(p("#zbar"), [...PANEL, "position", "right", "bottom"]), level: pick(p("#zl"), ["width", "color", "font-size", "text-align"]), button: pick(p("#zbar button"), ["height", "min-width", "border-top-left-radius", "padding-left", "background-color"]) },
};
const stepsTo = (text, name) => { for (let i = 0; i < 60; i++) byText(name).click(); return [levelNode().textContent, byText(name).disabled, byText(text === "+" ? "\\u2212" : "+").disabled]; };
result.zoom.atMax = stepsTo("+", "+");
result.zoom.atMin = stepsTo("\\u2212", "\\u2212");
byText("+").click();
result.zoom.afterIn = [levelNode().textContent, byText("\\u2212").disabled, byText("+").disabled];
calls.length = 0;
byText("Clear").click();
result.zoom.clear = [...calls];

canvas.render(props({ selection: { kind: "module", id: "g" }, neighbourhood: new Set(["g"]), bar: null }));
result.dimming = {
  unrelatedBox: pick(q('[data-id="f/a.py"]'), ["opacity"]),
  unrelatedFrame: pick(q(".frame"), ["opacity"]),
  relatedBox: pick(q('[data-id="g"]'), ["opacity"]),
};
canvas.render(props({ selection: { kind: "module", id: "f/a.py" }, neighbourhood: new Set(["f/a.py"]), bar: null }));
result.dimming.relatedFrame = pick(q(".frame"), ["opacity"]);
result.dimming.nothingSelected = (canvas.render(props()), pick(q(".frame"), ["opacity"]));

const boxOf = () => q('[data-id="f/a.py"]').getBoundingClientRect();
const barBox = () => q(".selection-bar").getBoundingClientRect();
const offsetOf = () => ({ dx: barBox().left + barBox().width / 2 - (boxOf().left + boxOf().width / 2), dy: boxOf().top - barBox().top });
const panBy = (dx, dy) => q(".stage").dispatchEvent(new WheelEvent("wheel", { deltaX: -dx, deltaY: -dy, bubbles: true, cancelable: true }));
canvas.render(props({ selection: { kind: "module", id: "f/a.py" }, bar: bar({ kind: "module", files: null }) }));
const beforePan = { offset: offsetOf(), box: boxOf().left };
panBy(-1200, 0);
const afterPan = { offset: offsetOf(), box: boxOf().left, bar: barBox().right, canvasLeft: canvas.element.getBoundingClientRect().left };
panBy(1200, 0);
byText("+").click();
byText("+").click();
const afterZoom = { offset: offsetOf(), box: boxOf().width };
const stageBox = q(".stage").getBoundingClientRect();
canvas.render(props());
canvas.element.querySelector('[data-id="f/a.py"]').dispatchEvent(new MouseEvent("contextmenu", { clientX: stageBox.left + 333, clientY: stageBox.top + 222, bubbles: true, cancelable: true }));
canvas.render(props({ selection: { kind: "module", id: "f/a.py" }, bar: bar({ kind: "module", files: null }) }));
const rightBefore = { x: barBox().left, y: barBox().top };
panBy(-70, 45);
const rightAfter = { x: barBox().left, y: barBox().top };
result.pinned = { beforePan, afterPan, afterZoom, rightBefore, rightAfter };

const moduleBar = () => bar({ kind: "module", files: null });
const barEl = () => q(".selection-bar");
const away = () => barEl().classList.contains("away");
const seen = () => getComputedStyle(barEl()).visibility;
const surfaceEl = q(".surface");
const move = (node) => node.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
const leaveSurface = () => surfaceEl.dispatchEvent(new PointerEvent("pointerleave"));
const nodeA = () => q('[data-id="f/a.py"]');
const hov = {};
selectHook = (selection) => canvas.render(props({ selection, bar: moduleBar() }));
canvas.render(props());
canvas.render(props({ selection: { kind: "module", id: "f/a.py" }, bar: moduleBar() }));
hov.initial = [away(), seen(), barEl().offsetWidth > 0];
move(q('[data-id="g"]'));
hov.otherBox = away();
move(nodeA());
hov.onBox = [away(), seen()];
hov.centre = offsetOf();
leaveSurface();
advance(100);
barEl().dispatchEvent(new PointerEvent("pointerenter"));
advance(1000);
hov.keptOverBar = away();
barEl().dispatchEvent(new PointerEvent("pointerleave"));
advance(299);
hov.justBefore = away();
advance(1);
hov.afterDelay = [away(), seen()];
canvas.render(props());
canvas.render(props({ selection: { kind: "module", id: "f/a.py" }, bar: moduleBar() }));
hov.fromTree = away();
move(nodeA());
canvas.render(props({ selection: { kind: "module", id: "g" }, bar: moduleBar() }));
hov.newSelection = away();
canvas.render(props());
nodeA().dispatchEvent(new MouseEvent("click", { bubbles: true }));
hov.clicked = [away(), seen()];
leaveSurface();
advance(300);
hov.clickedThenLeft = away();
nodeA().dispatchEvent(new MouseEvent("contextmenu", { clientX: stageBox.left + 333, clientY: stageBox.top + 222, bubbles: true, cancelable: true }));
hov.rightClicked = [away(), seen(), barBox().left, stageBox.left + 333];
leaveSurface();
advance(300);
hov.rightClickedThenLeft = away();
hov.iconTitles = [...canvas.element.querySelectorAll("button")].filter((b) => b.querySelector("svg.i")).map((b) => b.title);
hov.barButtonText = [...canvas.element.querySelectorAll(".selection-bar button")].map((b) => b.textContent);
result.hover = hov;
document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(result))));
`;

type Props = Record<string, string>;
type Kid = {
  tag: string;
  cls: string | null;
  text: string;
  aria: string | null;
  title: string;
  disabled: boolean;
  svgs: { cls: string; path: string; strokeWidth: string; width: string }[];
};
type Report = {
  dark: boolean;
  tokens: { app: Props; proto: Props };
  window: { body: Props; proto: string };
  edges: Record<string, Props> & {
    countText: string;
    countLabels: number;
    proto: Record<string, Props>;
  };
  boxes: Record<string, unknown> & {
    rxs: string[][];
    proto: Record<string, Props>;
  };
  frames: Record<string, unknown> & { proto: Record<string, Props> };
  dimming: Record<string, Props>;
  pinned: {
    beforePan: { offset: { dx: number; dy: number }; box: number };
    afterPan: {
      offset: { dx: number; dy: number };
      box: number;
      bar: number;
      canvasLeft: number;
    };
    afterZoom: { offset: { dx: number; dy: number }; box: number };
    rightBefore: { x: number; y: number };
    rightAfter: { x: number; y: number };
  };
  hover: {
    initial: [boolean, string, boolean];
    otherBox: boolean;
    onBox: [boolean, string];
    centre: { dx: number; dy: number };
    keptOverBar: boolean;
    justBefore: boolean;
    afterDelay: [boolean, string];
    fromTree: boolean;
    newSelection: boolean;
    clicked: [boolean, string];
    clickedThenLeft: boolean;
    rightClicked: [boolean, string, number, number];
    rightClickedThenLeft: boolean;
    iconTitles: string[];
    barButtonText: string[];
  };
  barModule: { kids: Kid[]; style: Props };
  barFolder: {
    kids: Kid[];
    style: Props;
    button: Props;
    sep: Props;
    proto: { bar: Props; button: Props; sep: Props };
  };
  barClicks: string[];
  barFolded: string[][];
  barZero: { disabled: boolean; text: string; calls: string[] };
  chrome: {
    topStrip: boolean;
    countInCanvas: boolean;
    treeToggle: boolean;
    panelIcon: boolean;
  };
  hint: {
    text: string;
    textContent: string;
    shown: boolean;
    shownWhenEmpty: boolean;
    style: Props;
    proto: { style: Props; html: string };
  };
  zoom: {
    order: string[];
    tags: string[];
    aria: string[];
    panel: Props;
    level: Props;
    button: Props;
    proto: { panel: Props; level: Props; button: Props };
    atMax: [string, boolean, boolean];
    atMin: [string, boolean, boolean];
    afterIn: [string, boolean, boolean];
    clear: string[];
  };
};

function collect(scheme: "light" | "dark"): Report {
  const dir = mkdtempSync(join(tmpdir(), "canvas-look-"));

  try {
    const bundle = buildSync({
      stdin: { contents: HARNESS, resolveDir: SRC, loader: "ts" },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
    }).outputFiles[0]?.text as string;
    const css = readFileSync(join(SRC, "style.css"), "utf8");
    const protoCss = (
      /<style>([\s\S]*?)<\/style>/.exec(readFileSync(PROTOTYPE, "utf8"))?.[1] ??
      ""
    ).replaceAll(":root{", ":host{");
    const page = join(dir, "page.html");

    writeFileSync(
      page,
      `<!doctype html><html><head><style>${css}</style></head><body><div id="out"></div><script>window.PROTO_CSS=${JSON.stringify(protoCss).replaceAll("</", "<\\/")};</script><script>${bundle.replaceAll("</script", "<\\/script")}</script></body></html>`,
    );

    const run = spawnSync(
      chrome as string,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        `--user-data-dir=${join(dir, "profile")}`,
        `--blink-settings=preferredColorScheme=${scheme === "dark" ? 0 : 1}`,
        "--dump-dom",
        `file://${page}`,
      ],
      { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
    );
    const match = /<div id="out">([^<]*)<\/div>/.exec(run.stdout);

    if (match?.[1]?.startsWith("ERR ")) {
      throw new Error(match[1]);
    }

    if (match === null || !/^[A-Za-z0-9+/=]+$/.test(match[1] as string)) {
      throw new Error(
        `no harness output: ${run.stderr.slice(0, 500)} ${run.error}`,
      );
    }

    return JSON.parse(
      Buffer.from(match[1] as string, "base64").toString("utf8"),
    ) as Report;
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}

const reports = new Map<string, Report>();

function report(scheme: "light" | "dark"): Report {
  let known = reports.get(scheme);

  if (!known) {
    known = collect(scheme);
    reports.set(scheme, known);
  }

  return known;
}

const labelsOf = (kids: Kid[]) =>
  kids.map((kid) => (kid.cls === "bar-sep" ? "|" : kid.aria || kid.text));

describe("the canvas against the prototype, in a real browser", () => {
  for (const scheme of ["light", "dark"] as const) {
    describe(scheme, () => {
      const r = () => report(scheme);

      it.skipIf(chrome === undefined)(
        "uses the prototype's palette for the window and every token",
        () => {
          expect(r().dark).toBe(scheme === "dark");
          expect(r().tokens.app).toEqual(r().tokens.proto);
          expect(r().window.body["background-color"]).toBe(r().tokens.proto.bg);
          expect(r().window.body.color).toBe(r().tokens.proto.fg);
        },
        120000,
      );

      it.skipIf(chrome === undefined)(
        "draws edges as the prototype's .e styles, dimming the rest",
        () => {
          const { edges } = r();
          const proto = edges.proto as Record<string, Props>;

          expect(edges.plain).toEqual(proto.plain);
          expect(edges.plain?.["stroke-width"]).toBe("1px");
          expect(edges.plain?.["stroke-opacity"]).toBe("0.55");
          expect(edges.private?.["stroke-dasharray"]).toBe("4px, 3px");
          expect(edges.inferred?.["stroke-dasharray"]).toBe("1.5px, 3px");
          expect(edges.inferred).toEqual(proto.inferred);
          expect(edges.hollow).toEqual(proto.hollow);
          expect(edges.arrowPlain?.fill).toBe(proto.arrow?.fill);
          expect(edges.arrowHollow?.fill).toBe(proto.hollowArrow?.fill);
          expect(edges.arrowHollow?.stroke).toBe(proto.hollowArrow?.stroke);
          expect(edges.private?.stroke).toBe(proto.hi?.stroke);
          expect(edges.private?.["stroke-width"]).toBe("1.6px");
          expect(edges.private?.["stroke-opacity"]).toBe("1");
          expect(edges.arrowHi?.fill).toBe(proto.arrowHi?.fill);
          expect(edges.dimmed?.opacity).toBe(proto.dim?.opacity);
          expect(edges.dimmed?.opacity).toBe("0.35");
          expect(edges.count).toEqual(proto.count);
          expect(edges.count?.["font-size"]).toBe("10px");
          expect(edges.countText).toBe("2");
          expect(edges.countLabels).toBe(1);
        },
        120000,
      );

      it.skipIf(chrome === undefined)(
        "holds no tree toggle, no bar and no count across the top",
        () => {
          const { chrome: c } = r();

          expect(c.topStrip).toBe(true);
          expect(c.countInCanvas).toBe(false);
          expect(c.treeToggle).toBe(false);
          expect(c.panelIcon).toBe(false);
        },
        120000,
      );

      it.skipIf(chrome === undefined)(
        "draws frames as dashed purple rounded rectangles with a bold label",
        () => {
          const { frames } = r();
          const proto = frames.proto as Record<string, Props>;
          const body = frames.body as Props;

          expect(FRAME_TOP).toBe(28);
          expect(body.rx).toBe("8");
          expect({ ...body, rx: undefined }).toEqual({
            ...proto.body,
            rx: undefined,
          });
          expect(body["stroke-dasharray"]).toBe("4px, 3px");
          expect(frames.parts).toEqual([
            "rect.frame-body",
            "rect.frame-label selected",
            "circle.disc-fill green",
            "text.frame-text",
          ]);
          expect(frames.nameText).toBe("f/");
          expect((frames.name as Props)["font-weight"]).toBe("600");
          expect((frames.name as Props).fill).toBe(proto.text?.fill);
          expect((frames.name as Props)["font-size"]).toBe("11px");
          expect(frames.cntText).toBe("1 of 2");
          expect((frames.cnt as Props).fill).toBe(proto.cnt?.fill);
          expect(frames.selected).toEqual(proto.selected);
          expect((frames.selected as Props)["stroke-dasharray"]).toBe("none");
          expect((frames.selected as Props)["stroke-opacity"]).toBe("1");
          expect(frames.label).toEqual({
            fill: "rgba(0, 0, 0, 0)",
            stroke: "none",
          });
          expect(frames.labelHover).toEqual(frames.label);
        },
        120000,
      );

      it.skipIf(chrome === undefined)(
        "draws boxes 40px high with hidden counts, a halo when selected and a 50px folded box",
        () => {
          const { boxes } = r();
          const proto = boxes.proto as Record<string, Props>;
          const selected = boxes.selected as Props;

          expect([BOX_HEIGHT, FOLDER_BOX_HEIGHT]).toEqual([40, 50]);
          expect(boxes.rxs).toEqual([
            ["7", "40"],
            ["7", "50"],
          ]);
          expect(selected.stroke).toBe(proto.selected?.stroke);
          expect(selected["stroke-width"]).toBe("2px");
          expect(boxes.halo).toMatchObject({
            display: "inline",
            stroke: proto.halo?.stroke,
            "stroke-opacity": "0.15",
            "stroke-width": "6px",
            fill: "none",
            box: ["11", "166"],
          });
          expect(boxes.idleHalo).toEqual({ display: "none" });
          expect((boxes.nameSelected as Props)["font-weight"]).toBe("600");
          expect((boxes.nameIdle as Props)["font-weight"]).toBe("400");
          expect(boxes.hiddenText).toBe("+1↓ +2↑");
          expect(boxes.hidden).toEqual(proto.more);

          const folder = boxes.folder as {
            body: Props;
            name: string;
            texts: string[][];
          };

          expect(folder.name).toBe("g/");
          expect(folder.texts.map((t) => t[0])).toEqual([
            "g/",
            "3 open, folded",
          ]);
          expect(folder.body.fill).toBe(proto.folder?.fill);
          expect(folder.body.stroke).toBe(proto.folder?.stroke);
          expect(folder.body["stroke-opacity"]).toBe("0.5");
          expect(folder.texts[1]?.[1]).toBe("10px");
        },
        120000,
      );

      it.skipIf(chrome === undefined)(
        "shows a dark selection bar of labelled svg icon buttons in the prototype's order",
        () => {
          const { barModule, barFolder, barClicks, barFolded } = r();

          expect(labelsOf(barModule.kids)).toEqual([
            "Dependencies (D)",
            "|",
            "Contents (I)",
            "|",
            "Take off the canvas (Backspace)",
          ]);
          expect(labelsOf(barFolder.kids)).toEqual([
            "Pick files in it (I)",
            "|",
            "Dependencies (D)",
            "|",
            "Only this folder (F)",
            "Fold into one box (Z)",
            "Contents (I)",
            "|",
            "Take off the canvas (Backspace)",
          ]);
          expect(barFolder.style["background-color"]).toBe(
            r().tokens.proto.dark,
          );
          expect(barFolder.style.color).toBe(r().tokens.proto.darkfg);
          expect(barFolder.style["border-top-left-radius"]).toBe("8px");
          expect(barFolder.style["box-shadow"]).not.toBe("none");
          expect(barFolder.style["border-top-left-radius"]).toBe(
            barFolder.proto.bar["border-top-left-radius"],
          );
          expect(barFolder.button).toEqual(barFolder.proto.button);
          expect(barFolder.sep.width).toBe(barFolder.proto.sep.width);
          expect(barFolder.sep.height).toBe(barFolder.proto.sep.height);

          const [files, , dependencies, , focus, fold, contents, , takeOff] =
            barFolder.kids as Kid[];

          expect(files?.text).toBe("1/2");
          expect(files?.svgs).toHaveLength(1);
          expect(dependencies?.text).toBe("2");
          expect(dependencies?.svgs).toHaveLength(1);
          expect(dependencies?.disabled).toBe(false);
          expect(dependencies?.svgs[0]?.strokeWidth).toBe("2px");
          expect(takeOff?.svgs[0]?.path).not.toBe("M18 6L6 18M6 6l12 12");

          for (const button of [
            files,
            dependencies,
            focus,
            fold,
            contents,
            takeOff,
          ]) {
            expect(button?.title).not.toBe("");
            expect(button?.aria).toBe(button?.title);
          }

          for (const icon of [focus, fold, contents, takeOff]) {
            expect(icon?.text).toBe("");
            expect(icon?.svgs).toHaveLength(1);
            expect(icon?.svgs[0]?.strokeWidth).toBe("2px");
          }

          expect(barClicks).toEqual([
            "fold",
            "focus",
            "takeOff",
            "tab:dependencies",
            "tab:contents",
          ]);
          expect(barFolded.slice(0, 2)).toEqual([
            ["Unfocus (F)", "Unfocus (F)"],
            ["Unfold (Z)", "Unfold (Z)"],
          ]);
        },
        120000,
      );

      it.skipIf(chrome === undefined)(
        "disables the Dependencies button and opens no tab when the total is zero",
        () => {
          const { barZero } = r();

          expect(barZero.disabled).toBe(true);
          expect(barZero.text).toBe("0");
          expect(barZero.calls).toEqual([]);
        },
        120000,
      );

      it.skipIf(chrome === undefined)(
        "shows the bar only while the pointer is over the selected box or the bar",
        () => {
          const { hover } = r();

          expect(hover.initial).toEqual([true, "hidden", true]);
          expect(hover.otherBox).toBe(true);
          expect(hover.onBox).toEqual([false, "visible"]);
          expect(Math.abs(hover.centre.dx)).toBeLessThan(1);
          expect(hover.keptOverBar).toBe(false);
          expect(hover.justBefore).toBe(false);
          expect(hover.afterDelay).toEqual([true, "hidden"]);
          expect(hover.fromTree).toBe(true);
          expect(hover.newSelection).toBe(true);
          expect(hover.clicked).toEqual([false, "visible"]);
          expect(hover.clickedThenLeft).toBe(true);
          expect(hover.rightClicked[0]).toBe(false);
          expect(hover.rightClicked[1]).toBe("visible");
          expect(hover.rightClicked[2]).toBeCloseTo(hover.rightClicked[3], 0);
          expect(hover.rightClickedThenLeft).toBe(true);
        },
        120000,
      );

      it.skipIf(chrome === undefined)(
        "gives every icon button a tooltip and shows no word on a bar button",
        () => {
          const { hover } = r();

          expect(hover.iconTitles.length).toBeGreaterThan(0);
          expect(hover.iconTitles.every((title) => title !== "")).toBe(true);

          for (const text of hover.barButtonText) {
            expect(text).toMatch(/^(\d+(\/\d+)?)?$/);
          }
        },
        120000,
      );

      it.skipIf(chrome === undefined)(
        "words the empty hint as the prototype and shows it only on an empty canvas",
        () => {
          const { hint } = r();

          expect(hint.text).toBe(
            "Open a file from the tree to start.<br>Select a box, or a folder by its name, for its actions.",
          );
          expect(readFileSync(PROTOTYPE, "utf8")).toContain(
            `<div id="hint">${hint.text}</div>`,
          );
          expect(hint.shown).toBe(false);
          expect(hint.shownWhenEmpty).toBe(true);
          expect(hint.style["text-align"]).toBe("center");
          expect(hint.style.color).toBe(hint.proto.style.color);
          expect(hint.style["line-height"]).toBe(
            hint.proto.style["line-height"],
          );
        },
        120000,
      );

      it.skipIf(chrome === undefined)(
        "floats a zoom bar that greys out at 10% and 250%",
        () => {
          const { zoom } = r();

          expect(zoom.order.slice(0, 1)).toEqual(["−"]);
          expect(zoom.order[1]).toMatch(/^\d+%$/);
          expect(zoom.order.slice(2)).toEqual(["+", "Fit", "Clear", "Legend"]);
          expect(zoom.tags).toEqual([
            "button",
            "span",
            "button",
            "button",
            "button",
            "button",
          ]);
          expect(zoom.aria).toEqual(["Zoom out", "Zoom in"]);
          expect({ ...zoom.panel, position: "" }).toEqual({
            ...zoom.proto.panel,
            position: "",
          });
          expect(zoom.panel.position).toBe("absolute");
          expect(zoom.panel.right).toBe("14px");
          expect(zoom.panel.bottom).toBe("16px");
          expect(zoom.level).toEqual(zoom.proto.level);
          expect(zoom.level.width).toBe("40px");
          expect(zoom.button).toEqual(zoom.proto.button);
          expect(zoom.atMax).toEqual(["250%", true, false]);
          expect(zoom.atMin).toEqual(["10%", true, false]);
          expect(zoom.afterIn[1]).toBe(false);
          expect(zoom.afterIn[2]).toBe(false);
          expect(zoom.clear).toEqual(["clear"]);
        },
        120000,
      );

      it.skipIf(chrome === undefined)(
        "dims unrelated boxes and frames to 60% and leaves related ones alone",
        () => {
          const { dimming } = r();

          expect(dimming.unrelatedBox?.opacity).toBe("0.6");
          expect(dimming.unrelatedFrame?.opacity).toBe("0.6");
          expect(dimming.relatedBox?.opacity).toBe("1");
          expect(dimming.relatedFrame?.opacity).toBe("1");
          expect(dimming.nothingSelected?.opacity).toBe("1");
        },
        120000,
      );

      it.skipIf(chrome === undefined)(
        "leaves the bar off-canvas with its box, at the same offset, when panned away",
        () => {
          const { beforePan, afterPan } = r().pinned;

          expect(afterPan.box).toBeLessThan(afterPan.canvasLeft - 100);
          expect(afterPan.bar).toBeLessThan(afterPan.canvasLeft);
          expect(afterPan.offset.dx).toBeCloseTo(beforePan.offset.dx, 1);
          expect(afterPan.offset.dy).toBeCloseTo(beforePan.offset.dy, 1);
        },
        120000,
      );

      it.skipIf(chrome === undefined)(
        "keeps the bar centred above its box while zooming",
        () => {
          const { beforePan, afterZoom } = r().pinned;

          expect(afterZoom.box).toBeGreaterThan(0);
          expect(afterZoom.offset.dx).toBeCloseTo(0, 0);
          expect(
            Math.abs(afterZoom.offset.dy - beforePan.offset.dy),
          ).toBeLessThan(3);
        },
        120000,
      );

      it.skipIf(chrome === undefined)(
        "moves a right-click bar by exactly the pan",
        () => {
          const { rightBefore, rightAfter } = r().pinned;

          expect(rightAfter.x - rightBefore.x).toBeCloseTo(-70, 1);
          expect(rightAfter.y - rightBefore.y).toBeCloseTo(45, 1);
        },
        120000,
      );
    });
  }
});
