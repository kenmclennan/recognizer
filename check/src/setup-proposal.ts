export type SetupSection = "problems" | "tests" | "policy";

export interface SetupChange {
  section: SetupSection;
  title: string;
  reason: string;
  commands: string[][];
  runsTests: boolean;
  registersProgram: boolean;
  ticked: boolean;
}

export interface DroppedChange {
  title: string;
  refusal: string;
}

export interface ParsedProposal {
  summary: string;
  changes: SetupChange[];
  dropped: DroppedChange[];
}

export const SETUP_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          section: { enum: ["problems", "tests", "policy"] },
          title: { type: "string" },
          reason: { type: "string" },
          commands: {
            type: "array",
            minItems: 1,
            items: {
              type: "array",
              minItems: 1,
              items: { type: "string" },
            },
          },
        },
        required: ["section", "title", "reason", "commands"],
        additionalProperties: false,
      },
    },
  },
  required: ["changes"],
  additionalProperties: false,
};

const MAX_ARGUMENTS = 20;
const MAX_ARGUMENT_LENGTH = 4096;
const SECTIONS: SetupSection[] = ["problems", "tests", "policy"];

export function commandRefusal(argv: string[]): string | null {
  if (argv.length > MAX_ARGUMENTS) {
    return `more than ${MAX_ARGUMENTS} arguments`;
  }

  for (const argument of argv) {
    if (argument === "--repository") {
      return "carries --repository";
    }

    if (argument.includes("\0")) {
      return "an argument contains a NUL";
    }

    if (argument.length > MAX_ARGUMENT_LENGTH) {
      return `an argument is longer than ${MAX_ARGUMENT_LENGTH} characters`;
    }
  }

  if (argv[0] !== "recognizer") {
    return "not a recognizer command";
  }

  const verb = argv[1];

  if (verb === "config" || verb === "policy") {
    return null;
  }

  if (verb === "plugin") {
    return argv[2] === "add" ? null : "only plugin add is allowed";
  }

  if (verb === "scan") {
    return argv.length === 2 ? null : "scan takes no argument";
  }

  if (verb === "sensors" && argv[2] === "check") {
    const rest = argv.slice(3);
    const names = rest.filter((argument) => argument !== "--run");
    const first = names[0];

    if (
      names.length > 1 ||
      rest.filter((argument) => argument === "--run").length > 1 ||
      first?.startsWith("-") === true
    ) {
      return "sensors check takes --run and at most one sensor name";
    }

    return null;
  }

  return "not a command setup may run";
}

function runsTests(argv: string[]): boolean {
  return argv[1] === "sensors" && argv[2] === "check" && argv.includes("--run");
}

function registersProgram(argv: string[]): boolean {
  if (argv[1] !== "config") {
    return false;
  }

  const key = argv.slice(2).find((argument) => !argument.startsWith("-"));

  return key !== undefined && key.split(".").pop() === "command";
}

function isStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string")
  );
}

export function parseProposal(
  value: unknown,
): ParsedProposal | { error: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { error: "the proposal is not a JSON object" };
  }

  const record = value as Record<string, unknown>;

  if (!Array.isArray(record.changes)) {
    return { error: "the proposal has no changes list" };
  }

  const changes: SetupChange[] = [];
  const dropped: DroppedChange[] = [];

  for (const entry of record.changes) {
    if (typeof entry !== "object" || entry === null) {
      return { error: "a change in the proposal is not an object" };
    }

    const change = entry as Record<string, unknown>;

    if (
      !SECTIONS.includes(change.section as SetupSection) ||
      typeof change.title !== "string" ||
      typeof change.reason !== "string" ||
      !Array.isArray(change.commands) ||
      change.commands.length === 0 ||
      !change.commands.every(isStringList)
    ) {
      return { error: "a change in the proposal has the wrong shape" };
    }

    const commands = change.commands as string[][];
    const refusal = commands
      .map((argv) => commandRefusal(argv))
      .find((reason) => reason !== null);

    if (refusal !== undefined && refusal !== null) {
      dropped.push({ title: change.title, refusal });
      continue;
    }

    const tests = commands.some(runsTests);
    const program = commands.some(registersProgram);
    const section = change.section as SetupSection;

    changes.push({
      section,
      title: change.title,
      reason: change.reason,
      commands,
      runsTests: tests,
      registersProgram: program,
      ticked: section !== "policy" && !tests && !program,
    });
  }

  return {
    summary: typeof record.summary === "string" ? record.summary : "",
    changes,
    dropped,
  };
}

function quoteArgument(argument: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(argument)
    ? argument
    : `'${argument.replaceAll("'", "'\\''")}'`;
}

export function quoteCommand(argv: string[]): string {
  return argv.map(quoteArgument).join(" ");
}
