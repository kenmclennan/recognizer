# Recognizer app

The Recognizer viewer: a Tauri 2 desktop app for macOS (Apple silicon), built from `kenmclennan/tauri-starter`. Open a folder with `recognizer open [FOLDER]` ([check/README.md](../check/README.md#recognizer-open)).

## Commands

- `npm run app` runs the app in development.
- `npm run check:app` runs typecheck, tests, lint, format checks, the Rust gate and the build.
- `npm run install-app` builds the app and copies it into `~/Applications`. It links nothing into `~/.local/bin`.

## Releases

Every merge to `main` that passes the `app` workflow builds the toolchain archive (`recognizer-toolchain.tar.gz`: the CLI and every scanner) and the app (`recognizer.app.tar.gz`, ad-hoc signed), smoke-tests the archive, publishes both to `kenmclennan/recognizer-releases` and renders the formula and cask into `kenmclennan/homebrew-tap`. The version is computed in the release runner from the version committed in the root `package.json` and the releases already published, and stamped into every manifest; it is never committed by hand. The app updates only through Homebrew: install and upgrade with `brew install kenmclennan/tap/recognizer`, `brew install --cask kenmclennan/tap/recognizer` and `brew upgrade`, and the footer says when the app and the `recognizer` command are out of step. The release job is skipped with a notice if the repository lacks the `RELEASES_TOKEN` secret.

## Setup for the owner

- [x] Create the public repo `kenmclennan/recognizer-releases`.
- [ ] Create the public repo `kenmclennan/homebrew-tap` with a README and a default branch `main`; the release job renders `Formula/recognizer.rb` and `Casks/recognizer.rb` into it.
- [ ] Set the repository secret `RELEASES_TOKEN` to a fine-grained token with contents read and write on both the releases repo and the tap.
