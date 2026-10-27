import {
  buildCallerIndex,
  type Caller,
  type CallerIndex,
  type CallerSummary,
  moduleLabel,
} from "recognizer";

export { buildCallerIndex, type Caller, type CallerIndex, type CallerSummary };

export type CallerKind =
  | "class"
  | "interface"
  | "type"
  | "function"
  | "method"
  | "constant";

export type CallerButton = {
  text: string;
  title: string;
  callers: string[];
  pickerTitle: string;
  name: string;
};

const MAX_NAMED_ABSTRACTIONS = 2;
const NAMED_CALLERS = 2;

function verbOf(kind: CallerKind, constructed: boolean): string {
  if (kind === "function" || kind === "method") {
    return "called";
  }

  return (kind === "class" || kind === "interface") && constructed
    ? "built"
    : "used";
}

const PRESENT: Record<string, string> = {
  called: "calls",
  built: "builds",
  used: "uses",
};

function throughSuffix(callers: Caller[]): string {
  if (callers.some((caller) => caller.through === null)) {
    return "";
  }

  const names = [
    ...new Set(callers.map((caller) => caller.through as string)),
  ].sort();

  return names.length > MAX_NAMED_ABSTRACTIONS
    ? `, through ${names.length} abstractions`
    : `, through ${names.join(", ")}`;
}

export function callerButton(
  kind: CallerKind,
  qualified: string,
  summary: CallerSummary,
): CallerButton | null {
  const { callers } = summary;
  const name = qualified.slice(qualified.lastIndexOf(".") + 1);

  if (callers.length === 0 || name === "__init__" || name === "constructor") {
    return null;
  }

  const verb = verbOf(kind, summary.constructed);
  const labels = callers.map((caller) => moduleLabel(caller.module));
  const who =
    callers.length <= NAMED_CALLERS ? labels.join(", ") : `${callers.length}`;
  const suffix = throughSuffix(callers);
  const mixed =
    suffix === "" && callers.some((caller) => caller.through !== null);
  const title = mixed
    ? callers
        .map((caller) =>
          caller.through === null
            ? moduleLabel(caller.module)
            : `${moduleLabel(caller.module)} (through ${caller.through})`,
        )
        .join(", ")
    : labels.join(", ");

  return {
    text: `${verb} by ${who}${suffix}`,
    title,
    callers: callers.map((caller) => caller.module),
    pickerTitle: `${PRESENT[verb]} ${name}`,
    name,
  };
}
