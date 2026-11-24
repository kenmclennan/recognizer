const SETTLE_LIMIT = 8;

export class GitSettle<T> {
  private previous: { value: T } | null = null;
  private waited = 0;

  constructor(private baseline: T) {}

  poll(next: T): boolean {
    const previous = this.previous;

    this.previous = null;

    if (previous === null) {
      if (next !== this.baseline) {
        this.previous = { value: next };
        this.waited = 0;
      }

      return false;
    }

    this.waited += 1;

    if (next === previous.value || this.waited >= SETTLE_LIMIT) {
      this.baseline = next;
      this.waited = 0;

      return true;
    }

    this.previous = { value: next };

    return false;
  }
}
