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

const HIDEABLE = [
  "empty-canvas",
  "canvas-notice",
  "selection-bar",
  "canvas-legend",
  "inspector-rail",
  "inspector-panel",
  "picker",
  "update-button",
  "tree-toggle",
];

function computedDisplays(css: string): string {
  const classes = JSON.stringify(HIDEABLE);

  return `<!doctype html>
<html><head><style>${css}</style></head><body><div id="out"></div><script>
const out = [];
for (const name of ${classes}) {
  const node = document.createElement("div");
  node.className = name;
  node.hidden = true;
  document.body.append(node);
  out.push(name + "=" + getComputedStyle(node).display);
}
document.getElementById("out").textContent = out.join(";");
</script></body></html>`;
}

describe("hidden elements in a real browser", () => {
  it.skipIf(chrome === undefined)(
    "computes display none for every class the app hides with the hidden attribute",
    () => {
      const css = readFileSync(
        fileURLToPath(new URL("style.css", import.meta.url)),
        "utf8",
      );
      const dir = mkdtempSync(join(tmpdir(), "hidden-elements-"));

      try {
        const page = join(dir, "page.html");

        writeFileSync(page, computedDisplays(css));

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

        expect(match).not.toBeNull();
        expect((match as RegExpExecArray)[1].split(";")).toEqual(
          HIDEABLE.map((name) => `${name}=none`),
        );
      } finally {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
      }
    },
    90000,
  );
});
