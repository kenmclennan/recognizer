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

const PAGE = (css: string) => `<!doctype html>
<html><head><style>${css}</style></head><body>
<div style="display:flex;flex-direction:column;width:1000px;height:600px">
<div class="explorer" id="grid">
<nav class="rail"></nav>
<aside class="tree" id="tree"></aside>
<main class="canvas" id="canvas"></main>
<aside class="inspector" id="inspector"><div class="inspector-rail" id="rail"></div><div class="inspector-panel" id="panel" hidden></div></aside>
</div></div>
<script>
const grid = document.getElementById("grid");
const canvas = document.getElementById("canvas");
const inspector = document.getElementById("inspector");
const measure = () => {
  const c = canvas.getBoundingClientRect();
  const i = inspector.getBoundingClientRect();
  return { left: c.left, top: c.top, width: c.width, inspector: i.width };
};
const result = {};
for (const hidden of [false, true]) {
  grid.classList.toggle("tree-hidden", hidden);
  grid.classList.remove("inspector-open");
  const rail = measure();
  grid.classList.add("inspector-open");
  document.getElementById("rail").hidden = true;
  document.getElementById("panel").hidden = false;
  const open = measure();
  document.getElementById("rail").hidden = false;
  document.getElementById("panel").hidden = true;
  result[hidden ? "treeHidden" : "treeShown"] = { rail, open };
}
document.body.insertAdjacentHTML("beforeend", "<pre id='out'></pre>");
document.getElementById("out").textContent = JSON.stringify(result);
</script></body></html>`;

type Box = { left: number; top: number; width: number; inspector: number };
type Report = Record<"treeShown" | "treeHidden", { rail: Box; open: Box }>;

describe("the inspector's layout in a real browser", () => {
  it.skipIf(chrome === undefined)(
    "narrows the canvas by 296px from the right without moving its edge",
    () => {
      const css = readFileSync(
        fileURLToPath(new URL("style.css", import.meta.url)),
        "utf8",
      );
      const dir = mkdtempSync(join(tmpdir(), "inspector-layout-"));

      try {
        const page = join(dir, "page.html");

        writeFileSync(page, PAGE(css));

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
          { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
        );
        const match = /<pre id="out">([\s\S]*?)<\/pre>/.exec(run.stdout);

        expect(match).not.toBeNull();

        const report = JSON.parse(
          (match as RegExpExecArray)[1]?.replaceAll("&quot;", '"') as string,
        ) as Report;

        for (const { rail, open } of Object.values(report)) {
          expect(rail.inspector).toBe(44);
          expect(open.inspector).toBe(340);
          expect(open.left).toBe(rail.left);
          expect(open.top).toBe(rail.top);
          expect(rail.width - open.width).toBe(296);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
      }
    },
    90000,
  );
});
