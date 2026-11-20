const SPECIAL = /[.+^${}()|[\]\\]/;

export function globToRegExp(pattern: string): RegExp {
  if (pattern === "*" || pattern === "**") {
    return /^[\s\S]*$/;
  }

  let source = "";
  let i = 0;

  while (i < pattern.length) {
    if (pattern.startsWith("**/", i)) {
      source += "(?:.*/)?";
      i += 3;
    } else if (pattern.slice(i) === "/**") {
      source += "(?:/.*)?";
      i += 3;
    } else if (pattern.startsWith("**", i)) {
      source += ".*";
      i += 2;
    } else if (pattern[i] === "*") {
      source += "[^/]*";
      i += 1;
    } else if (pattern[i] === "?") {
      source += "[^/]";
      i += 1;
    } else {
      const char = pattern[i] as string;
      source += SPECIAL.test(char) ? `\\${char}` : char;
      i += 1;
    }
  }

  return new RegExp(`^${source}$`, "s");
}

export type Matcher = (id: string) => boolean;

export function compileGlob(pattern: string): Matcher {
  const regExp = globToRegExp(pattern);

  return (id) => regExp.test(id);
}

export function matchesAny(matchers: Matcher[], id: string): boolean {
  return matchers.some((matcher) => matcher(id));
}
