import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allFormulae, loadUnits } from "./units.mjs";

const TEMPLATES = "packaging/homebrew";

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

export function className(formula) {
  return formula
    .split("-")
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join("");
}

function template(root, name) {
  return readFileSync(join(root, TEMPLATES, name), "utf8");
}

function write(outDir, target, text) {
  mkdirSync(dirname(join(outDir, target)), { recursive: true });
  writeFileSync(join(outDir, target), text);
}

export function renderCask(root, version, appSha, outDir) {
  write(
    outDir,
    "Casks/recognizer.rb",
    render(template(root, "recognizer-cask.rb.tmpl"), {
      version,
      app_sha256: appSha,
    }),
  );
}

export function formulaDependencies(runtime) {
  return [
    "  depends_on arch: :arm64",
    "  depends_on :macos",
    ...(runtime === null ? [] : [`  depends_on "${runtime}"`]),
  ].join("\n");
}

export function renderFormula(root, formula, version, sha, outDir) {
  write(
    outDir,
    `Formula/${formula.formula}.rb`,
    render(template(root, "plugin-formula.rb.tmpl"), {
      class_name: className(formula.formula),
      desc: formula.desc,
      unit: formula.unit,
      version,
      sha256: sha,
      dependencies: formulaDependencies(formula.runtime),
      command: formula.command,
    }),
  );
}

export function renderUnit(root, unit, version, sha, outDir) {
  const formulae = allFormulae(loadUnits(root)).filter(
    (one) => one.unit === unit,
  );

  if (formulae.length === 0) {
    throw new Error(`no unit ${unit}`);
  }

  for (const formula of formulae) {
    renderFormula(root, formula, version, sha, outDir);
  }

  return formulae.map((one) => one.formula);
}

export function members(root) {
  return allFormulae(loadUnits(root)).map((one) => one.formula);
}

export function renderBundle(root, n, sha, outDir) {
  const names = members(root);

  write(
    outDir,
    "Formula/recognizer-plugins.rb",
    render(template(root, "recognizer-plugins.rb.tmpl"), {
      n: String(n),
      sha256: sha,
      dependencies: names.map((name) => `  depends_on "${name}"`).join("\n"),
      members: names.join(" "),
    }),
  );
}

export function renderAll(root, version, appSha, outDir) {
  renderCask(root, version, appSha, outDir);

  for (const formula of allFormulae(loadUnits(root))) {
    renderFormula(root, formula, version, appSha, outDir);
  }

  renderBundle(root, 1, appSha, outDir);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const [mode, ...rest] = process.argv.slice(2);

  if (mode === "cask") {
    renderCask(root, rest[0], rest[1], rest[2] ?? ".");
  } else if (mode === "unit") {
    renderUnit(root, rest[0], rest[1], rest[2], rest[3] ?? ".");
  } else if (mode === "bundle") {
    renderBundle(root, rest[0], rest[1], rest[2] ?? ".");
  } else if (mode === "members") {
    process.stdout.write(`${members(root).join("\n")}\n`);
  } else {
    const [version, appSha, outDir] = process.argv.slice(2);

    renderAll(root, version, appSha, outDir ?? ".");
  }
}
