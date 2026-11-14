# Recognizer releases

This repository holds the released Recognizer app and the release archive of each official plugin unit.

## Install

`brew install --cask kenmclennan/tap/recognizer` installs the app (Apple silicon only) and links the `recognizer` command onto your `PATH`. The cask depends on the `recognizer-plugins` bundle formula in the tap, which installs every official plugin: the Python, TypeScript, Kotlin, C# and Rust scanners, the three sensors (`recognizer-sense-crap`, `recognizer-sense-mutation`, `recognizer-sense-thresholds`) and the claude describer. The plugins run on Homebrew's `node` and `python@3.13`, which Homebrew installs. The app is ad-hoc signed, not Apple-signed; the cask clears the quarantine attribute so it opens.

## Releases

The app releases are tagged `v<version>`. Each plugin unit is released when its own folder changes, as `<unit>-v<version>` (`scan-python`, `scan-typescript`, `scan-kotlin`, `scan-csharp`, `scan-rust`, `sensors` and `describe-claude`), and the bundle's member list as `recognizer-plugins-v<n>`. The plugin formulae in the tap download those archives.

## Upgrades

`brew upgrade --cask kenmclennan/tap/recognizer` (or a bare `brew upgrade`) upgrades the app and the `recognizer` command together. Each plugin formula upgrades on its own release.

## Moving from an earlier install

The `recognizer` formula is retired. A machine that installed it runs `brew update && brew uninstall --ignore-dependencies --formula recognizer && brew upgrade --cask recognizer` once. A machine that holds the earlier cask, which carried every command, runs `brew update && brew uninstall --cask recognizer && brew install --cask recognizer` once.
