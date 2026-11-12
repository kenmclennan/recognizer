# Recognizer

Recognizer scans a codebase into a language-neutral model of its modules and dependencies, and shows that model in a native viewer. The picture is derived from the code and never drawn by hand, so it cannot disagree with the code.

## Install

macOS on Apple silicon, from the Homebrew tap. One cask, `brew install --cask kenmclennan/tap/recognizer`, installs the viewer and the `recognizer` command, the scanners and the sensors, which run on Homebrew's `node` and `python@3.13`. They are one package, so `brew upgrade --cask kenmclennan/tap/recognizer` (or a bare `brew upgrade`) moves them together. A machine that installed the retired formula runs `brew update && brew uninstall --ignore-dependencies --formula recognizer && brew upgrade --cask recognizer` once.

```sh
brew install --cask kenmclennan/tap/recognizer
```

A packaged app runs the tools inside its own bundle, never the ones on the login shell's `PATH`, and refuses to scan when a tool's version differs from its own.

The app is ad-hoc signed, not notarized. The cask strips the quarantine attribute after install, so it opens without a prompt; an app taken from the releases page instead is refused by Gatekeeper until it is allowed under Privacy and Security in System Settings.

## Use

Open a repository in the viewer from its folder:

```sh
cd my-repo
recognizer open
```

The first open scans the repository (Python, TypeScript, Kotlin, C# and Rust are read) and shows the file tree; tick files or folders to put them on the canvas. The same scan drives the command line:

```sh
recognizer scan                 # extract when the files changed, describe, run sensors
recognizer check                # violations, baseline growth, metrics and warnings
recognizer uses app/src/main.ts # the modules a module uses; also used-by, callers, path, find, show
recognizer help                 # every command
```

A repository configures Recognizer in `.recognizer/`, which is committed:

- `policy.yaml` declares the architecture: named components by path and the dependencies each may have. An edge that breaks it is a violation, and `recognizer check` refuses growth beyond the committed baseline. Start from a policy in [`policies/`](policies).
- `config.yaml` registers the sensors to run (`sensors: {crap: {}}` for the shipped ones) and a describer that writes each module's one-line responsibility. The describer's model and how many modules it describes at once are user settings (`describing` in the app's `config.json`, edited in Settings), not part of the repository.

Agents use the command line only: `recognizer agents install` adds the Claude Code skills (one for the guide, one that sets up and updates a repository on request) and the permission rule, and `recognizer help agents` prints the guide they follow.

## Parts

- **Scanners.** One standalone command per language (Python, TypeScript, Kotlin, C#, Rust) that reads a source tree and prints the same JSON scan document.
- **Check.** Reads the scan and the policy, reports violations against a baseline that may only shrink, and the structure sensor's warnings: cycles, orphans, package metrics.
- **Sensors.** Shipped judgements beyond structure: CRAP today, mutation and thresholds following (duplication is a check inside the structure sensor); a repository can register its own command that writes findings.
- **Viewer.** A native app (Tauri) that draws the modules and their dependencies, colours findings and health, opens a module to show its members, and keeps saved views and notes an agent can build and link to.

## Docs

- [check/README.md](check/README.md): every command, the policy and findings formats, exit codes.
- [docs/design.md](docs/design.md): what is decided and what is still open; [docs/glossary.md](docs/glossary.md) names the terms.
- [app/README.md](app/README.md): building the app and how releases are cut.
