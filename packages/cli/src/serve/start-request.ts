import { resolve } from "node:path";
import type { DescribeIntent, ScanRequest } from "@recognizer/core";
import type { ScopeFiles } from "./scan-files.js";
import { ArgsError, suiteMap, text, textList } from "./wire.js";

export interface StartArguments {
  repository: string;
  request: ScanRequest;
  modules: string[] | undefined;
  suites: Record<string, string[]> | undefined;
  flags: string[];
}

function describeIntent(value: unknown): DescribeIntent {
  if (value === false || value === undefined || value === null) {
    return false;
  }

  if (value === "stale" || value === "all") {
    return value;
  }

  throw new ArgsError(['describe must be false, "stale" or "all"']);
}

export function parseStart(args: Record<string, unknown>): StartArguments {
  const repository = resolve(text(args, "repository"));
  const describe = describeIntent(args.describe);
  const sense = textList(args, "sense") ?? [];
  const modules = textList(args, "modules");
  const suited = suiteMap(args, "suites");
  const suites =
    suited === undefined || Object.keys(suited).length === 0
      ? undefined
      : suited;
  const analysis = args.analysis !== false;
  const confirmAbove =
    typeof args.confirmAbove === "number" && describe !== false
      ? args.confirmAbove
      : undefined;

  return {
    repository,
    modules,
    suites,
    flags: [
      "--json",
      ...(describe === false
        ? []
        : [describe === "all" ? "--describe=all" : "--describe"]),
      ...(sense.length === 0 ? [] : ["--sense", sense.join(",")]),
      ...(analysis ? [] : ["--skip-analysis"]),
    ],
    request: {
      repository,
      mode: "incremental",
      sensors:
        sense.length === 0
          ? null
          : sense.map((name) => ({
              name,
              ...(suites?.[name] === undefined ? {} : { suites: suites[name] }),
            })),
      describe,
      analysis,
      ...(confirmAbove === undefined ? {} : { confirmAbove }),
      ...(modules === undefined
        ? {}
        : { modules: { file: "", names: modules } }),
      ignoreRetiredConfig: false,
      invocation: [],
    },
  };
}

export function withFiles(
  start: StartArguments,
  files: ScopeFiles,
): ScanRequest {
  const flags = [
    ...start.flags,
    ...(files.modules === undefined ? [] : ["--modules", files.modules]),
    ...(files.suites === undefined ? [] : ["--suites", files.suites]),
  ];

  return {
    ...start.request,
    ...(files.modules === undefined || start.modules === undefined
      ? {}
      : { modules: { file: files.modules, names: start.modules } }),
    ...(files.suites === undefined ? {} : { suitesFile: files.suites }),
    invocation: [start.repository, ...flags],
  };
}
