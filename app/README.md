# Recognizer app

The Recognizer viewer: a Tauri 2 desktop app for macOS (Apple silicon), built from `kenmclennan/tauri-starter`. Open a folder with `recognizer open [FOLDER]` ([check/README.md](../check/README.md#recognizer-open)).

## Commands

Run these from the repository root after `npm ci`.

- `npm run app` runs the app in development. It runs the tools from `RECOGNIZER_TOOLCHAIN` (a built toolchain folder holding `commands/`) when that is set, else from the login shell's `PATH`, and refuses a `recognizer` whose `--version` differs from the app's; it version-checks no other command.
- `npm run check:app` runs typecheck, lint, the format check, the tests, the Rust gate (`cargo test`, `cargo fmt --check` and `cargo clippy -D warnings` for the app, and `cargo test --locked` for the Rust scanner) and the build. It skips the two graph-layout test files; `npm run test:layout -w @recognizer/app` runs them.
- `npm run install-app` builds the app and copies it into `~/Applications`. It links nothing onto `PATH` and copies no toolchain into the bundle, so that bundle refuses to scan as an incomplete installation; install the cask to scan with a packaged app.

## Settings

Settings is a modal over the repository window, opened from the gear at the bottom of the rail, Recognizer > Settings... and Cmd+, (a window with no repository shows only the App group). The App group (Editor and Describing) is stored per Mac in `config.json` in the app's config folder, `~/Library/Application Support/com.kenmclennan.recognizer`. The Repository group edits the open repository's `.recognizer/config.yaml`: `write_repository_config` copies the file into a temp folder, runs `recognizer config` once per staged edit there, and replaces the real file only when every edit was accepted, refusing the write when the file changed since the modal read it. A Reset removes the key so the published default applies. The modal never scans.

## Releases

Every push to `main` whose `app` workflow passes starts `release.yml`, on the self-hosted runner. The `app` workflow's push paths hold `app/`, `check/`, `schema/`, `scripts/`, `packaging/` and the root manifests, but no plugin folder, so a plugin-only change makes no cask release. A merge that touches none of those paths runs no `app` workflow, and a commit already tagged is skipped.

The cask release:

1. Fails first when the tap holds no `Formula/recognizer-plugins.rb`, so a cask that depends on a missing formula is never published.
2. Computes the version from the version committed in the root `package.json` and the releases already published, and stamps it into the CLI and app manifests only. The version is never committed by hand.
3. Builds the CLI-only toolchain folder: the `recognizer` command, its closure and its grammars.
4. Builds the app, copies the toolchain folder into the bundle under `Contents/Resources/toolchain`, ad-hoc signs it after the copy, and packs `recognizer.app.tar.gz`. The folder's `commands/` holds one link, `recognizer`; it is what the app runs and what the cask links onto `PATH`.
5. Smoke-tests the bundled folder: `recognizer --version` matches.
6. Publishes `recognizer.app.tar.gz` to `kenmclennan/recognizer-releases`, tags the source commit `v<version>`, renders the cask into `kenmclennan/homebrew-tap` (removing the retired formula there), and refreshes the releases repository's README from `.github/release-readme.md`.

Each plugin is released on its own. `packaging/units.json` lists seven release units (`scan-python`, `scan-typescript`, `scan-kotlin`, `scan-csharp`, `scan-rust`, `sensors` and `describe-claude`); the `sensors` unit carries the three sensor formulae. A `release-<unit>.yml` workflow starts on a passing push run of the unit's own CI workflow and calls `release-plugin.yml`, which skips unless the unit's folder changed since its last tag, computes the unit's version from the `<unit>-v` tags, builds the unit's archive with `scripts/build-plugin.mjs`, smoke-tests it, publishes `<unit>-v<version>` to the releases repository, tags the source the same way, and renders the unit's formulae into the tap. A hand start with `force` releases a unit that has not changed. `release-plugins.yml` releases the `recognizer-plugins` bundle as `recognizer-plugins-v<n>` when `packaging/units.json` or the bundle template changes, and fails when a member formula is missing from the tap. `tap-smoke.yml` installs the cask on a clean hosted Mac after each cask release, weekly and by hand, and proves the set works, one plugin can be removed and restored, and the uninstall block leaves nothing behind.

The first release lands in order: start each `release-<unit>` once with `force`, then `release-plugins`, then re-run the failed `release` run.

The app updates only through Homebrew: install with `brew install --cask kenmclennan/tap/recognizer`, which installs the app and the `recognizer` command and, through the `recognizer-plugins` bundle, every official plugin, and upgrade with `brew upgrade` or `brew upgrade --cask kenmclennan/tap/recognizer`. A release is skipped with a notice if the repository lacks the `RELEASES_TOKEN` secret.

## Setup for the owner

- [x] Create the public repo `kenmclennan/recognizer-releases`.
- [x] Create the public repo `kenmclennan/homebrew-tap` with a README and a default branch `main`; the release job renders `Casks/recognizer.rb` into it.
- [x] Set the repository secret `RELEASES_TOKEN` to a fine-grained token with contents read and write on both the releases repo and the tap.
