import { runAgents } from "./agents-command.js";
import { executeCheck } from "./check-command.js";
import type { Io } from "./cli.js";
import { runConfig } from "./config-command.js";
import { runDescribeCommand } from "./describe-command.js";
import { runDoctor } from "./doctor-command.js";
import { runHelp } from "./help.js";
import { runLog } from "./log-command.js";
import { runOpen } from "./open-command.js";
import { runPlugin } from "./plugin-command.js";
import { runPlugins } from "./plugins-command.js";
import { runPolicy } from "./policy-command.js";
import {
  runCallers,
  runPath,
  runUsedBy,
  runUses,
} from "./question-commands.js";
import { runFind, runModules, runShow } from "./read-commands.js";
import { runReport } from "./report-command.js";
import { runScan } from "./scan-command.js";
import { runSensors } from "./sensors-command.js";
import { runViews } from "./views-command.js";
import { runWindow, runWindows } from "./window-commands.js";

export interface Command {
  name: string;
  summary: string;
  usage: string;
  arguments: { name: string; description: string }[];
  options: { flag: string; description: string }[];
  output: { text: string; json: string };
  exitCodes: { code: number; meaning: string }[];
  examples: { command: string; note: string }[];
  run(argv: string[], io: Io): number | Promise<number>;
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
      "report violations, baseline growth, metrics and warnings for the repository's scan, or for a scan file",
    usage: [
      "recognizer check [<module>...] [--repository <dir>] [--policy <policy.yaml>] [--baseline <file>] [--update-baseline|--init-baseline] [--json]",
      "recognizer check --scan <scan.json> [--policy <policy.yaml>] [--baseline <file>] [--update-baseline|--init-baseline]",
    ].join("\n"),
    arguments: [
      {
        name: "<module>",
        description:
          "a module's repository-relative path; narrows the report to violations that touch it, warnings that name it and its metrics; not with --scan, --update-baseline or --init-baseline",
      },
    ],
    options: [
      {
        flag: "--scan <file>",
        description:
          "replay this scan document instead of the repository's scan; takes no module, --repository or --json",
      },
      {
        flag: "--repository <dir>",
        description:
          "the repository to check; defaults to the current directory. Its scan is read from the cache, scanning first when the cache is stale",
      },
      {
        flag: "--policy <file>",
        description:
          "the policy to check against; defaults to .recognizer/policy.yaml in the repository when it exists, else only warnings and metrics are reported",
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
        description:
          "write the baseline from today's violations; refused with exit 2 while a registered sensor's results are out of date or invalid, naming each to rerun with recognizer scan --sense",
      },
      {
        flag: "--json",
        description: "print the report document instead of text",
      },
    ],
    output: {
      text: "repository mode: a `sensor structure:` line with the settings in effect, the summary lines and one `warning: <summary>` line per warning on stdout; with --scan: a summary on stderr and the report document on stdout. In repository mode check runs the structure sensor, writes its findings file in .recognizer/cache/findings/ and reads every current findings file there; it never runs a registered sensor, so run `recognizer scan --sense all` first when their findings should count",
      json: "the report document: violations, new, fixed, unranked, baseline, warnings and metrics, and in repository mode a sensors list of { name, status, reason?, settings? } where a registered sensor is ran only when its file is current, else stale or missing; always JSON on stdout with --scan, and with --json in repository mode",
    },
    exitCodes: [
      { code: 0, meaning: "no new violation, or no policy" },
      {
        code: 1,
        meaning:
          "at least one new violation, the structure sensor failed, or a findings file is invalid",
      },
      {
        code: 2,
        meaning:
          "bad input - an unknown module, a baseline flag with a module, --init-baseline while a registered sensor's results are out of date or invalid, --scan with a module or --json, an unknown flag or a scan that could not be made",
      },
    ],
    examples: [
      {
        command: `recognizer check ${SAMPLE}`,
        note: "check the sample repository's current scan",
      },
      {
        command:
          "recognizer check --scan fixtures/check/scan.json --policy fixtures/check/.recognizer/policy.yaml",
        note: "replay the check fixture's scan against its policy",
      },
    ],
    run: executeCheck,
  },
  {
    name: "scan",
    summary:
      "scan a repository in up to three phases: extract when the files changed, describe, sense",
    usage:
      "recognizer scan [REPOSITORY] [--extract] [--describe[=all]] [--sense <all|name[,name...]>] [--modules <file>] [--suites <file>] [--confirm-above <usd>] [--by <name>] [--ignore-retired-config] [--json]",
    arguments: [
      {
        name: "REPOSITORY",
        description:
          "the repository to scan; defaults to the current directory",
      },
    ],
    options: [
      {
        flag: "--extract",
        description:
          "extract even when the cached scans are current for the commit, the tree and the scanner versions",
      },
      {
        flag: "--describe[=all]",
        description:
          "describe every module whose line is missing or out of date, as recognizer describe does with no names, up to the batch size at once; =all describes every module (the value only with =)",
      },
      {
        flag: "--sense <all|name[,name...]>",
        description:
          "run every registered sensor, or the named ones, in config order",
      },
      {
        flag: "--modules <file>",
        description:
          "a JSON array of module ids that limits --describe to those modules (the stale ones among them, or all of them with =all) and passes the file to the mutation sensor, which mutates only those modules' functions; needs --describe or --sense, and no other sensor takes it",
      },
      {
        flag: "--suites <file>",
        description:
          "a JSON object from sensor name to an array of configured suite names that limits a sensor that runs tests to those suites; needs --sense",
      },
      {
        flag: "--confirm-above <usd>",
        description:
          "ask before describing when the projected cost is strictly above this many dollars or its price is unknown; the answer is a line typed in a terminal or the answer file the app writes; without the flag a scan never asks",
      },
      {
        flag: "--by <name>",
        description:
          "who asked, recorded in the run log; defaults to the login user",
      },
      {
        flag: "--ignore-retired-config",
        description:
          "read the config as if every retired key had never been written, instead of refusing it, and read a moved sensors.duplication as sensors.structure.duplication, so a past commit's files can be scanned; every other config error still refuses, and it takes no --describe or --sense",
      },
      {
        flag: "--json",
        description: "print one JSON line per event instead of text",
      },
    ],
    output: {
      text: "a heading line per phase (extract, describe, sense) and one line per entry on stdout, `scans current at <commit>` when extraction was skipped; failures on stderr",
      json: "one line per event on stdout as it happens: `phase` (extract: state run|current, commit, reason; describe and sense: total), `progress` (phase sense, name, step coverage|mutants, and done and total with mutants; only from a sensor that runs tests and reports it, such as mutation), `entry` (phase, name, outcome ok|failed, reason when failed, modules and edges for a written language), `preflight` (state run|ok|gaps, and the gaps with each one's id, line, needs and fix when gaps) and a last `summary` (repository, commit, modified, exit, phases with their entries, removed, skipped)",
    },
    exitCodes: [
      {
        code: 0,
        meaning: "every phase asked for succeeded, or no language was detected",
      },
      {
        code: 1,
        meaning:
          "a language, a describer entry or a sensor entry failed (the remaining entries still run)",
      },
      {
        code: 2,
        meaning:
          "bad input - an unknown sensor name, --sense with no sensors registered, more than one repository, an empty --by, --modules without --describe or --sense or with an unreadable or malformed file, --suites without --sense, --ignore-retired-config with --describe or --sense, or an unknown flag",
      },
      {
        code: 3,
        meaning:
          "another scan is already running on the repository; the reason on stderr names who started it, when, and its process id",
      },
      {
        code: 4,
        meaning:
          "preflight found a gap in a tool the ticked phases need; no describe call or sensor ran, extraction may have; one line per gap with its fix on stderr",
      },
    ],
    examples: [
      {
        command: "recognizer scan fixtures/python/sample",
        note: "scan the Python sample into its cache, or report the cached scans current",
      },
      {
        command: "recognizer scan --sense all",
        note: "bring the scans up to date, then run every registered sensor; recognizer check reads their findings",
      },
    ],
    run: runScan,
  },
  {
    name: "open",
    summary: "open a folder, or a recognizer:// link, in the Recognizer viewer",
    usage: "recognizer open [FOLDER|LINK]",
    arguments: [
      {
        name: "FOLDER",
        description: "the folder to open; defaults to the current directory",
      },
      {
        name: "LINK",
        description:
          "a recognizer://open?repo=<absolute path>[&view=<name>] link, checked against the folder and its saved views before the viewer starts",
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
      {
        command:
          "recognizer open 'recognizer://open?repo=%2Fwork%2Fapp&view=overview'",
        note: "open a folder and one of its saved views",
      },
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
    name: "find",
    summary: "find modules by path and members by name",
    usage: "recognizer find <text> [--repository <dir>] [--json]",
    arguments: [
      {
        name: "<text>",
        description:
          "a case-insensitive substring of a module's path or of a top-level member's name",
      },
    ],
    options: REPOSITORY_OPTIONS,
    output: {
      text: "`N modules, M members matched`, then a `modules` list of ids and a `members` list of `module::name  kind  line N`",
      json: "{ text, modules: [{ id, kind }], members: [{ module, name, kind, line, exported }] }",
    },
    exitCodes: QUESTION_EXIT_CODES,
    examples: [
      {
        command: `recognizer find order ${SAMPLE}`,
        note: "every module path and member name containing order",
      },
    ],
    run: runFind,
  },
  {
    name: "show",
    summary:
      "show what the explorer's Contents tab shows for a module: members, signatures, responsibility and findings",
    usage: "recognizer show <module> [--private] [--repository <dir>] [--json]",
    arguments: [
      {
        name: "<module>",
        description: "a module's repository-relative path",
      },
    ],
    options: [
      {
        flag: "--private",
        description:
          "list private members, fields and methods too; without it they are counted as hidden",
      },
      ...REPOSITORY_OPTIONS,
    ],
    output: {
      text: "a header `module  kind  uses N  used by N`, a `responsibility:` line with its status in brackets unless current (and a `run recognizer describe <module> to write it` line when it is missing), one `line  visibility  kind  signature` row per member with a class's fields and methods indented under it, `N private hidden`, then `findings:` rows or `no findings`",
      json: '{ module, kind, uses, usedBy, responsibility: { status: "current"|"out-of-date"|"missing"|"unchecked", line }, members: [{ name, kind, line, visibility, signature, fields?, methods? }], hiddenPrivate, findings: [{ severity, text, why }] }',
    },
    exitCodes: QUESTION_EXIT_CODES,
    examples: [
      {
        command: `recognizer show shop/domain/order.py ${SAMPLE}`,
        note: "the contents of order.py",
      },
    ],
    run: runShow,
  },
  {
    name: "modules",
    summary:
      "list the modules with their uses, used-by and finding counts, filtered and sorted",
    usage:
      "recognizer modules [--folder <path>] [--findings] [--min-uses <n>] [--min-used-by <n>] [--sort <id|uses|used-by|findings>] [--reverse] [--limit <n>] [--repository <dir>] [--json]",
    arguments: [],
    options: [
      {
        flag: "--folder <path>",
        description: "keep modules at or under this folder",
      },
      {
        flag: "--findings",
        description: "keep modules with at least one finding",
      },
      {
        flag: "--min-uses <n>",
        description: "keep modules that use at least n modules (integer >= 0)",
      },
      {
        flag: "--min-used-by <n>",
        description: "keep modules used by at least n modules (integer >= 0)",
      },
      {
        flag: "--sort <key>",
        description:
          "id (ascending, the default), or uses, used-by or findings (descending, ties by id)",
      },
      { flag: "--reverse", description: "flip the sort order" },
      {
        flag: "--limit <n>",
        description: "keep the first n rows after sorting (integer >= 1)",
      },
      ...REPOSITORY_OPTIONS,
    ],
    output: {
      text: "`N of M modules`, then `id  kind  uses N  used by N  findings N` per row",
      json: "{ total, count, modules: [{ id, kind, uses, usedBy, findings }] }, where total is before the filters",
    },
    exitCodes: QUESTION_EXIT_CODES,
    examples: [
      {
        command: `recognizer modules --sort used-by --limit 5 ${SAMPLE}`,
        note: "the five most depended-on modules",
      },
    ],
    run: runModules,
  },
  {
    name: "views",
    summary:
      "build, show and check saved views: new, add, rule, fold, focus, remove, change, note, reorder, set, show, diff, list, check, rm",
    usage: [
      "recognizer views new <name> --description <text> [--change <base>..<head> | --plan] [--from-window <id>]",
      "recognizer views add <name> <module>[#<member>]... [--change new|changes|moves|moves-and-changes|removed [--from <path>]]",
      "recognizer views rule <name> (--folder <folder> | --uses <module> | --used-by <module>) [--within <folder>]",
      "recognizer views fold <name> <folder>",
      "recognizer views focus <name> <folder>",
      "recognizer views remove <name> <path-or-module#member> [--fold | --focus | --rule folder|uses|used-by [--within <folder>]]",
      "recognizer views change <name> <module>[#<member>] (new|changes|moves|moves-and-changes|removed [--from <path>] | --clear)",
      "recognizer views note <name> <module-or-folder> (<text> [--by <name>] [--after <module-or-folder> | --first] | --remove [--by <name>])",
      "recognizer views reorder <name> <module-or-folder>...",
      "recognizer views set <name> [--change <base>..<head>|none] [--plan | --no-plan] [--title <text>] [--description <text>]",
      "recognizer views show <name>",
      "recognizer views diff <name>",
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
        name: "<text>",
        description:
          "a note's text; a module or a folder carries one note, and writing one replaces the one already there",
      },
      {
        name: "new",
        description:
          "create a view saved at the current commit, empty or, with --from-window, holding what that window shows; --description is required",
      },
      {
        name: "add",
        description:
          "pick one or more modules; each must be in the scan, except on a plan with --change new, moves or moves-and-changes, where a module that does not exist yet is planned and takes only its proposed change; --change sets the proposed change of each module named (a plan only)",
      },
      {
        name: "change",
        description:
          "set or clear a proposed change on a plan: what the plan says will happen to one module, drawn as a coloured border. A proposed change is new, changes, moves, moves-and-changes or removed; changes and removed need the module in the scan; moves and moves-and-changes need --from, the path the module moves from, and draw a ghost box there. --clear removes it, and is refused on a planned module (remove it with views remove)",
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
        description: "print a view's steps and the modules they resolve to now",
      },
      {
        name: "diff",
        description:
          "for a change view, run git diff --name-status over its range and print the modules it changed, each marked added, modified or removed, with the two commits and the count of changed files that matched no module; read-only, exit 1 for a view with no range or a ref git does not know",
      },
      {
        name: "list",
        description:
          "list every saved view with its range when it has one and, for a stale view, its reasons",
      },
      {
        name: "check",
        description:
          "list the steps that name a path that no longer exists, and a stale view's reasons (a change view whose head is merged into its base or is not in the repository); --fix rewrites picks whose files git records as renamed; a stale view never fails the check, only an invalid file or an unresolved pick does",
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
        flag: "--from-window <id>",
        description:
          "save what the app window with this id shows as the view: one pick per module on the canvas, one fold per folded folder and the focus; the window must hold --repository (new)",
      },
      {
        flag: "--change <base>..<head>|none",
        description:
          "make the view a change view over a git range, each side a ref git knows; none removes the range (new, set). On add it takes a proposed change kind instead, and on a plan only",
      },
      {
        flag: "--plan",
        description:
          "make the view a plan: modules may carry a proposed change, and the view has no change range (new, set)",
      },
      {
        flag: "--no-plan",
        description:
          "stop the view being a plan, dropping its proposed changes (set)",
      },
      {
        flag: "--from <path>",
        description:
          "the path a moved module moves from; required with moves and moves-and-changes (add, change)",
      },
      {
        flag: "--clear",
        description: "clear a module's proposed change (change)",
      },
      {
        flag: "--fix",
        description: "rewrite renamed picks (check)",
      },
      {
        flag: "--by <name>",
        description:
          "who wrote the note, at most 64 characters; defaults to agent; with --remove, the note is removed only when this author wrote it last (note)",
      },
      {
        flag: "--remove",
        description:
          "delete the note on the module or folder instead of setting one (note)",
      },
    ],
    output: {
      text: [
        "new, add, rule, fold, focus, remove, note: `<name>: <what changed>; N steps, resolves to M modules`",
        "show: `<name>: <description>`, `saved at <commit>`, the numbered steps, `resolves to N modules` with one per line, then `notes:` with one `<n>. <module-or-folder>: <text> (<by>)` line per note in reading order (marked `(not on the view)` when it is not), then a `warning:` line when the file holds several notes on one path, then unresolved, folded and focus lines when there are any",
        "diff: `<name>: <range> (<base>..<head>)`, then one `<added|modified|removed> <module>` line per changed module (`(no box)` when a removed module is in no scan we hold) and a count of files that matched no module\n  list: one `<name>  [<range>  ]N steps  <commit>  <description>` line per view, then a `  stale: <reason>` line for each reason",
        "check: `<name>: ok` or `<name>: N unresolved` with one `step N <kind> <path> - no such <module|folder>` line each, plus `(renamed to <path>)` when git records one",
        "rm: `<name>: removed`",
      ].join("\n"),
      json: [
        "new, add, rule, fold, focus, remove, note: { view, changed, steps, modules }",
        "show: { name, description, commit, steps, notes: [{ module, text, by, number }], resolved: { modules, folded, focus }, unresolved: [{ step, kind, path, what }], warnings: [string] }",
        "diff: { view, range, baseCommit, headCommit, modules: [{ id, mark, box }], unmatched }\n  list: { views: [{ name, description, commit, steps, change?, stale: [{ kind, ... }] } | { name, error }] }",
        "check: { ok, views: [{ name, ok, error?, unresolved: [{ step, kind, path, what, renamedTo }], fixed: [{ step, from, to }], warnings: [string], stale: [{ kind, ... }] }] }",
        "rm: { view, removed }",
      ].join("\n"),
    },
    exitCodes: [
      { code: 0, meaning: "done, including a step that was already present" },
      {
        code: 1,
        meaning:
          "check found a step naming a path that no longer exists or an invalid file",
      },
      {
        code: 2,
        meaning:
          "bad input - an unknown view, module or folder, a view that already exists, an invalid name, a wrong argument count, an unknown flag, an invalid view file, or --from-window naming a window that is not open, is not running the app, holds another repository or shows a module the scan lacks",
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
        command:
          'recognizer views note order-placement shop/application/place.py "The one use case" --by Claude',
        note: "explain a module on the view; writing it again replaces the note in its place, and a path ending in / notes a folder; a new note goes last, so the order notes are written in is the reading order",
      },
      {
        command:
          'recognizer views note order-placement shop/ports/store.py "Then the port" --after shop/application/place.py',
        note: "place a note right after another; --first places it first",
      },
      {
        command:
          "recognizer views reorder order-placement shop/ports/store.py shop/application/place.py",
        note: "set the whole reading order; name every noted path once",
      },
      {
        command: "recognizer views set order-placement --change main..feat",
        note: "make the view a change view over a git range (none removes the range)",
      },
      {
        command:
          'recognizer views set order-placement --title "Placing an order" --description "How an order is placed"',
        note: "set the heading title and description; an empty --title removes the title",
      },
      {
        command:
          'recognizer views new redesign --description "Proposed split" --plan',
        note: "start a plan, a view of what will change before the code exists",
      },
      {
        command:
          "recognizer views add redesign shop/application/discount.py --change new",
        note: "plan a module that does not exist yet; changes and removed need the module in the scan, and moves needs --from <old path>",
      },
      {
        command: "recognizer views show order-placement --json",
        note: "the modules the view resolves to now",
      },
    ],
    run: runViews,
  },
  {
    name: "sensors",
    summary:
      "list the shipped sensors, with what each judges, and check their readiness",
    usage:
      "recognizer sensors [--json]\nrecognizer sensors check [name] [--run] [--work] [--modules <file>] [--suites <file>] [--json] [--repository <dir>]",
    arguments: [
      {
        name: "check [name]",
        description:
          "ask each sensor that is not off, or the named one, to check its own readiness and report what is missing; nothing is installed or fixed",
      },
    ],
    options: [
      { flag: "--json", description: "print JSON instead of text" },
      {
        flag: "--run",
        description:
          "with check: also run each ready suite once and confirm its coverage report appears and parses",
      },
      {
        flag: "--work",
        description:
          "with check: also ask a sensor that can say how much a run would do to count it from its own record, reading files and running no test",
      },
      {
        flag: "--modules <file>",
        description:
          "with check: a JSON file holding an array of module ids; the work is counted for those modules only",
      },
      {
        flag: "--suites <file>",
        description:
          "with check: a JSON file holding an array of suite names; a test-running sensor counts only those suites",
      },
      {
        flag: "--repository <dir>",
        description:
          "with check: the repository to check; default the current directory",
      },
    ],
    output: {
      text: "one `<name>  <description>` line per shipped sensor; with check, one block per sensor: `<name>: ready`, or `<name>: N gaps` followed by one indented sentence per gap",
      json: "[{ name, display, description, expansion, runs_tests, scoped, listed, metrics, findings, settings }], read from each sensor's manifest; with check, { ready, sensors: [{ name, ready, gaps: [{ code, suite, line }], notes: [{ code, suite, line }], work?: { unit, to_perform, reusable } }] }",
    },
    exitCodes: [
      { code: 0, meaning: "the list was printed, or every sensor is ready" },
      {
        code: 1,
        meaning:
          "check found a gap, or a sensor's manifest was unreadable (named on stderr, the readable sensors still printed)",
      },
      {
        code: 2,
        meaning: "bad arguments, an unknown sensor, or no sensors registered",
      },
    ],
    examples: [
      {
        command: "recognizer sensors --json",
        note: "the shipped sensors, read from their manifests",
      },
      {
        command: "recognizer sensors check crap --run",
        note: "what is missing before C.R.A.P. can run, with each suite run once",
      },
      {
        command: "recognizer help sensors crap",
        note: "the setup guide the sensor supplies",
      },
    ],
    run: runSensors,
  },
  {
    name: "config",
    summary:
      "read and edit .recognizer/config.yaml one value at a time, the way git config does",
    usage: [
      "recognizer config <key> <value>",
      "recognizer config --add <key> <value>",
      "recognizer config --get <key>",
      "recognizer config --list",
      "recognizer config --unset <key> [<value>]",
      "recognizer config --remove-section <section>",
      "recognizer config --add-section <section>",
      "recognizer config --schema [--repository <dir>]",
    ].join("\n"),
    arguments: [
      {
        name: "<key>",
        description:
          "a dotted path to one value; `recognizer config --help` lists every key from every owner with its type, allowed values and an example",
      },
      {
        name: "<value>",
        description:
          "the value, written as the type the key declares; a refused value changes nothing",
      },
      {
        name: "<section>",
        description:
          "a named entry such as sensors.<name>, which registers a sensor, or a list entry found by its name",
      },
    ],
    options: [
      {
        flag: "--add",
        description:
          "append the value to a multi-valued key; an item already present changes nothing",
      },
      {
        flag: "--get",
        description:
          "print the value of the key, one item per line for a multi-valued key",
      },
      {
        flag: "--list",
        description:
          "print every value that is set as key=value, in file order",
      },
      {
        flag: "--unset",
        description:
          "delete the key, or with a value delete that item of a multi-valued key",
      },
      {
        flag: "--remove-section",
        description: "delete a section and everything in it",
      },
      {
        flag: "--add-section",
        description:
          "create a section holding nothing but its name; an existing one is left alone",
      },
      {
        flag: "--schema",
        description:
          "print the key schema the sensors publish as JSON, with keys_version 1; exits 1 when a shipped sensor's manifest cannot be read; takes no other verb",
      },
      {
        flag: "--repository <dir>",
        description:
          "the repository whose config to edit; default the current directory",
      },
    ],
    output: {
      text: "a write prints nothing; --get prints the value, --list prints key=value lines; a refusal prints `recognizer config: <key>: <reason>` on stderr",
      json: "none: this command has no --json",
    },
    exitCodes: [
      {
        code: 0,
        meaning: "the value was written, or read, or the edit changed nothing",
      },
      {
        code: 1,
        meaning:
          "--get, --unset or --remove-section found nothing, or --list could not address part of the file",
      },
      {
        code: 2,
        meaning:
          "bad arguments, or a key, type, bound or allowed value the key schemas refuse; the file is unchanged",
      },
    ],
    examples: [
      {
        command: "recognizer config sensors.mutation.max_minutes 10",
        note: "set one value; the sensor is registered by it",
      },
      {
        command: "recognizer config --add sensors.mutation.carry .venv",
        note: "append to a multi-valued key",
      },
      {
        command: "recognizer config --list",
        note: "what is set now",
      },
      {
        command: "recognizer help config",
        note: "every key, with its type, allowed values and an example",
      },
    ],
    run: runConfig,
  },
  {
    name: "policy",
    summary:
      "read and edit .recognizer/policy.yaml one value at a time, with the verbs of recognizer config",
    usage: [
      "recognizer policy <key> <value>",
      "recognizer policy --add <key> <value>",
      "recognizer policy --get <key>",
      "recognizer policy --list",
      "recognizer policy --unset <key> [<value>]",
      "recognizer policy --remove-section <section>",
      "recognizer policy --add-section <section>",
    ].join("\n"),
    arguments: [
      {
        name: "<key>",
        description:
          "a dotted path to one list of strings; `recognizer policy --help` lists every key with its type and an example",
      },
      {
        name: "<value>",
        description:
          "one item of the list; a write that would leave the policy with an error it did not have is refused and changes nothing",
      },
      {
        name: "<section>",
        description: "components, uses or foreign: the map a key lives in",
      },
    ],
    options: [
      {
        flag: "--add",
        description:
          "append the item to a list; an item already present changes nothing",
      },
      {
        flag: "--get",
        description: "print the items of the key, one per line",
      },
      {
        flag: "--list",
        description:
          "print every value that is set as key=value, in file order",
      },
      {
        flag: "--unset",
        description:
          "delete the key, or with a value delete that item; the last item deletes the key",
      },
      {
        flag: "--remove-section",
        description: "delete a section and everything in it",
      },
      {
        flag: "--add-section",
        description: "create an empty section; an existing one is left alone",
      },
      {
        flag: "--repository <dir>",
        description:
          "the repository whose policy to edit; default the current directory",
      },
    ],
    output: {
      text: "a write prints nothing; --get prints the items, --list prints key=value lines; a refusal prints `recognizer policy: <key>: <reason>` on stderr",
      json: "none: this command has no --json",
    },
    exitCodes: [
      {
        code: 0,
        meaning: "the value was written, or read, or the edit changed nothing",
      },
      {
        code: 1,
        meaning:
          "nothing was found, there is no policy file, or --list could not address part of the file",
      },
      {
        code: 2,
        meaning: "bad arguments, or a refused write; the file is unchanged",
      },
    ],
    examples: [
      {
        command: "recognizer policy --add components.domain src/domain/**",
        note: "add a glob to a component, creating the policy on the first write",
      },
      {
        command: "recognizer policy --unset components.legacy",
        note: "delete a component; refused while levels or uses name it",
      },
      {
        command: "recognizer policy --list",
        note: "what the policy holds now",
      },
      {
        command: "recognizer help policy",
        note: "every key, with its type and an example",
      },
    ],
    run: runPolicy,
  },
  {
    name: "doctor",
    summary:
      "check that a repository's config, policy, scanners and sensors are valid and still match its code, with the command that fixes each problem",
    usage: "recognizer doctor [REPOSITORY] [--json]",
    arguments: [
      {
        name: "[REPOSITORY]",
        description:
          "the repository to check; defaults to the current directory. A fix command carries --repository <path> only when this is given",
      },
    ],
    options: [{ flag: "--json", description: "print JSON instead of text" }],
    output: {
      text: "for each area with a problem, its name and one indented line per problem with `fix: <command or instruction>` under it, then `not checked: <reason>` lines for a skipped area, and last `No problems` or `<n> problems`, then `<n> warnings` when there are any. An installed shipped sensor or describer that the config does not register is a `warning:` line with code `unregistered-plugin` and the fix `recognizer plugin add <name>`; a warning never changes the exit code",
      json: "{ repository, ok, problems, areas: [{ name: config|policy|scanners|sensors, skipped: string | null, problems: [{ code, subject, line, fix: { text, command: string | null }, severity: problem|warning }] }], warnings }",
    },
    exitCodes: [
      { code: 0, meaning: "no problems" },
      { code: 1, meaning: "at least one problem; the report names each" },
      {
        code: 2,
        meaning:
          "bad arguments, or the repository is not a directory; nothing was checked",
      },
    ],
    examples: [
      {
        command: "recognizer doctor",
        note: "check the repository in the current directory",
      },
      {
        command: "recognizer doctor ../other --json",
        note: "check another repository, for an agent or CI",
      },
    ],
    run: runDoctor,
  },
  {
    name: "plugin",
    summary:
      "check that a command is a conforming Recognizer plugin, or register an installed sensor or describer in a repository's config",
    usage: [
      "recognizer plugin check <command> [--repository <dir>] [--request <file>] [--json]",
      "recognizer plugin add <name> [--kind sensor|describer] [--repository <dir>]",
    ].join("\n"),
    arguments: [
      {
        name: "check <command>",
        description:
          "the plugin's program name, looked up on PATH, or an absolute path; its basename must be recognizer-scan-<name>, recognizer-sense-<name> or recognizer-describe-<name>",
      },
      {
        name: "add <name>",
        description:
          "the manifest name of an installed sensor or describer; it is registered in the repository's committed config and its install line is copied into the install section; a scanner is never registered, it is chosen with recognizer config scanners.<language> <name>",
      },
    ],
    options: [
      {
        flag: "--repository <dir>",
        description:
          "with check: run the verbs in this repository instead of a temporary one, for a plugin that needs real content; with add: the repository whose config is written, default the current directory",
      },
      {
        flag: "--request <file>",
        description:
          "with check: a describe request file; a describer's run spends a model call, so it is not run without one",
      },
      {
        flag: "--kind <sensor|describer>",
        description:
          "with add: which plugin to register when the name is both a sensor and a describer",
      },
      { flag: "--json", description: "with check: print JSON instead of text" },
    ],
    output: {
      text: "check: one line per result: ok, warn or fail, the result's name and, for a warning or a failure, the reason; the results are starts, clean-output, valid, named-for-command, protocol, side-effect-free, sentences, limits, check-verb, guide-verb, run-verb, events and stop. add: one line saying the plugin was registered or was already registered",
      json: "check: { command, manifest, results: [{ name, status: ok|warn|fail, reason? }] } where manifest is the plugin's manifest, or null when it gave no valid one. add prints no JSON",
    },
    exitCodes: [
      {
        code: 0,
        meaning:
          "check: nothing failed, a warning passes. add: the plugin was registered or already was",
      },
      {
        code: 1,
        meaning:
          "check: at least one result failed. add: the plugin speaks a protocol outside the supported range, or its manifest could not be read",
      },
      {
        code: 2,
        meaning:
          "bad input - no command or name, an unknown flag, a command or plugin that cannot be found on PATH, a name that is both a sensor and a describer without --kind, a scanner name, or a second different describer",
      },
    ],
    examples: [
      {
        command: "recognizer plugin check recognizer-scan-python",
        note: "run the conformance check against an installed plugin",
      },
      {
        command: "recognizer plugin check ./bin/recognizer-sense-mine --json",
        note: "check a plugin by path and print the results for a script",
      },
      {
        command: "recognizer plugin add crap",
        note: "register the installed crap sensor and record its install line",
      },
    ],
    run: runPlugin,
  },
  {
    name: "plugins",
    summary:
      "list the installed plugins (scanners, sensors and describers found on PATH) and what uses each in a repository",
    usage: "recognizer plugins [REPOSITORY] [--json]",
    arguments: [
      {
        name: "[REPOSITORY]",
        description:
          "the repository whose config says what uses each plugin; defaults to the current directory",
      },
    ],
    options: [{ flag: "--json", description: "print JSON instead of text" }],
    output: {
      text: "one `<kind>  <name>  <version>  protocol <n>  <current|previous|unsupported>  <used by>` line per installed plugin, scanners first, then sensors, then describers, each by name; the last column is `scanner for <languages>`, `registered` or `-`",
      json: "[{ kind, name, command, version, protocol, range, used_by, install }], in the same order, read from each plugin's manifest",
    },
    exitCodes: [
      { code: 0, meaning: "the list was printed" },
      {
        code: 1,
        meaning:
          "a plugin program's manifest did not answer (named on stderr, the readable plugins still printed)",
      },
      {
        code: 2,
        meaning: "bad arguments, or a repository that is not a folder",
      },
    ],
    examples: [
      {
        command: "recognizer plugins",
        note: "what is installed, and what this repository uses",
      },
      {
        command: "recognizer plugins --json",
        note: "the same list for a script",
      },
    ],
    run: runPlugins,
  },
  {
    name: "windows",
    summary: "list the windows the running Recognizer app has open",
    usage: "recognizer windows [--json]",
    arguments: [],
    options: [{ flag: "--json", description: "print JSON instead of text" }],
    output: {
      text: "one `<id>  <folder>  view: <name>  selection: <kind> <id>` line per window, with `-` when there is no open view or selection",
      json: "[{ id, folder, view, selection: { kind, id } | null }], ordered by window number",
    },
    exitCodes: [
      { code: 0, meaning: "the app answered" },
      {
        code: 1,
        meaning:
          "the app is not running, or it refused; the reason is on stderr",
      },
      { code: 2, meaning: "bad arguments" },
    ],
    examples: [
      { command: "recognizer windows", note: "the open windows and their ids" },
    ],
    run: runWindows,
  },
  {
    name: "window",
    summary:
      "print what one window of the running Recognizer app shows, or change it",
    usage: [
      "recognizer window [<id>] [--json]",
      "recognizer window <id> add|remove|fold|focus|select|trail|open-view|clear <argument>... [--by <name>] [--json]",
    ].join("\n"),
    arguments: [
      {
        name: "<id>",
        description:
          "a window's id, as `recognizer windows` lists it; optional when exactly one window is open and no verb is given",
      },
      {
        name: "add | remove <module>...",
        description:
          "put each module on the canvas or take it off; refused when a path is not a module in the scan",
      },
      {
        name: "fold <folder>... [--off]",
        description:
          "fold each folder, or unfold it with --off; refused when a folder holds no module",
      },
      {
        name: "focus <folder>",
        description: "focus one folder",
      },
      {
        name: "select <module-or-folder>",
        description:
          "select a module (a module wins over a folder of the same id) or a folder",
      },
      {
        name: "trail uses|used-by <module>",
        description:
          "follow that relation from the active trail panel's selection to the module and open the Dependencies tab; refused when the trail is empty or the module is not a direct dependency or dependent",
      },
      {
        name: "open-view <name>",
        description: "open the saved view of that name, as the Views menu does",
      },
      {
        name: "clear modules|folds|focus|selection|all",
        description: "empty that part of the canvas state",
      },
    ],
    options: [
      { flag: "--json", description: "print JSON instead of text" },
      {
        flag: "--by <name>",
        description:
          "who is driving, shown in the window's footer and in its back and forward history; 1-32 letters, digits, spaces, - and _, default Agent",
      },
      { flag: "--off", description: "with fold, unfold instead" },
    ],
    output: {
      text: "without a verb: the window's id and folder, then its view, modules, folds, focus, selection, trail and inspector tab; with one: a summary of the change, or `nothing changed`",
      json: "without a verb: { id, folder, view, modules, folded, focus, selection, trail: [{ selection, relation, tab, active }], inspector: { open, tab } }; with one: { summary, changed }",
    },
    exitCodes: [
      { code: 0, meaning: "the app answered" },
      {
        code: 1,
        meaning:
          "the app is not running, or it refused - no such window, no id given with several windows open, a window still opening, or a verb whose argument the window does not know; the reason is on stderr and the window is unchanged",
      },
      { code: 2, meaning: "bad arguments" },
    ],
    examples: [
      {
        command: "recognizer window w-2 --json",
        note: "what the second window shows, as JSON",
      },
      {
        command: "recognizer window w-1 add app/a.py app/b.py --by Claude",
        note: "put two modules on the first window's canvas; its footer reads `Claude added 2 modules` with an Undo",
      },
      {
        command: "recognizer window w-1 fold app/util --off",
        note: "unfold a folder",
      },
    ],
    run: runWindow,
  },
  {
    name: "describe",
    summary:
      "write each module's one-line responsibility with the repository's registered describer, or the shipped recognizer-describe-claude when none is registered, running up to the batch size of describers at once",
    usage: [
      "recognizer describe [<module>... | --all] [--repository <dir>] [--json]",
      "recognizer describe --check [<module>...] [--repository <dir>] [--json]",
      "recognizer describe --describer [--repository <dir>] [--json]",
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
        flag: "--describer",
        description:
          "print the describer in effect (command, version, and whether it comes from config or is the shipped recognizer-describe-claude) and exit; reads only config.yaml",
      },
      {
        flag: "--repository <dir>",
        description:
          "the repository to describe; defaults to the current directory",
      },
      {
        flag: "--by <name>",
        description:
          "who asked, recorded in the run log; defaults to the login user",
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
          "bad input - no describer registered in .recognizer/config.yaml and recognizer-describe-claude not installed, an invalid config or responsibilities file, an unknown module, --all with a module or with --check, an unknown flag or a scan that could not be made",
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
    name: "report",
    summary:
      "file an agent's review findings as a report the viewer and check read",
    usage:
      "recognizer report --as <name> [<file>] [--repository <dir>] [--json]",
    arguments: [
      {
        name: "<file>",
        description:
          "a findings document (findings_version and findings); without a file it is read from stdin",
      },
    ],
    options: [
      {
        flag: "--as <name>",
        description:
          "the name the report is filed under; required, not structure and not a registered sensor",
      },
      {
        flag: "--repository <dir>",
        description:
          "the repository the review was made in; defaults to the current directory",
      },
      { flag: "--json", description: "print JSON instead of text" },
    ],
    output: {
      text: "`reported <name>: <n> findings at <short commit>`",
      json: "{ path, commit, findings }",
    },
    exitCodes: [
      { code: 0, meaning: "the report was written" },
      {
        code: 1,
        meaning:
          "the document is not JSON or fails the findings schema; nothing is written",
      },
      {
        code: 2,
        meaning:
          "bad input - no --as, a name that is not a sensor name, structure or a registered sensor, an unreadable file, an unknown flag, or no git commit; nothing is written",
      },
    ],
    examples: [
      {
        command: "recognizer report --as review findings.json",
        note: "file a review's findings under the name review",
      },
      {
        command: "recognizer report --as review --json < findings.json",
        note: "read the findings from stdin and print where they were written",
      },
    ],
    run: runReport,
  },
  {
    name: "log",
    summary:
      "read the record each scan, describe and measure run leaves, to see what ran and why it failed",
    usage:
      "recognizer log [<id>] [--last] [--kind scan|describe|measure] [--repository <dir>] [--json]",
    arguments: [
      {
        name: "<id>",
        description:
          "a run's id, as the list prints it; without an id, log lists the recent runs",
      },
    ],
    options: [
      { flag: "--last", description: "print the newest run in full" },
      {
        flag: "--kind scan|describe|measure",
        description: "only runs of that kind, for the list and --last",
      },
      {
        flag: "--repository <dir>",
        description:
          "the repository whose runs to read; defaults to the current directory",
      },
      { flag: "--json", description: "print JSON instead of text" },
    ],
    output: {
      text: "the list is one line per run, newest first: `<id>  <kind>  <started>  <outcome>  <n> ok, <n> failed`, or `no runs recorded`; a single run prints a header (id, kind, started, finished, by, arguments, outcome), then per scanner, sensor or module its outcome, exit status, duration, command, reason and stderr; a record that cannot be read is named on stderr as `skipped <id>: <message>`",
      json: "the list is { runs: [{ id, kind, started, finished, by, outcome, entries, failed }] }; a single run is { id, log_version, kind, started, finished, by, arguments, outcome, exit, structure_ms?, entries: [{ name, command, status, outcome, duration_ms, modules?, fixed_ms?, incomplete?, work?: { unit, performed }, reason?, diagnosis?, stderr, stderr_truncated? }] } or phases: [{ phase, entries, duration_ms? }] for a scan, where diagnosis is the sensor's Diagnosis object when the entry has one",
    },
    exitCodes: [
      {
        code: 0,
        meaning:
          "the request was answered, whatever the run's own outcome was; an empty list is answered",
      },
      {
        code: 2,
        meaning:
          "bad input - an unknown flag or kind, --last with an id or two ids, --kind with an id, an unknown or invalid id, --last with no runs recorded, or an unreadable repository",
      },
    ],
    examples: [
      {
        command: "recognizer log --last --kind describe",
        note: "what the latest describe run ran and why it failed",
      },
      {
        command: "recognizer log --json",
        note: "list the recent runs as JSON, then pass an id to read one",
      },
    ],
    run: runLog,
  },
  {
    name: "agents",
    summary:
      "install or remove the Claude Code skill and permission rule for agents",
    usage: "recognizer agents install|uninstall [--json]",
    arguments: [
      {
        name: "install|uninstall",
        description:
          "install writes ~/.claude/skills/recognizer/SKILL.md, which points at `recognizer help agents`, and ~/.claude/skills/recognizer-setup/SKILL.md, which walks a user through setting up or updating a repository, and denies Read and Edit of **/.recognizer/** in ~/.claude/settings.json; uninstall reverses both",
      },
    ],
    options: [
      {
        flag: "--json",
        description: "print { changes: string[] } instead of text",
      },
    ],
    output: {
      text: "one line per change, or `no change`",
      json: "{ changes: string[] } with the same strings",
    },
    exitCodes: [
      { code: 0, meaning: "done, including when there was nothing to change" },
      {
        code: 2,
        meaning:
          "bad arguments, HOME unset or empty, or a settings file that cannot be merged safely",
      },
    ],
    examples: [
      {
        command: "recognizer agents install",
        note: "write the skill and the deny rule; a repeat run prints no change",
      },
    ],
    run: runAgents,
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
