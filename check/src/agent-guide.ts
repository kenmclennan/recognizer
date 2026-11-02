import { COMMANDS, type Command } from "./commands.js";

const RULES = [
  "Rules:",
  "  - The command line is your only interface.",
  "  - Never read, write or list anything under .recognizer/, including scans, views, config and the cache.",
  "  - Never write a view file by hand; build views with recognizer views.",
  "  - When a scan, describe or measure fails, run recognizer log --last (add --kind describe, scan or measure) for what ran and why it failed; never read the files under .recognizer/ by hand.",
  "  - recognizer check --scan replays a scan produced elsewhere and is for CI and fixtures only; an agent never uses it.",
  "  - Every command reads the cached scan or scans first, so there is no separate scan step.",
  "  - The question and view commands take --repository <dir> to name the repository; without it they use the current directory.",
];

const RECIPES = [
  "Show me (the user asks to see how something is built):",
  "  1. Find the modules with recognizer find, recognizer modules, recognizer show, recognizer uses, recognizer used-by, recognizer callers and recognizer path.",
  "  2. Save the answer: recognizer views new <name> --description <text>, then recognizer views add, rule, fold and focus; a rule's --uses and --used-by reach direct dependencies only, never transitive ones.",
  "  3. Confirm it with recognizer views show <name> and recognizer views check.",
  "  4. Explain the boxes with recognizer views note: one note per module or folder, and writing again replaces it in its place. The order notes are written in is the reading order (a new note goes last; --after <module> or --first places it, recognizer views reorder sets the whole order, recognizer views set <name> --ordered false makes the notes a lens with no order).",
  "  5. End the answer with the view's link: recognizer://open?repo=<url-encoded absolute repository path>&view=<name>",
  "",
  "Extend (the user hands a view back or says to extend it):",
  "  1. Run recognizer views show <name> first, then the same view commands on that view.",
  "  2. recognizer windows and recognizer window <id> read what an open window shows; recognizer views new --from-window <id> saves it.",
  "",
  "Explain (the user asks why or how something works):",
  "  1. Answer from recognizer show, recognizer callers and recognizer path; a module whose responsibility shows [missing] needs recognizer describe first.",
  "  2. Attach what you learned with recognizer views note.",
  "",
  "Drive (the user is hands off and wants the open window changed):",
  "  1. recognizer window <id> <verb> ... --by Claude changes one open window.",
  "  2. Each change is one marked, undoable step.",
  "  3. Otherwise prefer a saved view.",
  "  4. Run recognizer scan --measure all first when the repository registers overlays and a sensor may read them; it runs each registered overlay, some of which run the tests, before the sensors.",
  "  5. Run recognizer scan --sense all when the repository registers sensors and their findings should show; it runs each registered sensor on request, and recognizer check and recognizer show only read the files it leaves.",
  "",
  "Report a review (the user asks for a code review, or you ran one):",
  "  1. Run the review as you normally would, over the whole codebase.",
  '  2. Write the findings as JSON in the findings form, { "findings_version": 1, "findings": [ ... ] }; each finding has id (stable for the same evidence), kind, severity, principle, summary and evidence holding modules and, where they apply, members with module, name, file and lines.',
  "  3. Severity violation is a defect the reviewer would block a merge on; severity warning is a recommendation.",
  "  4. Hand it over with recognizer report --as <name> <file>, or pipe it to recognizer report --as <name>, naming the review; read the refusal if the form is wrong.",
  "  5. A later report under the same name replaces the earlier one.",
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
