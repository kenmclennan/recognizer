# Glossary

The words recognizer's code, docs and interface use. A term is added here before it is used, and a term used differently from its entry is a defect in one or the other.

## The code being scanned

| Term | Meaning |
| --- | --- |
| Repository | The codebase being scanned: one git repository, possibly in several languages. |
| Module | One box: a source file. Identified by its repository-relative path. |
| Markup file | A `.razor`, `.cshtml` or `.xaml` file the C# scanner reads. It is not a module and has no box; the types it names become `depends` edges from its code-behind module, or from the nearest module that declares a type. |
| Crate | A Cargo package's library or binary target. The Rust scanner finds crates from `Cargo.toml` files, starts each module tree at the crate's root file and treats a crate in the repository, reached by a path dependency, as in-repo and any other as foreign. |
| Folder | A directory of the repository, as the tree shows it. Not a component: a folder is where files are, not what they are for. |
| Member | A class, function, interface, type or constant defined in a module. |
| Call | A member using another member: calling it, constructing it, or reaching it through an abstraction by dispatch. |
| Outline | What a member contains, read from its declaration: a class's bases, fields, methods and tags, a function's parameters and return type, a constant's value. |
| Class tag | One of `dataclass`, `frozen`, `final`, `runtime_checkable` or `abstract` on a class or interface, read from its decorators or modifiers and shown in Contents beside the class name. `abstract` is also set on a Kotlin `abstract class` and on a TypeScript type alias that can be implemented. |
| Abstract member | An exported member that can stand in for an implementation: an interface, an abstract class, or a type alias that can be implemented (a function or constructor type, or an object type declaring a method or call signature), as each scanner records it. Data shapes, literal and union types, mapped and utility types, constants, enums and ordinary classes are not. |
| Visibility | A Kotlin or C# member's declared access modifier: `public`, `protected`, `internal` or `private` (a C# `file` type is recorded as `private`). A member is exported unless it is private. |
| Unresolved import | A Kotlin import, or a C# `using`, whose name is declared in no scanned file but whose package or namespace is under an in-repo prefix, such as generated code. Recorded in the scan so it is never dropped silently. |
| Skip paths | The optional `selection` list of repository-relative directories a scanner skipped for a reason a glob cannot express, such as a C# test project found by reading its `.csproj`. The change view treats files under them as unscanned, not added. |
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
| Overlay | Measurements a sensor writes (coverage, churn, mutation), as one file per overlay to `.recognizer/cache/overlays/` and painted onto modules and members. |
| Inputs | The `inputs` key of an overlay or findings file: each module the sensor measured, mapped to the file hash the scan recorded for it. Never recomputed from disk. |
| Tests hash | The `tests` key of an overlay or findings file from a sensor that depends on tests: a sha256 over every test file's path and hash, sorted by path. |
| Current result | A result (an overlay value or a finding) whose measured modules still have the hash `inputs` records and, for a sensor that depends on tests, whose `tests` matches the repository's present test files. Anything else is out of date and shown nowhere. |
| Bring up to date | The default of the Scan panel's "Results" switch. A run does only the out-of-date and missing work and keeps every current result: a sensor whose results are all current for the scope is skipped, Descriptions and Mutation run on the out-of-date and missing modules, and any other sensor reruns whole when a module in scope is out of date. |
| Rescan from scratch | The other setting of the "Results" switch. A run reruns every ticked sensor over the scope, describes every module (`--describe=all`) and replaces the sensors' results; Mutation still reuses a verdict whose function body and covering tests are unchanged. |
| Freshness report | The block at the top of the Scan panel for the chosen scope, over the ticked rows: "Complete picture" when every ticked result is current, otherwise "Partial picture" with the count of out-of-date modules, which ones, the sensors that have never run, and a bar of current against out-of-date modules. Each row carries its own count. |
| Metrics list | The canvas control, before Legend, that lists every metric of the current overlays and ticks the ones shown as bars on the boxes; it controls the canvas only. |
| Metric bar | A row on a module box, one per ticked metric the module has a value for, in tick order: a short label, a track, a fill in the tone colour and the figure; a member-granularity metric shows the box's worst member; hover names it. A folder box and a module the overlay did not measure show no row. |
| Thresholds sensor | The shipped sensor that turns any overlay metric over a configured line into a finding, a warning or a violation as `sensors.thresholds` says. |
| Report | A findings file an agent hands to recognizer with `recognizer report --as <name>` after a review it ran itself; listed with the sensors but never run by a scan, stale once the scan passes its commit, replaced only by the next report under the same name. |
| Responsibility | A module's generated one-line statement of what it is for, committed in `.recognizer/responsibilities.json` and current while its source and describer are unchanged. |
| Describer | The command a repository registers in its config to write responsibilities. |
| Describer registration | The `describer` key of the Config: the command to run, with `{repository}`, `{module}`, `{model}` and `{request}` filled in, and a version naming its prompt, recorded bare: the model is not part of it. A Config without one falls back to the Describer in effect. |
| Describing settings | The model and the Batch size, global to the user, held under `describing` in the app's `config.json`, seeded as `haiku` and 4 and edited in Settings; a scan from the app and one from a terminal read the same values. |
| Batch size | How many modules are described at once; the describe phase keeps that many describer runs going. |
| Describer in effect | The Config's describer when it has one, otherwise the shipped `recognizer-describe-claude` with its prompt version, as `recognizer describe --describer` reports. |
| Current line | A Responsibility whose source hash, describer and version all match the module and the Describer in effect today; the model that wrote it is not compared. |
| Out of date | A Responsibility that is not a Current line: its module's source (the files the scan recorded for it), the describer command or the version has changed since it was written. |
| Unchecked | The status of a Responsibility that exists but whose Current line test cannot run, because no Describer registration exists or the module's source cannot be read. |
| Overlay registration | An entry of the Config's `overlays` key: an overlay's name, the command to run with `{repository}`, `{commit}` and `{output}` filled in, its Metric declarations and, optionally, `runs_tests: true` when it runs the repository's tests. |
| Sensor | A program that reads the scans, the policy, the overlays or the repository and writes a findings file; it never runs the code it judges. Recognizer ships the structure sensor and a repository registers others. |
| Sensor registration | An entry of the Config's `sensors` key: a sensor's name and the command to run with `{repository}`, `{commit}` and `{output}` filled in, or for the structure sensor its settings, or `off`. |
| Sensor progress | The message a sensor prints while it runs, which the CLI passes through `--json` and the app shows on the progress line. |
| Folder cycle | Two folders whose modules import each other in both directions; one `folder_cycle` warning per folder pair. |
| Orphan | A module nothing imports that is not an entry point; reported as an `orphan` warning. |
| Entry point | A module that need not be imported: one a policy entry names literally, a test file by convention, an index-like file (`index`, `__init__`, `main`, `mod`, `lib`) or one matched by a glob in `warnings.orphan.entry_points`, or a module its scanner marks as run rather than imported (Python: a package's `__main__.py` or a module with a top-level `__name__` guard). |
| Policy drift | A policy entry that matches no scanned module, or a scanned folder no policy component covers; reported as a `policy_drift` warning. |
| Folder metrics | Per folder that holds scanned modules, Martin's package numbers computed from the scan and the policy alone: afferent coupling (modules outside that import modules inside), efferent coupling (modules inside that import outside), instability, abstractness (the share of exported members that are abstract members) and distance. Written in the check report's `folder_metrics`, never as findings. |
| Main sequence | The line where a folder's abstractness plus its instability is 1. Distance is how far a folder is from it: `abs(abstractness + instability - 1)`. |
| Pain zone | A folder whose abstractness plus instability is below 1 and whose distance is over the threshold: stable and concrete, hard to change and with nothing to extend. |
| Useless zone | A folder whose abstractness plus instability is above 1 and whose distance is over the threshold: unstable and abstract, abstractions few depend on. |
| Structure sensor | Recognizer's own sensor: the policy's violations, the warnings derived from the graph alone (cycles, hubs, folder cycles, orphans, policy drift, stable dependencies, stable abstractions and, off by default, unused exports) and the graph and folder metrics. On unless the Config turns it off. |
| Shipped sensor | A sensor recognizer writes and releases with the toolchain in `sensors/`, run by `recognizer-sensors <name>` and by `recognizer scan --sense <name>` whether or not the config registers it; a config entry carries settings only. One run measures what it needs and judges it: duplication, CRAP, mutation and thresholds. |
| CRAP sensor | The shipped sensor that runs the repository's tests under the language's coverage tool (a Language profile, or the `test_command` setting), scores each function `cc^2 * (1 - coverage)^3 + cc` from its cyclomatic complexity and the coverage of its lines, warns at or above `threshold` (30 by default) with the fix pattern `simplify-or-test`, and writes the per-function numbers as an overlay in the same run; a function with unknown coverage is never scored as zero. A failing test command does not end the run: the results are kept and the document carries a Diagnosis of `tests-failed`, and when no coverage can be produced the sensor reports complexity alone with a Diagnosis of `coverage-unavailable`. |
| Diagnosis | The one object (`code`, `line`, optional `fix`, optional `failing` with `count` and at most five `names`) that says why a sensor could not do everything it was asked to. `code` is `tool-missing`, `tests-failed` or `coverage-unavailable`; `line` is the complete one-line sentence with the fix in it. A completed C.R.A.P. run carries it in the findings document, a Refusal carries it on the `recognizer-reason` stderr line, and the run log entry records it. |
| Refusal | The end of a sensor run that cannot proceed for a toolchain cause (a red suite before Mutation, no coverage for Mutation, a test program that does not start): the sensor writes no document, exits `2`, and prints the `recognizer-reason` line with its Diagnosis, then the plain `line`. |
| Cyclomatic complexity | One plus the branch points in a function's own body (conditions, loops, match arms, catches, the boolean operators "and" and "or", and in TypeScript the nullish and optional-chain operators), counted from the syntax tree. |
| Duplication sensor | The first shipped sensor: it reports each duplication family, and so each pair, of functions in the same language whose structural fingerprints are alike (Jaccard similarity at or above `threshold`, 0.82 by default) as one `duplication` warning on every member's module, with the fix pattern `extract-shared-function`. |
| Duplication family | A set of functions linked by over-threshold pairs (the connected component of the pair graph), reported as one finding listing every member; its similarity is the lowest linking pair's, and a plain pair is a family of two. |
| Structural fingerprint | The set of SHA-1 hashes of every subtree, cut at depth 3, of a function's normalised syntax tree (local names, parameter names, field names and literals replaced by kind tokens; call names, operators and shape kept); two functions are compared by the Jaccard similarity of their sets. |
| Language profile | The per-language row in the Python package `testrun/`: the command that runs the tests and leaves a coverage report, the report it leaves and its format (LCOV or JaCoCo), and the plain test command a Mutant run uses. Python picks `uv run`, `poetry run` or `python3 -m` from the lockfile at the repository root. |
| Mutation record | The file beside the survivors file in which the Mutation sensor keeps, per function, a hash of its body and, per mutation site, the verdict, the test files that ran it and its Killer, each with its hash, with a hash of the test command and of the Test support files; a rerun reuses each site on its own while its function's body and the files that bear on it are unchanged, and runs the rest. |
| Killer | The test files the runner reported failing for a mutant that was killed, with the `conftest.py` files on their paths; a killed site is reused while the hash of every Killer file is unchanged. |
| Test support files | The test files that are neither a test entry nor a `conftest.py`, such as helpers and data under a test directory; the Mutation record keeps one hash of them, and any change to it voids all reuse because the sensor cannot say which tests use them. |
| Budget | A Mutation sensor's `max_minutes` ceiling, counted from the first mutant (the coverage pass is outside it): no function starts once it is spent, and a function left unstarted is skipped, absent from the overlay and listed in the survivors file as `uncovered-by-budget`; the next run queues it first. |
| Stopped run | The Mutation run Stop ended: it keeps every function whose mutants all finished, lists the rest as skipped in the record and the survivors file, and says so in its findings document through the root key `stopped`, which the Scan panel reads as `stopped, <n> of <m> functions measured`. |
| Partial result | A Mutation run that measured fewer functions than it considered, from a Budget or a Stop, recorded in its findings document under the root key `partial` and shown in the Metrics panel as `Partial: <n> of <m> functions measured`. |
| Checkpoint | A write of everything a sensor has settled so far (overlay, findings document and any record it resumes from) while it still runs. The findings document is marked `partial`, so a run that fails, times out or is stopped keeps it as its visible result and the next run resumes from it. |
| In-file test hash | The digest of a Rust lib or bin target's unit tests - the `#[test]` and `#[cfg(test)]` items found by walking its module tree from the root file - which the Mutation sensor joins to the killer and ran sets, so an edit to an in-file test reruns the sites that target's unit group covers; a module the walk cannot resolve takes a digest of every `.rs` file under the root file's directory instead. |
| Test selection | The Mutation sensor's choice, per mutant, to run only the test files that executed the line its site is covered by instead of the whole suite; Python, TypeScript, Kotlin, C# and Rust (a unit is one cargo test target, in-file unit tests grouped per lib or bin target), and off when the repository sets `test_command`, and a selection of more than half the suite runs the whole suite instead. |
| Mutation sensor | The shipped sensor that runs the tests under coverage, mutates the covered functions, runs the tests against each Mutant and warns, per function with a Survivor, with the fix pattern `strengthen-tests`; in the same run it writes the overlay of killed, survived and uncovered counts and a score, the survivors file and the Mutation record, reusing an unchanged function's verdicts and stopping at a Budget. |
| Mutant | One copy of the repository in which a single token of a covered function is replaced by its one counterpart (`>=` by `>`, `and` by `or`, `true` by `false`), run against the repository's test command. A failing, unstartable or timed-out run kills it. |
| Survivor | A Mutant whose test run passed: the tests did not notice the change. |
| Producer | The tool that wrote an Overlay file, named with its version in the file's `producer`. |
| Metric declaration | A metric's `name`, `type`, `granularity` and `bad` direction, registered in the Config and repeated in the Overlay file. |
| Config | A repository's committed `.recognizer/config.yaml`, which registers its overlays and holds its other recognizer tooling settings. The policy is separate. |
| Command table | `COMMANDS` in `check/src/commands.ts`: the one list `recognizer` dispatches from and generates its help from. |
| Freshness | Whether the cached scans can be used: they were taken at the current commit from a clean working tree, and the scanned files still hash the same. Otherwise `recognizer scan` runs first. |
| Scanner | A language's standalone command that emits a scan. |
| Toolchain | The `recognizer` command, the scanners and the app, versioned and installed together. Out of step: the app and the installed `recognizer` command report different versions, which the app reports as a message in the message tray. |
| Scan | The document a scanner emits: modules, edges and foreign nodes for one language, the files it read and the selection it used. |
| Scanned file | A file a scanner read, recorded in the scan's `files` with the SHA-256 of its bytes. |
| Selection | A scanner's rule for choosing files, recorded in the scan as data: extensions, skipped directories and skipped file globs. A consumer applies it to a path the scan has not seen. |
| Baseline | What the viewer holds of a scan's files: each file's recorded hash and the scan's selection, with the commit and branch taken just before the scan. Changed since compares the folder against it. |
| Changed since | The viewer's report of what differs from the scan on screen: an edited, added or deleted file the scanners read, or a moved commit or branch. An edit undone again does not count. |
| Rescan | Running the scan again on request, from the Scan panel, File > Rescan or Cmd-R. It keeps the view state, and a run whose structure is unchanged updates the open view without rebuilding it; nothing rescans on its own. |
| Update in place | Handing a run's new sensor results, findings and notices to the open explorer without rebuilding it, so the canvas, camera, selection, inspector and left panel stay as they were. It applies when the scan's modules and scan documents are unchanged; a structural change rebuilds the explorer and carries the camera. |
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
| Settings | The app's own preferences (the editor), set in its settings window; distinct from a repository's Config. |
| Describe phase | The second phase of a scan, run when ticked: the modules whose line is missing or out of date are described; progress shows in the footer's scan line and the result is a message in the message tray. |
| Run log | The record of one run of a registered command (scan or describe, and measure in records written before measurers were retired; a scan record holds its extract, describe and sense phases) under `.recognizer/cache/log/`, read with `recognizer log`; the last fifty are kept. |
| Editor | The program Open in Editor launches, named in Settings as blank (the system default), an app's name or a shell command; a shell command may use `{file}` and `{line}` placeholders, for example `code -g {file}:{line}`, to open at a line. |
| Picker | The inspector's Dependencies tab: its Uses and Used by sections list what the selection uses and what uses it, grouped by folder, to put on the canvas. |
| Trail | The inspector panels opened by following modules through their Dependencies, one to the right of the next, with breadcrumbs naming each step. |
| Strip | A narrow vertical column naming a trail panel that is folded out of view, to the left of the shown panels or, once an earlier one is brought back, to their right. Clicking it brings the panel back. |
| Breadcrumbs | The row above a trail's panels naming each module in the trail and each step's relationship (uses or used by), with the route icon that puts the whole trail on the canvas at its end. |
| Fold | Drawing an open folder as one box, which keeps its health disc and takes the edges to anything inside it. |
| Contents | A module's members as cards in file order, or a folder's files. |
| Card | A member shown in Contents with its label, line and code. |
| Function length | The span from a function or method's first line to its last, shown on its inspector card as `N lines` with a bar scaled to the module's largest, banded neutral at 20 lines or fewer, long (amber) from 21 to 50 and red over 50. An indicator, not a finding: each codebase's own linters own code-quality rules. |
| Show private | The remembered switch that adds non-exported members and private fields and methods to Contents. |
| Health disc | A dot on each file, folder and box: green fine, amber a warning, red a violation, a grey ring not measured. A folder shows the worst inside it. |
| Finding | A violation or warning a sensor wrote for the current scan: a stable id, a kind, a principle, a one-line summary, its evidence by scan id and, where one is named, a fix pattern. Attached to the modules in its evidence; a health disc shows the summary. |
| Needs attention | The tree filter that keeps only modules with an amber or red disc. |
| Focus | Narrowing the canvas to one folder's files. |
| Legend | The panel on the canvas, opened from its bottom-right controls, that names every edge style, every disc and what a frame's figure counts, and holds the inferred-edges switch. |
| Box | What the canvas draws for a module, or for a folded folder: its disc, its name and, when it has a note, its note mark. |
| Box description | The small panel that fades in directly under a hovered canvas box, as wide as the box, showing the module's one-line description from the describer; a box with no description shows none. |
| Private-name import | An import of a name the target module does not export. Drawn dashed. |
| Evidence | Why an edge exists: the quoted source line, the names, the route, or what an inferred edge was inferred from. |
| View state | Everything that decides what the user sees, as one record. Each change makes a new one; it lasts only as long as the window. |
| History | The sequence of view states the user has moved through in a window; back and forward walk it. It is never saved. |
| Rail | The thin strip of icons at the window's far left, one per left-hand panel; an icon opens its panel, or closes it when it is open. |
| Files panel | The rail's panel holding the tree. |
| Saved view | A named view committed at `.recognizer/views/<name>.json`: its title, its description, the commit it was saved at, its steps and its notes. |
| Modified view | A saved view whose canvas contents differ from its saved file, shown by the muted "modified" beside its name; panning and zooming do not count. |
| Revert | The view bar's button that restores a modified saved view's saved contents and camera, with Undo, or only the camera when that is all that moved. |
| View title | The optional heading text of a saved view, separate from its name. |
| View details card | The card under the view bar that edits a view's name, title and description together, with Cancel and Save. |
| View heading | The title and description of a saved view, drawn centred above the diagram and moving with it. |
| Change view | A saved view that holds a git range (base..head), re-diffed when it opens; the diff's modules are on the canvas marked added, modified or removed. |
| Stale view | A saved view the list shows under Stale with Delete: a change view whose head is merged or whose branch is gone, or any view with a pick that no longer resolves. |
| Views panel | The left-column panel, behind the rail icon between Files and Notes, that lists every saved view: live ones, then stale ones with Delete; opened from the view bar's All views link. |
| Note | The one text a person or an agent attaches to a module or folder in a saved view, with the name of who last wrote it; writing again replaces it. |
| Notes panel | The left-column panel, behind the rail's speech-bubble icon, that lists every noted box and folder in the view, numbered and in reading order with a drag handle on each row, and focuses the selected note; the overview, with no composer. |
| Note bubble | The speech bubble hanging from a box's or folder's note mark that holds its one note, who last wrote it, Edit and Remove, and its number, "n of N", and Previous and Next that pan the canvas to the next box with the bubble kept where it is; the place notes are read and written, opened from the mark, the bar's notes button or N. |
| Note mark | The small outlined speech-bubble icon after a noted box's name or at a noted frame's corner; clicking it opens the bubble. |
| Note focus | A module selection with its note bubble open; kept while the noted box stays selected, cleared by any other selection or Escape. |
| Scan panel | The left-column panel, behind the Scan rail icon, that shows one list of Scan rows and one Scan button, with the ticks a repository remembers. |
| Scan row | One entry of the Scan panel's list: a checkbox, a name and a state in words (not yet run, a count with an age, running, waiting, or failed). |
| Scope (Only this view) | The Scan panel's switch, shown only while a view is open and remembered with the row ticks. When it is on, a run describes only the view's stale modules and mutates only the functions of the view's modules; C.R.A.P. and Duplication still cover the whole repository; under Bring up to date the Mutation list is the union of the out-of-date and missing modules. `recognizer scan --modules <file>` takes the module ids as a JSON array and applies the same scope. |
| Phase | One of the parts of a scan: extraction (when the files changed), describing (when ticked), measuring (CLI only, when asked for) and the sensors (when ticked). |
| Findings panel | The left-column panel, behind the Findings rail icon: a heading with one muted count line, then one collapsible group per finding kind, each holding cards. |
| Finding group | One collapsible kind in the Findings panel, named by the kind, a report or an unknown kind: a chevron, a severity dot, the name and its count. Collapsed until clicked. |
| Finding card | A finding in the panel or in the inspector's Findings tab: the subject in bold, its folder muted beneath it and one plain sentence; opened inline to a row per module, member or edge involved, with Add to view on a row whose module is off the view. |
| Finding focus | One finding card open: the evidence lit on the canvas and the rest dimmed, with no selection and no box added. Cleared by Escape, by clicking the open card, or by selecting a box outside the evidence. |
| Description | A saved view's required one- or two-sentence statement of what it shows. |
| Step | One entry in a saved view, replayed on opening: a pick, a rule, a fold, a focus, or a module left out. |
| Pick | A step naming one module by path. Everything the user adds in the app is recorded as picks. |
| Rule | A step naming a relationship (a folder's files, what a module uses or is used by), re-evaluated on every opening. |
| View drift | What the tray message about a saved view reports when the view is compared with the current scan: a pick that is missing, changed relations, or newly relevant modules. |
| Left out | A step recording that a rule put a module on a view and the user took it off. A pick is never removed by a left-out; only modules a rule contributed are. |
| Resolution | A view's steps evaluated against a scan: the modules, folds and focus they give, and the steps that name a path that is gone. |
| Link | A `recognizer://open?repo=<absolute path>[&view=<name>]` address of a repository and, optionally, one of its saved views. Opening one opens the folder and the view, or focuses the window already showing the folder; it never runs a command, scans, describes or writes. |
| Window id | The `w-<n>` label the app gives a window, which `recognizer windows` lists and `recognizer window <id>` takes. |
| App socket | The per-user local socket, `app.sock` in the app's config folder, through which the `recognizer` command reads the running app. |
| Agent change | A view-state change made through `recognizer window <id> <verb>`, carrying `--by`. It is one ordinary history step, so one Back undoes it. |
| Message | A kind (warning, error, done or info), one sentence, a time and at most one action (Upgrade, Show or Undo), held in the message tray. |
| Message tray | The popover the footer's bell opens: per window, in memory only, newest message first, with a badge on the bell counting the unread. |
| Toast | A new message shown above the bell for 3.5 seconds, then only in the message tray. |
| Mark | Who made a history entry and what the change was, kept beside it so Back and Forward can name the agent's entries as the agent's. |
| View bar | The control group at the canvas's top left: back and forward over the history, the open view's name with the saved views to open, Save and Copy link. |
| Agent guide | The text `recognizer help agents` prints: how an agent answers show-me, extend, explain and drive requests, which commands to use and that `.recognizer/` is off limits. Its command section is generated from the command table. |
| Agent install | What `recognizer agents install` writes into the user's Claude folder: a skill that only points at the agent guide, and a permission rule denying Read and Edit of `**/.recognizer/**`. `uninstall` reverses it. |
