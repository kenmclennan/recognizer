import type { Say } from "@recognizer/core";
import { FindingsAdapter } from "../src/adapters/filesystem/findings-adapter.js";
import { ParsingAdapter } from "../src/adapters/filesystem/parsing-adapter.js";
import { SourceFilesAdapter } from "../src/adapters/filesystem/source-files-adapter.js";
import { TestReportsAdapter } from "../src/adapters/plugins/test-reports-adapter.js";
import { DigestAdapter } from "../src/adapters/system/digest-adapter.js";
import type { Io } from "../src/cli.js";
import { GRAMMAR_RULES } from "./duplication-helpers.js";
import { FIXTURE_LANGUAGES } from "./language-behaviour-fixture.js";

export function analysisPortsOf(io: Io) {
  return {
    source: new SourceFilesAdapter(io),
    digest: new DigestAdapter(),
    findings: new FindingsAdapter(io),
    parsing: new ParsingAdapter(),
    grammarRules: { rules: () => GRAMMAR_RULES },
    languages: { rules: () => FIXTURE_LANGUAGES },
  };
}

export function testsHashPortsOf(io: Io) {
  return {
    source: new SourceFilesAdapter(io),
    digest: new DigestAdapter(),
    testReports: new TestReportsAdapter(io),
    languages: { rules: () => FIXTURE_LANGUAGES },
  };
}

export function sayOf(io: Io): Say {
  return (stream, text) =>
    stream === "stderr" ? io.stderr(text) : io.stdout(text);
}
