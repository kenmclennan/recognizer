# Recognizer design

Temporary: this document holds the design while it is being decided and built, and is deleted once the code and its own docs carry it.

## What it is

Recognizer scans a codebase into a language-neutral model of its modules and dependencies, and shows that model in a native viewer. The picture is derived from the code and never drawn by hand. The same scan is a machine-readable model other tools read without the viewer, such as lightcycle's codebase audit, which measures change with it and builds ratchets from it.

## Decided

### Granularity

- A box per module. A module's classes, functions and constants are shown in the inspector, never as boxes.
- Kotlin uses a box per package, because code in the same package needs no import; Gradle modules are the top level.

### Languages

- Python, TypeScript and Kotlin.
- One TypeScript scanner covers Node back ends and React front ends. Framework meaning (component, hook, route) belongs in the policy and overlays, not the scanner.

### Scanners

- Each language has a standalone command-line scanner that emits the same JSON scan document, so audits and CI can scan without the viewer.
- `recognizer scan <repository>` is the one front door: it detects the repository's languages, runs each language's scanner and writes one scan document per language to `.recognizer/cache/`. Scans are never merged; no edge crosses languages.
- Python uses its own `ast` module. TypeScript uses the TypeScript compiler API, so module resolution (tsconfig paths, workspace packages) is right. Kotlin uses tree-sitter-kotlin, proved by a spike first.

### Viewer

A native app: Tauri 2, with the domain, application and drawing code in TypeScript in the webview, and Rust as a narrow boundary for files, running scanners, watching for changes and dialogs.

- **Built from the template.** The app starts from `kenmclennan/tauri-starter`: its `npm run init` is run in a scratch clone (name Recognizer, slug `recognizer`) and the renamed `app/` is copied into `app/` here and added to the root workspaces. Its CI becomes a job filtered on `app/**`, and its release workflow runs after that job, so only an app change cuts a release. The design of record for the app's internals (pure modules behind thin adapters, the Rust trust boundary, the terminal command, releases and the updater) is the engineering knowledgebase's `desktop-apps/` topic.
- **Opened from the terminal with `recognizer open [folder]`.** A subcommand of the `recognizer` CLI launches the app on a folder, defaulting to the current directory. The app ships no terminal command of its own: the template's command is removed, so `recognizer` stays the one command for scanning, checking and opening.
- **It runs `recognizer scan`, never a bundled scanner.** The viewer scans exactly as CI and audits do. Rust runs the command on the folder the window opened through a Rust dialog and reads the result from that repository's `.recognizer/cache/`. An app launched from Finder has no shell `PATH`, so Rust resolves the command through the user's login shell, with an absolute path in the app's config as an override; a missing command is reported with what to install. A scan whose `schema_version` the app does not know is refused.
- **The window scans when it opens, and only then or on request.** Nothing rescans on its own. The footer says what the canvas was drawn from (the commit, when the folder is under git, and how long ago). When the files move on from the scan, the footer says so in amber with a Rescan button beside it: "N files changed since" for edits, or the new branch and commit when HEAD moved. A file counts when its contents now differ from when it was scanned, it is gone, or it is new in a language the scan covers; an edit undone again stops counting. What the scanners skip, files under `.recognizer/` and, under git, gitignored files do not count. A folder that is not under git is fully supported: the footer gives no commit and never reports HEAD moving. Clicking the count lists the files as modified, added or deleted. Rescan (the button, File > Rescan, ⌘R) dims the canvas while it runs and redraws the same view state, so back and forward still work; an open saved view that no longer matches shows its stale panel as on opening. A failed rescan keeps the old canvas and the footer says why.
- **Layout is ELK, drawn as SVG.** elkjs's layered algorithm places the nodes, off the main thread in a web worker; a pure module turns its coordinates into SVG, so the drawing is tested without a window.
- **The viewer needs no policy, and imposes no order the graph lacks.** A ball of mud must look like one. A policy lens is not built until example codebases have been drawn and show what it must express.

### Explorer

The viewer is an explorer, not a picture of the whole graph. Drawing every module at once is unreadable on a real codebase, and a dependency matrix ordered by depth shows little but cycles. The explorer starts from a few modules the user picks and grows by following edges, so the canvas only ever holds what the user asked to see. Clean and uncluttered is the bar: every addition to the screen earns its place, and nothing is shown by default that the user did not ask for.

The window has three areas, and the [glossary](glossary.md) names them. The first version is exactly what this section describes; anything not here is later. It looks and behaves as the [prototype](prototype/explorer.html) does, drawn from a scan of lightcycle: open it in a browser and match it, from the icons and chevrons to the frame styling and the empty-canvas hint. Where this section and the prototype disagree, this section wins.

- **The rail** (far left) is a thin strip of icons, one per left-hand panel, as an IDE's activity bar is. Clicking a panel's icon opens it, and clicking the icon of the open panel closes it so the canvas takes the width; one panel is open at a time, and the open panel's icon is marked. The first version has one panel, Files, which is the tree; the tree's own hide button goes. Further panels (saved views, history, scan history) are designed before any is built.
- **The tree** (the Files panel) is the repository's folder structure, as an IDE shows it, and is the way in. It opens and closes files, finds them, and jumps to them on the canvas. It carries no figures: each file and folder has a health disc instead, and a folder's disc is the worst inside it. A find field filters by path, and two filters keep only what is on the canvas or only what needs attention, with the folders above them. Its rows are the same as the Uses and Used by tabs' rows (below). Selecting something on the canvas scrolls the tree to it and highlights it, folders included. The tree has no key of its own: the legend names the discs.
- **The canvas** (centre) draws the modules on it inside frames that nest as the folders do. Each frame is exactly one folder, labelled with that folder's own name: a chain of folders is a chain of nested frames, never one frame labelled with a longer path. A frame shows its health disc and how many of its folder's files are on the canvas out of how many it holds. A folder can be folded into one box, which keeps its disc, and edges to anything inside it are drawn to that box. A module's box shows its disc, its name, and how many of its dependencies and dependents are not on the canvas.
- **The inspector** (right) is closed by default, as a narrow rail, and opens only when asked. It has four tabs, all in one underline style: Contents, Findings, Uses and Used by. Contents opens with the module's responsibility (below), then shows its members: classes with their fields and method signatures, then functions, then constants with their values; public members first and private ones folded into a count; and beside each member, which modules build, call or use it. Hovering a member highlights the edges that carry its name. For a folder, Contents lists its files and subfolders, each with its disc. Findings lists the selection's violations and warnings, each with why. A selected edge shows its evidence.

The controls are on the canvas, not in the sidebars:

- **One selection, one bar.** Clicking a module, or a folder by the name on its frame, selects it, and a small bar appears above it; right-clicking selects too and opens the same bar at the pointer. The bar is pinned to what opened it: it pans and zooms with the selection, or with that point on the canvas, and leaves the screen with it rather than being held inside the canvas. There is no second menu, and hovering only outlines. A module's bar has its dependencies, its dependents, contents and take off. Take off sits last, after a separator, drawn as a box with a minus and titled "Take off the canvas (Backspace)", never as a cross, so it does not read as closing the bar; the bar has no close button, and clicking empty canvas or Escape dismisses it. A folder's bar, for an open folder by its frame's name or a folded folder's box, adds its files, focus, and fold or unfold, which only make sense on a folder; its dependencies and dependents are the edges that cross its boundary. Keys: U and D open the Uses and Used by tabs, F focuses, Z folds, I opens contents, Backspace takes off, Escape clears.
- **One row, in the tree and the lists.** Every module row, in the tree and in the Uses and Used by tabs, is a checkbox, then the name, then the health disc, and looks as [the rows mock](prototype/picker-tab.html) does. The checkbox says whether the module is on the canvas, and clicking it puts it on or takes it off. Clicking the name of a module not on the canvas ticks it, puts it on and centres the canvas on it; clicking the name of a module already on the canvas centres the canvas on it. A module on the canvas has its name in bold. A folder row's checkbox puts all its files on or takes them all off, and shows a dash when only some are on; a folder's name opens and closes it, as its chevron does. There is no eye and no find. The checkbox is drawn by the app, not the platform's: 14px with rounded corners, filled with the selection colour and a drawn tick when checked, a dash when partly checked, its border lit on hover, with a focus ring for the keyboard.
- **Following edges is picking from a list in the inspector.** The dependency and dependent buttons show the total count and open the inspector on its Uses or Used by tab, beside the canvas so it never covers it; the button stays lit while its tab shows. The tab lists the modules grouped by folder, each heading naming the folder's full path, each row naming what is used from it. Its rows and folder headings are the rows above. Nothing is previewed on the canvas. Clicking a member's callers in Contents opens the Used by tab narrowed to those callers.
- **Focus** narrows the canvas to one folder's files. **Take off** removes a module, or a folder and everything in it: unticking it, or Backspace on the selection.
- **The view bar** (top left) holds back and forward, a saved-views button that lists the repository's saved views to open, the open view's name, which is edited in place to rename the view (or, on an untitled view, to name and save it), save, which asks for a name and a description the first time, and copy link, which copies the saved view's path to hand to an agent. The app always opens on an empty canvas; a saved view comes back only when it is opened. A count in the window's footer, beside the app's version, says how many of the repository's modules are on the canvas; nothing sits over the canvas's top right. Zoom, fit, clear and the legend sit at the bottom right.
- **Zoom and pan follow the device.** On a trackpad, pinch zooms and two fingers pan; with a mouse, the wheel zooms around the pointer and dragging pans. The device is told apart from each event, never from a setting. Zoom is limited to between 10% and 250%.
- **Health discs** are green for fine, amber for a warning, red for a violation, and a hollow grey ring for not measured. They come from `recognizer check`, run by the viewer as a library on the same scan; without a policy nothing is red.

Every edge on the canvas can show its evidence: the quoted import line, the names imported, and the route the names took through re-exporting files. Edges are hairlines under the boxes, so the modules dominate; the selection's own edges are highlighted and the rest dimmed. Hovering an edge names what it carries, and clicking it shows its evidence. Edges are drawn by kind: an ordinary dependency; an import of a private name (dashed), which is usually a defect; an inferred dependency (dotted, and switchable off), from the scan's inferred edges; and `implements` and `inherits` with a hollow arrowhead, so an adapter fulfilling a port does not read as depending on it. A legend on screen names every edge style, every disc, and what a frame's and a module's figures count, and holds the switch for inferred edges; nothing is explained only in prose.

- **View state is a record.** Everything that decides what the user sees (the modules on the canvas, what is folded, selected and focused) is one view state. Each change makes a new one, so back and forward through them is the undo. View states live only as long as the window: history is never saved, and what lasts is a saved view (below). The app writes the open window's current view state to `.recognizer/cache/current-view.json` on every change, so an agent can read what the user sees.
- **An agent answers a question with a view.** This is a core feature, not an add-on. The user asks how something works ("which modules are involved in creating an item?"); the agent works it out from the scan, the code or both, and answers with a saved view the user opens and explores from. The user can save their own view and hand it back with a question about it, and the loop repeats. The agent traces a feature through the member calls in the scan, so it need not read the source to answer; traces are for the agent and are never drawn on the canvas. The agent builds the view with the CLI's view commands, never by writing the file by hand.

The design beyond the first version is found by prototyping on example codebases: lightcycle first, then Saga, Yori and a known mess. A prototype is a throwaway sketch, never the app's code.

### Saved views

A saved view is how a view lasts: a file in the scanned repository at `.recognizer/views/<name>.json`, committed like the policy, so a team shares views and they review in pull requests. It holds:

- **A description**: one or two sentences saying what the view shows ("how a work item reaches the store"). The app asks for it as Description, with the hint "What it shows". It is required. It tells someone opening a committed view what they are looking at, and it is what lets an agent repair the view when the code has moved on.
- **The commit it was saved at**, so the view can say what changed since.
- **Steps**: what put each module on the canvas, replayed against the current scan every time the view opens. There are two kinds. A **pick** names one module by its path; everything the user adds in the app (from the tree, the Uses and Used by tabs, or a folder row's checkbox) is recorded as picks, always. A **rule** names a relationship: everything in a folder, or what a module uses or is used by, optionally within a folder. Rules are written by agents through the CLI where a rule is what is meant. Fold and focus are steps too. Taking a module off removes its pick, or, when a rule put it there, records that it is left out.

No layout is stored: the canvas lays a view out as it lays out any set of modules. Selection is not stored.

**A view is never shown stale.** A rule cannot go stale: it re-evaluates, gaining new files and losing deleted ones. A pick can name a module that no longer exists. When a view opens, recognizer compares the scan at the view's commit with the current one around the view, and the canvas shows only what exists now, with a warning that lists what changed:

- **Missing**: a picked module that is gone, with its new path when git records a rename.
- **Changed relations**: edges between the view's modules that were removed or added.
- **Newly relevant**: modules that now use or are used by the view's modules and did not at its commit, listed with checkboxes as the Uses tab lists them, never added for the user.

From the warning the user updates the view (drops what is missing, takes the renames, adds what they put on from the newly relevant list, and saves it at the current commit) or leaves it as it is. Nothing removed is drawn: the code as it is now is the only picture.

`recognizer views check` lists every step in every view that names a path which no longer exists, and exits non-zero when there is one; a repository's CI runs it beside `recognizer check`, so a change that breaks a view says so in its own pull request. `recognizer views check --fix` rewrites picks whose files git records as renamed.

#### The CLI an agent drives

An agent must be able to answer a question with a view reliably, using only the CLI. Two groups of commands serve it, each printing plain text by default and JSON with `--json`, and each reading the cached scan when it was taken at the current commit with a clean working tree and scanning first otherwise:

- **Questions of the scan**: `recognizer uses <module>`, `recognizer used-by <module>`, `recognizer callers <module> <name>` and `recognizer path <from> <to>`, with modules named by their repository-relative paths. They answer what the canvas and the Uses and Used by tabs would show, from the same library.
- **Views**: `recognizer views new <name> --description <text>`, then `add`, `rule`, `fold`, `focus` and `remove`, each adding or removing one step; `show <name>` prints the steps and the modules they resolve to now, so an agent checks its work without the app; `show --current` prints the view the app has open; `list`, `check` and `rm`. An agent never writes a view file by hand.

The app watches `.recognizer/views/`: a view open in the app updates in place when an agent changes it, so the user asks, the agent builds, and the canvas follows.

**The help is the manual.** Using the CLI must not need a skill installed. `recognizer --help` is short: every command with one line. `recognizer help <command>` and `<command> --help` are complete: arguments, what is printed with and without `--json`, exit codes, and one or two real examples. The help is generated from the same command table the CLI dispatches from, so it cannot drift from the commands. It is accepted when an agent given only the help output builds a described view correctly.

### A module's responsibility

Each module has a generated one-line statement of what it is for, shown at the top of the inspector's Contents and marked as generated.

- **Who writes it.** A repository registers a describer in `.recognizer/config.yaml`: the command that writes a line, such as a model's CLI with a fixed prompt, and a version naming that prompt. Recognizer runs it and stays independent of any model. It gives the describer the module's outline from the scan (its members and signatures, what it uses and what uses it) and its source, and takes back one line. The line says what the module does from its code, never from a docstring or a comment.
- **When.** Never on its own, because every line is a model call. `recognizer describe` describes every module whose line is missing or out of date and leaves the rest; `recognizer describe <module>...` describes the named ones; `--all` describes everything. A person, a scheduled CI run or an agent runs it. The scan never describes, so scanning stays fast and repeatable.
- **Where.** Committed, at `.recognizer/responsibilities.json`: each module's id mapped to its line, the hash of the module's source it was written from, and the describer and version that wrote it. One run pays for each line and everyone shares it, lines are reviewed in pull requests like any other text, and a fresh clone has them at once.
- **Only regenerated when needed.** A line is current while the module's source hash and the describer and version both match. Editing the module, or changing the describer or its version, makes its line out of date; a change in another module does not, because a module's responsibility is its own. `describe` redoes exactly the out-of-date lines.
- **In the app.** Contents shows the current line marked as generated. An out-of-date line is shown dimmed and marked out of date, with a button that describes that one module; a module with no line says so. The app never describes anything unasked.

### Repository layout

One repository with a directory per part, so every scanner is tested against the same schema and fixtures in one CI run:

```text
schema/               the scan document's JSON Schema and example scans
check/                CLI and library: recognizer check
scanners/python/      CLI: recognizer-scan-python
scanners/typescript/  CLI: recognizer-scan-typescript
scanners/kotlin/      after the tree-sitter spike
app/                  the Tauri viewer
fixtures/             small sample codebases per language, each with its expected scan
```

CI runs a job per directory, triggered by changes to its path.

### Files in a scanned repository

Everything the repository's owners write is committed under `.recognizer/`; anything derived is cached and gitignored.

| What | Where | Committed |
| --- | --- | --- |
| Policy: levels, components, foreign libraries, ignores | `.recognizer/policy.*` | yes |
| Proposed structures | `.recognizer/proposals/` | yes |
| Ratchet baselines | `.recognizer/baselines/` | yes |
| Saved views | `.recognizer/views/` | yes |
| Scan results | `.recognizer/cache/` | no |
| Tooling configuration: registered overlays and the describer | `.recognizer/config.yaml` | yes |
| Module responsibilities | `.recognizer/responsibilities.json` | yes |
| Health overlays (complexity, coverage, mutation) | `.recognizer/cache/overlays/` | no, unless a project opts in to committing a mutation snapshot keyed by commit |

Scans are not stored for change detection: comparing two commits means scanning both.

### Policy

The one file a repository's owners write, at `.recognizer/policy.yaml`. YAML, because people write it and comments matter. Components are assigned by path, so the same policy shape works in every language.

```yaml
levels: # optional; inner first; a component may depend on itself or any inner one
  - domain
  - ports
  - application
  - adapters
  - entry

components: # which paths belong to which component
  domain: lightcycle/domain/**
  ports: lightcycle/ports/**
  application: lightcycle/application/**
  adapters: lightcycle/adapters/**
  entry: [lightcycle/container.py, lightcycle/cli.py]

forbid: # rules the other forms cannot express
  - lightcycle/adapters/* -> lightcycle/adapters/*
  - "* -> lightcycle/adapters/tui/**"

foreign: # group external libraries
  stdlib: [os, subprocess, sqlite3]

ignore: [tests/**, "**/fixtures/**"]
```

- **The dependency rule comes from `levels` and `uses`.** An edge between two components in `levels` from inner to outer is a violation: drawn red, and counted by the ratchet. `uses` maps a component to the components it may depend on, and permits an edge the order forbids; an edge between two different components that neither form permits is a violation.
- **`forbid` covers what the other forms cannot express**, such as adapters calling each other.
- **There is no allow list.** A way to mark an edge as acceptable becomes a place for violations to hide. An existing violation goes in the ratchet baseline (`.recognizer/baselines/`), where it is counted and may only shrink, never into the policy.
- **The level order is one rule form, not the only one.** The general form is named components with the dependencies each may have (Principles: every dependence is justified by purpose). `levels` and `uses` are both optional and may be combined: a policy with `levels` only is the level order, with `uses` only is an explicit dependency table, and with neither checks only `forbid`. Starter policies for each form live in `policies/`.

### Scan document

Each scanner emits one JSON document per language, with `schema_version` (an integer, bumped only on a breaking change; a consumer refuses a version it does not know), the scanner's name and version, the commit scanned, and four lists:

- **`modules`**: one per box. `id` is the repository-relative path with forward slashes and no leading `./`; for Kotlin, the package's directory path. `language` sits on the module, not the document. `kind` is `module`, `package` or `interface` (a module whose exports are only abstractions). `members` lists the classes and functions it contains: `name`, `kind` (`class`, `function`, `interface`, `type`, `constant`), `line`, `exported`, and the outline the inspector shows: a class's bases, its fields with their types and its methods; a function's or method's parameter names and return type; a constant's value, shortened.
- **`edges`**: module to module, `from` and `to` by module id, `kind` is `depends`, `inherits` or `implements`, and `line` is where in `from` it comes from, so a violation is clickable. `inherits` and `implements` also carry the two member names (`member`, `to_member`) for the viewer's drill-down.
  - **A `depends` edge points at the module that defines what is used.** It lists the imported `names`, and each name is followed through re-exporting files (a Python `__init__.py`, a TypeScript `index.ts`) to the module that defines it, which is `to`; the files it passed through are `via`, in order. An import of names from two defining modules is two edges. Without this, every user of a package's re-exports appears to depend on the whole package, and the real dependents of a module are hidden.
  - **An `inferred` edge is a dependency the imports do not show.** Where a parameter has no type (a constructor's collaborator, a function's argument), the scanner collects the methods called on it and finds the classes that define all of them, inherited methods included. When few classes match, preferring abstract ones (a Protocol, an ABC, an interface), it emits a `depends` edge to the defining module with `inferred` holding the evidence: the parameter, the methods called, the matched class and its known implementations. Too many matches, or only generic method names, emit nothing. An inferred edge is always drawn and reported as inferred.
- **`calls`**: member to member, by `module::Qualified.name`, with `line` and `how`: `call`, `construct`, `inferred` (the receiver's class found as for an inferred edge) or `dispatch` (an abstract method to the concrete methods that implement it). A call through a port is followed by dispatch to the adapter, so a member's callers include those that reach it through an abstraction. Calls are what an agent traces a feature with, and what the inspector's callers come from.
- **`foreign`**: external libraries, each a node with id `foreign:<name>`, which edges point at; `name` is what the policy's `foreign` groups match on.

The document is facts about the code only: no policy, layout, colours or violation flags. `check` computes violations from the scan and the policy. A repository with more than one language gets one scan per language; merging them is the consumer's job.

```json
{
  "schema_version": 2,
  "scanner": { "name": "recognizer-scan-python", "version": "0.1.0" },
  "commit": "a1b2c3d",
  "modules": [
    {
      "id": "lightcycle/domain/item.py",
      "language": "python",
      "kind": "module",
      "members": [
        { "name": "Item", "kind": "class", "line": 12, "exported": true },
        { "name": "new_item", "kind": "function", "line": 40, "exported": true }
      ]
    }
  ],
  "edges": [
    {
      "from": "lightcycle/application/claim.py",
      "to": "lightcycle/domain/work/item.py",
      "kind": "depends",
      "line": 3,
      "names": ["Item"],
      "via": ["lightcycle/domain/work/__init__.py"]
    },
    {
      "from": "lightcycle/application/create_item.py",
      "to": "lightcycle/ports/store.py",
      "kind": "depends",
      "line": 14,
      "names": ["add_artifact", "create_item"],
      "inferred": {
        "parameter": "store",
        "methods": ["add_artifact", "create_item"],
        "class": "StorePort",
        "implementations": ["SqliteStore"]
      }
    },
    {
      "from": "lightcycle/adapters/sqlite_store.py",
      "to": "lightcycle/ports/store.py",
      "kind": "implements",
      "member": "SqliteStore",
      "to_member": "Store",
      "line": 9
    },
    {
      "from": "lightcycle/adapters/sqlite_store.py",
      "to": "foreign:sqlite3",
      "kind": "depends",
      "line": 1
    }
  ],
  "calls": [
    {
      "from": "lightcycle/commands/intake.py::cmd_new",
      "to": "lightcycle/application/create_item.py::CreateItemUseCase.execute",
      "line": 70,
      "how": "call"
    }
  ],
  "foreign": [{ "id": "foreign:sqlite3", "name": "sqlite3" }]
}
```

### Toolchains and CI

Each part carries only its own toolchain; no part needs more than one language.

- `scanners/python/`: its own `pyproject.toml`, hatchling build, `requires-python >= 3.11`, uv for the dev venv and lockfile, ruff and pytest. Installable with `uvx` or `pipx`, so an audit needs no checkout.
- `scanners/typescript/` and `app/`: npm workspaces at the repository root, Node 22 in CI with `engines >= 22`, TypeScript 5.9, vitest, biome for lint and format. Prettier (`--prose-wrap=never`) and markdownlint-cli2 at the root for markdown only.
- `app/`: `app/src-tauri` with Tauri 2, Rust stable, edition 2021, `@tauri-apps/cli` in the workspace. CI installs the webkit2gtk system libraries and caches the Rust build.
- `schema/`: JSON Schema 2020-12. No separate validator job: each scanner's tests validate its fixture output against the schema (`jsonschema` in Python, `ajv` in TypeScript), so a schema edit is checked by every scanner.
- Kotlin's toolchain is decided by the spike.

CI is one workflow file per directory, filtered on that directory's path plus `schema/**` and `fixtures/**`: a schema or fixture change runs every scanner, a scanner change runs only itself.

### Where policy checking lives

`recognizer check` is TypeScript in the npm workspace, at `check/`. It reads a scan (JSON) and, optionally, a policy (YAML), and reports two categories of finding: violations and warnings (below). Without a policy only warnings are reported. It ships two ways: as a CLI (`npx recognizer check`) for any repository's CI and for audit workers, and as a library the viewer imports, so the picture is coloured by the exact code CI runs. It emits JSON (each violating edge, the baseline delta) and a human summary, and exits non-zero on growth. The baseline file format under `.recognizer/baselines/` is defined with it.

### Principles

Hexagonal, clean and onion architecture are each one arrangement of the same few principles, drawn from Martin, Fowler, Evans, Parnas and Jackson. Recognizer works from the principles, never from a named architecture: a structural warning is a principle violation, reported as a candidate with its evidence attached, never as a verdict. The scan supplies the facts; the policy declares the intent the facts cannot carry.

| Principle | Warning | Needs from the policy |
| --- | --- | --- |
| Dependencies point toward stability | an edge from a more stable component to a less stable one; a component whose measured instability disagrees with its declared place | which components are meant to be stable |
| Depend on abstractions across a boundary | a concrete cross-boundary edge; a stable component that is mostly concrete | component boundaries |
| Policy code is isolated from mechanism | IO, environment, time or framework reached from policy code | which components hold policy, which foreign groups are mechanism |
| No cycles | a dependency cycle | nothing |
| Things that change together live together | co-change across a component boundary (from the git overlay) | component boundaries |
| Every dependence is justified by purpose | an edge no declared relationship requires | permitted dependencies between components |
| Each rule has one home | structural duplication (from the duplication overlay) | nothing |
| Interfaces are narrow and explicit | a hub with high fan-in and fan-out; a wide exported surface | nothing; candidates only |

Metrics derived from the scan graph alone (fan-in, fan-out, cycles, instability, abstractness, distance from the main sequence) are structural facts and are computed by recognizer. Anything measured by running something (tests, mutation, duplication, git history) arrives as an overlay.

A named architecture is a policy template: a starter `.recognizer/policy.yaml` under `policies/` in this repository, copied into a scanned repository and edited there. Recognizer has no setting that names an architecture and never reads anything but the policy in front of it.

### Violations and warnings

Recognizer's outputs are sensors, in three layers, and `recognizer check` reports all of them in one run:

- **Violations** are the policy's verdicts: an edge that breaks a rule the policy declares. The baseline ratchets them and CI fails on growth. Only violations affect the exit code.
- **Graph metrics** are structural facts computed from the scan alone: fan-in, fan-out, strongly connected components, instability, abstractness, distance from the main sequence.
- **Warnings** are heuristics over the graph: a threshold or pattern tied to one principle in the table above, reported as a candidate with its evidence. A warning is never baselined and never fails a run. Its thresholds are command-line flags whose defaults are documented and printed in the output. A warning confirmed often enough is promoted to a rule in the policy; a violation baselined and never shrinking is a question about the policy.

Every warning carries what a coach needs and never the number alone: the principle it suspects, the evidence (the modules, edges and members that triggered it) and a stable fix-pattern identifier. A bare metric invites gaming the number rather than fixing the design; habit-hooks' pre-registered evaluation measured a genuine fix in under six percent of trials from a bare complexity message and over eighty percent from a coaching message naming the cue and the action. The coaching text itself lives outside recognizer: a habit-hooks plugin wrapping `recognizer check`, or a guidance entry keyed on the fix-pattern id, is a consumer of the format in the same loose relationship as an overlay converter. The plugin is a spike once warnings exist.

The baseline is keyed by violation identity across the whole repository. A later item adds a change scope to `check`, reporting only what the modules touched on a branch introduce, which is what an agent loop acts on.

### Overlays

Recognizer never measures: the measuring is done by tools a repository chooses, and recognizer runs them, as `recognizer scan` runs each language's scanner, and reads what they write. It owns the overlay format and the registration, never a metric's meaning. Converters from a tool's native report (coverage, complexity, mutation, duplication, git churn and co-change) are separate tools with no dependency on recognizer beyond the format.

- **Registration.** A repository registers its overlays in `.recognizer/config.yaml`, the one committed file for a repository's recognizer tooling (the policy stays in `policy.yaml`, because it is about architecture, not tooling). Each overlay has a name, the command that produces it, and the metrics it declares. The command is run from the repository root with three values filled in: the repository's path, the commit, and the output path in the cache. It writes one overlay file to that path, and nothing else is read from it.
- **Running.** `recognizer measure` runs every registered overlay; `recognizer measure <name>...` runs the named ones. Each command's exit status and the output file are checked: a failed command or a file that does not match the format is reported by name and leaves no overlay behind. A command run on a working tree with uncommitted changes records that, and its overlay is marked as from a modified tree.
- **The file.** One JSON file per overlay at `.recognizer/cache/overlays/<name>.json`: `overlay_version`, `commit`, `modified` (true when the working tree had uncommitted changes), `producer` (name and version), `metrics`, and `values`. Each metric declares its `name`, its `type` (`ratio`, `count`, `number` or `boolean`), its `granularity` (`module` or `member`), and which direction is bad (`bad: high` or `bad: low`). `values` maps each metric name to an object keyed by the scan's own ids: a module's id, or for a member the module's id, `::`, and the member's name, with a method as `Class.method`. A converter matches the scan's ids; the viewer never guesses. Well-known metric names have documented shapes but are not the only ones allowed.
- **Freshness.** An overlay names the commit it measured; one whose commit differs from the scan's is drawn as missing, and one from a modified tree says so. A module or member with no value is unknown. Missing data is unknown, never healthy.

How overlays are painted, and whether the app runs them, is decided under Overlays in the viewer.

### Prior art

Robert C. Martin's uml-viewer is a reference for approach only. It states no licence, so none of its code is copied or ported; its published rules (what counts as an edge, what to skip, how interfaces are marked) may be followed.

## Open

Decide these with Ken one at a time, in this order, recording each under Decided before building on it.

1. **The Kotlin spike.** Prove tree-sitter-kotlin gives package-level edges good enough to use, before building the scanner.
2. **Policy axes.** Whether the policy classifies each module on independent axes, strata (responsibility layers, ruled by direction) and slices (use cases and subdomains, ruled by isolation), instead of one namespace of components. Slices by reachability from entry points fail at module level, because the composition root reaches nearly everything. Decided after examples have been explored.
3. **Structural change.** How the viewer shows a change above the level of code: files, classes, functions and constants added, modified and removed. One view serves a spec's proposed change, a pull request's actual change, the difference between what a spec proposed and what was delivered, and the difference between any two commits. A proposed change is always labelled as not in the code.
4. **Overlays in the viewer.** How metrics and churn over a period are laid over the canvas and the tree beyond the health discs, and how the viewer leads the user to a defect and draws attention to it without clutter. Whether and how the app runs registered overlays, given that some (coverage, mutation) run a whole test suite.
5. **Further warnings.** Candidates found by exploring lightcycle: a module importing another module's private names; an entity's module used far less than the port that stores its data, which suggests the port takes fields rather than the entity; a port whose methods take only primitives; a constructor whose collaborators have no type. Each needs a principle, evidence and a fix-pattern id before it joins `check`.
6. **The rail's further panels.** Saved views, the window's history, and scan history (when each scan ran, at which commit, for which languages, and what it skipped or could not read), each as a panel on the rail: what each shows and does, and what moves into it from the view bar.

## First build items

In this order, each with fixtures and tests:

1. The schema, example scans, and the Python scanner, run against lightcycle (`kenmclennan/lightcycle`, a hexagonal Python codebase).
2. `recognizer check` against a policy for lightcycle, reporting its wrong-way edges.
3. The TypeScript scanner, run against Saga and the knowledgebase explorer, both npm workspaces with path aliases.
4. The scan document's version 2 (names, routes through re-exports, inferred edges) in the Python and TypeScript scanners, then `recognizer scan`.
5. Member outlines and calls in the Python and TypeScript scanners.
6. The viewer's first version, as described under Explorer, in phases: the app from the template, opening and scanning a repository, and the tree with its discs; the canvas with its frames, edges, legend, zoom and selection bar; the picker; the inspector; saved views, with the CLI's view and question commands and their help.
7. The Kotlin spike, then the Kotlin scanner.
