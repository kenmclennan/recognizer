export class Store {
  get(key: string): number {
    const found = this.items.get(key);

    if (found === undefined) {
      throw new Error(key);
    }

    return found;
  }

  get(key: string, fallback: number): number {
    const found = this.items.get(key);

    return found === undefined ? fallback : found;
  }
}

export const total = (items: number[]): number => {
  let sum = 0;

  for (const item of items) {
    sum += item;
  }

  return sum;
};

export const scale = function (value: number): number {
  return value * 2;
};

namespace Shapes {
  export function area(width: number, height: number): number {
    return width * height;
  }
}
