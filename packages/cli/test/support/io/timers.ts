interface Due {
  at: number;
  order: number;
  action: () => void;
}

const WALL_START = 1_700_000_000_000;

export class FakeTimers {
  private elapsed = 0;
  private order = 0;
  private readonly pending = new Set<Due>();

  now(): number {
    return WALL_START + this.elapsed;
  }

  awake(): number {
    return this.elapsed;
  }

  after(ms: number, action: () => void): () => void {
    this.order += 1;

    const due: Due = { at: this.elapsed + ms, order: this.order, action };

    this.pending.add(due);

    return () => {
      this.pending.delete(due);
    };
  }

  wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.after(ms, resolve);
    });
  }

  next(): number | undefined {
    let earliest: number | undefined;

    for (const due of this.pending) {
      earliest = earliest === undefined ? due.at : Math.min(earliest, due.at);
    }

    return earliest;
  }

  get scheduled(): number {
    return this.pending.size;
  }

  advance(ms: number): void {
    const target = this.elapsed + ms;

    for (;;) {
      const ready = [...this.pending]
        .filter((due) => due.at <= target)
        .sort((a, b) => a.at - b.at || a.order - b.order)[0];

      if (ready === undefined) {
        break;
      }

      this.pending.delete(ready);
      this.elapsed = Math.max(this.elapsed, ready.at);
      ready.action();
    }

    this.elapsed = target;
  }
}
