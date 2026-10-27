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

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((path): path is string => typeof path === "string" && path !== "");

const chrome = CHROME_CANDIDATES.find((path) => existsSync(path));

const here = (name: string) => fileURLToPath(new URL(name, import.meta.url));

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.lineno); });
import { buildLegendView } from ${JSON.stringify(here("legend-view.ts"))};
import { buildCheckbox } from ${JSON.stringify(here("row-view.ts"))};

const calls = [];
const still = document.createElement("style");

still.textContent = ".rcheck, .rcheck::after { transition: none !important; }";
document.head.append(still);

const legend = buildLegendView((show) => calls.push(show));

document.body.append(legend.element);

const rowBox = buildCheckbox("row", "checked", () => {});
const rowOff = buildCheckbox("row", "unchecked", () => {});

document.body.append(rowBox, rowOff);

const look = (node) => {
  const style = getComputedStyle(node);
  return [style.width, style.height, style.borderRadius, style.borderTopColor, style.backgroundColor].join("|");
};

legend.render(true, false);

const box = legend.element.querySelector(".rcheck");
const unchecked = { look: look(box), aria: box.getAttribute("aria-checked") };

box.click();
legend.render(true, true);

const checked = { look: look(box), aria: box.getAttribute("aria-checked") };

legend.element.querySelector(".switch span:not(.rcheck)").click();
box.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

const out = {
  inputs: document.querySelectorAll("input").length,
  role: box.getAttribute("role"),
  tabIndex: box.tabIndex,
  unchecked,
  checked,
  rowChecked: look(rowBox),
  rowUnchecked: look(rowOff),
  calls,
};

document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(out))));
`;

type Look = { look: string; aria: string };

type Facts = {
  inputs: number;
  role: string;
  tabIndex: number;
  unchecked: Look;
  checked: Look;
  rowChecked: string;
  rowUnchecked: string;
  calls: boolean[];
};

function collect(): Facts {
  const dir = mkdtempSync(join(tmpdir(), "legend-view-"));

  try {
    const bundle = buildSync({
      stdin: { contents: HARNESS, resolveDir: dir, loader: "ts" },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
    }).outputFiles[0].text;
    const css = readFileSync(here("style.css"), "utf8");
    const page = join(dir, "page.html");

    writeFileSync(
      page,
      `<!doctype html><html><head><style>${css}</style></head><body><div id="out"></div><script>${bundle.replaceAll("</script", "<\\/script")}</script></body></html>`,
    );

    const run = spawnSync(
      chrome as string,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        `--user-data-dir=${join(dir, "profile")}`,
        "--dump-dom",
        `file://${page}`,
      ],
      { encoding: "utf8", timeout: 60000 },
    );
    const match = /<div id="out">([^<]*)<\/div>/.exec(run.stdout);

    if (match === null || !/^[A-Za-z0-9+/=]+$/.test(match[1])) {
      throw new Error(`no harness output: ${run.stderr.slice(0, 500)}`);
    }

    const text = Buffer.from(match[1], "base64").toString("utf8");

    if (text.startsWith("ERR ")) {
      throw new Error(text);
    }

    return JSON.parse(text);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}

describe.skipIf(chrome === undefined)("legend switch in a real browser", () => {
  const f = (chrome === undefined ? null : collect()) as Facts;

  it("draws the switch as the rows' app checkbox, with no platform input", () => {
    expect(f.inputs).toBe(0);
    expect(f.role).toBe("checkbox");
    expect(f.tabIndex).toBe(0);
    expect(f.unchecked.look).toBe(f.rowUnchecked);
    expect(f.checked.look).toBe(f.rowChecked);
    expect(f.checked.look).not.toBe(f.unchecked.look);
    expect(f.unchecked.aria).toBe("false");
    expect(f.checked.aria).toBe("true");
  });

  it("still toggles inferred lines from the box, the label and the keyboard", () => {
    expect(f.calls).toEqual([true, false, false]);
  });
});
