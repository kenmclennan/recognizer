import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../helpers.js";
import { FIXTURE_LANGUAGES } from "../language-behaviour-fixture.js";
import { cliScenario } from "./cli-scenario.js";
import type { Program } from "./io/processes.js";

export const EMPTY_HASH = createHash("sha256").update("").digest("hex");
export const CHECK_BASELINE = ".recognizer/baselines/violations.json";
export const CHECK_POLICY = ".recognizer/policy.yaml";

const read = (path: string) => readFileSync(join(REPO, path), "utf8");

export interface CheckScan {
  modules: { id: string; language: string }[];
  [key: string]: unknown;
}

export const checkScan: CheckScan = JSON.parse(
  read("fixtures/check/scan.json"),
);
export const checkExpected = JSON.parse(read("fixtures/check/expected.json"));
export const checkPolicyText = read("fixtures/check/.recognizer/policy.yaml");
export const checkBaselineText = read(
  "fixtures/check/.recognizer/baselines/violations.json",
);

export function hashedScan(
  scan: Record<string, unknown>,
  commit: string,
): Record<string, unknown> {
  const modules = scan.modules as { id: string }[];

  return {
    ...scan,
    commit,
    modified: false,
    files: modules.map((module) => ({ path: module.id, hash: EMPTY_HASH })),
  };
}

export function mountedModules(scan: Record<string, unknown>) {
  return Object.fromEntries(
    (scan.modules as { id: string }[]).map((module) => [module.id, ""]),
  );
}

export function inputsOf(scan: Record<string, unknown>) {
  return Object.fromEntries(
    (scan.modules as { id: string }[]).map((module) => [module.id, EMPTY_HASH]),
  );
}

function scannerManifestText(name: string): string {
  const manifest = JSON.parse(
    read("schema/manifest-examples/valid/scanner.json"),
  );

  return `${JSON.stringify({
    ...manifest,
    name,
    protocol: 4,
    languages: FIXTURE_LANGUAGES.filter((rule) => rule.name === name),
  })}\n`;
}

export function languageScanner(
  name: string,
  scan: Record<string, unknown> = checkScan,
): Program {
  return (call) => {
    const [verb] = call.args;
    const done = { started: true, status: 0, stderr: "" };

    if (verb === "manifest") {
      return { ...done, stdout: scannerManifestText(name) };
    }

    if (verb === "--version") {
      return { ...done, stdout: "0.1.0\n" };
    }

    if (verb !== "run") {
      return { started: true, status: 2, stdout: "", stderr: "" };
    }

    const output = call.args[call.args.indexOf("--output") + 1] as string;
    const commit = call.args[call.args.indexOf("--commit") + 1] as string;

    call.files.writeFile(
      output,
      `${JSON.stringify(hashedScan(scan, commit))}\n`,
    );

    return { ...done, stdout: "" };
  };
}

export interface CheckScenarioOptions {
  files?: Record<string, string | Record<string, unknown>>;
  policy?: string | false;
  baseline?: string | false;
  scan?: CheckScan;
  cache?: false | { commit?: string };
  caches?: Record<string, Record<string, unknown>>;
  stub?: boolean;
  languages?: string[];
  refreshes?: Record<string, unknown>;
}

export function checkScenario(options: CheckScenarioOptions = {}) {
  const scan = options.scan ?? checkScan;
  const languages = options.languages ?? ["python", "typescript"];
  const programs = Object.fromEntries(
    languages.map((name) => [
      `recognizer-scan-${name}`,
      languageScanner(name, (options.refreshes?.[name] as never) ?? scan),
    ]),
  );
  const policy = options.policy ?? checkPolicyText;
  const baseline = options.baseline ?? checkBaselineText;
  const scenario = cliScenario({
    sample: false,
    programs,
    files: {
      ...(options.stub === false ? {} : { "shop/a.py": "" }),
      ...mountedModules(scan),
      ...(policy === false ? {} : { [CHECK_POLICY]: policy }),
      ...(baseline === false ? {} : { [CHECK_BASELINE]: baseline }),
      ...options.files,
    },
  });
  const head = scenario.root.io.run("git", [
    "-C",
    scenario.repository,
    "rev-parse",
    "HEAD",
  ]);
  const commit = head.stdout.trim();
  const cache = (
    language: string,
    document: Record<string, unknown>,
    at: string,
  ) =>
    scenario.root.io.files.writeFile(
      `${scenario.repository}/.recognizer/cache/scan.${language}.json`,
      JSON.stringify(hashedScan(document, at)),
    );

  if (options.cache !== false) {
    cache("python", scan, options.cache?.commit ?? commit);
  }

  for (const [language, document] of Object.entries(options.caches ?? {})) {
    cache(language, document, commit);
  }

  return {
    ...scenario,
    commit,
    cache: (path: string, text: string) =>
      scenario.root.io.files.writeFile(`${scenario.repository}/${path}`, text),
    scanCalls: (language: string) =>
      scenario.root.io.processes.calls.filter(
        (call) =>
          call.command.endsWith(`recognizer-scan-${language}`) &&
          call.args[0] === "run",
      ).length,
    check: (argv: string[]) =>
      scenario.run(["check", ...argv, "--repository", scenario.repository]),
  };
}
