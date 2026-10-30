import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const NOTICE_FILE = /^(LICEN[SC]E|COPYING|NOTICE|UNLICENSE)/i;
const SPDX_DIR = fileURLToPath(new URL("./spdx-licences/", import.meta.url));
const PLATFORMS = ["aarch64-apple-darwin", "x86_64-apple-darwin"];

export const ACCEPTED_LICENCES = [
  "MIT",
  "Apache-2.0",
  "Apache-2.0 WITH LLVM-exception",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "Zlib",
  "Unicode-3.0",
  "Unicode-DFS-2016",
  "MPL-2.0",
  "CC0-1.0",
];

function tokenize(expression) {
  return expression
    .replace(/\//g, " OR ")
    .replace(/([()])/g, " $1 ")
    .split(/\s+/)
    .filter(Boolean);
}

export function licenceAccepted(expression, accepted = ACCEPTED_LICENCES) {
  if (!expression) {
    return false;
  }

  const tokens = tokenize(expression);
  let at = 0;

  function atom() {
    const token = tokens[at++];

    if (token === "(") {
      const value = or();
      at++;

      return value;
    }

    let id = token;

    if (tokens[at] === "WITH") {
      id = `${token} WITH ${tokens[at + 1]}`;
      at += 2;
    }

    return accepted.includes(id);
  }

  function and() {
    let value = atom();

    while (tokens[at] === "AND") {
      at++;
      value = atom() && value;
    }

    return value;
  }

  function or() {
    let value = and();

    while (tokens[at] === "OR") {
      at++;
      value = and() || value;
    }

    return value;
  }

  return or();
}

export function linkedCrates(metadata) {
  const byId = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const seen = new Set();
  const pending = [metadata.resolve.root];

  while (pending.length > 0) {
    const id = pending.pop();

    if (seen.has(id)) {
      continue;
    }

    seen.add(id);

    for (const dep of nodes.get(id).deps) {
      if (dep.dep_kinds.some((kind) => kind.kind === null)) {
        pending.push(dep.pkg);
      }
    }
  }

  return [...seen]
    .filter((id) => id !== metadata.resolve.root)
    .map((id) => byId.get(id));
}

export function unacceptedCrates(crates, accepted = ACCEPTED_LICENCES) {
  return crates
    .filter((crate) => !licenceAccepted(crate.license, accepted))
    .map(
      (crate) =>
        `${crate.name} ${crate.version} (${crate.license ?? "no licence"})`,
    );
}

export function standardLicenceFiles(expression, dir = SPDX_DIR) {
  const ids = new Set(
    tokenize(expression ?? "").filter(
      (token) => !["AND", "OR", "WITH", "(", ")"].includes(token),
    ),
  );

  return [...ids]
    .filter((id) => readdirSync(dir).includes(`${id}.txt`))
    .map((id) => ({
      name: id,
      text: readFileSync(join(dir, `${id}.txt`), "utf8"),
    }));
}

function copyrightLine(crate) {
  const authors = (crate.authors ?? [])
    .map((author) => author.replace(/\s*<[^>]*>/, "").trim())
    .filter(Boolean);

  return authors.length === 0 ? "" : ` - Copyright ${authors.join(", ")}`;
}

export function buildRustNotices(crates, readLicenseFiles) {
  const unaccepted = unacceptedCrates(crates);

  if (unaccepted.length > 0) {
    throw new Error(
      `Rust crates outside the accepted licences: ${unaccepted.join(", ")}`,
    );
  }

  const groups = new Map();
  const standard = new Set();

  for (const crate of crates) {
    const shipped = readLicenseFiles(crate);

    if (shipped.length === 0) {
      standard.add(crate);
    }

    const files = (
      shipped.length > 0 ? shipped : standardLicenceFiles(crate.license)
    ).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const key = JSON.stringify(files.map((file) => [file.name, file.text]));
    const group = groups.get(key) ?? { files, crates: [] };

    group.crates.push(crate);
    groups.set(key, group);
  }

  const sections = [...groups.values()]
    .map((group) => ({
      ...group,
      crates: group.crates.sort((a, b) =>
        `${a.name} ${a.version}` < `${b.name} ${b.version}` ? -1 : 1,
      ),
    }))
    .sort((a, b) =>
      a.crates[0].name < b.crates[0].name
        ? -1
        : a.crates[0].name > b.crates[0].name
          ? 1
          : 0,
    )
    .map((group) => {
      const heading = group.crates
        .map(
          (crate) =>
            `- ${crate.name} ${crate.version} (${crate.license})${standard.has(crate) ? copyrightLine(crate) : ""}`,
        )
        .join("\n");
      const body =
        group.files.length === 0
          ? "no licence file shipped"
          : group.files
              .flatMap((file) => [
                `### ${file.name}`,
                "",
                "```text",
                file.text.trimEnd(),
                "```",
                "",
              ])
              .join("\n")
              .trimEnd();

      return `${heading}\n\n${body}`;
    });

  return `# Rust crates\n\nThe app links the Rust crates below. Crates that ship the same licence files share one entry.\n\n${sections.join("\n\n")}\n`;
}

export function readCrateLicenseFiles(crate) {
  const dir = dirname(crate.manifest_path);

  return readdirSync(dir)
    .filter((name) => NOTICE_FILE.test(name))
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}

export function cargoMetadata(root) {
  const manifest = join(root, "app/src-tauri/Cargo.toml");
  const byId = new Map();

  for (const platform of PLATFORMS) {
    const result = spawnSync(
      "cargo",
      [
        "metadata",
        "--format-version",
        "1",
        "--locked",
        "--manifest-path",
        manifest,
        "--filter-platform",
        platform,
      ],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );

    if (result.status !== 0) {
      throw new Error(`cargo metadata failed: ${result.stderr}`);
    }

    const metadata = JSON.parse(result.stdout);

    for (const crate of linkedCrates(metadata)) {
      byId.set(crate.id, crate);
    }
  }

  return [...byId.values()];
}

export function generateRustNotices(root) {
  return buildRustNotices(cargoMetadata(root), readCrateLicenseFiles);
}
