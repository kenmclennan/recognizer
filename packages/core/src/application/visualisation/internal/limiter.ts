export class Limiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly bound: number) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.bound) {
      await new Promise<void>((resume) => this.waiting.push(resume));
    }

    this.active += 1;

    try {
      return await work();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}
