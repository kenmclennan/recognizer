# Recognizer

Recognizer scans a codebase into a language-neutral model of its modules and dependencies, and shows that model in a native viewer. The picture is derived from the code and never drawn by hand, so it cannot disagree with the code.

## Parts

- **Scanners.** One standalone command-line tool per language (Python, TypeScript, Kotlin) that reads a source tree and prints the same JSON scan document.
- **Policy.** A repository's owners declare their architecture in `.recognizer/policy.yaml`: named components by path, a level order and/or the dependencies each component may have, and rules those cannot express. An edge that breaks it is a violation.
- **Check.** Reads a scan and a policy, reports violations, and refuses growth beyond the committed baseline, so a codebase's known violations may only shrink.
- **Viewer.** A native app (Tauri) that draws the modules and their dependencies, colours violations and health, and opens a module to show its classes and functions.

Other tools use the scan without the viewer. lightcycle's codebase audit compares scans of two commits to see what changed and turns policy violations into ratchets.

## Status

Design in progress: [docs/design.md](docs/design.md) holds what is decided and what is still open. Nothing is built yet.
