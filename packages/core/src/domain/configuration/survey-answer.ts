import { baseName } from "../path.js";
import type { SurveyNote, SurveyRunner, SurveyTool } from "./setup-survey.js";

export const ANSWER_PLACEHOLDERS = ["up", "slug"] as const;

export interface SurveyRequest {
  root: string;
  files: string[];
  suites: { language: string; directory: string }[];
}

export interface AnsweredRunner {
  language: string;
  runner: string;
  directory: string;
  from: string;
  command: string;
  coverage: { path: string; format: string };
  tool: string | null;
  env?: Record<string, string>;
  activate?: string;
  settings?: Record<string, string>;
}

export interface AnsweredTool {
  name: string;
  kind: string;
  installed: boolean;
  why: string;
  needed_by: string[];
  installs: string;
  prepare?: string[][];
  command: string[];
  cwd: string;
  files?: string[];
  undo?: string[];
  undo_note?: string;
}

export interface SurveyAnswer {
  runners: AnsweredRunner[];
  tools: AnsweredTool[];
  notes: SurveyNote[];
}

export type PluginAnswer =
  | {
      plugin: string;
      order: number;
      language: string;
      answer: SurveyAnswer;
    }
  | {
      plugin: string;
      order: number;
      language: string;
      failure: string;
    };

export interface AssembledAnswers {
  runners: SurveyRunner[];
  tools: SurveyTool[];
  notes: SurveyNote[];
}

const TOKEN = /\{\{|\}\}|\{([A-Za-z0-9_]*)\}|[{}]/g;

export function folderSlug(name: string): string {
  const slug = name.replace(/[^A-Za-z0-9._-]/g, "-");

  return slug.startsWith(".") ? `-${slug.slice(1)}` : slug;
}

function upOf(directory: string): string {
  const depth = directory === "." ? 0 : directory.split("/").length;

  return "../".repeat(depth);
}

function substituted(
  text: string,
  values: Record<string, string>,
): string | null {
  let broken = false;
  const result = text.replace(TOKEN, (token, name: string | undefined) => {
    if (token === "{{") {
      return "{";
    }

    if (token === "}}") {
      return "}";
    }

    if (name !== undefined && name in values) {
      return values[name] as string;
    }

    broken = true;

    return token;
  });

  return broken ? null : result;
}

function placeholdersIn(text: string): boolean {
  for (const match of text.matchAll(TOKEN)) {
    if (match[1] !== undefined) {
      return true;
    }
  }

  return false;
}

function toolTexts(tool: AnsweredTool): string[] {
  return [
    ...tool.command,
    tool.installs,
    ...(tool.prepare ?? []).flatMap((argv) => argv),
  ];
}

function runnerTexts(runner: AnsweredRunner): string[] {
  return [
    runner.command,
    runner.coverage.path,
    ...(runner.activate === undefined ? [] : [runner.activate]),
  ];
}

const RESERVED_SETTINGS = [
  "language",
  "directory",
  "command",
  "activate",
  "env",
  "coverage",
];

function refusalOf(answer: SurveyAnswer): string | null {
  const froms = new Set<string>();

  for (const runner of answer.runners) {
    if (froms.has(runner.from)) {
      return `two runners come from ${runner.from}`;
    }

    froms.add(runner.from);

    for (const text of runnerTexts(runner)) {
      if (substituted(text, { up: "", slug: "" }) === null) {
        return `a runner of ${runner.from} holds a brace that is not a placeholder`;
      }
    }

    for (const [key, value] of Object.entries(runner.settings ?? {})) {
      if (RESERVED_SETTINGS.includes(key)) {
        return `a runner of ${runner.from} sets ${key}, which core writes itself`;
      }

      if (/[{}]/.test(value)) {
        return `a runner of ${runner.from} holds a brace that is not a placeholder`;
      }
    }
  }

  for (const tool of answer.tools) {
    for (const from of tool.needed_by) {
      if (!froms.has(from)) {
        return `tool ${tool.name} is needed by ${from}, which is no runner`;
      }
    }

    for (const text of toolTexts(tool)) {
      if (substituted(text, { up: "", slug: "" }) === null) {
        return `tool ${tool.name} holds a brace that is not a placeholder`;
      }
    }

    if (
      new Set(tool.needed_by).size > 1 &&
      toolTexts(tool).some(placeholdersIn)
    ) {
      return `tool ${tool.name} holds a placeholder but is needed by more than one runner`;
    }
  }

  return null;
}

function nameOf(
  directory: string,
  root: string,
  used: Map<string, number>,
  names: Set<string>,
): string {
  const base = baseName(directory === "." ? root : directory).replace(
    /^src-/,
    "",
  );
  let seen = (used.get(base) ?? 0) + 1;
  let name = seen === 1 ? base : `${base}-${seen}`;

  while (names.has(name)) {
    seen += 1;
    name = `${base}-${seen}`;
  }

  used.set(base, seen);
  names.add(name);

  return name;
}

export function orderAnswers(answers: PluginAnswer[]): PluginAnswer[] {
  return [...answers].sort(
    (a, b) =>
      a.order - b.order ||
      (a.plugin < b.plugin ? -1 : a.plugin > b.plugin ? 1 : 0),
  );
}

function failureNote(one: PluginAnswer, reason: string): SurveyNote {
  return {
    language: one.language,
    directory: ".",
    text: `${one.plugin} did not answer the setup survey: ${reason}`,
  };
}

export function assembleRunners(
  answers: PluginAnswer[],
  root: string,
  taken: ReadonlySet<string> = new Set(),
): AssembledAnswers {
  const used = new Map<string, number>();
  const names = new Set(taken);
  const assembled: AssembledAnswers = { runners: [], tools: [], notes: [] };

  for (const one of orderAnswers(answers)) {
    if ("failure" in one) {
      assembled.notes.push(failureNote(one, one.failure));

      continue;
    }

    const refusal = refusalOf(one.answer);

    if (refusal !== null) {
      assembled.notes.push(failureNote(one, refusal));

      continue;
    }

    const byFrom = new Map<string, SurveyRunner>();

    for (const runner of one.answer.runners) {
      const name = nameOf(runner.directory, root, used, names);
      const values = { up: upOf(runner.directory), slug: folderSlug(name) };
      const fill = (text: string) => substituted(text, values) as string;

      const named: SurveyRunner = {
        name,
        language: runner.language,
        runner: runner.runner,
        directory: runner.directory,
        from: runner.from,
        command: fill(runner.command),
        coverage: {
          path: fill(runner.coverage.path),
          format: runner.coverage.format,
        },
        tool: runner.tool,
        ...(runner.env === undefined ? {} : { env: runner.env }),
        ...(runner.activate === undefined
          ? {}
          : { activate: fill(runner.activate) }),
        ...(runner.settings === undefined ? {} : { settings: runner.settings }),
      };

      byFrom.set(runner.from, named);
      assembled.runners.push(named);
    }

    for (const tool of one.answer.tools) {
      const owner = byFrom.get(tool.needed_by[0] as string) as SurveyRunner;
      const values = {
        up: upOf(owner.directory),
        slug: folderSlug(owner.name),
      };
      const fill = (text: string) => substituted(text, values) as string;

      assembled.tools.push({
        ...tool,
        needed_by: tool.needed_by.map(
          (from) => (byFrom.get(from) as SurveyRunner).name,
        ),
        installs: fill(tool.installs),
        command: tool.command.map(fill),
        ...(tool.prepare === undefined
          ? {}
          : { prepare: tool.prepare.map((argv) => argv.map(fill)) }),
      });
    }

    assembled.notes.push(...one.answer.notes);
  }

  return assembled;
}
