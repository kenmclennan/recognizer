import type { EstimateAnswer, EstimateRequest } from "./estimate-text";

export type EstimateAnswers = {
  ask(request: EstimateRequest, stamp?: string): void;
  answerFor(request: EstimateRequest, stamp?: string): EstimateAnswer | null;
};

const KEPT = 32;

function keyOf(request: EstimateRequest, stamp: string): string {
  return `${stamp}|${JSON.stringify(request)}`;
}

export function createEstimateAnswers(
  estimate: (request: EstimateRequest) => Promise<EstimateAnswer>,
  changed: () => void,
): EstimateAnswers {
  const answers = new Map<string, EstimateAnswer>();
  const asked = new Set<string>();
  let last: EstimateAnswer | null = null;

  return {
    ask(request, stamp = "") {
      const key = keyOf(request, stamp);

      if (asked.has(key)) {
        return;
      }

      asked.add(key);

      estimate(request)
        .then((answer) => {
          answers.set(key, answer);
          last = answer;

          if (answers.size > KEPT) {
            const oldest = answers.keys().next().value as string;

            answers.delete(oldest);
            asked.delete(oldest);
          }

          changed();
        })
        .catch(() => {
          asked.delete(key);
        });
    },
    answerFor(request, stamp = "") {
      return answers.get(keyOf(request, stamp)) ?? last;
    },
  };
}
