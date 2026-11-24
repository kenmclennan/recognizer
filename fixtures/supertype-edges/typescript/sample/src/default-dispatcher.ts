import type { Dispatcher } from "./dispatcher";

export class DefaultDispatcher implements Dispatcher {
  dispatch(job: string): void {
    void job;
  }
}
