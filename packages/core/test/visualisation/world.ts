import {
  type Call,
  Dependency,
  type DependencyFields,
  File,
  Member,
  Repository,
  View,
  type ViewFields,
  type VisualisationPorts,
} from "../../src/index.js";
import { FakeChanges } from "../fakes/fake-changes.js";
import { FakeGit } from "../fakes/fake-git.js";
import { FakeViewRepository } from "../fakes/fake-view-repository.js";
import { FakeWindows } from "../fakes/fake-windows.js";

export interface EdgeSpec {
  from: string;
  to: string;
  names?: string[];
  kind?: DependencyFields["kind"];
  inferred?: boolean;
}

export function repositoryWith(
  files: string[],
  edges: EdgeSpec[] = [],
  options: {
    privateMember?: { file: string; name: string };
    calls?: Call[];
    commit?: string | null;
  } = {},
): Repository {
  return Repository.of({
    files: files.map(
      (path) =>
        new File({
          path,
          language: "python",
          kind: "source",
          hash: null,
          members:
            options.privateMember?.file === path
              ? [
                  new Member({
                    name: options.privateMember.name,
                    exported: false,
                    kind: "function",
                  }),
                ]
              : [],
          entryPoint: false,
          annotations: [],
          actualOf: [],
        }),
    ),
    dependencies: edges.map(
      (edge) =>
        new Dependency({
          from: edge.from,
          to: edge.to,
          toLibrary: false,
          language: "python",
          kind: edge.kind ?? "depends",
          line: 1,
          ...(edge.names === undefined ? {} : { names: edge.names }),
          ...(edge.inferred === true
            ? {
                inferred: {
                  parameter: "p",
                  methods: [],
                  class: "C",
                  implementations: [],
                },
              }
            : {}),
        }),
    ),
    calls: options.calls ?? [],
    extractions:
      options.commit === undefined
        ? []
        : [
            {
              language: "python",
              scanner: { name: "fake", version: "0" },
              commit: options.commit,
              modified: false,
              selection: {
                extensions: [],
                skipDirectoryNames: [],
                skipDirectoryPrefixes: [],
                skipDirectorySuffixes: [],
                skipDirectoriesContaining: [],
                skipFileGlobs: [],
              },
              files: files.map((path) => ({ path, hash: "h" })),
            },
          ],
  });
}

export function viewOf(
  steps: View["steps"],
  extra: Partial<ViewFields> = {},
): View {
  return View.of({
    schema_version: 4,
    description: "d",
    commit: null,
    steps,
    ...extra,
  });
}

export class VisualisationWorld {
  readonly views = new FakeViewRepository();
  readonly git = new FakeGit("c0ffee");
  readonly changes = new FakeChanges();
  readonly windows = new FakeWindows();
  structure = repositoryWith([]);
  freshReads = 0;

  get ports(): VisualisationPorts {
    return {
      views: this.views,
      git: this.git,
      changes: this.changes,
      windows: this.windows,
      freshRepository: () => {
        this.freshReads += 1;

        return this.structure;
      },
    };
  }
}
