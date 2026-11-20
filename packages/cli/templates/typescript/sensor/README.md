# {{program}}

A Recognizer sensor that measures a repository and writes a findings document. It needs Node 22.6 or later (it runs `src/main.ts` with type stripping, so there is no build step). `{{program}}` is a small launcher that resolves its own symlinks and runs `src/main.ts`.

It answers the four verbs of the plugin contract, reports progress as events, writes a findings document with no findings, and stops on SIGTERM. It passes `recognizer plugin check` as written, so it is a starting point that already conforms.

## Edit

Change the manifest's `metrics` and `findings`, and the place that measures the repository. Every place to edit is marked `EDIT HERE`. Keep the `install` line in the manifest true: it is what Recognizer tells a user to run when this plugin is missing.

## Check

Run `recognizer plugin check {{program}}`. Run it again after every change; a plugin that passes it conforms to the contract.

## Install

Put this folder on `PATH`, or link `{{program}}` into a directory that is on `PATH`, for example `ln -s "$PWD/{{program}}" ~/.local/bin/{{program}}`. The launcher follows the link back to this folder.

Register it in a repository with `recognizer plugin add {{name}}`, once `{{program}}` is on `PATH`. That writes the plugin into the repository's `.recognizer/config.yaml`, with its `install` line.

## More

Run `recognizer help plugin-guide` for the full guide, and `recognizer plugin schema <name>` to print a schema.
