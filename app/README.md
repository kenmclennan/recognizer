# Recognizer app

The Recognizer viewer: a Tauri 2 desktop app for macOS (Apple silicon), built from `kenmclennan/tauri-starter`. Open a folder with `recognizer open [FOLDER]` ([check/README.md](../check/README.md#recognizer-open)).

## Commands

Run these from the repository root after `npm ci`.

- `npm run app` runs the app in development. It runs the tools from `RECOGNIZER_TOOLCHAIN` (a built toolchain folder holding `commands/`) when that is set, else from the login shell's `PATH`, and refuses a `recognizer` whose `--version` differs from the app's; it version-checks no other command.
- `npm run check:app` runs typecheck, lint, the format check, the tests, the Rust gate (`cargo test`, `cargo fmt --check` and `cargo clippy -D warnings` for the app, and `cargo test --locked` for the Rust scanner) and the build. It skips the two graph-layout test files; `npm run test:layout -w @recognizer/app` runs them.
- `npm run install-app` builds the app and copies it into `~/Applications`. It links nothing onto `PATH` and copies no toolchain into the bundle, so that bundle refuses to scan as an incomplete installation; install the cask to scan with a packaged app.

## Settings

Settings is a modal over the repository window, opened from the gear at the bottom of the rail, Recognizer > Settings... and Cmd+, (a window with no repository shows only the App group). The App group (Editor and Describing) is stored per Mac in `config.json` in the app's config folder, `~/Library/Application Support/com.kenmclennan.recognizer`. The Repository group edits the open repository's `.recognizer/config.yaml`: `write_repository_config` copies the file into a temp folder, runs `recognizer config` once per staged edit there, and replaces the real file only when every edit was accepted, refusing the write when the file changed since the modal read it. A Reset removes the key so the published default applies. The modal never scans.

## Setup

Setup is a wizard opened from the wrench at the bottom of the rail, above Settings, with an amber count of the problems `recognizer doctor` reports. Opening it runs the survey and doctor (`setup_survey`) and, when no scan is cached, `scan --extract`; nothing costly starts until a button is clicked. Ask Claude (`setup_recommend`) runs `claude -p` in the window's folder with a fixed read-only allowlist for policy recommendations only, using the Setup pane's model in Settings (seeded `sonnet`), and passes the answer through `recognizer setup recommend`. Apply (`setup_apply`) and Run once (`setup_try`) write the choices to a temp file and run `recognizer setup apply|try`, streaming each event line to the window as `setup-run-event`; the command builds every argv itself and undoes all changes when one fails. Stop (`stop_setup`) and closing the window kill the live process group.

## Releases

One run of `release.yml` is the release train: it publishes the app and every plugin unit changed since its last release, all built from the same commit, and writes the cask and every formula to the tap in one commit. A release starts on request: `gh workflow run release.yml` (optionally `-f commit=<sha>`, a full SHA) or the Actions tab, on the self-hosted runner, on the commit it is given (default: the head of main). A merge to `main` publishes nothing. The `app` workflow's push paths hold `app/`, `check/`, `schema/`, `scripts/`, `packaging/` and the root manifests, but no plugin folder, so a plugin-only change makes no cask release. A commit that touches none of those paths has no `app` run, which the app guard accepts, and a commit already tagged is skipped.

The cask release:

1. Plans the train (`scripts/release-train.mjs plan`): the units to release are each unit in `packaging/units.json` whose folder changed since its latest `<unit>-v` tag, or that has none, and the plan fails unless CI is green on the commit for `check`, `app`, `schema-compat` and each releasing unit's CI workflow (when a workflow's path filter made no run on the commit, the nearest earlier run on `main` decides). It also fails when the tap holds no `Formula/recognizer-plugins.rb`, so a cask that depends on a missing formula is never published. Each planned unit is built by `build-plugin.yml` from the same commit, one at a time, and its archive is smoke-tested.
2. Computes the version from the version committed in the root `package.json` and the releases already published, and stamps it into the CLI and app manifests only. The version is never committed by hand.
3. Builds the CLI-only toolchain folder: the `recognizer` command, its closure and its grammars.
4. Builds the app, copies the toolchain folder into the bundle under `Contents/Resources/toolchain`, ad-hoc signs it after the copy, and packs `recognizer.app.tar.gz`. The folder's `commands/` holds one link, `recognizer`; it is what the app runs and what the cask links onto `PATH`.
5. Smoke-tests the bundled folder: `recognizer --version` matches.
6. Opens the app ten times on a fixture repository under its own identifier (`scripts/open-check.mjs`, also `npm run open-check -- --toolchain <folder>` after `node scripts/build-toolchain.mjs <dir>` and `npm run build -w @recognizer/app`): each open must draw the explorer, read from the app socket's `window` answer, and the first open that does not fails the release. It needs the `recognizer-plugins` bundle installed on the runner and never touches the installed app's data folders.
7. Fails unless the commit is an ancestor of `origin/main`.
8. Fails when a built scanner's `scan_schema_version` differs from the app's (`release-train.mjs verify`), then publishes every planned archive and `recognizer.app.tar.gz` to `kenmclennan/recognizer-releases`, tags the source commit `<unit>-v<version>` and `v<version>`, and refreshes the releases repository's README from `.github/release-readme.md`.
9. In a following `tap` job, renders the cask and the formula of every unit from the latest published release of each, and the `recognizer-plugins` bundle when its member list differs from `packaging/units.json`, into `kenmclennan/homebrew-tap` as one commit (removing the retired formula there). A run that fails after publishing is run again on the same commit: the tagged units are not rebuilt and the tap job still adds them.

`packaging/units.json` lists seven release units (`scan-python`, `scan-typescript`, `scan-kotlin`, `scan-csharp`, `scan-rust`, `sensors` and `describe-claude`); the `sensors` unit carries the three sensor formulae. The per-unit CI workflows (`scanner-*.yml`, `sensors.yml`, `describer-claude.yml`) build and test on every merge and publish nothing, and `schema-compat.yml` fails a pull request that changes `schema/scan.schema.json` without raising `schema_version` or that leaves the last release's scans invalid against it. `schema/scan-breaking-versions.json` lists each scan schema version that stopped older scans validating: the app refuses a scan older than its own only when a listed number lies between them, and the same list exempts such an example in `schema-compat`. `tap-smoke.yml` installs the cask on a clean hosted Mac after each cask release, weekly and by hand, and proves the set works, one plugin can be removed and restored, and the uninstall block leaves nothing behind.

The app updates only through Homebrew: install with `brew install --cask kenmclennan/tap/recognizer`, which installs the app and the `recognizer` command and, through the `recognizer-plugins` bundle, every official plugin, and upgrade with `brew upgrade` or `brew upgrade --cask kenmclennan/tap/recognizer`. A release fails if the repository lacks the `RELEASES_TOKEN` secret.

## Setup for the owner

- [x] Create the public repo `kenmclennan/recognizer-releases`.
- [x] Create the public repo `kenmclennan/homebrew-tap` with a README and a default branch `main`; the release job renders `Casks/recognizer.rb` into it.
- [x] Set the repository secret `RELEASES_TOKEN` to a fine-grained token with contents read and write on both the releases repo and the tap.
