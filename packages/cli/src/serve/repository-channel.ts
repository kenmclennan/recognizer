import {
  type RepositoryState,
  type RepositoryStateDependencies,
  RepositoryStateHolder,
} from "@recognizer/core";
import { ACTIVE_POLL_MS, IDLE_POLL_MS } from "./watch.js";

interface Held {
  holder: RepositoryStateHolder;
  watchers: number;
  timer: NodeJS.Timeout | undefined;
}

export class RepositoryChannel {
  private readonly held = new Map<string, Held>();
  private readonly ends = new Map<string, () => void>();

  constructor(
    private readonly dependencies: () => RepositoryStateDependencies,
    private readonly write: (message: unknown) => void,
    private readonly makeId: () => string,
  ) {}

  private heldFor(repository: string): Held {
    let found = this.held.get(repository);

    if (found === undefined) {
      found = {
        holder: new RepositoryStateHolder(repository, this.dependencies()),
        watchers: 0,
        timer: undefined,
      };
      this.held.set(repository, found);
    }

    return found;
  }

  state(repository: string): RepositoryState {
    const { holder } = this.heldFor(repository);

    holder.refresh();

    return holder.current();
  }

  private poll(held: Held): void {
    const tick = () => {
      held.holder.refresh();
      held.timer = setTimeout(
        tick,
        held.holder.active() ? ACTIVE_POLL_MS : IDLE_POLL_MS,
      );
    };

    held.timer = setTimeout(
      tick,
      held.holder.active() ? ACTIVE_POLL_MS : IDLE_POLL_MS,
    );
  }

  watch(repository: string): string {
    const id = this.makeId();
    const held = this.heldFor(repository);
    let unsubscribe: (() => void) | undefined;
    let ended = false;

    this.ends.set(id, () => {
      if (ended) {
        return;
      }

      ended = true;
      unsubscribe?.();
      held.watchers -= 1;

      if (held.watchers === 0 && held.timer !== undefined) {
        clearTimeout(held.timer);
        held.timer = undefined;
      }
    });
    held.watchers += 1;

    setImmediate(() => {
      if (ended) {
        return;
      }

      held.holder.refresh();
      unsubscribe = held.holder.subscribe((state) =>
        this.write({ stream: id, state }),
      );

      if (held.timer === undefined) {
        this.poll(held);
      }
    });

    return id;
  }

  unwatch(id: string): void {
    this.ends.get(id)?.();
    this.ends.delete(id);
  }

  closeAll(): void {
    for (const end of this.ends.values()) {
      end();
    }

    this.ends.clear();
  }
}
