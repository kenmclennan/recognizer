export class StopBackstops {
  private readonly pending = new Set<Promise<void>>();

  begin(): () => void {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.pending.add(held);
    void held.then(() => this.pending.delete(held));

    return release;
  }

  get size(): number {
    return this.pending.size;
  }

  settled(): Promise<void> {
    return Promise.all([...this.pending]).then(() => undefined);
  }
}
