import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { manifestFor } from "./plugin-path.js";
import { registerShim } from "./plugin-registry-shim.js";

export interface StubSurveyPlugin {
  name: string;
  order: number;
  language?: string;
  extensions?: string[];
  skip?: Partial<typeof NO_SKIP>;
  stdout?: string;
  status?: number;
  holdSeconds?: number;
  requestLog?: string;
}

const NO_SKIP = {
  directory_names: [],
  directory_prefixes: [],
  directory_suffixes: [],
  directory_markers: [],
  file_globs: [],
};

const FILTER = [
  'const fs = require("fs");',
  'const request = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));',
  'const answer = JSON.parse(Buffer.from(process.argv[2], "base64").toString());',
  "const covered = (runner) => request.suites.some((suite) => suite.language === runner.language && suite.directory === runner.directory);",
  "const kept = answer.runners.filter((runner) => !covered(runner));",
  "const froms = new Set(kept.map((runner) => runner.from));",
  "answer.runners = kept;",
  "answer.tools = answer.tools.map((tool) => ({ ...tool, needed_by: tool.needed_by.filter((from) => froms.has(from)) })).filter((tool) => tool.needed_by.length > 0);",
  "process.stdout.write(JSON.stringify(answer));",
].join(" ");

export function writeStubSurveyPlugin(
  directory: string,
  stub: StubSurveyPlugin,
): void {
  mkdirSync(directory, { recursive: true });

  const language = stub.language ?? stub.name;
  const manifest = manifestFor("scanner", stub.name, {
    setup_survey: { order: stub.order },
    languages: [
      {
        name: language,
        extensions: stub.extensions ?? [],
        files: [],
        skip: { ...NO_SKIP, ...stub.skip },
      },
    ],
  });
  const path = join(directory, `recognizer-scan-${stub.name}`);

  const answer = stub.stdout ?? '{"runners":[],"tools":[],"notes":[]}';

  writeFileSync(
    path,
    [
      "#!/bin/sh",
      'if [ "$1" = "manifest" ]; then',
      "cat <<'RECOGNIZER_EOF'",
      JSON.stringify(manifest),
      "RECOGNIZER_EOF",
      "exit 0",
      "fi",
      'if [ "$1" = "survey" ]; then',
      ...(stub.requestLog === undefined
        ? []
        : [`cat "$2" >> '${stub.requestLog}'`]),
      ...(stub.status === undefined || stub.status === 0
        ? []
        : [`exit ${stub.status}`]),
      ...(stub.holdSeconds === undefined
        ? []
        : [`exec sleep ${stub.holdSeconds}`]),
      `exec '${process.execPath}' -e '${FILTER}' "$2" '${Buffer.from(answer).toString("base64")}'`,
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
  registerShim(path);
}
