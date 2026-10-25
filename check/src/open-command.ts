import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";

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

function fail(io: Io, message: string): number {
  io.stderr(`${message}\n`);

  return 1;
}

export function runOpen(argv: string[], io: Io): number {
  const { positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {},
  });

  if (positionals.length > 1) {
    throw new InputError(["usage: recognizer open [FOLDER]"]);
  }

  const folder = resolve(positionals[0] ?? ".");

  try {
    io.readDir(folder);
  } catch {
    throw new InputError([`folder is not a directory: ${folder}`]);
  }

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
    [folder],
  );

  return launched.started ? 0 : fail(io, launched.message);
}
