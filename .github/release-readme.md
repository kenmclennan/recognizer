# Recognizer releases

This repository holds the released Recognizer toolchain (the `recognizer` command, its scanners and the claude describer) and the Recognizer app.

## Install

1. `brew install kenmclennan/tap/recognizer` installs the `recognizer` command, the Python, TypeScript, Kotlin and Rust scanners and the claude describer.
2. `brew install --cask kenmclennan/tap/recognizer` installs the app (Apple silicon only). The app is ad-hoc signed, not Apple-signed; the cask clears the quarantine attribute so it opens.

## Upgrades

`brew upgrade recognizer` upgrades the command and scanners, and `brew upgrade --cask recognizer` upgrades the app. When the two are on different versions the app's footer says so.
