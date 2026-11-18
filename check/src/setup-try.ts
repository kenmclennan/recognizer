import { type Io, onStop } from "./cli.js";
import {
  cargoInstalled,
  restore,
  runChange,
  snapshotOf,
  undoNote,
} from "./setup-apply.js";
import type { PlannedChange } from "./setup-changes.js";
import type { Survey } from "./setup-survey.js";

export type TryEvent =
  | { event: "start"; total: number }
  | {
      event: "change";
      index: number;
      state: "running" | "done" | "failed" | "undone";
      output: string;
    }
  | { event: "runner"; name: string; ready: boolean; detail: string }
  | { event: "result"; ok: boolean };

interface Gap {
  suite: string | null;
  line: string;
}

export function rehearsalChanges(
  survey: Survey,
  changes: PlannedChange[],
): PlannedChange[] {
  const testing = new Set(
    survey.checks.filter((check) => check.runs_tests).map((check) => check.id),
  );
  const rank = (change: PlannedChange) =>
    survey.runners.findIndex((runner) => `tests-${runner.name}` === change.id);

  const kept = changes.filter(
    (change) =>
      change.id.startsWith("tool-") ||
      change.id.startsWith("tests-") ||
      (change.id.startsWith("plugin-") &&
        testing.has(change.id.slice("plugin-".length))),
  );
  const others = kept.filter((change) => !change.id.startsWith("tests-"));
  const runners = kept
    .filter((change) => change.id.startsWith("tests-"))
    .sort((a, b) => rank(a) - rank(b));
  const firstRunner = kept.findIndex((change) =>
    change.id.startsWith("tests-"),
  );

  if (firstRunner === -1) {
    return kept;
  }

  const before = others.filter((change) => kept.indexOf(change) < firstRunner);
  const after = others.filter((change) => kept.indexOf(change) > firstRunner);

  return [...before, ...runners, ...after];
}

function gapsOf(text: string): Gap[] | null {
  try {
    const parsed = JSON.parse(text) as {
      sensors?: { gaps?: Gap[] }[];
    };

    return (parsed.sensors ?? []).flatMap((sensor) => sensor.gaps ?? []);
  } catch {
    return null;
  }
}

export async function tryChanges(
  io: Io,
  root: string,
  changes: PlannedChange[],
  emit: (event: TryEvent) => void,
  _argv: string[] = [],
): Promise<boolean> {
  const snapshot = snapshotOf(io, root, changes);
  let stopRequested = false;
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const off = onStop(() => {
    stopRequested = true;

    return done;
  });
  const completed: { change: PlannedChange; index: number }[] = [];

  const undo = () => {
    restore(io, root, snapshot);

    for (const { change, index } of [...completed].reverse()) {
      const cargo = cargoInstalled(change);

      if (cargo !== null) {
        io.run("cargo", ["uninstall", cargo], { cwd: root });
      }

      emit({
        event: "change",
        index,
        state: "undone",
        output: undoNote(change),
      });
    }
  };

  try {
    emit({ event: "start", total: changes.length });

    for (const [index, change] of changes.entries()) {
      emit({ event: "change", index, state: "running", output: "" });

      const ran = await runChange(io, change, () => stopRequested);

      if (!ran.ok) {
        emit({ event: "change", index, state: "failed", output: ran.output });
        undo();
        emit({ event: "result", ok: false });

        return false;
      }

      completed.push({ change, index });
      emit({ event: "change", index, state: "done", output: ran.output });
    }

    const names = changes
      .filter((change) => change.id.startsWith("tests-"))
      .map((change) => change.id.slice("tests-".length));
    const check = await io.runAsync(
      "recognizer",
      ["sensors", "check", "--run", "--json"],
      { cwd: root },
    ).result;

    if (stopRequested || check.stopped === true) {
      undo();
      emit({ event: "result", ok: false });

      return false;
    }

    const gaps = check.started ? gapsOf(check.stdout) : null;
    let ok = check.started && gaps !== null && check.status === 0;

    for (const name of names) {
      const own =
        gaps === null
          ? ["the readiness check gave no answer"]
          : [
              ...new Set(
                gaps.filter((gap) => gap.suite === name).map((gap) => gap.line),
              ),
            ];

      if (own.length > 0) {
        ok = false;
      }

      emit({
        event: "runner",
        name,
        ready: own.length === 0,
        detail: own.join(" "),
      });
    }

    undo();
    emit({ event: "result", ok });

    return ok;
  } finally {
    finish();
    off();
  }
}
