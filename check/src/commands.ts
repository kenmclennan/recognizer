import { executeCheck } from "./check-command.js";
import type { Io } from "./cli.js";
import { runDescribeCommand } from "./describe-command.js";
import { runHelp } from "./help.js";
import { runMeasure } from "./measure-command.js";
import { runOpen } from "./open-command.js";
import {
  runCallers,
  runPath,
  runUsedBy,
  runUses,
} from "./question-commands.js";
import { runScan } from "./scan-command.js";
import { runViews } from "./views-command.js";

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
    name: "views",
    summary:
      "build, show and check saved views: new, add, rule, fold, focus, remove, show, list, check, rm",
    usage: [
      "recognizer views new <name> --description <text>",
      "recognizer views add <name> <module>...",
      "recognizer views rule <name> (--folder <folder> | --uses <module> | --used-by <module>) [--within <folder>]",
      "recognizer views fold <name> <folder>",
      "recognizer views focus <name> <folder>",
      "recognizer views remove <name> <path> [--fold | --focus | --rule folder|uses|used-by [--within <folder>]]",
      "recognizer views show (<name> | --current)",
      "recognizer views list",
      "recognizer views check [<name>] [--fix]",
      "recognizer views rm <name>",
      "every subcommand also takes [--repository <dir>] [--json]",
    ].join("\n"),
    arguments: [
      {
        name: "<name>",
        description:
          "a view's name: letters, digits, - and _, at most 64; the file is .recognizer/views/<name>.json",
      },
      {
        name: "<module>",
        description: "a module's repository-relative path, as in the scan",
      },
      {
        name: "<folder>",
        description:
          "a folder's repository-relative path; a trailing / is dropped",
      },
      {
        name: "new",
        description:
          "create an empty view saved at the current commit; --description is required",
      },
      {
        name: "add",
        description: "pick one or more modules; each must be in the scan",
      },
      {
        name: "rule",
        description:
          "put a folder's modules (--folder), or what a module uses (--uses) or is used by (--used-by), on the view, re-evaluated against every scan; --uses and --used-by are direct, one step (the rows the Dependencies tab lists), not transitive; --within limits uses and used-by to a folder",
      },
      {
        name: "fold",
        description: "fold a folder into one box on the canvas",
      },
      {
        name: "focus",
        description: "focus a folder; a view has at most one focus",
      },
      {
        name: "remove",
        description:
          "take a module off the view (its pick is deleted and, if a rule still puts it there, it is recorded as left out); with --fold, --focus or --rule delete that step instead",
      },
      {
        name: "show",
        description:
          "print a view's steps and the modules they resolve to now; --current prints the view open in the app",
      },
      { name: "list", description: "list every saved view" },
      {
        name: "check",
        description:
          "list the steps that name a path that no longer exists; --fix rewrites picks whose files git records as renamed",
      },
      { name: "rm", description: "delete a view" },
    ],
    options: [
      ...REPOSITORY_OPTIONS,
      {
        flag: "--description <text>",
        description: "what the view shows (new)",
      },
      { flag: "--folder <folder>", description: "a folder rule (rule)" },
      { flag: "--uses <module>", description: "a uses rule (rule)" },
      { flag: "--used-by <module>", description: "a used-by rule (rule)" },
      {
        flag: "--within <folder>",
        description: "limit a uses or used-by rule to a folder (rule, remove)",
      },
      { flag: "--fold", description: "delete the fold step (remove)" },
      { flag: "--focus", description: "delete the focus step (remove)" },
      {
        flag: "--rule <relation>",
        description:
          "delete the rule with relation folder, uses or used-by (remove)",
      },
      {
        flag: "--current",
        description: "show the view open in the app (show)",
      },
      {
        flag: "--fix",
        description: "rewrite renamed picks (check)",
      },
    ],
    output: {
      text: [
        "new, add, rule, fold, focus, remove: `<name>: <what changed>; N steps, resolves to M modules`",
        "show: `<name>: <description>`, `saved at <commit>`, the numbered steps, `resolves to N modules` with one per line, then unresolved, folded and focus lines when there are any",
        "list: one `<name>  N steps  <commit>  <description>` line per view",
        "check: `<name>: ok` or `<name>: N unresolved` with one `step N <kind> <path> - no such <module|folder>` line each, plus `(renamed to <path>)` when git records one",
        "rm: `<name>: removed`",
      ].join("\n"),
      json: [
        "new, add, rule, fold, focus, remove: { view, changed, steps, modules }",
        "show: { name, description, commit, steps, resolved: { modules, folded, focus }, unresolved: [{ step, kind, path, what }] }; with --current { current }",
        "list: { views: [{ name, description, commit, steps } | { name, error }] }",
        "check: { ok, views: [{ name, ok, error?, unresolved: [{ step, kind, path, what, renamedTo }], fixed: [{ step, from, to }] }] }",
        "rm: { view, removed }",
      ].join("\n"),
    },
    exitCodes: [
      { code: 0, meaning: "done, including a step that was already present" },
      {
        code: 1,
        meaning:
          "check found a step naming a path that no longer exists or an invalid file; show --current with no view open",
      },
      {
        code: 2,
        meaning:
          "bad input - an unknown view, module or folder, a view that already exists, an invalid name, a wrong argument count, an unknown flag or an invalid view file",
      },
    ],
    examples: [
      {
        command:
          'recognizer views new order-placement --description "How an order is placed: the use case, what it uses, and the store implementation"',
        note: "start a view at the current commit",
      },
      {
        command:
          "recognizer views add order-placement shop/application/place.py",
        note: "pick the use case",
      },
      {
        command:
          "recognizer views rule order-placement --uses shop/application/place.py",
        note: "add everything the use case uses",
      },
      {
        command:
          "recognizer views rule order-placement --used-by shop/ports/store.py --within shop/adapters",
        note: "add the adapters that use the store port",
      },
      {
        command: "recognizer views show order-placement --json",
        note: "the modules the view resolves to now",
      },
    ],
    run: runViews,
  },
  {
    name: "describe",
    summary:
      "write each module's one-line responsibility with the repository's registered describer",
    usage: [
      "recognizer describe [<module>... | --all] [--repository <dir>] [--json]",
      "recognizer describe --check [<module>...] [--repository <dir>] [--json]",
    ].join("\n"),
    arguments: [
      {
        name: "<module>",
        description:
          "a module's repository-relative path; without a module, describe redoes every missing or out-of-date line, and with one it redoes exactly the named modules whatever their status",
      },
    ],
    options: [
      {
        flag: "--all",
        description: "describe every module in the scan, current or not",
      },
      {
        flag: "--check",
        description:
          "run no describer and write nothing: print each module's status and line",
      },
      {
        flag: "--repository <dir>",
        description:
          "the repository to describe; defaults to the current directory",
      },
      { flag: "--json", description: "print JSON instead of text" },
    ],
    output: {
      text: [
        "describe: `described <id>` per success on stdout and `failed <id>: <reason>` per failure on stderr, then `described N, failed M, already current K`, with `, pruned P` when entries were removed",
        "describe --check: one `<id>  <status>  <line>` row per module, where status is current, out-of-date (followed by `(source changed)`, `(describer changed)` and/or `(version changed)`), missing or unreadable, then `N current, M out of date, K missing`, then a `gone <id>` line for each entry whose module is no longer in the scan",
      ].join("\n"),
      json: [
        "describe: { described: string[], failed: [{ module, reason }], current, pruned: string[] }",
        "describe --check: { ok, counts: { current, outOfDate, missing, unreadable }, modules: [{ module, status, line, reasons }], gone: string[] }, with line null when missing and reasons empty unless out of date",
      ].join("\n"),
    },
    exitCodes: [
      {
        code: 0,
        meaning:
          "every selected module was described or none was selected; with --check, every module is current",
      },
      {
        code: 1,
        meaning:
          "at least one selected module failed (the rest are still written); with --check, at least one module is not current",
      },
      {
        code: 2,
        meaning:
          "bad input - no describer registered in .recognizer/config.yaml, an invalid config or responsibilities file, an unknown module, --all with a module or with --check, an unknown flag or a scan that could not be made",
      },
    ],
    examples: [
      {
        command: "recognizer describe",
        note: "describe every module whose line is missing or out of date",
      },
      {
        command: "recognizer describe shop/domain/order.py",
        note: "redo one module's line",
      },
      {
        command: "recognizer describe --check --json",
        note: "report which lines are current, without describing anything",
      },
    ],
    run: runDescribeCommand,
  },
  {
    name: "measure",
    summary:
      "run the overlays a repository registers and write each one's measurements to the cache",
    usage: "recognizer measure [<name>...] [--repository <dir>] [--json]",
    arguments: [
      {
        name: "<name>",
        description:
          "a registered overlay's name; without a name, measure runs every registered overlay in config order",
      },
    ],
    options: [
      {
        flag: "--repository <dir>",
        description:
          "the repository to measure; defaults to the current directory",
      },
      { flag: "--json", description: "print JSON instead of text" },
    ],
    output: {
      text: "`measured <name>` per success on stdout and `failed <name>: <reason>` per failure on stderr, then `measured N, failed M`",
      json: "{ commit, modified, measured: string[], failed: [{ overlay, reason }] }",
    },
    exitCodes: [
      { code: 0, meaning: "every selected overlay was measured" },
      {
        code: 1,
        meaning:
          "at least one selected overlay failed (the rest are still measured); a failed overlay leaves no file",
      },
      {
        code: 2,
        meaning:
          "bad input - no overlays registered in .recognizer/config.yaml, an invalid config, an unknown overlay name, an unknown flag, or no git commit",
      },
    ],
    examples: [
      {
        command: "recognizer measure",
        note: "run every registered overlay",
      },
      {
        command: "recognizer measure coverage --json",
        note: "run one overlay and print the outcome as JSON",
      },
    ],
    run: runMeasure,
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
