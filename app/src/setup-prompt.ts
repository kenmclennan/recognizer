import { SETUP_SKILL } from "recognizer";
import type { DoctorRead } from "./setup-port";

export const UNATTENDED_STATEMENT =
  "This run is unattended and read-only: nobody can answer a question, and you must not change any file.";

export const SKILL_SECTIONS_STATEMENT =
  "The skill's Setup and Update sections say what to look at and what to propose; follow them.";

export const TICK_BOXES_STATEMENT =
  "The skill's rule to run commands only after the user says yes is replaced by tick-boxes: never run a command that writes, and return each one as a proposed change instead, because the user ticks the changes they want and the app runs exactly those.";

export const READS_ARE_NOT_CHANGES_STATEMENT =
  "A doctor fix that only reads (a recognizer help command) or has no command is not a change: leave it out of the answer.";

export const ALL_SECTIONS_STATEMENT =
  'Work through all three sections every run, even when recognizer doctor reports no problems: Problems ("problems"), Test suites ("tests") and Policy ("policy"). Look for test suites to register and a policy to draft whatever doctor says, and propose a change in each section where the repository calls for one.';

export const GRAMMAR_STATEMENT =
  'Return each command as an argv list whose first element is "recognizer". The only commands allowed are recognizer config, recognizer policy, recognizer plugin add <name>, recognizer scan with no other argument, and recognizer sensors check with --run and at most one sensor name. Do not pass --repository. Everything you return is shown to the user to approve.';

export const WRAPPER = [
  UNATTENDED_STATEMENT,
  SKILL_SECTIONS_STATEMENT,
  TICK_BOXES_STATEMENT,
  READS_ARE_NOT_CHANGES_STATEMENT,
  ALL_SECTIONS_STATEMENT,
  GRAMMAR_STATEMENT,
].join("\n\n");

export function doctorText(doctor: DoctorRead | null): string {
  if (doctor === null) {
    return "recognizer doctor has not been read.";
  }

  if (doctor.status === "unavailable") {
    return `recognizer doctor could not run: ${doctor.reason}`;
  }

  return JSON.stringify(doctor.report, null, 2);
}

export function buildPrompt(doctor: DoctorRead | null): string {
  return [
    WRAPPER,
    "## The recognizer-setup skill",
    SETUP_SKILL,
    "## The result of recognizer doctor in this repository",
    doctorText(doctor),
    "",
  ].join("\n\n");
}
