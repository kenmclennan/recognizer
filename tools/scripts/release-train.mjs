import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadUnits } from "./units.mjs";

const APP_WORKFLOWS = ["check", "app", "schema-compat"];
const SEARCH_DEPTH = 200;

function versionParts(tag, unit) {
  const match = new RegExp(`^${unit}-v(\\d+)\\.(\\d+)\\.(\\d+)$`).exec(tag);

  return match === null ? null : match.slice(1).map(Number);
}

export function latestTag(unit, tags) {
  const found = tags
    .map((tag) => ({ tag, parts: versionParts(tag, unit) }))
    .filter((one) => one.parts !== null)
    .sort((a, b) => {
      for (let i = 0; i < 3; i++) {
        if (a.parts[i] !== b.parts[i]) {
          return a.parts[i] - b.parts[i];
        }
      }

      return 0;
    });

  return found.length === 0 ? null : found[found.length - 1].tag;
}

export function plannedUnits(units, facts) {
  return units
    .filter((entry) => {
      const tag = facts.latestTag(entry.unit);

      return tag === null || facts.changed(tag, entry.folder);
    })
    .map((entry) => entry.unit);
}

export function ciVerdict(workflow, sha, facts) {
  const commits = facts.firstParent(sha);

  for (const commit of commits.slice(0, SEARCH_DEPTH)) {
    const runs = facts.runsOn(workflow, commit);

    if (runs.length === 0) {
      continue;
    }

    const where = commit === sha ? sha : `${commit}, the nearest earlier run`;

    if (runs.some((run) => run.status !== "completed")) {
      return { ok: false, reason: `${workflow} on ${where} is still running` };
    }

    if (!runs.some((run) => run.conclusion === "success")) {
      return { ok: false, reason: `${workflow} on ${where} did not succeed` };
    }

    return { ok: true, reason: "" };
  }

  return { ok: false, reason: `${workflow} has no run on ${sha} or before it` };
}

export function requiredWorkflows(units, planned) {
  return [
    ...APP_WORKFLOWS,
    ...units
      .filter((entry) => planned.includes(entry.unit))
      .map((entry) => entry.ci_workflow),
  ];
}

export function plan(units, sha, facts) {
  const planned = plannedUnits(units, facts);
  const failures = requiredWorkflows(units, planned)
    .map((workflow) => ciVerdict(workflow, sha, facts))
    .filter((verdict) => !verdict.ok)
    .map((verdict) => verdict.reason);

  return { units: planned, failures };
}

export function verifyTrain(appVersion, built) {
  return built
    .filter((one) => one.unit.startsWith("scan-"))
    .filter((one) => one.scan_schema_version !== appVersion)
    .map(
      (one) =>
        `${one.unit} declares scan schema ${one.scan_schema_version ?? "nothing"} and the app reads ${appVersion}`,
    );
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

export function systemFacts(root) {
  return {
    latestTag: (unit) =>
      latestTag(unit, git(root, ["tag", "--list", `${unit}-v*`]).split("\n")),
    changed: (tag, folder) =>
      git(root, ["diff", "--name-only", tag, "HEAD", "--", folder]).trim() !==
      "",
    firstParent: (sha) =>
      git(root, [
        "rev-list",
        "--first-parent",
        `--max-count=${SEARCH_DEPTH}`,
        sha,
      ])
        .split("\n")
        .filter((line) => line !== ""),
    runsOn: (workflow, commit) =>
      JSON.parse(
        execFileSync(
          "gh",
          [
            "run",
            "list",
            "--workflow",
            `${workflow}.yml`,
            "--commit",
            commit,
            "--event",
            "push",
            "--json",
            "status,conclusion",
          ],
          { cwd: root, encoding: "utf8" },
        ),
      ),
  };
}

function readBuilt(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(directory, entry.name, "meta.json"))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, "utf8")));
}

export function main(argv, root, facts = systemFacts(root)) {
  const [mode, ...rest] = argv;

  if (mode === "plan" && rest.length === 1) {
    const result = plan(loadUnits(root), rest[0], facts);

    for (const failure of result.failures) {
      process.stderr.write(`${failure}\n`);
    }

    process.stdout.write(`${JSON.stringify(result.units)}\n`);

    return result.failures.length === 0 ? 0 : 1;
  }

  if (mode === "verify" && rest.length === 2) {
    const failures = verifyTrain(Number(rest[0]), readBuilt(rest[1]));

    for (const failure of failures) {
      process.stderr.write(`${failure}\n`);
    }

    return failures.length === 0 ? 0 : 1;
  }

  process.stderr.write(
    "usage: release-train.mjs plan <sha> | verify <app-scan-schema-version> <built-folder>\n",
  );

  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../..", import.meta.url));

  process.exit(main(process.argv.slice(2), root));
}
