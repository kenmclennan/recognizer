import type { Dispatcher } from "./dispatcher";

export class LoggingDispatcher implements Dispatcher {
  constructor(private readonly inner: Dispatcher) {}

  dispatch(job: string): void {
    this.inner.dispatch(job);
  }
}
