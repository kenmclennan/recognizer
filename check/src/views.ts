import { InputError } from "./errors.js";
import validate from "./generated/view-validator.js";
import { moduleNames, under, usedByOf, usesOf } from "./neighbours.js";
import type { Scan } from "./scan.js";

export type ViewStep =
  | { kind: "pick"; module: string }
  | { kind: "rule"; relation: "folder"; of: string }
  | { kind: "rule"; relation: "uses" | "used-by"; of: string; within?: string }
  | { kind: "fold"; folder: string }
  | { kind: "focus"; folder: string }
  | { kind: "left-out"; module: string };

export interface View {
  schema_version: 1;
  description: string;
  commit: string | null;
  steps: ViewStep[];
}

export interface ResolvedView {
  modules: string[];
  folded: string[];
  focus: string | null;
  unresolved: {
    step: number;
    kind: ViewStep["kind"];
    path: string;
    what: "module" | "folder";
  }[];
}

export function validateView(value: unknown): View {
  if (validate(value)) {
    return value as unknown as View;
  }

  const messages = (validate.errors ?? []).map(
    (error) => `view${error.instancePath} ${error.message ?? "is invalid"}`,
  );

  throw new InputError(messages.length > 0 ? messages : ["view is invalid"]);
}

export function resolveView(view: View, scans: Scan[]): ResolvedView {
  const modules = moduleNames(scans);
  const known = new Set(modules);
  const hasFolder = (folder: string) =>
    modules.some((module) => under(module, folder));
  const picked = new Set<string>();
  const ruled = new Set<string>();
  const leftOut = new Set<string>();
  const folded: string[] = [];
  const unresolved: ResolvedView["unresolved"] = [];
  let focus: string | null = null;

  view.steps.forEach((step, index) => {
    const missing = (path: string, what: "module" | "folder") => {
      unresolved.push({ step: index + 1, kind: step.kind, path, what });
    };

    switch (step.kind) {
      case "pick":
        if (known.has(step.module)) {
          picked.add(step.module);
        } else {
          missing(step.module, "module");
        }

        break;
      case "left-out":
        leftOut.add(step.module);

        break;
      case "fold":
      case "focus":
        if (!hasFolder(step.folder)) {
          missing(step.folder, "folder");
        } else if (step.kind === "fold") {
          folded.push(step.folder);
        } else {
          focus = step.folder;
        }

        break;
      case "rule": {
        const anchorIsFolder = step.relation === "folder";
        const anchorExists = anchorIsFolder
          ? hasFolder(step.of)
          : known.has(step.of);
        const withinMissing =
          step.relation !== "folder" &&
          step.within !== undefined &&
          !hasFolder(step.within);

        if (!anchorExists) {
          missing(step.of, anchorIsFolder ? "folder" : "module");
        }

        if (withinMissing) {
          missing(step.within as string, "folder");
        }

        if (!anchorExists || withinMissing) {
          break;
        }

        if (step.relation === "folder") {
          for (const module of modules) {
            if (under(module, step.of)) {
              ruled.add(module);
            }
          }
        } else {
          const rows =
            step.relation === "uses"
              ? usesOf(scans, modules, step.of)
              : usedByOf(scans, modules, step.of);

          for (const row of rows) {
            if (
              row.id !== step.of &&
              (step.within === undefined || under(row.id, step.within))
            ) {
              ruled.add(row.id);
            }
          }
        }

        break;
      }
    }
  });

  for (const module of leftOut) {
    ruled.delete(module);
  }

  return {
    modules: [...new Set([...picked, ...ruled])].sort((a, b) =>
      a.localeCompare(b),
    ),
    folded,
    focus,
    unresolved,
  };
}
