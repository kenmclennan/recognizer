# {{program}}

A Recognizer sensor that measures a repository and writes a findings document. It needs a Rust toolchain; the template has no dependency, so `cargo build --offline` works. `src/main.rs` is the whole program.

It answers the four verbs of the plugin contract, reports progress as events, writes a findings document with no findings, and stops on SIGTERM. It passes `recognizer plugin check` as written, so it is a starting point that already conforms.

## Build

Run `cargo build`. It produces `target/debug/{{program}}`; use that path wherever this README says `{{program}}`.

## Edit

Change the manifest's `metrics` and `findings`, and the place that measures the repository. Every place to edit is marked `EDIT HERE`. Keep the `install` line in the manifest true: it is what Recognizer tells a user to run when this plugin is missing.

## Check

Run `recognizer plugin check {{program}}`. Run it again after every change; a plugin that passes it conforms to the contract.

## Install

Run `cargo install --path .` to put `{{program}}` in Cargo's `bin` folder, or link `target/debug/{{program}}` into a directory that is on `PATH`.

Register it in a repository with `recognizer plugin add {{name}}`, once `{{program}}` is on `PATH`. That writes the plugin into the repository's `.recognizer/config.yaml`, with its `install` line.

## More

Run `recognizer help plugin-guide` for the full guide, and `recognizer plugin schema <name>` to print a schema.
