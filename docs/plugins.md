# Plugins

Temporary, like `design.md`: this document holds the plugin design while it is built, and is deleted once the code, `check/README.md` and `recognizer help plugins` carry it. Until phase 5 ships, `design.md`'s "Released and installed as one toolchain" describes what is installed; this document describes where it is going.

## What a plugin is

- **Three kinds, one model.** A scanner reads a language into a scan document. A sensor measures and writes findings and overlays. A describer writes one line per module saying what it is responsible for. All three are plugins under the same contract.
- **A process, not a library.** A plugin is an executable. Recognizer talks to it through arguments, JSON on stdout and events on stderr, so a plugin can be written in any language. Recognizer's own plugins are written in Python, TypeScript and Rust and follow the same contract as anyone else's.
- **Self-declaring.** Everything the CLI and the app show about a plugin comes from its manifest. Recognizer holds no table of plugin names, display names, metric labels, finding sentences, defaults, progress steps or failure codes.
- **No hooks outside its run.** A plugin does work only when Recognizer calls one of its four verbs. There is no before-scan or after-scan hook.

## The four verbs

| Verb | Required | What it does |
| --- | --- | --- |
| `manifest` | yes | Prints the plugin's manifest as JSON on stdout. Fast, side-effect free, runs nothing. |
| `check` | when the manifest declares it | The readiness check: says what is missing for this repository (a tool, a test suite, a coverage plugin) as diagnoses, each with its fix. `--run` may run the repository's tests, and is used only when the user asks. |
| `run` | yes | Does the plugin's work for a repository and writes its document to the output path it is given. |
| `guide` | no | Prints setup help for this plugin, used by `recognizer help <plugin>` and the setup skill. |

## The manifest

Every manifest carries:

- `kind` (`scanner`, `sensor` or `describer`), `name`, `display` (the label the app shows), `version` (the plugin's own release) and `protocol` (the integer protocol version it speaks).
- `install`: the command that installs or upgrades it, quoted by doctor and the app when it is missing or out of range.
- `check`: whether it has a readiness check.
- `long_running`: whether a run may take minutes; otherwise `time_limit_seconds`, the most a run may take before it is stopped.
- `units`: the words its progress counts in (`files`, `modules`, `functions`, ...).
- `settings`: the config keys it reads under its own section, each with its type, constraints and `default` or `default_text`, in the same shape `recognizer config --help` lists.

By kind:

- **Scanner:** `languages`, and for each, the file rules that claim a file for it (extensions, skipped folders).
- **Sensor:** `metrics` (name, short label, help, granularity, which direction is bad, and the published figure and its source where one applies), `findings` (each kind's group name, help and sentence template), `runs_tests` (whether it needs the repository's test suites) and `scoped` (whether it can run for a set of modules).
- **Describer:** `prompt_version`, which names the prompt its descriptions come from.

## Versions and compatibility

- The app and the `recognizer` CLI are one release and must match each other exactly.
- Plugins are judged by `protocol`, one integer that covers the manifest, event, scan, findings and overlay schemas together. A breaking change to any of them raises it.
- The CLI supports the current protocol and the one before it. A plugin on the previous protocol runs, and doctor warns with its `install` line. A plugin outside that range is refused before anything runs, with a message naming the plugin, both versions and the fix.
- A plugin's own `version` is recorded in every document it writes and is never compared. A changed version marks that plugin's earlier results out of date, so upgrading a plugin reruns it.

## Events

A plugin reports while it runs by writing JSON lines on stderr, each prefixed `recognizer-event`. Every kind uses the same events:

- `start {total, unit}`
- `progress {done, total, unit, step?}`: `step` is an optional label for the stage it is in, such as "Coverage run".
- `note {text}`
- `diagnosis {code, text, fix}`: why something could not be measured, in the plugin's own words, with the fix. Codes belong to the plugin; Recognizer keeps no list of them.

The CLI tags each event with the plugin's name and forwards it unchanged on `recognizer scan --json`. The app's progress, failure text and scan time estimates read these events and nothing plugin-specific.

## Stopping and time limits

- Stop sends SIGTERM to the plugin's process group. The plugin writes what it has, marked `stopped`, and exits within 10 seconds, after which it is killed.
- A plugin that is not `long_running` is stopped the same way when it passes its `time_limit_seconds`.

## Installing and registering

- **Installed** means an executable on `PATH` named `recognizer-scan-<name>`, `recognizer-sense-<name>` or `recognizer-describe-<name>` whose `manifest` answers. `recognizer plugins` lists every installed plugin with its kind, name, version, protocol, whether that protocol is in range, and what uses it.
- **Scanners** are chosen by the languages a repository holds: each language goes to the installed scanner whose manifest claims it. When two installed scanners claim a language, the repository's config names one; it is never guessed.
- **Sensors and describers** run in a repository only when its committed config registers them. `recognizer plugin add <name>` registers one and copies its `install` line into the config, so a teammate who lacks the plugin is told by doctor exactly how to install it.
- **Recognizer installs nothing.** Doctor and the app name a missing plugin and quote its `install` line.

## Distribution

- The cask holds the app and the `recognizer` CLI only, and depends on Homebrew's `node`.
- Each official plugin is its own Homebrew formula in the tap, declaring its own runtime (`python@3.13`, `node`, or a prebuilt binary), versioned and released when its own folder changes: `recognizer-scan-python`, `-typescript`, `-kotlin`, `-rust`, `-csharp`; `recognizer-sense-crap`, `-mutation`, `-thresholds`; `recognizer-describe-claude`.
- The formula `recognizer-plugins` depends on every official plugin, and the cask depends on `recognizer-plugins`, so `brew install --cask recognizer` installs a working set. Adding an official plugin changes the bundle, not the cask.
- Homebrew has no optional cask dependencies, so a minimal install means removing unwanted plugins after the bundle.
- `brew uninstall <plugin>` removes one plugin; `brew uninstall --cask recognizer` followed by `brew autoremove` removes the official set.
- Third-party plugins are distributed however their authors choose. Recognizer needs only an executable on `PATH`.

## Setup and doctor

- **Doctor** checks every plugin the same way, from its manifest: it is on `PATH`, its manifest answers, its protocol is in range (a warning on the previous one), its `check` passes when it declares one, and the repository's settings for it are valid against the keys it publishes. For each language the repository holds, a scanner claims it, or the config names one when several do. Doctor is local: whether a newer release exists is the package manager's to say.
- **The setup skill** runs `scan --extract` and reports each language with the scanner that read it; runs each registered sensor's `guide`, proposing test suites only for sensors whose manifest says `runs_tests`; drafts policy; and finishes with doctor.

## Writing a plugin

Everything an author needs ships inside the `recognizer` CLI, so it always matches the protocol that CLI speaks:

- `recognizer help plugins`: the author guide, covering the verbs, the manifest, events, schemas, registration and conformance.
- `recognizer plugin init --kind <scanner|sensor|describer> --language <python|typescript|rust> --name <name> [folder]`: writes a working plugin into the folder (the current one by default). It refuses a folder that is not empty, never prompts (a missing flag lists the choices and an example), and installs and registers nothing. The plugin it writes answers `manifest` and `run` with `check` and `guide` stubs, emits events, writes a valid document, and passes `recognizer plugin check` as written.
- `recognizer plugin schema <manifest|events|scan|findings|overlay>`: prints a schema.
- `recognizer plugin check <command>`: the conformance check. It calls each verb, validates the manifest, the events and the document against the schemas, and stops the plugin to check it honours SIGTERM. Recognizer's own plugins pass it in CI.

## Build order

Each phase is its own item, built on the one before.

1. **Protocol and manifest.** The manifest and event schemas, the protocol version, `recognizer plugin check`, and the CLI reading manifests. Recognizer's own tools answer `manifest`; `recognizer-sensors` gains one entry point per sensor. Nothing changes for users.
2. **Lifecycle and events.** The four verbs and the event stream, read by the CLI and the app; the fixed progress steps, the closed diagnosis codes and the fixed sensor timeout go.
3. **Manifest-driven CLI and app.** Every place that knows a plugin by name reads its manifest instead: the shipped-sensor registry, display names and expansions, metric names, finding groups and sentences, the module scope, and defaults duplicated outside the plugin.
4. **Registration and discovery.** Discovery on `PATH`, `recognizer plugins`, `recognizer plugin add`, scanners chosen from manifests by language (the scan schema's language list opens), and doctor and setup made generic.
5. **Distribution.** The separate formulae, the `recognizer-plugins` bundle, the cask depending on it, a release workflow per plugin, and the app's same-version rule replaced by the protocol range. `design.md`'s toolchain bullet is rewritten here.
6. **Author kit.** `recognizer help plugins`, `recognizer plugin init` with its templates, and `recognizer plugin schema`.
