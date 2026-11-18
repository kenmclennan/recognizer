export const DEFAULT_JACOCO_REPORT =
  "build/reports/jacoco/test/jacocoTestReport.xml";

export type JacocoReport =
  | { kind: "default" }
  | { kind: "literal"; path: string }
  | { kind: "unreadable" };

const PLUGIN_LINES = [
  /^id\s*\(\s*["']jacoco["']\s*\)(\s+version\b.*)?$/,
  /^id\s+["']jacoco["'](\s+version\b.*)?$/,
  /^jacoco$/,
];

const APPLY_LINES = [
  /^apply\s+plugin\s*:\s*["']jacoco["']$/,
  /^apply\s*\(\s*plugin\s*=\s*"jacoco"\s*\)$/,
];

const REPORT_LITERAL =
  /outputLocation\s*(?:\.set\(|=)\s*layout\.buildDirectory\.file\(\s*(["'])([^"'\n]*)\1\s*\)/g;

const UNREADABLE_MARKERS =
  /outputLocation|\.destination|reportsDirectory|buildDir\s*=|buildDirectory\s*=|buildDirectory\.set/;

export function stripGradleComments(text: string): string {
  let out = "";
  let quote: string | null = null;
  let at = 0;

  while (at < text.length) {
    const char = text[at] as string;
    const next = text[at + 1];

    if (quote !== null) {
      out += char;

      if (char === "\\" && next !== undefined) {
        out += next;
        at += 2;
        continue;
      }

      if (text.startsWith(quote, at)) {
        out += quote.slice(1);
        at += quote.length;
        quote = null;
        continue;
      }

      at += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      while (at < text.length && text[at] !== "\n") {
        at += 1;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      const end = text.indexOf("*/", at + 2);
      at = end === -1 ? text.length : end + 2;
      out += " ";
      continue;
    }

    if (text.startsWith('"""', at)) {
      quote = '"""';
      out += '"""';
      at += 3;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
    }

    out += char;
    at += 1;
  }

  return out;
}

interface TopLevel {
  top: string;
  plugins: string[];
}

function topLevelOf(text: string): TopLevel {
  let top = "";
  let depth = 0;
  let quote: string | null = null;
  let block: number | null = null;
  const plugins: string[] = [];

  for (let at = 0; at < text.length; at += 1) {
    const char = text[at] as string;

    if (quote !== null) {
      if (char === "\\") {
        at += 1;
      } else if (char === quote) {
        quote = null;
      }

      if (depth === 0) {
        top += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
    }

    if (char === "{") {
      if (depth === 0 && /(^|[\s;])plugins\s*$/.test(top)) {
        block = at + 1;
      }

      depth += 1;

      if (depth === 1) {
        top += "{";
      }
      continue;
    }

    if (char === "}") {
      depth = Math.max(0, depth - 1);

      if (depth === 0 && block !== null) {
        plugins.push(text.slice(block, at));
        block = null;
      }

      if (depth === 0) {
        top += "}";
      }
      continue;
    }

    if (depth === 0 || char === "\n") {
      top += char;
    }
  }

  return { top, plugins };
}

function linesOf(text: string): string[] {
  return text
    .split(/[\n;]/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export function appliesJacoco(source: string): boolean {
  const { top, plugins } = topLevelOf(stripGradleComments(source));

  const inPlugins = plugins
    .flatMap((block) => linesOf(block))
    .some((line) => PLUGIN_LINES.some((pattern) => pattern.test(line)));

  return (
    inPlugins ||
    linesOf(top).some((line) =>
      APPLY_LINES.some((pattern) => pattern.test(line)),
    )
  );
}

function readableLiteral(literal: string): boolean {
  return (
    literal !== "" &&
    !literal.includes("$") &&
    !literal.includes("\\") &&
    !literal.startsWith("/") &&
    !literal.split("/").includes("..")
  );
}

export function jacocoReportOf(source: string): JacocoReport {
  const text = stripGradleComments(source);
  const literals = new Set<string>();

  for (const match of text.matchAll(REPORT_LITERAL)) {
    literals.add(match[2] as string);
  }

  const [only] = [...literals];

  if (literals.size === 1 && only !== undefined && readableLiteral(only)) {
    return { kind: "literal", path: `build/${only}` };
  }

  return UNREADABLE_MARKERS.test(text)
    ? { kind: "unreadable" }
    : { kind: "default" };
}
