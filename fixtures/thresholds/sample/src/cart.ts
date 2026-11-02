export class Cart {
  total(prices: number[]): number {
    return prices.reduce((sum, price) => sum + price, 0);
  }
}
