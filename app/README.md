# Recognizer app

The Recognizer viewer: a Tauri 2 desktop app for macOS (Apple silicon), built from `kenmclennan/tauri-starter`. Open a folder with `recognizer open [FOLDER]` ([check/README.md](../check/README.md#recognizer-open)).

## Commands

Run these from the repository root after `npm ci`.

- `npm run app` runs the app in development. It runs the tools from `RECOGNIZER_TOOLCHAIN` (a built toolchain folder holding `commands/`) when that is set, else from the login shell's `PATH`, and refuses a tool whose `--version` differs from the app's.
- `npm run check:app` runs typecheck, lint, the format check, the tests, the Rust gate (`cargo test`, `cargo fmt --check` and `cargo clippy -D warnings` for the app, and `cargo test --locked` for the Rust scanner) and the build. It skips the two graph-layout test files; `npm run test:layout -w @recognizer/app` runs them.
- `npm run install-app` builds the app and copies it into `~/Applications`. It links nothing onto `PATH` and copies no toolchain into the bundle, so that bundle refuses to scan as an incomplete installation; install the cask to scan with a packaged app.

## Settings

Settings is a modal over the repository window, opened from the gear at the bottom of the rail, Recognizer > Settings... and Cmd+, (a window with no repository shows only the App group). The App group (Editor and Describing) is stored per Mac in `config.json` in the app's config folder, `~/Library/Application Support/com.kenmclennan.recognizer`. The Repository group edits the open repository's `.recognizer/config.yaml`: `write_repository_config` copies the file into a temp folder, runs `recognizer config` once per staged edit there, and replaces the real file only when every edit was accepted, refusing the write when the file changed since the modal read it. A Reset removes the key so the published default applies. The modal never scans.

## Releases

Every push to `main` whose `app` workflow passes starts `release.yml`, on the self-hosted runner. A merge that touches none of the `app` workflow's paths runs no `app` workflow and makes no release, and a commit already tagged is skipped.

The release:

1. Computes the version from the version committed in the root `package.json` and the releases already published, and stamps it into every manifest. The version is never committed by hand.
2. Builds the toolchain, `recognizer-toolchain.tar.gz`: the CLI, every scanner, the sensors and the claude describer.
3. Builds the app, copies the toolchain into the bundle under `Contents/Resources/toolchain`, ad-hoc signs it after the copy, and packs `recognizer.app.tar.gz`. The toolchain's `commands/` folder holds one link per command; it is what the app runs and what the cask links onto `PATH`.
4. Smoke-tests the bundled toolchain: every tool's `--version` matches, and the fixtures scan in every language.
5. Publishes both archives to `kenmclennan/recognizer-releases`, tags the source commit `v<version>`, renders the cask into `kenmclennan/homebrew-tap` (removing the retired formula there), and refreshes the releases repository's README from `.github/release-readme.md`.

The app updates only through Homebrew: install with `brew install --cask kenmclennan/tap/recognizer`, which installs the app and links every command onto `PATH`, and upgrade with `brew upgrade` or `brew upgrade --cask kenmclennan/tap/recognizer`. The release is skipped with a notice if the repository lacks the `RELEASES_TOKEN` secret.

## Setup for the owner

- [x] Create the public repo `kenmclennan/recognizer-releases`.
- [x] Create the public repo `kenmclennan/homebrew-tap` with a README and a default branch `main`; the release job renders `Casks/recognizer.rb` into it.
- [x] Set the repository secret `RELEASES_TOKEN` to a fine-grained token with contents read and write on both the releases repo and the tap.
