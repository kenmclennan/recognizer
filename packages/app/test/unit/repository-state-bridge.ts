import { createRepositoryStateSource } from "../../src/repository-state-source";

type Handler = (event: { payload: unknown }) => void;

export function scriptedBridge() {
  const calls: { op: string; args: Record<string, unknown> }[] = [];
  let handler: Handler = () => {};
  const source = createRepositoryStateSource({
    invoke: (async (_command: string, args?: Record<string, unknown>) => {
      const call = args as { op: string; args: Record<string, unknown> };

      calls.push(call);

      return { ok: call.op === "repository.watch" ? "r1" : null };
    }) as never,
    listen: (async (_event: string, next: Handler) => {
      handler = next;

      return () => {
        handler = () => {};
      };
    }) as never,
    windowLabel: () => "w-1",
  });

  return { calls, source, emit: (payload: unknown) => handler({ payload }) };
}
