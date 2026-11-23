import { View, type ViewFields } from "@recognizer/core";
import { invoke } from "@tauri-apps/api/core";
import { coreReply } from "./scan-source";
import type { ParsedView, VisualisationPort } from "./visualisation-port";

type Invoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

type ParseReply =
  | { ok: true; view: ViewFields; warnings: string[] }
  | { ok: false; reason: string };

export function createVisualisationSource(
  call: Invoke = invoke as Invoke,
): VisualisationPort {
  const ask = async <T>(op: string, args: Record<string, unknown>) =>
    coreReply<T>(await call("core_call", { op, args }));

  return {
    async parse(text: string): Promise<ParsedView> {
      const reply = await ask<ParseReply>("view.parse", { text });

      return reply.ok
        ? { ok: true, view: View.of(reply.view), warnings: reply.warnings }
        : { ok: false, reason: reply.reason };
    },
    async serialise(view: ViewFields): Promise<string> {
      return (await ask<{ text: string }>("view.serialise", { view })).text;
    },
  };
}
