export function straight(a: number): number {
  const b = a + 1;
  return b;
}

export function oneIf(a: boolean): number {
  if (a) {
    return 1;
  }
  return 0;
}

export function ifElse(a: number): string {
  if (a === 1) {
    return "one";
  } else if (a === 2) {
    return "two";
  }
  return "many";
}

export function loops(xs: number[], o: number[], a: number): number {
  let total = 0;
  for (let i = 0; i < xs.length; i++) {
    total += xs[i] as number;
  }
  for (const x of o) {
    total += x;
  }
  while (a > 0) {
    a -= 1;
  }
  return total;
}

export function doLoop(a: number, text: string): number {
  let n = 0;
  do {
    n += 1;
  } while (n < a);
  try {
    n += JSON.parse(text);
  } catch (e) {
    n = -1;
  }
  if (n > 5) {
    n = 5;
  }
  return n > 0 ? n : 0;
}

export function switchy(k: number, o: Record<string, number>, a: boolean): string {
  let r = "";
  switch (k) {
    case 1:
      r = "a";
      break;
    case 2:
      r = "b";
      break;
    case 3:
      r = "c";
      break;
    default:
      r = "z";
  }
  for (const key in o) {
    r += key;
  }
  if (a) {
    r += "!";
  }
  return r;
}

export function optional(a: any, b: any, c: number): any {
  const deep = a?.b?.c;
  const fallback = deep ?? b;
  let n = c > 0 ? 1 : 2;
  if (fallback) {
    n += 1;
  }
  while (n < 10) {
    n += 1;
  }
  return n;
}

export function logic(a: boolean, b: boolean, c: boolean, d: any, e: any): any {
  let x = 0;
  if ((a && b) || c) {
    x = 1;
  }
  while (a || b) {
    a = false;
    b = false;
  }
  const y = d ?? e;
  return c ? y : x;
}

export function mixed(a: boolean, b: boolean, c: boolean, xs: number[], t: string): number {
  let r = 0;
  if (a) {
    r = 1;
  } else if (b) {
    r = 2;
  } else if (c) {
    r = 3;
  }
  for (let i = 0; i < xs.length; i++) {
    r += xs[i] as number;
  }
  do {
    r -= 1;
  } while (r > 100);
  try {
    r += JSON.parse(t);
  } catch (e) {
    r = 0;
  }
  const z = a && b;
  const y = a || b;
  return r;
}

export function nested(rows: number[][], o: Record<string, number>, k: number, t: string): number {
  let out = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as number[];
    if (row.length > 0) {
      for (const cell of row) {
        if (cell > 0) {
          out += cell;
        }
      }
    }
  }
  for (const key in o) {
    out += key.length;
  }
  switch (k) {
    case 1:
      out += 1;
      break;
    case 2:
      out += 2;
      break;
    default:
      out += 3;
  }
  try {
    out += JSON.parse(t);
  } catch (e) {
    out = 0;
  }
  const hint: any = o;
  return out + hint?.extra;
}

export function classify(n: number, a: boolean, b: boolean, c: boolean, d: boolean, xs: string[]): string {
  let label = "";
  if (n < 0) {
    label = "neg";
  } else if (n === 0) {
    label = "zero";
  } else if (n < 10) {
    label = "small";
  } else if (n < 100) {
    label = "medium";
  } else {
    label = "huge";
  }
  const flag = a || b || c || d;
  for (const x of xs) {
    label += x;
  }
  while (n > 1) {
    n = Math.floor(n / 2);
  }
  return flag ? label + "+" : label;
}

export function sprawl(n: number, a: boolean, b: boolean, c: boolean, xs: number[], t: string): number {
  let label = 0;
  if (n < 0) {
    label = 0;
  } else if (n === 0) {
    label = 1;
  } else if (n < 10) {
    label = 2;
  } else if (n < 100) {
    label = 3;
  } else if (n < 1000) {
    label = 4;
  } else if (n < 10000) {
    label = 5;
  }
  for (let i = 0; i < xs.length; i++) {
    label += xs[i] as number;
  }
  const ok = a && b && c;
  try {
    label += JSON.parse(t);
  } catch (e) {
    label = 0;
  }
  return ok ? label : -label;
}
