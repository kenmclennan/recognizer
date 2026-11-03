export function clamp(x: number, lo: number, hi: number): number {
  if (x < lo) {
    return lo;
  }
  if (x > hi) {
    return hi;
  }
  return x;
}

export function isAdult(age: number): boolean {
  return age >= 18;
}

export function total(price: number, qty: number): number {
  return price * qty;
}

export function both(a: boolean, b: boolean): boolean {
  return a && b;
}

export function pick(a: number | null, b: number): number {
  return (a ?? b) as number;
}

export function defaultEnabled(): boolean {
  return true;
}

export function untested(a: number, b: number): number {
  return a - b;
}

export function tiered(n: number, vip: boolean): number {
  if (n > 10 && vip) {
    return n * 2;
  }
  return n + 1;
}
