import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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

const PAGE = `<!doctype html>
<html><body><script>
const report = (text) => fetch("/result", { method: "POST", body: text });
const worker = new Worker(WORKER_URL);
worker.addEventListener("error", (event) => {
  report("ERROR " + event.message);
});
worker.addEventListener("message", (event) => {
  if (event.data.id === 1) {
    const children = event.data.data && event.data.data.children;
    report(children ? "ANSWERED " + children[1].x : "FAILED " + JSON.stringify(event.data));
  }
});
worker.postMessage({ id: -1, cmd: "register", algorithms: ["layered"] });
worker.postMessage({
  id: 1,
  cmd: "layout",
  graph: {
    id: "root",
    layoutOptions: { "elk.algorithm": "layered" },
    children: [{ id: "a", width: 10, height: 10 }, { id: "b", width: 10, height: 10 }],
    edges: [{ id: "e", sources: ["a"], targets: ["b"] }],
  },
  layoutOptions: {},
  options: {},
});
</script></body></html>`;

async function buildApp(outDir: string): Promise<string> {
  await build({
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    logLevel: "silent",
    root: fileURLToPath(new URL("..", import.meta.url)),
    build: { outDir, emptyOutDir: true },
  });

  const file = readdirSync(join(outDir, "assets")).find((name) =>
    name.startsWith("layout.worker-"),
  );

  if (file === undefined) {
    throw new Error("the build produced no layout worker");
  }

  return `/assets/${file}`;
}

describe("built layout worker in a real browser", () => {
  it.skipIf(chrome === undefined)(
    "answers a layout request when started as the app starts it",
    async () => {
      const outDir = mkdtempSync(join(tmpdir(), "layout-worker-"));
      const profile = mkdtempSync(join(tmpdir(), "layout-chrome-"));

      try {
        const workerPath = await buildApp(outDir);
        let report: (text: string) => void = () => {};
        const reported = new Promise<string>((resolve) => {
          report = resolve;
        });
        const server = createServer((request, response) => {
          if (request.method === "POST" && request.url === "/result") {
            const chunks: Buffer[] = [];

            request.on("data", (chunk: Buffer) => chunks.push(chunk));
            request.on("end", () => {
              report(Buffer.concat(chunks).toString("utf8"));
              response.end();
            });

            return;
          }

          if (request.url === "/") {
            response.setHeader("content-type", "text/html");
            response.end(
              PAGE.replace("WORKER_URL", JSON.stringify(workerPath)),
            );

            return;
          }

          if (request.url === workerPath) {
            response.setHeader("content-type", "text/javascript");
            response.end(readFileSync(join(outDir, workerPath)));

            return;
          }

          response.statusCode = 404;
          response.end();
        });

        await new Promise<void>((resolve) => server.listen(0, resolve));

        try {
          const { port } = server.address() as AddressInfo;
          const browser = spawn(
            chrome as string,
            [
              "--headless=new",
              "--disable-gpu",
              "--no-sandbox",
              `--user-data-dir=${profile}`,
              `http://127.0.0.1:${port}/`,
            ],
            { stdio: "ignore" },
          );
          const silence = new Promise<string>((resolve) =>
            setTimeout(() => resolve("TIMEOUT"), 60000),
          );

          try {
            expect(await Promise.race([reported, silence])).toMatch(
              /^ANSWERED [0-9.]+$/,
            );
          } finally {
            const exited = new Promise((resolve) =>
              browser.once("exit", resolve),
            );

            browser.kill("SIGKILL");
            await exited;
          }
        } finally {
          server.close();
        }
      } finally {
        rmSync(outDir, { recursive: true, force: true });
        rmSync(profile, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 200,
        });
      }
    },
    120000,
  );
});
