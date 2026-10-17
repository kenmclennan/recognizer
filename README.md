# Recognizer

Scans a codebase into a language-neutral model of its modules and dependencies, and shows that model in a native viewer.

- **Scanners** are standalone command-line tools, one per language, that each emit the same JSON document.
- **The viewer** is a native app that draws a scan, a project's declared policy and any health overlays.
- **Consumers** such as lightcycle's codebase audit read the same scan without the viewer.

Design in progress.
