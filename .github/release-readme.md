# Recognizer releases

This repository holds the released Recognizer toolchain (the `recognizer` command, its scanners and the claude describer) and the Recognizer app.

## Install

`brew install --cask kenmclennan/tap/recognizer` installs the app (Apple silicon only) and, as a dependency, the `recognizer` command, the Python, TypeScript, Kotlin and Rust scanners and the claude describer. The app is ad-hoc signed, not Apple-signed; the cask clears the quarantine attribute so it opens.

## Upgrades

`brew upgrade --formula kenmclennan/tap/recognizer` upgrades the command and scanners, and `brew upgrade --cask kenmclennan/tap/recognizer` upgrades the app; `brew upgrade --cask` alone leaves the command behind. When the two are on different versions the app's footer says so.
