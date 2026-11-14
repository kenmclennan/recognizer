# {{program}}

A Recognizer scanner that reads a language into a scan document. It needs Node 22.6 or later (it runs `src/main.ts` with type stripping, so there is no build step). `{{program}}` is a small launcher that resolves its own symlinks and runs `src/main.ts`.

It answers the four verbs of the plugin contract, reports progress as events, writes a scan document of one module per file, and stops on SIGTERM. It passes `recognizer plugin check` as written, so it is a starting point that already conforms.

## Edit

Change the extension in the manifest and `EXTENSION`, and the place that parses each file. Every place to edit is marked `EDIT HERE`. Keep the `install` line in the manifest true: it is what Recognizer tells a user to run when this plugin is missing.

## Check

Run `recognizer plugin check {{program}}`. Run it again after every change; a plugin that passes it conforms to the contract.

## Install

Put this folder on `PATH`, or link `{{program}}` into a directory that is on `PATH`, for example `ln -s "$PWD/{{program}}" ~/.local/bin/{{program}}`. The launcher follows the link back to this folder.

A scanner is chosen by language, so there is nothing to register. Only when two installed scanners claim the same language does a repository name one, with `recognizer config scanners.{{name}} {{name}}`.

## More

Run `recognizer help plugin-guide` for the full guide, and `recognizer plugin schema <name>` to print a schema.
