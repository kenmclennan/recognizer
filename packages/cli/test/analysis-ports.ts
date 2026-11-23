import type { Say } from "@recognizer/core";
import { FindingsAdapter } from "../src/adapters/filesystem/findings-adapter.js";
import { ParsingAdapter } from "../src/adapters/filesystem/parsing-adapter.js";
import { SourceFilesAdapter } from "../src/adapters/filesystem/source-files-adapter.js";
import { TomlAdapter } from "../src/adapters/filesystem/toml-adapter.js";
import { DigestAdapter } from "../src/adapters/system/digest-adapter.js";
import type { Io } from "../src/cli.js";

export function analysisPortsOf(io: Io) {
  return {
    source: new SourceFilesAdapter(io),
    digest: new DigestAdapter(),
    findings: new FindingsAdapter(io),
    parsing: new ParsingAdapter(),
  };
}

export function testsHashPortsOf(io: Io) {
  return {
    source: new SourceFilesAdapter(io),
    digest: new DigestAdapter(),
    toml: new TomlAdapter(),
  };
}

export function sayOf(io: Io): Say {
  return (stream, text) =>
    stream === "stderr" ? io.stderr(text) : io.stdout(text);
}
