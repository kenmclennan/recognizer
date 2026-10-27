import { executeCheck } from "./check-command.js";
import type { Io } from "./cli.js";
import { runHelp } from "./help.js";
import { runOpen } from "./open-command.js";
import {
  runCallers,
  runPath,
  runUsedBy,
  runUses,
} from "./question-commands.js";
import { runScan } from "./scan-command.js";

export interface Command {
  name: string;
  summary: string;
  usage: string;
  arguments: { name: string; description: string }[];
  options: { flag: string; description: string }[];
  output: { text: string; json: string };
  exitCodes: { code: number; meaning: string }[];
  examples: { command: string; note: string }[];
  run(argv: string[], io: Io): number;
}

const REPOSITORY_OPTIONS = [
  {
    flag: "--repository <dir>",
    description:
      "the repository to ask about; defaults to the current directory",
  },
  { flag: "--json", description: "print JSON instead of text" },
];

const QUESTION_EXIT_CODES = [
  { code: 0, meaning: "the question was answered" },
  {
    code: 2,
    meaning:
      "bad input - an unknown module, a wrong argument count, an unknown flag, or a scan that could not be made",
  },
];

const SAMPLE = "--repository fixtures/python/sample";

export const COMMANDS: Command[] = [
  {
    name: "check",
    summary:
      "report violations, baseline growth, metrics and warnings for a scan",
    usage:
      "recognizer check --scan <scan.json> [--policy <policy.yaml>] [--baseline <file>] [--update-baseline|--init-baseline] [--hub-threshold <n>]",
    arguments: [],
    options: [
      { flag: "--scan <file>", description: "the scan to read (required)" },
      {
        flag: "--policy <file>",
        description: "the policy to check the scan against",
      },
      {
        flag: "--baseline <file>",
        description:
          "the baseline; defaults to baselines/violations.json beside the policy",
      },
      {
        flag: "--update-baseline",
        description: "shrink the baseline by the violations that are fixed",
      },
      {
        flag: "--init-baseline",
        description: "write the baseline from today's violations",
      },
      {
        flag: "--hub-threshold <n>",
        description: "the dependent count above which a module is a hub",
      },
    ],
    output: {
      text: "a summary on stderr; the report document on stdout",
      json: "the report document is always JSON on stdout: violations, new, fixed, baseline, metrics and warnings",
    },
    exitCodes: [
      { code: 0, meaning: "no new violation, or no policy" },
      { code: 1, meaning: "at least one new violation" },
      { code: 2, meaning: "bad input" },
    ],
    examples: [
      {
        command:
          "recognizer check --scan fixtures/check/scan.json --policy fixtures/check/.recognizer/policy.yaml",
        note: "check the check fixture against its policy",
      },
    ],
    run: executeCheck,
  },
  {
    name: "scan",
    summary: "scan a repository's languages into its cache",
    usage: "recognizer scan [REPOSITORY] [--json]",
    arguments: [
      {
        name: "REPOSITORY",
        description:
          "the repository to scan; defaults to the current directory",
      },
    ],
    options: [{ flag: "--json", description: "print one JSON document" }],
    output: {
      text: "one line per written language on stdout; failures on stderr",
      json: "one document on stdout with repository, commit, languages and removed",
    },
    exitCodes: [
      {
        code: 0,
        meaning: "every detected language was written, or none was detected",
      },
      { code: 1, meaning: "at least one detected language failed" },
      { code: 2, meaning: "bad usage" },
    ],
    examples: [
      {
        command: "recognizer scan fixtures/python/sample",
        note: "scan the Python sample into its cache",
      },
    ],
    run: runScan,
  },
  {
    name: "open",
    summary: "open a folder in the Recognizer viewer",
    usage: "recognizer open [FOLDER]",
    arguments: [
      {
        name: "FOLDER",
        description: "the folder to open; defaults to the current directory",
      },
    ],
    options: [],
    output: {
      text: "nothing on success; the problem on stderr",
      json: "the same as text; this command has no --json",
    },
    exitCodes: [
      { code: 0, meaning: "the viewer was started" },
      { code: 1, meaning: "the viewer is missing or failed to start" },
      { code: 2, meaning: "bad input" },
    ],
    examples: [
      { command: "recognizer open .", note: "open the current directory" },
    ],
    run: runOpen,
  },
  {
    name: "uses",
    summary: "list the modules a module uses, grouped by folder",
    usage: "recognizer uses <module> [--repository <dir>] [--json]",
    arguments: [
      {
        name: "<module>",
        description: "a module's repository-relative path",
      },
    ],
    options: REPOSITORY_OPTIONS,
    output: {
      text: "`<module> uses N modules`, then per folder a `<folder>/` line and one indented line per module with the names used, suffixed (private) or (inferred)",
      json: '{ module, direction: "uses", count, groups: [{ folder, modules: [{ id, names, private, inferred }] }] }',
    },
    exitCodes: QUESTION_EXIT_CODES,
    examples: [
      {
        command: `recognizer uses shop/application/place.py ${SAMPLE}`,
        note: "what place.py depends on",
      },
    ],
    run: runUses,
  },
  {
    name: "used-by",
    summary: "list the modules that use a module, grouped by folder",
    usage: "recognizer used-by <module> [--repository <dir>] [--json]",
    arguments: [
      {
        name: "<module>",
        description: "a module's repository-relative path",
      },
    ],
    options: REPOSITORY_OPTIONS,
    output: {
      text: "`<module> is used by N modules`, then per folder a `<folder>/` line and one indented line per module with the names used, suffixed (private) or (inferred)",
      json: '{ module, direction: "usedBy", count, groups: [{ folder, modules: [{ id, names, private, inferred }] }] }',
    },
    exitCodes: QUESTION_EXIT_CODES,
    examples: [
      {
        command: `recognizer used-by shop/domain/order.py ${SAMPLE} --json`,
        note: "who depends on order.py, as JSON",
      },
    ],
    run: runUsedBy,
  },
  {
    name: "callers",
    summary: "list the modules that call a module's member",
    usage: "recognizer callers <module> <name> [--repository <dir>] [--json]",
    arguments: [
      {
        name: "<module>",
        description: "a module's repository-relative path",
      },
      {
        name: "<name>",
        description:
          "the member's qualified name as the scan writes it after ::, such as Store.save",
      },
    ],
    options: REPOSITORY_OPTIONS,
    output: {
      text: "`<module>::<name> is called by N modules`, one line per caller with (through <Abstraction>) when it reaches the member by dispatch, then `built: yes|no`",
      json: "{ module, name, constructed, callers: [{ module, through }] }",
    },
    exitCodes: [
      { code: 0, meaning: "the question was answered, including zero callers" },
      {
        code: 2,
        meaning:
          "bad input - an unknown module, a scan with no call data for the module, or a scan that could not be made",
      },
    ],
    examples: [
      {
        command: `recognizer callers shop/ports/store.py Store.save ${SAMPLE}`,
        note: "who calls Store.save",
      },
    ],
    run: runCallers,
  },
  {
    name: "path",
    summary: "find the shortest chain of uses from one module to another",
    usage: "recognizer path <from> <to> [--repository <dir>] [--json]",
    arguments: [
      { name: "<from>", description: "the module the chain starts at" },
      { name: "<to>", description: "the module the chain ends at" },
    ],
    options: REPOSITORY_OPTIONS,
    output: {
      text: "`<from> reaches <to> in N steps` and one `a -> b  names` line per step, or `no path from <from> to <to>`",
      json: "{ from, to, found, steps: [{ from, to, names, private, inferred }] }, with steps empty when found is false",
    },
    exitCodes: [
      { code: 0, meaning: "a path exists, including from a module to itself" },
      { code: 1, meaning: "no path exists" },
      { code: 2, meaning: "bad input" },
    ],
    examples: [
      {
        command: `recognizer path shop/adapters/special_store.py shop/ports/store.py ${SAMPLE}`,
        note: "how special_store.py reaches the store port",
      },
    ],
    run: runPath,
  },
  {
    name: "help",
    summary: "print the full help for a command",
    usage: "recognizer help [command]",
    arguments: [
      {
        name: "[command]",
        description: "the command to describe; without it, list every command",
      },
    ],
    options: [],
    output: {
      text: "the command's entry, or the command list",
      json: "the same as text; this command has no --json",
    },
    exitCodes: [
      { code: 0, meaning: "the help was printed" },
      { code: 2, meaning: "no such command" },
    ],
    examples: [
      { command: "recognizer help path", note: "the full entry for path" },
    ],
    run: runHelp,
  },
];
