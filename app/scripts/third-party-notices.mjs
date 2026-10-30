import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateRustNotices } from "./rust-notices.mjs";

const NOTICE_FILE = /^(LICENSE|LICENCE|NOTICE)/;

export function productionPackages(lock) {
  return Object.entries(lock.packages)
    .filter(
      ([path, entry]) =>
        path.startsWith("node_modules/") && !entry.dev && !entry.link,
    )
    .map(([path, entry]) => ({
      path,
      name: path.slice(path.lastIndexOf("node_modules/") + 13),
      version: entry.version,
      license: entry.license ?? "UNKNOWN",
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function buildNotices(lock, readLicenseFiles) {
  const sections = productionPackages(lock).map((pkg) => {
    const files = readLicenseFiles(pkg.path).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    const body =
      files.length === 0
        ? ["no licence file shipped"]
        : files.flatMap((file) => [
            `### ${file.name}`,
            "",
            "```text",
            file.text.trimEnd(),
            "```",
            "",
          ]);

    return [
      `## ${pkg.name} ${pkg.version}`,
      "",
      `Licence: ${pkg.license}`,
      "",
      ...body,
    ]
      .join("\n")
      .trimEnd();
  });

  return `# Third-party notices\n\nRecognizer ships the npm packages below, then the Rust crates the app is built from.\n\n${sections.join("\n\n")}\n`;
}

export function readLicenseFilesFrom(root) {
  return (path) =>
    readdirSync(join(root, path))
      .filter((name) => NOTICE_FILE.test(name) && !name.endsWith(".spdx"))
      .map((name) => ({
        name,
        text: readFileSync(join(root, path, name), "utf8"),
      }));
}

export function generateNotices(root) {
  const lock = JSON.parse(
    readFileSync(join(root, "package-lock.json"), "utf8"),
  );

  return buildNotices(lock, readLicenseFilesFrom(root));
}

export function generateAllNotices(root) {
  return `${generateNotices(root)}\n${generateRustNotices(root)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../..", import.meta.url));

  writeFileSync(join(root, "THIRD-PARTY-NOTICES.md"), generateAllNotices(root));
}
