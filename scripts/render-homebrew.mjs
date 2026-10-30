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

export function renderAll(root, version, toolchainSha, appSha, outDir) {
  const values = {
    version,
    toolchain_sha256: toolchainSha,
    app_sha256: appSha,
  };
  const targets = [
    ["recognizer.rb.tmpl", "Formula/recognizer.rb"],
    ["recognizer-cask.rb.tmpl", "Casks/recognizer.rb"],
  ];

  for (const [template, target] of targets) {
    const text = render(
      readFileSync(join(root, "packaging/homebrew", template), "utf8"),
      values,
    );

    mkdirSync(dirname(join(outDir, target)), { recursive: true });
    writeFileSync(join(outDir, target), text);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, toolchainSha, appSha, outDir] = process.argv.slice(2);

  renderAll(
    fileURLToPath(new URL("..", import.meta.url)),
    version,
    toolchainSha,
    appSha,
    outDir ?? ".",
  );
}
