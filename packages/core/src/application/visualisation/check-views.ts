import { InvalidRequest } from "../../domain/invalid-request.js";
import { Neighbours } from "../../domain/visualisation/neighbours.js";
import type { StaleReason } from "../../domain/visualisation/stale-reason.js";
import { View, type ViewStep } from "../../domain/visualisation/view.js";
import { ViewNotes } from "../../domain/visualisation/view-notes.js";
import { changeFacts } from "./internal/change-facts.js";
import { checkName } from "./internal/view-access.js";
import type { VisualisationPorts } from "./internal/visualisation-ports.js";

export interface CheckViewsRequest {
  root: string;
  name: string | undefined;
  fix: boolean;
}

export interface CheckedStep {
  step: number;
  kind: ViewStep["kind"];
  path: string;
  what: "module" | "folder";
  renamedTo: string | null;
}

export interface CheckedView {
  name: string;
  ok: boolean;
  error?: string;
  unresolved: CheckedStep[];
  fixed: { step: number; from: string; to: string }[];
  warnings: string[];
  stale: StaleReason[];
}

export function checkViews(
  ports: VisualisationPorts,
  request: CheckViewsRequest,
): CheckedView[] {
  const { root } = request;
  const existing = ports.views.names(root);
  const requested = request.name;
  const names = requested === undefined ? existing : [checkName(requested)];

  if (requested !== undefined && !existing.includes(requested)) {
    throw new InvalidRequest([`no such view: ${requested}`]);
  }

  const results: CheckedView[] = [];

  if (names.length === 0) {
    return results;
  }

  const repository = ports.freshRepository(root);
  const known = new Set(Neighbours.moduleNames(repository));
  const renameCache = new Map<string, ReadonlyMap<string, string>>();
  const renamesSince = (commit: string): ReadonlyMap<string, string> => {
    const cached = renameCache.get(commit);

    if (cached !== undefined) {
      return cached;
    }

    const renames = ports.git.renamesSince(root, commit);

    renameCache.set(commit, renames);

    return renames;
  };

  for (const name of names) {
    const read = ports.views.read(root, name);

    if (!read.ok) {
      results.push({
        name,
        ok: false,
        error: read.messages.join("; "),
        unresolved: [],
        fixed: [],
        warnings: [],
        stale: [],
      });

      continue;
    }

    let view = read.view;
    const warnings = [
      ...view.noteWarnings(),
      ...view.proposedWarnings(view.resolve(repository), repository),
    ];

    const annotate = (current: View): CheckedStep[] =>
      current.resolve(repository).unresolved.map((u) => {
        const renamed =
          u.kind === "pick" && current.commit !== null
            ? renamesSince(current.commit).get(u.path)
            : undefined;

        return {
          ...u,
          renamedTo:
            renamed !== undefined && known.has(renamed) ? renamed : null,
        };
      });

    let unresolved = annotate(view);
    const fixed: CheckedView["fixed"] = [];

    if (request.fix && unresolved.some((u) => u.renamedTo !== null)) {
      const renames = new Map(
        unresolved
          .filter((u) => u.renamedTo !== null)
          .map((u) => [u.step, u.renamedTo as string]),
      );
      const steps: ViewStep[] = [];
      const picked = new Set(
        view.steps.flatMap((s) => (s.kind === "pick" ? [s.module] : [])),
      );

      view.steps.forEach((step, index) => {
        const to = renames.get(index + 1);

        if (step.kind !== "pick" || to === undefined) {
          steps.push(step);

          return;
        }

        fixed.push({ step: index + 1, from: step.module, to });

        if (!picked.has(to)) {
          picked.add(to);
          steps.push({ kind: "pick", module: to });
        }
      });

      const renamed = new Map(fixed.map(({ from, to }) => [from, to]));
      const migrated = view.migrated();

      view = migrated.with({
        steps,
        ...(migrated.proposed === undefined
          ? {}
          : {
              proposed: View.lastProposedPerModule(
                migrated.proposed.map((entry) => ({
                  ...entry,
                  module: renamed.get(entry.module) ?? entry.module,
                  ...(entry.from === undefined
                    ? {}
                    : { from: renamed.get(entry.from) ?? entry.from }),
                })),
              ),
            }),
        ...(migrated.notes === undefined
          ? {}
          : {
              notes: ViewNotes.lastPerPath(
                migrated.notes.map((note) => ({
                  ...note,
                  module: renamed.get(note.module) ?? note.module,
                })),
              ),
            }),
      });

      ports.views.write(root, name, view);
      unresolved = annotate(view);
    }

    const facts =
      view.change === undefined
        ? null
        : changeFacts(ports.git, root, view.change);

    results.push({
      name,
      ok: unresolved.length === 0,
      unresolved,
      fixed,
      warnings,
      stale: view.staleReasons(view.resolve(repository).unresolved, facts),
    });
  }

  return results;
}
