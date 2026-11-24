import { compileGlob } from "../glob.js";
import type { EntryRule } from "../policy-rule.js";
import type { LanguageBehaviour } from "./language-behaviour.js";

export function isEntryPoint(
  id: string,
  policyEntry: readonly EntryRule[],
  entryGlobs: readonly string[],
  scanned: boolean,
  behaviour: LanguageBehaviour,
): boolean {
  if (
    scanned ||
    policyEntry.some((rule) => rule.marks(id)) ||
    behaviour.isTestFile(id)
  ) {
    return true;
  }

  return entryGlobs.some((glob) => compileGlob(glob)(id));
}
