import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { judgeScanVersion } from "../check/dist/index.js";

const SCHEMA = "schema/scan.schema.json";
const EXAMPLES = "schema/examples/valid/";
const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function constOf(schema) {
  return schema?.properties?.schema_version?.const;
}

function withoutConst(schema) {
  const copy = JSON.parse(JSON.stringify(schema));

  copy.properties.schema_version.const = null;

  return JSON.stringify(copy);
}

export function checkBump(baseSchema, headSchema) {
  const base = constOf(baseSchema);
  const head = constOf(headSchema);

  if (withoutConst(baseSchema) === withoutConst(headSchema)) {
    return null;
  }

  if (head > base) {
    return null;
  }

  return `schema/scan.schema.json changed but schema_version is ${head} and the merge base has ${base}: raise schema_version above ${base}`;
}

export function latestReleaseTag(tags) {
  const found = tags
    .map((tag) => ({ tag, match: RELEASE_TAG.exec(tag) }))
    .filter((one) => one.match !== null)
    .map((one) => ({ tag: one.tag, parts: one.match.slice(1).map(Number) }))
    .sort(
      (a, b) =>
        a.parts[0] - b.parts[0] ||
        a.parts[1] - b.parts[1] ||
        a.parts[2] - b.parts[2],
    );

  return found.length === 0 ? null : found[found.length - 1].tag;
}

export function checkExamples(examples, headSchema, breaks) {
  const head = constOf(headSchema);
  const validate = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
  }).compile(headSchema);
  const failures = [];
  const skipped = [];

  for (const { path, document } of examples) {
    const version = document?.schema_version;

    if (
      Number.isInteger(version) &&
      judgeScanVersion(version, head, breaks) === "broken"
    ) {
      skipped.push(
        `${path} is at schema_version ${version} and a listed break lies between it and ${head}`,
      );

      continue;
    }

    if (!validate({ ...document, schema_version: head })) {
      const first = (validate.errors ?? [])
        .slice(0, 3)
        .map((error) => `${error.instancePath || "/"} ${error.message}`)
        .join("; ");

      failures.push(
        `${path} at the last release does not validate against the head schema: ${first}`,
      );
    }
  }

  return { failures, skipped };
}

export function run({ cwd, headRef, mainRef = "origin/main", breaksFile }) {
  const lines = [];
  const headSchema = JSON.parse(readFileSync(join(cwd, SCHEMA), "utf8"));
  const breaks = JSON.parse(
    readFileSync(
      breaksFile || join(cwd, "schema/scan-breaking-versions.json"),
      "utf8",
    ),
  );
  let failed = false;
  const base = git(cwd, ["merge-base", mainRef, headRef]).trim();
  const baseSchema = JSON.parse(git(cwd, ["show", `${base}:${SCHEMA}`]));
  const bump = checkBump(baseSchema, headSchema);

  if (bump !== null) {
    lines.push(bump);
    failed = true;
  }

  const tag = latestReleaseTag(git(cwd, ["tag", "--list", "v*"]).split("\n"));

  if (tag === null) {
    lines.push("no release tag found: the released scans were not checked");
  } else {
    const paths = git(cwd, [
      "ls-tree",
      "-r",
      "--name-only",
      tag,
      "--",
      EXAMPLES,
    ])
      .split("\n")
      .filter((path) => path.endsWith(".json"));
    const examples = paths.map((path) => ({
      path,
      document: JSON.parse(git(cwd, ["show", `${tag}:${path}`])),
    }));
    const result = checkExamples(examples, headSchema, breaks);

    for (const skip of result.skipped) {
      lines.push(`skipped ${skip}`);
    }

    for (const failure of result.failures) {
      lines.push(failure);
      failed = true;
    }

    if (result.failures.length === 0) {
      lines.push(
        `${examples.length - result.skipped.length} released scan examples from ${tag} validate against the head schema`,
      );
    }
  }

  return { code: failed ? 1 : 0, lines };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [headRef, breaksFile, mainRef] = process.argv.slice(2);

  if (!headRef) {
    console.error(
      "usage: schema-compat.mjs <head-ref> [breaks-file] [main-ref]",
    );
    process.exit(2);
  }

  const { code, lines } = run({
    cwd: process.cwd(),
    headRef,
    breaksFile,
    mainRef,
  });

  for (const line of lines) {
    (code === 0 ? console.log : console.error)(line);
  }

  process.exit(code);
}
