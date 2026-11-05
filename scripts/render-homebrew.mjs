import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function render(template, values) {
  const rendered = template.replace(/@@(\w+)@@/g, (_, key) => {
    const value = values[key];

    if (value === undefined || value === "") {
      throw new Error(`No value for ${key}`);
    }

    return value;
  });

  return rendered;
}

export function renderAll(root, version, appSha, outDir) {
  const values = { version, app_sha256: appSha };
  const target = "Casks/recognizer.rb";
  const text = render(
    readFileSync(
      join(root, "packaging/homebrew", "recognizer-cask.rb.tmpl"),
      "utf8",
    ),
    values,
  );

  mkdirSync(dirname(join(outDir, target)), { recursive: true });
  writeFileSync(join(outDir, target), text);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, appSha, outDir] = process.argv.slice(2);

  renderAll(
    fileURLToPath(new URL("..", import.meta.url)),
    version,
    appSha,
    outDir ?? ".",
  );
}
