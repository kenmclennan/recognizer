# Recognizer

Recognizer scans a codebase into a language-neutral model of its modules and dependencies, and shows that model in a native viewer. The picture is derived from the code and never drawn by hand, so it cannot disagree with the code.

## Install

macOS on Apple silicon, from the Homebrew tap. The formula installs the `recognizer` command, the scanners and the sensors; the cask installs the viewer. They are released together and one `brew upgrade` moves them all.

```sh
brew install kenmclennan/tap/recognizer
brew install --cask kenmclennan/tap/recognizer
```

The app runs the `recognizer` command it finds on the login shell's `PATH`, and the footer says when the two are out of step.

## Use

Open a repository in the viewer from its folder:

```sh
cd my-repo
recognizer open
```

The first open scans the repository (Python, TypeScript, Kotlin and Rust are read) and shows the file tree; tick files or folders to put them on the canvas. The same scan drives the command line:

```sh
recognizer scan                 # extract when the files changed, describe, run sensors
recognizer check                # violations, baseline growth, metrics and warnings
recognizer uses app/src/main.ts # the modules a module uses; also used-by, callers, path, find, show
recognizer help                 # every command
```

A repository configures Recognizer in `.recognizer/`, which is committed:

- `policy.yaml` declares the architecture: named components by path and the dependencies each may have. An edge that breaks it is a violation, and `recognizer check` refuses growth beyond the committed baseline. Start from a policy in [`policies/`](policies).
- `config.yaml` registers the sensors to run (`sensors: {duplication: {}, crap: {}}` for the shipped ones), a describer that writes each module's one-line responsibility, and overlays that measure the code.

Agents use the command line only: `recognizer agents install` adds the Claude Code skill and permission rule, and `recognizer help agents` prints the guide they follow.

## Parts

- **Scanners.** One standalone command per language (Python, TypeScript, Kotlin, Rust) that reads a source tree and prints the same JSON scan document.
- **Check.** Reads the scan and the policy, reports violations against a baseline that may only shrink, and the structure sensor's warnings: hubs, cycles, orphans, package metrics.
- **Sensors.** Shipped judgements beyond structure: duplication and CRAP today, mutation and thresholds following; a repository can register its own command that writes findings.
- **Viewer.** A native app (Tauri) that draws the modules and their dependencies, colours findings and health, opens a module to show its members, and keeps saved views and notes an agent can build and link to.

## Docs

- [check/README.md](check/README.md): every command, the policy and findings formats, exit codes.
- [docs/design.md](docs/design.md): what is decided and what is still open; [docs/glossary.md](docs/glossary.md) names the terms.
- [app/README.md](app/README.md): building the app and how releases are cut.
