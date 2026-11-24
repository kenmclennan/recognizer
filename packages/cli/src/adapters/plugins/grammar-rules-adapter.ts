import type {
  GrammarRule,
  GrammarRules,
  InstalledPlugin,
} from "@recognizer/core";

export class GrammarRulesAdapter implements GrammarRules {
  constructor(private readonly installed: () => readonly InstalledPlugin[]) {}

  rules(): GrammarRule[] {
    const ordered = [...this.installed()].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    const seen = new Set<string>();
    const rules: GrammarRule[] = [];

    for (const scanner of ordered) {
      for (const language of scanner.manifest.languages ?? []) {
        const grammars = (language as { grammars?: GrammarRule[] }).grammars;

        for (const rule of grammars ?? []) {
          if (!seen.has(rule.name)) {
            seen.add(rule.name);
            rules.push({
              ...rule,
              function_names: rule.function_names ?? [],
              span: rule.span ?? null,
            });
          }
        }
      }
    }

    return rules;
  }
}
