# Glossary

The words recognizer's code, docs and interface use. A term is added here before it is used, and a term used differently from its entry is a defect in one or the other.

## The code being scanned

| Term | Meaning |
| --- | --- |
| Repository | The codebase being scanned: one git repository, possibly in several languages. |
| Module | One box: a source file (a Rust source file included), or a package for Kotlin. Identified by its repository-relative path. |
| Crate | A Cargo package's library or binary target. The Rust scanner finds crates from `Cargo.toml` files, starts each module tree at the crate's root file and treats a crate in the repository, reached by a path dependency, as in-repo and any other as foreign. |
| Folder | A directory of the repository, as the tree shows it. Not a component: a folder is where files are, not what they are for. |
| Member | A class, function, interface, type or constant defined in a module. |
| Call | A member using another member: calling it, constructing it, or reaching it through an abstraction by dispatch. |
| Outline | What a member contains, read from its declaration: a class's bases, fields, methods and tags, a function's parameters and return type, a constant's value. |
| Class tag | One of `dataclass`, `frozen`, `final`, `runtime_checkable` or `abstract` on a class or interface, read from its decorators or modifiers and shown in Contents beside the class name. |
| Visibility | A Kotlin member's declared access modifier: `public`, `protected`, `internal` or `private`. A member is exported unless it is private. |
| Unresolved import | A Kotlin import whose name is declared in no scanned file but whose package is under an in-repo package prefix, such as generated code. Recorded in the scan so it is never dropped silently. |
| Dispatch | A call from an abstract or interface method to each concrete method that implements it, so a caller that reaches a port also reaches its adapter. |
| Trace | The calls followed from one member, which is how an agent finds what a feature touches. Never drawn on the canvas. |
| Name | A member's name as another module imports it. |
| Foreign library | Code outside the repository that a module depends on, such as `sqlite3`. |
| Re-export | A module that makes another module's names importable from itself, such as a Python `__init__.py` or a TypeScript `index.ts`. |
| Dependency | An edge from a module to the module that defines a name it uses. |
| Dependent | A module on the other end of a dependency: the one that uses. |
| Route | The re-exports a name passed through on its way from its defining module to the module that imports it. Stored as `via`. |
| Generic method | A method name too common to identify a class, such as `get`. The scanners ignore an untyped parameter whose called methods are all generic. |
| Inferred dependency | A dependency found from the methods called on an untyped parameter, not from an import. Always shown as inferred. |
| Composition root | The module that builds the object graph and wires adapters into what uses them; it reaches nearly everything. |

## Architecture

| Term | Meaning |
| --- | --- |
| Component | A named set of modules, declared in a policy by path. |
| Stratum | A horizontal layer of responsibility, such as domain, application or adapters. |
| Slice | A vertical cut through the strata that makes one use case or feature work, from the thing that drives it to the things it drives. |
| Policy | The one file a repository's owners write to declare components and the dependencies they may have. |
| Violation | An edge that breaks a rule the policy declares. Baselined; the only finding that fails a run. |
| Warning | A heuristic over the graph, tied to a principle and carrying its evidence. Never baselined, never fails a run. |
| Baseline | The recorded violations a repository has accepted for now; it may only shrink. |
| Overlay | Measurements from a tool a repository registers (coverage, churn, mutation), written as one file per overlay to `.recognizer/cache/overlays/` and painted onto modules and members. |
| Responsibility | A module's generated one-line statement of what it is for, committed in `.recognizer/responsibilities.json` and current while its source and describer are unchanged. |
| Describer | The command a repository registers in its config to write responsibilities. |
| Describer registration | The `describer` key of the Config: the command to run, with `{repository}`, `{module}` and `{request}` filled in, and a version naming its prompt. |
| Current line | A Responsibility whose source hash, describer and version all match the module and the registration today. |
| Out of date | A Responsibility that is not a Current line: its module's source (the files the scan recorded for it), the describer command or the version has changed since it was written. |
| Unchecked | The status of a Responsibility that exists but whose Current line test cannot run, because no Describer registration exists or the module's source cannot be read. |
| Overlay registration | An entry of the Config's `overlays` key: an overlay's name, the command to run with `{repository}`, `{commit}` and `{output}` filled in, and its Metric declarations. |
| Producer | The tool that wrote an Overlay file, named with its version in the file's `producer`. |
| Metric declaration | A metric's `name`, `type`, `granularity` and `bad` direction, registered in the Config and repeated in the Overlay file. |
| Config | A repository's committed `.recognizer/config.yaml`, which registers its overlays and holds its other recognizer tooling settings. The policy is separate. |
| Command table | `COMMANDS` in `check/src/commands.ts`: the one list `recognizer` dispatches from and generates its help from. |
| Freshness | Whether the cached scans can be used: they were taken at the current commit from a clean working tree, and the scanned files still hash the same. Otherwise `recognizer scan` runs first. |
| Scanner | A language's standalone command that emits a scan. |
| Toolchain | The `recognizer` command, the scanners and the app, versioned and installed together. Out of step: the app and the installed `recognizer` command report different versions, which the app's footer says. |
| Scan | The document a scanner emits: modules, edges and foreign nodes for one language, the files it read and the selection it used. |
| Scanned file | A file a scanner read, recorded in the scan's `files` with the SHA-256 of its bytes. |
| Selection | A scanner's rule for choosing files, recorded in the scan as data: extensions, skipped directories and skipped file globs. A consumer applies it to a path the scan has not seen. |
| Baseline | What the viewer holds of a scan's files: each file's recorded hash and the scan's selection, with the commit and branch taken just before the scan. Changed since compares the folder against it. |
| Changed since | The viewer's report of what differs from the scan on screen: an edited, added or deleted file the scanners read, or a moved commit or branch. An edit undone again does not count. |
| Rescan | Running the scan again on request, from the footer, File > Rescan or Cmd-R. It keeps the view state; nothing rescans on its own. |
| Cache | A repository's gitignored `.recognizer/cache/`, where scans and overlays are written. |

## The viewer

| Term | Meaning |
| --- | --- |
| Tree | The left area: the repository's folders and files, each with its health disc. The way in. |
| Canvas | The centre area: the modules the user has opened, inside their frames, and the edges between them. |
| Inspector | The right area, closed by default: what is in the selection, its findings, or an edge's evidence. |
| Frame | The box on the canvas for exactly one folder, which may be a compacted folder, labelled with its joined path, holding that folder's open modules and the frames of its open subfolders. |
| Compacted folder | A chain of folders that hold no scanned file and exactly one subfolder, merged with the folder that ends the chain and identified by that deepest path; it is one frame on the canvas and one row in the tree, labelled with the joined path. |
| Open | On the canvas. A module is opened from the tree or by following an edge, and closed the same way. |
| Selection | The one module, folder or edge the user has picked, highlighted in the tree and shown in the inspector. |
| Selection bar | The small bar of icon actions shown above the selection while the pointer is over it; right-clicking opens the same bar. |
| Settings | The app's own preferences (the editor, the `recognizer` command path), set in its settings window; distinct from a repository's Config. |
| Editor | The program Open in Editor launches, named in Settings as blank (the system default), an app's name or a shell command. |
| Picker | The inspector's Dependencies tab: its Uses and Used by sections list what the selection uses and what uses it, grouped by folder, to put on the canvas. |
| Trail | The inspector panels opened by following modules through their Dependencies, one to the right of the next, with breadcrumbs naming each step. |
| Strip | A narrow vertical column naming a trail panel that is folded out of view, to the left of the shown panels or, once an earlier one is brought back, to their right. Clicking it brings the panel back. |
| Breadcrumbs | The row above a trail's panels naming each module in the trail and each step's relationship (uses or used by), with the route icon that puts the whole trail on the canvas at its end. |
| Fold | Drawing an open folder as one box, which keeps its health disc and takes the edges to anything inside it. |
| Contents | A module's responsibility line and its members as cards in file order, or a folder's files. |
| Card | A member shown in Contents with its label, line and code. |
| Show private | The remembered switch that adds non-exported members and private fields and methods to Contents. |
| Health disc | A dot on each file, folder and box: green fine, amber a warning, red a violation, a grey ring not measured. A folder shows the worst inside it. |
| Finding | A violation or warning attached to a module, with the one-line reason a health disc shows. |
| Needs attention | The tree filter that keeps only modules with an amber or red disc. |
| Focus | Narrowing the canvas to one folder's files. |
| Legend | The panel on the canvas, opened from its bottom-right controls, that names every edge style, every disc and what a frame's and a box's figures count, and holds the inferred-edges switch. |
| Box | What the canvas draws for a module, or for a folded folder: its disc, its name and its figures. |
| Private-name import | An import of a name the target module does not export. Drawn dashed. |
| Evidence | Why an edge exists: the quoted source line, the names, the route, or what an inferred edge was inferred from. |
| View state | Everything that decides what the user sees, as one record. Each change makes a new one; it lasts only as long as the window. |
| History | The sequence of view states the user has moved through in a window; back and forward walk it. It is never saved. |
| Rail | The thin strip of icons at the window's far left, one per left-hand panel; an icon opens its panel, or closes it when it is open. |
| Files panel | The rail's panel holding the tree. |
| Saved view | A named view committed at `.recognizer/views/<name>.json`: its description, the commit it was saved at, its steps and its notes. |
| Note | A text a person or an agent attaches to a saved view or to one module in it, with the name of who wrote it. |
| Description | A saved view's required one- or two-sentence statement of what it shows. |
| Step | One entry in a saved view, replayed on opening: a pick, a rule, a fold, a focus, or a module left out. |
| Pick | A step naming one module by path. Everything the user adds in the app is recorded as picks. |
| Rule | A step naming a relationship (a folder's files, what a module uses or is used by), re-evaluated on every opening. |
| Stale view | A saved view the code has moved on from: a pick that is missing, changed relations, or newly relevant modules. |
| Left out | A step recording that a rule put a module on a view and the user took it off. A pick is never removed by a left-out; only modules a rule contributed are. |
| Resolution | A view's steps evaluated against a scan: the modules, folds and focus they give, and the steps that name a path that is gone. |
| Current view | The file `.recognizer/cache/current-view.json` the app writes on every change to say what the window shows: the open view's name, the modules on the canvas, folds, focus and selection. |
| Link | A `recognizer://open?repo=<absolute path>[&view=<name>]` address of a repository and, optionally, one of its saved views. Opening one opens the folder and the view, or focuses the window already showing the folder; it never runs a command, scans, describes or writes. |
| View bar | The control group at the canvas's top left: back and forward over the history, the open view's name with the saved views to open, Save and Copy link. |
