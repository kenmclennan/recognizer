import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Io } from "./cli.js";
import { InputError } from "./errors.js";

const BASE_RULES = ["Read(**/.recognizer/**)", "Edit(**/.recognizer/**)"];

const CARVE_OUTS = [
  "Read(!**/.recognizer/config.yaml)",
  "Edit(!**/.recognizer/config.yaml)",
];

const DENY_RULES = [...BASE_RULES, ...CARVE_OUTS];

const SKILL_TEXT = [
  "---",
  "name: recognizer",
  "description: Use when the user asks about the structure of a codebase scanned with Recognizer, such as showing, explaining or extending a view of its modules.",
  "---",
  "",
  "Run `recognizer help agents` and follow it.",
  "",
].join("\n");

interface Paths {
  settings: string;
  skill: string;
}

type Settings = Record<string, unknown>;

function paths(io: Io): Paths {
  const home = io.env("HOME");

  if (home === undefined || home === "") {
    throw new InputError(["HOME is not set"]);
  }

  const folder = join(home, ".claude");

  return {
    settings: join(folder, "settings.json"),
    skill: join(folder, "skills", "recognizer", "SKILL.md"),
  };
}

function isObject(value: unknown): value is Settings {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSettings(path: string, io: Io): Settings {
  if (!io.exists(path)) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(io.readFile(path));
  } catch {
    throw new InputError([`${path} is not valid JSON; nothing was written`]);
  }

  if (!isObject(parsed)) {
    throw new InputError([`${path} is not a JSON object; nothing was written`]);
  }

  if (parsed.permissions !== undefined && !isObject(parsed.permissions)) {
    throw new InputError([
      `permissions in ${path} is not an object; nothing was written`,
    ]);
  }

  const deny = (parsed.permissions as Settings | undefined)?.deny;

  if (deny !== undefined && !Array.isArray(deny)) {
    throw new InputError([
      `permissions.deny in ${path} is not an array; nothing was written`,
    ]);
  }

  return parsed;
}

function writeSettings(path: string, settings: Settings, io: Io): void {
  const temporary = `${path}.tmp`;

  io.writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`);
  io.rename(temporary, path);
}

function denyList(settings: Settings): string[] {
  return ((settings.permissions as Settings | undefined)?.deny ??
    []) as string[];
}

function arranged(present: string[]): { deny: string[]; changes: string[] } {
  const deny = [...present];
  const changes: string[] = [];

  for (const rule of BASE_RULES.filter((one) => !deny.includes(one))) {
    deny.push(rule);
    changes.push(`added deny rule ${rule}`);
  }

  for (const rule of CARVE_OUTS) {
    const at = deny.indexOf(rule);
    const lastBase = Math.max(...BASE_RULES.map((one) => deny.indexOf(one)));

    if (at === -1) {
      deny.push(rule);
      changes.push(`added deny rule ${rule}`);
    } else if (at < lastBase) {
      deny.splice(at, 1);
      deny.push(rule);
      changes.push(`moved deny rule ${rule}`);
    }
  }

  return { deny, changes };
}

function install(location: Paths, io: Io): string[] {
  const settings = readSettings(location.settings, io);
  const { deny, changes } = arranged(denyList(settings));

  if (changes.length > 0) {
    const permissions = (settings.permissions ?? {}) as Settings;

    permissions.deny = deny;
    settings.permissions = permissions;
    writeSettings(location.settings, settings, io);
  }

  const existed = io.exists(location.skill);

  if (!existed || io.readFile(location.skill) !== SKILL_TEXT) {
    io.writeFile(location.skill, SKILL_TEXT);
    changes.unshift(`${existed ? "updated" : "wrote"} ${location.skill}`);
  }

  return changes;
}

function uninstall(location: Paths, io: Io): string[] {
  const settings = readSettings(location.settings, io);
  const present = denyList(settings);
  const changes: string[] = [];

  if (present.some((rule) => DENY_RULES.includes(rule))) {
    const kept = present.filter((rule) => !DENY_RULES.includes(rule));
    const permissions = settings.permissions as Settings;

    if (kept.length > 0) {
      permissions.deny = kept;
    } else {
      delete permissions.deny;
    }

    if (Object.keys(permissions).length === 0) {
      delete settings.permissions;
    }

    writeSettings(location.settings, settings, io);
    changes.push(
      ...present
        .filter((rule) => DENY_RULES.includes(rule))
        .map((rule) => `removed deny rule ${rule}`),
    );
  }

  if (io.exists(location.skill)) {
    io.remove(location.skill);
    changes.unshift(`removed ${location.skill}`);

    const folder = join(location.skill, "..");

    if (io.exists(folder) && io.readDir(folder).length === 0) {
      io.removeDir(folder);
    }
  }

  return changes;
}

export function runAgents(argv: string[], io: Io): number {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { json: { type: "boolean" } },
  });
  const [subcommand, ...extra] = positionals;

  if (
    (subcommand !== "install" && subcommand !== "uninstall") ||
    extra.length > 0
  ) {
    throw new InputError([
      "usage: recognizer agents install|uninstall [--json]",
    ]);
  }

  const location = paths(io);
  const changes =
    subcommand === "install" ? install(location, io) : uninstall(location, io);

  if (values.json) {
    io.stdout(`${JSON.stringify({ changes }, null, 2)}\n`);
  } else {
    io.stdout(changes.length === 0 ? "no change\n" : `${changes.join("\n")}\n`);
  }

  return 0;
}
