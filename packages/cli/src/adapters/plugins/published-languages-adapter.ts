import {
  type InstalledPlugin,
  type LanguageRule,
  languageRulesOf,
  type PublishedLanguages,
} from "@recognizer/core";

export class PublishedLanguagesAdapter implements PublishedLanguages {
  constructor(private readonly installed: () => readonly InstalledPlugin[]) {}

  rules(): LanguageRule[] {
    const ordered = [...this.installed()].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    const seen = new Set<string>();
    const rules: LanguageRule[] = [];

    for (const scanner of ordered) {
      for (const rule of languageRulesOf<LanguageRule>([scanner])) {
        if (seen.has(rule.name)) {
          rules.push({
            ...rule,
            supertype_links: false,
            private_imports: false,
          });
        } else {
          seen.add(rule.name);
          rules.push(rule);
        }
      }
    }

    return rules;
  }
}
