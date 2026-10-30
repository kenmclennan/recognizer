import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";
import { checkLink, isLink, parseLink } from "./link.js";

const BUNDLE = "Recognizer.app";
const OVERRIDE = "RECOGNIZER_APP";
const INSTALL_HINT = `${BUNDLE} was not found in ~/Applications or /Applications; install it from a checkout of kenmclennan/recognizer with: npm run install-app`;

function candidates(io: Io): string[] {
  const home = io.env("HOME");

  return [
    ...(home ? [join(home, "Applications", BUNDLE)] : []),
    join("/Applications", BUNDLE),
  ];
}

function findBundle(io: Io): string | null {
  const override = io.env(OVERRIDE);

  if (override !== undefined && override !== "") {
    if (!isAbsolute(override) || !override.endsWith(".app")) {
      throw new InputError([
        `${OVERRIDE} must be an absolute path to a .app bundle: ${override}`,
      ]);
    }

    return io.exists(override) ? override : null;
  }

  return candidates(io).find((path) => io.exists(path)) ?? null;
}

function validatedLink(argument: string, io: Io): string {
  const parsed = parseLink(argument);

  if (!parsed.ok) {
    throw new InputError([`link refused: ${parsed.reason}`]);
  }

  const problem = checkLink(parsed.link, io);

  if (problem !== null) {
    throw new InputError([`link refused: ${problem}`]);
  }

  return argument;
}

function fail(io: Io, message: string): number {
  io.stderr(`${message}\n`);

  return 1;
}

function folderArgument(argument: string, io: Io): string {
  const folder = resolve(argument);

  try {
    io.readDir(folder);
  } catch {
    throw new InputError([`folder is not a directory: ${folder}`]);
  }

  return folder;
}

export function runOpen(argv: string[], io: Io): number {
  const { positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {},
  });

  if (positionals.length > 1) {
    throw new InputError(["usage: recognizer open [FOLDER|LINK]"]);
  }

  const first = positionals[0] ?? ".";
  const target = isLink(first)
    ? validatedLink(first, io)
    : folderArgument(first, io);

  const bundle = findBundle(io);

  if (bundle === null) {
    return fail(io, INSTALL_HINT);
  }

  const executables = io.readDir(join(bundle, "Contents", "MacOS"));

  if (executables.length !== 1) {
    return fail(
      io,
      `${bundle} must hold exactly one executable in Contents/MacOS`,
    );
  }

  const launched = io.launch(
    join(
      bundle,
      "Contents",
      "MacOS",
      (executables[0] as { name: string }).name,
    ),
    [target],
  );

  return launched.started ? 0 : fail(io, launched.message);
}
