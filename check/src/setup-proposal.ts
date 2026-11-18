const MAX_ARGUMENTS = 20;
const MAX_ARGUMENT_LENGTH = 4096;

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

function quoteArgument(argument: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(argument)
    ? argument
    : `'${argument.replaceAll("'", "'\\''")}'`;
}

export function quoteCommand(argv: string[]): string {
  return argv.map(quoteArgument).join(" ");
}
