export function readConfig(path: string): Record<string, string> {
  const text = readFileSync(path, "utf8");
  const values: Record<string, string> = {};
  for (const row of text.split("\n")) {
    const [key, value] = row.split("=");
    values[key.trim()] = (value ?? "").trim();
  }
  return values;
}

export function renderTable(rows: string[][], widths: number[]): string {
  const lines: string[] = [];
  rows.forEach((row) => {
    const cells = row.map((cell, position) => cell.padEnd(widths[position]));
    lines.push(cells.join(" | "));
  });
  return lines.join("\n");
}

export function walkTree(node: TreeNode, visit: (n: TreeNode) => void): number {
  const stack: TreeNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop() as TreeNode;
    visit(current);
    stack.push(...[...current.children].reverse());
  }
  return stack.length;
}

export function clampRange(low: number, high: number, value: number): number {
  if (low > high) {
    [low, high] = [high, low];
  }
  if (value < low) {
    return low;
  }
  if (value > high) {
    return high;
  }
  return value;
}

export function parseFlags(argv: string[]): [Set<string>, string[]] {
  const flags = new Set<string>();
  const rest: string[] = [];
  for (const token of argv) {
    if (token.startsWith("--")) {
      flags.add(token.slice(2));
    } else {
      rest.push(token);
    }
  }
  return [flags, rest];
}

export function mergeSorted(left: number[], right: number[]): number[] {
  const merged: number[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) {
      merged.push(left[i++]);
    } else {
      merged.push(right[j++]);
    }
  }
  return merged.concat(left.slice(i), right.slice(j));
}
