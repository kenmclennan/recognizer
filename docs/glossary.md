# Glossary

The words recognizer's code, docs and interface use. A term is added here before it is used, and a term used differently from its entry is a defect in one or the other.

## The code being scanned

| Term | Meaning |
| --- | --- |
| Repository | The codebase being scanned: one git repository, possibly in several languages. |
| Module | One box: a source file, or a package for Kotlin. Identified by its repository-relative path. |
| Folder | A directory of the repository, as the tree shows it. Not a component: a folder is where files are, not what they are for. |
| Member | A class, function, interface, type or constant defined in a module. |
| Call | A member using another member: calling it, constructing it, or reaching it through an abstraction by dispatch. |
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
| Overlay | Measurements from outside recognizer (coverage, churn, mutation) painted onto modules and members. |
| Scanner | A language's standalone command that emits a scan. |
| Scan | The document a scanner emits: modules, edges and foreign nodes for one language. |
| Cache | A repository's gitignored `.recognizer/cache/`, where scans and overlays are written. |

## The viewer

| Term | Meaning |
| --- | --- |
| Tree | The left area: the repository's folders and files, each with its health disc. The way in. |
| Canvas | The centre area: the modules the user has opened, inside their frames, and the edges between them. |
| Inspector | The right area, closed by default: what is in the selection, its findings, or an edge's evidence. |
| Frame | The box on the canvas for exactly one folder, labelled with its name, holding that folder's open modules and the frames of its open subfolders. |
| Open | On the canvas. A module is opened from the tree or by following an edge, and closed the same way. |
| Selection | The one module, folder or edge the user has picked, highlighted in the tree and shown in the inspector. |
| Selection bar | The small bar of actions that appears above the selection; right-clicking opens the same bar. |
| Picker | The list a selection's dependencies or dependents are chosen from, by module or by name, before they are added. |
| Ghost | A module ticked in the picker, drawn on the canvas where it would land, until it is added or dropped. |
| Fold | Drawing an open folder as one box, which keeps its health disc and takes the edges to anything inside it. |
| Contents | A module's members, with their signatures and who builds, calls or uses each; or a folder's files. |
| Health disc | A dot on each file, folder and box: green fine, amber a warning, red a violation, a grey ring not measured. A folder shows the worst inside it. |
| Focus | Narrowing the canvas to one folder's files. |
| Evidence | Why an edge exists: the quoted source line, the names, the route, or what an inferred edge was inferred from. |
| View state | Everything that decides what the user sees, as one record with an id. Each change makes a new one. |
| History | The sequence of view states the user has moved through; back and forward walk it. |
| Bookmark | A view state the user has named. |
