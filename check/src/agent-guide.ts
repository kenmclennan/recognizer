import { COMMANDS, type Command } from "./commands.js";

const RULES = [
  "Rules:",
  "  - The command line is your only interface.",
  "  - Never read, write or list anything under .recognizer/, including scans, views, config and the cache.",
  "  - Never write a view file by hand; build views with recognizer views.",
  "  - recognizer check --scan replays a scan produced elsewhere and is for CI and fixtures only; an agent never uses it.",
  "  - Every command reads the cached scan or scans first, so there is no separate scan step.",
];

const RECIPES = [
  "Show me (the user asks to see how something is built):",
  "  1. Find the modules with recognizer find, recognizer modules, recognizer show, recognizer uses, recognizer used-by, recognizer callers and recognizer path.",
  "  2. Save the answer: recognizer views new <name> --description <text>, then recognizer views add, rule, fold and focus.",
  "  3. Confirm it with recognizer views show <name> and recognizer views check.",
  "  4. Explain the boxes with recognizer views note.",
  "  5. End the answer with the view's link: recognizer://open?repo=<url-encoded absolute repository path>&view=<name>",
  "",
  "Extend (the user hands a view back or says to extend it):",
  "  1. Run recognizer views show <name> first, then the same view commands on that view.",
  "  2. recognizer windows and recognizer window <id> read what an open window shows; recognizer views new --from-window <id> saves it.",
  "",
  "Explain (the user asks why or how something works):",
  "  1. Answer from recognizer show, recognizer callers and recognizer path.",
  "  2. Attach what you learned with recognizer views note.",
  "",
  "Drive (the user is hands off and wants the open window changed):",
  "  1. recognizer window <id> <verb> ... --by Claude changes one open window.",
  "  2. Each change is one marked, undoable step.",
  "  3. Otherwise prefer a saved view.",
  "",
  "Where to look next:",
  "  recognizer help <command> prints any command in full.",
];

export function agentGuide(commands: Command[] = COMMANDS): string {
  return [
    "The Recognizer guide for agents",
    "",
    "Commands:",
    ...commands.map(
      (command) => `recognizer ${command.name} - ${command.summary}`,
    ),
    "",
    ...RULES,
    "",
    ...RECIPES,
    "",
  ].join("\n");
}
