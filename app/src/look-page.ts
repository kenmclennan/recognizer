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
import { build, type Plugin } from "esbuild";
import { webkit as playwright } from "playwright";

const LOOK_BROWSER = fileURLToPath(
  new URL("../scripts/look-browser.mjs", import.meta.url),
);

export const webkit = existsSync(playwright.executablePath())
  ? LOOK_BROWSER
  : undefined;

export function lookBrowserArgs(
  target: string,
  options: { size?: string } = {},
): string[] {
  return [
    LOOK_BROWSER,
    target,
    ...(options.size === undefined ? [] : ["--size", options.size]),
  ];
}

export const HIDE_SCROLLBARS =
  "* { scrollbar-width: none } ::-webkit-scrollbar { display: none }";

export const here = (name: string) =>
  fileURLToPath(new URL(name, import.meta.url));

const fakeWorker: Plugin = {
  name: "fake-layout-worker",
  setup(build) {
    build.onLoad({ filter: /layout-source\.ts$/ }, (args) => ({
      contents: readFileSync(args.path, "utf8").replace(
        'new Worker(new URL("./layout.worker.ts", import.meta.url))',
        "window.__fakeWorker()",
      ),
      loader: "ts",
    }));
  },
};

export const FAKE_WORKER = `
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
`;

const SHELLS = {
  bare: "",
  window:
    '<div class="window" style="width:1400px;height:800px;display:flex;flex-direction:column"><div class="content" id="content" style="flex:1;display:flex;flex-direction:column"></div><footer class="footer" id="footer"></footer></div>',
  app: '<span id="module-count"></span><div id="app" style="width:1400px;height:800px;display:flex;flex-direction:column"></div>',
};

export async function collectFacts<T>(
  harness: string,
  prefix: string,
  shell: "window" | "app" | "bare" = "window",
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));

  try {
    const bundle = (
      await build({
        stdin: { contents: harness, resolveDir: here("."), loader: "ts" },
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        plugins: [fakeWorker],
      })
    ).outputFiles[0].text;
    const css = readFileSync(here("style.css"), "utf8");
    const page = join(dir, "page.html");
    const csp = `${JSON.parse(readFileSync(here("../src-tauri/tauri.conf.json"), "utf8")).app.security.csp}; script-src 'unsafe-inline'`;

    writeFileSync(
      page,
      `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${css}${HIDE_SCROLLBARS}</style></head><body><div id="out"></div>${SHELLS[shell]}<script>${bundle.replaceAll("</script", "<\\/script")}</script></body></html>`,
    );

    const run = spawnSync(
      process.execPath,
      lookBrowserArgs(page, { size: "1500x900" }),
      { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
    );
    const match = /<div id="out">([^<]*)<\/div>/.exec(run.stdout);

    if (match === null || !/^[A-Za-z0-9+/=]+$/.test(match[1])) {
      throw new Error(
        `no harness output: ${run.stderr.slice(0, 500)} ${run.error}`,
      );
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
