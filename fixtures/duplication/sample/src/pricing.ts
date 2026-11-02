export function totalWithTax(items: Item[], rate: number): number {
  let total = 0;
  for (const item of items) {
    if (item.price > 0) {
      total += item.price * item.quantity;
    }
  }
  const tax = roundMoney(total * rate);
  return total + tax;
}

export function sumWithLevy(lines: Line[], percent: number): number {
  let sum = 0;
  for (const line of lines) {
    if (line.cost > 0) {
      sum += line.cost * line.count;
    }
  }
  const levy = roundMoney(sum * percent);
  return sum + levy;
}

export function describe(items: Item[]): string {
  const names = items.map((item) => item.name);
  return names.join(", ");
}
