import {
  type Prices,
  projectDescribe,
} from "../../domain/describing/describe-projection.js";
import { DescribeRequest } from "../../domain/describing/describe-request.js";
import {
  DescribeRun,
  LIMIT_STATUS,
} from "../../domain/describing/describe-run.js";
import { InvalidRequest } from "../../domain/invalid-request.js";
import { Neighbours } from "../../domain/neighbours.js";
import type { Repository } from "../../domain/repository.js";
import type { RunEntry } from "../../domain/run-record.js";
import type {
  DescribeProjection,
  DescribeResult,
  PluginProgress,
} from "../../domain/scan-event.js";
import type { Say } from "../shared/ports/process.js";
import type { DescribingPorts } from "./internal/describing-ports.js";
import { type Subject, subjectFor } from "./internal/subjects.js";
import type { CallResult, RunningCall } from "./ports/describer.js";
import type { DescriberRef } from "./ports/describer-ref.js";

export type DescribeSelection =
  | { kind: "stale"; within?: string[] }
  | { kind: "all"; within?: string[] }
  | { kind: "names"; names: string[] };

export interface DescribeModulesRequest {
  root: string;
  repository: Repository;
  describer: DescriberRef;
  selection: DescribeSelection;
  model: string;
  batchSize: number;
  prices?: Prices;
  confirm?: (projection: DescribeProjection) => Promise<boolean>;
  onProjection?: (projection: DescribeProjection) => void;
  onStart?: (total: number) => void;
  onEntry?: (entry: RunEntry) => void;
  onEvent?: (name: string, event: PluginProgress) => void;
  say: Say;
}

export function requireKnownFiles(
  repository: Repository,
  names: readonly string[],
): void {
  const known = Neighbours.moduleNames(repository);
  const unknown = names.filter((name) => !known.includes(name));

  if (unknown.length > 0) {
    throw new InvalidRequest(unknown.map((name) => `no such file: ${name}`));
  }
}

function fill(
  item: string,
  root: string,
  module: string,
  request: string,
  model: string,
): string {
  return item
    .split("{repository}")
    .join(root)
    .split("{model}")
    .join(model)
    .split("{module}")
    .join(module)
    .split("{request}")
    .join(request);
}

function failureReason(result: CallResult, program: string): string | null {
  const stderr = result.stderr.trim();

  if (!result.started) {
    return stderr !== "" ? stderr : `describer did not start: ${program}`;
  }

  if (result.status !== 0) {
    return stderr !== ""
      ? stderr
      : `describer exited with status ${result.status}`;
  }

  const output = result.stdout.trim();

  if (output === "") {
    return stderr !== "" ? stderr : "describer printed nothing";
  }

  if (/[\r\n]/.test(output)) {
    return "describer printed more than one line";
  }

  return null;
}

export async function describeModules(
  ports: DescribingPorts,
  request: DescribeModulesRequest,
): Promise<DescribeResult> {
  const { describer, responsibilities, clock } = ports;
  const { root, repository, selection, say } = request;
  const lines = responsibilities.read(root);
  const modules = Neighbours.moduleNames(repository);

  if (selection.kind === "names") {
    requireKnownFiles(repository, selection.names);
  }

  const within = selection.kind === "names" ? undefined : selection.within;

  for (const id of within ?? []) {
    if (!modules.includes(id)) {
      say("stderr", `skipped: no such file ${id}\n`);
    }
  }

  const session = describer.open(root, say);

  try {
    const subjects = modules
      .slice()
      .sort()
      .filter((id) => within === undefined || within.includes(id))
      .map((id) =>
        subjectFor(
          (path) => session.readSource(path),
          repository,
          id,
          lines,
          request.describer,
        ),
      );
    const candidates = subjects.filter((subject) => {
      if (selection.kind === "all") {
        return true;
      }

      if (selection.kind === "names") {
        return selection.names.includes(subject.id);
      }

      return (
        subject.status.status === "missing" ||
        subject.status.status === "out-of-date" ||
        subject.status.status === "unreadable"
      );
    });
    const requestOf = (subject: Subject) =>
      DescribeRequest.of(
        repository,
        modules,
        subject.id,
        subject.files,
        subject.source,
      );

    const projection = projectDescribe(
      candidates
        .filter((subject) => subject.hash !== null)
        .map((subject) => describer.requestDocument(requestOf(subject))),
      request.model,
      request.prices,
    );

    request.onProjection?.(projection);

    const approved =
      request.confirm === undefined || (await request.confirm(projection));
    const selected = approved ? candidates : [];

    request.onStart?.(selected.length);

    const described: string[] = [];
    const failed: { module: string; reason: string }[] = [];
    const run = new DescribeRun(request.batchSize);
    const running = new Set<RunningCall>();

    const fail = (module: string, reason: string) => {
      failed.push({ module, reason });
      say("stderr", `failed ${module}: ${reason}\n`);
    };

    const complete = (
      subject: Subject & { hash: string },
      filled: string[],
      began: number,
      result: CallResult,
    ) => {
      const reason = failureReason(result, filled[0] as string);

      if (run.stopped !== null && reason !== null) {
        return;
      }

      if (reason === null) {
        run.succeeded();
        lines.set(subject.id, {
          line: result.stdout.trim(),
          sourceHash: subject.hash,
          describer: request.describer.command,
          version: request.describer.version,
        });
        responsibilities.write(root, lines);
        described.push(subject.id);
      } else {
        fail(subject.id, reason);

        const limit = result.started && result.status === LIMIT_STATUS;

        if (run.failed(subject.id, reason, limit)) {
          for (const other of running) {
            other.kill();
          }
        }
      }

      request.onEntry?.(
        session.entry(subject.id, {
          command: filled,
          status: result.started ? result.status : null,
          stderr: result.stderr,
          duration_ms: clock.awake() - began,
          ...(reason === null ? {} : { reason }),
        }),
      );
    };

    const launch = (subject: Subject & { hash: string }, index: number) => {
      const requestFile = session.writeRequest(
        index,
        describer.requestDocument(requestOf(subject)),
      );
      const filled = request.describer.command.map((item) =>
        fill(item, root, subject.id, requestFile, request.model),
      );
      const began = clock.awake();
      const call = session.start(filled, (name, event) =>
        request.onEvent?.(name, event),
      );

      running.add(call);

      return call.result.then((result) => {
        running.delete(call);
        complete(subject, filled, began, result);
      });
    };

    const queue = selected.entries();
    const lanes = Array.from(
      {
        length: Math.max(1, Math.min(request.batchSize, selected.length)),
      },
      async () => {
        for (const [index, subject] of queue) {
          if (run.stopped !== null) {
            return;
          }

          if (subject.hash === null) {
            fail(subject.id, "source could not be read");
            request.onEntry?.(
              session.entry(subject.id, {
                command: [],
                status: null,
                stderr: "",
                duration_ms: 0,
                reason: "source could not be read",
              }),
            );

            continue;
          }

          await launch({ ...subject, hash: subject.hash }, index);
        }
      },
    );

    await Promise.all(lanes);

    described.sort();
    failed.sort((left, right) =>
      left.module < right.module ? -1 : left.module > right.module ? 1 : 0,
    );

    const pruned = lines.ids().filter((id) => !modules.includes(id));

    for (const id of pruned) {
      lines.remove(id);
    }

    if (pruned.length > 0) {
      responsibilities.write(root, lines);
    }

    const selectedIds = new Set(selected.map((subject) => subject.id));
    const current = subjects.filter(
      (subject) =>
        !selectedIds.has(subject.id) && subject.status.status === "current",
    ).length;
    const stopped = run.close(
      described,
      selected.map((subject) => subject.id),
      failed.map((one) => one.module),
    );

    return { described, failed, current, pruned, stopped };
  } finally {
    session.close();
  }
}
