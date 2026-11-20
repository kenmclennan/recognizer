# {{program}}

A Recognizer scanner that reads a language into a scan document. It needs a Rust toolchain; the template has no dependency, so `cargo build --offline` works. `src/main.rs` is the program, and `src/sha256.rs` is a standard-library SHA-256, because a scanner hashes every file and the standard library has none. A real scanner would use the `sha2` crate; this template carries its own so that it builds offline.

It answers the four verbs of the plugin contract, reports progress as events, writes a scan document of one module per file, and stops on SIGTERM. It passes `recognizer plugin check` as written, so it is a starting point that already conforms.

## Build

Run `cargo build`. It produces `target/debug/{{program}}`; use that path wherever this README says `{{program}}`.

## Edit

Change the extension in the manifest and `EXTENSION`, and the place that parses each file. Every place to edit is marked `EDIT HERE`. Keep the `install` line in the manifest true: it is what Recognizer tells a user to run when this plugin is missing.

## Check

Run `recognizer plugin check {{program}}`. Run it again after every change; a plugin that passes it conforms to the contract.

## Install

Run `cargo install --path .` to put `{{program}}` in Cargo's `bin` folder, or link `target/debug/{{program}}` into a directory that is on `PATH`.

A scanner is chosen by language, so there is nothing to register. Only when two installed scanners claim the same language does a repository name one, with `recognizer config scanners.{{name}} {{name}}`.

## More

Run `recognizer help plugin-guide` for the full guide, and `recognizer plugin schema <name>` to print a schema.
