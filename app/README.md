# Recognizer app

The Recognizer viewer: a Tauri 2 desktop app for macOS (Apple silicon), built from `kenmclennan/tauri-starter`. Open a folder with `recognizer open [FOLDER]` ([check/README.md](../check/README.md#recognizer-open)).

## Commands

- `npm run app` runs the app in development.
- `npm run check:app` runs typecheck, tests, lint, format checks, the Rust gate and the build.
- `npm run install-app` builds the app and copies it into `~/Applications`. It links nothing into `~/.local/bin`.

## Releases

Every merge to `main` that passes the `app` workflow builds, signs and publishes a release to `kenmclennan/recognizer-releases`. The version is computed in the release runner from the version committed in `tauri.conf.json` and the releases already published; it is never committed by hand. The app checks for updates in production builds and offers them in its footer. The release job is skipped with a notice if the repository lacks the `RELEASES_TOKEN` secret.

## Setup for the owner

All done:

- [x] Create the public repo `kenmclennan/recognizer-releases`.
- [x] Generate the signing key with `npm run tauri -w @recognizer/app -- signer generate -w ~/.tauri/recognizer.key`.
- [x] Paste the public key into `plugins.updater.pubkey` in `app/src-tauri/tauri.conf.json`.
- [x] Set the repository secrets `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` and `RELEASES_TOKEN` (a fine-grained token with contents read and write on the releases repo only).
