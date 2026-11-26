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
  planned: Record<string, number> | null;
  plannedFault: string | null;
}

const PLANNED_FAULT =
  "plannedMs must be an object mapping a plugin name to milliseconds, each a finite number of 0 or more";

function plannedOf(value: unknown): {
  planned: Record<string, number> | null;
  fault: string | null;
} {
  if (value === undefined || value === null) {
    return { planned: null, fault: null };
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return { planned: null, fault: PLANNED_FAULT };
  }

  const entries = Object.entries(value as Record<string, unknown>);

  if (
    entries.some(
      ([, ms]) => typeof ms !== "number" || !Number.isFinite(ms) || ms < 0,
    )
  ) {
    return { planned: null, fault: PLANNED_FAULT };
  }

  return {
    planned: Object.fromEntries(entries as [string, number][]),
    fault: null,
  };
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

  const { planned, fault } = plannedOf(args.plannedMs);

  return {
    repository,
    modules,
    suites,
    planned,
    plannedFault: fault,
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
