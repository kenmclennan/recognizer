import type { Selection } from "./canvas-state";

export type DriveRequest = {
  action: string;
  args: string[];
  options: { off?: boolean };
  by: string;
};

export type DriveFacts = {
  modules: ReadonlySet<string>;
  onCanvas: ReadonlySet<string>;
  folded: ReadonlySet<string>;
  focus: string | null;
  selection: Selection;
  canonical: (folder: string) => string;
  views: string[];
  trail: { selection: Selection; uses: string[]; usedBy: string[] } | null;
};

export type ClearTarget = "modules" | "folds" | "focus" | "selection" | "all";

export type DriveAction =
  | { kind: "open"; ids: string[] }
  | { kind: "close"; ids: string[] }
  | { kind: "fold"; folders: string[]; off: boolean }
  | { kind: "focus"; folder: string }
  | { kind: "select"; selection: NonNullable<Selection> }
  | { kind: "follow"; relation: "uses" | "usedBy"; id: string }
  | { kind: "open-view"; name: string }
  | { kind: "clear"; target: ClearTarget };

export type DrivePlan =
  | { refuse: string }
  | { apply: DriveAction[]; summary: string };

export const DRIVE_ACTIONS = [
  "add",
  "remove",
  "fold",
  "focus",
  "select",
  "trail",
  "open-view",
  "clear",
];

const CLEAR_TARGETS: ClearTarget[] = [
  "modules",
  "folds",
  "focus",
  "selection",
  "all",
];

const NOTHING: DrivePlan = { apply: [], summary: "nothing changed" };

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function refuse(reason: string): DrivePlan {
  return { refuse: reason };
}

function holdsModule(facts: DriveFacts, folder: string): boolean {
  for (const id of facts.modules) {
    if (id.startsWith(`${folder}/`)) {
      return true;
    }
  }

  return false;
}

function needs(action: string, what: string): DrivePlan {
  return refuse(`${action} needs ${what}`);
}

function planModules(
  request: DriveRequest,
  facts: DriveFacts,
  adding: boolean,
): DrivePlan {
  if (request.args.length === 0) {
    return needs(request.action, "at least one module path");
  }

  const ids = unique(request.args);
  const unknown = ids.find((id) => !facts.modules.has(id));

  if (unknown !== undefined) {
    return refuse(`no module ${unknown} in the scan`);
  }

  const changing = ids.filter((id) => facts.onCanvas.has(id) !== adding);

  if (changing.length === 0) {
    return NOTHING;
  }

  return {
    apply: [{ kind: adding ? "open" : "close", ids: changing }],
    summary: `${adding ? "added" : "removed"} ${count(changing.length, "module")}`,
  };
}

function planFold(request: DriveRequest, facts: DriveFacts): DrivePlan {
  if (request.args.length === 0) {
    return needs("fold", "at least one folder id");
  }

  const off = request.options.off === true;
  const folders = unique(request.args.map(facts.canonical));
  const unknown = folders.findIndex((folder) => !holdsModule(facts, folder));

  if (unknown !== -1) {
    return refuse(
      `no folder ${request.args[unknown]} holds a module in the scan`,
    );
  }

  const changing = folders.filter((folder) => facts.folded.has(folder) === off);

  if (changing.length === 0) {
    return NOTHING;
  }

  return {
    apply: [{ kind: "fold", folders: changing, off }],
    summary: `${off ? "unfolded" : "folded"} ${count(changing.length, "folder")}`,
  };
}

function planFocus(request: DriveRequest, facts: DriveFacts): DrivePlan {
  if (request.args.length !== 1) {
    return needs("focus", "one folder id");
  }

  const folder = facts.canonical(request.args[0]);

  if (!holdsModule(facts, folder)) {
    return refuse(`no folder ${request.args[0]} holds a module in the scan`);
  }

  if (facts.focus === folder) {
    return NOTHING;
  }

  return { apply: [{ kind: "focus", folder }], summary: `focused ${folder}` };
}

function planSelect(request: DriveRequest, facts: DriveFacts): DrivePlan {
  if (request.args.length !== 1) {
    return needs("select", "one module path or folder id");
  }

  const id = request.args[0];
  const folder = facts.canonical(id);
  const selection: NonNullable<Selection> | null = facts.modules.has(id)
    ? { kind: "module", id }
    : holdsModule(facts, folder)
      ? { kind: "folder", id: folder }
      : null;

  if (selection === null) {
    return refuse(`no module or folder ${id} in the scan`);
  }

  if (
    facts.selection?.kind === selection.kind &&
    facts.selection.id === selection.id
  ) {
    return NOTHING;
  }

  return {
    apply: [{ kind: "select", selection }],
    summary: `selected ${selection.id}`,
  };
}

function planTrail(request: DriveRequest, facts: DriveFacts): DrivePlan {
  const [word, id] = request.args;

  if (request.args.length !== 2 || (word !== "uses" && word !== "used-by")) {
    return needs("trail", "uses or used-by, then a module path");
  }

  if (facts.trail === null || facts.trail.selection === null) {
    return refuse("the trail is empty");
  }

  const relation = word === "uses" ? "uses" : "usedBy";
  const neighbours =
    relation === "uses" ? facts.trail.uses : facts.trail.usedBy;

  if (!neighbours.includes(id)) {
    return refuse(
      `${id} is not a direct ${word === "uses" ? "dependency" : "dependent"} of ${facts.trail.selection.id}`,
    );
  }

  return {
    apply: [{ kind: "follow", relation, id }],
    summary: `followed ${word} ${id}`,
  };
}

function planOpenView(request: DriveRequest, facts: DriveFacts): DrivePlan {
  if (request.args.length !== 1) {
    return needs("open-view", "one saved view name");
  }

  const name = request.args[0];

  if (!facts.views.includes(name)) {
    return refuse(`no saved view named ${name}`);
  }

  return {
    apply: [{ kind: "open-view", name }],
    summary: `opened view ${name}`,
  };
}

function planClear(request: DriveRequest): DrivePlan {
  const word = request.args[0];

  if (request.args.length !== 1) {
    return needs("clear", `one of ${CLEAR_TARGETS.join(", ")}`);
  }

  const target = CLEAR_TARGETS.find((candidate) => candidate === word);

  if (target === undefined) {
    return refuse(`cannot clear ${word}: use ${CLEAR_TARGETS.join(", ")}`);
  }

  const summary = {
    all: "cleared the canvas",
    modules: "cleared modules",
    folds: "cleared folds",
    focus: "cleared focus",
    selection: "cleared selection",
  }[target];

  return { apply: [{ kind: "clear", target }], summary };
}

export function planDrive(request: DriveRequest, facts: DriveFacts): DrivePlan {
  switch (request.action) {
    case "add":
      return planModules(request, facts, true);
    case "remove":
      return planModules(request, facts, false);
    case "fold":
      return planFold(request, facts);
    case "focus":
      return planFocus(request, facts);
    case "select":
      return planSelect(request, facts);
    case "trail":
      return planTrail(request, facts);
    case "open-view":
      return planOpenView(request, facts);
    case "clear":
      return planClear(request);
    default:
      return refuse(`unknown action ${request.action}`);
  }
}
