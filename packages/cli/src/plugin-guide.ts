import { documentValidators } from "./manifest-ports.js";

const CURRENT_PROTOCOL = documentValidators.facts.protocol;

import { SCHEMA_NAMES } from "./plugin-schema.js";

function lines(...text: string[]): string[] {
  return [...text, ""];
}

function whatItIs(): string[] {
  return lines(
    "1. What a plugin is",
    "  - Three kinds, one contract. A scanner reads a language into a scan document. A sensor measures and writes findings and overlays. A describer writes one line per file saying what it is responsible for.",
    "  - A process, not a library. A plugin is an executable. Recognizer talks to it through arguments, JSON on stdout and events on stderr, so a plugin can be written in any language.",
    "  - Self-declaring. Everything the CLI and the app show about a plugin comes from its manifest. Recognizer holds no table of plugin names, display names, metric labels, finding sentences, defaults, progress steps or failure codes.",
    "  - No hooks outside a verb. A plugin does work only when Recognizer calls one of its four verbs. There is no before-scan or after-scan hook.",
  );
}

function verbs(): string[] {
  return lines(
    "2. The four verbs",
    "  manifest  required. Prints the manifest as one JSON document and a newline on stdout, and nothing on stderr. Fast, side-effect free, runs nothing.",
    '  check     required when the manifest says check is true. The readiness check: prints {"gaps":[],"notes":[]} plus a gap for each thing missing for this repository, each with its fix. A gap may carry an optional `output`, a non-empty string such as the tail of a failed run, which `recognizer sensors check --json` relays and the setup wizard shows. A sensor also takes --repository. Its document is the `check` schema.',
    "  run       required. Does the work for a repository and writes its document to the output path it is given. A scanner is called `run <repository> --output <file> [--commit <sha>]`, a sensor `run --repository <dir> --commit <sha> --output <file> [--settings <json>]`, a describer `run --model <name> <request-file>` and prints one line on stdout.",
    "  guide     optional. Prints setup help for this plugin on stdout and nothing on stderr; used by `recognizer help sensors <name>` and the setup skill.",
    '  tests     optional, scanners only: answered when the manifest sets reports_tests to true. `<command> tests ROOT` prints one JSON document {"entries": {"<repository-relative path>#<suffix>": "<64 lowercase hex sha256>"}} on stdout and exits 0: the hash of each test input the scanner owns, such as a test item inside a source file or a source file that is wholly test code. The scanner lists the repository itself with `git -C ROOT ls-files --cached --others --exclude-standard -z -- . :!.recognizer`, so it reasons about the files the tests hash does. Recognizer treats each key as opaque except that it must hold a `#`, and joins the entries to the test files\' own hashes. A non-zero exit, a key with no `#`, a value that is not 64 lowercase hex or unreadable output makes the tests hash unknown. The document is the `tests-answer` schema.',
    '  survey    optional, scanners only: answered when the manifest sets setup_survey to {"order": N}. `<command> survey REQUEST_FILE` reads a JSON request {"root": "<absolute repository path>", "files": ["<repository-relative path>"], "suites": [{"language": "<name>", "directory": "<path>"}]} and prints one JSON document {"runners": [...], "tools": [...], "notes": [...]} on stdout and exits 0: the test runners, the tools they need and the notes for the scanner\'s own languages. `files` is the repository\'s file list, so the scanner never lists the repository itself and reads other files by path from root. A runner for a directory and language that a suite already covers is not answered. A path or command may hold {up} ("../" once per segment of the runner\'s directory) and {slug} (the runner\'s name as a folder name); write a literal brace twice. Answers are ordered by N, then by plugin name. A failed or invalid answer adds one note and no runners. Documents are the `survey-request` and `survey-answer` schemas.',
    "A call with no verb or an unknown one writes a usage line to stderr and exits 2.",
  );
}

function manifest(): string[] {
  return lines(
    "3. The manifest",
    "Every manifest carries:",
    "  - kind: scanner, sensor or describer.",
    "  - name: matches ^[a-z0-9][a-z0-9_-]*$, at most 64 characters; the program is named recognizer-scan-<name>, recognizer-sense-<name> or recognizer-describe-<name>.",
    "  - display: the label the app shows.",
    "  - version: the plugin's own release.",
    "  - protocol: the integer protocol version it speaks.",
    "  - install: the command that installs or upgrades it, quoted by doctor and the app when it is missing or out of range.",
    "  - check: whether it has a readiness check.",
    "  - long_running: whether a run may take minutes. When it is false, time_limit_seconds is required: the most a run may take before it is stopped. When it is true, time_limit_seconds is refused.",
    "  - units: the words its progress counts in (files, files, functions, ...).",
    "  - settings: the config keys it reads under its own section; each is an object with key, type (string, integer, number, boolean, enum or path), description and example, and optionally values, multi, default, defaults, default_text, minimum, exclusiveMinimum, maximum, exclusiveMaximum and off (true when the value false switches the number off). `recognizer config --help` lists the key shape.",
    "",
    "A setting may also say how the app shows it, all optional and none changing the key schema `recognizer config` publishes:",
    "  - label (or labels, one per value of a placeholder such as <metric> in the key), unit (or units) and order: the setting is a row of the Settings modal, named by its label, with its unit after the input, ordered ascending within the pane with unordered rows after, in manifest order. A setting with no label is not a row.",
    "  - limit: {metric, direction, severity?} says the setting limits that metric, above or below. metric is a name, or the key's own placeholder written <metric>. severity is the key of an enum setting of the same sensor holding the severity of a finding past the limit.",
    "A sensor may set settings_title, the heading of its Settings pane (display by default); a sensor with no labelled setting has no pane. A metric may set cell, its position in the cells of an inspector function card.",
    "A placeholder written <name> in a key is declared by the manifest that publishes the key, in `placeholders`: an object from the placeholder's name (lower case, as in the key) to { pattern or values, description }. pattern is a regular expression (JavaScript syntax) the placeholder's value must match, values is a closed list of the values it accepts, and exactly one of the two is required; description is one sentence for the author kit and the Settings modal. A key whose placeholder the manifest does not declare is refused, and a sensor that publishes one is reported as not answering.",
    "`recognizer plugin check` fails a limit on a non-sensor, a limit whose metric or severity the manifest does not hold, labels or units on a key with no placeholder, and a placeholder that is undeclared, declared but unused, or declared with a pattern that does not compile.",
    "",
    "By kind:",
    "  - Scanner: languages (required), scan_schema_version (optional, the schema_version of the scans it writes: recognizer and `recognizer doctor` name a scanner whose version the app would refuse, and one that declares none is reported as undeclared), and for each language its name, display (optional, the name shown in messages), grammars (optional, the grammar rules structural analysis reads: for each grammar its name, extensions, function_types, scope_types, branch_types, boolean_operators and bound_function_types, and optionally function_names (naming rules for function types not named by their `name` child), span (the scope-call unwrapping rule) and vocabulary (the node types and names core reads for comments, literals, calls, identifiers, trivial function shapes and scope names, the node type whose operator field counts as a boolean operator, fields (the tree-sitter field names core reads, as roles: name, body, expression_body, parameters, parameter_pattern, arguments, callee, operator, assigned_value, bound_value, initialiser_list and initialiser_value; a role the grammar does not define is left out; required, with an empty object when no field carries a role) and assignment_operators (the token texts that mean plain assignment))), test_files (optional rules marking test files: extensions, directory_names, directory_suffixes, basename_patterns and stem_suffixes), supertype_links (optional boolean, true when a supertype edge from this language links the two files in orphan findings), private_imports (optional boolean, true when private-imports findings apply to this language), extensions, files and the skip rules (directory_names, directory_prefixes, directory_suffixes, directory_markers, file_globs) that claim or skip a file for it. reports_tests (optional boolean, true when it answers the tests verb; a scanner that does not set it is never asked), and setup_survey (optional object { order }, a non-negative integer: the scanner answers the survey verb and its answer comes in that order; a scanner that does not set it is never asked). A scanner has none of the sensor or describer fields.",
    "  - Sensor: metrics, findings, runs_tests and scoped are required; description (one sentence), expansion (what an abbreviated display stands for), planned_work ({ verb }: the sensor answers `check --work` with the work a run would still perform) and log_path (the repository-relative log its last run wrote) are optional; suite_keys ({ section, keys }, the `tests.<name>` section and keys, entries as in `settings` with full keys) is allowed only with runs_tests true. A metric has name, label, help, type, granularity and bad, and optionally title, cell, unlisted and published. A finding kind has kind, group, help and sentence, a template that `plugin check` reads for the placeholders it allows.",
    "  - Describer: prompt_version, which names the prompt its descriptions come from, is required; description (one sentence) is optional.",
  );
}

function versions(): string[] {
  return lines(
    "4. Versions and compatibility",
    `  - The protocol is one integer that covers the manifest, event, scan, findings and overlay schemas together. The current one is ${CURRENT_PROTOCOL}. A breaking change to any of those raises it.`,
    `  - The CLI supports the current protocol and the one before it (${CURRENT_PROTOCOL}${CURRENT_PROTOCOL > 1 ? ` and ${CURRENT_PROTOCOL - 1}` : ""}). A plugin on the previous protocol runs, and doctor warns with its install line. A plugin outside that range is refused before anything runs, with a message naming the plugin, both versions and the fix.`,
    "  - A plugin's own version is recorded in every document it writes and is never compared. A changed version marks that plugin's earlier results out of date, so upgrading a plugin reruns it.",
  );
}

function events(): string[] {
  return lines(
    "5. Events",
    "A plugin reports while it runs by writing JSON lines on stderr, each prefixed `recognizer-event `. Every kind uses the same eight events:",
    "  - start {total, unit, queued?, not_measured?}: how much work there is, in the unit the manifest names. queued is how many of the units this run will do across every step, and not_measured {reused, no_covered_site, out_of_scope} counts the rest by reason. A plugin may omit queued and not_measured, and a reader must not require them.",
    "  - progress {done, total, unit, step?}: how far along the plugin is. done never passes total and unit is the one the last start counted. step is superseded by stage: it is still valid, but nothing reads it.",
    '  - stage {name, index, of}: the stage the plugin is in, such as "Coverage run". index counts from 1 and never passes of. A plugin that runs several stages reports each as it starts.',
    "  - estimate {remaining_ms}: the plugin's own estimate of the awake time left for its whole run, never for one stage, or null when it cannot say. A later estimate replaces the earlier one. A plugin that reports none is shown as having none.",
    "  - note {text}: a line for the user.",
    "  - diagnosis {code, text, fix?}: why something could not be measured, in the plugin's own words, with the fix where there is one. Codes belong to the plugin; Recognizer keeps no list of them.",
    "  - result {findings?, overlay?}: findings and overlay values the plugin has settled so far, a function or a file at a time, never the whole run again. A later result replaces an earlier finding with the same id and an earlier overlay value with the same metric and id. Overlay metrics are the ones the manifest declares.",
    "  - settled {modified, settings, inputs?, tests?, counts?, stopped?, partial?, excluded?, unowned?, suites?, work?}: the facts of the measurement at a point the plugin can stand behind, and its checkpoint. A document with partial or stopped is a checkpoint.",
    "A reporting plugin sends result and settled after its start and writes no findings or overlay file: when the environment holds RECOGNIZER_PROTOCOL of 4 or more, Recognizer collects the reports and writes the files itself. A plugin that sends neither still writes the file at {output}, which keeps working until the next protocol version.",
    "The CLI tags each event with the plugin's name and forwards it unchanged. The events schema is `recognizer plugin schema events`.",
  );
}

function stopping(): string[] {
  return lines(
    "6. Stopping and time limits",
    "  - Stop sends SIGTERM to the CLI's process group, which holds every plugin, and the CLI relays it to each live plugin. The plugin writes what it has, marked stopped, and exits non-zero within 10 seconds, after which it is killed. A plugin owns its own children.",
    "  - A plugin that is not long_running is stopped the same way when it passes its time_limit_seconds.",
  );
}

function installing(): string[] {
  return lines(
    "7. Installing and registering",
    "  - Installed means an executable on PATH named recognizer-scan-<name>, recognizer-sense-<name> or recognizer-describe-<name> whose manifest answers. `recognizer plugins` lists every installed plugin with its kind, name, version, protocol, whether that protocol is in range, and what uses it.",
    "  - Scanners are chosen by the languages a repository holds: each language goes to the installed scanner whose manifest claims it. When two installed scanners claim a language, the repository's config names one with `recognizer config scanners.<language> <name>`; it is never guessed.",
    "  - Sensors and describers run in a repository only when its committed config registers them. `recognizer plugin add <name>` registers one and copies its install line into the config, so a teammate who lacks the plugin is told by doctor exactly how to install it.",
    "  - Recognizer installs nothing. Doctor and the app name a missing plugin and quote its install line.",
    "  - Third-party plugins are distributed however their authors choose. Recognizer needs only an executable on PATH.",
  );
}

function kit(): string[] {
  return lines(
    "8. The author kit",
    "  recognizer plugin init --kind <scanner|sensor|describer> --language <python|typescript|rust> --name <name> [folder]",
    "    Writes a working plugin into the folder (the current one by default) from templates inside the CLI. It refuses a folder that is not empty, never prompts, and installs and registers nothing. The plugin answers every verb, emits events, writes a valid document, and passes `plugin check` as written. Examples:",
    "      recognizer plugin init --kind scanner --language python --name mylang ./recognizer-scan-mylang",
    "      recognizer plugin init --kind sensor --language typescript --name lint ./recognizer-sense-lint",
    "      recognizer plugin init --kind describer --language rust --name terse ./recognizer-describe-terse",
    `  recognizer plugin schema <${SCHEMA_NAMES.join("|")}>`,
    "    Prints one schema of the contract: the manifest, the events, the scan document, the findings document, the overlay and the check verb's document.",
    "  recognizer plugin check <command> [--repository <dir>] [--request <file>] [--json]",
    "    The conformance check. It runs every verb, validates what they print against the schemas, and stops the plugin to see that it honours SIGTERM. A describer needs --request <file>, a request as `recognizer describe` writes it. Its results, in order:",
    "      starts           manifest runs and exits 0",
    "      clean-output     manifest prints one JSON document and a newline, and nothing on stderr",
    "      valid            the manifest is valid against the manifest schema",
    "      named-for-command the program is named recognizer-<verb>-<name> for its kind and name",
    "      protocol         the protocol is the current one or the one before",
    "      side-effect-free manifest leaves nothing in its working directory",
    "      sentences        each finding sentence is well formed",
    "      placeholders     each key placeholder is declared with a pattern that compiles, each declaration is used, and labels, units and defaults entries match it",
    "      limits           each setting limit names a metric and severity the manifest holds",
    "      grammars         each grammar a scanner publishes carries a vocabulary, so comments and literals stay out of fingerprints, and each vocabulary declares its fields, an empty object when no field carries a role",
    "      check-verb       check prints a valid check document, or the manifest declares none",
    "      guide-verb       guide exits 0 and writes nothing to stderr",
    "      run-verb         run writes a valid document, or exits non-zero after a diagnosis event",
    "      events           the events are valid, start first, and progress never passes its total",
    "      stop             SIGTERM stops it within 10 seconds leaving a valid document; a warning when it finished before it could be stopped",
    "    Each result is ok, warn or fail; the command exits 1 when any fails.",
    "",
    "The loop: init, edit the places marked EDIT HERE, run `plugin check`, put the program on PATH, then `plugin add` for a sensor or describer.",
  );
}

export function pluginGuide(): string {
  return [
    "recognizer help plugin-guide - writing a Recognizer plugin",
    "",
    "Everything an author needs ships inside the recognizer CLI, so it always matches the protocol this CLI speaks.",
    "",
    ...whatItIs(),
    ...verbs(),
    ...manifest(),
    ...versions(),
    ...events(),
    ...stopping(),
    ...installing(),
    ...kit(),
  ].join("\n");
}
