export interface Skill {
  folder: string;
  text: string;
}

const GUIDE_SKILL = [
  "---",
  "name: recognizer",
  "description: Use when the user asks about the structure of a codebase scanned with Recognizer, such as showing, explaining or extending a view of its files.",
  "---",
  "",
  "Run `recognizer help agents` and follow it.",
  "",
].join("\n");

export const SETUP_SKILL = [
  "---",
  "name: recognizer-setup",
  "description: Use when the user asks to set up Recognizer for a repository, or to update or fix that setup after an upgrade or a change in the application.",
  "---",
  "",
  "Run `recognizer help agents` first, and read `recognizer help <command>` for the exact flags of any command before you propose it. This skill states no flags; the command table is the one place they are defined.",
  "",
  "## Protocol",
  "",
  "- At each step show what you found, propose the exact commands, and run them only after the user says yes.",
  "- Write only through `recognizer config` and `recognizer policy`. Never edit a file under `.recognizer/` by hand.",
  "- Never run anything costly unless the user asks for it by name: `recognizer describe`, a `--describe` scan or a Mutation run.",
  "- Nothing starts this skill but the user asking you: no hook, CI job or background check runs it. A repository may run `recognizer doctor` in its own CI.",
  "",
  "## Setup",
  "",
  "Go in this order, one step at a time.",
  "",
  "1. Scanning: run `recognizer plugins` and `recognizer scan --extract`, then report each language with the scanner that read it, the file counts and anything skipped or damaged. When two scanners claim a language, propose `recognizer config scanners.<language> <name>` for the one to use. Nothing else changes, and a problem stops setup there.",
  "2. Sensors and test suites: run `recognizer setup survey` for the test runners found from the repository's manifests, the coverage tools they need, the sensors that can run, and what the survey could not read. Register each sensor the user wants with `recognizer plugin add <name>`, and propose test suites only for sensors whose survey entry says `runs_tests`, as the `recognizer config` commands `recognizer setup changes` builds from the user's choices; do not work them out by hand. Then confirm with `recognizer sensors check --run`, asking first because that runs the tests.",
  "3. Policy: read the code and its imports, write the `ignore` globs, `entry` points and `forbid` rules you would recommend, each with its reasoning and the imports that support it, as the JSON `recognizer setup recommend` checks; it leaves out what the policy already holds or would reject, and counts what each rule breaks today. Write what the user accepts with `recognizer policy` (`--add ignore`, `--add entry`, `--add-forbid`). The user states the intent and you draft it; never present a dependency direction as the tool's finding. The user can skip this step, and then no policy is written.",
  "4. Check: run `recognizer doctor` and report a clean result or what remains.",
  "",
  "## Update",
  "",
  "When the user asks to update an existing setup, start from `recognizer doctor`. Propose a fix for each problem it lists, its `fix.command` where present and its `fix.text` otherwise, with the same approval at each step, and finish with `recognizer doctor` again.",
  "",
].join("\n");

export const SKILLS: Skill[] = [
  { folder: "recognizer", text: GUIDE_SKILL },
  { folder: "recognizer-setup", text: SETUP_SKILL },
];
