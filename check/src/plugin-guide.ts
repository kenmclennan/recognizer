import { CURRENT_PROTOCOL } from "./plugin-manifest.js";
import { SCHEMA_NAMES } from "./plugin-schema.js";

function lines(...text: string[]): string[] {
  return [...text, ""];
}

function whatItIs(): string[] {
  return lines(
    "1. What a plugin is",
    "  - Three kinds, one contract. A scanner reads a language into a scan document. A sensor measures and writes findings and overlays. A describer writes one line per module saying what it is responsible for.",
    "  - A process, not a library. A plugin is an executable. Recognizer talks to it through arguments, JSON on stdout and events on stderr, so a plugin can be written in any language.",
    "  - Self-declaring. Everything the CLI and the app show about a plugin comes from its manifest. Recognizer holds no table of plugin names, display names, metric labels, finding sentences, defaults, progress steps or failure codes.",
    "  - No hooks outside a verb. A plugin does work only when Recognizer calls one of its four verbs. There is no before-scan or after-scan hook.",
  );
}

function verbs(): string[] {
  return lines(
    "2. The four verbs",
    "  manifest  required. Prints the manifest as one JSON document and a newline on stdout, and nothing on stderr. Fast, side-effect free, runs nothing.",
    '  check     required when the manifest says check is true. The readiness check: prints {"gaps":[],"notes":[]} plus a gap for each thing missing for this repository, each with its fix. A sensor also takes --repository. Its document is the `check` schema.',
    "  run       required. Does the work for a repository and writes its document to the output path it is given. A scanner is called `run <repository> --output <file> [--commit <sha>]`, a sensor `run --repository <dir> --commit <sha> --output <file> [--settings <json>]`, a describer `run --model <name> <request-file>` and prints one line on stdout.",
    "  guide     optional. Prints setup help for this plugin on stdout and nothing on stderr; used by `recognizer help sensors <name>` and the setup skill.",
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
    "  - units: the words its progress counts in (files, modules, functions, ...).",
    "  - settings: the config keys it reads under its own section; each is an object with key, type (string, integer, number, boolean, enum or path), description and example, and optionally values, multi, default, defaults, default_text, minimum, exclusiveMinimum, maximum and exclusiveMaximum. `recognizer config --help` lists the key shape.",
    "",
    "A setting may also say how the app shows it, all optional and none changing the key schema `recognizer config` publishes:",
    "  - label (or labels, one per value of a placeholder such as <metric> in the key), unit (or units) and order: the setting is a row of the Settings modal, named by its label, with its unit after the input, ordered ascending within the pane with unordered rows after, in manifest order. A setting with no label is not a row.",
    "  - limit: {metric, direction, severity?} says the setting limits that metric, above or below. metric is a name, or the key's own placeholder written <metric>. severity is the key of an enum setting of the same sensor holding the severity of a finding past the limit.",
    "A sensor may set settings_title, the heading of its Settings pane (display by default); a sensor with no labelled setting has no pane. A metric may set cell, its position in the cells of an inspector function card.",
    "`recognizer plugin check` fails a limit on a non-sensor, a limit whose metric or severity the manifest does not hold, and labels or units on a key with no placeholder.",
    "",
    "By kind:",
    "  - Scanner: languages (required), and for each language its name, extensions, files and the skip rules (directory_names, directory_prefixes, directory_suffixes, directory_markers, file_globs) that claim or skip a file for it. A scanner has none of the sensor or describer fields.",
    "  - Sensor: metrics, findings, runs_tests and scoped are required; description (one sentence) and expansion (what an abbreviated display stands for) are optional. A metric has name, label, help, type, granularity and bad, and optionally title, cell and published. A finding kind has kind, group, help and sentence, a template that `plugin check` reads for the placeholders it allows.",
    "  - Describer: prompt_version, which names the prompt its descriptions come from, is required.",
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
    "A plugin reports while it runs by writing JSON lines on stderr, each prefixed `recognizer-event `. Every kind uses the same four events:",
    "  - start {total, unit}: how much work there is, in the unit the manifest names.",
    '  - progress {done, total, unit, step?}: step is an optional label for the stage, such as "Coverage run". done never passes total and unit is the one the last start counted.',
    "  - note {text}: a line for the user.",
    "  - diagnosis {code, text, fix?}: why something could not be measured, in the plugin's own words, with the fix where there is one. Codes belong to the plugin; Recognizer keeps no list of them.",
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
    "      limits           each setting limit names a metric and severity the manifest holds",
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
