import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import { lookRun, webkit } from "../../src/look-page";

const HIDEABLE = [
  "empty-canvas",
  "canvas-notice",
  "selection-bar",
  "canvas-legend",
  "canvas-metrics",
  "inspector-rail",
  "inspector-panel",
  "message-tray",
  "message-toast",
  "bell-badge",
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

const srcUrl = new URL("../../src/index.ts", import.meta.url).href;

describe("hidden elements in a real browser", () => {
  it.skipIf(webkit === undefined)(
    "computes display none for every class the app hides with the hidden attribute",
    async () => {
      const css = readFileSync(
        fileURLToPath(new URL("style.css", srcUrl)),
        "utf8",
      );
      const dir = makeTempDir("hidden-elements-");

      try {
        const page = join(dir, "page.html");

        writeFileSync(page, computedDisplays(css));

        const run = await lookRun(page, { size: "800x600" });
        const match = /<div id="out">([^<]*)<\/div>/.exec(run.stdout);

        expect(match).not.toBeNull();
        expect((match as RegExpExecArray)[1].split(";")).toEqual(
          HIDEABLE.map((name) => `${name}=none`),
        );
      } finally {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
      }
    },
    scaledTimeout(90000),
  );
});
