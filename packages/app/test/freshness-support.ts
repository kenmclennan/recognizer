import {
  type DocumentFreshness,
  documentFreshness,
  type Repository,
} from "@recognizer/core";

type Measuring = {
  name: string;
  measured?: { inputs?: Record<string, string>; tests?: string } | undefined;
};

export function factsFor(
  repository: Repository,
  entries: readonly Measuring[],
  tests: string | null,
): Record<string, DocumentFreshness> {
  const facts: Record<string, DocumentFreshness> = {};

  for (const { name, measured } of entries) {
    if (measured !== undefined) {
      facts[name] = documentFreshness(repository, measured, tests);
    }
  }

  return facts;
}

export function measuredOfDocument(document: {
  sensor: { name: string };
  inputs?: Record<string, string> | undefined;
  tests?: string | undefined;
}): Measuring {
  return {
    name: document.sensor.name,
    measured: {
      ...(document.inputs === undefined ? {} : { inputs: document.inputs }),
      ...(document.tests === undefined ? {} : { tests: document.tests }),
    },
  };
}
