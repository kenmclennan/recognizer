# Recognizer releases

This repository holds the released Recognizer app and its toolchain (the `recognizer` command, its scanners and the claude describer).

## Install

`brew install --cask kenmclennan/tap/recognizer` installs the app (Apple silicon only) and links the `recognizer` command, the Python, TypeScript, Kotlin, C# and Rust scanners, the `recognizer-sensors` command, the three sensor commands (`recognizer-sense-crap`, `recognizer-sense-mutation`, `recognizer-sense-thresholds`) and the claude describer onto your `PATH`. The tools run on Homebrew's `node` and `python@3.13`, which the cask installs. The app is ad-hoc signed, not Apple-signed; the cask clears the quarantine attribute so it opens. `recognizer-toolchain.tar.gz` is the same toolchain as an archive, for CI machines that have no app.

## Upgrades

`brew upgrade --cask kenmclennan/tap/recognizer` (or a bare `brew upgrade`) upgrades the app and the tools together, so they are always on the same version.

## Moving from the formula

The `recognizer` formula is retired. A machine that installed it runs `brew update && brew uninstall --ignore-dependencies --formula recognizer && brew upgrade --cask recognizer` once.
