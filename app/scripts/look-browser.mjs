import { pathToFileURL } from "node:url";
import { webkit } from "playwright";

const USAGE =
  "usage: node look-browser.mjs <page file or URL> [--dark] [--size WxH]";

function parse(argv) {
  const options = { dark: false, width: 1500, height: 900 };
  let target = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dark") {
      options.dark = true;
    } else if (arg === "--size") {
      const [width, height] = (argv[++index] ?? "").split("x").map(Number);
      options.width = width;
      options.height = height;
    } else if (target === null) {
      target = arg;
    } else {
      throw new Error(USAGE);
    }
  }

  if (target === null || !(options.width > 0 && options.height > 0)) {
    throw new Error(USAGE);
  }

  const url = /^[a-z]+:\/\//.test(target) ? target : pathToFileURL(target).href;

  return { url, ...options };
}

const { url, dark, width, height } = parse(process.argv.slice(2));
const browser = await webkit.launch();
const close = () => browser.close().finally(() => process.exit(0));

process.on("SIGTERM", close);
process.on("SIGINT", close);

try {
  const page = await browser.newPage({
    viewport: { width, height },
    colorScheme: dark ? "dark" : "light",
  });

  await page.goto(url);

  await page.waitForFunction(
    () => (document.getElementById("out")?.textContent ?? "") !== "",
    null,
    { timeout: 55000 },
  );

  process.stdout.write(
    await page.evaluate(() => document.getElementById("out").outerHTML),
  );
} finally {
  await browser.close();
}
