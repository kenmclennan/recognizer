# {{program}}

A Recognizer describer that writes one line saying what a module is responsible for. It needs Python 3.9 or later and nothing else. `{{program}}` is one executable file with a `python3` shebang.

It answers the four verbs of the plugin contract, reports progress as events, writes one line on stdout, and stops on SIGTERM. It passes `recognizer plugin check` as written, so it is a starting point that already conforms.

## Edit

Change the line the run prints. Every place to edit is marked `EDIT HERE`. Keep the `install` line in the manifest true: it is what Recognizer tells a user to run when this plugin is missing.

## Check

Run `recognizer plugin check {{program}} --request request.json`, where `request.json` holds `{"module":"a.py","source":"x","members":[],"uses":[],"used_by":[]}`. Run it again after every change; a plugin that passes it conforms to the contract.

## Install

Put this folder on `PATH`, or link `{{program}}` into a directory that is on `PATH`, for example `ln -s "$PWD/{{program}}" ~/.local/bin/{{program}}`.

Register it in a repository with `recognizer plugin add {{name}}`, once `{{program}}` is on `PATH`. That writes the plugin into the repository's `.recognizer/config.yaml`, with its `install` line.

## More

Run `recognizer help plugin-guide` for the full guide, and `recognizer plugin schema <name>` to print a schema.
