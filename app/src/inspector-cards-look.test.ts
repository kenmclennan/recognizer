import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, FAKE_WORKER, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { showExplorer } from ${JSON.stringify(here("explorer.ts"))};
${FAKE_WORKER}

const members = [
  { name: "K", kind: "constant", exported: true, value: "30000", line: 2 },
  { name: "C", kind: "class", exported: true, line: 3, bases: ["Exception", "Base"],
    fields: [
      { name: "a", type: "int", line: 4, private: false },
      { name: "_b", line: 7, private: true },
    ],
    methods: [
      { name: "go", line: 5, params: [{ name: "x", type: "int" }, { name: "y" }], returns: "string" },
      { name: "_h", line: 9, params: [], private: true },
    ] },
  { name: "f", kind: "function", exported: true, line: 11, params: [], returns: "void" },
  { name: "Alias", kind: "type", exported: true, line: 13 },
  { name: "_g", kind: "function", exported: false, line: 14, params: [] },
  { name: "I", kind: "interface", exported: true, line: 16, bases: [], fields: [], methods: [] },
];
const scan = {
  modules: [
    { id: "p/m.py", kind: "module", members },
    { id: "p/o.py", kind: "module", members: [{ name: "only", kind: "function", exported: true, line: 1, params: [] }] },
  ],
  edges: [],
  foreign: [],
};
const loaded = { modules: scan.modules.map((m) => m.id), scans: [{ file: "scan.json", scan }], policy: null, notices: [], blocking: null, findings: [], sensors: [] };

const tick = () => new Promise((resolve) => setTimeout(resolve, 40));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const host = document.getElementById("content");
const q = (selector) => host.querySelector(selector);
const qa = (selector) => [...host.querySelectorAll(selector)];
const cs = (node) => getComputedStyle(node);

function newStorage(seed) {
  const memory = new Map(seed ? [["recognizer.show-private", seed]] : []);
  return {
    memory,
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => { memory.set(key, value); },
  };
}

const noop = () => {};

async function open(storage) {
  host.replaceChildren();
  const explorer = showExplorer(host, loaded, "demo", noop, undefined, noop, null, undefined, storage);
  await tick();
  return explorer;
}

async function select(id) {
  if (!q('.tree .row[data-path="' + id + '"]')) {
    click(q('.tree .row[data-path="p"] .name'));
    await tick();
  }
  const check = q('.tree .row[data-path="' + id + '"] .rcheck');
  if (check.getAttribute("aria-checked") !== "true") {
    click(check);
    await tick();
  }
  click(q('.box[data-id="' + id + '"] .box-body'));
  await tick();
  if (!q(".inspector-panel .pswitch")) {
    click(q('.selection-bar [aria-label^="Contents"]'));
    await tick();
  }
}

function snap() {
  const cards = qa(".inspector-panel .card");
  const tk = (cls, scope) => {
    const node = (scope || q(".inspector-panel")).querySelector("." + cls);
    return node ? { color: cs(node).color, weight: cs(node).fontWeight } : null;
  };
  const cardOf = (hover) => cards.find((card) => card.querySelector(".card-code").textContent.includes(hover));
  const classCard = cardOf("class C");
  const fnCard = cardOf("f()");
  const constCard = cardOf("K");
  const privFn = cardOf("_g");
  const style = (node) => {
    const s = cs(node);
    const label = cs(node.querySelector(".card-kind"));
    return {
      bg: s.backgroundColor,
      borderColor: s.borderTopColor,
      borderWidth: s.borderTopWidth,
      edgeWidth: s.borderLeftWidth,
      edgeColor: s.borderLeftColor,
      opacity: s.opacity,
      labelColor: label.color,
      labelSize: label.fontSize,
      labelCase: label.textTransform,
      labelWeight: label.fontWeight,
      lineColor: cs(node.querySelector(".card-line")).color,
    };
  };
  return {
    switchOn: q(".inspector-panel .pswitch")?.getAttribute("aria-checked"),
    switchBeforeCards: q(".inspector-panel .pswitch")?.compareDocumentPosition(q(".inspector-panel .card")) === Node.DOCUMENT_POSITION_FOLLOWING,
    labels: cards.map((card) => card.querySelector(".card-kind").textContent),
    lines: cards.map((card) => card.querySelector(".card-label .card-line").textContent),
    edges: cards.map((card) => cs(card).borderLeftColor),
    kinds: cards.map((card) => cs(card.querySelector(".card-kind")).color),
    memberLines: classCard ? [...classCard.querySelectorAll(".card-member .card-line")].map((n) => n.textContent) : [],
    hidden: classCard?.querySelector(".card-hidden")?.textContent ?? null,
    tokens: {
      keyword: tk("tk-keyword", classCard),
      name: tk("tk-name", classCard),
      type: tk("tk-type", classCard),
      param: tk("tk-param", classCard),
      plain: tk("tk-plain", classCard),
      value: tk("tk-value", constCard),
      builtIn: tk("tk-keyword", fnCard),
    },
    builtInText: fnCard?.querySelector(".tk-keyword")?.textContent ?? null,
    classStyle: classCard ? style(classCard) : null,
    privCard: privFn ? { opacity: cs(privFn).opacity, mark: !!privFn.querySelector(".pmark") } : null,
    privLines: classCard ? [...classCard.querySelectorAll(".card-member.priv")].map((n) => ({ opacity: cs(n).opacity, mark: n.querySelector(".pmark")?.textContent ?? null })) : [],
    cardCount: cards.length,
  };
}

(async () => {
  const facts = {};
  const storage = newStorage(null);
  let explorer = await open(storage);

  await select("p/m.py");
  facts.off = snap();

  click(q(".inspector-panel .pswitch"));
  await tick();
  facts.on = snap();
  facts.stored = storage.memory.get("recognizer.show-private");

  await select("p/o.py");
  facts.otherModule = snap().switchOn;
  await select("p/m.py");
  facts.backAgain = snap().switchOn;

  explorer.dispose();
  await open(storage);
  await select("p/m.py");
  facts.newWindow = snap().switchOn;

  explorer = await open(newStorage(null));
  await select("p/m.py");
  facts.emptyStorage = snap().switchOn;

  explorer = await open(newStorage("1"));
  await select("p/m.py");
  facts.badStorage = snap().switchOn;

  localStorage.setItem("recognizer.show-private", "true");
  facts.realStorage = localStorage.getItem("recognizer.show-private");

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

const PINNED = {
  light: {
    class: "#8250df",
    function: "#0969da",
    type: "#1a7f37",
    interface: "#bf3989",
    constant: "#9a6700",
    keyword: "#cf222e",
    name: "#8250df",
    typeToken: "#0550ae",
    param: "#953800",
    value: "#0a3069",
    punct: "#57606a",
    bg: "#f6f8fa",
    border: "#d8dee4",
  },
  dark: {
    class: "#bc8cff",
    function: "#58a6ff",
    type: "#3fb950",
    interface: "#f778ba",
    constant: "#d29922",
    keyword: "#ff7b72",
    name: "#d2a8ff",
    typeToken: "#79c0ff",
    param: "#ffa657",
    value: "#a5d6ff",
    punct: "#8b949e",
    bg: "#262c33",
    border: "#3d444d",
  },
};

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);

  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
};

type Token = { color: string; weight: string } | null;
type Snap = {
  switchOn: string;
  switchBeforeCards: boolean;
  labels: string[];
  lines: string[];
  edges: string[];
  kinds: string[];
  memberLines: string[];
  hidden: string | null;
  tokens: Record<string, Token>;
  builtInText: string | null;
  classStyle: Record<string, string>;
  privCard: { opacity: string; mark: boolean } | null;
  privLines: { opacity: string; mark: string | null }[];
  cardCount: number;
};
type Facts = {
  off: Snap;
  on: Snap;
  stored: string;
  otherModule: string;
  backAgain: string;
  newWindow: string;
  emptyStorage: string;
  badStorage: string;
  realStorage: string;
};

describe.skipIf(chrome === undefined)("the Contents cards", () => {
  const facts = {} as Record<"light" | "dark", Facts>;

  beforeAll(async () => {
    facts.light = await collectFacts<Facts>(HARNESS, "cards-light", "light");
    facts.dark = await collectFacts<Facts>(HARNESS, "cards-dark", "dark");
  }, 240000);

  for (const scheme of ["light", "dark"] as const) {
    const pin = PINNED[scheme];

    it(`lists cards in file order with labels, lines and edge colours in ${scheme}`, () => {
      const { off } = facts[scheme];

      expect(off.labels).toEqual([
        "Constant",
        "Class",
        "Function",
        "Type",
        "Interface",
      ]);
      expect(off.lines).toEqual(["2", "3", "11", "13", "16"]);
      expect(off.edges).toEqual(
        [pin.constant, pin.class, pin.function, pin.type, pin.interface].map(
          rgb,
        ),
      );
      expect(off.kinds).toEqual(off.edges);
      expect(off.switchBeforeCards).toBe(true);
    });

    it(`colours each token role and bolds the name in ${scheme}`, () => {
      const { tokens } = facts[scheme].off;

      expect(tokens.keyword?.color).toBe(rgb(pin.keyword));
      expect(tokens.name?.color).toBe(rgb(pin.name));
      expect(tokens.name?.weight).toBe("700");
      expect(tokens.type?.color).toBe(rgb(pin.typeToken));
      expect(tokens.param?.color).toBe(rgb(pin.param));
      expect(tokens.value?.color).toBe(rgb(pin.value));
      expect(tokens.plain?.color).toBe(rgb(pin.punct));
      expect(facts[scheme].off.builtInText).toBe("void");
      expect(tokens.builtIn?.color).toBe(rgb(pin.keyword));
    });

    it(`styles the card surface and label in ${scheme}`, () => {
      const style = facts[scheme].off.classStyle;

      expect(style.bg).toBe(rgb(pin.bg));
      expect(style.borderColor).toBe(rgb(pin.border));
      expect(style.borderWidth).toBe("1px");
      expect(style.edgeWidth).toBe("3px");
      expect(style.labelSize).toBe("10px");
      expect(style.labelCase).toBe("uppercase");
      expect(style.labelWeight).toBe("600");
    });
  }

  it("interleaves a class's fields and methods by line", () => {
    expect(facts.light.on.memberLines).toEqual(["4", "5", "7", "9"]);
  });

  it("hides private members and counts them while the switch is off", () => {
    const { off } = facts.light;

    expect(off.switchOn).toBe("false");
    expect(off.memberLines).toEqual(["4", "5"]);
    expect(off.hidden).toBe("1 private field, 1 private method hidden");
    expect(off.labels).not.toContain("Function private");
    expect(off.cardCount).toBe(5);
  });

  it("shows private members dimmed and marked when the switch is on", () => {
    const { on } = facts.light;

    expect(on.switchOn).toBe("true");
    expect(on.hidden).toBeNull();
    expect(on.cardCount).toBe(6);
    expect(Number(on.privCard?.opacity)).toBe(0.55);
    expect(on.privCard?.mark).toBe(true);
    expect(on.privLines).toEqual([
      { opacity: "0.55", mark: "private" },
      { opacity: "0.55", mark: "private" },
    ]);
    expect(facts.dark.on.privCard?.opacity).toBe("0.55");
  });

  it("remembers the switch across modules, windows and launches", () => {
    const f = facts.light;

    expect(f.stored).toBe("true");
    expect(f.otherModule).toBe("true");
    expect(f.backAgain).toBe("true");
    expect(f.newWindow).toBe("true");
    expect(f.emptyStorage).toBe("false");
    expect(f.badStorage).toBe("false");
    expect(f.realStorage).toBe("true");
  });
});
