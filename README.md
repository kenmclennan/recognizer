# Recognizer

Recognizer scans a codebase into a language-neutral model of its modules and dependencies, and shows that model in a native viewer. The picture is derived from the code and never drawn by hand, so it cannot disagree with the code.

It has four parts, installed together:

- **Scanners.** One command per language (Python, TypeScript, Kotlin, C#, Rust) that reads a source tree and prints the same JSON scan document.
- **The `recognizer` command.** Scans a repository, checks it against the repository's policy, answers questions about its modules, builds saved views, and runs the describer and the sensors.
- **Sensors.** Judgements beyond structure. The structure sensor is built in: policy violations, cycles, orphans, unused exports, private imports, long functions, duplication and folder metrics. The shipped sensors are C.R.A.P., Mutation and Thresholds; a repository can register its own.
- **The viewer.** A native macOS app (Tauri) that draws the modules and their dependencies, colours findings and health, opens a module to show its members, and keeps saved views and notes an agent can build and link to.

## Install

Recognizer runs on macOS on Apple silicon and installs from the Homebrew tap:

```sh
brew tap kenmclennan/tap
brew trust kenmclennan/tap
brew install --cask kenmclennan/tap/recognizer
```

Homebrew 7 refuses formulae from a tap it does not trust, so the second command is needed: the cask depends on formulae in the same tap. The cask installs the app and the `recognizer` command. It depends on the `recognizer-plugins` bundle formula, which brings every official plugin: the five `recognizer-scan-<language>` scanners, the three sensors (`recognizer-sense-crap`, `recognizer-sense-mutation` and `recognizer-sense-thresholds`) and `recognizer-describe-claude`. The plugins run on Homebrew's `node` and `python@3.13`, which Homebrew installs as dependencies. Check the install with `recognizer --version` and `recognizer plugins`.

Writing module responsibilities (`recognizer describe`) uses the [Claude Code](https://claude.com/claude-code) `claude` command, which you install and sign in to separately. Everything else works without it.

## Upgrade

```sh
brew upgrade --cask kenmclennan/tap/recognizer
```

A bare `brew upgrade` works too. The app and the `recognizer` command are one package and move together; the app has no updater of its own. Each plugin is its own formula and upgrades on its own release, so a plugin can be a version ahead of or behind the command. `recognizer` judges a plugin by its protocol, not its version: a plugin outside the range the command supports is refused, and the message prints that plugin's install line.

After an upgrade:

- Run `recognizer doctor` in each repository you use it with. It reports any config key the new version retired, and prints the command that fixes each problem.
- Run `recognizer agents install` again if you installed the agent skills, so they match the new version. It prints `no change` when they already do.

### Installing or removing one plugin

Install one plugin with its formula, and remove one with `--ignore-dependencies`, because the bundle requires every plugin:

```sh
brew install kenmclennan/tap/recognizer-scan-kotlin
brew uninstall --ignore-dependencies recognizer-scan-kotlin
```

A scan that needs a removed plugin reports it missing and prints its install line. A removed plugin comes back the next time Homebrew installs the bundle, which happens when the bundle's member list changes or the cask is reinstalled.

### Moving an existing install

A machine that installed the retired `recognizer` formula moves to the cask once with:

```sh
brew tap kenmclennan/tap && brew trust kenmclennan/tap
brew update && brew uninstall --ignore-dependencies --formula recognizer && brew upgrade --cask recognizer
```

A machine that holds the earlier cask, which carried every command itself, removes it and installs the new one once:

```sh
brew tap kenmclennan/tap && brew trust kenmclennan/tap
brew update && brew uninstall --cask recognizer && brew install --cask recognizer
```

## Uninstall

Remove the agent skills first, while the command is still installed, then the cask, then the dependencies Homebrew no longer needs:

```sh
recognizer agents uninstall
brew uninstall --cask kenmclennan/tap/recognizer
brew autoremove
```

Removing the cask also removes the `recognizer-plugins` bundle and the plugins nothing else needs; `brew autoremove` is for an older Homebrew that leaves them, and for `node` and `python@3.13` when nothing else needs them.

The cask has no zap stanza, so these are left behind. Remove them only if you want them gone:

- **Each repository's `.recognizer/` folder.** Its policy, config, saved views, responsibilities and baselines are committed files in that repository; `.recognizer/cache/` holds scans, findings, overlays and run logs. `rm -rf .recognizer/cache` frees the space and keeps the setup; `rm -rf .recognizer` removes everything (commit the removal if it was committed).
- **The app's config folder**, `~/Library/Application Support/com.kenmclennan.recognizer`. It holds `config.json` (the Editor and Describing settings), the recent folders and views, and the app's socket. Remove it with `rm -rf ~/Library/Application\ Support/com.kenmclennan.recognizer`.
- **The app's web view data**, `~/Library/WebKit/com.kenmclennan.recognizer`. Remove it with `rm -rf ~/Library/WebKit/com.kenmclennan.recognizer`.

## Use

Open a repository in the viewer from its folder:

```sh
cd my-repo
recognizer open
```

The window scans the repository when it opens and shows its file tree; tick files or folders to put them on the canvas. Nothing costly runs on its own: describing and the sensors run only when you ask, from the Scan panel or the command line.

The same scan drives the command line. Every command reads the cached scan, or scans first when the files changed:

```sh
recognizer scan                   # extract when the files changed
recognizer scan --sense all       # then run every registered sensor
recognizer check                  # violations, baseline growth, metrics and warnings
recognizer uses app/src/main.ts   # the modules a module uses
recognizer used-by app/src/main.ts
recognizer callers <module> <name>
recognizer path <from> <to>       # the shortest chain of uses
recognizer find <text>            # modules by path, members by name
recognizer show <module>          # members, signatures, responsibility and findings
recognizer modules --findings     # every module with its counts, filtered and sorted
recognizer views list             # saved views
recognizer doctor                 # is the setup valid, and how to fix it
recognizer log --last             # what the last run did and why it failed
```

`recognizer help` lists every command, and `recognizer help <command>` prints one in full: usage, options, output, exit codes and examples. [check/README.md](check/README.md) is the full reference.

## Configure a repository

A repository configures Recognizer in its `.recognizer/` folder. Edit it with `recognizer config` and `recognizer policy`, which check every key and value as they write, or ask an agent to do it with the setup skill (see [Agents](#agents)).

- `policy.yaml` declares the architecture: named components by path and the dependencies each may have. An edge that breaks it is a violation. Start from a policy in [`policies/`](policies) (`hexagonal.yaml` or `vertical-slices.yaml`), or build one with `recognizer policy --add components.<name> '<glob>'`. `recognizer check --init-baseline` records today's violations in `baselines/violations.json`, and from then on `recognizer check` fails on any new one. The baseline may only shrink.
- `config.yaml` registers the sensors to run and, optionally, a describer. `recognizer config --add-section sensors.crap` registers a shipped sensor with its defaults. C.R.A.P. and Mutation run the repository's own test suites, set under `tests:`; `recognizer help sensors crap` prints the setup guide and `recognizer sensors check --run` confirms it works. With no describer registered, `recognizer describe` uses the shipped `recognizer-describe-claude`. `recognizer help config` lists every key.

Commit `policy.yaml`, `config.yaml`, `views/`, `responsibilities.json` and `baselines/`. Add `.recognizer/cache/` to the repository's `.gitignore`: it holds scans, findings, overlays and run logs, and Recognizer does not add the line for you.

The describer's model and how many modules it describes at once are your settings, not the repository's: `describing` in the app's `config.json`, edited in the app's Settings.

## Agents

Agents use the command line only. Install the Claude Code skills once per machine:

```sh
recognizer agents install
```

It writes two skills under `~/.claude/skills/`: `recognizer`, which answers questions about a scanned codebase's structure by following the guide, and `recognizer-setup`, which sets up a repository, or updates and fixes its setup after an upgrade, proposing each command and running it only after you agree. It also adds deny rules to `~/.claude/settings.json` so an agent cannot read or edit `.recognizer/` except `config.yaml`. `recognizer agents uninstall` reverses both.

`recognizer help agents` prints the guide the agents follow: the commands, the rules, and recipes for showing how something is built, reviewing a branch, planning a change, driving an open window, reporting a review and checking the setup.

## Troubleshooting

Start with `recognizer doctor` in the repository: it checks the config, the policy, the scanners, the sensors and the describer, and prints the fix for each problem. `recognizer plugins` lists every plugin found on `PATH`, with its protocol and what uses it in the repository. When a scan or describe fails, `recognizer log --last` shows what ran and why it failed.

- **`recognizer: command not found`.** The cask is not installed, or its links were removed. Run `brew install --cask kenmclennan/tap/recognizer`.
- **Doctor reports `plugin-missing` for a registered sensor or describer.** The program is not on `PATH` on this machine. The fix is the install line recorded under `install.<program>` in `config.yaml`; when none is recorded it says so, and `recognizer plugin add <name>` on a machine that has the plugin records one.
- **Doctor reports `plugin-manifest`.** The program is on `PATH` but its `manifest` verb did not answer or did not validate. `recognizer plugin check <program>` says which result failed.
- **Doctor reports `plugin-protocol`.** The plugin speaks a protocol the installed Recognizer does not. The previous protocol is a warning (the plugin still runs); any other is a problem and the plugin is refused. The fix is the plugin's install line: upgrade it.
- **Doctor reports `sensor-gap` or `describer-gap`.** The plugin's own readiness check found something missing; `recognizer help sensors <name>` says how to fix it.
- **Doctor reports `plugin-settings`.** A key under `sensors.<name>` is not one the sensor's manifest declares, or its value breaks the declared type or range. `recognizer help sensors <name>` lists the keys.
- **Doctor reports `scanner-missing`.** No installed scanner claims a language the repository holds, or `scanners.<language>` names a scanner that is not installed. Install a scanner that claims the language; `recognizer plugins` lists what is installed. With no scanner installed at all, the problem is named `scanners`.
- **Doctor reports `scanner-ambiguous` or a scan fails with `ambiguous-scanner`.** Two installed scanners claim the language. Choose one with `recognizer config scanners.<language> <name>`.
- **Doctor reports `scanner-choice`, or a scan fails with `invalid-choice`.** `scanners.<language>` names an installed scanner that does not claim the language. Name one that does, or `recognizer config --unset scanners.<language>`.
- **`brew list --formula` still shows `recognizer`.** The machine installed the retired formula, which the cask replaces. Run `brew update && brew uninstall --ignore-dependencies --formula recognizer && brew upgrade --cask recognizer` once.
- **The app says `Recognizer X cannot scan with <tool> Y` or `This installation of Recognizer is incomplete`.** The app runs only the tools inside its own bundle, never the ones on `PATH`, and refuses when one is missing or its version differs from the app's. Run `brew reinstall --cask kenmclennan/tap/recognizer`.
- **macOS refuses to open the app.** The app is ad-hoc signed, not notarized. The cask clears the quarantine attribute after install; an app downloaded from the releases page keeps it. Install with the cask, or allow the app under Privacy and Security in System Settings, or run `xattr -dr com.apple.quarantine /Applications/Recognizer.app`.
- **`recognizer open` says "Recognizer.app was not found in ~/Applications or /Applications".** The app is not in either folder. Set `RECOGNIZER_APP` to the absolute path of the `.app` bundle.
- **Describing fails with "claude could not be run".** The shipped describer calls the `claude` command. Install Claude Code, sign in, and check that `command -v claude` finds it in a new terminal: the app takes its `PATH` from your login shell. "claude usage limit" means the plan's limit was hit: the lines already written stay, and a later `recognizer describe` finishes the rest.
- **Doctor reports a retired or empty config key after an upgrade.** The new version no longer reads it. Run the `recognizer config --unset <key>` or `recognizer config --remove-section sensors.<name>` command doctor prints.
- **The scan stops with exit 4 and "the folder has no git commit".** Sensors need a commit to record. Make the first commit (`git add` the files, then `git commit`).
- **A sensor fails with `coverage unavailable: no test suites are configured` or `no test suite is configured for <language>`.** C.R.A.P. and Mutation run the repository's tests, and have no suite for a scanned language. Follow `recognizer help sensors crap` to add the `tests:` entries, then run `recognizer sensors check --run`.
- **A sensor fails with `coverage unavailable: the <suite> suite left no coverage report at <path>`.** The suite's command failed, or wrote its report somewhere else. Read `.recognizer/cache/coverage/last-run.log`, fix the suite's `command` or `coverage.path` with `recognizer config`, and confirm with `recognizer sensors check crap --run`. The guide lists the coverage tool each language needs.
- **A sensor fails with `<program> is not installed`.** The suite's tool is not on the login shell's `PATH` after the suite's `activate` line. Install it in the repository's environment, or set the activate line (`recognizer config tests.<name>.activate "<line>"`), as `recognizer help sensors crap` shows.
- **Doctor says the scan was not used because the working tree has uncommitted changes.** The policy is compared with a clean scan only, and build output the repository does not ignore makes the tree dirty. Commit, ignore or stash those paths, then run `recognizer scan`. The setup guide lists the build folders to add to `.gitignore`.

## Extending

What a repository can add today:

- **An installed sensor or describer.** `recognizer plugin add <name>` registers it in `config.yaml` and records its install line under `install`, so `recognizer doctor` can tell a teammate how to install it. `recognizer plugins` lists what is installed.
- **Its own sensor.** Register any command under `sensors` in `config.yaml`. It is run from the repository root with `{repository}`, `{commit}` and `{output}` filled in, and writes a findings document ([`schema/findings.schema.json`](schema/findings.schema.json)) to `{output}`. It runs when asked: `recognizer scan --sense <name>` or `--sense all`.

  ```yaml
  sensors:
    unused:
      command: [node, "{repository}/scripts/unused.mjs", "{commit}", "{output}"]
  ```

- **Its own describer.** Set `describer.command` and `describer.version` in `config.yaml`. The command is given `{repository}`, `{module}`, `{model}` and `{request}` (a JSON request file) and prints one line. Bump the version to redo every line.
- **An agent's review.** `recognizer report --as <name>` files review findings in the findings form, and the viewer and `recognizer check` treat them like a sensor's.
- **A different scanner for a language.** Install a `recognizer-scan-<name>` program whose manifest claims the language, and when two scanners claim it, choose one with `recognizer config scanners.<language> <name>`. The `RECOGNIZER_SCAN_<LANGUAGE>` variables are retired: to run a checkout's scanner, put a launcher named `recognizer-scan-<name>` first on `PATH`.

[check/README.md](check/README.md) gives the contracts in full. A plugin model for scanners, sensors and describers is being built; [docs/plugins.md](docs/plugins.md) describes it.

## Docs

- [check/README.md](check/README.md): every command, the policy, config and findings formats, exit codes.
- [docs/use-cases.md](docs/use-cases.md): what Recognizer is for, and the five use cases every feature serves.
- [docs/design.md](docs/design.md): what is decided and what is still open; [docs/glossary.md](docs/glossary.md) names the terms.
- [docs/plugins.md](docs/plugins.md): the plugin design being built.
- [app/README.md](app/README.md): building the app and how releases are cut.
- [CLAUDE.md](CLAUDE.md): how the repository is laid out and the rules for working in it.
